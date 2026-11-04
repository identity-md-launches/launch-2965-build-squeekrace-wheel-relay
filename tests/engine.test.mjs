import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LATE_POINTS,
  LEG_PACES,
  LOCK_SECONDS,
  addPassages,
  atLine,
  bucketLog,
  busiest,
  createRun,
  finish,
  inZone,
  legs,
  passBaton,
  score,
  step,
} from '../src/js/engine.js';
import { racerById } from '../src/js/racers.js';

const newRun = (id = 'pip') => createRun({ mode: 'live', racer: racerById(id), seconds: 120 });

/** Plays the whole queue out in small steps. */
function drain(run) {
  for (let i = 0; i < 100000 && run.queue > 0; i += 1) step(run, 0.05);
}

const accounted = (run) => run.moved + run.queue + run.pouch + run.spilled;

test('the racer does not move without passages', () => {
  const run = newRun();
  assert.equal(step(run, 10), 0);
  assert.equal(run.track, 0);
});

test('one passage is one pace', () => {
  const run = newRun();
  addPassages(run, 7, 1);
  drain(run);
  assert.ok(Math.abs(run.track - 7) < 1e-6);
  assert.ok(Math.abs(run.moved - 7) < 1e-6);
});

test('a batch plays out over time instead of jumping', () => {
  const run = newRun();
  addPassages(run, 16, 1);
  step(run, 1);
  assert.ok(run.track > 0 && run.track < 4, `track was ${run.track}`);
});

test('non-positive passage counts are ignored', () => {
  const run = newRun();
  addPassages(run, 0, 1);
  addPassages(run, -5, 1);
  assert.equal(run.received, 0);
  assert.equal(run.log.length, 0);
});

test('the racer stops at the line and later passages spill', () => {
  const run = newRun('pip');
  addPassages(run, LEG_PACES + 5, 1);
  drain(run);
  assert.ok(atLine(run));
  assert.ok(Math.abs(run.track - LEG_PACES) < 1e-6);
  assert.ok(Math.abs(run.spilled - 5) < 1e-6);
});

test("Mochi's cheeks save passages at the line and release them after the pass", () => {
  const run = newRun('mochi');
  addPassages(run, LEG_PACES + 15, 1);
  drain(run);
  assert.ok(Math.abs(run.pouch - 12) < 1e-6);
  assert.ok(Math.abs(run.spilled - 3) < 1e-6);
  assert.equal(passBaton(run, 10), 'late');
  assert.equal(run.pouch, 0);
  drain(run);
  assert.ok(Math.abs(run.track - (LEG_PACES + 12)) < 1e-6);
});

test('a clean pass scores the racer points and keeps the position', () => {
  const run = newRun('bramble');
  addPassages(run, LEG_PACES - 3, 1);
  drain(run);
  assert.ok(inZone(run));
  const before = run.track;
  assert.equal(passBaton(run, 5), 'clean');
  assert.equal(run.track, before);
  assert.equal(run.points, 5);
  assert.equal(run.nextLine, LEG_PACES * 2);
  assert.equal(legs(run), 1);
});

test('a late pass scores late points and frees the racer', () => {
  const run = newRun();
  addPassages(run, LEG_PACES, 1);
  drain(run);
  assert.equal(passBaton(run, 5), 'late');
  assert.equal(run.points, LATE_POINTS);
  addPassages(run, 3, 6);
  drain(run);
  assert.ok(Math.abs(run.track - (LEG_PACES + 3)) < 1e-6);
});

test('an early press locks the baton, then it unlocks', () => {
  const run = newRun();
  assert.equal(passBaton(run, 1), 'early');
  assert.equal(run.early, 1);
  assert.equal(passBaton(run, 1 + LOCK_SECONDS - 0.1), 'locked');
  assert.equal(run.early, 1);
  assert.equal(passBaton(run, 1 + LOCK_SECONDS), 'early');
  assert.equal(run.early, 2);
});

test('a pass cannot be repeated for the same line', () => {
  const run = newRun();
  addPassages(run, LEG_PACES - 1, 1);
  drain(run);
  assert.equal(passBaton(run, 5), 'clean');
  assert.equal(passBaton(run, 5.1), 'early');
  assert.equal(legs(run), 1);
});

test('every passage is accounted for at all times', () => {
  const run = newRun('mochi');
  const script = [[9, 1], [14, 11], [30, 21], [6, 31]];
  for (const [count, at] of script) {
    addPassages(run, count, at);
    for (let i = 0; i < 40; i += 1) {
      step(run, 0.1);
      assert.ok(Math.abs(accounted(run) - run.received) < 1e-6);
    }
    if (inZone(run)) passBaton(run, at + 5);
    assert.ok(Math.abs(accounted(run) - run.received) < 1e-6);
  }
});

test('finish leaves whole numbers that add up to what was received', () => {
  const run = newRun('mochi');
  addPassages(run, 33, 1);
  step(run, 1.3);
  finish(run);
  assert.equal(run.queue, 0);
  assert.equal(run.pouch, 0);
  assert.ok(Number.isInteger(run.moved));
  assert.equal(run.moved + run.spilled, 33);
  assert.equal(run.track, run.moved);
});

test('score is passages used plus baton points', () => {
  const run = newRun('pip');
  addPassages(run, 18, 1);
  drain(run);
  passBaton(run, 3);
  finish(run);
  assert.equal(score(run), 18 + 12);
});

test('a run with no passages scores zero', () => {
  const run = newRun();
  finish(run);
  assert.equal(score(run), 0);
  assert.equal(run.spilled, 0);
});

test('activity is bucketed across the run and clamped to its ends', () => {
  const buckets = bucketLog([{ t: 0, n: 2 }, { t: 59, n: 3 }, { t: 60, n: 4 }, { t: 999, n: 1 }], 60, 6);
  assert.deepEqual(buckets, [2, 0, 0, 0, 0, 8]);
});

test('busiest reports the fullest slice, or null when nothing moved', () => {
  assert.deepEqual(busiest([0, 5, 2, 0], 120), { count: 5, atSeconds: 30 });
  assert.equal(busiest([0, 0], 120), null);
});
