// @ts-check
// Connects the rules (engine.js) and the feed (feed.js) to the page.

import {
  LAP_PACES,
  LATE_POINTS,
  LEG_PACES,
  LEGS_PER_LAP,
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
} from './engine.js';
import { LiveFeed, fetchStats, nextActiveAt } from './feed.js';
import { RACERS, racerArt, racerById } from './racers.js';

/** @typedef {import('./engine.js').Run} Run */
/** @typedef {import('./feed.js').Snapshot} Snapshot */
/** @typedef {import('./feed.js').WheelStats} WheelStats */
/** @typedef {import('./racers.js').Racer} Racer */
/** @typedef {'setup'|'countdown'|'racing'|'settling'|'result'} Phase */

/**
 * @typedef {object} Session
 * @property {Run} run
 * @property {number} countdownEndsAt
 * @property {number} startedAt
 * @property {number} endsAt
 * @property {number} settleDeadline
 * @property {number|null} finalSeenAt
 * @property {number} lastStepAt
 * @property {number} lastMovedAt
 * @property {{running:number, resting:number, stale:number}} stateMs
 * @property {string|null} firstCount
 * @property {string|null} lastCount
 * @property {number} peakRpmMilli
 * @property {boolean} gap
 * @property {number} nextPracticeAt
 * @property {boolean} practiceResting
 */

/**
 * @typedef {object} SavedResult
 * @property {string} at
 * @property {string} racerName
 * @property {number} seconds
 * @property {number} score
 * @property {number} passages
 * @property {number} legs
 */

const STORE_KEY = 'squeekrace.wheelRelay.liveResults.v1';
const MAX_SAVED = 8;
const COUNTDOWN_MS = 3000;
const SETTLE_TIMEOUT_MS = 14000;
const SETTLE_PLAYOUT_MS = 3000;
const PRACTICE_READING_MS = 2500;
const WATCH_MS = 500;
const MOVING_CLASS_MS = 300;
/** Matches the rim's `r` in index.html. Dashes use real lengths so no browser needs pathLength. */
const RIM_RADIUS = 146;
const PACE_LENGTH = (2 * Math.PI * RIM_RADIUS) / LAP_PACES;

const numberFormat = new Intl.NumberFormat();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * @param {string} id
 * @returns {any} Every id in this file exists in index.html. A missing one should fail loudly.
 */
function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element;
}

const ui = {
  setup: /** @type {HTMLFormElement} */ (byId('setup')),
  race: /** @type {HTMLElement} */ (byId('race')),
  result: /** @type {HTMLElement} */ (byId('result')),
  banner: /** @type {HTMLElement} */ (byId('practice-banner')),
  racerGrid: /** @type {HTMLElement} */ (byId('racer-grid')),
  racerTrait: /** @type {HTMLElement} */ (byId('racer-trait')),
  startLive: /** @type {HTMLButtonElement} */ (byId('start-live')),
  startPractice: /** @type {HTMLButtonElement} */ (byId('start-practice')),
  pass: /** @type {HTMLButtonElement} */ (byId('pass')),
  stop: /** @type {HTMLButtonElement} */ (byId('stop')),
  replay: /** @type {HTMLButtonElement} */ (byId('replay')),
  change: /** @type {HTMLButtonElement} */ (byId('change')),
  feed: /** @type {HTMLElement} */ (byId('feed')),
  feedTitle: /** @type {HTMLElement} */ (byId('feed-title')),
  feedDetail: /** @type {HTMLElement} */ (byId('feed-detail')),
  hubValue: /** @type {HTMLElement} */ (byId('hub-value')),
  hubLabel: /** @type {HTMLElement} */ (byId('hub-label')),
  hudTime: /** @type {HTMLElement} */ (byId('hud-time')),
  hudPassages: /** @type {HTMLElement} */ (byId('hud-passages')),
  hudLegs: /** @type {HTMLElement} */ (byId('hud-legs')),
  hudScore: /** @type {HTMLElement} */ (byId('hud-score')),
  hint: /** @type {HTMLElement} */ (byId('race-hint')),
  resultTitle: /** @type {HTMLElement} */ (byId('result-title')),
  resultLine: /** @type {HTMLElement} */ (byId('result-line')),
  resultStats: /** @type {HTMLElement} */ (byId('result-stats')),
  resultBars: /** @type {HTMLElement} */ (byId('result-bars')),
  recapList: /** @type {HTMLElement} */ (byId('recap-list')),
  recapSource: /** @type {HTMLElement} */ (byId('recap-source')),
  history: /** @type {HTMLElement} */ (byId('history')),
  historyEmpty: /** @type {HTMLElement} */ (byId('history-empty')),
  help: /** @type {HTMLDialogElement} */ (byId('help')),
  helpOpen: /** @type {HTMLButtonElement} */ (byId('help-open')),
  announcer: /** @type {HTMLElement} */ (byId('announcer')),
  spokes: /** @type {SVGGElement} */ (byId('spokes')),
  progress: /** @type {SVGCircleElement} */ (byId('progress')),
  racerOnRim: /** @type {SVGGElement} */ (byId('racer-on-rim')),
  racerArt: /** @type {SVGSVGElement} */ (byId('racer-art')),
  zones: /** @type {SVGCircleElement[]} */ ([byId('zone-0'), byId('zone-1'), byId('zone-2'), byId('zone-3')]),
};

/** @type {Phase} */
let phase = 'setup';
let selectedRacer = RACERS[0];
let selectedSeconds = 120;
/** @type {'live'|'practice'} */
let lastMode = 'live';
/** @type {Session|null} */
let session = null;
/** @type {WheelStats|null} */
let stats = null;
let frameRequested = false;
/** @type {string} */
let announcedFeed = '';

const feed = new LiveFeed({ onReading: handleReading });

/**
 * Writes text only when it changed, so per-frame updates stay cheap.
 * @param {HTMLElement} element
 * @param {string} text
 */
function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

/** @param {string} message */
function announce(message) {
  setText(ui.announcer, message);
}

/**
 * @param {number} count
 * @param {string} one
 * @param {string} many
 * @returns {string}
 */
function plural(count, one, many) {
  return count === 1 ? one : many;
}

/** @param {number} seconds */
function formatClock(seconds) {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** @param {number} ms */
function formatTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** @returns {SavedResult[]} */
function loadResults() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** @param {SavedResult[]} results */
function saveResults(results) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(results));
  } catch {
    // Private windows can refuse storage. The result is still on screen.
  }
}

function renderHistory() {
  const results = loadResults();
  ui.history.replaceChildren(
    ...results.map((result) => {
      const row = document.createElement('li');
      row.className = 'history-row';
      const main = document.createElement('span');
      main.className = 'history-score';
      main.textContent = `${numberFormat.format(result.score)} points, ${result.racerName}`;
      const meta = document.createElement('span');
      meta.className = 'history-meta';
      const when = new Date(result.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
      const passages = plural(result.passages, 'passage', 'passages');
      meta.textContent = `${numberFormat.format(result.passages)} ${passages} in ${formatClock(result.seconds)}, ${when}`;
      row.append(main, meta);
      return row;
    }),
  );
  ui.history.hidden = results.length === 0;
  ui.historyEmpty.hidden = results.length > 0;
}

/** @param {Racer} racer */
function paintRacer(racer) {
  ui.racerArt.innerHTML = racerArt(racer);
  ui.zones.forEach((zone, index) => {
    const start = (index + 1) * LEG_PACES - racer.zone;
    const dash = (racer.zone * PACE_LENGTH).toFixed(2);
    const gap = ((LAP_PACES - racer.zone) * PACE_LENGTH).toFixed(2);
    zone.setAttribute('stroke-dasharray', `${dash} ${gap}`);
    zone.setAttribute('stroke-dashoffset', ((LAP_PACES - start) * PACE_LENGTH).toFixed(2));
  });
  setText(ui.racerTrait, racer.trait);
}

function renderRacerChoices() {
  for (const racer of RACERS) {
    const label = document.createElement('label');
    label.className = 'racer-card';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'racer';
    input.value = racer.id;
    input.checked = racer.id === selectedRacer.id;
    const face = document.createElement('span');
    face.className = 'racer-face';
    face.innerHTML = `<svg viewBox="0 0 64 48" aria-hidden="true">${racerArt(racer)}</svg>`;
    const name = document.createElement('span');
    name.textContent = racer.name;
    face.append(name);
    label.append(input, face);
    ui.racerGrid.append(label);
  }
}

/** @param {number} track */
function paintTrack(track) {
  const lapPosition = track % LAP_PACES;
  const angle = (lapPosition / LAP_PACES) * 360;
  ui.racerOnRim.setAttribute('transform', `rotate(${angle.toFixed(2)} 200 200)`);
  const filled = (lapPosition * PACE_LENGTH).toFixed(2);
  ui.progress.setAttribute('stroke-dasharray', `${filled} ${(LAP_PACES * PACE_LENGTH).toFixed(2)}`);
  if (!reducedMotion.matches) {
    ui.spokes.setAttribute('transform', `rotate(${(track * 6).toFixed(2)} 200 200)`);
  }
}

/** @param {number|null} nextIndex Which exchange zone is next, or null for none. */
function paintNextZone(nextIndex) {
  ui.zones.forEach((zone, index) => zone.classList.toggle('is-next', index === nextIndex));
}

/** @returns {boolean} True while a run is on screen, from the countdown to the last passage. */
function inRun() {
  return phase === 'countdown' || phase === 'racing' || phase === 'settling';
}

/** @param {Phase} next */
function setPhase(next) {
  phase = next;
  document.body.dataset.phase = next;
  document.body.dataset.mode = session?.run.mode ?? 'live';
  const racing = inRun();
  ui.setup.hidden = next !== 'setup';
  ui.race.hidden = !racing;
  ui.result.hidden = next !== 'result';
  ui.banner.hidden = session?.run.mode !== 'practice';
}

/** @param {Snapshot} snapshot */
function feedCopy(snapshot) {
  const reading = snapshot.reading;
  switch (snapshot.state) {
    case 'connecting':
      return { title: 'Checking the wheel…', detail: 'Reading the Squeekchain public API.', hub: 'Checking' };
    case 'running': {
      const rpm = Math.round((reading?.rpmMilli ?? 0) / 1000);
      const total = numberFormat.format(Number(reading?.cumulative ?? 0n));
      const pace = rpm > 0 ? `${rpm} rpm. ` : '';
      return { title: 'Wheel running', detail: `${pace}${total} accepted passages so far.`, hub: 'Running' };
    }
    case 'resting':
      return { title: 'Wheel resting', detail: restingDetail(), hub: 'Resting' };
    default:
      return { title: 'Feed stale', detail: staleDetail(snapshot), hub: 'Stale' };
  }
}

function restingDetail() {
  const wake = stats ? nextActiveAt(stats.typicalDay, Date.now()) : null;
  if (wake === null) return 'No passages right now. A live racer waits until the wheel turns.';
  if (wake - Date.now() < 60000) return 'No passages right now, though this is usually a busy time.';
  return `No passages right now. Usually busy again around ${formatTime(wake)}.`;
}

/** @param {Snapshot} snapshot */
function staleDetail(snapshot) {
  const next = inRun()
    ? 'Passages count once readings return.'
    : 'Live runs start after a fresh reading. Practice still works.';
  switch (snapshot.reason) {
    case 'api':
    case 'lag':
      return `The wheel has not reported recently. ${next}`;
    case 'rate':
      return `The API asked for a pause. Retrying. ${next}`;
    case 'schema':
    case 'malformed':
      return `The API answered in an unexpected format. ${next}`;
    case 'unavailable':
      return `The API has no measurement to share yet. ${next}`;
    default:
      if (snapshot.reading) return `Last reading ${snapshot.ageSeconds} s ago. Retrying. ${next}`;
      return `Unable to reach the Squeekchain API. Retrying. ${next}`;
  }
}

function renderFeed() {
  if (session?.run.mode === 'practice') {
    ui.feed.dataset.state = 'practice';
    setText(ui.feedTitle, session.practiceResting ? 'Practice wheel resting' : 'Practice wheel running');
    setText(ui.feedDetail, 'Simulated passages from this browser.');
    return;
  }
  const snapshot = feed.snapshot();
  const copy = feedCopy(snapshot);
  ui.feed.dataset.state = snapshot.state;
  setText(ui.feedTitle, copy.title);
  setText(ui.feedDetail, copy.detail);
  ui.startLive.disabled = !(snapshot.state === 'running' || snapshot.state === 'resting');

  if (phase === 'setup' || phase === 'result') {
    ui.hubValue.dataset.kind = 'word';
    setText(ui.hubValue, copy.hub);
    setText(ui.hubLabel, 'live wheel');
  }
  if (copy.title !== announcedFeed) {
    if (announcedFeed !== '') announce(`${copy.title}. ${copy.detail}`);
    announcedFeed = copy.title;
  }
}

/**
 * @param {import('./feed.js').Reading} reading
 * @param {number} delta
 * @param {boolean} discontinuity
 */
function handleReading(reading, delta, discontinuity) {
  const current = session;
  if (current && current.run.mode === 'live') {
    const now = performance.now();
    const counting = phase === 'racing' || (phase === 'settling' && current.finalSeenAt === null);
    if (counting) {
      addPassages(current.run, delta, Math.min(current.run.seconds, (now - current.startedAt) / 1000));
      current.lastCount = reading.cumulative.toString();
      current.peakRpmMilli = Math.max(current.peakRpmMilli, reading.rpmMilli);
      if (discontinuity) current.gap = true;
      if (phase === 'settling') current.finalSeenAt = now;
    }
  }
  renderFeed();
}

/**
 * Starts a run, unless a live run has no fresh reading to count from.
 * @param {'live'|'practice'} mode
 */
function beginRun(mode) {
  lastMode = mode;
  const snapshot = feed.snapshot();
  if (mode === 'live' && !(snapshot.state === 'running' || snapshot.state === 'resting')) {
    session = null;
    setPhase('setup');
    renderFeed();
    announce('Live runs start after a fresh reading.');
    ui.startPractice.focus();
    return;
  }
  const now = performance.now();
  session = {
    run: createRun({ mode, racer: selectedRacer, seconds: selectedSeconds }),
    countdownEndsAt: now + COUNTDOWN_MS,
    startedAt: 0,
    endsAt: 0,
    settleDeadline: 0,
    finalSeenAt: null,
    lastStepAt: now,
    lastMovedAt: 0,
    stateMs: { running: 0, resting: 0, stale: 0 },
    firstCount: null,
    lastCount: null,
    peakRpmMilli: 0,
    gap: false,
    nextPracticeAt: 0,
    practiceResting: false,
  };
  setPhase('countdown');
  paintRacer(selectedRacer);
  paintTrack(0);
  paintNextZone(0);
  setText(ui.hudTime, formatClock(selectedSeconds));
  setText(ui.hudPassages, '0');
  setText(ui.hudLegs, '0');
  setText(ui.hudScore, '0');
  ui.pass.focus();
  renderFeed();
  requestFrame();
}

/**
 * @param {Session} current
 * @param {number} now
 */
function practiceReading(current, now) {
  const resting = Math.random() < 0.15;
  current.practiceResting = resting;
  if (!resting) {
    const count = 3 + Math.floor(Math.random() * 3);
    addPassages(current.run, count, (now - current.startedAt) / 1000);
  }
  current.nextPracticeAt = now + PRACTICE_READING_MS;
}

/**
 * Adds elapsed time to the wheel state that was showing. The live recap reports these totals.
 * @param {Session} current
 * @param {number} ms
 */
function accountState(current, ms) {
  if (current.run.mode === 'practice') {
    current.stateMs[current.practiceResting ? 'resting' : 'running'] += ms;
    return;
  }
  const state = feed.snapshot().state;
  if (state === 'running') current.stateMs.running += ms;
  else if (state === 'resting') current.stateMs.resting += ms;
  else current.stateMs.stale += ms;
}

/**
 * Runs the rules. Called by animation frames, and by a slower timer so a run in a
 * background tab still ends on time even though frames stop there.
 */
function update() {
  const current = session;
  if (!current) return;
  const now = performance.now();
  const elapsedMs = now - current.lastStepAt;
  current.lastStepAt = now;

  if (phase === 'countdown') {
    if (now < current.countdownEndsAt) return;
    current.startedAt = now;
    current.endsAt = now + current.run.seconds * 1000;
    current.nextPracticeAt = now + 800;
    current.firstCount = feed.snapshot().reading?.cumulative.toString() ?? null;
    current.lastCount = current.firstCount;
    phase = 'racing';
    document.body.dataset.phase = 'racing';
    announce('Run started.');
    return;
  }

  if (phase === 'racing') {
    accountState(current, elapsedMs);
    if (current.run.mode === 'practice' && now >= current.nextPracticeAt) practiceReading(current, now);
    const moved = step(current.run, Math.min(elapsedMs / 1000, 1));
    if (moved > 0) current.lastMovedAt = now;
    if (now >= current.endsAt) {
      phase = 'settling';
      document.body.dataset.phase = 'settling';
      current.settleDeadline = now + SETTLE_TIMEOUT_MS;
      // Nothing is on its way from a resting wheel, and idle readings can be up to 30 s apart.
      const nothingInFlight = current.run.mode === 'practice' || feed.snapshot().state === 'resting';
      if (nothingInFlight) current.finalSeenAt = now;
      announce('Time. Collecting the last passages.');
    }
    return;
  }

  if (phase === 'settling') {
    const moved = step(current.run, Math.min(elapsedMs / 1000, 1), true);
    if (moved > 0) current.lastMovedAt = now;
    const finalSeen = current.finalSeenAt;
    const drained = finalSeen !== null && (current.run.queue <= 0 || now - finalSeen > SETTLE_PLAYOUT_MS);
    if (drained || now >= current.settleDeadline) endRun(false);
  }
}

/** @param {Session} current */
function renderRace(current) {
  const run = current.run;
  const now = performance.now();
  const runSeconds = phase === 'countdown' ? 0 : (now - current.startedAt) / 1000;

  paintTrack(run.track);
  paintNextZone(Math.round(run.nextLine / LEG_PACES - 1) % LEGS_PER_LAP);
  ui.racerOnRim.classList.toggle('is-moving', now - current.lastMovedAt < MOVING_CLASS_MS);

  setText(ui.hudPassages, numberFormat.format(run.received));
  setText(ui.hudLegs, String(legs(run)));
  setText(ui.hudScore, numberFormat.format(score(run)));

  if (phase === 'countdown') {
    ui.hubValue.dataset.kind = 'number';
    setText(ui.hubValue, String(Math.max(1, Math.ceil((current.countdownEndsAt - now) / 1000))));
    setText(ui.hubLabel, 'get ready');
    setText(ui.hudTime, formatClock(run.seconds));
  } else {
    ui.hubValue.dataset.kind = 'number';
    setText(ui.hubValue, numberFormat.format(run.received));
    setText(ui.hubLabel, plural(run.received, 'passage', 'passages'));
    setText(ui.hudTime, formatClock(run.seconds - runSeconds));
  }

  const locked = runSeconds < run.lockedUntil;
  const blocked = atLine(run);
  const zone = inZone(run);
  ui.pass.setAttribute('aria-disabled', String(locked || phase === 'countdown'));
  ui.pass.dataset.ready = blocked ? 'line' : zone ? 'zone' : 'no';

  if (locked) {
    setText(ui.pass, `Baton back in ${Math.ceil(run.lockedUntil - runSeconds)} s`);
  } else if (blocked) {
    setText(ui.pass, 'Pass baton, racer waiting');
  } else if (zone) {
    setText(ui.pass, 'Pass baton now');
  } else {
    setText(ui.pass, 'Pass baton');
  }
  setText(ui.hint, raceHint(current, { locked, blocked, zone }));
}

/**
 * @param {Session} current
 * @param {{locked:boolean, blocked:boolean, zone:boolean}} flags
 */
function raceHint(current, { locked, blocked, zone }) {
  if (phase === 'countdown') return 'Pass the baton when your racer reaches the gold zone.';
  if (phase === 'settling') return 'Time. Collecting the last passages.';
  if (locked) return 'Too early. The gold zone is further round the rim.';
  if (blocked) return 'Your racer stopped at the line. Passages are being lost until you pass.';
  if (zone) return 'In the gold zone. Pass the baton.';
  if (current.run.mode === 'practice') {
    return current.practiceResting
      ? 'The practice wheel paused. Your racer waits with it.'
      : 'Pass the baton when your racer reaches the gold zone.';
  }
  const state = feed.snapshot().state;
  if (state === 'resting') return 'The wheel is resting, so your racer waits for real passages.';
  if (state === 'running') return 'Pass the baton when your racer reaches the gold zone.';
  return 'Feed stale. Your racer waits, and passages count once readings return.';
}

function onPass() {
  const current = session;
  if (!current || (phase !== 'racing' && phase !== 'settling')) return;
  const runSeconds = (performance.now() - current.startedAt) / 1000;
  const outcome = passBaton(current.run, runSeconds);
  if (outcome === 'clean') announce(`Clean pass. ${current.run.racer.cleanPoints} points.`);
  else if (outcome === 'late') announce(`Late pass. ${LATE_POINTS} points.`);
  else if (outcome === 'early') announce(`Too early. Baton locked for ${LOCK_SECONDS} seconds.`);
}

/**
 * @param {Session} current
 * @param {number} legCount
 * @param {boolean} stopped
 * @param {boolean} isBest
 */
function resultCopy(current, legCount, stopped, isBest) {
  const run = current.run;
  const points = numberFormat.format(score(run));
  const passages = numberFormat.format(run.received);
  const legWord = plural(legCount, 'leg', 'legs');
  if (run.mode === 'practice') {
    return {
      title: stopped ? 'Practice stopped' : `Practice finished: ${legCount} ${legWord}`,
      line: 'Simulated passages. This result is not live and is not saved.',
    };
  }
  if (stopped) return { title: 'Run stopped', line: 'Stopped runs are not saved. Here is what the wheel did.' };
  if (run.received === 0) {
    return {
      title: 'The wheel rested all run',
      line: 'No accepted passages arrived, so your racer stayed at the start. This run is still saved as live.',
    };
  }
  const word = plural(run.received, 'accepted passage', 'accepted passages');
  return {
    title: `${run.racer.name} finished ${legCount} ${legWord}`,
    line: isBest
      ? `New best in this browser: ${points} points from ${passages} ${word}.`
      : `${points} points from ${passages} ${word}.`,
  };
}

/**
 * @param {string} term
 * @param {string} value
 */
function statRow(term, value) {
  const wrapper = document.createElement('div');
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value;
  wrapper.append(dt, dd);
  return wrapper;
}

/**
 * @param {Session} current
 * @param {boolean} stopped
 */
function recapLines(current, stopped) {
  const run = current.run;
  const buckets = bucketLog(run.log, run.seconds);
  const peak = busiest(buckets, run.seconds);
  const seconds = (/** @type {number} */ ms) => Math.round(ms / 1000);
  const lines = [];

  if (run.mode === 'live') {
    const { running, resting, stale } = current.stateMs;
    lines.push(`Wheel running ${seconds(running)} s, resting ${seconds(resting)} s, feed stale ${seconds(stale)} s.`);
    if (current.firstCount !== null && current.lastCount !== null) {
      const from = numberFormat.format(Number(current.firstCount));
      const to = numberFormat.format(Number(current.lastCount));
      lines.push(`Accepted passage counter went from ${from} to ${to}.`);
    }
    if (current.peakRpmMilli > 0) lines.push(`Top wheel speed: ${Math.round(current.peakRpmMilli / 1000)} rpm.`);
    if (stats?.mmPerPassage && run.received > 0) {
      const metres = (run.received * stats.mmPerPassage) / 1000;
      lines.push(`About ${numberFormat.format(Math.round(metres))} m of estimated wheel travel.`);
    }
  } else {
    lines.push('Every passage in this run came from the practice wheel in this browser.');
  }

  if (peak) {
    const word = plural(peak.count, 'passage', 'passages');
    lines.push(`Busiest moment: ${peak.count} ${word} around ${formatClock(peak.atSeconds)}.`);
  }
  if (run.mode === 'live' && !stopped && current.finalSeenAt === null) {
    lines.push('The finish reading did not arrive in time, so the count ends at the last reading.');
  }
  if (current.gap) lines.push('The device counter restarted during this run. Passages across that gap are not counted.');
  return { lines, buckets };
}

/** @param {boolean} stopped */
function endRun(stopped) {
  const current = session;
  if (!current) return;
  const run = current.run;
  finish(run);

  const legCount = legs(run);
  const saved = loadResults();
  const best = saved.reduce((top, result) => Math.max(top, result.score), 0);
  const isBest = run.mode === 'live' && !stopped && saved.length > 0 && score(run) > best;
  const copy = resultCopy(current, legCount, stopped, isBest);

  setText(ui.resultTitle, copy.title);
  setText(ui.resultLine, copy.line);
  ui.resultStats.replaceChildren(
    statRow('Score', numberFormat.format(score(run))),
    statRow(run.mode === 'live' ? 'Accepted passages' : 'Simulated passages', numberFormat.format(run.received)),
    statRow('Passages used', numberFormat.format(run.moved)),
    statRow('Passages lost', numberFormat.format(run.spilled)),
    statRow('Clean passes', String(run.clean)),
    statRow('Late passes', String(run.late)),
  );

  const { lines, buckets } = recapLines(current, stopped);
  ui.recapList.replaceChildren(
    ...lines.map((line) => {
      const item = document.createElement('li');
      item.textContent = line;
      return item;
    }),
  );
  const tallest = Math.max(1, ...buckets);
  ui.resultBars.replaceChildren(
    ...buckets.map((count) => {
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.dataset.empty = String(count === 0);
      bar.style.blockSize = `${Math.round((count / tallest) * 100)}%`;
      return bar;
    }),
  );
  const total = numberFormat.format(run.received);
  ui.resultBars.setAttribute('aria-label', `Bar chart of ${total} passages across the run, from start to finish.`);
  ui.recapSource.hidden = run.mode !== 'live';
  setText(ui.replay, `Replay with ${run.racer.name}`);

  if (run.mode === 'live' && !stopped) {
    saved.unshift({
      at: new Date().toISOString(),
      racerName: run.racer.name,
      seconds: run.seconds,
      score: score(run),
      passages: run.received,
      legs: legCount,
    });
    saveResults(saved.slice(0, MAX_SAVED));
    renderHistory();
  }

  ui.racerOnRim.classList.remove('is-moving');
  paintTrack(run.track);
  paintNextZone(null);
  ui.pass.removeAttribute('aria-disabled');
  setPhase('result');
  ui.hubValue.dataset.kind = 'number';
  setText(ui.hubValue, numberFormat.format(run.received));
  setText(ui.hubLabel, plural(run.received, 'passage', 'passages'));
  // The run is over, so the feed line goes back to the real wheel. The mode stays on the
  // page so a practice recap keeps its label until the player leaves it.
  session = run.mode === 'practice' ? current : null;
  if (run.mode === 'live') renderFeed();
  ui.resultTitle.focus();
  announce(`${copy.title}. ${copy.line}`);
}

function backToSetup() {
  session = null;
  setPhase('setup');
  paintRacer(selectedRacer);
  paintTrack(0);
  paintNextZone(null);
  renderFeed();
  if (ui.startLive.disabled) ui.startPractice.focus();
  else ui.startLive.focus();
}

function requestFrame() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    if (!inRun()) return;
    update();
    if (session && inRun()) {
      renderRace(session);
      requestFrame();
    }
  });
}

function bindEvents() {
  ui.setup.addEventListener('submit', (event) => {
    event.preventDefault();
    beginRun('live');
  });
  ui.setup.addEventListener('change', (event) => {
    const target = /** @type {HTMLInputElement} */ (event.target);
    if (target.name === 'racer') {
      selectedRacer = racerById(target.value);
      paintRacer(selectedRacer);
    } else if (target.name === 'seconds') {
      selectedSeconds = Number(target.value);
    }
  });
  ui.startPractice.addEventListener('click', () => beginRun('practice'));
  ui.pass.addEventListener('click', onPass);
  ui.stop.addEventListener('click', () => {
    if (phase === 'countdown') backToSetup();
    else endRun(true);
  });
  ui.replay.addEventListener('click', () => beginRun(lastMode));
  ui.change.addEventListener('click', backToSetup);
  ui.helpOpen.addEventListener('click', () => ui.help.showModal());

  // Space passes the baton from anywhere in a run, unless focus is on another control.
  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.repeat) return;
    if (phase !== 'racing' && phase !== 'settling') return;
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest('button, a, input, dialog')) return;
    event.preventDefault();
    onPass();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      feed.wake();
      requestFrame();
    }
  });
}

function start() {
  renderRacerChoices();
  paintRacer(selectedRacer);
  paintTrack(0);
  renderHistory();
  bindEvents();
  feed.start();
  renderFeed();

  setInterval(() => {
    if (document.hidden) update();
    renderFeed();
  }, WATCH_MS);

  void fetchStats().then((result) => {
    stats = result;
    renderFeed();
  });
}

start();
