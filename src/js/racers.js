// @ts-check
// The three racers and their original art. All of them run on the same real passages,
// so a racer changes the baton game (zone, points, saved passages), never the distance.

/**
 * @typedef {object} Racer
 * @property {string} id
 * @property {string} name
 * @property {string} trait
 * @property {number} zone Paces before the exchange line where a pass is clean.
 * @property {number} cleanPoints Points for a clean pass.
 * @property {number} pouch Passages saved while stopped at the line.
 * @property {string} fur
 * @property {string} belly
 * @property {string} sash
 * @property {number} cheek Cheek radius in the art.
 */

/** @type {Racer[]} */
export const RACERS = [
  {
    id: 'pip',
    name: 'Pip',
    trait: 'Narrow gold zone, 12 points per clean pass.',
    zone: 4,
    cleanPoints: 12,
    pouch: 0,
    fur: '#e8a15c',
    belly: '#fbe3c4',
    sash: '#d9473c',
    cheek: 4.5,
  },
  {
    id: 'bramble',
    name: 'Bramble',
    trait: 'Wide gold zone, 5 points per clean pass.',
    zone: 9,
    cleanPoints: 5,
    pouch: 0,
    fur: '#9aa0b5',
    belly: '#e4e6ef',
    sash: '#2f9e6e',
    cheek: 4.5,
  },
  {
    id: 'mochi',
    name: 'Mochi',
    trait: 'Medium zone, 7 points, cheeks save 12 passages.',
    zone: 6,
    cleanPoints: 7,
    pouch: 12,
    fur: '#f3e2c7',
    belly: '#fff6e8',
    sash: '#7c62d9',
    cheek: 7,
  },
];

/**
 * @param {string} id
 * @returns {Racer}
 */
export function racerById(id) {
  return RACERS.find((racer) => racer.id === id) ?? RACERS[0];
}

/**
 * Inner markup for a 64 by 48 viewBox. The racer faces right with its feet on the bottom edge.
 * @param {Racer} racer
 * @returns {string}
 */
export function racerArt(racer) {
  return `
    <circle cx="6" cy="29" r="3.5" fill="${racer.fur}"/>
    <ellipse class="foot foot-back" cx="18" cy="44" rx="6.5" ry="3.2" fill="${racer.belly}"/>
    <ellipse class="foot foot-front" cx="37" cy="44" rx="6.5" ry="3.2" fill="${racer.belly}"/>
    <ellipse cx="27" cy="29" rx="22" ry="15" fill="${racer.fur}"/>
    <ellipse cx="28" cy="34" rx="14" ry="9" fill="${racer.belly}"/>
    <path d="M19 15 L33 42" stroke="${racer.sash}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="46" cy="22" r="12.5" fill="${racer.fur}"/>
    <circle cx="40" cy="11.5" r="4.8" fill="${racer.fur}"/>
    <circle cx="40" cy="11.5" r="2.5" fill="#f2a7a0"/>
    <circle cx="50" cy="27" r="${racer.cheek}" fill="${racer.belly}"/>
    <circle cx="50" cy="19" r="2.2" fill="#1b1730"/>
    <circle cx="50.8" cy="18.2" r="0.7" fill="#ffffff"/>
    <circle cx="58" cy="23" r="1.5" fill="#d9756b"/>
    <rect x="49" y="33" width="14" height="4.5" rx="2.2" fill="#ffc24b" stroke="#1b1730" stroke-width="0.8" transform="rotate(-18 56 35)"/>`;
}
