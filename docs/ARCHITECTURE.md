# Architecture — the contract

Browser Catan clone (base game, 3–4 players). TypeScript strict, PixiJS v8, Vite, Vitest, pnpm.
**If you change a public type in `src/engine/types.ts`, update this file in the same commit.**
Game rules (sourced, with engine status per rule): `docs/RULES.md`.

## 1. Layers

```
src/engine/  pure rules engine        no DOM, no Pixi, no Math.random, no Date (lint-enforced)
src/bots/    bots + headless sim      imports engine only
src/render/  PixiJS board view        imports engine (read-only)
src/ui/      HTML/CSS overlay         imports engine (read-only)
src/game/    controller               owns the current GameState; wires everything
```

Data flow: `ui/render/bot -> Action -> game controller -> applyAction(state, action) -> new state -> render/ui`.
Nobody but `applyAction` produces a new GameState (fixtures excepted).

Import from `src/engine` (the barrel `index.ts`). Deep imports are fine inside the engine.

## 2. IDs and geometry

Pointy-top hexes, axial coordinates `(q, r)`. Board = all hexes with distance ≤ 2 from `h:0,0`.

```
            N
      NW  /   \  NE        neighbor directions (dq, dr):
         |     |             E(+1,0)  W(-1,0)  NE(+1,-1)
      SW  \   /  SE          NW(0,-1) SE(0,+1) SW(-1,+1)
            S
```

| Kind   | Format            | Example    | Canonical rule                                        |
| ------ | ----------------- | ---------- | ----------------------------------------------------- |
| Hex    | `h:q,r`           | `h:0,-2`   | —                                                     |
| Vertex | `v:q,r,N` or `,S` | `v:1,-2,S` | every vertex is the N or S corner of exactly one hex  |
| Edge   | `e:q,r,NE/E/SE`   | `e:0,0,NE` | every edge is the NE, E or SE side of exactly one hex |
| Player | number `0..n-1`   | `2`        | index into `state.players`, also turn order           |

The owning hex of a vertex/edge may be water or off-board — IDs are pure coordinates.
Never build ID strings by hand from a corner name; use `cornerVertex(q, r, 'NE')` and `sideEdge(q, r, 'SW')` (they canonicalize).
IDs are TS template-literal types (`HexId`, `VertexId`, `EdgeId`), so mixing them up is a type error.

**Unit geometry** (in `hex.ts` / `TOPOLOGY`): hex size (center→corner) = 1, y grows downward.
Hex center `x = √3·(q + r/2)`, `y = 1.5·r`. Multiply by your pixel size. `TOPOLOGY.hex[id].x/y`,
`TOPOLOGY.vertex[id].x/y`, `TOPOLOGY.edge[id].x/y` (midpoint) are precomputed.

## 3. Topology (`src/engine/topology.ts`)

Static, identical for every game, **not stored in GameState**. `import { TOPOLOGY } from '../engine'`.

| Field                         | Content                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `landHexes` (19)              | row-major, top row first. Layouts fill in this order.                                |
| `waterHexes` (18)             | ring, clockwise from top-left `h:0,-3`                                               |
| `vertices` (54), `edges` (72) | all on-board ids                                                                     |
| `coastalEdges` (30)           | clockwise, starting at port slot 0                                                   |
| `portSlots` (9)               | `{ index, edge, vertices, waterHex }` — fixed positions                              |
| `hex[id]`                     | `vertices` (6, clockwise from N), `edges` (6, clockwise from NE), `neighbors` (land) |
| `vertex[id]`                  | `hexes` (1–3 land), `edges` (2–3), `vertices` (2–3), `coastal`                       |
| `edge[id]`                    | `vertices` [2], `edges` (2–4), `hexes` (1–2 land), `coastal`                         |

Accessors that return `[]` for unknown ids: `hexVertices, hexEdges, hexNeighbors, vertexHexes, vertexEdges, vertexNeighbors, edgeVertices, edgeNeighbors`.
Validators for untrusted input: `isLandHex, isBoardVertex, isBoardEdge`.

## 4. GameState (`src/engine/types.ts`)

Plain JSON. `JSON.parse(JSON.stringify(s))` must equal `s`. Never mutate a state you didn't get as a handler draft.

```ts
GameState {
  schemaVersion: 1
  settings: { seed, layout: 'beginner'|'random', vpToWin }
  board:   { hexes: Record<HexId, {id,q,r,terrain,token}>, ports: Port[9] }   // fixed after createGame
  pieces:  { buildings: Record<VertexId, {owner, kind:'settlement'|'city'}>, roads: Record<EdgeId, PlayerId> }
  robber:  HexId
  players: Player[]   // {id,name,color,resources,devCards,newDevCards,knightsPlayed,progressCardsPlayed}
  bank:    ResourceCounts            // starts 19 each
  devDeck: DevCardType[]             // shuffled; draw with pop()
  turn:    { number, current, devCardPlayed, tradeOffers }   // number: 0 in setup, 1 = first real turn
  phase:   Phase                     // see §5
  dice:    [d1, d2] | null           // last roll
  awards:  { longestRoad: PlayerId|null, largestArmy: PlayerId|null }
  log:     { turn, player, text }[]  // newest LOG_LIMIT (200) entries only
  rng:     number                    // uint32 RNG state
  winner:  PlayerId | null
}
```

- `terrain` is named by the resource it yields: `brick lumber wool grain ore desert`. `token` is `null` only on the desert.
- `Port.kind`: `'generic'` (3:1) or a `Resource` (2:1).
- Pieces left are **derived**, not stored: `piecesLeft(state, p)` (limits 15 roads / 5 settlements / 4 cities).
- `devCards` = playable; `newDevCards` = bought this turn (not playable until next turn; merged on `endTurn`). VP cards in either count toward `victoryPoints()`.
- Played cards: knights in `knightsPlayed`, Road Building / Year of Plenty / Monopoly in `progressCardsPlayed` (`ProgressCardCounts`). So per type, deck + hands + played = `DEV_DECK_COMPOSITION` exactly (checked by the sim's invariants).
- `turn.tradeOffers`: player trade offers made this turn; `offerTrade` is rejected once it reaches `MAX_TRADE_OFFERS_PER_TURN` (3). Reset on `endTurn`. House rule, see §12.
- `log` keeps only the newest `LOG_LIMIT` (200) entries (trimmed by `applyAction`). A UI that wants the whole history must accumulate it itself.
- Hidden info (hands, deck order) lives in state. Fine for hotseat; an online server would redact.

## 5. Phase state machine

```
createGame
   │
   ▼
setup{index 0..2n-1, step settlement→road}   snake order 0,1,2,3,3,2,1,0 (setupPlayerAt)
   │  index ≥ n: settlement yields 1 resource per adjacent non-desert hex
   │  after last road: turn.number=1, current=0
   ▼
preRoll ──playKnight──► moveRobber{resume:preRoll} ──► [steal] ──► preRoll
   │    ──playRoadBuilding──► roadBuilding{resume:preRoll} ──► preRoll
   │    (YoP / Monopoly resolve instantly, stay in preRoll)
   │
   rollDice
   ├─ 7, someone has >7 cards ─► discard{pending[]} ─(all 0)─► moveRobber{resume:main}
   ├─ 7, nobody over 7 ──────────────────────────────────────► moveRobber{resume:main}
   │                                   moveRobber ─► steal{candidates} ─► main
   │                                              └─(no candidates)─────► main
   └─ other ─► production ─► main

main ──build*/buyDevCard/bankTrade──► main
     ──playKnight──► moveRobber{resume:main} ─► [steal] ─► main
     ──playRoadBuilding──► roadBuilding{remaining, resume:main} ─► main
     ──offerTrade (max 3/turn)──► trade{offer} ─accept/reject…─► confirmTrade | cancelTrade ─► main
     ──endTurn──► preRoll (next player)

any successful action ─► updateAwards ─► checkVictory ─(current player ≥ vpToWin)─► gameOver
```

Who may act (`actingPlayers(state)`): the current player, except
`discard` (every player with `pending[p] > 0`, in any order) and `trade` (offerer + responders still `'pending'`).

## 6. Actions

Every action carries `player` (the actor). Full union in `types.ts`.

| Action                 | Payload                      | Phase(s)         | Actor            | File        | Task |
| ---------------------- | ---------------------------- | ---------------- | ---------------- | ----------- | ---- |
| `placeSetupSettlement` | `vertex`                     | setup/settlement | current          | `setup.ts`  | T2   |
| `placeSetupRoad`       | `edge`                       | setup/road       | current          | `setup.ts`  | T2   |
| `rollDice`             | —                            | preRoll          | current          | `turn.ts`   | T2   |
| `endTurn`              | —                            | main             | current          | `turn.ts`   | T2   |
| `buildRoad`            | `edge`                       | main             | current          | `build.ts`  | T2   |
| `buildSettlement`      | `vertex`                     | main             | current          | `build.ts`  | T2   |
| `buildCity`            | `vertex`                     | main             | current          | `build.ts`  | T2   |
| `discard`              | `resources: ResourceBundle`  | discard          | any pending      | `robber.ts` | T2   |
| `moveRobber`           | `hex`                        | moveRobber       | current          | `robber.ts` | T2   |
| `steal`                | `victim`                     | steal            | current          | `robber.ts` | T2   |
| `buyDevCard`           | —                            | main             | current          | `dev.ts`    | T3   |
| `playKnight`           | —                            | preRoll, main    | current          | `dev.ts`    | T3   |
| `playRoadBuilding`     | —                            | preRoll, main    | current          | `dev.ts`    | T3   |
| `placeFreeRoad`        | `edge`                       | roadBuilding     | current          | `dev.ts`    | T3   |
| `playYearOfPlenty`     | `resources: [R, R]`          | preRoll, main    | current          | `dev.ts`    | T3   |
| `playMonopoly`         | `resource`                   | preRoll, main    | current          | `dev.ts`    | T3   |
| `bankTrade`            | `give, receive` (1 unit out) | main             | current          | `trade.ts`  | T3   |
| `offerTrade`           | `give, want, to[]`           | main             | current          | `trade.ts`  | T3   |
| `acceptTrade`          | —                            | trade            | addressed player | `trade.ts`  | T3   |
| `rejectTrade`          | —                            | trade            | addressed player | `trade.ts`  | T3   |
| `cancelTrade`          | —                            | trade            | offerer          | `trade.ts`  | T3   |
| `confirmTrade`         | `partner`                    | trade            | offerer          | `trade.ts`  | T3   |

All files above live in `src/engine/actions/`. Each file's header comment lists the expected rules.

## 7. applyAction / legalActions (`src/engine/engine.ts`)

```
applyAction(state, action):
  phase gameOver?          → { ok:false, error:'game is over' }
  unknown action.type?     → error
  action.player not 0..n-1 → error
  draft = cloneState(state)                         // clone.ts, see below
  result = HANDLERS[action.type](draft, action)     // handler mutates draft, returns ok(draft) | fail(msg)
  if ok: updateAwards(draft, { roads: changesRoads(type) }) (rules/awards.ts)
         checkVictory(draft) (rules/victory.ts)
         trim draft.log to the newest LOG_LIMIT entries
  return result
```

- **Pure:** the input state is never mutated (tested with a deep-frozen state).
- **Structural sharing (`cloneState`)**: `board` and `settings` are shared between states, and so are
  log entries (the `log` array itself is copied). Everything else is copied. So handlers must
  **never mutate `board`, `settings` or an existing log entry** (append with `log()` only). A new
  GameState field must be copied in `clone.ts` (`clone.test.ts` fails otherwise). This replaced
  `structuredClone`, which was ~85% of sim time.
- **Longest Road** is recomputed only after actions that add a road or occupy a vertex
  (`changesRoads`: setup settlement/road, buildRoad, buildSettlement, placeFreeRoad). A new action
  that changes roads or building occupancy must be added there. Largest Army is always recomputed.
- `legalActions(state, player?)` = concat of every area's `LegalGenerator`, optionally filtered by actor.
  **Sound** (everything returned is accepted by applyAction — tested) and **complete**, except
  `offerTrade`, which is open-ended: return a bounded sample (e.g. 1-for-1 offers).
  Discard combos can be numerous (≤ ~1000) — acceptable.

### How to implement / add an action handler

1. Find your action in `src/engine/actions/<area>.ts`. Replace `() => notImplemented()` with
   `(draft, action) => { …validate…; …mutate draft…; log(draft, action.player, '…'); return ok(draft); }`.
2. Validate **everything**: phase, actor (`isCurrent`), ids (`isBoardVertex` …), bundles (`isValidBundle`), costs (`hasResources`), pieces (`piecesLeft`).
3. Fill in the area's `<area>Legal` generator. Keep it consistent with the handler (ideally share a `canX(state, …)` predicate).
4. Tests next to the file: `src/engine/actions/<area>.test.ts`. Every rule gets a test.
5. **New action type?** Add it to the `Action` union in `types.ts`, to your area's `HandlerMap<…>`, the table in §6, and the `SAMPLES` map in `engine.test.ts`. TypeScript will flag any missing handler. You should not need to touch `actions/index.ts`.

Helpers (`src/engine/actions/common.ts`): `ok, fail, notImplemented, log, isCurrent`, types `Handler<T>, HandlerMap<T>, LegalGenerator`.

## 8. Shared helpers (already implemented + tested)

| Module                 | Exports                                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constants.ts`         | `RESOURCES, DEV_CARD_TYPES, PROGRESS_CARD_TYPES, COSTS, PIECE_LIMITS, DEV_DECK_COMPOSITION, DISCARD_THRESHOLD, LONGEST_ROAD_MIN, LARGEST_ARMY_MIN, AWARD_VP, MAX_TRADE_OFFERS_PER_TURN, LOG_LIMIT, tokenPips` … |
| `resources.ts`         | `emptyResources, emptyDevCards, emptyProgressCards, toCounts, isValidBundle, isResource, addResources, subtractResources, hasResources, totalResources`                                                         |
| `clone.ts`             | `cloneState` — applyAction's draft copy (structural sharing, see §7)                                                                                                                                            |
| `rules/placement.ts`   | `isVertexOpen` (distance rule), `canPlaceSettlement(s,p,v,{requireRoad})`, `canPlaceCity`, `canPlaceRoad(s,p,e,{fromVertex?})`, `touchesOwnRoad` — geometry only, no cost/phase/pieces                          |
| `selectors.ts`         | `setupPlayerAt, getPlayer, currentPlayer, buildingsOf, roadsOf, piecesLeft, publicVictoryPoints, victoryPoints, handSize, portsOf, actingPlayers`                                                               |
| `board.ts`             | `generateBoard, beginnerBoard, randomBoard, redNumbersSeparated`                                                                                                                                                |
| `createGame.ts`        | `createGame({ seed, players: {name,color}[], layout, vpToWin? })` → setup phase, player 0 first                                                                                                                 |
| `rules/longestRoad.ts` | `longestRoadLength(s,p)`, `longestRoadLengths(s)` — longest trail, broken by opponent buildings (T3)                                                                                                            |
| `actions/trade.ts`     | `bankTradeRatio(s,p,resource)` → 2 / 3 / 4 (T3)                                                                                                                                                                 |

## 9. Randomness (`src/engine/rng.ts`)

mulberry32; the whole state is the uint32 `state.rng`. In a handler:

```ts
const rng = new Rng(draft.rng);
const d1 = rng.die(),
  d2 = rng.die();
draft.rng = rng.state; // always write back
```

`Rng` also has `int(n)`, `float()`, `pick(arr)`, `shuffle(arr)` (returns a copy). `createGame` seeds from `settings.seed` (number or string), generates the board, shuffles the deck, and stores the continuing state.
Bots should use their **own** `Rng` so bot choices don't perturb game randomness.

## 10. Fixtures (`src/engine/fixtures.ts`)

Each returns a fresh, internally consistent state on the beginner board (checked in `fixtures.test.ts`):

| Fixture                 | Situation                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `freshGame(3\|4)`       | just created; setup, player 0 to place                                                                                     |
| `setupInProgressGame()` | setup index 5 (player 2, round 2); 5 settlements + 5 roads placed                                                          |
| `midGame()`             | turn 12, Blue (1) in main after rolling 8; cities, Longest Road (Red), Largest Army (White), robber on `h:1,-1`, dev cards |
| `discardGame()`         | midGame + rolled 7; Blue must discard 5, Orange 4                                                                          |
| `moveRobberGame()`      | Blue played a knight pre-roll; `moveRobber{resume:'preRoll'}`                                                              |
| `tradeOfferGame()`      | Blue offers 1 ore for 1 brick; Red rejected, Orange accepted, White pending                                                |
| `gameOverGame()`        | Red won with 10 VP                                                                                                         |

## 11. Task ownership

| Task               | Owns                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 foundation      | `types.ts, hex.ts, topology.ts, rng.ts, board.ts, constants.ts, resources.ts, selectors.ts, rules/placement.ts, createGame.ts, engine.ts, actions/index.ts, actions/common.ts, fixtures.ts`, tooling |
| **T2 rules-core**  | `actions/setup.ts, actions/turn.ts` (incl. production), `actions/build.ts, actions/robber.ts, rules/victory.ts`; may add `rules/production.ts` etc.                                                  |
| **T3 rules-trade** | `actions/trade.ts, actions/dev.ts, rules/awards.ts` (longest road, largest army); may add `rules/longestRoad.ts` etc.                                                                                |
| **T4 render**      | `src/render/**` (replace `proofBoard.ts`), board part of `src/main.ts` if needed                                                                                                                     |
| **T5 bots + sim**  | `src/bots/**` (`index.ts` random bot, `sim.ts`, invariant checks)                                                                                                                                    |
| T6 UI              | `src/ui/**`                                                                                                                                                                                          |
| T7 integration     | `src/game/**`, `src/main.ts`                                                                                                                                                                         |

T2 and T3 can work in parallel without touching each other's files. Small additions to shared T1
files (a selector, a constant) are fine — mention them in your report.

## 12. Board view API (`src/render`, T4)

```ts
const view = new BoardView(app);          // adds itself to app.stage; app must already be init'd
view.render(state);                       // cheap; call after every state change
view.setHighlights({ vertices, edges, hexes, color? });   // legal spots; {} clears
view.on('vertexClick' | 'edgeClick' | 'hexClick', (id) => …);   // returns an unsubscribe fn
view.on('hover', (hit | null) => …);
view.resize(); view.fit(); view.destroy();
view.setInsets({ top, right, bottom, left });  // px covered by HUD panels; the fitted board avoids them
```

- The view never decides legality: pass ids from `legalActions`, map clicks back to actions.
- While any highlight list is non-empty, only highlighted ids are hoverable/clickable; with none, everything is.
- Drag = pan, wheel = zoom at cursor, pinch on touch, double-click = refit. Refits on renderer resize until the user moves it.
- Pure math (fit/zoom/hit-test, unit space) is in `render/geometry.ts`, unit-tested. Dev: `?fixture=midGame`, `?hl=vertices|edges|hexes`.
- Also exported for the UI: `drawResourceIcon`, `RESOURCE_COLORS`, `TERRAIN_COLORS`.

## 13. UI contract (`src/ui`, T6)

```ts
import { Hud } from './ui';
const hud = new Hud(document.getElementById('ui')!);          // overlay; only its panels take pointer events
hud.render(state, { viewer, legal, isBotTurn });              // call after every state change / viewer change
hud.on('action', (a: Action) => …);                           // controller applies it via applyAction
hud.on('newGame', (cfg: NewGameConfig) => …);                 // setup screen (src/ui/setup): { mode:'base', map:'base'|'baseRandom'|'base56'|'base78', players:{name,color,controller}[3..8], rules:{balancedDice,hideBankCards}, turnTimerSec:number|null, vpToWin, discardLimit, seed? }
hud.on('placeMode', (m: 'road'|'settlement'|'city'|null) => …); // build button toggled: board shows targets, click -> buildX
hud.showNewGame();                                            // open the new-game screen (also the winner screen's button)
```

- The HUD never mutates state or calls `applyAction`. Buttons are enabled **only** from `legal` actions with `player === viewer`; pass legal actions for the viewer (or all, they are filtered).
- Build buttons emit nothing but `placeMode`. HUD leaves the mode itself when pieces/turn/phase change or the build stops being legal (it emits `placeMode(null)`); Esc cancels.
- Implied board clicks (setup placement, robber, free roads) have no HUD button: use `boardPrompt(view)` (`'setupSettlement' | 'setupRoad' | 'moveRobber' | 'freeRoad' | null`) to know what to highlight.
- `offerTrade` is open-ended, so the composer builds its own action; the HUD enables the Trade button when any `offerTrade` is in `legal`.
- Discard is submitted as one `discard` action with exactly `pending[viewer]` cards; the dialog opens when a `discard` for the viewer is in `legal`.
- Hotseat: when `view.viewer` differs from the previously shown viewer a "Pass to <name>" cover hides everything until clicked. Keep `viewer` fixed during bot turns; change it only when a different human should see the screen. After `newGame` the HUD forgets the old viewer.
- Dev page: `ui-dev.html` (`pnpm dev`, open `/ui-dev.html#<fixture>`; `?viewer=2&click=Bank`) with hand-built legal lists (`src/ui/devLegal.ts`, not the engine's).

## 13b. Game controller (`src/game`, T7)

```ts
const c = new GameController({ board, hud, storage, speed, toast, onRender });
c.start(state, seats); // seats: ('human'|'bot')[] indexed by PlayerId
c.newGame(cfg);
c.resume(saved);
c.setSpeed(ms);
c.snapshot();
c.destroy();
```

- Only path to a new state: `dispatch(action)` → `applyAction`. Rejections toast and change nothing.
  After every change: `legalActions` → viewer → `board.render` + `hud.render` → highlights → autosave → schedule bot.
- Pure decisions live in `game/logic.ts` (unit-tested): `pickViewer` (owed responses — discards,
  pending trade replies — first, then the current human; previous viewer kept during bot turns;
  all-bot = spectator viewer 0), `boardActions`/`highlightsFor`/`actionForClick` (implied prompts
  or HUD place mode), `nextBot` (bots owing a response first; a bot offerer waits for human replies).
- Bots: `defaultBot = createRandomBot({ progressBias: 0.5 })`, private `Rng` seeded `bots:<seed>`
  (saved with the session), one move per tick (`speed` ms, ×0.4 for discards / trade replies;
  speed 0 = batches of moves per 12 ms slice). The controller hides `offerTrade` from a bot after
  `BOT_OFFERS_PER_TURN` (1) offers in a turn. Nobody able to act → error toast + state on console.
- Autosave: `localStorage['catan:save:v1']` = `{ version, state, seats, viewer, botRng }`, every
  access in try/catch. On load an unfinished save offers Resume / New game. Dev sessions (`?fixture`,
  `?seed`, `?layout`, `?autoplay`) never autosave.
- Dev params (`game/params.ts`): `?fixture=`, `?seed=`, `?layout=`, `?seats=hbbb`, `?vp=`, `?speed=ms`,
  `?autoplay=4bots|3bots` (all bots), `?hl=`. `window.catan` = `{ controller, board, hud }`.

## 14. Decisions and open questions

- **Port positions:** the 9 ports sit on every other water hex of the ring (starting top-left); a water hex touching two land hexes faces the one that is not a corner of the land hexagon. That gives 2,3,2 free coastal edges between ports, 3-fold symmetric. Verified (T8) against the 5th-edition rulebook's beginner map; the frame's harbors are fixed, so the random layout uses the same positions. Details + sources: `docs/RULES.md` §12.
- **Beginner layout** (`board.ts`): terrain, tokens and harbor kinds verified (T8) against the rulebook's Illustration A. Starting settlements of the beginner setup are not encoded (see RULES.md §12 for them).
- **Random layout:** terrain shuffled, tokens rejection-sampled until no 6/8 are adjacent, port kinds shuffled (positions fixed).
- **Turn order:** config order; player 0 starts (no "highest roll starts"). The controller may shuffle players before `createGame`.
- **Dev cards pre-roll:** official rules allow any one dev card at any time on your turn, incl. before rolling. The phase design supports all of them in `preRoll`.
- **Steal:** a separate `steal` action even with one candidate (uniform for UI/bots); skipped when nobody can be robbed.
- **Player trade:** two-step (responders accept, offerer confirms with one partner). Only the current player can initiate.
- **Bank shortage:** if the bank can't pay a resource to everyone owed, nobody gets it, unless only one player is owed (gets the remainder).
- **Victory:** only checked for the current player (official: you win on your own turn). Not checked during setup. A player who reaches `vpToWin` on someone else's turn (e.g. Longest Road shifting) wins right after the previous player's `endTurn`, i.e. as their own turn starts.
- **Steal log:** says who stole from whom, never which card (the log is public).
- **Road Building (T3):** rejected when the player could place no road at all (no pieces or no legal edge), so the card is never wasted. `remaining = min(2, roads left)`; the phase also ends early once no legal edge remains.
- **Year of Plenty (T3):** the bank must cover both cards; no partial grant.
- **Player trade details (T3):** `to` = distinct other players, non-empty. Only `'pending'` responders may respond (no changing your mind). Acceptor must hold `want` when accepting; both sides are re-checked at confirm. Offer auto-closes to `main` when every addressee rejected. The legal sample of `offerTrade` = 1-for-1 offers to all opponents for each held resource.
- **Trade offer cap (T8, house rule):** at most `MAX_TRADE_OFFERS_PER_TURN` (3) `offerTrade`s per
  turn, counted whether confirmed, cancelled or rejected by all. Bank trades are unlimited. The
  official rules set no limit; without one, random bots loop offer → all reject → offer and games
  never end. Raise the constant if humans find it tight.
- **Longest Road ties (T3):** holder keeps it while tied for longest; otherwise the unique leader (≥ 5) gets it; a tie without the holder → nobody. Largest Army uses the same rule with ≥ 3 knights.
