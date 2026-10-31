# Performance on low-end devices (s17, round 2: s18 below)

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

---

# Round 2 (s18)

Goal: same as round 1, aimed at a 2-core / 2 GB device. Before = `main` at 947d248 (round 1
merged), after = branch `s18/perf2`.

## How it was measured

Round 1's harness, plus (all in `scripts/perf/`):

- `measure.mjs --device low`: `navigator.hardwareConcurrency` 2 and `deviceMemory` 2, so "Auto"
  sees a weak device (it picks Low power). `--load-mode ck` also picks C&K on the setup screen
  (chip → ready, then Start → board). The load test now reports main-thread script / task time.
- `requests.mjs`: every JS / CSS / font file per step (home, setup, chip, start).
- `flows.mjs`: production flows with the page's CSP watched (violations, page errors, console
  errors fail the run): base, C&K and Seafarers hotseat from the setup screen, resume of the
  Seafarers save after a reload, an online Seafarers room on `?server=local` (host + a guest by
  the invite link), the tutorial, and a short bot game of every mode (`?mode=`).
- `screens.mjs`: click → paint on the setup screen, profile dialog, stats screen and lobby.
- `roll-layouts.mjs`: Layout events per paying roll from a DevTools trace (`--stacks`: callers).
- `glow-shots.mjs`: the ready button frozen at 0 / 25 / 50 % of its glow, per theme.

All at 6× CPU with WebGL on swiftshader, on a shared machine (load average 8–16 during the
runs): single runs vary by ±10–20 %; before / after runs alternated.

## Results (6× CPU, 2 cores / 2 GB unless noted; two runs each, before | after)

| Load (slow 4G)                                | Before                  | After                           |
| --------------------------------------------- | ----------------------- | ------------------------------- |
| JS for a base game (entry + preloaded)        | 12 files, 447 kB gz     | **3 files, 282 kB gz**          |
| JS transferred, base game (measure.mjs)       | 453 kB                  | **284 kB**                      |
| First contentful paint · home ready           | 2.62 s · 1.98 s         | 2.61 s · 1.99 s                 |
| "Play offline" as home shows → setup screen   | 2.57–2.62 s             | **1.62–1.72 s**                 |
| Main-thread script time during the load       | 900–979 ms              | **615–678 ms**                  |
| C&K chip → setup ready (its modules download) | 0.22–0.27 s             | 0.94–0.96 s (27 kB gz, one RTT) |
| Start → board drawn (base · C&K)              | 0.95–1.03 s · 0.48–1.09 | 0.97–1.00 s · 0.48–0.99         |

| In game, 1366×768                                   | Before            | After             |
| --------------------------------------------------- | ----------------- | ----------------- |
| Idle game screen, High quality, whole browser CPU   | 107–109 %         | **2.0–2.5 %**     |
| High quality: click → paint, roll / end turn        | 352–360 / 312–336 | 328–336 / 272–376 |
| High quality: long tasks in bot turns · over 100 ms | 14–15 · 1         | 11–13 · 0         |
| Low-end Auto (Low power): long tasks · long frames  | 3 · 11            | 1 · 6             |
| Phone 412×915, Low power: long tasks · pan p95      | 3 · 33 ms         | 1 · 17 ms         |
| Layouts per paying roll · forced (roll-layouts.mjs) | 12.8 · 4.0        | **7.6 · 2.0**     |

A/B with only the glow CSS differing (3 runs each, High quality): Roll / End turn clicks
296–320 / 264–304 ms new vs 296–320 / 272–280 old; long frames in bot turns slightly fewer.

| Other screens, click → paint (screens.mjs) | Before      | After       |
| ------------------------------------------ | ----------- | ----------- |
| Setup screen open                          | 528 ms      | 432 ms      |
| Setup: map tile · add seat                 | 192 · 376   | 280 · 264   |
| Stats screen open                          | 232 ms      | 208 ms      |
| Profile dialog: longest task               | 940 ms      | ~500 ms     |
| Profile dialog: all previews shown         | 1.95 s      | 2.01 s      |
| Online: create → lobby                     | 1.03–1.10 s | 1.14–1.27 s |
| Online `game` message handler, p95         | 57–63 ms    | 44–46 ms    |

Single setup-screen clicks swing ±100 ms between runs here (see "Looked at"). Create → lobby
came out 0.1–0.2 s slower in both after runs; not explained yet (the lobby needs no module for a
base room), within this machine's noise but listed as a gap.

## What changed, biggest win first

1. **Expansions load on demand** (EXPANSIONS.md §2b). The game chunk held every expansion's
   rules, HUD, board drawer and bots (~40 % of its JS). The registry now keeps a generated
   catalog (ids, names, modes, scenarios, options, terrains, map ids: `catalogData.ts`, `pnpm
gen:catalog`, checked by a test) and `ensureModules(mode | ids)` fetches a module's
   `pack.ts` (one chunk each). Engine calls for a game whose modules are missing throw
   `ModuleNotLoadedError`. The setup screen, hotseat resume, dev `?mode=`, the online lobby and
   game wait for them; the room server, sim and scripts install everything statically; tests
   install every pack in a vitest setup file. `vite.config.ts` groups the output (entry, one game
   chunk, one chunk per module): left alone the bundler split the shared core into ~25 small
   chunks.
2. **Glow without repaints** (`ui/hud.css`). The ready Roll / End turn button animated
   `box-shadow`, repainting every frame. It is now a halo (`::after`) and a top highlight
   (`::before`) whose opacity fades: the compositor runs it. No `will-change` (it made the clicks
   that toggle the buttons ~20 ms slower by pre-promoting layers), and no glow pseudo-elements in
   Low power / reduced motion.
3. **Pixi without its browser extras**: `skipExtensionImports` (board and previews) and a build
   stub for the one dynamic import (`browserExt` → `browserAll`) that kept Pixi's event system,
   accessibility, DOM containers and filter system in the bundle. The board reads its own input.
4. **Production animation in the next frame** (`ui/production/fx.ts`): plans start in a
   `requestAnimationFrame`, read every position before appending anything, and the layer is
   `contain: strict`.
5. **Piece-style previews** (`render/stylePreview.ts`): the board's renderer instead of a
   second WebGL context, the extracted canvas instead of a PNG data URL, one preview per frame
   after the dialog painted. Fix after release: the board's context can be lost unseen (phones,
   GPU resets) and its read-back is then blank; previews then use Pixi's Canvas 2D renderer
   (also before the board exists, instead of an own WebGL context).

## Looked at, not changed

- **Font preload** (Sunfired's Nunito + Marcellus): on slow 4G it took bandwidth from the CSS and
  the entry: first paint +250 ms, first contentful paint +1.06 s, home +0.5 s. All faces are
  already `font-display: swap` and load as latin subsets (53 kB for Sunfired). Blocking the fonts
  does not move first contentful paint either: the 0.6 s between the home DOM and its paint is
  main-thread work at 6×, not fonts.
- **WebGPU / Canvas renderers apart**: Pixi's core imports most of their modules statically
  (adaptors, programs, bind groups); split off they were the same bytes in five more preloaded
  files. They stay in (the Canvas one is the fallback where WebGL is missing).
- **Setup screen re-render** (~0.2–0.3 s per click on the low-end profile, most of it restyle and
  layout of the rebuilt screen): patching in place like the HUD would help, but its inputs keep
  values as properties (a removed seat would leave a stale name). Card idea below.
- **`patchChildren` forced layout on Roll**: the HUD removing the clicked (focused, hovered) Roll
  button. Predates this round; card idea.

## Screenshots

`docs/design/perf/glow-before-after.png`: per theme (rows), the ready button at the glow's peak,
quarter and start — before, after, before, after, before, after. The peak and the start match; at
the peak the theme's own drop shadow now stays under the halo (it used to be replaced), most
visible in Material dark. Elsewhere High quality looks as before (fixture screenshots in High quality, desktop and phone: identical on home, discard, trade and game over; on mid-game and setup only the ready button and a few faint shadow pixels by the menu buttons differ, about as many as two runs of the same build).
