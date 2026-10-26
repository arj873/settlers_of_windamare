# Expansions — the framework contract (F1)

How official expansions (Oil Springs, Crop Trust, Seafarers, Cities & Knights, Traders &
Barbarians incl. Catan for Two, Explorers & Pirates, and their 5-6 player versions) plug into the
engine, the board view, the HUD, the setup screen, the bots and the save format, **each in its own
folder**, so several agents can build them in parallel.

Read `docs/ARCHITECTURE.md` first (the base contract). Rules research: `docs/rules/*.md`
(`scenarios-and-combos.md`, `seafarers.md`, `cities-knights.md`, `traders-barbarians.md`,
`explorers-pirates.md`). Section 9 of each lists that expansion's framework needs; §12 below maps
each need to a framework feature.

Status: framework implemented (F1). Modules: the **demo** (`src/expansions/demo`, the "Oasis" toy
mode, the worked example of every extension point: copy its shape; hidden on the setup screen
unless the URL has `?modes=all`; `?mode=demo` starts it directly), **Oil Springs** and **Crop
Trust** (E1), **Cities & Knights** (`ck`, E3: the largest module; `docs/rules/cities-knights.md`
§11), **Traders & Barbarians** (`tb`, E4: five scenarios + the variants incl. Catan for Two, one
module with a feature per scenario; `docs/rules/traders-barbarians.md` §11).

Modules: `demo`, `oil` (Oil Springs), `crop` (Crop Trust), `seafarers` (Seafarers, all nine
scenarios for 3-6 players, `docs/rules/seafarers.md` §11). Seafarers is the reference for
board-heavy modules: scenario maps on `HexListFrameDef`s, sea-edge pieces (ships) with their own
geometry over `seaEdges`, copy-on-write board changes (fog, placed harbours), setup interrupts,
`setupOrder`, `armySize`, its own win rules through the `wins` hook.

Combinations (C1, `docs/rules/combos.md`): `seack` (mode `seafarers+ck`) and `tbck` (mode
`tb+ck`), small modules that `requires` two expansions, run first (`before`) and add only the
pair's rules (§11).

---

## 1. Vocabulary

| Term          | Meaning                                                                                                                                                 | Example ids                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Expansion** | A rules module (`ExpansionModule`): actions, phases, hooks, maps, scenarios, options, a state slice. Id = its folder name.                              | `seafarers`, `ck`, `tb`, `ep`, `demo`    |
| **Scenario**  | A playable setup: map per player count, VP target, scenario rules (the module reads `settings.scenario`).                                               | `seafarers/newShores`, `demo/oasis`      |
| **Mode**      | A setup-screen tile = a preset of expansions + the scenarios offered. **Combinations exist only as modes** (official combos are per scenario, see §11). | `base`, `seafarers`, `seafarers+ck`      |
| **Variant**   | A small module (`variant: true`) that may be added on top of any mode with `config.expansions` (house rules).                                           | —                                        |
| **Option**    | A typed per-expansion setting (boolean / int / choice), shown on the setup screen, stored in `settings.options[id][key]`.                               | `demo.friendlyRobber`, `tb.harbormaster` |
| **Map**       | A `MapDef` (frame + generator + supply). Base maps keep their ids; module maps are namespaced.                                                          | `baseRandom`, `demo/oasis19`             |

**Namespacing:** everything a module adds to a shared id space is prefixed `<id>/`: action
types, phase kinds, terrains, map ids, frame ids, scenario ids, place modes. Base ids never contain
`/`, so the type system tells them apart (`ExpansionActionType = \`${string}/${string}\``).
`src/expansions/registry.test.ts` enforces it for every module.

---

## 2. Layout and import rules

```
src/engine/expansions/      FRAMEWORK: module types, registry, hook runners, helpers
  types.ts                  ExpansionModule, ExpansionHooks, ModeDef, ScenarioDef, OptionDef, TerrainInfo
  registry.ts               the module list (one import + one entry per expansion) + lookups
  hooks.ts                  hook runners the core rules call (costOf, pieceLimit, terrainKind, ...)
  ext.ts                    extSlice, cloneJson, namespaceOf, NO_ROBBER, doubledToHexId
src/engine/mapLookup.ts     mapById / mapOf / supplyOf / isMapId over base + module maps
src/expansions/<id>/        ONE FOLDER PER EXPANSION, owned by that expansion's agent
  engine/index.ts           export const <id>Module: ExpansionModule   (engine lint rules apply)
  engine/*.ts, *.test.ts    rules, state slice type, tests
  render.ts                 BoardDrawer  (Pixi)    -> listed in src/render/expansions.ts
  ui.ts, <id>.css           HudExtension (DOM)     -> listed in src/ui/expansions.ts
  bots.ts                   BotExtension           -> listed in src/bots/expansions.ts
  *.test.ts                 UI / sim tests (outside engine/, may import bots, ui, game)
```

- `src/expansions/<id>/engine/**` is engine code (same ESLint rules as `src/engine`: no DOM, no
  Pixi, no `Math.random`, no `Date`, no imports from render/ui/game/bots). It imports engine files
  by **deep path** (`../../../engine/topology`) — never `src/engine/index.ts`, `engine.ts` or
  `expansions/registry.ts`. It may import another module's `engine/` only if it `requires` it.
- `render.ts` / `ui.ts` / `bots.ts` import the engine barrel, their layer's helpers and their own
  `engine/`.
- **Module top level** may only read values from `constants.ts`, `maps.ts`, `hex.ts`, `rng.ts`,
  `resources.ts`, `types.ts` and its own folder; call everything else (topology, selectors,
  actions, hooks) only inside functions. Reason: core → registry → modules → core is an import
  cycle, and Vite/Vitest evaluate cycles strictly. `registry.test.ts` imports every module first in
  a fresh module graph to catch violations.

---

## 3. Settings, state, saves (schema v5)

```ts
GameSettings {
  ...v4 fields                     // seed, map, vpToWin, discardLimit, balancedDice, specialBuildPhase, ...
  mode: ModeId                     // 'base' | 'demo' | ...
  expansions: ExpansionId[]        // active modules in registry order; [] = base game
  scenario: ScenarioId | null      // null = no scenario (base maps)
  options: Record<ExpansionId, Record<string, OptionValue>>   // all options of active modules
}
GameState {
  schemaVersion: 5
  ...v4 fields
  ext: Record<ExpansionId, unknown>   // one JSON slice per active module, created by its init
}
Board { hexes, ports, ext?: Record<ExpansionId, unknown> }  // optional per-game static data
```

`createGame({ ..., mode?, expansions?, scenario?, options? })` (`resolveMode` + `resolveSettings`):

1. `mode` (default `'base'`) → its `expansions` + every `requires`; `config.expansions` may add
   only `variant` modules. `conflicts` (either side) → error. Modules sorted into registry order.
2. Scenario = `config.scenario` (must be in `mode.scenarios`) or the mode's first; none for base.
3. Map = the scenario's `mapFor(players)` (`config.map` must be one of `scenario.maps`); without a
   scenario the base map rules (`config.map`, `layout`, `defaultMapFor`).
4. Players must fit the map, the mode, the scenario and every module's `players`.
5. Options: each module's `OptionDef`s, defaults filled, types/ranges checked, unknown keys error.
6. `vpToWin` default = `mode.scenarioVp[scenario]` ?? scenario target + `mode.vpBonus` (or
   `mode.vpToWin` without a scenario, else 10) + `vpBonus` of boolean options that are on
   (`defaultVpToWin`, `optionVpBonus`).
7. Each module's `validate(settings)` may reject the combination.
8. Board from `generateBoard(map, rng, players)`, bank + dev deck from `supplyOf` (map supply →
   `supply` hooks), then each module's `init(draft, rng)` with the continuing game RNG.

**Base games unchanged:** `mode 'base', expansions [], scenario null, options {}, ext {}`; same
RNG draws, logs and results per seed (F1 compared 95 sim games + 5 full traces before/after: identical).

**Migration:** `upgradeState` takes v4 → v5 (base values, `ext: {}`). A v5 save naming an
expansion, mode or scenario this build does not know → `null` (the app offers a new game).
Modules version their own slice (`{ v: 1, ... }`); if a slice shape changes, handle the old
version where the slice is read (or add a migration step in your module and ask for a hook).

---

## 4. The module (`ExpansionModule`)

```ts
interface ExpansionModule {
  id;
  name;
  requires?;
  conflicts?;
  before?: ExpansionId[]; // composition order: run (and wrap) before these modules (§11)
  variant?;
  players?: { min; max };
  terrains?: Record<'<id>/<t>', { kind: 'land' | 'sea' | 'fog'; name; color? }>; // color: setup thumbnail
  maps?: MapDef[];
  scenarios?: ScenarioDef[];
  modes?: ModeDef[];
  options?: OptionDef[];
  validate?(settings): string | null;
  init?(draft, rng): void; // create draft.ext[id]; may adjust the fresh state
  cloneExt?(slice): unknown; // faster copy than cloneJson (hot paths)
  actions?: Record<'<id>/<name>', ExtHandler>; // your action types
  overrides?: { [baseType]?: (draft, action, next) => ActionResult };
  wraps?: { ['<other>/<x>']?: (draft, action, next) => ActionResult }; // another module's actions
  legal?: LegalGenerator; // extra legal actions, any phase
  filterLegal?(state, actions): Action[]; // drop / replace legal actions
  changesRoads?: ['<id>/...']; // your actions that change road lengths / occupancy
  actors?(state): PlayerId[] | undefined; // who acts in your phases
  hooks?: ExpansionHooks; // §5
}
```

- **Dispatch** (`engine.ts`): a type `x/...` goes to module `x`'s `actions` (rejected if `x` is not
  active), wrapped by every active module's `wraps[type]`. A base type goes to the base handler
  wrapped by every active module's override, first module innermost; modules with `before` wrap
  outermost (they see the action first). Then `afterAction` hooks → awards → victory → log trim.
- **Legal**: base generators, then each module's `legal`, then each `filterLegal` in order, then
  the actor filter. **Soundness is the rule:** whatever a handler/override rejects must not be
  generated (filter it). Copy the demo's soundness test.
- **New actions**: `{ type: '<id>/<name>', player, ...json }` (`ExpansionAction`). Declare your
  precise union in your folder; validate every field in the handler (actions also come from the
  UI and, later, the network). Name board locations `vertex` / `edge` / `hex`: the controller turns
  them into highlights and click targets automatically.
- **New phases**: `{ kind: '<id>/<name>', ...json }` (`ExpansionPhase`), deep-copied for drafts.
  Leave them by setting `draft.phase` (e.g. `{ kind: 'main' }` or a stored `resume`). Multi-actor
  phases (gold choice, pillage, progress discard) need `actors`.
- **State**: everything goes in your slice: pieces (`ships: Record<EdgeId, ...>`, `knights`,
  `walls`, `wells`), decks, tracks, per-player data (`players[p]`), per-turn flags (reset them in
  `onStartTurn`). Read it with `extSlice<T>(state, id)`. Never mutate `state.board` or `settings`;
  replacing `draft.board` copy-on-write is allowed (fog reveal).
- **Reusable base pieces**: `continueRoll(draft)` (actions/turn.ts) resumes a roll after your
  interrupt; `advanceSetup(draft)` (actions/setup.ts) finishes a setup step (setup ship);
  `canPlaceRoad`, `canPlaceSettlement`, `isVertexOpen`, `touchesLand`, `edgeTouchesLand`
  (rules/placement.ts); `stealCandidates`, `discardOptions` (actions/robber.ts).

---

## 5. Hook points (`ExpansionHooks`)

Pure functions; `draft` ones mutate only the draft. They run for active modules in settings order.
**additive** = all results combine; **first-wins** = the first module returning a value decides;
**chained** = each module gets the previous value. Base games call none of them.

| Hook                                            | Called from                                                                   | Kind                        | Examples                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setupBuilding(state, index)`                   | `setupRoundAt` (setup placement)                                              | first-wins (over settings)  | C&K / E&P: a setup step places a city / harbour                                                                                                                                                                                                                  |
| `setupOrder(state)` → `{ order, pays }`         | `setupOrderOf` (setup, invariants)                                            | first-wins                  | Cloth for Catan: a third round, only it pays (F3)                                                                                                                                                                                                                |
| `rollDice(draft)`                               | `rollFor` (not with `settings.eventCards`)                                    | first-wins                  | C&K red/yellow + event die, T&B event cards (extras in slice)                                                                                                                                                                                                    |
| `onRoll(draft, roll)` → `Phase?`                | `rollDice`, after the log, before 7/production                                | additive (first phase wins) | C&K barbarians (interrupt for pillage, then `continueRoll`)                                                                                                                                                                                                      |
| `onSeven(draft, pending)` → `Phase?`            | `resolveSeven` (a 7, Robber Attacks card)                                     | first-wins                  | C&K robber inert before the first attack, E&P pirate                                                                                                                                                                                                             |
| `production(state, roll, owed, ctx)`            | `computeProduction`, before the shortage rule                                 | additive                    | wells, C&K city commodities; `ctx = { cityYield, blocked }`                                                                                                                                                                                                      |
| `afterProduction(draft, roll, paid)` → `Phase?` | `produceAndContinue` (dice and event cards); `paid` = what the core just paid | first-wins                  | Seafarers gold choice, demo bloom, C&K commodities + Aqueduct                                                                                                                                                                                                    |
| `cost(state, item, base)`                       | `costOf` (build, dev, HUD)                                                    | chained                     | `'seafarers/ship'`, `'ck/knight'`, changed base costs                                                                                                                                                                                                            |
| `pieceLimit(state, p, kind, base)`              | `pieceLimit` / `piecesLeft` / invariants                                      | chained                     | ships 15, knights per level, E&P harbours                                                                                                                                                                                                                        |
| `vertexBlocked(state, v)`                       | `isVertexOpen`                                                                | additive OR                 | knights, neutral pieces, fortresses                                                                                                                                                                                                                              |
| `edgeBlocked(state, e)`                         | `canPlaceRoad`                                                                | additive OR                 | ships, bridge sites, camels, barbarians                                                                                                                                                                                                                          |
| `blocksRoute(state, v, p)`                      | `canPlaceRoad`, Longest Road                                                  | additive OR                 | C&K foreign knights cut roads                                                                                                                                                                                                                                    |
| `handSize(state, p, base)`                      | `cardsInHand` (7 rule, steal candidates)                                      | chained                     | C&K commodities count                                                                                                                                                                                                                                            |
| `discardLimit(state, p, base)`                  | `discardAmounts`                                                              | chained                     | C&K +2 per city wall                                                                                                                                                                                                                                             |
| `supply(state, base)`                           | `supplyOf` (createGame, invariants, HUD)                                      | chained                     | C&K / E&P no dev deck, scenario bank sizes                                                                                                                                                                                                                       |
| `victoryPoints(state, p)`                       | `publicVictoryPoints`, `victoryPoints`                                        | additive                    | `{ public, hidden?, parts? }`: islands, metropolis, defender, missions; `parts` = named shares for the stats screen (`expansionVictoryParts`)                                                                                                                    |
| `statsCategory(state, action, p)`               | `recordAction` (stats.ts), any action                                         | first-wins                  | `{ gain?, loss? }`: which GainSource / LossSink a hand change counts as; default 'other' for module actions, the base classification for base ones (a missing side keeps it). C&K knights = build; Seafarers gold = production, the fleet at `rollDice` = stolen |
| `bankTradeRatio(state, p, r, base)`             | `bankTradeRatio`                                                              | chained                     | C&K trading house / merchant, Oil Springs                                                                                                                                                                                                                        |
| `routeEdges(state, p)`                          | C&K knight routes (`ck/engine/routes.ts`)                                     | additive                    | Seafarers + C&K: the player's ships carry knights (C1)                                                                                                                                                                                                           |
| `roadLength(state, p, base)`                    | Longest Road award                                                            | chained                     | Seafarers longest trade route                                                                                                                                                                                                                                    |
| `armySize(state, p, base)`                      | Largest Army award (base = knights played)                                    | chained                     | Pirate Islands: no award (0)                                                                                                                                                                                                                                     |
| `onEndTurn(draft, p)`                           | `endTurn`, before SBP / next turn                                             | additive                    | upkeep, lair resolution, disaster phase                                                                                                                                                                                                                          |
| `onStartTurn(draft, p)`                         | `beginTurn` (turn 1, after SBP, Catanian 2)                                   | additive                    | reset per-turn flags (ship moved, fast gold used)                                                                                                                                                                                                                |
| `afterAction(draft, action)`                    | `applyAction`, before awards                                                  | additive                    | fog reveal, island VP, closed-route marking                                                                                                                                                                                                                      |
| `deferVictory(state)`                           | `checkVictory`                                                                | additive OR                 | Oil Springs: the win is declared at the end of the turn                                                                                                                                                                                                          |
| `wins(state, p)` → `boolean \| undefined`       | `checkVictory` (after the awards), instead of the VP-target test              | first-wins                  | Seafarers: fortress + 10 VP, a completed / highest wonder                                                                                                                                                                                                        |

**Variant settings** (V1/V2, `docs/RULES.md` §18-20) apply in expansion modes too. Read the
blocked hex and the city yield from `ctx` (or `hasRobber(settings)`), not `state.robber` / 2, so
`robberMode 'none'` and the Epidemic card stay right. `validate(settings)` may refuse a variant
your module cannot support; the setup screen shows that message and disables Start
(`setupError` in `ui/setup/model.ts`). Map veto is refused with any expansion (slices are built
from the board); see ARCHITECTURE.md "Variants × expansions". With Event Cards the drawn card is
the roll: the `onRoll` hooks run after the draw and before the card's event (an interrupt resumes
with `continueRoll`, which then resolves the card); `rollDice` hooks are not called.

**Special build phase:** a builder whose only possible moves are your module's (`legal` returns
something in `specialBuild`) still gets a step (C&K knights, walls, improvements).

Terrains: `terrainKind(t)` → `'land'` (resources, desert, gold, unknown), `'sea'`, `'fog'`, or your
module's declared kind. Settlements need a vertex touching a land hex; roads need an edge
touching one; only `Resource` terrains produce in the core.

Need something not covered? Prefer `overrides` + `filterLegal` inside your module. If two
expansions need the same new hook, list it in your report (the framework owner adds it to
`hooks.ts` + this table) instead of both overriding the same handler.

### Deliberately not core

- **Commodities (C&K)** are not `Resource`s. Keep them in your slice; count them via `handSize`;
  override / replace `discard`, `steal` and trades for them (own actions + `filterLegal`).
- **Progress / event / fish / BA cards, barbarian track, merchant, missions**: your slice; shuffle
  with the `rng` given to `init` or a `new Rng(draft.rng)` (write `draft.rng` back).
- **Building variants** (walls, metropolis, harbour settlements, pillaged cities): base `pieces`
  keep `settlement | city`; flag the vertex in your slice (an E&P harbour can be a `city` piece
  with a harbour flag: 2 VP and 2 production come for free) and draw the extra with your drawer.
- **No robber** (E&P, T&B main scenario): set `state.robber = NO_ROBBER` (off-board: not drawn,
  never produces a steal) and relax `'robber-position'` in your `BotExtension`.
- **2 players** (Catan for Two, E&P 2-player): allowed when the map, mode and scenario say so
  (`minPlayers: 2`); neutral players live in your slice.

---

## 6. Board model (`maps.ts`, `topology.ts`, `board.ts`)

- **Frames**: `RowsFrameDef { rows, harbors }` (the base hexagons) or
  `HexListFrameDef { id: '<id>/...', hexes, sea?, harbors }` — any set of board hexes (land or
  fog, islands allowed) in layout order, optional `sea` (playable sea: interior seas, open
  ocean), explicit harbour spots `[water, land]`. Every non-board hex touching the board is water
  too (the automatic ring = the frame). E&P tables use doubled columns: `doubledToHexId(c, r, p)`.
- **Topology** (cached per frame id; ids must be unique): `hex`/`vertex`/`edge` as before (all
  ids touching a board hex — counts, orders and land-only adjacency unchanged for base frames),
  plus the sea: `water[h]` now has `vertices`, `edges`, `neighbors`, `playable` (listed in `sea`;
  the ring is not); every vertex/edge info has `seas`; vertices/edges touching only water are in
  `seaVertices`/`seaEdges` (`seaVertex`/`seaEdge`). Helpers: `vertexInfo`, `edgeInfo` (land or
  sea), `isSeaEdge` (touches water: ship edge; coastal edges are both), `isBoardEdge` (road
  edge), `isWaterHex`.
- **Board hexes vs water**: a board hex can have any terrain: resources, desert, `gold`, `fog`
  (undiscovered: hidden content in your slice), `sea` (revealed as sea, or a sea-type cell like an
  E&P fish shoal → your own `'<id>/fishShoal'` with `kind: 'sea'`). Frame water is never in
  `board.hexes`.
- **Maps**: `StdMapDef` (base: `layout 'beginner' | 'random'` + counts) or
  `CustomMapDef { layout: 'custom', generate(rng, players) → { board, robber } }`. Helpers:
  `assembleBoard(topo, terrains, tokens, portKinds)`, `dealTokens(rng, topo, terrains, tokens)`
  (no adjacent 6/8), `randomBoard(rng, 'baseRandom')`. Draw only from `rng` (deterministic).
- **During play**: replace `draft.board` copy-on-write (`{ ...board, hexes: { ...hexes, [h]: tile } }`),
  never mutate it; the BoardView redraws on terrain/token changes.
- **Static per-game data** (rivers/bridge sites, island ids, fishing grounds, lake numbers):
  `board.ext[id]` (generated with the board) or your `MapDef`/`ScenarioDef`.

## 7. Render extension (`src/render/expansions.ts`)

```ts
interface BoardDrawer {
  id;
  terrain?: Record<'<id>/<t>', (g: Graphics, cx, cy, S) => void>;   // fill + motif of one hex (px)
  layers?: { key; z: 'board' | 'pieces' | 'top'; sig(state): string; draw(state, ctx): Container }[];
}
DrawContext { topo, S, colorOf(owner), pt(point), art }   // art = base painters (drawRoad, drawSettlement, ...)
```

The BoardView draws the active modules' terrains in the land layer and their layers in three
slots: `board` (above number tokens, below roads), `pieces` (above buildings), `top` (above the
robber). A layer is rebuilt only when `sig(state)` changes. Highlights, hover and clicks work on
any id the topology knows, sea vertices/edges and water hexes included. Core palette entries exist
for `gold`, `sea`, `fog`; other terrains without a painter are grey.

## 8. HUD and setup extension (`src/ui/expansions.ts`)

```ts
interface HudExtension {
  id;
  panel?(state, view, send): { title; body: HTMLElement } | null; // sidebar section (Bank ... Players); send(action) for its buttons
  buildCards?: {
    mode: '<id>/<x>';
    label;
    actionType;
    glyph?;
    costItem?;
    left?(s, p);
    total?(s, p);
  }[];
  dialog?(state, view, legal, send): { key; title; body; modal } | null; // after base forced dialogs
  hint?(state, view): string | null; // turn pill text in your phases
  impliedActions?: string[]; // clicked on the board, no button
  handCards?(state, view, send): Child[]; // extra cards in the hand bar (C&K commodities)
  offerExtras?(state, side): Child[]; // extra items in the open trade offer's give / want row
}
```

- Expansion-only goods in a player trade: put your part of the offer in your slice and show it
  with `offerExtras` (C&K: `ck/offerTrade` + overrides of acceptTrade / confirmTrade).
- The sidebar section of your panel has the class `sec-ext-<id>`; a tall panel can make it
  shrink and scroll (see `ck.css`).
- The Buy card button is hidden when the game has no development deck (`supply` hook).

- E4: a build card's optional `available(state)` hides it in games that do not use it (one
  module, several scenarios: T&B's Bridge / Wagon / Move knights); the turn pill names an active
  module place mode by its card label (`placeModeLabel`).
- A build card toggles its namespaced `PlaceMode`; the controller (`game/logic.ts`
  `boardActions`) highlights the legal actions of its `actionType` and maps clicks to them.
  Implied actions (setup ship, pirate move, knight move) are highlighted whenever legal.
  `alsoActions` lists more action types of the same mode (Seafarers' Ship card: the setup ship
  and Road Building's free ship); with the mode on, a click prefers them over the implied prompts
  (a coast edge could otherwise only take the road). A module's `hint` may word any phase the
  viewer acts in (not only its own); a namespaced place mode shows its card's label in the pill.
- The card is enabled from legal actions only; its cost comes from `costOf(state, costItem)`.
- CSS: `src/expansions/<id>/<id>.css`, imported by your `ui.ts`; prefix classes with `<id>-`.
- **Setup screen** (generated from the registry): mode tiles from `listModes()` (`status: 'ready'`
  always; `'wip'` / `'demo'` with `?modes=all`), base first and default; an expansion mode shows its
  scenario tiles (map preview) instead of base maps, its options as rule tiles (boolean) or
  selects (int / choice), and clamps seats to the mode's range. `NewGameConfig` carries
  `{ mode, scenario?, options? }`. Dev: `?mode=<id>` starts a game at once.

## 9. Bots, invariants, sim (`src/bots/expansions.ts`)

```ts
interface BotExtension {
  id;
  invariants?(state): Violation[]; // code 'expansion'; checked after every sim step
  relax?: ViolationCode[]; // base checks that do not hold with your module
  steer?(state, player, options, rng): Action | null; // E4: progress pick (bias draws only)
}
```

- The random bot needs nothing: it picks from `legalActions` (module actions included). Keep
  phases finite (no action loops that never end the turn), or sims hit `--max-steps`.
- `steer` (E4): when a module's VP need purposeful play the random bot never finds (T&B
  deliveries, BA knights), return the action that makes progress. It is asked only when the bot's
  `progressBias` draw triggers, so bias 0 stays a plain random pick (and base sims are unchanged).
  `steerAway(types)` (bots/expansions.ts) builds a steer that only skips a module's no-progress
  actions (Seafarers: picking up a ship, cancelling a move), like the bias skips `endTurn`.
- `checkInvariants` = base checks (minus every active module's `relax`) + each module's
  `invariants`. The base VP recount trusts `expansionVictoryPoints`; check your own VP sources.
  Typical relaxes: `'award-mismatch'` (roadLength / blocksRoute change Longest Road),
  `'robber-position'` (NO_ROBBER), `'resource-conservation'` only if you really create cards.
- `pnpm sim -- --mode <id> [--scenario <id>/<s>] [--expansion v1,v2] [--option <id>.<key>=<value>]`.
  Dumps record the mode setup. Before marking a mode `ready`:
  `nice -n 19 pnpm sim -- --mode <id> --games 200 --bias 0.5` must report `OK: no violations`.

---

## 10. How to add an expansion (step by step)

Branch from **`expansions`** (the integration branch; everything merges there, not into `main`).
Use `src/expansions/demo` as the template: each step has a demo counterpart.

1. **Read** `docs/rules/<expansion>.md` (§9 implementation notes, §10 open questions) and this
   file. Ids: `oil` (Oil Springs), `crop` (Crop Trust), `seafarers`, `ck`, `tb`, `ep`.
2. **Module**: create `src/expansions/<id>/engine/index.ts` exporting `<id>Module` with `id`,
   `name`, `players`, one `ModeDef` (`status: 'wip'` until playable end to end), and as needed
   `terrains`, `maps`, `scenarios`, `options`, `validate`.
3. **Register** (the only shared engine edit): one import + one entry at the end of
   `builtinModules()` in `src/engine/expansions/registry.ts`. `registry.test.ts` now checks your
   ids and imports.
4. **State**: define your slice type (`engine/state.ts`), create it in `init`, read it with
   `extSlice`. Add `cloneExt` if the slice is big (sim speed).
5. **Rules**: actions + `legal`, phases + `actors`, hooks (§5), overrides + `filterLegal` only
   where no hook fits. Validate everything in handlers. Tests next to the code: one per rule,
   plus a soundness test (every legal action accepted) like `demo/engine/demo.test.ts`.
6. **Board**: scenario maps as `CustomMapDef` with a `HexListFrameDef` (data from the rules doc;
   assert the printed component counts in a test).
7. **Render**: `src/expansions/<id>/render.ts` → `BoardDrawer`; append it to
   `src/render/expansions.ts`.
8. **HUD**: `src/expansions/<id>/ui.ts` → `HudExtension`; append it to `src/ui/expansions.ts`.
   UI tests in your folder (`// @vitest-environment jsdom`, see `demo/ui.test.ts`).
9. **Bots**: `src/expansions/<id>/bots.ts` → `BotExtension`; append it to
   `src/bots/expansions.ts`. Sim until clean (§9). See `demo/bots.test.ts`.
10. **Play it**: `pnpm dev`, open `/?mode=<id>` (or `/?modes=all` → setup screen); `&scenario=<id>/<s>`
    picks a scenario, `&autoplay=4bots&speed=20` watches bots play.
11. **Ship**: flip the mode to `'ready'`, write the engine status per rule into
    `docs/rules/<id>.md`, run `nice -n 19 pnpm typecheck && nice -n 19 pnpm lint && nice -n 19 pnpm test`,
    commit on your branch. List framework needs (new hooks, core changes) in your report.

**5-6 player versions**: more maps / scenario entries in the same module (`players` up to 6,
`specialBuildPhase` defaults on for 5+), or a module that `requires` the 3-4 one.

## 11. Combinations

Official combinations are per scenario (`docs/rules/scenarios-and-combos.md` part C). Built (C1,
engine status per rule in `docs/rules/combos.md`):

| Mode           | Module  | Composes          | Scenarios (VP)                                                                  |
| -------------- | ------- | ----------------- | ------------------------------------------------------------------------------- |
| `seafarers+ck` | `seack` | `ck`, `seafarers` | Heading for New Shores, Through the Desert (scenario + 2: 16), 3-6 players      |
| `tb+ck`        | `tbck`  | `ck`, `tb`        | Fishermen 13, Rivers 13, Caravans 15, Traders & Barbarians 15, variants 13; 3-6 |

How a combination is built:

- **A combination is a mode of a small combo module** (`src/expansions/<pair>/`) that `requires`
  both expansions and declares one mode listing exactly the suitable scenarios, with `vpBonus` or
  per-scenario `scenarioVp`. The two expansion modules run unchanged. Anything not listed as a
  mode cannot be started; `validate` refuses other scenarios.
- **Composition order is explicit:** the combo declares `before: [a, b]`, so its hooks, `legal` and
  `filterLegal` run first and its overrides / wraps are outermost. Where both modules define a
  first-wins hook (`afterProduction`, `onSeven`, `rollDice`), the combo's hook calls theirs in
  the order the rules want and returns the result (seack: C&K commodities → Seafarers gold →
  Aqueduct; tbck: C&K → fish). Its mode test asserts `settings.expansions` (`[seack, ck,
seafarers]`).
- **Pair rules** are the combo's own actions (`seack/chasePirate`, `tbck/chaseBarbarian`), `wraps`
  of the composed modules' actions (`seafarers/pickShip`, `tb/bid`, `ck/pickEdge`), base
  `overrides`, `filterLegal`, and hooks such as `routeEdges` (ships carry knights).
- **Officially impossible** pairs go in `conflicts`: `ep` declares `conflicts: ['seafarers']`.
  Oil Springs / Crop Trust combine with nothing but the base (and Oil Springs 5-6).
- Write modules so they compose: use the helpers (`costOf`, `pieceLimit`, `cardsInHand`,
  `isVertexOpen`, `victoryPoints`) instead of constants, never assume you are the only module
  (invariants: check your own VP hook, not `expansionVictoryPoints`), and read another module's
  state only through its exported selectors (`requires` it).
- **Known limit:** T&B switches its features on by its own scenario ids and Seafarers its rules
  by its own scenario ids, so a T&B scenario on a Seafarers map (T&B + Seafarers, the 2025 sheets)
  needs a seam in one of them first (`docs/rules/combos.md` §3).

## 12. Coverage of the rules docs' framework needs

| Need (rules doc §9)                                                 | Framework feature                                                                                  |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Explicit sea / frame / fog cells, gold, edge kinds (Seafarers, E&P) | `HexListFrameDef`, `water[h].playable`, `seaEdges`, `isSeaEdge`, `terrainKind`, `gold`/`fog`/`sea` |
| Ships on edges, closed routes, moved-this-turn (Seafarers)          | slice + `edgeBlocked` + `onStartTurn` + `afterAction`; `roadLength` for trade routes               |
| Setup ship instead of road (Seafarers)                              | own setup action + `advanceSetup`                                                                  |
| Robber or pirate on a 7 / knight (Seafarers, E&P)                   | extra `legal` in `moveRobber`, own steal phase; `onSeven` for E&P                                  |
| Gold choice after production (Seafarers)                            | `afterProduction` → phase + `actors`                                                               |
| Fog reveal, island VP (Seafarers, E&P)                              | copy-on-write board, `afterAction`, `victoryPoints`                                                |
| Event die + red/yellow dice, barbarian track, pillage (C&K)         | `rollDice`, `onRoll` interrupt + `continueRoll`, `actors`                                          |
| Commodities, walls (+2 hand limit), knights on vertices (C&K)       | slice, `handSize`, `discardLimit`, `vertexBlocked`, `blocksRoute`                                  |
| City setup round, no dev cards, VP 13 (C&K)                         | `setupBuilding`, `supply`, scenario `vpToWin` — **done (E3, `src/expansions/ck`)**                 |
| Event cards instead of dice, bridges, lake, fishing grounds (T&B)   | core Event Cards (V1), `edgeBlocked`, `board.ext`, `afterProduction` — **done (E4, `tb`)**         |
| Harbormaster +1 VP target, event cards vs balanced dice (T&B)       | `OptionDef.vpBonus`, `validate` — **done (E4)**                                                    |
| Catan for Two: 2 players + neutrals (T&B)                           | map/mode `minPlayers: 2`, neutrals in slice + blocker hooks — **done (E4)**                        |
| T&B trade-hex plazas (centre vertex + spokes)                       | frame `plazas` (F2): `v:q,r,C` vertices + `e:q,r,C<corner>` spoke edges — **done (E4)**            |
| No robber, harbour settlements, missions, per-scenario VP (E&P)     | `NO_ROBBER`, slice flag on a city piece, `victoryPoints`, scenario `vpToWin`                       |
| Combination matrix, VP increments                                   | modes only, `conflicts`, `vpBonus`, `scenarioVp` — **done for Seafarers + C&K, T&B + C&K (C1)**    |
| Combination rules on top of two modules                             | combo module: `requires`, `before` (order), `wraps`, `routeEdges` (C1)                             |

**Known gaps (framework follow-ups, not blocking the first modes):**

- **Setup rounds other than 2**: done, the `setupOrder` hook (Cloth for Catan's third round; E&P's
  harbour-first order can use it too). An expansion phase may interrupt setup (a gold pick).
- ~~T&B trade-hex plazas~~ — done (F2, E4): a frame's `plazas: { hex, corners }[]` adds the
  centre vertex `v:q,r,C` and spoke edges `e:q,r,C<corner>` to its topology (plain vertices /
  edges: roads, pieces, highlights, clicks; the hex's 6 corners / sides are unchanged).
- **Bank-trade HUD ratios** still show harbour ratios only; expansions with `bankTradeRatio` hooks
  should check `bestRatios` in `ui/model.ts` when they need it.
- **Secret expansion state online:** `viewFor` passes `state.ext` unmasked (C&K progress hands
  and stack orders, oil is public anyway). Online play is base-only for now; a module masking
  hook is needed before an expansion with secrets goes online.
- **Statistics** count resources only; expansion goods (commodities, oil, crops, gold, fish) have none.
- **Combinations (C1):** Seafarers + C&K and T&B + C&K are built (§11). Not built: T&B +
  Seafarers (the 2025 sheets need T&B features on Seafarers scenarios: a seam in `tb` or
  `seafarers`), Barbarian Attack + C&K, Catan for Two + C&K, the T&B × T&B sheets (T6), E&P
  combinations (sibling branch). Details in `docs/rules/combos.md` §3.

## 13. File ownership for parallel expansion agents

| Path                                                                         | Owner                  | Other agents may                                                                                       |
| ---------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/expansions/<id>/**`                                                     | that expansion's agent | read; import `engine/` only when `requires`-ing it                                                     |
| `docs/rules/<id>.md`                                                         | that expansion's agent | read                                                                                                   |
| `src/engine/expansions/registry.ts`                                          | framework              | **append** one import + one entry in `builtinModules()`                                                |
| `src/render/expansions.ts`, `src/ui/expansions.ts`, `src/bots/expansions.ts` | framework              | **append** one import + one list entry                                                                 |
| `src/engine/expansions/{types,hooks,ext}.ts`, `docs/EXPANSIONS.md`           | framework              | not edit; request hooks in the report (a tiny additive hook with a test is OK if blocking, mention it) |
| `src/engine/**` (base rules), `src/engine/types.ts`                          | base / framework       | not edit: your types live in your folder                                                               |
| `src/render/BoardView.ts`, `src/ui/hud.ts`, `src/ui/setup/**`, `src/game/**` | base / framework       | not edit; if unavoidable, minimal and in the report                                                    |
| `src/bots/{index,runner,sim,invariants}.ts`                                  | base / framework       | not edit                                                                                               |
| `KANBAN.md`                                                                  | orchestrator           | never                                                                                                  |

So expansion branches only conflict on adjacent appended lines in the four list files; the
orchestrator merges into `expansions` keeping both lines. Combination modes are declared inside
the later module's folder, so they add no shared edits either.
