# SqueekRace Wheel Relay design

Everything here is taken from the source in `src/`. The site has not been rendered yet, so
statements about layout come from the CSS, not from observation. See `VALIDATION.md`.

## Overview

Wheel Relay is a companion game for SqueekRace Arena players. One visual idea carries it: the
running wheel is the track. A racer runs around the rim, and four gold baton zones sit on it.

The look is a calm night scene with flat, warm-coloured racers. The screen is built around one
wheel and one column of controls, with no decorative layers. Density is low, because the player
watches the wheel and acts at the moment a zone opens.

Reusable rules:

- The product comes first. The wheel and the main action share the first screen.
- Wheel state is always a word plus an icon shape, in three places: the hub, the feed line and the race hint.
- Live and practice look different. Practice adds a sky-blue banner and a striped rim, and both stay through the result.

## Colors

Tokens live in `src/styles.css:5-37`. The notation is hex. Primitives are named by hue, and
components use only the semantic tier.

| Semantic token | Primitive | Value | Use |
| --- | --- | --- | --- |
| `--color-bg-page` | `--ink-950` | `#12152a` | Page background, text on filled controls |
| `--color-bg-surface` | `--ink-900` | `#1b2040` | Racer and length options, hub disc, help dialog, disabled controls |
| `--color-bg-control` | `--ink-800` | `#2a3058` | Selected options, secondary buttons, wheel rim and spokes |
| `--color-border-control` | `--ink-500` | `#7780b8` | Secondary button borders, hover borders |
| `--color-text-primary` | `--cream-100` | `#f7f1e3` | Main text, lap progress, exchange lines |
| `--color-text-secondary` | `--cream-300` | `#cdcadd` | Supporting text |
| `--color-text-on-accent` | `--ink-950` | `#12152a` | Text on any filled color |
| `--color-accent-solid` | `--marigold-400` | `#ffc24b` | Primary action, gold zones, selected borders |
| `--color-accent-hover` | `--marigold-200` | `#ffe2a6` | Primary button hover |
| `--color-link` | `--marigold-200` | `#ffe2a6` | Links |
| `--color-focus` | `--cream-100` | `#f7f1e3` | Focus rings |
| `--color-state-running` | `--mint-400` | `#5fe3a9` | Wheel running, live activity bars |
| `--color-state-resting` | `--lilac-300` | `#c3b4ff` | Wheel resting |
| `--color-state-stale` | `--coral-400` | `#ff9a7a` | Feed stale, racer stopped at the line |
| `--color-state-practice` | `--sky-300` | `#8fd8ff` | Everything simulated |

Racer art colors are data, not interface tokens. They live with each racer in `src/js/racers.js`.
There is one dark theme and no light theme. Contrast ratios have not been measured.

## Typography

One family: `ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", system-ui, -apple-system, sans-serif`.
No font files ship with the site, so the face depends on the device. Two weights: 400 and 700.

| Token | Size | Use |
| --- | --- | --- |
| `--text-caption` | 0.8125rem | Labels, feed detail on phones, footer |
| `--text-body-sm` | 0.9375rem | Notes, hints, option labels, recap lines |
| `--text-body` | 1.0625rem | Default body, buttons, brand, feed title |
| `--text-title` | 1.375rem | Section headings, HUD and result values, wide-screen tagline |
| `--text-value` | 2rem | Result title, hub numbers on phones |
| `--text-display` | 3rem | Hub numbers on wide screens |

Line height is 1.5 for body text and 1.1 to 1.3 for headings and values. Changing numbers use
`font-variant-numeric: tabular-nums`. Headings use `text-wrap: balance` and notes use
`text-wrap: pretty`, which older browsers ignore safely. Only the result title has letter-spacing
(`-0.01em`). No text is uppercased.

## Layout

Spacing tokens: `--space-1` to `--space-12` (0.25rem to 3rem), with 0.5rem inside a group and
0.75rem or more between groups. The page inset is 1rem, or the safe area when that is larger.

| Width | Behavior | Source |
| --- | --- | --- |
| Below 56rem | One column. The wheel is `clamp(11rem, 29svh, 22rem)` wide, so its size follows screen height and leaves room for the controls. | `src/styles.css:243` |
| Below 56rem, result | The wheel shrinks to 9rem so the result heading stays near the top. | `src/styles.css:792` |
| 56rem and up | Two columns, `minmax(0, 1.15fr) minmax(20rem, 1fr)`, capped at 76rem. The wheel grows to `min(100%, 60svh)`. Buttons sit side by side and the lower sections form three columns. | `src/styles.css:804` |

Direction-dependent spacing uses logical properties. Option rows use three equal columns.

## Elevation & Depth

The design is deliberately flat, with no shadows. Depth comes from three tonal steps: page,
surface and control. The only overlay is the help dialog, with a dark `::backdrop`.

## Shapes

`--radius-md` (0.75rem) is used for buttons, options and the dialog, and `--radius-sm` (0.5rem) for
the banner and skip link. Activity bars have 2px top corners. Borders appear only where they carry
state or mark a control: selected, hover and secondary buttons.

## Components

All components are plain HTML and CSS patterns. `src/index.html` holds the markup and
`src/js/main.js` the behavior. There is no component library.

| Component | Classes | States and behavior |
| --- | --- | --- |
| Button | `.btn`, `.btn-primary`, `.btn-secondary` | Hover (only where hover exists), `:active` scale 0.96, `:focus-visible` ring, native `disabled`. At most one filled primary per view. |
| Baton button | `.btn-pass` | `data-ready` is `no`, `zone` or `line`. Locks with `aria-disabled` during a fumble so keyboard focus stays on it. The label changes with the state, so color is never the only cue. |
| Option cards | `.racer-card`, `.seg-item` | Native radios stretched invisibly over the card, so arrow keys work. Checked and focus styles use the `+` sibling selector. |
| Wheel scene | `.scene`, `.wheel`, `.hub` | Inline SVG. The rim radius (146) must match `RIM_RADIUS` in `src/js/main.js`, because dash lengths are computed from it. The hub is an HTML overlay so its text keeps real sizes. |
| Feed line | `.feed` | `data-state` is `connecting`, `running`, `resting`, `stale` or `practice`. Resting and connecting use an outline icon, the others a filled one. |
| HUD and stats | `.hud`, `.stats` | Definition lists with caption labels and tabular values. |
| Activity bars | `.bars`, `.bar` | Twelve equal slices of the run. `role="img"` with a text summary, and the recap lines repeat the key facts. |
| Practice banner | `.banner` | Shown for the whole practice session, including its result. |
| Help | `.help` | Native `<dialog>` with `showModal()`, which gives focus trapping, Escape and focus return. |
| Announcer | `#announcer` | One stable `role="status"` region for feed changes, baton outcomes and results. |

Motion: state changes last 150ms on named properties with `cubic-bezier(0.2, 0, 0, 1)`. The only
endless animation is the racer's feet while it moves, and it is opt-in through
`prefers-reduced-motion: no-preference`. With reduced motion the spokes also stop, but the racer
still moves, because its position is game state.

## Do's and Don'ts

- Do move the racer only through `addPassages` and `step` in `src/js/engine.js`. Baton timing may change the score, never the position.
- Do show a wheel state as a word and an icon, and take its color from a `--color-state-*` token.
- Do keep every simulated number labeled as practice, and out of `localStorage` results.
- Do use one type size from the six tokens. Adding a seventh breaks the type scale.
- Don't add a second filled action to a view.
- Don't add shadows or nest surfaces. Use the next tonal step.
- Don't describe the feed as chain-certified. The API marks it `certifiedCoreWork: false`.

To add a page: start from `.stage` and `.lower-block`, take colors and sizes from the semantic
tokens, use `.btn` for actions, and keep the site to one page or hash routes so it works on IPFS.
