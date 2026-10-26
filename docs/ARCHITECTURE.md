# Architecture — the contract

Browser Catan clone (base game, 3–8 players on 19/30/37-hex maps). TypeScript strict, PixiJS v8, Vite, Vitest, pnpm.
**If you change a public type in `src/engine/types.ts`, update this file in the same commit.**
Game rules (sourced, with engine status per rule): `docs/RULES.md`.

## 1. Layers

```
src/engine/  pure rules engine        no DOM, no Pixi, no Math.random, no Date (lint-enforced)
src/bots/    bots + headless sim      imports engine only
src/render/  PixiJS board view        imports engine (read-only)
src/ui/      HTML/CSS overlay         imports engine (read-only)
src/game/    controller               owns the current GameState; wires everything
src/expansions/<id>/  one folder per expansion module: engine/ (engine rules apply), render.ts,
             ui.ts, bots.ts — the framework contract is docs/EXPANSIONS.md (F1)
src/net/     online multiplayer       protocol + GameSession (server room core); no DOM, no Date (lint)
src/server/  Cloudflare room server   Worker + Durable Object around GameSession (MULTIPLAYER.md §18)
```

Online play (stage 4): `docs/MULTIPLAYER.md`. The server runs the engine on the full state;
clients get `viewFor(state, seat)` (§8) and their legal actions. Every mode, scenario, option and
combo plays online (X1): the lobby wraps the setup screen (mode tiles included), `RoomConfig`
carries `mode/scenario/options`, expansion actions go over the wire, and each module masks its
own secrets in views with the `maskFor` hook (docs/EXPANSIONS.md §5 "Online views"). Browser client (home, lobby,
`RoomClient`, `NetGameController`, `src/game/online`, `src/ui/online`; `HudView.spectator` /
`.away`, `Hud.setChat` / `.setSessionActions`): `docs/ONLINE-CLIENT.md`.

Data flow: `ui/render/bot -> Action -> game controller -> applyAction(state, action) -> new state -> render/ui`.
Nobody but `applyAction` produces a new GameState (fixtures excepted).

Import from `src/engine` (the barrel `index.ts`). Deep imports are fine inside the engine.

## 2. IDs and geometry

Pointy-top hexes, axial coordinates `(q, r)`. The land hexes depend on the map (§3): the 19-hex
board is all hexes with distance ≤ 2 from `h:0,0`.

```
            N
      NW  /   \  NE        neighbor directions (dq, dr):
         |     |             E(+1,0)  W(-1,0)  NE(+1,-1)
      SW  \   /  SE          NW(0,-1) SE(0,+1) SW(-1,+1)
            S
```

| Kind   | Format            | Example     | Canonical rule                                          |
| ------ | ----------------- | ----------- | ------------------------------------------------------- |
| Hex    | `h:q,r`           | `h:0,-2`    | —                                                       |
| Vertex | `v:q,r,N` or `,S` | `v:1,-2,S`  | every vertex is the N or S corner of exactly one hex    |
| Edge   | `e:q,r,NE/E/SE`   | `e:0,0,NE`  | every edge is the NE, E or SE side of exactly one hex   |
| Player | number `0..n-1`   | `2`         | index into `state.players`, also turn order             |
| Plaza  | `v:q,r,C`         | `v:2,-2,C`  | F2: centre of a hex listed in the frame's `plazas`      |
| Spoke  | `e:q,r,C<corner>` | `e:2,-2,CS` | F2: plaza → that corner of hex (q,r); plaza frames only |

The owning hex of a vertex/edge may be water or off-board — IDs are pure coordinates.
Never build ID strings by hand from a corner name; use `cornerVertex(q, r, 'NE')` and `sideEdge(q, r, 'SW')` (they canonicalize).
IDs are TS template-literal types (`HexId`, `VertexId`, `EdgeId`), so mixing them up is a type error.

**Unit geometry** (in `hex.ts` / topology): hex size (center→corner) = 1, y grows downward.
Hex center `x = √3·(q + r/2)`, `y = 1.5·r`. Multiply by your pixel size. `topo.hex[id].x/y`,
`topo.vertex[id].x/y`, `topo.edge[id].x/y` (midpoint) are precomputed.

## 3. Maps and topology (`src/engine/maps.ts`, `src/engine/topology.ts`)

The board is chosen at `createGame` as `settings.map: MapId` and never changes.

| `MapId`      | Board                                | Players | Land / water / vertices / edges / harbors | Bank | Dev deck |
| ------------ | ------------------------------------ | ------- | ----------------------------------------- | ---- | -------- |
| `base`       | 19 hexes, fixed beginner layout      | 3–4     | 19 / 18 / 54 / 72 / 9                     | 19   | 25       |
| `baseRandom` | 19 hexes, random layout              | 3–4     | same frame as `base`                      | 19   | 25       |
| `base56`     | 30 hexes (3-4-5-6-5-4-3), random     | 3–6     | 30 / 22 / 80 / 109 / 11                   | 24   | 34       |
| `base78`     | 37 hexes (4-5-6-7-6-5-4, our design) | 3–8     | 37 / 24 / 96 / 132 / 12                   | 29   | 43       |

`MAPS[id]: StdMapDef` = `{ frame, minPlayers, maxPlayers, layout: 'beginner'|'random', terrain, tokens,
harbors, bankPerResource, devDeck }` for the base ids (`BaseMapId`). A `RowsFrameDef` = land row
widths + harbor spots. Sources and design notes: `docs/RULES.md` §16. Helpers (`maps.ts`):
`MAP_IDS` (base), `isBaseMapId`, `defaultMapFor(players)` (3–4 → `baseRandom`, 5–6 → `base56`,
7–8 → `base78`). Helpers over base **and expansion** maps (`mapLookup.ts`): `isMapId`, `mapById`,
`mapOf(state)`, `supplyOf(state)` (bank per resource + dev deck of the game: map supply changed by
expansion `supply` hooks).

**Plazas (F2, T&B trade hexes):** a frame (rows or hex list) may list `plazas: { hex, corners }[]`;
its topology then has the centre vertex `v:q,r,C` (`hexes: [hex]`, not coastal) and one spoke
edge `e:q,r,C<corner>` per listed corner, as ordinary vertices / edges (adjacency, roads, pieces,
highlights, hit-testing). `hex[h].vertices` / `.edges` stay the 6 corners / sides, so production,
the robber and harbours never see plazas. Helpers in `hex.ts`: `centreVertex`, `spokeEdge`,
`isCentreVertex`, `isSpokeEdge`.

**Expansion maps (F1):** `MapId = BaseMapId | '<expansion>/<name>'`. A `CustomMapDef`
(`layout: 'custom'`, `generate(rng, players)`) on a `HexListFrameDef` (any hex set + explicit sea
and harbors). Board helpers `assembleBoard`, `dealTokens`. Details: `docs/EXPANSIONS.md` §6. A
combination map built on another module's map names it in `basedOn` (C2, EXPANSIONS.md §11).

**Topology** is derived from the frame, built once per frame and cached, **not stored in GameState**:

```ts
const t = topologyOf(state); // the board of this game — use this everywhere
const t = topologyFor('base56'); // by map id (generators, previews)
```

`TOPOLOGY` still exists but is **deprecated**: it is the 19-hex topology (`topologyFor('base')`),
valid only for base-map games (fixtures, old tests, UI dev pages).

| Field               | Content                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `frame`, `center`   | frame id (`std19`/`std30`/`hex37`); board center in units (`(0,0)` on 19 hexes)      |
| `landHexes`         | row-major, top row first. Layouts fill in this order.                                |
| `waterHexes`        | ring, clockwise from its top-left hex (`h:0,-3` on 19 hexes)                         |
| `vertices`, `edges` | all on-board ids                                                                     |
| `coastalEdges`      | clockwise, starting at port slot 0                                                   |
| `portSlots`         | `{ index, edge, vertices, waterHex }` — fixed positions                              |
| `hex[id]`           | `vertices` (6, clockwise from N), `edges` (6, clockwise from NE), `neighbors` (land) |
| `vertex[id]`        | `hexes` (1–3 land), `edges` (2–3), `vertices` (2–3), `coastal`                       |
| `edge[id]`          | `vertices` [2], `edges` (2–4), `hexes` (1–2 land), `coastal`                         |
| `water[id]` (F1)    | + `vertices`, `edges`, `neighbors` (frame hexes), `playable` (listed sea, not ring)  |
| `seas` (F1)         | on every vertex/edge info: adjacent water hexes                                      |
| `seaVertices/Edges` | (F1) ids touching only water (`seaVertex` / `seaEdge` infos): ship routes            |

Accessors take the topology first and return `[]` for unknown ids: `hexVertices(t, h), hexEdges,
hexNeighbors, vertexHexes, vertexEdges, vertexNeighbors, edgeVertices, edgeNeighbors`.
Validators for untrusted input: `isLandHex(t, id), isBoardVertex(t, id), isBoardEdge(t, id)`,
and (F1) `isWaterHex`, `isSeaEdge`, `vertexInfo` / `edgeInfo` (land or sea). Base frames' land
fields, counts and orders are unchanged by the sea geometry.

## 4. GameState (`src/engine/types.ts`)

Plain JSON. `JSON.parse(JSON.stringify(s))` must equal `s`. Never mutate a state you didn't get as a handler draft.

```ts
GameState {
  schemaVersion: 5
  settings: GameSettings             // see below; fixed after createGame
  board:   { hexes: Record<HexId, {id,q,r,terrain,token}>, ports: Port[] }   // fixed after createGame
  pieces:  { buildings: Record<VertexId, {owner, kind:'settlement'|'city'}>, roads: Record<EdgeId, PlayerId> }
  robber:  HexId
  players: Player[]   // {id,name,color,resources,devCards,newDevCards,knightsPlayed,progressCardsPlayed}
  bank:    ResourceCounts            // starts at supplyOf(state).bankPerResource each (19/24/29)
  devDeck: DevCardType[]             // shuffled; draw with pop(); composition per map (25/34/43)
  turn:    { number, current, devCardPlayed, tradeOffers }   // number: 0 in setup, 1 = first real turn
  phase:   Phase                     // see §5
  dice:    [d1, d2] | null           // last roll
  diceDeck: number[]                 // balanced dice: undrawn cards 0..35 = (d1-1)*6+(d2-1); [] otherwise
  awards:  { longestRoad: PlayerId|null, largestArmy: PlayerId|null }
  log:     { turn, player, text }[]  // newest LOG_LIMIT (200) entries only
  rng:     number                    // uint32 RNG state
  winner:  PlayerId | null
  ext:     Record<ExpansionId, Json> // v5 (F1): one slice per active expansion; {} in base games
  // V1 variants: present only in event-card games (absent otherwise, no schema bump)
  eventDeck?:    number[]            // undrawn event cards (ids into EVENT_CARDS), pop()
  lastEvent?:    EventKind | null    // event of the last card drawn
  damagedRoads?: (EdgeId | null)[]   // Earthquake: each player's damaged road
  // UX2: present from createGame on (older saves: absent until their next action, no schema bump)
  stats?:        GameStats           // end-of-game statistics, see "Game statistics" below
}
```

`Terrain` (F1) = `Resource | 'desert' | 'gold' | 'sea' | 'fog' | '<expansion>/<name>'`; only
resource terrains produce in the core (`terrainKind` says land / sea / fog). `Action` and `Phase`
also admit namespaced expansion members (`ExpansionAction`, `ExpansionPhase`); `BaseAction` /
`BaseActionType` are the base ones. `Board.ext?` holds optional per-game expansion board data.

**Game statistics (UX2, `stats.ts`).** `GameStats = { complete, fromTurn, players: PlayerStats[],
events, vpHistory: {turn, vp[]}[], awardHistory: {turn, award, player}[] }`. `PlayerStats` has
`gained: Record<GainSource, ResourceCounts>` (production, setup, trade, bank, steal, devCard,
event, other) and `lost: Record<LossSink, ResourceCounts>` (build, buyDev, trade, bank, stolen,
discard, monopoly, event, other), `blocked` (what the robber's hex would have paid), `expected36`
(expected production ×36 over all rolls; luck = production − expected36/36), `rolls[11]` (totals
2..12 this player rolled), `built`, `freeRoads`, `devBought`, `devPlayed`, `offersMade`,
`tradesAsOfferer`, `tradesAsPartner`, `bankTrades` (4:1), `portTrades`, `robberMoves`, `steals`,
`robbed`, `discards`.

- **Immutable**: every change builds a new GameStats sharing the unchanged parts; `cloneState`
  shares `stats` like `board`. Never mutate it.
- Two hooks inside handlers: `recordRoll` (turn.ts `rollFor`: dice / event card, expected
  production) and `recordProduction` (`produce`: paid production, blocked cards). Everything else
  is `recordAction(prev, next, action)` in `applyAction` (after `checkVictory`): each hand change
  production did not explain is classified by action type, so **Σ gained − Σ lost = hand** holds
  by construction (sim invariant `stats`; `other` must stay 0 in base games). A new base action that moves resources
  needs a case in `gainSource` / `lossSink`. Expansion actions (`<id>/...`): their hand changes count as
  the module's `statsCategory` hook says (default `other`), their base parts (pieces placed, dev cards bought / played) are counted from the state diff
  (`recordExpansionAction`); expansion-only goods (oil, crops) are not counted. `recordRoll` /
  `recordProduction` count only resource terrains (like `computeProduction`).
- `statsOf(state)` reads with defaults (`complete: false`, `fromTurn` = now for older saves).
  Hand-built fixtures have no stats.
- Secret until game over: `viewFor` drops `stats` from mid-game views (stolen card types, dev
  cards bought, hidden VP history) and passes it unchanged at game over.

`TurnState` also has an optional `secondSettlerOf?: PlayerId` (Second Settler step, §5) and
`specialOwner?: PlayerId` (V2: the owner during a special build phase, so a card played there with
`rules56` can resume into `specialBuild{builder, owner}`; `ResumePhase` is now
`'preRoll' | 'main' | 'specialBuild'`, resolved by `resumePhase()` in `actions/common.ts`).

**GameSettings v2** (validated by `createGame`, which throws on bad values):

| Field               | Type / range         | Default         | Engine                                                       |
| ------------------- | -------------------- | --------------- | ------------------------------------------------------------ |
| `seed`              | number \| string     | —               | seeds `state.rng`                                            |
| `map`               | `MapId`              | `defaultMapFor` | board, topology, supply, player range                        |
| `vpToWin`           | int 3..20            | 10              | victory check                                                |
| `discardLimit`      | int 5..20            | 7               | on a 7, hands **above** it discard half                      |
| `balancedDice`      | boolean              | false           | rolls drawn from `diceDeck` (§9, RULES.md §17)               |
| `specialBuildPhase` | boolean              | players ≥ 5     | `specialBuild` phase between turns (§5, RULES.md §16.10)     |
| `hideBankCards`     | boolean              | false           | client-side only (UI hides bank counts); engine ignores it   |
| `turnTimerSec`      | positive int \| null | null            | client-side only; engine ignores it (controller timer, §13b) |
| `startingPlayer`    | PlayerId (v4, T14)   | drawn from seed | places first in setup, takes turn 1 (RULES.md 2.7)           |
| `mode`              | ModeId (v5, F1)      | `'base'`        | setup preset of expansions + scenarios (EXPANSIONS.md §3)    |
| `expansions`        | ExpansionId[] (v5)   | mode's          | active modules, registry order; `[]` = base                  |
| `scenario`          | ScenarioId \| null   | mode's first    | picks the map per player count, default VP                   |
| `options`           | per-expansion record | option defaults | every option of every active module                          |

**V1 variant settings** — all **optional**, absent = official rule, written by `resolveSettings`
only when they differ from it (so default settings and old saves are unchanged; no schema bump).
Read them only through `variants.ts` / `clock.ts` accessors. Rules and sources: RULES.md §18.

| Field            | Type                                                                                                        | Engine                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `robberMode`     | `'normal' \| 'friendly' \| 'none'`                                                                          | `robberTargets`, `isRobberProtected`, `startRobber`, production                                                                           |
| `eventCards`     | `true`                                                                                                      | rolls draw from `eventDeck`; `event` phase; not with `balancedDice`                                                                       |
| `setupPlacement` | `{ first, second: { building, restriction } }`                                                              | setup building kind (`settlement`/`city`), `normal`/`anyVertex`                                                                           |
| `seatOrder`      | `number[]` (config index per seat)                                                                          | Randomize Turn Order (config `randomTurnOrder: true`); seat 0 starts                                                                      |
| `mapSelection`   | `'random' \| 'veto'`                                                                                        | `randomMapFor` / `mapVeto` phase before setup                                                                                             |
| `rushMode`       | `true`                                                                                                      | `beginTurn` rolls automatically (no `preRoll`)                                                                                            |
| `turboMode`      | `true`                                                                                                      | both setup rounds pay starting resources                                                                                                  |
| `secondSettler`  | `true`                                                                                                      | paired players' turn (4+ players, excludes `specialBuildPhase`)                                                                           |
| `timer`          | `{ preset, bankSec, incrementSec }`                                                                         | chess clock, client/server enforced (`clock.ts`); excludes `turnTimerSec`                                                                 |
| `mapRules`       | `{ allowRedTouch?, allowExtremeTouch?, allowSameNumberTouch?, allowSameResourceTouch? }` (only `true` kept) | `randomBoard` constraints on random maps, RULES.md §19 (V2)                                                                               |
| `rules56`        | `true`                                                                                                      | 5+ player rule set (5+ players, no `secondSettler`): a dev card in the special build step, no robber on the 2nd desert; RULES.md §20 (V2) |

`startingPlayer` in the config is `PlayerId | 'random'` (default `'random'`): `randomStartingPlayer(seed, n)`
draws it from its own stream (`start:<seed>`), so a seed's board, deck and rolls are the same as
before T14. `createGame` logs "Blue starts" right after "Game created …". Fixtures pin seat 0.

**Saves:** `upgradeState(raw)` (`migrate.ts`) returns a v5 state from a v1–v5 one, or null.
v4 → v5 (F1): `mode 'base', expansions [], scenario null, options {}`, `ext: {}`; a v5 save naming
an unknown expansion / mode / scenario → null.
v1 → v2: `layout 'beginner'|'random'` → `map 'base'|'baseRandom'`, new fields get their defaults
(`specialBuildPhase: false`). v2 → v3 (T13): `diceDeck: []` (the next balanced roll shuffles).
v3 → v4 (T14): `settings.startingPlayer: 0` (every older game started with seat 0). Log texts are
never migrated: rolls before T14 read "Blue rolled 8", since T14 "Blue rolled 8 (3+5)".
Bump `schemaVersion` and add a step there whenever GameState changes shape.
Exception (V1/V2/UX2): the variant fields and `stats` are optional and absent in every older
save, so they need no migration step; each upgrade keeps them (v4 → v5 included) and v5 is
current.

**Variants × expansions.** The variant settings work in expansion modes too, through the same
code paths as the hooks: dice and Event Cards both end in the production step
(`produceAndContinue`: pay, then `afterProduction` hooks with what was paid), an Event Card is
the roll for the `onRoll` hooks too (`drawEventRoll`, then the hooks, then `resolveDrawnEvent`;
an interrupt resumes with `continueRoll`, which resolves the card), a 7 or Robber Attacks goes through
`resolveSeven` (`onSeven` hook, `handSize` / `discardLimit` hooks), `beginTurn` runs `onStartTurn`
(also for the first turn, and for Catanian 2's Second Settler step), and the `production` hook gets
`ctx = { cityYield, blocked }` (Epidemic, `robberMode 'none'`). A module's `setupBuilding` hook wins
over `setupPlacement`; 'any vertex' still needs land and an unblocked vertex. Map rules and
`rules56`'s first desert apply to base random layouts only (scenario maps have their own
generators). Refused: `mapSelection 'veto'` with expansions (module `init` builds slices from the
board, which must not change afterwards); `'random'` in a scenario picks among its maps that fit.

- `terrain` is named by the resource it yields: `brick lumber wool grain ore desert`. `token` is `null` only on the desert.
- `Port.kind`: `'generic'` (3:1) or a `Resource` (2:1).
- Pieces left are **derived**, not stored: `piecesLeft(state, p)` (limits 15 roads / 5 settlements / 4 cities).
- `devCards` = playable; `newDevCards` = bought this turn (not playable until next turn; merged on `endTurn`). VP cards in either count toward `victoryPoints()`.
- Played cards: knights in `knightsPlayed`, Road Building / Year of Plenty / Monopoly in `progressCardsPlayed` (`ProgressCardCounts`). So per type, deck + hands + played = `supplyOf(state).devDeck` exactly (checked by the sim's invariants). `BANK_PER_RESOURCE` / `DEV_DECK_COMPOSITION` are the 19-hex values only.
- `turn.tradeOffers`: player trade offers made this turn; `offerTrade` is rejected once it reaches `MAX_TRADE_OFFERS_PER_TURN` (3). Reset on `endTurn`. House rule, see §12.
- `log` keeps only the newest `LOG_LIMIT` (200) entries (trimmed by `applyAction`). A UI that wants the whole history must accumulate it itself.
- Hidden info (hands, dev cards, deck orders, rng, seed) lives in state. Fine for hotseat; online,
  `viewFor(state, seat | 'spectator')` (`view.ts`, M1) masks it and adds public counts
  (`GameView.view`). A new secret GameState field must be masked there (`src/bots/viewLeak.test.ts`);
  a module's secrets in its `maskFor` hook (`hiddenFrom` / `addPublicCounts` in `viewer.ts`,
  tests with `src/expansions/maskTestkit.ts`).

## 5. Phase state machine

```
createGame
   │
   ▼
setup{index 0..2n-1, step settlement→road}   snake order from s = settings.startingPlayer:
   │  s,s+1,…,s-1,s-1,…,s+1,s (mod n; setupPlayerAt(index, n, s))
   │  index ≥ n: settlement yields 1 resource per adjacent non-desert hex
   │  (setupOrderOf(state): an expansion's setupOrder hook may change both, e.g. 3 rounds)
   │  after last road: turn.number=1, current=s
   ▼
preRoll ──playKnight──► moveRobber{resume:preRoll} ──► [steal] ──► preRoll
   │    ──playRoadBuilding──► roadBuilding{resume:preRoll} ──► preRoll
   │    (YoP / Monopoly resolve instantly, stay in preRoll)
   │
   rollDice
   ├─ 7, someone has >discardLimit cards ─► discard{pending[]} ─(all 0)─► moveRobber{resume:main}
   ├─ 7, nobody over discardLimit ──────────────────────────────────────► moveRobber{resume:main}
   │                                   moveRobber ─► steal{candidates} ─► main
   │                                              └─(no candidates)─────► main
   └─ other ─► production ─► main

main ──build*/buyDevCard/bankTrade──► main
     ──playKnight──► moveRobber{resume:main} ─► [steal] ─► main
     ──playRoadBuilding──► roadBuilding{remaining, resume:main} ─► main
     ──offerTrade (max 3/turn)──► trade{offer} ─accept/reject…─► confirmTrade | cancelTrade ─► main
     ──endTurn──► preRoll (next player)                         settings.specialBuildPhase off
     ──endTurn──► specialBuild{builder, owner} ...► preRoll       on (T13), see below

specialBuild{builder, owner}   owner = who just ended; turn.current = builder; turn.number unchanged
     ──buildRoad/buildSettlement/buildCity/buyDevCard──► specialBuild (same builder)
     ──passSpecialBuild──► specialBuild{next builder} | preRoll (owner+1, turn.number+1)
   builders: owner+1 … owner-1 clockwise; anyone who can neither build nor buy is skipped
   (if nobody can, endTurn goes straight to preRoll). No trade, no dev card play, no roll.

any successful action ─► updateAwards ─► checkVictory ─(current player ≥ vpToWin)─► gameOver
                                         (skipped in setup and specialBuild)
```

V1 variants (RULES.md §18):

```
createGame ─(mapSelection 'veto')─► mapVeto{candidates, vetoed, order, next} ─vetoMap…─► setup
           turn.current = order[next]; ends when one candidate is left (it becomes board/robber)

rollDice with eventCards: draw a card ─ robberAttacks ─► as a 7
                                      ─ choices ─► event{tasks} ─eventGain/Give/Steal/DamageRoad…─► production ─► main
                                      ─ otherwise ─► (epidemic / robberFlees effect) production ─► main
rushMode: every turn start (and setup end) rolls at once: preRoll is never seen
robberMode 'none': discard / knight ─► straight to the resume phase (no moveRobber/steal)
secondSettler: main ──endTurn──► main with turn.current = owner+3, turn.secondSettlerOf = owner
                    (bank trade, build, buy, one dev card; no offerTrade) ──endTurn──► owner+1 preRoll
```

Who acts in `event`: every player with a task (any order, like `discard`).

Who may act (`actingPlayers(state)`): the current player (in `specialBuild` that is the builder), except
`discard` (every player with `pending[p] > 0`, in any order) and `trade` (offerer + responders still `'pending'`).

## 6. Actions

Every action carries `player` (the actor). Full union in `types.ts`.

| Action                 | Payload                          | Phase(s)           | Actor            | File        | Task |
| ---------------------- | -------------------------------- | ------------------ | ---------------- | ----------- | ---- |
| `placeSetupSettlement` | `vertex`                         | setup/settlement   | current          | `setup.ts`  | T2   |
| `placeSetupRoad`       | `edge`                           | setup/road         | current          | `setup.ts`  | T2   |
| `rollDice`             | —                                | preRoll            | current          | `turn.ts`   | T2   |
| `endTurn`              | —                                | main               | current          | `turn.ts`   | T2   |
| `passSpecialBuild`     | —                                | specialBuild       | builder          | `turn.ts`   | T13  |
| `buildRoad`            | `edge`                           | main, specialBuild | current          | `build.ts`  | T2   |
| `buildSettlement`      | `vertex`                         | main, specialBuild | current          | `build.ts`  | T2   |
| `buildCity`            | `vertex`                         | main, specialBuild | current          | `build.ts`  | T2   |
| `discard`              | `resources: ResourceBundle`      | discard            | any pending      | `robber.ts` | T2   |
| `moveRobber`           | `hex`                            | moveRobber         | current          | `robber.ts` | T2   |
| `steal`                | `victim`                         | steal              | current          | `robber.ts` | T2   |
| `buyDevCard`           | — (in specialBuild → `devCards`) | main, specialBuild | current          | `dev.ts`    | T3   |
| `playKnight`           | —                                | preRoll, main      | current          | `dev.ts`    | T3   |
| `playRoadBuilding`     | —                                | preRoll, main      | current          | `dev.ts`    | T3   |
| `placeFreeRoad`        | `edge`                           | roadBuilding       | current          | `dev.ts`    | T3   |
| `playYearOfPlenty`     | `resources: [R, R]`              | preRoll, main      | current          | `dev.ts`    | T3   |
| `playMonopoly`         | `resource`                       | preRoll, main      | current          | `dev.ts`    | T3   |
| `bankTrade`            | `give, receive` (1 unit out)     | main               | current          | `trade.ts`  | T3   |
| `offerTrade`           | `give, want, to[]`               | main               | current          | `trade.ts`  | T3   |
| `acceptTrade`          | —                                | trade              | addressed player | `trade.ts`  | T3   |
| `rejectTrade`          | —                                | trade              | addressed player | `trade.ts`  | T3   |
| `cancelTrade`          | —                                | trade              | offerer          | `trade.ts`  | T3   |
| `confirmTrade`         | `partner`                        | trade              | offerer          | `trade.ts`  | T3   |
| `vetoMap`              | `candidate` (index)              | mapVeto            | current vetoer   | `veto.ts`   | V1   |
| `eventGain`            | `resource`                       | event              | task owner       | `events.ts` | V1   |
| `eventGive`            | `to, resource`                   | event              | task owner       | `events.ts` | V1   |
| `eventSteal`           | `victim` (null = pass, optional) | event              | task owner       | `events.ts` | V1   |
| `eventDamageRoad`      | `edge` (own road)                | event              | task owner       | `events.ts` | V1   |
| `repairRoad`           | — (1 brick + 1 lumber)           | main, specialBuild | current          | `build.ts`  | V1   |

All files above live in `src/engine/actions/`. Each file's header comment lists the expected rules.

## 7. applyAction / legalActions (`src/engine/engine.ts`)

```
applyAction(state, action):
  phase gameOver?          → { ok:false, error:'game is over' }
  unknown action.type?     → error    ('<x>/...' only if module x is active)
  action.player not 0..n-1 → error
  draft = cloneState(state)                         // clone.ts, see below
  result = handler(draft, action)                   // HANDLERS[type] wrapped by active modules' overrides,
                                                    // or the module's own handler (EXPANSIONS.md §4)
  if ok: afterAction hooks
         updateAwards(draft, { roads: changesRoads(type) || module changesRoads }) (rules/awards.ts)
         checkVictory(draft) (rules/victory.ts; a module's `deferVictory` hook can switch it off)
         recordAction(state, draft, action) (stats.ts, UX2)
         trim draft.log to the newest LOG_LIMIT entries
  return result
```

Core rules call expansion hooks only through `src/engine/expansions/hooks.ts` (`costOf`,
`pieceLimit`, `cardsInHand`, production, roll, 7, VP, trade ratio, road length, turn start/end,
placement blockers; table in EXPANSIONS.md §5). With no active module every runner is a no-op.

- **Pure:** the input state is never mutated (tested with a deep-frozen state).
- **Structural sharing (`cloneState`)**: `board`, `settings` and `stats` (UX2, immutable) are shared
  between states, and so are log entries (the `log` array itself is copied). Everything else is copied. So handlers must
  **never mutate `board`, `settings` or an existing log entry** (append with `log()` only). A new
  GameState field must be copied in `clone.ts` (`clone.test.ts` fails otherwise). This replaced
  `structuredClone`, which was ~85% of sim time. Map-veto candidate boards are shared like `board`;
  the veto handler replaces `draft.board` with the chosen one (assigning, never mutating).
  Optional variant fields are copied only when present (no `undefined` keys). Expansion slices
  (`ext`) and expansion phases are deep-copied (`cloneJson`, or the module's `cloneExt`); an
  expansion may replace `draft.board` copy-on-write (fog reveal) but never mutate it.
- **Longest Road** is recomputed only after actions that add a road or occupy a vertex
  (`changesRoads`: setup settlement/road, buildRoad, buildSettlement, placeFreeRoad). A new action
  that changes roads or building occupancy must be added there. Largest Army is always recomputed.
- `legalActions(state, player?)` = concat of every area's `LegalGenerator`, then active modules'
  `legal`, then their `filterLegal`, optionally filtered by actor.
  **Sound** (everything returned is accepted by applyAction — tested) and **complete**, except
  `offerTrade`, which is open-ended: return a bounded sample (e.g. 1-for-1 offers).
  Discard combos can be numerous (≤ ~1000) — acceptable.

### How to implement / add an action handler

1. Find your action in `src/engine/actions/<area>.ts`. Replace `() => notImplemented()` with
   `(draft, action) => { …validate…; …mutate draft…; log(draft, action.player, '…'); return ok(draft); }`.
2. Validate **everything**: phase, actor (`isCurrent`), ids (`isBoardVertex(topologyOf(draft), v)` …), bundles (`isValidBundle`), costs (`hasResources`), pieces (`piecesLeft`).
3. Fill in the area's `<area>Legal` generator. Keep it consistent with the handler (ideally share a `canX(state, …)` predicate).
4. Tests next to the file: `src/engine/actions/<area>.test.ts`. Every rule gets a test.
5. **New action type?** Add it to the `Action` union in `types.ts`, to your area's `HandlerMap<…>`, the table in §6, and the `SAMPLES` map in `engine.test.ts`. TypeScript will flag any missing handler. You should not need to touch `actions/index.ts`.

Helpers (`src/engine/actions/common.ts`): `ok, fail, notImplemented, log, isCurrent`, types `Handler<T>, HandlerMap<T>, LegalGenerator`.

## 8. Shared helpers (already implemented + tested)

| Module                 | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constants.ts`         | `RESOURCES, DEV_CARD_TYPES, PROGRESS_CARD_TYPES, COSTS, PIECE_LIMITS, DEV_DECK_COMPOSITION, DEFAULT_DISCARD_LIMIT, LONGEST_ROAD_MIN, LARGEST_ARMY_MIN, AWARD_VP, MAX_TRADE_OFFERS_PER_TURN, LOG_LIMIT, DICE_DECK_SIZE, DICE_DECK_RESHUFFLE_AT, PLAYER_COLORS (8 default seat colours), tokenPips` …                                                                                                                                                                                                                                                                                                            |
| `maps.ts`              | `MAPS, MAP_IDS, isMapId, mapOf, supplyOf, defaultMapFor`, frames (§3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `migrate.ts`           | `upgradeState`, `SCHEMA_VERSION` (§4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `resources.ts`         | `emptyResources, emptyDevCards, emptyProgressCards, toCounts, isValidBundle, isResource, addResources, subtractResources, hasResources, totalResources`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `clone.ts`             | `cloneState` — applyAction's draft copy (structural sharing, see §7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `rules/placement.ts`   | `isVertexOpen` (distance rule), `canPlaceSettlement(s,p,v,{requireRoad})`, `canPlaceCity`, `canPlaceRoad(s,p,e,{fromVertex?})`, `touchesOwnRoad` — geometry only, no cost/phase/pieces                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `selectors.ts`         | `setupPlayerAt, setupOrderOf, getPlayer, currentPlayer, buildingsOf, roadsOf, piecesLeft, publicVictoryPoints, victoryPoints, handSize, portsOf, actingPlayers`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `board.ts`             | `generateBoard(map, rng, players?, mapRules?, firstDesertOnly?)` (custom scenario maps: their own `generate`), `beginnerBoard()`, `randomBoard(rng, map, mapRules?, firstDesertOnly?)`, `redNumbersSeparated(hexes, map)`, `mapRuleViolations`; for scenario generators (F1) `assembleBoard`, `dealTokens`                                                                                                                                                                                                                                                                                                     |
| `createGame.ts`        | `createGame({ seed, players: {name,color}[], map?, vpToWin?, discardLimit?, balancedDice?, specialBuildPhase?, hideBankCards?, turnTimerSec?, startingPlayer? })` → setup phase, starting player first. `layout?` still accepted (v1 compat, → `layoutToMap`). `resolveSettings(config)` validates without building a game. F1 keys: `mode?, expansions?, scenario?, options?`. V1/V2 config keys: `robberMode?, eventCards?, setupPlacement?, randomTurnOrder?, mapSelection?, rushMode?, turboMode?, secondSettler?, timer?, mapRules?, rules56?` (§4); `randomSeatOrder(seed, n)`, `randomMapFor(seed, n)`. |
| `rules/longestRoad.ts` | `longestRoadLength(s,p)`, `longestRoadLengths(s)` — longest trail, broken by opponent buildings (T3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `actions/trade.ts`     | `bankTradeRatio(s,p,resource)` → 2 / 3 / 4 (T3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `actions/turn.ts`      | `specialBuildQueue(s)` → builders still to come in a `specialBuild` phase (as far as known now; T14, for the turn pill); `secondSettlerFor(s, owner)` (V1); `continueRoll(draft)`, `discardAmounts(s)` (F1)                                                                                                                                                                                                                                                                                                                                                                                                    |
| `variants.ts` (V1)     | accessors with defaults (`robberModeOf, setupPlacementOf, eventCardsOn, hasRobber`), `robberTargets, isRobberProtected, roadsBlocked, nextToDamagedRoad`, option lists, `OFFICIAL_SETUP`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `clock.ts` (V1)        | chess clock, pure: `TIMER_PRESET_VALUES, timerSettings, timerOf` (legacy per-turn vs bank), `initialBanks, chargeBank, creditIncrement, turnKey, restoreBanks`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `rules/events.ts` (V1) | `EVENT_CARDS` (36), `EVENT_INFO` (names, texts), `facesFor`, `drawEventCard`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `actions/veto.ts` (V1) | `MAP_VETO_CANDIDATES` (3), `vetoOrder`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `expansions/*` (F1)    | registry (`listModes, modeById, scenarioById, expansionById, activeModules, isActive, mapDef`), hook values (`costOf, pieceLimit, terrainKind, expansionVictoryPoints`), `extSlice, cloneJson, NO_ROBBER, doubledToHexId`; `createGame.ts`: `resolveMode, defaultVpToWin, optionVpBonus`. See `docs/EXPANSIONS.md`.                                                                                                                                                                                                                                                                                            |
| `selectors.ts` (F1)    | `cardsInHand(s, p)` (resources + expansion cards, for the 7 rule and stealing); `piecesLeft` uses `pieceLimit`; VP selectors add expansion VP                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `view.ts` (M1)         | `viewFor(s, seat \| 'spectator')` → `GameView` (secrets masked, `view: { viewer, handCounts, devCardCounts, masked, specialBuildQueue }`), `isGameView`, and for UI code `handCount(s,p)`, `devCardCount(s,p)`, `visibleSpecialBuildQueue(s)` (full state or view). `HIDDEN_SEED`, `HIDDEN_DEV_CARD`, `HIDDEN_DICE_CARD`, `HIDDEN_EVENT_CARD` (V1: the event deck order is masked; veto candidates, event tasks, `lastEvent`, `damagedRoads` and `seatOrder` are public)                                                                                                                                       |
| `stats.ts` (UX2)       | `statsOf`, `emptyStats`, `sumCounts`, `GAIN_SOURCES`, `LOSS_SINKS`, `DICE_TOTALS` (exported); `recordRoll`, `recordProduction`, `recordAction` (engine-internal hooks) — §4 "Game statistics"                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 9. Randomness (`src/engine/rng.ts`)

mulberry32; the whole state is the uint32 `state.rng`. In a handler:

```ts
const rng = new Rng(draft.rng);
const d1 = rng.die(),
  d2 = rng.die();
draft.rng = rng.state; // always write back
```

`Rng` also has `int(n)`, `float()`, `pick(arr)`, `shuffle(arr)` (returns a copy). `createGame` seeds from `settings.seed` (number or string), generates the board, shuffles the deck, and stores the continuing state.
`rollDice` goes through `rollTwoDice(draft)` (`rules/dice.ts`): two `die()` calls, or with
`balancedDice` a `pop()` from `diceDeck`, refilled with `rng.shuffle(DICE_CARDS)` when
`DICE_DECK_RESHUFFLE_AT` (5) or fewer cards remain (the deck starts empty).
Bots should use their **own** `Rng` so bot choices don't perturb game randomness.

## 10. Fixtures (`src/engine/fixtures.ts`)

Each returns a fresh, internally consistent state on the beginner board (map `base`; checked in `fixtures.test.ts`):

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

| Task               | Owns                                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 foundation      | `types.ts, hex.ts, topology.ts, rng.ts, board.ts, constants.ts, resources.ts, selectors.ts, rules/placement.ts, createGame.ts, engine.ts, actions/index.ts, actions/common.ts, fixtures.ts`, tooling           |
| **T2 rules-core**  | `actions/setup.ts, actions/turn.ts` (incl. production), `actions/build.ts, actions/robber.ts, rules/victory.ts`; may add `rules/production.ts` etc.                                                            |
| **T3 rules-trade** | `actions/trade.ts, actions/dev.ts, rules/awards.ts` (longest road, largest army); may add `rules/longestRoad.ts` etc.                                                                                          |
| **T4 render**      | `src/render/**` (replace `proofBoard.ts`), board part of `src/main.ts` if needed                                                                                                                               |
| **T5 bots + sim**  | `src/bots/**` (`index.ts` random bot, `sim.ts`, invariant checks)                                                                                                                                              |
| T6 UI              | `src/ui/**`                                                                                                                                                                                                    |
| T7 integration     | `src/game/**`, `src/main.ts`                                                                                                                                                                                   |
| F1 framework       | `src/engine/expansions/**`, `src/engine/mapLookup.ts`, `src/{render,ui,bots}/expansions.ts`, `docs/EXPANSIONS.md`, `src/expansions/demo/**`; expansion agents own `src/expansions/<id>/**` (EXPANSIONS.md §13) |

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
view.setInsets(insets, avoid?);           // Insets = { top, right, bottom, left } px. insets: permanent HUD (board fits inside);
                                          // avoid: transient overlays (docked trade card) the board slides away from, never zooms for
view.isFitted();                          // false once the user panned/zoomed, until the next refit
view.screenPos(id);                       // page CSS px of a vertex/edge/hex id, or null (playtest harness)
setFrameColors({ frame, frameDark, frameLight }); view.retheme();  // board frame colours (UI theme), redraws the sea only
```

- The view never decides legality: pass ids from `legalActions`, map clicks back to actions.
- While any highlight list is non-empty, only highlighted ids are hoverable/clickable; with none, everything is.
- Drag = pan, wheel = zoom at cursor, pinch on touch, double-click = refit.
- Camera (`render/viewport.ts`, unit-tested): the fitted view is the pure `fitBoardView(bounds, w, h, insets, avoid)`
  (inside the insets, or the full screen if they leave < `MIN_INSET_FIT`; negative margins count as 0; `avoid`
  only translates). The fitted camera follows every resize and inset change. Only a real gesture switches to the
  manual camera: a _pressed_ drag past `TAP_SLOP` (6 px), a wheel, a two-pointer pinch. A mouse press is always a
  single pointer (a missed release is dropped, and a move with no button held is a hover, never a drag). Inset
  changes leave a manual camera alone; a real size change, double-click, `fit()` or the "Fit board" button refit.
- The fit frames `fitBounds(topo)` (land hexes + harbor badges); the sea backdrop/frame (`boardBounds`) may run
  under the HUD and only bounds the pan clamp. Board `Text` is re-rasterized at `textResolution(pxPerUnit, dpr)`
  150 ms after the zoom settles (no minified/magnified glyph bitmaps); the view keeps `renderer.resolution` equal to
  `devicePixelRatio` (browser zoom, monitor change). `view.textResolution()` reports the current text resolution.
- The view draws the board of `topologyOf(state)`; a state on another frame rebuilds the sea and refits (`Viewport.setBounds`). Big boards get a plain backdrop for now (T12 makes them pretty).
- Pure math (fit/zoom/hit-test, unit space) is in `render/geometry.ts`, unit-tested. `pick`, `hexAt`, `boardBounds`, `backdropRadius` take an optional topology (default: the 19-hex one). Dev: `?fixture=midGame`, `?hl=vertices|edges|hexes`.
- Also exported for the UI: `drawResourceIcon`, `RESOURCE_COLORS`, `TERRAIN_COLORS`.
- Expansions (F1): active modules' `BoardDrawer`s (`render/expansions.ts`) paint their terrains and
  draw layers in three slots (board / pieces / top), rebuilt when their `sig` changes. Highlights,
  hover, clicks and `screenPos` also work on sea vertices/edges and water hexes.

## 13. UI contract (`src/ui`, T6)

```ts
import { Hud } from './ui';
const hud = new Hud(document.getElementById('ui')!);          // overlay; only its panels take pointer events
hud.render(state, { viewer, legal, isBotTurn, bots?, turnTimer? }); // call after every state change / viewer change
                                                              // bots: boolean[] by PlayerId (bot marker); turnTimer: { remainingSec, totalSec } | null (T14)
hud.setBotSpeed({ value, presets, onChange } | null);         // bot-speed picker inside the HUD menu (main.ts wires it)
hud.on('action', (a: Action) => …);                           // controller applies it via applyAction
hud.on('newGame', (cfg: NewGameConfig) => …);                 // setup screen (src/ui/setup): { mode, scenario?, options?, map:'base'|'baseRandom'|'base56'|'base78', players:{name,color,controller}[], rules:{balancedDice,hideBankCards}, turnTimerSec:number|null, vpToWin, discardLimit, seed? }
hud.on('placeMode', (m: PlaceMode|null) => …);                // 'road'|'settlement'|'city' or an expansion build card's '<id>/<x>'; board shows targets
hud.showNewGame();                                            // open the new-game screen (also the winner screen's button)
hud.isCovered();                                              // hotseat cover or new-game screen up (controller pauses the turn timer)
hud.setTurnTimer({ remainingSec, totalSec } | null);          // between renders: redraws only the turn pill (T14)
```

- Turn pill (T14): the timer badge goes red and pulses, and the pill glows red, for the last
  `TIMER_WARN_SEC` (10) seconds. In a special build step the title is "Special build: Blue" (or
  "you") followed by `.turn-next` "then Red, White" (`specialBuildQueue`), or "then Orange's turn".
- Disabled build-bar buttons (T14) explain why: `blockReasons(state, viewer, card)` (model.ts) →
  not your turn / roll first / finish the current step, no pieces or dev cards left, "Missing 1
  brick" (+ card faces), no legal spot. Each button sits in a `.bslot`; a disabled one has
  `pointer-events: none`, so the slot gets hover (`.why` bubble) and tap (opens it for 3.5 s). The
  reason is also in the button's `data-why` (playtest harness).

- Expansions (F1): active modules' `HudExtension`s (`ui/expansions.ts`) add a sidebar panel,
  build cards (namespaced place modes), dialogs for their phases, turn-pill hints, cards in the
  hand bar (`handCards`) and items in the trade offer rows (`offerExtras`). The setup
  screen's mode tiles, scenario tiles and option tiles come from the engine registry (`ready`
  modes; `wip`/`demo` too with `?modes=all`); a setup the engine refuses (`setupError`: a module's
  `validate`, e.g. C&K + Rush) shows the reason and disables Start. The build bar has no Buy card
  when the game has no development deck. The stats screen's standings show expansions' named VP
  (`victoryPoints` hook `parts`) as chips. See `docs/EXPANSIONS.md` §8.
- The HUD never mutates state or calls `applyAction`. Buttons are enabled **only** from `legal` actions with `player === viewer`; pass legal actions for the viewer (or all, they are filtered).
- The HUD renders a `GameView` (online, M1) as well as a full state: other players' card counts
  come from `handCount` / `devCardCount`, the special-build queue from `visibleSpecialBuildQueue`.
  Never read another player's `resources` / `devCards` directly (they are 0 in a view).
- Build buttons emit nothing but `placeMode`. HUD leaves the mode itself when pieces/turn/phase change or the build stops being legal (it emits `placeMode(null)`); Esc cancels.
- Implied board clicks (setup placement, robber, free roads) have no HUD button: use `boardPrompt(view)` (`'setupSettlement' | 'setupRoad' | 'moveRobber' | 'freeRoad' | 'damageRoad' | null`) to know what to highlight.
- `offerTrade` is open-ended, so the composer builds its own action; the HUD enables the Trade button when any `offerTrade` is in `legal`.
- Discard is submitted as one `discard` action with exactly `pending[viewer]` cards; the dialog opens when a `discard` for the viewer is in `legal`.
- Hotseat: when `view.viewer` differs from the previously shown viewer a "Pass to <name>" cover hides everything until clicked. Keep `viewer` fixed during bot turns; change it only when a different human should see the screen. After `newGame` the HUD forgets the old viewer.
- Dev page: `ui-dev.html` (`pnpm dev`, open `/ui-dev.html#<fixture>`; `?viewer=2&click=Bank`; `?click=Menu` opens the menu, `?theme=`) with hand-built legal lists (`src/ui/devLegal.ts`, not the engine's).
- Setup seats (UX1): each seat row has a × (`removeSeat(draft, index)`, removes that seat, disabled at
  `MIN_PLAYERS`) and "+ Add player" under the list (`addSeat(draft)`, human, disabled at `MAX_PLAYERS`);
  both keep colours unique, auto-switch the map like the Players stepper and re-render it.
- Themes (`src/ui/theme`, D1): Sunfired (default), Chartroom, Parlour, Wood, GitHub Dark
  (`githubdark.css`, flat 6px, system font) and Material Dark (`materialdark.css`, MD3 tonal
  surfaces, Roboto via `@fontsource/roboto`). Screenshots: `docs/design/themes/`. Every colour,
  material, font and shadow is a CSS custom property; `wood.css` is the `:root` base and each
  theme overrides it under `:root[data-theme='…']` on `<html>`. `initTheme(location.search)` picks
  `?theme=` > saved pick (`localStorage['catan.theme']`, try/catch) > `DEFAULT_THEME`;
  `setTheme(name)` applies, saves and calls `onThemeChange` listeners. `themePicker()` is in the
  HUD menu and (compact) the setup footer. `boardFrameColors()` reads `--board-frame*` for the Pixi
  frame (main.ts → `setFrameColors` + `board.retheme()`); the board canvas is transparent and the
  page background is `--page-bg`. Tokens must not reference per-element vars (`--pc`, `--rc`).
- Layout (T17, wooden theme): right sidebar `.hud-side` (Game Events / Bank / Players, collapsible;
  360px, 300px under 1280px, a drawer under 720px), menu top-left (`.hud-menu`: New game, Bot speed,
  Theme, Rules), turn pill top-centre (`.hud-turn`, replaces the old hint banner; `.hint` keeps the hint
  text), hand + Trade/Bank + build bar bottom-left (`.hud-bottom`), dice + Roll dice / End turn
  bottom-right (`.hud-controls`). `game/layout.ts` measures these for `BoardView.setInsets` (nothing
  while the HUD is covered or has no bottom bar; dialogs are never measured); a docked trade offer card
  (`.scrim.is-side .dialog`, above the hand) is an `avoid` margin: the board slides right without zooming.
  `game/layout.ts` also adds the "Fit board" button (`.board-fit`, top-left under the menu, outside the HUD
  root, hidden while covered) that calls `BoardView.fit()`.
- Game Events parse the engine's log text (`ui/log.ts`): player names, resource counts, rolls,
  pieces, dev cards, robber and awards become icons; "X received …" lines after a roll fold into a
  "Production:" block. Unknown text stays text, so log wording changes degrade gracefully.
  Rolls show both dice from "rolled 8 (3+5)" (T14); pre-T14 logs ("rolled 8") show the number,
  except the latest roll, which borrows its faces from `state.dice`.
- Setup-screen map previews (`ui/setup/mapPreviews.ts`) come from `topologyFor` + `generateBoard`
  (beginner layout for `base`, a fixed sample seed for random maps): land, water ring, harbors.
  `boardPreviewSvg(map, board)` draws a concrete board with its tokens (map veto dialog).
- Variants on the setup screen (V1): Event Cards / Rush / Turbo are rule tiles; the Advanced grid
  has Robber, Chess clock (+ custom bank/increment), Map selection, Turn order switches and Setup
  placement. `NewGameConfig.variants?: NewGameVariants` holds only non-default choices (model:
  `buildVariants`; coupling: `toggle`, `setClockPreset`, `setTimerIdx`). The per-turn timer stepper
  stays; picking a clock preset turns it off and vice versa.
- HUD (V1): `vetoMap` dialog (candidate previews), event-choice dialogs (gain / give / steal),
  a docked "Damaged road" card with Repair, the last event's name under the dice. Board: damaged
  roads are drawn faded and turned; no robber piece with `robberMode: 'none'`. `boardPrompt` can
  return `'damageRoad'`.
- Bank counts hide when `settings.hideBankCards` (or `settings.rules.hideBankCards`) is true; read
  defensively since the engine may not have the field yet.
- Game statistics (UX2, `src/ui/stats/`): the winner card has a "Game stats" button (only when
  the state carries `stats`). The panel (`statsPanel`, stateless; the HUD keeps tab, picked player
  and collapsed flag, reset when a game is in progress) shows "Game Statistics", Winner + colour
  dot, Turns (`turn.number`), Duration h:mm (`HudView.gameDurationMs`, — when unknown), a collapse
  chevron (collapsed = a bar at the bottom, no scrim, the board pans) and tabs Overview (standings
  with VP breakdown, awards), Dice (histogram vs fair-dice expectation, rolls/sevens per player,
  event cards drawn), Resources (totals per player, by type and source for a picked player),
  Activity (VP-over-turns SVG line chart with hover tooltip, builds/trades/robber table), Dev
  Cards (bought/played, Largest Army and Longest Road history). Pure derivations in
  `stats/model.ts`; theme tokens only (player colours for series). Footer: "Results" (back to the
  winner card) + New game / session actions. Works on a game-over `GameView` (online).

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
  `BOT_OFFERS_PER_TURN` (1) offers in a turn. The random bot confirms an accepted own offer with a
  random accepter (it withdraws only while nobody has accepted). Nobody able to act → error toast
  - state on console.
- Game duration (UX2): `start` notes the wall clock (`ControllerOptions.wallClock`, default
  `Date.now`); at game over the controller fixes `durationMs` and passes it as
  `HudView.gameDurationMs`. Saved as `SavedSession.playedMs` (time played so far); `resume` shifts
  the start by it, so time between sessions does not count. Older saves: unknown (null).
- Autosave: `localStorage['catan:save:v1']` = `{ version, state, seats, viewer, botRng, banks?, playedMs? }`, every
  access in try/catch. `state` goes through `upgradeState`, so stage-1 (schema v1) saves still load.
  On load an unfinished save offers Resume / New game. Dev sessions (`?fixture`, `?seed`,
  `?layout`, `?map`, `?autoplay`) never autosave.
- `newGame(cfg)` maps the stage-2 setup config (map, vpToWin, discardLimit, rules, turnTimerSec,
  and the V1 `variants`, spread as is) into `createGame` via `gameConfigOf(cfg, seed)` (`logic.ts`,
  shared with the online room). The starting seat is random (seeded). With Randomize Turn Order the
  seat controllers follow `settings.seatOrder` (seat p = config player `seatOrder[p]`); the online
  room reorders its lobby seats the same way at `start`, so seat index = PlayerId.
- Chess clock (V1, `settings.timer`, `timerOf(...).kind === 'bank'`): a bank per player (ms), kept
  by the controller (saved as `SavedSession.banks`) and by `GameSession` (`GameRec.banks`, in the
  room snapshot). The same `timerSlot` says who is on the clock; `syncBankClock` loads that
  player's bank and `bankAfterAction` (both in `turnTimer.ts`) banks the running time and credits
  the increment (`creditIncrement`) when a turn / placement / build step ends. An empty bank expires
  at once, so `timeoutMove` plays the minimum moves. Online, `TimerInfo` carries the bank as
  `remainingMs` and the starting bank as `totalMs`.
- Event cards (V1): `obligated` includes players with an event task, so viewer, bots (hotseat and
  `GameSession`) and the timer treat them like discards. Earthquake roads are picked on the board
  (`eventDamageRoad` is an implied board action).
- Turn timer (T14, `settings.turnTimerSec`): pure logic in `game/turnTimer.ts` (unit-tested),
  ticked every `TIMER_TICK_MS` (250) by the controller, which passes `clockView` as
  `HudView.turnTimer` and calls `hud.setTurnTimer` when the shown second changes.
  - `timerSlot(state, seats, legal, viewer)` = the one human on the clock: the current player's
    whole turn (`turn`, incl. setup placements and their own offer once no human still has to
    reply), a human owing a discard or a trade reply (`discard`/`trade`, the viewer first), or a
    `specialBuild` step. Bots are never timed. A new slot key starts the full time.
  - `syncClock` stashes a running turn while others react (discards, replies, bots) and resumes it,
    so waiting never costs the current player time; a player whose turn already ran out gets no
    fresh time to discard on their own 7.
  - The clock does not tick while `hud.isCovered()` (hotseat cover, new-game screen): it starts
    when the human reveals. A background tab counts at most 1 s per tick.
  - On timeout, `timeoutMove` makes one minimum move per tick until the slot is over: roll, random
    legal discard, random robber hex + random steal, random setup piece / free road, reject the
    reply or cancel the own offer, pass the special build step, end the turn. Never builds, buys or
    trades. One toast "Blue ran out of time"; random picks use an `Rng` seeded `timer:<seed>`.
- Special building phase (T13 engine, T14 controller): `turn.current` is the builder, so `pickViewer`
  hands the screen to a human builder (the cover shows when it changes humans), `nextBot` runs bot
  builders, and the timer gives each human step its own slot.
- Dev params (`game/params.ts`): `?fixture=`, `?seed=`, `?layout=`, `?map=base56`, `?seats=hbbbbb` (3–8), `?vp=`, `?speed=ms`,
  `?autoplay=4bots` (3–8 bots), `?hl=`, `?names=A,B,C` (names for param games), `?timer=20` (turn
  timer in s, also on fixtures), `?first=0` (starting seat), `?mode=demo` (F1: start an expansion
  mode), `?modes=all` (setup screen also offers wip / demo modes). `window.catan` = `{ controller, board, hud }`.
- Playtest hook (`game/debug.ts`, only with `?debug=1`): read-only `window.__catanDebug` =
  `{ state(), legal(player?), viewer(), boardTargets(), screenPos(id), consoleErrors() }`.
  `screenPos` comes from `BoardView.screenPos(id)` (page CSS px). Used by `scripts/playtest`
  (`pnpm pt:serve`, `pnpm pt`; see `playtest/PLAYBOOK.md`), which acts only through real clicks.

## 14. Decisions and open questions

- **Port positions:** the 9 ports sit on every other water hex of the ring (starting top-left); a water hex touching two land hexes faces the one that is not a corner of the land hexagon. That gives 2,3,2 free coastal edges between ports, 3-fold symmetric. Verified (T8) against the 5th-edition rulebook's beginner map; the frame's harbors are fixed, so the random layout uses the same positions. Details + sources: `docs/RULES.md` §12. The 37-hex frame uses the same rule (ties: the clockwise hex); the 30-hex frame lists its 11 spots explicitly, read from the 5-6 rulebook (RULES.md §16.B).
- **Beginner layout** (`board.ts`): terrain, tokens and harbor kinds verified (T8) against the rulebook's Illustration A. Starting settlements of the beginner setup are not encoded (see RULES.md §12 for them).
- **Random layout:** terrain shuffled, tokens rejection-sampled until no 6/8 are adjacent, port kinds shuffled (positions fixed). Same for every random map; with several deserts the robber starts on a random one (one extra RNG draw only then, so 19-hex boards are unchanged per seed).
- **Bigger maps (T10):** `base56` follows the official 5-6 extension; `base78` is our own design because no official 7-8 rules could be found (RULES.md §16). Map player ranges are hard limits in `createGame`. The sim's default `--max-steps` now grows with the player count (T13: 5000 / 15000 / 30000 for 3-4 / 5-6 / 7-8); `--sbp on|off` and `--balanced-dice` pick the T13 rules.
- **Special Building Phase (T13):** implemented instead of catan.com's 2021 "paired players" turn (RULES.md §16.D; paired turns are a backlog idea). `turn.current` is the builder during the phase, so `actingPlayers`, the controller and bots need no special case; `phase.owner` says whose turn ended. Nobody wins during it (FAQ). Players who can do nothing are skipped (RULES.md 16.10h). Dev cards bought in it go to `devCards` (playable on the buyer's next turn). UI: the End turn button becomes "Pass".
- **Balanced dice (T13):** reshuffle at ≤ 5 cards left, so a cycle is 31 rolls and the last rolls stay unpredictable (RULES.md §17).
- **Turn order (T14):** seats keep the config order; a seeded random seat starts (instead of rolling
  for it, RULES.md 2.7) and play goes clockwise from there. `startingPlayer: n` fixes it (fixtures,
  tests, `?first=`).
- **Dev cards pre-roll:** official rules allow any one dev card at any time on your turn, incl. before rolling. The phase design supports all of them in `preRoll`.
- **Steal:** a separate `steal` action even with one candidate (uniform for UI/bots); skipped when nobody can be robbed.
- **Player trade:** two-step (responders accept, offerer confirms with one partner). Only the current player can initiate.
- **Bank shortage:** if the bank can't pay a resource to everyone owed, nobody gets it, unless only one player is owed (gets the remainder).
- **Victory:** only checked for the current player (official: you win on your own turn). Not checked during setup or the special building phase. A player who reaches `vpToWin` on someone else's turn (e.g. Longest Road shifting) wins right after the previous player's `endTurn`, i.e. as their own turn starts.
- **Steal log:** says who stole from whom, never which card (the log is public).
- **Road Building (T3):** rejected when the player could place no road at all (no pieces or no legal edge), so the card is never wasted. `remaining = min(2, roads left)`; the phase also ends early once no legal edge remains.
- **Year of Plenty (T3):** the bank must cover both cards; no partial grant.
- **Player trade details (T3):** `to` = distinct other players, non-empty. Only `'pending'` responders may respond (no changing your mind). Acceptor must hold `want` when accepting; both sides are re-checked at confirm. Offer auto-closes to `main` when every addressee rejected. The legal sample of `offerTrade` = 1-for-1 offers to all opponents for each held resource.
- **Trade offer cap (T8, house rule):** at most `MAX_TRADE_OFFERS_PER_TURN` (3) `offerTrade`s per
  turn, counted whether confirmed, cancelled or rejected by all. Bank trades are unlimited. The
  official rules set no limit; without one, random bots loop offer → all reject → offer and games
  never end. Raise the constant if humans find it tight.
- **Longest Road ties (T3):** holder keeps it while tied for longest; otherwise the unique leader (≥ 5) gets it; a tie without the holder → nobody. Largest Army uses the same rule with ≥ 3 knights.
