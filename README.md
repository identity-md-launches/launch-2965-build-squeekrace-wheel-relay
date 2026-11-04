# SqueekRace Wheel Relay

A browser game where your racer moves only when a real hamster runs. Pick a racer, start a timed
run, and pass the baton as real accepted wheel passages carry your racer around the rim. It is a
companion to [SqueekRace Arena](https://squeek-race.vercel.app/).

The production export has been built and checked in this revision. Executed browser reports and
screenshots ship in [`reports/browser/`](reports/browser/); [`VALIDATION.md`](VALIDATION.md)
records the checks, design review and remaining limitations. Browser interaction tests use a
scripted API so resting, running and stale states can be exercised reliably.

## How it plays

- **Choose a racer.** Pip has a narrow gold zone and 12 points per clean pass. Bramble has a wide zone and 5 points. Mochi has a medium zone, 7 points, and cheeks that save 12 passages at the line.
- **Start a timed run** of 1, 2 or 5 minutes.
- **Each accepted passage moves your racer one pace.** Each leg is 20 paces, and a lap of the rim is four legs.
- **Pass the baton in the gold zone.** Passing early locks the baton for 2 seconds. Miss the zone and your racer stops at the line, losing passages until you pass.
- **Score** is passages used plus baton points.
- **Each run ends** with a result, a recap of the observed activity and a replay button.
- **Passages count until the clock reaches zero.** After that the game waits up to 14 seconds for one more reading. It counts that reading only if the device observed it before zero, and the recap reports any passages it left out.
- **A run with no passages** says the wheel rested only if the feed was fresh the whole time and the finish reading arrived. Otherwise the result is "No passages observed", because a gap in the feed is not evidence that the wheel stopped.

Practice uses a simulated wheel. It is labeled for the whole session and is never saved with live
results. Live results stay in that browser only, so there is no shared leaderboard.

## Where the data comes from

The game reads the official Squeekchain public API at `https://api.squeekchain.com`. It needs no
key, no wallet and no backend.

| Endpoint | Use |
| --- | --- |
| `GET /v1/status` | Polled every 2.5 seconds. The rise in `measurement.cumulativeWorkUnits` between readings is the number of accepted passages, because the docs define one accepted passage as one work unit. `rpmMilli` and `freshness` drive the resting and stale states. |
| `GET /v1/measurement/stats?range=7d` | Fetched once. It gives the "usually busy again around" hint and the distance estimate. The game works without it. |

`/v1/measurement/runs` has exact passage timestamps, but it pages forward from the first segment
ever recorded, so reaching the live edge means walking the whole history. Its cursors are
documented as opaque, so the game does not build its own. See `src/js/feed.js:1`.

A counter also suits a game that can lose its connection: the first reading after a gap carries
everything missed.

- **Wheel running:** `rpmMilli` is above zero, or passages arrived in the last 15 seconds.
- **Wheel resting:** the feed is fresh and nothing is moving. This is the usual state for much of the day, so the game shows when the wheel is usually busy next.
- **Feed stale:** the API says `stale`, the latest measurement is over 45 seconds old, or the API has been unreachable for over 20 seconds. Live runs cannot start in this state, and practice stays available. A measurement's age is its reported age (`generatedAt` minus `receivedAt`) when it first arrived, plus the time since. Fetching the same measurement again does not make it fresher.

The readings are signed by the device and are not chain-certified work. The recap says so.

## Install

You need Node 20 or newer. The site has no runtime dependencies. TypeScript is the only development
dependency, and it is used for the typecheck.

```sh
npm ci
```

The existing lockfile pins `typescript@5.9.3`. A clean install of the unchanged manifest and
lockfile was checked in a temporary directory during this revision.

## Preview

```sh
npm run preview
```

This serves `dist/` at `http://127.0.0.1:4173/preview/`. The subpath exercises relative URLs the
same way an IPFS gateway does. Pass a different port with `node scripts/preview.mjs 5000`.

## Rebuild

```sh
npm run build
```

The site ships as browser-native ES modules, so the build copies `src/` to `dist/` with no
transpile step. Edit `src/`, never `dist/`, then rebuild and commit both. All asset URLs are
relative, so `dist/` works at a gateway subpath or an ENS name.

## Check the game

```sh
npm run typecheck      # tsc over the JSDoc types in src/js
npm test               # rules and feed tests, Node only
npm run test:browser   # walks dist/ with a scripted API; needs Playwright
```

The browser walk needs an existing Playwright installation with Chromium, WebKit and their
runtime dependencies. Set `IMD_PLAYWRIGHT` to that installation's `index.mjs` when the module is
not on the project import path. `PLAYWRIGHT_BROWSERS_PATH` can select its browser cache.

```sh
node tests/browser.mjs --engine chromium --out reports/browser/chromium
node tests/browser.mjs --engine webkit --out reports/browser/webkit
```

Omit `--engine` to run both in sequence. Each engine runs seven checks, including a full
one-minute practice run, and `--out` saves `results.json` and six viewport screenshots. These
are browser tests of the production export with a scripted API, not recordings of real wheel
activity. To run the pinned design probe while its task input is present:

```sh
node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
```

## Results

Executed on 2026-11-04 against the final `dist/`. See [`VALIDATION.md`](VALIDATION.md) for scope
and commands. The evidence below is included in the handoff, outside temporary scratch space.

| Check | Result |
| --- | --- |
| Production build | Passed; `dist/` generated from `src/`. |
| Typecheck | Passed with the pinned TypeScript 5.9.3. |
| Unit tests | 38 passed, 0 failed. |
| Chromium | [7 passed, 0 failed](reports/browser/chromium/results.json); [390×844](reports/browser/chromium/chromium-390-setup.png), [1440×900](reports/browser/chromium/chromium-1440-setup.png). |
| WebKit | [7 passed, 0 failed](reports/browser/webkit/results.json); [390×844](reports/browser/webkit/webkit-390-setup.png), [1440×900](reports/browser/webkit/webkit-1440-setup.png). |
| Design probe | [16/16 passed](reports/design/taste.json). First-screen prose: 34 words at 390, 84 at 1440. |

Both engines also save 320×640 setup, 390×844 live movement, stale-feed and practice-result
screenshots beside their reports. The unmocked design probe reached the API-unavailable state;
live-service CORS and a real active-wheel run remain unverified. WebKit automation is not a
physical iPhone or Safari test. The SVG share image may not unfurl on services that require a
raster image.

## Project layout

```text
src/            Source and everything the site ships
  index.html
  styles.css    Design tokens and all styles
  js/engine.js  Game rules, no DOM or network
  js/feed.js    API reading and wheel state
  js/racers.js  Racers and their art
  js/main.js    Page behavior
  assets/       Favicon and share image
dist/           Production export, a copy of src/
scripts/        Build and preview
tests/          Unit tests and the browser walk
reports/        Executed browser reports, screenshots and measured design probe
DESIGN.md       Design system
VALIDATION.md   What was and was not checked
```

All art is original SVG made for this game.
