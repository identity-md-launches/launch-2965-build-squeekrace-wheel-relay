// @ts-check
// Pure game rules. No DOM, no clock, no network, so every rule can be tested in Node.
//
// The rule that matters most: `track` only ever grows by passages taken from `queue`.
// Baton timing changes the score and how many passages are lost, never the position.

/** @typedef {import('./racers.js').Racer} Racer */

/**
 * @typedef {object} Run
 * @property {'live'|'practice'} mode
 * @property {Racer} racer
 * @property {number} seconds
 * @property {number} track Paces travelled. One accepted passage is one pace.
 * @property {number} queue Passages received and waiting to play out.
 * @property {number} pouch Passages saved at the line by the racer's cheeks.
 * @property {number} received Every passage handed to this run.
 * @property {number} moved Passages turned into movement.
 * @property {number} spilled Passages lost at the line or unused at the finish.
 * @property {number} nextLine Track position of the next exchange line.
 * @property {number} clean Passes made inside the gold zone.
 * @property {number} late Passes made after the racer stopped at the line.
 * @property {number} early Presses before the gold zone.
 * @property {number} points Baton points.
 * @property {number} lockedUntil Run time in seconds when the baton can be pressed again.
 * @property {{t:number,n:number}[]} log Passages by run time in seconds.
 */

export const LEG_PACES = 20;
export const LEGS_PER_LAP = 4;
export const LAP_PACES = LEG_PACES * LEGS_PER_LAP;
export const RUN_SECONDS = [60, 120, 300];
export const LATE_POINTS = 2;
export const LOCK_SECONDS = 2;
export const BUCKETS = 12;

const MIN_RATE = 1;
const PLAYOUT_SECONDS = 8;
const SETTLE_MIN_RATE = 4;
const SETTLE_SECONDS = 2;
const EPSILON = 1e-9;

/**
 * @param {{mode:'live'|'practice', racer:Racer, seconds:number}} options
 * @returns {Run}
 */
export function createRun({ mode, racer, seconds }) {
  return {
    mode,
    racer,
    seconds,
    track: 0,
    queue: 0,
    pouch: 0,
    received: 0,
    moved: 0,
    spilled: 0,
    nextLine: LEG_PACES,
    clean: 0,
    late: 0,
    early: 0,
    points: 0,
    lockedUntil: 0,
    log: [],
  };
}

/**
 * Hands real (or, in practice, simulated) passages to the run.
 * @param {Run} run
 * @param {number} count
 * @param {number} atSeconds Run time when the reading arrived.
 */
export function addPassages(run, count, atSeconds) {
  if (!(count > 0)) return;
  run.received += count;
  run.queue += count;
  run.log.push({ t: atSeconds, n: count });
}

/**
 * Plays queued passages out as movement. Readings arrive in batches about ten seconds
 * apart, so a batch is spread over the following seconds instead of landing as a jump.
 * @param {Run} run
 * @param {number} dt Seconds since the last step.
 * @param {boolean} [settling] True after the clock ends, to drain the queue faster.
 * @returns {number} Paces moved in this step.
 */
export function step(run, dt, settling = false) {
  if (run.queue <= 0 || dt <= 0) return 0;
  const rate = settling
    ? Math.max(SETTLE_MIN_RATE, run.queue / SETTLE_SECONDS)
    : Math.max(MIN_RATE, run.queue / PLAYOUT_SECONDS);
  const out = Math.min(run.queue, rate * dt);
  run.queue -= out;
  if (run.queue < EPSILON) run.queue = 0;

  const room = Math.max(0, run.nextLine - run.track);
  const used = Math.min(out, room);
  run.track += used;
  run.moved += used;

  const over = out - used;
  if (over > 0) {
    const saved = Math.min(over, Math.max(0, run.racer.pouch - run.pouch));
    run.pouch += saved;
    run.spilled += over - saved;
  }
  return used;
}

/** @param {Run} run */
export function atLine(run) {
  return run.track >= run.nextLine - EPSILON;
}

/** @param {Run} run */
export function inZone(run) {
  return run.track >= run.nextLine - run.racer.zone - EPSILON;
}

/**
 * @param {Run} run
 * @param {number} nowSeconds Run time of the press.
 * @returns {'locked'|'early'|'clean'|'late'}
 */
export function passBaton(run, nowSeconds) {
  if (nowSeconds < run.lockedUntil) return 'locked';
  if (!inZone(run)) {
    run.early += 1;
    run.lockedUntil = nowSeconds + LOCK_SECONDS;
    return 'early';
  }
  const late = atLine(run);
  if (late) {
    run.late += 1;
    run.points += LATE_POINTS;
  } else {
    run.clean += 1;
    run.points += run.racer.cleanPoints;
  }
  run.nextLine += LEG_PACES;
  run.queue += run.pouch;
  run.pouch = 0;
  return late ? 'late' : 'clean';
}

/** @param {Run} run */
export function legs(run) {
  return run.clean + run.late;
}

/** @param {Run} run */
export function score(run) {
  return Math.floor(run.moved + EPSILON) + run.points;
}

/**
 * Closes the books: anything not played out is spilled, so the totals always add up.
 * @param {Run} run
 */
export function finish(run) {
  run.moved = Math.floor(run.moved + EPSILON);
  run.track = run.moved;
  run.queue = 0;
  run.pouch = 0;
  run.spilled = run.received - run.moved;
}

/**
 * @param {{t:number,n:number}[]} log
 * @param {number} seconds
 * @param {number} [count]
 * @returns {number[]} Passages per equal slice of the run.
 */
export function bucketLog(log, seconds, count = BUCKETS) {
  const buckets = new Array(count).fill(0);
  const size = seconds / count;
  for (const entry of log) {
    const index = Math.min(count - 1, Math.max(0, Math.floor(entry.t / size)));
    buckets[index] += entry.n;
  }
  return buckets;
}

/**
 * @param {number[]} buckets
 * @param {number} seconds
 * @returns {{count:number, atSeconds:number}|null} The busiest slice, or null when nothing moved.
 */
export function busiest(buckets, seconds) {
  let best = -1;
  let bestCount = 0;
  buckets.forEach((value, index) => {
    if (value > bestCount) {
      bestCount = value;
      best = index;
    }
  });
  if (best < 0) return null;
  return { count: bestCount, atSeconds: Math.round((best * seconds) / buckets.length) };
}
