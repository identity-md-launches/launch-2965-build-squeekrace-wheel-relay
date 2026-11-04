// @ts-check
// Reads the official Squeekchain public API and decides what state the wheel is in.
//
// Why /v1/status and not /v1/measurement/runs: runs pages forward from the first segment
// ever recorded, so reaching the live edge means walking the whole history, and its cursors
// are documented as opaque. /v1/status carries `cumulativeWorkUnits`, and the docs define one
// accepted passage as one work unit, so the difference between two readings is the exact
// number of passages accepted between them. A late reading still carries everything missed.

export const API_BASE = 'https://api.squeekchain.com';
export const STATUS_URL = `${API_BASE}/v1/status`;
export const STATS_URL = `${API_BASE}/v1/measurement/stats?range=7d`;

const SCHEMA_VERSION = 1;
const POLL_MS = 2500;
const FAILURE_BACKOFF_MS = 5000;
const RATE_LIMIT_BACKOFF_MS = 10000;
const REQUEST_TIMEOUT_MS = 8000;
/** A failed poll is tolerated until the last good reading is this old. */
const LOST_AFTER_MS = 20000;
/** The device reports about every ten seconds. Four missed reports reads as stale. */
const LAG_STALE_MS = 45000;
/** After passages arrive, the wheel counts as running until this long has passed. */
const MOVING_FOR_MS = 15000;
const BUCKET_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_SHARE_OF_PEAK = 0.25;

/**
 * @typedef {object} Reading
 * @property {string} generatedAt
 * @property {string} observedAt
 * @property {string} receivedAt
 * @property {string} freshness
 * @property {string} counterEpoch
 * @property {bigint} cumulative
 * @property {string} provenance
 * @property {number} rpmMilli
 */

/** @typedef {'connecting'|'running'|'resting'|'stale'} WheelState */
/** @typedef {'network'|'rate'|'http'|'schema'|'malformed'|'unavailable'} Failure */
/** @typedef {Failure|'api'|'lag'|null} StaleReason */

/**
 * @typedef {object} Snapshot
 * @property {WheelState} state
 * @property {StaleReason} reason
 * @property {Reading|null} reading
 * @property {number} ageSeconds Seconds since the last good reading was fetched.
 */

/**
 * @param {unknown} json
 * @returns {{ok:true, reading:Reading}|{ok:false, reason:Failure}}
 */
export function parseStatus(json) {
  const body = /** @type {any} */ (json);
  if (!body || typeof body !== 'object') return { ok: false, reason: 'malformed' };
  if (body.status === 'unavailable') return { ok: false, reason: 'unavailable' };
  if (body.schemaVersion !== SCHEMA_VERSION) return { ok: false, reason: 'schema' };

  const m = body.measurement;
  if (!m || typeof m !== 'object' || m.status === 'unavailable') {
    return { ok: false, reason: 'unavailable' };
  }
  const count = m.cumulativeWorkUnits;
  if (typeof count !== 'string' || !/^\d+$/.test(count)) return { ok: false, reason: 'malformed' };
  if (typeof m.observedAt !== 'string' || typeof m.receivedAt !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  return {
    ok: true,
    reading: {
      generatedAt: typeof body.generatedAt === 'string' ? body.generatedAt : m.receivedAt,
      observedAt: m.observedAt,
      receivedAt: m.receivedAt,
      freshness: String(m.freshness),
      counterEpoch: String(m.counterEpoch),
      cumulative: BigInt(count),
      provenance: String(m.provenance),
      rpmMilli: typeof m.rpmMilli === 'number' ? m.rpmMilli : 0,
    },
  };
}

/**
 * Compares two readings. Only hardware readings in one counter epoch can be subtracted.
 * @param {Reading|null} previous
 * @param {Reading} next
 * @returns {{delta:number, discontinuity:boolean, outOfOrder:boolean}}
 */
export function compareReadings(previous, next) {
  if (!previous) return { delta: 0, discontinuity: false, outOfOrder: false };
  const sameCounter =
    previous.counterEpoch === next.counterEpoch &&
    previous.provenance === 'hardware' &&
    next.provenance === 'hardware';
  if (!sameCounter) return { delta: 0, discontinuity: true, outOfOrder: false };
  const difference = next.cumulative - previous.cumulative;
  if (difference < 0n) return { delta: 0, discontinuity: false, outOfOrder: true };
  return { delta: Number(difference), discontinuity: false, outOfOrder: false };
}

/**
 * When the measurement in `reading` reached the API, on this browser's clock. The age the
 * response itself reports (generatedAt minus receivedAt) is taken off the moment this
 * measurement was first seen. Using the browser's clock only for elapsed time means a phone
 * with a wrong clock does not mark a live wheel stale.
 * @param {Reading} reading
 * @param {number} seenAt Browser time when this measurement was first fetched.
 * @returns {number}
 */
export function measuredAtFor(reading, seenAt) {
  const lag = Date.parse(reading.generatedAt) - Date.parse(reading.receivedAt);
  return seenAt - (Number.isFinite(lag) && lag > 0 ? lag : 0);
}

/**
 * @param {object} input
 * @param {Reading|null} input.reading
 * @param {Failure|null} input.failure The result of the latest poll, null when it worked.
 * @param {number|null} input.lastGoodAt When a poll last succeeded.
 * @param {number|null} input.measuredAt When the current measurement reached the API, from `measuredAtFor`.
 * @param {number|null} input.lastMovedAt
 * @param {number} input.now
 * @returns {{state:WheelState, reason:StaleReason}}
 */
export function classify({ reading, failure, lastGoodAt, measuredAt, lastMovedAt, now }) {
  if (!reading || lastGoodAt === null) {
    return failure ? { state: 'stale', reason: failure } : { state: 'connecting', reason: null };
  }
  if (now - lastGoodAt > LOST_AFTER_MS) return { state: 'stale', reason: failure ?? 'network' };
  if (reading.freshness !== 'online') return { state: 'stale', reason: 'api' };
  // A successful poll that returns the same measurement again does not make it any newer.
  const measured = measuredAt ?? measuredAtFor(reading, lastGoodAt);
  if (now - measured > LAG_STALE_MS) return { state: 'stale', reason: 'lag' };
  const movedRecently = lastMovedAt !== null && now - lastMovedAt < MOVING_FOR_MS;
  if (reading.rpmMilli > 0 || movedRecently) return { state: 'running', reason: null };
  return { state: 'resting', reason: null };
}

/**
 * @param {Response} response
 * @returns {number} Milliseconds to wait. Retry-After is only readable if the API exposes it.
 */
function retryDelay(response) {
  const seconds = Number(response.headers.get('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RATE_LIMIT_BACKOFF_MS;
}

export class LiveFeed {
  /**
   * @param {object} options
   * @param {(reading:Reading, delta:number, discontinuity:boolean)=>void} options.onReading
   * @param {typeof fetch} [options.fetchImpl]
   * @param {()=>number} [options.now]
   */
  constructor({ onReading, fetchImpl, now }) {
    this.onReading = onReading;
    // Wrapped so `this` is never the feed: native fetch throws when called as a method.
    /** @type {typeof fetch} */
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = now ?? (() => Date.now());
    /** @type {Reading|null} */
    this.reading = null;
    /** @type {Failure|null} */
    this.failure = null;
    /** @type {number|null} */
    this.lastGoodAt = null;
    /** @type {number|null} */
    this.measuredAt = null;
    /** @type {number|null} */
    this.lastMovedAt = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this.timer = null;
    this.polling = false;
  }

  start() {
    void this.poll();
  }

  /** Polls now instead of waiting, for example when the tab becomes visible again. */
  wake() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    void this.poll();
  }

  /** @returns {Snapshot} */
  snapshot() {
    const now = this.now();
    const { state, reason } = classify({
      reading: this.reading,
      failure: this.failure,
      lastGoodAt: this.lastGoodAt,
      measuredAt: this.measuredAt,
      lastMovedAt: this.lastMovedAt,
      now,
    });
    const ageSeconds = this.lastGoodAt === null ? 0 : Math.round((now - this.lastGoodAt) / 1000);
    return { state, reason, reading: this.reading, ageSeconds };
  }

  /** @param {Reading} reading */
  accept(reading) {
    const previous = this.reading;
    const { delta, discontinuity, outOfOrder } = compareReadings(previous, reading);
    if (outOfOrder) return;
    const isNew = !previous || previous.observedAt !== reading.observedAt || delta > 0;
    this.reading = reading;
    this.lastGoodAt = this.now();
    // Only a measurement the API has not sent before resets its age.
    if (!previous || previous.receivedAt !== reading.receivedAt || this.measuredAt === null) {
      this.measuredAt = measuredAtFor(reading, this.lastGoodAt);
    }
    if (delta > 0) this.lastMovedAt = this.lastGoodAt;
    if (isNew) this.onReading(reading, delta, discontinuity);
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let wait = POLL_MS;
    try {
      // `no-cache` revalidates through the browser's own ETag handling. No custom headers,
      // so the request stays simple and needs no CORS preflight.
      const response = await this.fetchImpl(STATUS_URL, { cache: 'no-cache', signal: controller.signal });
      if (response.status === 429) {
        this.failure = 'rate';
        wait = retryDelay(response);
      } else if (!response.ok) {
        this.failure = 'http';
        wait = FAILURE_BACKOFF_MS;
      } else {
        const parsed = parseStatus(await response.json());
        if (parsed.ok) {
          this.failure = null;
          this.accept(parsed.reading);
        } else {
          this.failure = parsed.reason;
          wait = FAILURE_BACKOFF_MS;
        }
      }
    } catch {
      this.failure = 'network';
      wait = FAILURE_BACKOFF_MS;
    } finally {
      clearTimeout(timeout);
      this.polling = false;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, wait);
  }
}

/**
 * @typedef {object} WheelStats
 * @property {{startMinuteUtc:number, meanWorkMilli:string}[]} typicalDay
 * @property {number|null} mmPerPassage
 */

/**
 * @param {unknown} json
 * @returns {WheelStats|null}
 */
export function parseStats(json) {
  const body = /** @type {any} */ (json);
  if (!body || body.schemaVersion !== SCHEMA_VERSION) return null;
  const typicalDay = Array.isArray(body.activity?.typicalDay) ? body.activity.typicalDay : [];
  const mm = Number(body.lifetime?.observedDistanceMm) / Number(body.lifetime?.acceptedWorkUnits);
  return { typicalDay, mmPerPassage: Number.isFinite(mm) && mm > 0 ? mm : null };
}

/**
 * Optional context. The game runs without it, so every failure resolves to null.
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<WheelStats|null>}
 */
export async function fetchStats(fetchImpl) {
  try {
    const response = await (fetchImpl ?? fetch)(STATS_URL);
    if (!response.ok) return null;
    return parseStats(await response.json());
  } catch {
    return null;
  }
}

/**
 * When the wheel is usually busy next, from the API's own seven-day pattern.
 * @param {{startMinuteUtc:number, meanWorkMilli:string}[]} typicalDay
 * @param {number} nowMs
 * @returns {number|null} A timestamp, or `nowMs` when this is a usually busy half hour.
 */
export function nextActiveAt(typicalDay, nowMs) {
  const buckets = typicalDay
    .map((bucket) => ({ minute: Number(bucket.startMinuteUtc), work: Number(bucket.meanWorkMilli) }))
    .filter((bucket) => Number.isFinite(bucket.minute) && Number.isFinite(bucket.work))
    .sort((a, b) => a.minute - b.minute);
  if (buckets.length === 0) return null;
  const peak = Math.max(...buckets.map((bucket) => bucket.work));
  if (peak <= 0) return null;

  const now = new Date(nowMs);
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let dayOffset = 0; dayOffset < 2; dayOffset += 1) {
    for (const bucket of buckets) {
      if (bucket.work < peak * ACTIVE_SHARE_OF_PEAK) continue;
      const start = dayStart + dayOffset * DAY_MS + bucket.minute * 60000;
      if (start + BUCKET_MS <= nowMs) continue;
      return Math.max(start, nowMs);
    }
  }
  return null;
}
