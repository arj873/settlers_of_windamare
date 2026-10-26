# Expansions — the framework contract (F1)

How official expansions (Seafarers, Cities & Knights, Traders & Barbarians, Explorers & Pirates,
the small scenarios, and every 5-6 player version) plug into the engine, the board view, the HUD,
the setup screen, the bots and the save format, **each in its own folder**.

Read `docs/ARCHITECTURE.md` first (the base game contract). This file only adds to it.
Rules research per expansion: `docs/rules/*.md`.

Status: framework implemented (F1). The only module is the **demo** (`src/expansions/demo`, the
"Oasis" toy mode), kept as the worked example of every extension point. It is hidden on the setup
screen unless the URL has `?modes=all`.

---

## 1. Vocabulary

| Term          | Meaning                                                                                                                                                      | Example ids                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| **Expansion** | A rules module: actions, phases, hooks, maps, scenarios, options, state slice. Id = folder name.                                                             | `seafarers`, `ck`, `tb`, `ep`, `demo` |
| **Scenario**  | A playable setup of one or more expansions: map(s) per player count, VP target, scenario rules (read by the module through `settings.scenario`).             | `seafarers/newShores`, `demo/oasis`   |
| **Mode**      | A setup-screen tile = a preset of expansions + its scenarios. Modes are how combinations ship (`seafarers+ck` is its own mode, declared by whoever does it). | `base`, `seafarers`, `demo`           |
| **Option**    | A typed per-expansion setting (boolean / int / choice) shown on the setup screen and stored in `settings.options[expansionId][key]`.                         | `demo.friendlyRobber`                 |
| **Map**       | A `MapDef` (frame + generator + supply). Base maps keep their ids; expansion maps are namespaced.                                                            | `baseRandom`, `demo/oasis19`          |

**Namespacing rule:** everything an expansion adds that lives in a shared id space is prefixed with
`<expansionId>/`: action types, phase kinds, terrains, map ids, frame ids, scenario ids, mode ids
other than the bare expansion id, log-free. Base ids never contain `/`, so the type system tells
them apart (`ExpansionActionType = \`${string}/${string}\``).

---

## 2. Folder layout and ownership

```
src/engine/expansions/      FRAMEWORK (F1): module types, registry, hook runners, ext helpers
  types.ts                  ExpansionModule, ExpansionHooks, ModeDef, ScenarioDef, OptionDef
  registry.ts               the module list (one import + one entry per expansion) + lookups
  hooks.ts                  hook runners the core rules call (costOf, pieceLimit, ...)
  ext.ts                    extSlice(), cloneJson(), namespacing helpers
src/expansions/<id>/        ONE FOLDER PER EXPANSION, owned by that expansion's agent
  engine/                   pure rules (same lint rules as src/engine: no DOM, no Math.random)
    index.ts                export const <id>Module: ExpansionModule
    *.test.ts
  render.ts                 BoardDrawer (Pixi)            -> listed in src/render/expansions.ts
  ui.ts                     HudExtension (DOM)            -> listed in src/ui/expansions.ts
  bots.ts                   BotExtension (invariants)     -> listed in src/bots/expansions.ts
```

Import rules (lint-enforced where possible):

- `src/expansions/<id>/engine/**` may import `src/engine/**` (deep paths) and its own folder. Never
  `render`, `ui`, `game`, `bots`, another expansion's folder (except a `requires` dependency's
  `engine/`), `src/engine/index.ts`, `src/engine/engine.ts` or `src/engine/expansions/registry.ts`.
- `render.ts` / `ui.ts` / `bots.ts` may import the engine barrel, their own layer's helpers and
  their own `engine/`.
- **Module top level:** only read values from `constants.ts`, `maps.ts`, `hex.ts`, `rng.ts`,
  `resources.ts`, `types.ts` and your own folder. Everything else (topology, selectors, actions,
  hooks) only inside functions. The registry imports every module, and the core imports the
  registry, so there is an import cycle; this rule keeps it harmless. `registry.test.ts` imports
  each module first in a fresh module graph to catch violations.

---

## 3. Settings, state, save format (schema v5)

```ts
GameSettings {
  ...v4 fields                      // seed, map, vpToWin, discardLimit, balancedDice, ...
  mode: ModeId                      // 'base' | 'demo' | ...           (v5)
  expansions: ExpansionId[]         // active modules, registry order  (v5) [] = base game
  scenario: ScenarioId | null       // null = no scenario (base maps)  (v5)
  options: Record<ExpansionId, Record<string, OptionValue>>   // every option of every active
                                    // expansion, defaults filled in   (v5)
}
GameState {
  schemaVersion: 5
  ...v4 fields
  ext: Record<ExpansionId, Json>    // one namespaced slice per active expansion (v5)
}
```

- `createGame({ ..., mode?, expansions?, scenario?, options? })`. `mode` defaults to `'base'`.
  Active expansions = the mode's list plus `config.expansions` (variants on top of a mode), with
  every `requires` added, checked against `conflicts`, sorted into registry order. Scenario
  defaults to the mode's first. A scenario picks the map for the player count (`config.map` must
  then be one of the scenario's maps); without a scenario the base map rules apply. `vpToWin`
  defaults to the scenario's, then 10. Player count must fit the map, the mode, the scenario and
  every expansion. Options are validated against each module's `OptionDef`s (unknown key = error).
- `state.ext[id]` is created by the module's `init(draft, rng)`. Per-player data lives inside the
  slice (`slice.players[p]`). Read it with `extSlice<T>(state, id)`. The slice is deep-copied for
  every action draft (`cloneJson`), or by `module.cloneExt` if the module provides a faster one.
- **Base game unchanged:** a base game has `mode 'base', expansions [], scenario null, options {},
ext {}`. Same RNG draws, same logs, same results per seed (the sim baselines are compared in F1).
- **Migration v4 → v5** (`migrate.ts`): add the four settings with base values and `ext: {}`. A v5
  save naming an expansion or mode this build does not know is rejected (`upgradeState` → null).
  An expansion that changes its slice shape bumps its own `module.version` and provides
  `module.migrate(slice, fromVersion)`; versions are stored in `state.ext[id]` by convention
  (`{ v: 1, ... }`), not in the global schema.

---

## 4. The module (`ExpansionModule`, `src/engine/expansions/types.ts`)

```ts
interface ExpansionModule {
  id: ExpansionId; // = folder name, no '/'
  name: string;
  requires?: ExpansionId[]; // auto-activated (e.g. a 5-6P module requires its base)
  conflicts?: ExpansionId[];
  players?: { min: number; max: number };
  maps?: MapDef[]; // ids '<id>/...'
  scenarios?: ScenarioDef[]; // ids '<id>/...'
  modes?: ModeDef[]; // setup-screen tiles this module contributes
  options?: OptionDef[];
  init?(draft: GameState, rng: Rng): void; // create state.ext[id]; may adjust bank, decks
  cloneExt?(slice: Json): Json; // faster deep copy (optional)
  actions?: Record<ExpansionActionType, ExtHandler>; // new namespaced action types
  overrides?: { [K in BaseActionType]?: Override<K> }; // wrap a base handler: (draft, action, next)
  legal?: LegalGenerator; // extra legal actions (any phase)
  filterLegal?(state, actions: Action[]): Action[]; // drop/replace base legal actions
  changesRoads?: readonly string[]; // ext action types that change road lengths
  actors?(state): PlayerId[] | undefined; // who may act in this module's phases
  hooks?: ExpansionHooks;
}
```

**Dispatch** (`engine.ts`): `applyAction` finds the handler: an action type `x/...` goes to module
`x`'s `actions` (rejected if `x` is not active); a base type goes to the base handler wrapped by
every active module's `overrides[type]` (in settings order: the first module is innermost). Then
`afterAction` hooks, awards, victory, log trim as before. `legalActions` = base generators, then
every module's `legal`, then each module's `filterLegal` in order, then the actor filter.

**Soundness stays the rule:** whatever an override or hook rejects must also be removed by
`filterLegal` (or never generated). `legal.test.ts`-style soundness tests run per module (the
demo has one to copy).

**New phases** are `{ kind: '<id>/<name>', ...json }` (`ExpansionPhase`). They are deep-copied
for drafts. `actingPlayers` asks `module.actors(state)` for them (default: `turn.current`). Leave
them by setting `draft.phase` (usually to `{ kind: 'main' }` or a stored `resume`).

**New actions** are `{ type: '<id>/<name>', player, ...json }` (`ExpansionAction`). Declare your
precise union in your folder (`type DemoAction = { type: 'demo/buildWell'; player; vertex }`); it
is assignable to `Action`. Use the field names `vertex`, `edge`, `hex` for board locations: the
controller turns legal actions with these fields into board highlights and clicks.

---

## 5. Hook points (`ExpansionHooks`)

All hooks are pure functions of their arguments (the `draft` ones mutate only the draft). They
run for active modules in settings order. **Additive** hooks combine; **first-wins** hooks use the
first module that returns a value (combinations that both define one must say who wins — put it
in your `conflicts` or coordinate).

| Hook                                | Called from                                        | Kind        | Purpose / examples                                                                       |
| ----------------------------------- | -------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `setupBuilding(state, index)`       | `placeSetupSettlement`                             | first-wins  | C&K: 2nd setup building is a city                                                        |
| `rollDice(draft)`                   | `rollDice`                                         | first-wins  | custom dice (C&K red/white + event die: return the two numbered dice, store more in ext) |
| `onRoll(draft, roll)`               | `rollDice`, before 7 / production                  | additive    | C&K event die: barbarian ship advances, progress card draws                              |
| `onSeven(draft, pending)`           | `rollDice` on a 7                                  | first-wins  | return a Phase to replace discard/robber (C&K: no robber before the first attack)        |
| `production(state, roll, owed)`     | `computeProduction`, before the bank-shortage rule | additive    | mutate `owed[p]` (wells, C&K commodities go to ext; gold counted in ext)                 |
| `afterProduction(draft, roll)`      | `rollDice` after paying                            | first-wins  | return a Phase instead of `main` (Seafarers gold choice, demo bloom)                     |
| `cost(state, item, base)`           | `costOf()` (build, dev, UI)                        | chained     | change a base cost or price your own item (`'<id>/ship'`)                                |
| `pieceLimit(state, p, kind, base)`  | `pieceLimit()` / `piecesLeft`                      | chained     | piece supply (ships 15, knights, ...)                                                    |
| `vertexBlocked(state, v)`           | `isVertexOpen` (distance rule)                     | additive OR | a knight / harbour / fortress occupies the vertex                                        |
| `edgeBlocked(state, e)`             | `canPlaceRoad`                                     | additive OR | a ship (or a river without a bridge) occupies the edge                                   |
| `victoryPoints(state, p)`           | `publicVictoryPoints`, `victoryPoints`             | additive    | `{ public, hidden? }`: islands, metropolis, defender, chits                              |
| `bankTradeRatio(state, p, r, base)` | `bankTradeRatio()`                                 | chained     | C&K trading house, Oil Springs, merchant                                                 |
| `roadLength(state, p, base)`        | Longest Road (`awards.ts`)                         | chained     | Seafarers: longest trade route (roads + ships)                                           |
| `onEndTurn(draft, p)`               | `endTurn`, before the next turn                    | additive    | per-turn upkeep, ship-moved flags, demo oasis income                                     |
| `onStartTurn(draft, p)`             | every turn start (incl. after SBP)                 | additive    | reset per-turn ext flags                                                                 |
| `afterAction(draft, action)`        | `applyAction`, before awards                       | additive    | catch-all (fog reveal after a ship/road, harbour checks)                                 |

Plus the module-level `init`, `actions`, `overrides`, `legal`, `filterLegal`, `actors`,
`changesRoads` (§4). Anything not covered: override the base action handler (`overrides`) and
filter its legal actions. If two expansions need the same new hook point, ask the framework owner
(add it to `hooks.ts` + this table) instead of both overriding the same handler.

Base value helpers every expansion should use instead of the constants: `costOf(state, item)`,
`pieceLimit(state, p, kind)`, `bankTradeRatio(state, p, r)`, `victoryPoints`, `isVertexOpen`.

### Things that are deliberately NOT core

- **Commodities (C&K)** are not `Resource`s: base hands, the bank and trades stay 5-resource.
  C&K keeps commodities in its slice and overrides `discard` / `steal` / trades (or adds its own
  actions). The 7-card limit counts them through C&K's `onSeven`.
- **Progress cards, event cards, barbarian track, merchant, fish, camels** live in their module's
  slice; deck helpers: `Rng.shuffle` and `pop()` like `devDeck`.
- **Ships, knights, walls, metropolises, harbour settlements, crews/settlers** are module pieces
  stored in the slice (`slice.ships: Record<EdgeId, PlayerId>`, `slice.knights: Record<VertexId, ...>`,
  `slice.walls: VertexId[]`). Base `pieces` keeps only roads and settlements/cities. The module
  makes them interact with base rules through `vertexBlocked` / `edgeBlocked` / `roadLength` /
  `production` and draws them with its `BoardDrawer`.

---

## 6. Board model (`maps.ts`, `topology.ts`, `board.ts`)

- **Frames** come in two forms: `{ rows }` (the base hexagons) or `{ hexes, sea?, harbors }` — an
  explicit list of board hexes (land or fog; any shape, islands allowed), optional extra sea hexes
  (default: every non-board hex touching the board), and explicit harbour spots `[water, land]`.
  Frame ids of expansions are namespaced.
- **Topology** covers board hexes (`hex`, `vertex`, `edge`: anything touching a board hex, as
  before) **and the sea**: every water hex now has `vertices` / `edges`, every vertex/edge info has
  `seas` (adjacent water hexes), and vertices/edges that touch only sea are in `seaVertices` /
  `seaEdges` (`seaVertex` / `seaEdge` records). Helpers: `vertexInfo(t, id)`, `edgeInfo(t, id)`
  (land or sea), `isSeaEdge(t, e)` (touches a sea hex: ship edge), `isLandEdge` (`isBoardEdge`:
  road edge). Coastal edges are both. Base fields, counts and orders are unchanged.
- **Terrain** gains `'gold'`, `'sea'` (a board hex revealed as sea), `'fog'` (undiscovered) in the
  core, plus namespaced expansion terrains (`'demo/oasis'`). Only `Resource` terrains produce in
  the core; gold production is a Seafarers hook. `isResource(terrain)` tells.
- **Map generators:** `MapDef.layout: 'beginner' | 'random' | 'custom'`. A `'custom'` map has
  `generate(rng, players) → { board, robber }`; helpers in `board.ts`: `assembleBoard(topo,
terrains, tokens, portKinds)`, `shuffleTokens(...)` (no adjacent 6/8), the `MapDef` supply
  fields as before.
- **Board changes during play** (fog reveal, scenario events) are allowed **copy-on-write only**:
  `draft.board = { ...draft.board, hexes: { ...draft.board.hexes, [h]: tile } }`. Never mutate the
  shared object (ARCHITECTURE.md §7). The BoardView redraws when the terrain/token signature
  changes.
- **Static scenario data** (rivers = edge properties, island ids, fixed frames) belongs in the
  module's `MapDef`/`ScenarioDef` (code), or in `board.ext?.[id]` if it varies per game
  (generated with the board). `board.ext` is optional JSON, shared like the rest of `board`.
- **Harbours anywhere:** `Port` already names its edge, vertices and water hex; custom frames list
  them explicitly.

---

## 7. Render extension (`src/render/expansions.ts`)

```ts
interface BoardDrawer {
  id: ExpansionId;
  /** Custom terrains: fill + motif for one hex, in pixels (S = hex size). */
  terrain?: Record<string, (g: Graphics, cx: number, cy: number, S: number) => void>;
  /** Extra layers. `sig(state)` decides when `draw` reruns (cheap string). */
  layers?: { key: string; z: 'board' | 'pieces' | 'top'; sig(state): string;
             draw(state, ctx: DrawContext): Container }[];
}
DrawContext { topo, S, colorOf(owner): number, pt(info): [x, y], art }   // art = base piece painters
```

`BoardView` draws, for each active expansion in `state.settings.expansions`, its custom terrains in
the land layer, and its layers in three z-slots: `board` (above tokens, below roads), `pieces`
(above buildings) and `top` (above the robber). Highlights, hover and clicks work on any id the
topology knows, sea edges/vertices included (`vertexInfo`/`edgeInfo`).

Core palette entries exist for `gold`, `sea`, `fog`; a terrain with no painter is drawn grey.

## 8. HUD and setup extension (`src/ui/expansions.ts`)

```ts
interface HudExtension {
  id: ExpansionId;
  /** Sidebar section (between Bank and Players). null = none right now. */
  panel?(state, view): { title: string; body: HTMLElement } | null;
  /** Build-bar buttons. `mode` is a namespaced PlaceMode; clicking toggles it like Road. */
  buildCards?: {
    mode: PlaceMode;
    label: string;
    actionType: string;
    glyph?: GlyphName;
    total?(state, p): number;
    left?(state, p): number;
  }[];
  /** A dialog for this module's phases / actions. First non-null wins; base forced dialogs first. */
  dialog?(
    state,
    view,
    legal,
    send: (a: Action) => void,
  ): { key; title; body: Child[]; modal } | null;
  /** Turn-pill hint text for this module's phases. */
  hint?(state, view): string | null;
  /** Action types that are clicked on the board without a button (like moveRobber). */
  impliedActions?: readonly string[];
}
```

- `PlaceMode` = `'road' | 'settlement' | 'city' | '<id>/<name>'`. The controller's
  `boardActions` maps a namespaced place mode to its build card's `actionType`.
- **Setup screen**: mode tiles come from `listModes()` (engine registry): `status: 'ready'` modes
  always, `'wip'`/`'demo'` only with `?modes=all`. The base mode stays first and the default.
  Picking a mode shows its scenarios as tiles (or the base map tiles for the base mode) and its
  expansions' options as rule tiles (booleans) / steppers (ints) / chips (choices), generated from
  `OptionDef` (label + description). `NewGameConfig` = `{ mode, scenario?, options?, map, ... }`.
- Base game UI is unchanged for base games.

## 9. Bots, invariants, sim (`src/bots/expansions.ts`)

```ts
interface BotExtension {
  id: ExpansionId;
  /** Extra invariant checks after every sim step. */
  invariants?(state): Violation[];
  /** Base invariant codes that do not hold under this module (e.g. 'award-mismatch' when roadLength changes). */
  relax?: readonly ViolationCode[];
}
```

- The random bot needs nothing: it picks from `legalActions`, which includes module actions.
- `checkInvariants(state)` runs the base checks (minus every active module's `relax` codes) and
  then each active module's `invariants`. The base VP recount adds the engine's
  `expansionVictoryPoints(state, p)`; a module checks its own VP sources in its `invariants`.
- `pnpm sim -- --mode demo [--scenario demo/oasis] [--expansion x,y] [--option demo.friendlyRobber=false]`.
  Dumps record mode/expansions/scenario/options. Every module should run clean on
  `pnpm sim -- --mode <id> --games 200 --bias 0.5` before it is marked `ready`.

---

## 10. How to add an expansion (step by step)

Use `src/expansions/demo` as the template; every step below has a demo counterpart.

1. **Read** `docs/rules/<expansion>.md` and this file. Pick the id (`seafarers`, `ck`, `tb`, `ep`,
   `oil`, `crop`, ...).
2. **Create** `src/expansions/<id>/engine/index.ts` exporting `<id>Module: ExpansionModule` with
   `id`, `name`, `players`, one `ModeDef` (`status: 'wip'` until it is playable) and, if needed,
   `scenarios`, `maps`, `options`.
3. **Register** it: one import + one entry at the end of `builtinModules()` in
   `src/engine/expansions/registry.ts`. (That line is the only shared engine edit.)
4. **State:** define your slice type in `engine/state.ts`, create it in `init`, read it with
   `extSlice<MySlice>(state, '<id>')`. Pieces, decks, tracks, per-player data all go here.
5. **Rules:** add actions (`'<id>/<name>'`) with handlers in `actions` and generators in `legal`;
   add phases (`'<id>/<name>'`) and `actors` if several players act; plug into base rules through
   `hooks`; wrap base actions with `overrides` + `filterLegal` only when no hook fits. Validate
   everything in handlers, like base handlers do. Write tests next to the code: every rule gets a
   test, plus a soundness test (every legal action is accepted, see the demo's).
6. **Board:** for scenario maps add a `MapDef` with a custom frame (`{ hexes, sea, harbors }`) and
   `layout: 'custom'` + `generate`. Use `terrain` names from the core (`gold`, `sea`, `fog`) or
   your own `'<id>/<terrain>'`.
7. **Render:** `src/expansions/<id>/render.ts` exports a `BoardDrawer` (pieces layer, custom
   terrains); add it to `src/render/expansions.ts` (one import + one entry).
8. **HUD:** `src/expansions/<id>/ui.ts` exports a `HudExtension` (panel, build cards, dialogs,
   hints, implied actions); add it to `src/ui/expansions.ts`. Expansion CSS goes in
   `src/expansions/<id>/<id>.css`, imported from `ui.ts`.
9. **Bots:** `src/expansions/<id>/bots.ts` exports a `BotExtension` (invariants, relax); add it
   to `src/bots/expansions.ts`. Run `nice -n 19 pnpm sim -- --mode <id> --games 200 --bias 0.5`
   until it is clean.
10. **Ship:** flip the mode to `status: 'ready'` when it is playable end to end (setup tile →
    game → winner), document the module's decisions in `docs/rules/<id>.md` (engine status per
    rule) and list any new framework need in your report instead of editing framework files.

**Combinations** (Seafarers + C&K, T&B scenarios on Seafarers, 5-6P): a combination is a mode
with `expansions: ['seafarers', 'ck']` declared by the later of the two (or a small `combo`
module). Modules must therefore never assume they are alone: use the hook helpers (`costOf`,
`pieceLimit`, `isVertexOpen`, ...) instead of the constants, read other modules' state only
through their exported selectors, and list real incompatibilities in `conflicts`. 5-6 player
versions are either more maps/scenario entries in the same module (preferred) or a module that
`requires` the 3-4 one.

## 11. File ownership for parallel expansion agents

| Path                                                                                                                                                    | Owner                  | Others may                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/expansions/<id>/**`                                                                                                                                | that expansion's agent | read only                                                                                                 |
| `docs/rules/<id>.md`                                                                                                                                    | that expansion's agent | read only                                                                                                 |
| `src/engine/expansions/registry.ts`                                                                                                                     | framework              | **append** one import + one list entry for their module                                                   |
| `src/render/expansions.ts`, `src/ui/expansions.ts`, `src/bots/expansions.ts`                                                                            | framework              | **append** one import + one list entry                                                                    |
| `src/engine/expansions/{types,hooks,ext}.ts`, `docs/EXPANSIONS.md`                                                                                      | framework              | not edit; ask for a new hook in the report (or a tiny additive hook with a test, mentioned in the report) |
| `src/engine/**` (base rules), `src/render/BoardView.ts`, `src/ui/hud.ts`, `src/ui/setup/**`, `src/game/**`, `src/bots/{index,runner,sim,invariants}.ts` | base / framework       | not edit; if unavoidable, minimal and in the report                                                       |
| `src/engine/types.ts`                                                                                                                                   | framework              | not edit: your types live in your folder                                                                  |
| `KANBAN.md`                                                                                                                                             | orchestrator           | never                                                                                                     |

Merge conflicts between expansion branches are then limited to adjacent appended lines in the four
list files, which the orchestrator resolves by keeping both.

Suggested ids and order: `oil` (Oil Springs), `crop` (Crop Trust), `seafarers`, `ck` (Cities &
Knights), `tb` (Traders & Barbarians, incl. `tb/two` Catan for Two), `ep` (Explorers & Pirates).
5-6P versions: extra scenario maps inside the same module.
