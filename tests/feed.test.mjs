import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LiveFeed,
  classify,
  compareReadings,
  measuredAtFor,
  nextActiveAt,
  parseStats,
  parseStatus,
} from '../src/js/feed.js';

const T0 = Date.parse('2026-11-04T09:40:00.000Z');

/** A status body shaped like the live API's response on 2026-11-04. */
function statusBody(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-04T09:40:05.873Z',
    measurement: {
      freshness: 'online',
      observedAt: '2026-11-04T09:39:59.256Z',
      receivedAt: '2026-11-04T09:39:59.568Z',
      staleAfterSeconds: 120,
      counterEpoch: 'c011f01a-93ba-45ff-8579-619ddfdf40ec',
      cumulativeWorkUnits: '92730',
      provenance: 'hardware',
      coreStatus: 'IDLE',
      rpmMilli: 0,
      ...overrides,
    },
  };
}

const reading = (overrides) => {
  const parsed = parseStatus(statusBody(overrides));
  assert.equal(parsed.ok, true);
  return parsed.reading;
};

test('parseStatus reads a live-shaped body', () => {
  const parsed = parseStatus(statusBody());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.reading.cumulative, 92730n);
  assert.equal(parsed.reading.freshness, 'online');
});

test('parseStatus refuses anything it cannot trust', () => {
  assert.deepEqual(parseStatus(null), { ok: false, reason: 'malformed' });
  assert.deepEqual(parseStatus({ status: 'unavailable', reason: 'x' }), { ok: false, reason: 'unavailable' });
  assert.deepEqual(parseStatus({ ...statusBody(), schemaVersion: 2 }), { ok: false, reason: 'schema' });
  assert.deepEqual(parseStatus({ schemaVersion: 1 }), { ok: false, reason: 'unavailable' });
  assert.deepEqual(parseStatus(statusBody({ cumulativeWorkUnits: 92730 })), { ok: false, reason: 'malformed' });
  assert.deepEqual(parseStatus(statusBody({ observedAt: null })), { ok: false, reason: 'malformed' });
});

test('compareReadings subtracts within one hardware counter epoch', () => {
  const result = compareReadings(reading(), reading({ cumulativeWorkUnits: '92745' }));
  assert.deepEqual(result, { delta: 15, discontinuity: false, outOfOrder: false });
});

test('compareReadings never counts across an epoch or a non-hardware reading', () => {
  const epoch = compareReadings(reading(), reading({ cumulativeWorkUnits: '5', counterEpoch: 'new' }));
  assert.deepEqual(epoch, { delta: 0, discontinuity: true, outOfOrder: false });
  const provenance = compareReadings(reading(), reading({ cumulativeWorkUnits: '92800', provenance: 'simulated' }));
  assert.deepEqual(provenance, { delta: 0, discontinuity: true, outOfOrder: false });
});

test('compareReadings flags an older cached reading instead of counting it', () => {
  const result = compareReadings(reading({ cumulativeWorkUnits: '92745' }), reading());
  assert.deepEqual(result, { delta: 0, discontinuity: false, outOfOrder: true });
});

const input = (overrides) => ({
  reading: reading(),
  failure: null,
  lastGoodAt: T0,
  measuredAt: T0,
  lastMovedAt: null,
  now: T0,
  ...overrides,
});

test('classify: connecting, then stale when the first poll fails', () => {
  assert.equal(classify(input({ reading: null, lastGoodAt: null })).state, 'connecting');
  assert.deepEqual(classify(input({ reading: null, lastGoodAt: null, failure: 'network' })), { state: 'stale', reason: 'network' });
});

test('classify: resting, running by rpm and running by recent passages', () => {
  assert.equal(classify(input()).state, 'resting');
  assert.equal(classify(input({ reading: reading({ rpmMilli: 77005 }) })).state, 'running');
  assert.equal(classify(input({ lastMovedAt: T0 - 5000 })).state, 'running');
  assert.equal(classify(input({ lastMovedAt: T0 - 60000 })).state, 'resting');
});

test('classify: the API saying stale wins over rpm', () => {
  const result = classify(input({ reading: reading({ freshness: 'stale', rpmMilli: 77005 }) }));
  assert.deepEqual(result, { state: 'stale', reason: 'api' });
});

test('classify: an old measurement reads as stale before the API says so', () => {
  const old = reading({ receivedAt: '2026-11-04T09:38:00.000Z' });
  const result = classify(input({ reading: old, measuredAt: measuredAtFor(old, T0) }));
  assert.deepEqual(result, { state: 'stale', reason: 'lag' });
});

test('classify: a measurement turns stale as it ages, even while polls succeed', () => {
  assert.equal(classify(input({ lastGoodAt: T0 + 44000, now: T0 + 44000 })).state, 'resting');
  assert.deepEqual(classify(input({ lastGoodAt: T0 + 46000, now: T0 + 46000 })), { state: 'stale', reason: 'lag' });
});

test('LiveFeed: refetching the same measurement does not keep it fresh', async () => {
  let clock = T0;
  const body = statusBody({ observedAt: '2026-11-04T09:40:00.000Z', receivedAt: '2026-11-04T09:40:00.000Z' });
  body.generatedAt = '2026-11-04T09:40:00.000Z';
  const feed = new LiveFeed({
    onReading: () => {},
    now: () => clock,
    fetchImpl: async () => ({ status: 200, ok: true, headers: new Headers(), json: async () => structuredClone(body) }),
  });
  for (let elapsed = 0; elapsed <= 90000; elapsed += 2500) {
    clock = T0 + elapsed;
    await feed.poll();
    clearTimeout(feed.timer);
    const expected = elapsed > 45000 ? 'stale' : 'resting';
    assert.equal(feed.snapshot().state, expected, `at ${elapsed} ms`);
  }
  assert.equal(feed.snapshot().reason, 'lag');
});

test('LiveFeed: a new measurement resets the age', async () => {
  let clock = T0;
  const bodies = [
    statusBody({ receivedAt: '2026-11-04T09:40:00.000Z' }),
    statusBody({ observedAt: '2026-11-04T09:40:40.000Z', receivedAt: '2026-11-04T09:40:40.000Z' }),
  ];
  bodies.forEach((body) => { body.generatedAt = body.measurement.receivedAt; });
  const feed = new LiveFeed({ onReading: () => {}, now: () => clock, fetchImpl: fakeFetch(bodies) });
  await feed.poll();
  clearTimeout(feed.timer);
  clock = T0 + 40000;
  await feed.poll();
  clearTimeout(feed.timer);
  // 60 s after the first measurement, but only 20 s after the second.
  clock = T0 + 60000;
  assert.equal(feed.snapshot().state, 'resting');
});

test('classify: one failed poll is tolerated, a long gap is not', () => {
  assert.equal(classify(input({ failure: 'network', now: T0 + 5000 })).state, 'resting');
  assert.deepEqual(classify(input({ failure: 'network', now: T0 + 30000 })), { state: 'stale', reason: 'network' });
});

/** A fetch double that returns queued bodies. */
function fakeFetch(bodies) {
  return async () => ({ status: 200, ok: true, headers: new Headers(), json: async () => bodies.shift() });
}

test('LiveFeed reports the passages between readings, and a catch-up reading loses none', async () => {
  const seen = [];
  const feed = new LiveFeed({
    onReading: (_reading, delta) => seen.push(delta),
    fetchImpl: fakeFetch([
      statusBody(),
      statusBody({ observedAt: '2026-11-04T09:40:09.000Z', cumulativeWorkUnits: '92745' }),
      statusBody({ observedAt: '2026-11-04T09:40:59.000Z', cumulativeWorkUnits: '92800' }),
    ]),
  });
  for (let i = 0; i < 3; i += 1) {
    await feed.poll();
    clearTimeout(feed.timer);
  }
  assert.deepEqual(seen, [0, 15, 55]);
});

test('LiveFeed does not repeat an unchanged reading', async () => {
  const seen = [];
  const feed = new LiveFeed({ onReading: (_r, delta) => seen.push(delta), fetchImpl: fakeFetch([statusBody(), statusBody()]) });
  await feed.poll();
  clearTimeout(feed.timer);
  await feed.poll();
  clearTimeout(feed.timer);
  assert.equal(seen.length, 1);
});

test('LiveFeed turns a rejected request into a stale state', async () => {
  const feed = new LiveFeed({ onReading: () => {}, fetchImpl: async () => { throw new TypeError('network'); } });
  await feed.poll();
  clearTimeout(feed.timer);
  assert.deepEqual([feed.snapshot().state, feed.snapshot().reason], ['stale', 'network']);
});

test('LiveFeed records a 429 as rate limited', async () => {
  const feed = new LiveFeed({
    onReading: () => {},
    fetchImpl: async () => ({ status: 429, ok: false, headers: new Headers({ 'Retry-After': '3' }) }),
  });
  await feed.poll();
  clearTimeout(feed.timer);
  assert.equal(feed.failure, 'rate');
});

const day = (active) =>
  Array.from({ length: 48 }, (_, index) => ({
    startMinuteUtc: index * 30,
    meanWorkMilli: active.includes(index * 30) ? '1000000' : '0',
  }));

test('nextActiveAt finds the next usually busy half hour today', () => {
  const at = nextActiveAt(day([1260]), T0);
  assert.equal(new Date(at).toISOString(), '2026-11-04T21:00:00.000Z');
});

test('nextActiveAt rolls over to tomorrow', () => {
  const at = nextActiveAt(day([60]), T0);
  assert.equal(new Date(at).toISOString(), '2026-11-05T01:00:00.000Z');
});

test('nextActiveAt returns now during a busy half hour', () => {
  assert.equal(nextActiveAt(day([570]), T0), T0);
});

test('nextActiveAt has no answer for an empty or silent pattern', () => {
  assert.equal(nextActiveAt([], T0), null);
  assert.equal(nextActiveAt(day([]), T0), null);
});

test('parseStats derives wheel travel per passage and tolerates missing parts', () => {
  const stats = parseStats({
    schemaVersion: 1,
    lifetime: { acceptedWorkUnits: '92730', observedDistanceMm: '81416940' },
    activity: { typicalDay: day([1260]) },
  });
  assert.equal(stats.mmPerPassage, 878);
  assert.equal(stats.typicalDay.length, 48);
  assert.deepEqual(parseStats({ schemaVersion: 1 }), { typicalDay: [], mmPerPassage: null });
  assert.equal(parseStats({ schemaVersion: 2 }), null);
});
