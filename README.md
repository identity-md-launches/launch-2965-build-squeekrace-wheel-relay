# SqueekRace Wheel Relay

A browser game where your racer moves only when a real hamster runs. Pick a racer, start a timed
run, and pass the baton as real accepted wheel passages carry your racer around the rim. It is a
companion to [SqueekRace Arena](https://squeek-race.vercel.app/).

> **Status: not yet run.** This code has never been executed, in Node or in a browser. The tool
> that runs commands was unavailable for the whole build, so `dist/` was written by hand as a copy
> of `src/`. The build, typecheck, tests and browser checks below are ready but have not run.
> [`VALIDATION.md`](VALIDATION.md) has the full record. Run the commands in
> [Check the game](#check-the-game) before you publish.

## How it plays

- **Choose a racer.** Pip has a narrow gold zone and 12 points per clean pass. Bramble has a wide zone and 5 points. Mochi has a medium zone, 7 points, and cheeks that save 12 passages at the line.
- **Start a timed run** of 1, 2 or 5 minutes.
- **Each accepted passage moves your racer one pace.** Each leg is 20 paces, and a lap of the rim is four legs.
- **Pass the baton in the gold zone.** Passing early locks the baton for 2 seconds. Miss the zone and your racer stops at the line, losing passages until you pass.
- **Score** is passages used plus baton points.
- **Each run ends** with a result, a recap of the observed activity and a replay button.

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
- **Feed stale:** the API says `stale`, the latest measurement is over 45 seconds old, or the API has been unreachable for over 20 seconds. Live runs cannot start in this state, and practice stays available.

The readings are signed by the device and are not chain-certified work. The recap says so.

## Install

You need Node 20 or newer. The site has no runtime dependencies. TypeScript is the only development
dependency, and it is used for the typecheck.

```sh
npm ci
```

`package-lock.json` was written by hand from the npm registry's record for `typescript@5.9.3`,
because `npm` could not run. If `npm ci` rejects it, run `npm install` and commit the new lockfile.

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

The browser walk needs Playwright with Chromium and WebKit installed:

```sh
npm install --no-save playwright && npx playwright install chromium webkit
node tests/browser.mjs --out test/scratch/browser
```

With `--out`, it writes `results.json` and screenshots to that directory. To run the design probe:

```sh
node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
```

## Results

No check has run. See [`VALIDATION.md`](VALIDATION.md).

| Check | Result |
| --- | --- |
| Production build | Not run |
| Typecheck | Not run |
| Unit tests | Not run |
| Browser tests | Not run, so there are no browser results or screenshots |
| Design probe | Not run |

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
DESIGN.md       Design system
VALIDATION.md   What was and was not checked
```

All art is original SVG made for this game.
