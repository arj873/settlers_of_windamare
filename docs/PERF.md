# Performance on low-end devices (s17)

Goal: snappy on old Android phones (2 GB, 4 slow cores), cheap Chromebooks and integrated GPUs,
with good devices looking exactly as before.

## How it was measured

`scripts/perf/measure.mjs` drives a production build (`pnpm build && pnpm preview --port 4173`)
in headless Chrome with the CPU throttled through the DevTools protocol and WebGL on swiftshader
(GPU work becomes CPU work, roughly like a weak integrated GPU):

```sh
node scripts/perf/measure.mjs --cpu 6 --only load,game,online [--viewport 412x915@2.625] [--perf high|low]
node scripts/cpu-idle.mjs http://localhost:4173 8 --perf low     # idle game screen, whole browser
node scripts/perf/shots.mjs http://localhost:4173 out/ [--perf low] # screenshots for pixel diffs
```

- **load**: cold load on "slow 4G" (Lighthouse's DevTools numbers: 562.5 ms RTT, 1.47 Mbit/s).
- **game**: seat 0 plays real clicks (setup, roll, build, end turn) against three Normal bots at
  300 ms; Event Timing gives click → next paint, Long Animation Frames the long frames during bot
  turns; a drag and a wheel zoom on the board give frame times.
- **online**: the in-browser room server (`?server=local`): home → lobby, and per `game`
  message the tab's handler time (parse + client + render) and the time to the next frame.

Before = `main` at 3345c9f, after = this branch. The machine was shared and loaded (load average
10–15 on 12 cores), so single runs vary by ±20 %; "high quality" click latencies are within that
noise and dominated by board frames on swiftshader.

## Results (6× CPU; 4× in brackets)

| Load (slow 4G)                               | Before        | After                     |
| -------------------------------------------- | ------------- | ------------------------- |
| JS transferred (gzip)                        | 457 kB        | 450 kB (home needs 18 kB) |
| First contentful paint                       | 5.30 s (5.24) | **2.60 s** (2.59)         |
| Home screen ready                            | 5.40 s (5.32) | **1.97 s** (1.94)         |
| Setup screen, "Play offline" pressed at once | 6.28 s (6.24) | **4.78 s** (4.52)         |
| Start game → board drawn                     | 0.98 s (0.92) | 0.98 s (0.82)             |

| In game, 1366×768 @1                      | Before             | After, high quality | After, low power       |
| ----------------------------------------- | ------------------ | ------------------- | ---------------------- |
| Long tasks during bot turns (3 own turns) | 43 (22)            | **8** (1)           | **0** (0)              |
| Main-thread JS per 20 s of bot play       | 5.9 s              | **2.6 s**           | –                      |
| Click → paint, place / roll / end turn    | 384 / 304 / 320 ms | 408 / 296 / 312 ms  | **176 / 176 / 152 ms** |
| Pan frame, median / p95                   | 50 / 67 ms         | 50 / 67 ms          | **17 / 33 ms**         |
| Idle game screen, whole browser CPU       | 113 %              | 115 %               | **0 %**                |
| JS heap · GPU textures                    | ~20 MB · 1.7 MB    | ~20–30 MB · 1.7 MB  | ~22 MB · 1.4 MB        |

| In game, phone 412×915 @2.625          | Before                  | After, high quality | After, low power        |
| -------------------------------------- | ----------------------- | ------------------- | ----------------------- |
| Long tasks in bot turns (> 100 ms)     | 41 (14)                 | **10 (1)**          | **1 (0)**               |
| Click → paint, place / roll / end turn | 704 / 360 / 584 ms      | 672 / 496 / 640 ms  | **152 / 144 / 120 ms**  |
| Pan frame p90                          | 150 ms                  | 133–150 ms          | **17 ms**               |
| Canvas · antialias · textures          | 1082×2402 · on · 0.7 MB | same                | 618×1373 · off · 0.1 MB |

| Online (`game` message)          | Before        | After          |
| -------------------------------- | ------------- | -------------- |
| Handler (parse + render), median | 77 ms (55)    | **31 ms** (22) |
| Handler p95                      | 114 ms (93)   | **60 ms** (47) |
| Arrival → next frame, median     | 94 ms (68)    | **65 ms** (55) |
| Home → lobby                     | 1.19 s (0.94) | 1.13 s (1.14)  |

Bot thinking itself is small: Hard bots on the 37-hex board with 8 players spend 7 % of a bot
move deciding (219 ms of 3.3 s per 20 s at 6×); the rest was rendering. Autosave stringifies
~30 kB in 0.05 ms. Neither needed a worker.

## What changed, biggest wins first

1. **HUD renders in place** (`ui/dom.ts` `patchChildren`, `ui/sidebar.ts` `LogList`). Every state
   change rebuilt every panel and the whole Game Events log, read `scrollHeight` mid-render and
   measured the HUD right after: two forced layouts of the whole page per bot move. Unchanged DOM
   now stays, the log only adds the changed turn group, layout is read before writing or in the
   next frame, and icons clone a parsed SVG instead of parsing markup each time.
2. **Low power mode** (`ui/power.ts`, menu "Performance"): no antialiasing, resolution ≤ 1.5×, a
   still board, badges instead of flying cards, no HUD animation or backdrop blur. The glowing
   Roll / End turn button alone kept a core busy repainting.
3. **Small entry chunk** (`src/main.ts` / `src/app.ts`): the home screen paints from 18 kB gz of JS
   while Pixi, the engine and the HUD download beside it (low-priority preload links).

## Screenshots

High quality (left) and low power (right): `docs/design/perf/desktop-high-vs-low.png`,
`phone-high-vs-low.png`, a 1:1 crop of the phone board in device pixels
(`phone-zoom-high-vs-low.png`: low power draws at 1.5× instead of 3×), and the menu
(`menu-performance.png`). With "High quality", or "Auto" on a good device, the fixture
screenshots match `main` pixel for pixel apart from the phase of pulsing glows.
