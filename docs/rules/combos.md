# Official expansion combinations — engine status (card C1)

Rules research for the combinations is in `docs/rules/scenarios-and-combos.md` part C and in §8
of `seafarers.md`, `cities-knights.md` and `traders-barbarians.md`. This file records what the
engine does, rule by rule, and what is left. The 2025 combination sheets on catan.com were read in
full for this card (text extracted from the PDFs, 2026-10-26):

- `2025-07/TradersnBarbarians w CnK.pdf`, `2025-07/Rivers of Catan w CnK.pdf`,
  `2025-08/Fishing on Catan w CnK.pdf`, `2025-07/Merchant Trains w C&K.pdf` (T&B + C&K)
- `2025-07/Fishing on Catan w SEA.pdf`, `2025-07/TradersBarbarians w SEA.pdf` (T&B + Seafarers;
  the latter's set-ups are diagrams only)

Seafarers + C&K has no 2025 sheet; its rules are the catan.com product-page text (C2).

**Status legend:** OK = implemented as written and tested; ours = our ruling where the sources
are silent; — = not implemented.

## 0. How combinations are built (framework)

A combination is a **small module that `requires` the two expansions** and declares one mode;
the mode lists only the official scenarios. The two expansion modules run unchanged; the combo
module adds the pair's own rules and decides where both hook the same point.

| Framework piece (added for C1)                   | What it does                                                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ExpansionModule.before: ExpansionId[]`          | Composition order: the module runs its hooks, `legal` and `filterLegal` before the named modules (`composeOrder` in createGame), and wraps their handlers outermost (sees each action first). Tested in `hooks.test.ts`. |
| `ExpansionModule.wraps: { '<id>/<x>': ExtWrap }` | Wrap another module's action handler, like `overrides` for base actions (`seafarers/pickShip`, `tb/bid`, `ck/pickEdge`, ...).                                                                                            |
| hook `routeEdges(state, p)` (additive)           | Extra edges of a player's route for pieces that travel along roads. C&K's knight routes read it (`ck/engine/routes.ts`); `seack` returns the player's ships.                                                             |

Composition order per mode (tested in each combo's `the mode` test):

| Mode           | Order                      | First-wins hooks decided by the combo                                                                                                                                                                                                                                            |
| -------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seafarers+ck` | `seack`, `ck`, `seafarers` | `afterProduction`: C&K commodities → Seafarers gold (and cloth) → the Aqueduct for players who got nothing (gold counts). `onSeven`: C&K's (Seafarers has none). Robber vs pirate: a 7 moves either; a knight's chase moves what it chased.                                      |
| `tb+ck`        | `tbck`, `ck`, `tb`         | `afterProduction`: C&K commodities + Aqueduct players, then T&B fish (fish are no cards: FAQ 43). `onSeven`: C&K first (sleeping robber; in T&B the barbarians' 7 move sleeps too), then T&B. `rollDice`: T&B only (2/12 re-roll; the event die is a C&K `onRoll` step, FAQ 62). |

Edits to other modules (all additive, listed for the merge): C&K routes read `routeEdges` and
never recruit a knight on a vertex without land (`isRecruitSpot`); C&K draws knights on sea
vertices; C&K's sim invariants compare only its own VP and check the sleeping robber on C&K's own
boards only.

## 1. Seafarers + Cities & Knights — module `seack`, mode `seafarers+ck`

Scenarios: Heading for New Shores, Through the Desert; 3-6 players (5-6: the Seafarers 5-6 maps +
C&K's 5-6 supply and special build phase — **ours**: no official text names a 5-6 combination).
Tests: `src/expansions/seack/engine/seack.test.ts`, `bots.test.ts`, `ui.test.ts`.

| Rule (scenarios-and-combos.md C2 / seafarers.md §8.2)                              | Status   | Engine                                                                                                                                                                             |
| ---------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C2.1 only suitable scenarios                                                       | OK       | The mode offers HNS and Through the Desert; `validate` refuses others.                                                                                                             |
| C2.2 VP target + 2                                                                 | OK       | `vpBonus: 2` (16 for both).                                                                                                                                                        |
| C2.3 road rules apply to ships: Road Building                                      | OK       | C&K's card uses the base `roadBuilding` phase, where Seafarers offers free ships.                                                                                                  |
| C2.3 … Diplomat                                                                    | OK, ours | An open ship (not on a closed route, a free end) may be removed; your own may be placed again as a ship or taken back (`seack/engine/diplomat.ts`); playable for open ships alone. |
| C2.3 … Intrigue / Deserter / knight links                                          | OK       | Ships are route edges (`routeEdges`), so "touched by your roads" includes ships.                                                                                                   |
| C2.4 barbarians attack every island                                                | OK       | C&K counts every city and active knight on the board.                                                                                                                              |
| C2.5 knights cross the sea along roads and ships; an active knight may stop at sea | OK       | `routeEdges` = own ships; a knight at sea stands on its owner's ship (sim invariant).                                                                                              |
| C2.5 … never recruited at sea                                                      | OK       | `isRecruitSpot` needs a land hex at the vertex.                                                                                                                                    |
| C2.6 a knight at the end of a ship route closes it                                 | OK       | A ship with a knight at an end cannot be picked up (`wraps['seafarers/pickShip']` + filter). The knight never loses its link.                                                      |
| C2.7 a foreign knight / settlement cuts a route; ships beside it stay put          | OK       | Trade route: Seafarers uses `blocksRoute` (C&K knights). Ships bordering a foreign building or any knight cannot move.                                                             |
| C2.8 deactivating a knight next to the pirate moves the pirate                     | OK       | `seack/chasePirate` from the knight dialog → `moveRobber` with the pirate only; a robber chase moves the robber only (**ours**).                                                   |
| C2.9 a city on gold takes resources only; no merchant on gold                      | OK       | C&K makes commodities on forest / pasture / mountains only; its merchant skips gold. Gold picks count as cards for the Aqueduct.                                                   |
| C2.10 the pirate sleeps like the robber until the first attack                     | OK       | C&K's `onSeven` skips the robber step; chasing the pirate needs an attack; sim invariant: robber and pirate unmoved before it.                                                     |
| Bishop (Taxation) moves the robber only                                            | OK       | Its hexes follow Seafarers' robber rules (land, scenario bans).                                                                                                                    |

## 2. Traders & Barbarians + Cities & Knights — module `tbck`, mode `tb+ck`

Scenarios and VP: Fishermen 13 (the old boot: 14), Rivers 13, Caravans 15, Traders & Barbarians
15, the variants (Harbormaster, Friendly Robber, Event Cards on the base board) 13; 3-6 players.
Tests: `src/expansions/tbck/engine/tbck.test.ts`, `bots.test.ts`, `ui.test.ts`.

| Rule (2025 sheet)                                                                                         | Status   | Engine                                                                                                                      |
| --------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| Fishing: fish are no cards; Aqueduct when only fish came                                                  | OK       | Fish live in T&B's slice; production order above.                                                                           |
| Fishing: 3 fish steal a resource or a commodity                                                           | OK       | `wraps['tb/fish']` steals with C&K's `stealRandom`.                                                                         |
| Fishing: 4 fish take a resource (no commodity)                                                            | OK       | T&B's rule unchanged.                                                                                                       |
| Fishing: 7 fish take a progress card of your choice                                                       | OK       | `tbck/fishProgress { card }` (any kind still in a stack; a VP card is laid out).                                            |
| Rivers: setup buildings on a river pay 1 gold, cities too                                                 | OK       | T&B already pays it.                                                                                                        |
| Rivers: commodities sell for gold at 4:1 / 3:1 / 2:1                                                      | OK       | `tbck/sellCommodity` at C&K's commodity rate.                                                                               |
| Rivers: gold buys resources only, twice a turn                                                            | OK       | T&B's `tb/buyResource`.                                                                                                     |
| Rivers: knights move over bridges                                                                         | OK       | Bridges are road pieces.                                                                                                    |
| Rivers: a city about to be pillaged may be kept for 5 gold                                                | OK, ours | `tbck/ransom` after the roll (`ransom.ts`): city and wall restored, plus what the city would have produced on that roll.    |
| Rivers: Diplomat never takes a bridge; a river road costs 1 gold; an own road re-placed on a river pays 1 | OK       | `wraps['ck/pickEdge']` + filter.                                                                                            |
| Merchant Trains (Caravans): robber after the first attack                                                 | OK       | C&K's sleeping robber.                                                                                                      |
| Merchant Trains: bid brick and lumber                                                                     | OK       | `wraps['tb/bid']` (`{ brick, lumber }`), own legal and dialog.                                                              |
| T&B: remove a forest instead of a field                                                                   | OK, ours | `init` turns one random forest of the T&B board into a field.                                                               |
| T&B: no development cards (BA's / T&B's)                                                                  | OK       | C&K's supply; `buyDevCard` refused (no Swift Journey draws).                                                                |
| T&B: coins buy resources only                                                                             | OK       | T&B's rule.                                                                                                                 |
| T&B: an active knight next to a barbarian moves it to any free path, robs any card, deactivates           | OK       | `tbck/chaseBarbarian { edge }` (click the barbarian) → T&B's barbarian placement; the steal takes resources or commodities. |
| T&B: 2 / 12 re-rolled on the production dice only (FAQ 62)                                                | OK       | T&B's `rollDice`; the Alchemist cannot set 2 or 12.                                                                         |
| T&B: knights never on a trade hex plaza                                                                   | ours     | Plaza centres are not intersections.                                                                                        |
| C&K progress hand limit before T&B's end-of-turn steps                                                    | OK       | Ending the turn or starting the wagon needs ≤ 4 cards.                                                                      |
| Barbarians' 7 move before the first attack                                                                | ours     | Sleeps like the robber (C&K's `onSeven` runs first); knights may chase barbarians at any time (FAQ 63).                     |

## 3. Not built (listed for follow-up cards)

| Combination                                             | Why / what it needs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Barbarian Attack + C&K (13 VP)                          | A redesign (barbarians land by a 3-dice rule, metropolis conquest, knight actions at turn end, special progress cards); scenarios-and-combos.md C4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Catan for Two + C&K (13 VP)                             | 2 players (C&K's module is 3-6), neutral knights, two-version forced trade.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Fishing on Catan + Seafarers (scenario VP, boot +1)     | Sheet read: lake only where surrounded by land; 2 fish remove the pirate; 5 fish build a free ship; the pirate blocks a fishing ground; per scenario: HNS as is; Four Islands 4/8 and 6/10 on the small islands, 5 and 9 on the big ones; Fog, Desert (3p lake on the 2-field, 2 joins the 12 pasture; 4p lake on the 11-hill, 11 joins the 2 hill), Forgotten Tribe (lake on the 12-field), Cloth (3 + 3 grounds), Wonders, New World (grounds placed like the harbours); not Pirate Islands. Needs a seam: T&B switches its features on by its own scenario ids and Seafarers its rules by its own; a combination needs both on one game. |
| Traders & Barbarians + Seafarers (+3 VP)                | Sheet read: wagons cross the sea (2 MP; 1 with your ship; 1 + 1 gold to the owner of another ship); no robber or pirate; barbarians may go on sea edges; HNS and Through the Desert only, set-ups are diagrams (trade hexes, a watering hole as fourth desert in HNS 3p). Same seam as above, plus the maps.                                                                                                                                                                                                                                                                                                                                |
| Rivers / Barbarian Attack / Merchant Trains + Seafarers | scenarios-and-combos.md C5; set-ups are diagrams.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| T&B × T&B (10 sheets, traders-barbarians.md §8.1)       | T6 rulesets; our T&B is T5. With the feature seam above, a pair module could run two features (Fishing + Rivers: no lake, 6 fish = a free bridge, 10 VP).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Explorers & Pirates + C&K / + T&B                       | E&P is on a sibling branch (agent s3-ep): C3 (+5 VP, harbour settlements, Fast Gold), C6 (Fishing only). E&P + Seafarers is officially impossible (`conflicts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## 4. Variants with the combined modes

| Variant                     | `seafarers+ck`                           | `tb+ck`                                                             |
| --------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| Event Cards                 | OK (C&K + Seafarers rules)               | OK where T&B allows it                                              |
| Friendly / no robber        | OK                                       | Refused in Traders & Barbarians (no robber), as in T&B              |
| Chess clock, timers         | OK                                       | OK                                                                  |
| Rush mode                   | Refused (C&K: Alchemist before the roll) | Refused (C&K)                                                       |
| Map balance rules, map veto | Refused (fixed scenario maps)            | Refused (veto: every expansion); balance rules follow T&B           |
| Harbormaster                | —                                        | OK on every scenario (+1 VP; a metropolis counts as a city, FAQ 37) |

## 5. Bots and sims

Each combo has a `BotExtension`: its invariants (Seafarers + C&K: knights at sea on own ships, no
ship moved from under a knight, robber and pirate asleep until the first attack; T&B + C&K: no
development cards, no knight on a plaza, the progress limit before the wagon) and a steer towards
VP (defend with knights when the barbarians are close and Catan is weaker). Sim results: §6.

## 6. Sim results (final code)

`pnpm sim -- --mode <mode> --scenario <s> --players <n> --games <g> --bias 0.5` (default step caps:
5000 at 3-4 players, 15000 at 5-6). Every run: **0 invariant failures, 0 errors, 0 stalls**.
"Capped" = games that hit the step cap unfinished (not a violation; random bots at 16 VP).

| Mode / scenario                   | 4p (300) finished / capped | 3p (50) | 5p (50) | 6p (50) |
| --------------------------------- | -------------------------- | ------- | ------- | ------- |
| `seafarers+ck` New Shores         | 259 / 41                   | 45 / 5  | 50 / 0  | 50 / 0  |
| `seafarers+ck` Through the Desert | 261 / 39                   | 38 / 12 | 50 / 0  | 50 / 0  |
| `tb+ck` Fishermen                 | 291 / 9                    | 48 / 2  | 50 / 0  | 50 / 0  |
| `tb+ck` Rivers                    | 296 / 4                    | 50 / 0  | 50 / 0  | 50 / 0  |
| `tb+ck` Caravans                  | 284 / 16                   | 46 / 4  | 50 / 0  | 50 / 0  |
| `tb+ck` Traders & Barbarians      | 300 / 0                    | 50 / 0  | 50 / 0  | 50 / 0  |
| `tb+ck` variants                  | 298 / 2                    | 50 / 0  | 50 / 0  | 50 / 0  |

Variant runs (20 games each, 0 violations): `seafarers+ck` with Event Cards, the friendly
robber, the variable layout; `tb+ck` Fishermen and Traders & Barbarians with Event Cards,
variants with Harbormaster + friendly robber, Caravans at 5 players.

A Rivers run found 7 stalls (the Diplomat played when every open road was a bridge or a river
road the player could not pay for); fixed in the rules (the card is unplayable then) with a
regression test from the dump (`tbck/bots.test.ts`, `fixtures/rivers-diplomat-stall.json`).

Browser check (`node scripts/shots-combos.mjs <preview url> <dir>`, headless Chrome with
SwiftShader): the setup screen lists both combined modes with their scenario tiles; bot games of
`seafarers+ck` New Shores and `tb+ck` Traders & Barbarians run to game over with no page errors;
the pair panels read correctly in all six themes.
