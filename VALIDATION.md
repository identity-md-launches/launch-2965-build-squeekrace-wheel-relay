# Validation record

**Completion: Complete for the stated revision scope, 2026-11-04.** Both reported findings
reproduced. The handoff now includes executed Chromium and WebKit reports and screenshots, and
the desktop copy budget passes. These are worker measurements, not independent certification.
This record supersedes the previous rounds' unavailable-check status.

## Scope and changes

- The existing browser-native ES module game is retained. Game rules, API integration, styling,
  art, package manifest and lockfile are unchanged.
- `src/index.html:147`: shortened the empty Live results prompt to “Finish your first live run.”
  The adjacent browser-only storage and practice disclosure remains. The lower section keeps its
  existing natural layout.
- `tests/browser.mjs:18`: added optional `--engine chromium|webkit` selection so each engine can
  save its own evidence. The seven existing checks and their assertions are unchanged; omitting
  the option still runs both engines.
- `dist/` was regenerated with the production build. Reports live in `reports/`, outside scratch
  space, and are included with the source handoff.

## Executed checks

| Check | Actual result | Evidence |
| --- | --- | --- |
| Clean dependency install | Passed: 1 package installed using copies of the unchanged manifest and lockfile in a temporary directory | `npm ci --prefix /tmp/wheel-relay-install-check --cache /tmp/wheel-relay-npm-cache --ignore-scripts --no-audit --no-fund` |
| Production build | Passed, exit 0 | `npm run build`; [check output and export hashes](reports/checks.json) |
| Typecheck | Passed, exit 0, TypeScript 5.9.3 | `npm exec --yes --cache /tmp/wheel-relay-npm-cache --package typescript@5.9.3 -- npm run typecheck`; [output](reports/checks.json) |
| Unit tests | 38 passed, 0 failed, exit 0 | `npm test`; [TAP output](reports/checks.json) |
| Chromium browser walk | 7 passed, 0 failed, exit 0 | [results.json](reports/browser/chromium/results.json) |
| WebKit browser walk | 7 passed, 0 failed, exit 0 | [results.json](reports/browser/webkit/results.json) |
| Pinned taste@1 design probe | 16/16 checks passed | [raw measured report](reports/design/taste.json), [390 screenshot](reports/design/390.png), [1440 screenshot](reports/design/1440.png) |
| Source/export integrity | All 8 export files byte-identical to `src/`; local asset URLs relative | [file hashes and URLs](reports/checks.json) |

The first direct typecheck attempt could not resolve an executable `tsc`. Loading the locked
version through a temporary npm cache resolved it; the final typecheck passed. Chromium used
the provided Playwright runtime. WebKit was downloaded separately, with runtime packages
extracted into temporary storage; its temporary launcher was adjusted to preserve the library
search path. No browser binaries, runtime packages, dependency caches or repository
`node_modules/` are included in the handoff.

Browser commands, with the appropriate Playwright module and browser cache selected for each:

```sh
node tests/browser.mjs --engine chromium --out reports/browser/chromium
node tests/browser.mjs --engine webkit --out reports/browser/webkit
```

The pinned design probe ran from the repository root, with the provided Playwright module,
browser cache and a temporary browser-profile directory:

```sh
node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
```

Its final `taste.json` and the two viewport screenshots were copied unchanged to `reports/design/`
for the handoff. The task-provided probe itself is an input and is not part of the delivered source.

## Browser coverage and screenshots

Both engines served the production `dist/` under `/preview/`, exercising IPFS-style relative
asset paths. Each executed the same seven checks:

1. Setup at 320×640: no horizontal scroll or script/local-resource failures.
2. Setup at 390×844: main start action on the first screen, no horizontal scroll or script/local-resource failures.
3. Setup at 1440×900: main start action on the first screen, no horizontal scroll or script/local-resource failures.
4. Choose Bramble and start a live run. With an unchanged counter, passages stay at zero and the
   wheel rests. A scripted increase of 15 accepted passages moves the racer and changes the state
   to running. Stopping yields “Run stopped” and adds no live history entry.
5. An API-stale response disables live starts, leaves practice enabled and recovers after a fresh response.
6. A full one-minute practice run keeps its simulation label, accepts baton passes, reaches the
   result and activity recap, stays out of live history, and replays into a new countdown.
7. Help opens, Escape closes it and focus returns to the Help control.

| View/state | Chromium | WebKit |
| --- | --- | --- |
| Setup, 320×640 | [screenshot](reports/browser/chromium/chromium-320-setup.png) | [screenshot](reports/browser/webkit/webkit-320-setup.png) |
| Setup, 390×844 | [screenshot](reports/browser/chromium/chromium-390-setup.png) | [screenshot](reports/browser/webkit/webkit-390-setup.png) |
| Setup, 1440×900 | [screenshot](reports/browser/chromium/chromium-1440-setup.png) | [screenshot](reports/browser/webkit/webkit-1440-setup.png) |
| Live movement, 390×844 | [screenshot](reports/browser/chromium/chromium-390-live.png) | [screenshot](reports/browser/webkit/webkit-390-live.png) |
| Stale feed, 390×844 | [screenshot](reports/browser/chromium/chromium-390-stale.png) | [screenshot](reports/browser/webkit/webkit-390-stale.png) |
| Practice result, 390×844 | [screenshot](reports/browser/chromium/chromium-390-practice-result.png) | [screenshot](reports/browser/webkit/webkit-390-practice-result.png) |

The browser walk intercepts the official API URL with scripted responses. These reports test
the production UI and do not establish that real wheel activity occurred. The deliberately
unavailable optional stats response is tolerated. Script errors and failed local requests are
checked in the setup views and the full practice flow; this is not a blanket claim that every
request in every state was audited.

## Better Interface review

Reviewed the final source and rendered screenshots using the pinned guide's six domains. The
wheel remains the page's visual center; the revision does not change the design system.

| Domain | Coverage and result | Limits |
| --- | --- | --- |
| Accessibility | Checked native roles/names through browser selectors, live-start disabled state, practice availability, dialog Escape and focus return. The probe passes control spacing/target checks. | No full keyboard-only walk, screen-reader session, automated accessibility audit or native 200% zoom test. |
| Layout | Checked setup screenshots and measured zero horizontal overflow in both engines at 320, 390 and 1440. Product and both start controls are visible at 390×844. The probe also checks 320×700 and reports no text overlap, clipping or floating controls over text. | Intermediate widths, RTL and pseudo-localization not exercised. |
| Writing | Checked the empty-state next action and retained storage/practice disclosure. Measured first-screen prose is 34 words at 390 and 84 at 1440. Live and practice labels stay distinct. | The short empty prompt is five words, so taste@1 excludes it from its six-word prose threshold. All visible text remains in the screenshots. |
| Typography | Checked the existing six-token source scale, computed sizes, one requested family stack and two weights. Probe passes size, tracking and casing checks; screenshots show readable wrapping. | Actual fallback font varies by device; no font-file loading claim. |
| Colors | Checked existing semantic tokens. The probe's measured entry-screen text/background pairs meet 4.5:1, or 3:1 for large text. Status text accompanies color. | No exhaustive contrast audit of dynamic race/result states, artwork or forced-colors mode. |
| UI | Checked racer selection, countdown, movement, stop, stale/recovery, practice result, replay and dialog behavior. Probe passes surface and reduced-motion entry-state checks. | Racing motion under reduced motion and 10%-speed animation inspection were not performed. |

### Findings and rechecks

| Finding | Reproduction | Fix and final recheck |
| --- | --- | --- |
| High fidelity, original `VALIDATION.md:31` and README Results | The previous handoff said browser checks had not run and supplied no reports/screenshots. | Executed both seven-check walks. Added separate real `results.json` files and six screenshots per engine; linked them above and in README Results. Both runs exit 0. |
| Medium taste, `src/index.html:147` | Baseline taste@1 reproduced **97 desktop prose words**, above 90; 34 mobile words. The desktop screenshot confirmed the longer empty state and the footer entering the viewport. | Replaced only the empty prompt. Final probe measures **84 desktop / 34 mobile** and passes all 16 checks. The final desktop screenshot confirms the adjacent disclosure is intact and the lower section closes naturally. |

## Remaining limitations

- The unmocked design probe displayed the API-unavailable stale state. Browser CORS to the real
  service and a complete timed run with an actively moving real wheel remain unverified. The
  automated live scenario uses scripted readings and is stopped early; timed completion is
  exercised through practice. API unavailability keeps live starts disabled and practice usable.
- The counter's update cadence is still inferred from the API documentation and earlier samples;
  this revision does not change the 45-second measurement-age limit or 14-second finish wait.
- Counter sampling cannot split a batch at the start/deadline. The existing recap reports late
  passages omitted from a run; passages just before the start can be included in a later batch.
- Results are local to the browser and gateway origin. There is no shared leaderboard. Replay
  starts a new run with the same settings; it does not play back the previous observations.
- The share image remains SVG. The required metadata is present, but some link-preview services
  require a raster image; no external unfurl was tested.
- No physical-device, real Safari, screen-reader or deployed-IPFS gateway test was performed.
  WebKit automation is engine coverage, not a substitute for those checks. Hosting follows review.
