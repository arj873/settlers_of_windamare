# Tutorials ("Learn to play")

A tutorial is a **coached real game**: a normal hotseat game against Easy bots with a panel that
explains each rule the moment it comes up. Nothing is rigged; a fixed seed, found by a headless
search, makes the important moments come early. The engine and the controller do not know about
tutorials; the coach only reads the game.

There is one tutorial per **course**: the base game (`src/ui/tutorial/`, since s16) and one per
expansion module that has one (`src/expansions/<id>/tutorial.ts`). Built: base, Cities & Knights
(`ck`), Seafarers (`seafarers`), Traders & Barbarians (`tb`), Explorers & Pirates (`ep`), Oil
Springs (`oil`), Crop Trust (`crop`). Expansion courses assume the player knows the base game:
they teach only what is new, and their first lesson offers the base tutorial until it is done.

## 1. Pieces

| File                               | What                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/ui/tutorial/course.ts`        | `Course`, `LessonDef`, `TutorialCtx`, `defineCourse`, `standardWrapUp`, lesson helpers       |
| `src/ui/tutorial/base.ts`          | `BASE_COURSE` (the base game: `game.ts` + `lessons.ts`)                                      |
| `src/ui/tutorial/registry.ts`      | `TUTORIAL_MODULES` (modules with a course), `registerCourse`, `courseById`, `courseOfGame`   |
| `src/ui/tutorial/machine.ts`       | the run (progress, saved) and its pure steps: `advance`, `next`, `back`, `skip`, `panelView` |
| `src/ui/tutorial/store.ts`         | localStorage, one record per course                                                          |
| `src/ui/tutorial/coach.ts`         | `TutorialCoach`: starts a course, follows its game after every render, draws the panel       |
| `src/ui/tutorial/panel.ts`         | the panel (lesson, pictures, Back / Next / Skip, the base-tutorial link)                     |
| `src/ui/tutorial/picker.ts`        | the "Learn to play" picker (base + `TUTORIAL_MODULES`, done ticks)                           |
| `src/ui/tutorial/testkit.ts`       | tests and the seed search: `drive`, `LEARNERS`, `courseProblems`, `firstTurn` (not bundled)  |
| `src/expansions/<id>/tutorial.ts`  | the module's course: its lessons, pictures, seed (`<id>TutorialSpec`, the `Course`)          |
| `src/expansions/<id>/tutorial.css` | what its lessons point at (`data-tut-focus` names) and its pictures' styles                  |
| `scripts/tutorial-seeds.test.ts`   | the seed search (skipped unless `TUTORIAL_SEEDS` is set)                                     |

**Chunks.** A module's course is part of its pack (`ExpansionPack.tutorial`, `src/expansions/load.ts`)
and so of the module's chunk: a base game never downloads it. Installing the pack registers the
course (`registerCourse`). The picker needs to list a course before its module loads, so the
module id is also in `TUTORIAL_MODULES`; the names and blurbs come from the engine catalog. The
framework (course helpers, picker) is in the game chunk (s19: +1.8 kB gz JS, +0.3 kB gz CSS).

## 2. How it runs

- **Course** = `{ id, name, mode, seed, me, seats, botLevels, game(), isGame(state), lessons,
finish, wrapUp(ctx, done), visuals? }`. `defineCourse(spec)` builds one for a mode: official
  rules, you in seat 0 placing and playing first, two Easy bots, `isGame` = seed + mode +
  scenario + player count.
- **Lesson** (`LessonDef`): `when(ctx)` its moment; `doneWhen` closes it by itself (the player
  did it / the moment passed); `stale` drops it unseen; `after` orders it; `urgent` (the player
  must act) pushes a reading lesson off the panel; `recap` (an event lesson) shows at the end if
  its event never came up; `todo` a live "your move" line; `focus` a HUD element to pulse;
  `visual` pictures under the text; `offerBase` the "start with the base game tutorial" link.
  Predicates read only `ctx.state`, `ctx.me` and `ctx.legal` (the learner's legal actions), so a
  reload resumes exactly.
- **Wrap-up** (`standardWrapUp(lessons, gate, lastTurn)`): once `gate` is done and either every
  event lesson happened or the learner's `lastTurn`-th turn started (or the game ended), the
  missed event lessons show as recaps, then `finish` ("You're ready!": Keep playing / New game).
- **Coach**: `begin(courseId)` (a module's course needs `ensureModules(id)` first; app.ts does
  it) saves a fresh run under the course's key and starts its game; `update()` after every render
  advances the run. A different game on screen drops the run; a resumed save of any course's game
  brings its run back. Bots move at least 900 ms apart while a course runs.
- **Storage**: `catan:tutorial:v1` (base: `{ completed, offered, run }`, unchanged) and
  `catan:tutorial:<id>:v1` per module course. `completed` = finished or skipped once (the
  picker's tick).
- **Entry points**: setup screen header "Learn to play" and the in-game menu → the picker;
  under the expansion chips, "New to Cities & Knights? Learn it" (that course directly); a first
  visit's hint → the base course. The resume prompt says "Unfinished tutorial game" for any
  course's game (seeds start with `learn-`).

## 3. Adding a tutorial for a module (checklist)

Budget: about a day, most of it writing and playing the lessons.

1. **Read** the module's rules doc (`docs/rules/<id>.md`) and list what it adds to the base game:
   new pieces, costs, phases, events, awards, the victory condition. Each becomes a lesson; keep
   them short (1-3 sentences, the base lessons' tone) and true to the engine's numbers (read
   settings and the module's constants in `text`, e.g. `state.settings.vpToWin`).
2. **Write `src/expansions/<id>/tutorial.ts`** (copy `seafarers/tutorial.ts`, the smaller one):
   - an `Id` union and `LESSONS: readonly LessonDef<Id>[]` in the order they come up: an intro
     (`when: () => true`, `offerBase: true`), setup lessons if the module changes setup (urgent,
     `doneWhen` = placed), a first-turn lesson (the wrap-up `gate`), event lessons (`recap: true`)
     triggered by the module's state (its slice, phases, `ctx.legal`), and `finish`
     (`when: () => false`);
   - read the game through the module's engine selectors and the helpers in `course.ts`
     (`myMain`, `turnOver`, `setupStep`, `can`, `sevenNow`, `myTurnsStarted`, `turnLog`);
   - `export const <id>TutorialSpec = { id, name, mode, scenario?, seed, lessons, gate, finish,
lastCoachedTurn, visuals? } as const` and `export const <id>Tutorial = defineCourse<Id>({ ...spec })`.
     The course id and mode are the module id.
3. **Point at the HUD** (optional): a `focus` name per lesson, styled in
   `src/expansions/<id>/tutorial.css` (imported by `tutorial.ts`) with
   `.catan-hud[data-tut-focus='<name>'] <selector> { animation: tut-pulse 1.6s ease-in-out infinite; }`
   and a `prefers-reduced-motion` rule (see `ck/tutorial.css`). Build cards are
   `.bcard[data-actions^='<actionType>']`. The base names (`roll`, `end`, `build`, `trade`,
   `hand`, `players`, `dice`) work everywhere.
4. **Pictures** (optional): `visuals: { name: () => HTMLElement }` in the spec, `visual: 'name'` on
   the lesson; reuse the module's card faces from its `ui.ts`.
5. **Register**: `tutorial: <id>Tutorial` in `src/expansions/<id>/pack.ts`, and the id in
   `TUTORIAL_MODULES` (`src/ui/tutorial/registry.ts`, picker order). The registry test fails until
   both are there.
6. **Seed**: add the course to `scripts/tutorial-seeds.test.ts` (a `search(<id>TutorialSpec,
'learn-<id>-', score)` branch and a scorer: which events must come early, which recaps cost
   most), then run
   `TUTORIAL_SEEDS=<id> TUTORIAL_SEED_COUNT=300 nice -n 19 pnpm vitest run scripts/tutorial-seeds.test.ts`
   (~60 ms per game). Pick a seed that scores well **for all three learners** (Normal, Hard and
   Easy bots in your seat). Know what stays fixed: the dice follow the seed until something else
   draws from the game's RNG (a steal, a development card draw); C&K's sleeping robber keeps
   them fixed until the first barbarian attack. Name it `learn-<id>-<n>`.
7. **Tests**: `src/expansions/<id>/tutorial.test.ts` (copy `seafarers/tutorial.test.ts`):
   - the game (mode, scenario, players, VP, the learner first, default options);
   - `courseProblems(course)` is `[]` (ids, `after`, visuals, seed name, every learner finishes);
   - the seed delivers the early events you rely on (`firstTurn(drive(...), /log text/)`);
   - each lesson's trigger, `todo` and live text (drive `until` it shows, or patch a state);
   - completion: every learner reaches `finish`; the Normal learner without recaps if you can.
8. **Play it**: `pnpm dev`, setup screen → the module's chip → "New to …? Learn it". Read every
   lesson at 412 px wide too; check the pulses in two themes.
9. **Docs and screenshots**: a line in §1 here, the course in `docs/EXPANSIONS.md` §2b if it
   needs anything new; screenshots with `node scripts/shots-tutorials.mjs <devUrl> <outDir>`
   (add the course's moments there).
10. **Check**: `nice -n 19 pnpm typecheck && nice -n 19 pnpm lint && nice -n 19 pnpm test`, then
    `pnpm build` (the game chunk must not grow: the course belongs in the module chunk) and
    `node scripts/perf/flows.mjs --only tutorial-ck` as a model for a CSP-watched start of yours.

## 4. The built courses

**Base** (`learn-34`): docs/ARCHITECTURE.md §13e.

**Cities & Knights** (`learn-ck-7`, starter board, 13 VP). Lessons: intro, setting up, a city
right away, three dice (names the event die face of the learner's roll), commodities (picture:
terrain → resource + commodity), city improvements (picture: the three tracks), abilities and
metropolises, knights, the barbarians, the barbarians are near (with the strength count and a
"build / activate a knight" todo), the attack (live score, pick a city to lose / a progress
deck), progress cards, using knights (move, displace, chase the robber, promote), a 7 (the robber
sleeps until the first attack), city walls, you're ready. The seed: a city gate on the learner's
first roll, the ship sails from turn 4, the barbarians attack on turn 15 for every learner (the
robber sleeps until then, so nothing shifts the dice). The Normal learner sees every lesson live.

**Seafarers** (`learn-sea-316`, Heading for New Shores, 3 players, 14 VP). Lessons: intro
(scenario, target, island bonus), sea and islands (gold, fog), setting up, a ship instead of a
road, ships, moving a ship, robber or pirate, gold, land ho (the island bonus, with a "build a
settlement on the island" todo), Longest Trade Route, you're ready. The seed: the learner rolls
a 7 on their second turn (Normal and Hard learners; a development card draw can shift it); the
Normal learner settles an island on their sixth turn. The Easy learner gets the island and route
lessons as recaps; gold shows only if the learner reaches a gold field.

**Traders & Barbarians** (`learn-tb-77`, the Traders & Barbarians scenario, 3 players, 13 VP).
T&B is a box of scenarios and variants, all one mode (`tb`); a module has one course, so it
teaches the title scenario: the most new rules (a side-panel line can't teach them), and its gold
and city-in-setup rules carry over to Rivers and Barbarian Attack. Lessons: intro (target, wagon,
deliveries), trade hexes and barbarians (no robber, no desert, 2 and 12 rolled again), setting
up, a city and a wagon, your wagon (the gate: movement points, the Wagon card pulsing), roads
and tolls (a "points left" todo), gold, loading a commodity (picture: where each one goes),
delivered, baggage train (picture: the five cards), barbarians instead of the robber (on a 7 or a
Knight), drive a barbarian off, Swift Journey, you're ready (no Longest Road; the other scenarios
are on the setup screen). The seed: a 7 on turn 3 (a bot's), the learner loads on their second
turn (Easy: first) and delivers on their sixth (Easy: fourth, Hard: eighth); no learner needs a
recap. Drive-off and Swift Journey show only if they come up (the Easy bots seldom upgrade).

**Explorers & Pirates** (`learn-ep-221`, Land Ho!, 3 players, 8 VP). Why Land Ho!: it is the
rulebook's first scenario and has no setup to place (printed pieces: a settlement and road, a
harbor settlement, a ship with a settler), so the first turn is already about what is new:
harbor settlements, the Movement phase, ships, exploring, settlers and gold. Each later scenario
adds one layer (crews and the pirate, then the Council's missions); they get one lesson and a
picture, and the finish points to Pirate Lairs. A second course for them would need more than one
course per module (a framework change; card idea). Lessons: intro (what is gone), your start (the
fleet pulsing), Action then Movement (the phase line pulsing; it waits for an Action phase), gold
(picture: the gold trades), sailing (a "sail to the fog" todo), exploring, land ho (urgent, a
"found a settlement there" todo), settlers and ships (picture: costs), harbor settlements, a 7
(discards only), pirates and missions (picture: the five scenarios), you're ready. The seed: the
learner's first roll pays nothing (1 gold); the first 7 is Blue's on turn 5. Land Ho! draws
nothing else from the game's RNG, so these are the dice in every game. Both fog hexes the starting
ship reaches on turn 1 hide land (with an 8), and the settler can land there at once: a learner
who follows the coach sails, explores and settles new land on turn 1. Every learner sees every
lesson live (the bots, though, settle the home coast first).

**Oil Springs** (`learn-oil-288`, the rulebook board, 3 players, 12 VP). Lessons: intro (springs,
pollution, the win at the end of your turn), setting up (a spring's corner pays oil), oil (first
turn; picture: what oil is for, a "turn 1 oil into 2 cards" todo when the learner holds oil),
pollution (live marker), sequestering (shows when the learner can, or anyone did), metropolis
(when a city stands), disaster (names the disaster roll), you're ready. The seed: a bot uses oil
by turn 12 and a disaster strikes by turn 25 for every learner; all three learners see every
lesson live. The bots don't seek springs, so the scripted learners rarely hold oil; a reader of
the setup lesson may.

**Crop Trust** (`learn-crop-52`, the first-game board, 3 players, 10 VP). Lessons: intro (the
collapse ending, food), fields and crops (picture: the five crops), harvest (urgent, the pick to
make), the seed vault (first turn, with a "store a seed" todo), replanting (urgent, seeds left),
effects of growth (names the revealed event), when the crops run out (shows when a field is down
to its last crop), you're ready. The seed: every learner harvests within their first three turns
and the crops hold out through the coached turns; Normal and Hard learners see every lesson live,
the Easy learner gets the event lesson as a recap.

## 5. Screenshots

`node scripts/shots-tutorials.mjs <devUrl> docs/design/tutorials` (Vite dev server; the
learner's moves are the Normal bot's; `SHOTS=picker,ck,sea,tb,ep,oil,crop` takes only those
sections):

- Picker: `picker-desktop.png` (base done: its tick, over the setup screen), `picker-phone.png`
  (412 px, fresh: the "start with the base game" hint), and `picker-phone-<theme>.png` for wood,
  parlour, chartroom, materialdark, githubdark.
- Setup screen link: `setup-learn-link-desktop.png` (C&K), `setup-learn-link-phone.png`
  (Seafarers).
- Cities & Knights: `ck-desktop-1-intro.png` (base link), `ck-desktop-2-dice.png` (the gate on
  the first roll), `ck-desktop-3-improve.png` (tracks picture, the tracks pulsing),
  `ck-desktop-4-warning.png`, `ck-desktop-5-attack.png`; `ck-phone-1-intro.png`,
  `ck-phone-4-attack.png`.
- Seafarers: `sea-{desktop,phone}-1-intro.png`, `-2-ships.png` (the Ship card pulsing),
  `-3-pirate.png` (the learner's own 7).
- Traders & Barbarians: `tb-{desktop,phone}-1-wagon.png` (the Wagon card pulsing),
  `-2-load.png` (where each commodity goes); `tb-desktop-3-baggage.png` (the five cards).
- Explorers & Pirates (`SHOTS=ep`; on turn 1 the learner follows the coach):
  `ep-desktop-1-intro.png`, `ep-{desktop,phone}-2-land.png` (the settler next to the land just
  discovered), `-3-next.png` (the scenario ladder, while the bots play).
- Oil Springs (`SHOTS=oil`): `oil-{desktop,phone}-1-oil.png` (the uses picture, the panel
  pulsing), `oil-desktop-2-pollution.png` (the track pulsing), `oil-desktop-3-disaster.png`.
- Crop Trust (`SHOTS=crop`): `crop-{desktop,phone}-1-fields.png` (the crops picture),
  `crop-desktop-2-vault.png`, `crop-desktop-3-events.png` (the revealed event named).
