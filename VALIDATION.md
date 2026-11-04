# Validation record

**Completion: Incomplete.** The game is fully written, but none of it has been executed. The
production build, typecheck, tests, browser checks and design probe all did not run, so this is
unverified work, not a verified delivery.

## Why nothing ran

The tool that runs commands failed to start on every attempt during this build, and the browser
tool had no browser installed, which needed that same command tool to fix. Only file reading,
file writing, search and web fetching worked. The command tool's other route, running outside its
sandbox, was not permitted. The browser tool's code runner could have started processes, but that
would have sidestepped the same restriction, so it was not used.

## Scope and assumptions

- **Reviewed:** the single page in `src/`, with its setup, countdown, race, settling, result and help states.
- **Export:** `dist/`, a hand-written copy of `src/`. `npm run build` is defined as that same copy.
- **Stack:** plain ES modules with JSDoc types instead of Vite and React. With no way to run a bundler, a site that needs no compile step was the only way to deliver a real `dist/`.
- **Live source:** `/v1/status`, not `/v1/measurement/runs`. The README explains why.
- **Replay:** the replay button starts a new run with the same racer, length and mode. It does not play back the old run.
- **Not included:** a shared leaderboard (static hosting cannot provide one), wallets, and hosting, which happens after this job.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| `npm ci` | Not run | No command tool |
| `npm run build` | Not run | No command tool |
| `npm run typecheck` | Not run | No command tool |
| `npm test` | Not run | No command tool |
| `npm run test:browser` | Not run | No command tool, no browser |
| Design probe (taste@1) | Not run | No command tool, no browser |
| Screenshots | None exist | No browser |
| Live API shape | Checked | Fetched `/v1/status`, `/v1/measurement/runs`, `/v1/measurement/stats?range=7d`, `/v1/measurement/blocks` and `/v1/events` on 2026-11-04, and read the API docs. Field names in `src/js/feed.js` match. |
| `dist/` matches `src/` | Partly checked | All 8 files have equal line counts, and the 4 script files have equal keyword counts. This is good evidence, not a byte comparison. `npm run build` removes the question. |
| Banned patterns in `dist/` | Checked by search | No em or en dashes, `text-transform`, `transition: all` or `pathLength`. One `letter-spacing`, at `-0.01em`. |
| Head tags | Checked by reading | `dist/index.html` has a title, favicon, description, `og:title` and `og:image`. |
| Relative URLs | Checked by reading | Every local URL in `dist/index.html` starts with `./`. |
| Rules and tests | Traced by hand | Each unit test was followed through the code by reading. This found nothing wrong in the tests, but it is not a test run. |

### What to run first

```sh
npm ci && npm run build && npm run typecheck && npm test
node tests/browser.mjs --out test/scratch/browser
node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
```

The tests themselves are also unrun, so a failure may be in a test rather than in the game.

## Risks to check first

1. **The live counter has not been seen rising.** The wheel was resting during every fetch (the quiet window is roughly 08:00 to 20:30 UTC). The game assumes `cumulativeWorkUnits` updates with each accepted measurement, as the docs say. If it only moved when a round closes, racers would jump every ten minutes. Watch one live run during a busy period, usually around 21:00 to 23:30 UTC.
2. **Reading cadence is inferred.** "About ten seconds" comes from segment timing while running. The idle interval looks like 30 seconds or less, from a few samples. The stale limit (45 s) and finish wait (14 s) depend on this.
3. **CORS is taken from the docs.** No browser has called the API from another origin.
4. **`dist/` could have a typing slip.** It was written out rather than generated.

## Better Interface review

Review was by reading the source only, using each domain's "without a browser" checks. Every
rendered check is **Not verified**.

| Domain | Coverage | Checked in source | Not verified |
| --- | --- | --- | --- |
| Accessibility | Checked, source only | Native buttons, links, radios and `<dialog>`; names on all controls; focus ring (`src/styles.css:122`); skip link; heading order; one status region; reduced motion and forced colors; state shown by text and icon, not color alone | Keyboard walk, focus visibility, accessibility tree, screen reader, automated audit, 200% zoom |
| Layout | Checked, source only | Logical properties, safe-area insets, DOM order matches reading order, breakpoint from content, wrapping rows, no fixed text widths | All widths, overflow, whether Start is on the first screen, RTL |
| Writing | Checked | Verb-first buttons, sentence case, one term per concept (passage, baton, leg), calm errors with a next step, empty state points forward, descriptive links | None. Source alone is enough for this domain. |
| Typography | Checked, source only | Six sizes, two weights, one family, tabular numbers, line heights, wrap rules | Rendered wrapping, which font each device actually uses |
| Colors | Checked, source only | Two-tier tokens, components use semantic tokens, one meaning per hue, one filled action per view | **All contrast ratios.** None were measured or computed, so none are claimed. |
| UI | Checked, source only | Named transition properties, 150ms state changes, press scale 0.96, every state styled, flat surfaces | Motion in practice, racer art appearance |

The first-screen height at 390 wide was estimated at about 690px by adding up the CSS, with Start
inside an 844px screen. That is an estimate, not a measurement. `tests/browser.mjs` asserts it.

### Findings and fixes

All were found by reading the code. None have been rechecked by running it.

| Severity | Location | Finding | Fix |
| --- | --- | --- | --- |
| High | `src/js/main.js:758` | `phase` stayed narrowed across `update()`, so the later comparison was expected to fail the typecheck. | Added `inRun()` (`src/js/main.js:269`), which keeps the check out of type narrowing. |
| Medium | `src/js/main.js:659` | A stopped live run claimed the finish reading had not arrived. | The line now only appears for runs that reached the clock. |
| Medium | `src/js/main.js:489` | A run ending on a resting wheel waited 14 seconds, then reported a missing reading. | A resting wheel now counts as nothing in flight, so the run ends promptly. |
| Medium | `src/js/main.js:70` | `pathLength` on `<circle>` could not be tested in WebKit, and a failure would silently misplace the gold zones. | Removed. Dash lengths now use the real circumference. |
| Low | `src/js/main.js:429` | `practiceReading` had an untyped parameter, which strict mode rejects. | Added the JSDoc type. |
| Low | `src/js/main.js:576` | Points and lock time were hard-coded in spoken messages. | They now use the rule constants. |

## Known limitations

- **No browser test results exist**, although the brief asks for them. `tests/browser.mjs` will produce them.
- **The share image is an SVG.** Many link previews need PNG or JPEG, so `dist/assets/og.svg` may not unfurl until a 1200 by 630 raster replaces it. A binary file could not be written here.
- **Timing resolution is one reading.** Passages from just before the start, or just after the clock ends, can be counted. The recap shows the counter's first and last values.
- **A live run can be all rest.** During quiet hours the racer may not move at all. The game says so before the start and in the result, and practice is always available.
- **Help does not pause a run,** because the wheel does not pause.
- **Results are per browser,** and on IPFS they are also per gateway origin.
- **The lockfile was written by hand.** The `typescript@5.9.3` integrity value came from the npm registry but has not been checked by `npm ci`.
- **No native device, screen reader or real-Safari check** has been done.
