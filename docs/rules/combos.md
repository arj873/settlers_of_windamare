# Official expansion combinations — engine status (card C1)

Rules research for the combinations is in `docs/rules/scenarios-and-combos.md` part C and in §8
of `seafarers.md`, `cities-knights.md` and `traders-barbarians.md`. This file records what the
engine does, rule by rule, and what is left. The 2025 combination sheets on catan.com were read in
full for this card (text extracted from the PDFs, 2026-10-26):

- `2025-07/TradersnBarbarians w CnK.pdf`, `2025-07/Rivers of Catan w CnK.pdf`,
  `2025-08/Fishing on Catan w CnK.pdf`, `2025-07/Merchant Trains w C&K.pdf` (T&B + C&K)
- `2025-07/Fishing on Catan w SEA.pdf`, `2025-07/TradersBarbarians w SEA.pdf` (T&B + Seafarers;
  the latter's set-ups are diagrams only)
- C2 (card "T&B + Seafarers") read all five T&B + Seafarers sheets (2026-10-26; text and the
  set-up diagrams): `2025-07/TradersBarbarians w SEA.pdf`, `2025-07/Fishing on Catan w SEA.pdf`,
  `2025-07/Rivers of Catan w SEA.pdf`, `2025-08/Merchant Trains w SEA_21.07.25.pdf`,
  `2025-07/Barbarian Attack w SEA.pdf`, and the T&B FAQ entries about Seafarers
  (https://www.catan.com/faq/traders-barbarians: 6, 17-20, 40-41, 53, 58, 65). §2b.

Seafarers + C&K has no 2025 sheet; its rules are the catan.com product-page text (C2).

For card E5b the two Explorers & Pirates sheets were read in full (text and diagrams, 2026-10-26):

- `2025-08/ExplorersPirates w CnK.pdf` (E&P + C&K, 2 pp., §7 below)
- `2025-08/ExplorersPirates w TnB.pdf` (E&P + T&B, 2 pp., §8 below; the fishing-ground places
  are a board diagram, decoded in §8)

and, to check them, the E&P Mission Guide (`2025-04/CN3085 … Missions.pdf`: VP targets, the
Land Ho! board) and Rulebook.

For card C5 (the remaining C&K combinations) the two T&B + C&K sheets not built before were read in
full (text extracted from the PDFs, 2026-10-26; both are 2 pages of text, no set-up diagrams):

- `2025-07/Barbarian Attack w CnK.pdf` (§10 below)
- `2025-07/CATAN for 2 w CnK.pdf` (§11 below)

and, for E&P + C&K at 5-6 players (§12): the E&P 5-6 rules (`2025-04/CN3086 … E&P 5-6 Expansion
Rules.pdf`), both E&P + C&K documents on catan.com (`2025-08/ExplorersPirates w CnK.pdf` and the
older "rules suggestion" `2025-08/ExplorersPirates w CnK_0.pdf`), the E&P and C&K FAQs
(https://www.catan.com/faq/explorer-pirates, /faq/cities-knights), the T&B FAQ (BA entries 1-11)
and the 5-6 player page (/explore-catan/catan-basegame-expansions/play-catan-5-6-players). With
these, every C&K combination catan.com publishes is built: Seafarers (product page), the six T&B
sheets (Fishing, Rivers, Merchant Trains, T&B, Barbarian Attack, Catan for Two) and E&P.

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

| Mode           | Order                      | First-wins hooks decided by the combo                                                                                                                                                                                                                                                                                                    |
| -------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seafarers+ck` | `seack`, `ck`, `seafarers` | `afterProduction`: C&K commodities → Seafarers gold (and cloth) → the Aqueduct for players who got nothing (gold counts). `onSeven`: C&K's (Seafarers has none). Robber vs pirate: a 7 moves either; a knight's chase moves what it chased.                                                                                              |
| `tb+ck`        | `tbck`, `ck`, `tb`         | `afterProduction`: C&K commodities + Aqueduct players, then T&B fish (fish are no cards: FAQ 43). `onSeven`: C&K first (sleeping robber; in T&B the barbarians' 7 move sleeps too), then T&B. `rollDice`: T&B only (2/12 re-roll; the event die is a C&K `onRoll` step, FAQ 62).                                                         |
| `tb+seafarers` | `tbsea`, `seafarers`, `tb` | `afterProduction`: T&B fish (a ground under the pirate pays nothing), then Seafarers gold. `roadLength` (chained): `tbsea` (Caravans: camel-weighted trade route; Barbarian Attack: cut at a conquered settlement), Seafarers' max, T&B last (Traders & Barbarians: 0; Caravans: max with camel roads). `onSeven`, `rollDice`: T&B only. |
| `ep+ck`        | `epck`, `ck`, `ep`         | `setupBuilding` / `setupOrder`: city first (pays), harbor second. `afterProduction`: C&K commodities + Aqueduct, then E&P gold. `onSeven`: E&P's pirate is awake from the first 7 (C&K's sleeping robber is skipped), the Aqueduct pays 1 gold at once and 1 resource after the 7.                                                       |
| `ep+tb`        | `eptb`, `tb`, `ep`         | None shared: T&B's and E&P's `afterProduction` both return nothing (fish, then gold).                                                                                                                                                                                                                                                    |
| `ba+ck`        | `back`, `ck`, `tb`         | `onRoll`: C&K's event die (no ship: `shipSails`). `afterProduction`: the ship's barbarian, C&K's commodities (none from conquered hexes) + Aqueduct, then T&B's. `onSeven`: discards, then BA's steal from any player (no robber; C&K's sleeping robber is skipped).                                                                     |
| `two+ck`       | `twock`, `ck`, `tb`        | `rollDice`: T&B only (the second roll's production dice differ from the first; C&K's event die is rolled in both Roll Dice phases). `afterProduction`, `onSeven`: C&K's (T&B's Catan for Two has none).                                                                                                                                  |

C2 added one more framework seam, so a combination scenario can be a T&B scenario on a
Seafarers map (neither module knew the other's scenario ids):

| Framework piece (C2)                  | What it does                                                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScenarioDef.playsAs` + `scenariosAs` | A combination scenario names the scenarios of the composed modules it plays as (`{ tb: ['tb/traders'], seafarers: ['seafarers/newShores'] }`). T&B's `featuresOf` and Seafarers' `rulesOf` read it (hooks.ts, cached). |
| `CustomMapDef.basedOn`                | A combination map built on a module's map: Seafarers' `mapKeyOf` follows it, so its per-map data (frame cells, bonus areas, harbour supply) applies.                                                                   |
| `changesRoads` may list base types    | A module whose rules turn a base action into a route change asks for Longest Road to be recomputed after it (`tbsea`: `buildCity`, `endTurn`, Treason, Intrigue: a conquest cuts the trade route). Type-only change.   |

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

## 2b. Traders & Barbarians + Seafarers — module `tbsea`, mode `tb+seafarers`

Card C2. Each T&B scenario on **Heading for New Shores**, the one Seafarers scenario all five
2025 sheets support; 3-4 players (the sheets give 3- and 4-player set-ups only). Tests:
`src/expansions/tbsea/engine/*.test.ts` (`tbsea.test.ts`: one per rule), `ui.test.ts`,
`mask.test.ts`.

| Scenario                | Plays as                        | VP (sheet)                           |
| ----------------------- | ------------------------------- | ------------------------------------ |
| `tbsea/traders`         | T&B + New Shores                | 17 (New Shores 14 + 3)               |
| `tbsea/fishermen`       | Fishermen + New Shores          | 14 (the Seafarers target; boot: +1)  |
| `tbsea/rivers`          | Rivers + New Shores             | 14 (ours: the sheet names no change) |
| `tbsea/caravans`        | Caravans (Merchant Trains) + NS | 16 (+ 2)                             |
| `tbsea/barbarianAttack` | Barbarian Attack + New Shores   | 14 ("14 or more VPs")                |

**The boards (ours, from the diagrams).** The sheets build the main island from the T&B scenario
("set up the main island according to the T&B scenario", 4 players; the 3-player diagrams of all
five sheets also show the full 19-hex T&B island) and put the New Shores small islands around it.
Our T&B module is the 5th edition (T5, traders-barbarians.md §0.2), so the island is T&B's own
19-hex board (its generator: trade hexes and plazas, lake and fishing grounds, rivers and bridge
sites, oasis, castle and coast order, barbarian X marks), shifted onto the 4-player New Shores main
island (also a 19-hex hexagon), with New Shores' printed small islands (`tbsea/engine/maps.ts`).
One geometry serves 3 and 4 players; the 3-player diagrams' slightly different small islands and
the T6 island numbers (deserts and the watering hole in T&B) are not copied.

**Base VP.** The sheets add to the Seafarers scenario's target: the Fishing sheet says to "use the
Winning the Game rule for the specific Seafarers scenario", and the Barbarian Attack sheet prints
14 VP for New Shores (New Shores' own target).

| Rule (sheet / FAQ)                                                                                                                    | Status   | Engine                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T&B: wagons cross sea hexes: 2 MP, 1 MP on your ship, 1 MP + 1 gold to another ship's owner                                           | OK       | `tb/engine/paths.ts`: on a map with open sea, sea edges inside the frame are paths; a ship counts like a road (owner from `routeEdges`, which `tbsea` returns for T&B).                                                                            |
| T&B FAQ 65: a wagon goes from a road onto a ship with no settlement between                                                           | OK       | Wagons move on any path; closed or open routes do not matter.                                                                                                                                                                                      |
| T&B: robber and pirate are never in the game                                                                                          | OK       | T&B's no-robber rule; the map's pirate start is null (`SeaBoard.pirate`).                                                                                                                                                                          |
| T&B: a Knight or a drive-off may put a barbarian on a sea edge                                                                        | OK, ours | Also a 7 (our T&B moves a barbarian on a 7 like a Knight). A barbarian on a ship's edge robs the ship's owner (ours; on land it robs the road's owner).                                                                                            |
| T&B: 3 more VP                                                                                                                        | OK       | 17.                                                                                                                                                                                                                                                |
| T&B: Longest Road / Trade Route                                                                                                       | ours     | Not used (T&B has no Longest Road; the sheet is silent).                                                                                                                                                                                           |
| Fishing: the lake only where surrounded by land                                                                                       | OK       | T&B's lake is an inner hex of the island.                                                                                                                                                                                                          |
| Fishing: 2 fish remove the pirate from the board                                                                                      | OK       | `tbsea/fishPirate` (own turn, like T&B's robber action); it comes back with the next 7 / Knight (ours, as T&B's robber does).                                                                                                                      |
| Fishing: 5 fish build a ship at no cost                                                                                               | OK       | T&B's 5-fish road opens Road Building, where Seafarers offers a free ship; `tbsea/fishShip` when no road fits but a ship does.                                                                                                                     |
| Fishing: ships do not affect fish; the pirate on a fishing ground blocks it                                                           | OK       | Fish pay buildings only; a ground lies on the water hex at its tip (`FishingGround.hex`) and `payFish` skips the one under the pirate.                                                                                                             |
| Fishing: the old boot owner needs 1 more VP                                                                                           | OK       | T&B's boot.                                                                                                                                                                                                                                        |
| Rivers: a ship built on a river tile's edge earns 1 gold; moving it away costs 1 gold                                                 | OK, ours | `wraps` of the ship actions. A setup ship earns it too (like a setup road); a ship moved onto a river edge earns nothing (not built); no gold, no move off a river edge.                                                                           |
| Rivers: no ship on a bridge site                                                                                                      | OK       | Filtered and refused (river mouths are coast edges). FAQ 58 (T5 era) allowed ships "on the dotted lines" where they would be legal anyway; the 2025 sheet replaces it.                                                                             |
| Merchant Trains (our Caravans): wagons may go on sea edges, with or without a ship                                                    | OK       | Camels use T&B's sea paths.                                                                                                                                                                                                                        |
| Merchant Trains: a wagon on a ship's edge counts as one more ship for Longest Route                                                   | OK       | FAQ 40 ("camels affect neighbouring ships"): the trade route counts an edge under a camel twice, roads and ships (`tradeRouteLength` weight).                                                                                                      |
| Merchant Trains: 2 more VP                                                                                                            | OK       | 16.                                                                                                                                                                                                                                                |
| Barbarian Attack: ships may be built on edges of conquered hexes                                                                      | OK       | Only roads are blocked there (T&B's `edgeBlocked`; ships never consult it).                                                                                                                                                                        |
| Barbarian Attack: a route may only be changed or extended from an unconquered building                                                | OK       | `anchored`: building, Road Building's free ship, picking up and placing a moved ship need a ship route to an own unconquered building.                                                                                                             |
| Barbarian Attack: no robber, no pirate; 14 VP                                                                                         | OK       |                                                                                                                                                                                                                                                    |
| Barbarian Attack FAQ 6: a conquered settlement interrupts the trade route                                                             | OK       | `blocksRoute` (conquered buildings); Seafarers' `blockedFor` asks it for the player's own buildings too. The ship beside it is not "open" (it has an own building at that end). Longest Route is recomputed after every conquest (`changesRoads`). |
| Road Building with the pair's ship limits (Rivers, Barbarian Attack)                                                                  | ours     | The card is not offered when only forbidden ship spots are left; Road Building ends when nothing allowed fits (Seafarers counts every ship spot). Regression of sim seed 55.                                                                       |
| Friendly Robber FAQ 53: the pirate is friendly too                                                                                    | OK       | Every Seafarers game: `pirateTargets` skips hexes next to a ship of a player with 2 or fewer points (the mover's own ships aside).                                                                                                                 |
| Event Cards FAQ 17 / 19 / 20: Robber Flees leaves the pirate; ships may be built with a damaged road; a ship is never turned sideways | OK       | Unchanged rules, pinned by tests (`tbsea.test.ts`).                                                                                                                                                                                                |

Not built from these sheets (follow-up cards): T&B on **Through the Desert** (diagram set-ups);
Fishing on Four Islands, Fog Islands, Through the Desert, Forgotten Tribe, Cloth for Catan,
Wonders, New World (text set-ups: lake / ground placement, Tribe's robber on the large island,
Cloth's pirate rule); Rivers on Fog Islands (gold fields produce resources), Through the Desert,
Forgotten Tribe, New World; Merchant Trains on Four Islands (wagons on the pirate's edges),
Through the Desert, Forgotten Tribe, ...; Barbarian Attack on Through the Desert, Forgotten
Tribe, Pirate Islands, Wonders. Not playable per the sheets: T&B with Four Islands, Fog, Tribe,
Cloth, Pirate Islands, Wonders, New World; Fishing with Pirate Islands; Rivers and Barbarian
Attack with Four Islands; Merchant Trains with Fog Islands.

Edits to other modules (additive, listed for the merge): Seafarers (`rulesOf` and `mapKeyOf`
follow `playsAs` / `basedOn`; `SeaBoard.pirate`; `blockedFor` asks `blocksRoute` at own
buildings; `tradeRouteLength` weight; the friendly pirate; its sim invariant compares the hooked
route lengths), T&B (`featuresOf` follows `playsAs` and `validate` uses features; `paths.ts`:
sea paths for wagons, camels and barbarians, ships via `routeEdges`; `TbBoard.barbarians`;
`FishingGround.hex`, `payFish(…, blocked)`; Caravans' `roadLength` keeps a longer base; BA knights
on land paths only; the renderer draws wagons, camels and barbarians on sea paths).

## 2c. T&B scenario pairs: Fishing on Catan with another — module `tbpair`, mode `tb+tb`

Card C2's second part. The four 2025 sheets that pair Fishing on Catan with another T&B scenario
(read 2026-10-26, under https://www.catan.com/sites/default/files/:
`2025-07/Fishing on Catan w Rivers of Catan.pdf`, `2025-09/Fishing on Catan wTradersnBarbarians.pdf`,
`2025-07/Fishing on Catan w Barbarian Attack.pdf`, `2025-07/Fishing on Catan w Merchant Trains.pdf`).
Each scenario plays as two T&B scenarios (`playsAs: { tb: ['tb/fishermen', other] }`, T&B
switches both features on); the board is the other scenario's T&B board plus Fishing's six
fishing grounds. 3-4 players. Tests: `src/expansions/tbpair/engine/tbpair.test.ts`, `ui.test.ts`.

| Rule (sheet)                                                                                                                     | Status   | Engine                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| All: both scenarios' set-ups, no lake (except with Merchant Trains); boot: +1 VP                                                 | OK       | `tbpair/engine/maps.ts`: T&B's board of the other scenario + `fishingGrounds`.                                                                       |
| Fishing + Rivers: 10 VP; 6 fish pay for a bridge                                                                                 | OK, ours | `tbpair/fishBridge` (main phase, a free connected bridge site, the bridge's 3 gold too: ours).                                                       |
| Fishing + T&B: 12 VP; no robber, so 2 fish give the wagon 2 more MP "as if 1 grain"                                              | OK       | `tbpair/fishWagon` while moving; grain or fish once per move.                                                                                        |
| Fishing + BA: 12 VP; 2 fish move a knight up to 5 edges "as if 1 grain"                                                          | OK, ours | `tbpair/fishKnight` to the paths 4-5 steps away; offered when grain is not in hand (with grain the grain move reaches them: one click, one meaning). |
| Fishing + BA: no fish build on a conquered hex's edge                                                                            | OK       | The 5-fish road is a road: T&B blocks those edges.                                                                                                   |
| Fishing + BA: conquered buildings receive no fish                                                                                | OK       | T&B's `fishOwed` skips them when Barbarian Attack is on.                                                                                             |
| Fishing + Merchant Trains (our Caravans): 12 VP; the lake replaces a forest next to the watering hole; the 12 shares the 2's hex | OK, ours | The lake on a forest beside the oasis (red numbers never move: its number takes the 2's hex); `twoOnTwelve` now works outside Rivers too.            |

Our T&B is the 5th edition: the boards are T&B's T5 boards, the sheets are written for T6 (same
counts where it matters). The other six T&B × T&B sheets are listed in §3.

## 3. Not built (listed for follow-up cards)

| Combination                                           | Why / what it needs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fishing on Catan + other Seafarers scenarios          | Built on New Shores (§2b). Sheet set-ups for the rest: Four Islands 4/8 and 6/10 on the small islands, 5 and 9 on the big ones; Fog, Desert (3p lake on the 2-field, 2 joins the 12 pasture; 4p lake on the 11-hill, 11 joins the 2 hill), Forgotten Tribe (lake on the 12-field; the robber only on the large island), Cloth (3 + 3 grounds; 2 fish move the pirate only with a route to a small-island village), Wonders, New World (grounds placed like the harbours); not Pirate Islands. The seam exists (`playsAs`, `basedOn`); each needs its map (a lake hex, grounds with a water hex). |
| T&B / Rivers / BA / Merchant Trains + other Seafarers | Built on New Shores (§2b). Left: T&B on Through the Desert; Rivers on Fog Islands, Through the Desert, Forgotten Tribe, New World; Merchant Trains and Barbarian Attack on several (§2b list). Set-ups are diagrams.                                                                                                                                                                                                                                                                                                                                                                             |
| T&B × T&B, the six non-Fishing sheets                 | The four Fishing pairs are built (§2c). Left: Barbarian Attack + T&B (14), Merchant Trains + BA / + T&B (12 / 15), Rivers + BA / + Merchant Trains / + T&B (12 / 12 / 13): T6 boards (watering hole, commodity hexes that produce, barbarians tied to hex paths) and per-pair rules (traders-barbarians.md §8.1).                                                                                                                                                                                                                                                                                |
| Explorers & Pirates + C&K / + T&B                     | Built (E5b): §7 and §8. E&P + Seafarers is officially impossible (`conflicts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Barbarian Attack + C&K, Catan for Two + C&K           | Built (C5): §10 and §11.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| E&P + C&K at 5-6 players                              | No official text (§12): refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

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

C2 (`--max-steps 20000`, `--bias 0.5`; both modes are 3-4 players). Every run: 0 invariant
failures, 0 errors, 0 stalls, 0 capped; average turns of a finished game in brackets (random bots).

| Mode / scenario                        | 4p (300) finished | 3p (50) finished |
| -------------------------------------- | ----------------- | ---------------- |
| `tb+seafarers` Traders & Barbarians    | 300 (343)         | 50 (283)         |
| `tb+seafarers` Fishermen               | 300 (321)         | 50 (347)         |
| `tb+seafarers` Rivers                  | 300 (391)         | 50 (386)         |
| `tb+seafarers` Caravans                | 300 (391)         | 50 (385)         |
| `tb+seafarers` Barbarian Attack        | 300 (403)         | 50 (412)         |
| `tb+tb` Fishing + Rivers               | 300 (237)         | 50 (247)         |
| `tb+tb` Fishing + Traders & Barbarians | 300 (198)         | 50 (165)         |
| `tb+tb` Fishing + Barbarian Attack     | 300 (360)         | 50 (365)         |
| `tb+tb` Fishing + Caravans             | 300 (276)         | 50 (274)         |

The first C2 runs found Rivers stalls (Road Building with only bridge-site ship spots) and a
Barbarian Attack award lag (a Treason conquest cut the trade route without a recompute); both fixed
with regression tests (`tbsea.test.ts`, sim seed 55).

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

## 7. Explorers & Pirates + Cities & Knights — module `epck`, mode `ep+ck`

Source: `ExplorersPirates w CnK.pdf` (catan.com, 2025-08), read in full. Its text, section by
section:

- **Setup.** Build the E&P scenario's board, but return 1 field and 1 forest hex to the box
  instead of 2 field hexes; use the barbarian-track sea frame. "Your first placement is a city
  instead of a settlement. Your second placement is a harbor settlement." The rest of both
  games' components as normal.
- **Rules.** "Except where noted, the rules for both Cities & Knights and the Explorers & Pirates
  scenario apply."
- **Barbarians attack.** Strength = cities on the board (metropolis included, every island);
  harbor settlements do not count. Defence = knights on the board (every island); crews do not.
- **Trade.** With the supply you may not trade gold for commodities.
- **Build.** Settlements upgrade to cities or to harbor settlements; never city ↔ harbor.
- **Aqueduct.** If you receive no cards in the Production phase "due to a 7 being rolled", take
  1 resource of your choice and 1 gold.
- **Knights.** Move only on the island where they were built (not by ship); no missions; never
  built on or moved onto an intersection next to an unexplored hex.
- **Fast Gold.** Once in your Action phase, 1 resource **or 1 commodity** for 1 gold (twice with
  a crew on both Fast Gold farms).
- **Winning.** "5 more VPs than required by the Explorers & Pirates scenario". The sheet's
  example says Spices for Catan + C&K needs 19; the Mission Guide gives Spices 15 VP, so 15 + 5 = 20. We follow the rule, not the example (the example looks like a slip).
- **Progress cards.** Medicine: a city for 1 grain + 2 ore, or a harbor settlement for 1 grain +
  1 ore. Taxation: "activate the pirate ship" instead of moving the robber. Treason: knights
  only, crews never commit treason. Road Building: roads only, no ships.

Scenarios: Pirate Lairs 17, Fish for Catan 20, Spices for Catan 20, the full game 22 VP; 3-4
players. Tests: `src/expansions/epck/engine/epck.test.ts`, `bots.test.ts`, `ui.test.ts`; the C&K
and E&P leak tests run this mode (`ck/mask.test.ts`, `ep/mask.test.ts`).

| Rule (sheet)                                                          | Status   | Engine                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 field + 1 forest out instead of 2 fields                            | OK       | `init`: one random island forest becomes a field (same distribution as the changed pool; on Pirate Lairs' fixed island: **ours**, a random forest).                                                    |
| Barbarian-track sea frame                                             | —        | Cosmetic (the HUD shows C&K's track).                                                                                                                                                                  |
| First placement a city (it pays), second a harbor settlement          | OK       | `setupBuilding` + `setupOrder` (round 1 pays); E&P's seam `isHarborStep` puts the harbor round second on the marked corners. Road at the city, ship at the harbor as in E&P.                           |
| … no marked corner left for a harbor                                  | OK, ours | The cities come first and may block every mark: the harbor then goes on any free coastal corner (a sim stall otherwise; `setupSpotAllowed`).                                                           |
| Barbarians count cities, not harbor settlements; defence knights only | OK       | C&K's counts (a harbor settlement is a settlement piece; crews are E&P cargo).                                                                                                                         |
| No gold for commodities with the supply                               | OK       | E&P's 2 gold buy resources only; nothing else sells commodities for gold.                                                                                                                              |
| Settlement → city or harbor; never city ↔ harbor                      | OK       | E&P seam `citiesInPlay` (city pieces, `buildCity`, the City card); `epck` refuses a city on a harbor settlement, E&P's harbor needs a settlement.                                                      |
| Aqueduct on a 7: 1 resource + 1 gold                                  | OK       | `onSeven`: 1 gold at once; the resource choice (C&K's `ck/aqueduct`) after the discards and the pirate. On other rolls C&K's Aqueduct and E&P's 1 gold for no resources both apply (the same outcome). |
| Knights only on their island, not by ship                             | OK       | Knights walk roads; E&P roads never cross the sea (no `routeEdges`).                                                                                                                                   |
| Knights never next to unexplored hexes                                | OK       | C&K seam `besideFog`: no recruit, move or relocation onto a corner of a fog-kind hex.                                                                                                                  |
| Knights do no missions                                                | OK       | Missions are E&P ship actions.                                                                                                                                                                         |
| Fast Gold with a commodity                                            | OK       | `epck/fastGold { commodity }`, sharing E&P's per-turn Fast Gold count.                                                                                                                                 |
| Win at scenario + 5                                                   | OK       | `vpBonus: 5` (the VP cap went 20 → 25 for the full game's 22: engine, setup screen, online protocol).                                                                                                  |
| Medicine: city 1 grain 2 ore, or harbor 1 grain 1 ore                 | OK       | `wraps['ck/play']` (playable for either), `ck/pickVertex` = city (never on a harbor), `epck/medicineHarbor` (HUD card "Harbor (Medicine)").                                                            |
| Taxation (the Bishop) activates the pirate ship                       | OK       | `wraps['ck/play']`: spends the card, then E&P's pirate placement and steal.                                                                                                                            |
| Treason (Deserter): knights only                                      | OK       | C&K's card touches knights only.                                                                                                                                                                       |
| Road Building: roads only                                             | OK       | C&K's free roads; E&P offers no ship there. Free roads obey E&P's spice farms (fixed in `ep`).                                                                                                         |
| The pirate on a 7                                                     | OK, ours | Awake from the first 7: the sheet keeps E&P's rule (C&K's sleeping robber is about the robber, which E&P does not have). `onSeven` + the discard wraps skip C&K's sleep.                               |
| The pirate's steal                                                    | OK, ours | A random resource **or commodity** card (C&K: commodities are cards); gold only from a player without cards. A ship owner holding only commodities is a victim.                                        |
| Inventor                                                              | OK, ours | Never moves a gold field's number (the flipped lair token, not a number disc).                                                                                                                         |
| C&K actions in the Movement phase                                     | ours     | None: knights, walls, improvements, progress cards and commodity trades belong to the Action phase (E&P: no trading or building in the Movement phase); discarding progress cards stays possible.      |
| Commodity trades with the supply                                      | ours     | C&K's rates (4:1, Trading House 2:1); E&P's 3:1 is for resource cards. Resources keep E&P's 3:1 or better (merchant, Merchant Fleet: E&P's `bankTradeRatio` keeps a better rate).                      |
| Player offers with commodities and gold                               | OK       | One form, `epck/offerTrade` (resources, commodities, gold; C&K's and E&P's offer overrides move their parts).                                                                                          |
| Land Ho!                                                              | ours     | Not offered: its printed starting pieces leave no city placement, and it has no pirate.                                                                                                                |
| 5-6 players                                                           | —        | Not offered: no official text (§12: searched for C5; the sheet is 3-4; C&K 5-6 + E&P 5-6 paired turns would need a ruling for C&K actions in player 2's part).                                         |

## 8. Explorers & Pirates + Traders & Barbarians — module `eptb`, mode `ep+tb`

Source: `ExplorersPirates w TnB.pdf` (catan.com, 2025-08), read in full:

- "Except where noted, the rules for both Traders & Barbarians and Explorers & Pirates scenario
  apply."
- **The Friendly Robber:** not possible (no robber in E&P). **Harbors of Catan:** not possible (no
  harbors). **Rivers of Catan, Merchant Trains, Barbarian Attack, Traders & Barbarians:** "only
  balanced when played with CATAN … not possible".
- **Catan Event Cards:** usable for the distribution of numbers, ignoring the effects.
- **Fishing on Catan:** the 6 fishing grounds go randomly on the places shown (a diagram of the
  3-4 starting island); the lake is optional: on the 12 (that disc goes back to the box), one
  mountain less on the island. Fish tokens are no resource cards: only fish from a roll → 1
  gold. Spend fish: **2** ignore the pirate ship (no gold to move onto, around or off its hex);
  **5** build 1 road or 1 ship free; **7** move 1 ship a second time.

**The diagram, decoded** (doubled coordinates, p = 1, as in `explorers-pirates.md` §2.3): the six
cream fishing grounds sit on the island's west coast, each pointing at a notch between two
coastal hexes, mirror-symmetric top / bottom: (3,0)NE (between the 11 and the 9), (3,0)SW,
(1,2)SW, (0,3)S, (2,5)S, (3,6)SE (between the bottom 3 and 5). As in our T&B module each ground
touches the notch and its two coastal neighbours (`GROUND_PLACES`). The lake is drawn on (2,3),
the island's 12. The diagram shows a 2 where the Mission Guide's island has a 10 at (1,4); we keep
the Mission Guide's numbers (the E&P books are the source of the island).

Scenarios: all five 3-4 player E&P scenarios at their own VP target (the old boot: +1 for its
holder); 3-4 players. Tests: `src/expansions/eptb/engine/eptb.test.ts`, `bots.test.ts`,
`ui.test.ts`; the T&B and E&P leak tests run this mode.

| Rule (sheet)                                          | Status   | Engine                                                                                                                                                                                    |
| ----------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fishing on Catan on every E&P scenario                | OK       | T&B seam `MODE_FEATURES` (`'ep+tb': ['fish']`): T&B's Fishermen runs on E&P's scenarios (production, 7-token hand, old boot, setup fish).                                                 |
| 6 grounds on the places shown, numbers at random      | OK       | `init`: `board.ext.tb.grounds` from `GROUND_PLACES`, numbers 4, 5, 6, 8, 9, 10 shuffled.                                                                                                  |
| The lake on the 12, its disc out, one mountain less   | OK       | Option `eptb.lake` (default on): (2,3) becomes T&B's lake (2, 3, 11, 12); when the 12 was not a mountain its terrain moves onto a random island mountain (same distribution as the pool). |
| Only fish from a roll: 1 gold                         | OK       | E&P's compensation counts resource cards only; T&B pays fish first.                                                                                                                       |
| 2 fish: ignore the pirate ship                        | OK, ours | `eptb/fish { use: 'pirate' }`: no tribute for your ships for the rest of the turn (ships built later too); needs an opponent's pirate.                                                    |
| 5 fish: 1 road or 1 ship free                         | OK       | The road is T&B's own use (Action phase only here); the ship `eptb/fishShip { edge, replace? }` follows E&P's ship placement.                                                             |
| 7 fish: move 1 ship a second time                     | OK, ours | `eptb/fish { use: 'secondMove', ship }` in the Movement phase: a ship that sailed this turn gets its movement points back (its paid tribute and wool extra stay).                         |
| T&B's 3 fish (steal) and 4 fish (a resource)          | OK       | "Except where noted": T&B's uses; the 2-fish robber and 7-fish development card have nothing to act on and are never offered.                                                             |
| Event Cards: numbers only                             | OK       | E&P's `onRoll` drops the drawn card's event (also in plain E&P and in E&P + C&K: the only official text on E&P with Event Cards).                                                         |
| Friendly Robber, Harbors of Catan                     | OK       | Refused by `validate` with the sheet's reason.                                                                                                                                            |
| Rivers, Merchant Trains, Barbarian Attack, T&B (main) | OK       | Not offered (the mode is the Fishermen only).                                                                                                                                             |
| 5-6 players                                           | —        | Not offered: the diagram places the grounds on the 3-4 island only.                                                                                                                       |

## 9. E&P combinations: bots and sims

`epck` bots: invariants (no harbor city, no knight beside fog, the 7's Aqueduct queue only while a
7 is resolved) and a steer to cities, improvements and defence in the Action phase (E&P's steer
sails). `eptb` bots: invariants (6 grounds, numbers, the lake on the 12, the pirate pass only for
the current player) and a steer that spends fish on a ship when short of ships. E&P's invariants
now allow cities with C&K and check E&P's own VP hook (composition-safe).

`pnpm sim --mode <mode> --scenario <s> --players <n> --games <g> --bias 0.5 --max-steps 20000`:

Final code, every run: **0 invariant failures, 0 errors, 0 stalls, 0 games capped** (finished /
games, average turns):

| Mode / scenario        | 4p (300)  | 3p (50)  |
| ---------------------- | --------- | -------- |
| `ep+ck` Pirate Lairs   | 300 / 177 | 50 / 161 |
| `ep+ck` Fish for Catan | 300 / 223 | 50 / 192 |
| `ep+ck` Spices         | 300 / 223 | 50 / 192 |
| `ep+ck` full game      | 300 / 243 | 50 / 201 |
| `ep+tb` Land Ho!       | 300 / 76  | 50 / 63  |
| `ep+tb` Pirate Lairs   | 300 / 163 | 50 / 149 |
| `ep+tb` Fish for Catan | 300 / 246 | 50 / 205 |
| `ep+tb` Spices         | 300 / 251 | 50 / 217 |
| `ep+tb` full game      | 300 / 297 | 50 / 244 |

The sims found five bugs, all fixed with a test: Inventor swapping a captured lair's number (gold
fields excluded), a setup stall when the cities blocked every marked harbor corner (coastal
fallback), E&P free roads ignoring spice farms (`ep`), C&K counting E&P harbor settlements as
settlement pieces once a pillaged city lay on its side (city limit −1, a sixth settlement could
land: C&K's `settlementPieces`), and a fish ship's exploring card left out of the statistics.

Online: `e2e:server` plays one `ep+ck` and one `ep+tb` game over the room server (2 clients + 2
server bots, every view checked for masked C&K hands, fish tokens and face-down hexes);
`src/net/sessionExpansions.test.ts` runs both modes. Browser check:
`node scripts/shots-ep-combos.mjs <preview url> <dir>` (setup tiles; bot games mid-game in three
themes, no page errors).

## 10. Barbarian Attack + Cities & Knights — module `back`, mode `ba+ck`

Source: `Barbarian Attack w CnK.pdf` (catan.com, 2025-07), read in full. Its text, section by
section:

- **Setup.** "Set up the game according to the Barbarian Attack scenario instructions." Not used:
  C&K's sea frame with the barbarian track and the barbarian ship; Barbarian Attack's knights and
  development cards. "Except where noted, the rules for both Cities & Knights and the Barbarian
  Attack scenario apply."
- **Roll Dice phase.** Roll C&K's 3 dice. A ship on the event die places a barbarian on the
  coastal hex whose number matches the production dice (fewer than 3 there; none on a 7). Walled
  cities are conquered as normal. A city with a metropolis is not conquered: still 4 VP, but it
  produces no resources or commodities, and no city improvements on that metropolis's track while
  it touches only conquered hexes and the frame.
- **Action phase.** Coins buy resource cards only. Each city improvement: roll the 2 production
  dice at once and place a barbarian on the matching coastal hex (fewer than 3). A metropolis
  cannot be conquered. Recruited knights go on free edges of the castle hex.
- **End of Turn phase.** Knight actions move here. Move: each active knight up to 5 paths, each
  inactive one up to 3, along any path (not only your routes); an active knight that moved lies
  down. Displace: an active knight displaces an opponent's knight within 3 paths; both lie down.
  Expel the barbarians as in T&B, with: barbarian strength = barbarians on the hex; defenders =
  the active knights' strength on the hex (basic 1, strong 2, mighty 3); a prisoner left over goes
  to the highest total strength; losses: basic → supply, strong → basic (else supply), mighty →
  strong (else basic, else supply), 3 gold per knight removed or downgraded. Every 3 prisoners =
  1 VP; barbarians are unlimited: "If you run out, return 3 prisoners to the supply and take 1 VP
  token."
- **Winning.** 13 VP during your turn.
- **Progress cards.** Intrigue: remove 1 barbarian from a hex of your choice as a prisoner.
  Invention: swap 2 of the 5 number discs at the island's centre. Merchant: lost (removed) when
  its hex is conquered. Taxation: pick a hex; steal 1 random resource / commodity from each player
  with an unconquered settlement or city on it. Treason: your knight goes on the edge where the
  opponent's knight was removed.

Scenario: Barbarian Attack at 13 VP; 3-6 players (the 5-6 BA board with its two castles: **ours**,
the sheet names no player count). Tests: `src/expansions/back/engine/back.test.ts`, `bots.test.ts`,
`ui.test.ts`; the C&K leak test runs this mode (`ck/mask.test.ts`).

| Rule (sheet)                                                      | Status   | Engine                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BA set-up; no barbarian track / ship; no BA knights or cards      | OK       | ck `shipSails` (mode table): the ship face never advances the track, no attack ever; tb `baCardsInPlay`: no BA deck.                                                                                       |
| Ship face: a barbarian on the coastal hex of the roll; not on a 7 | OK       | `onRoll` clears C&K's face; `afterProduction` lands it (`landingHexes`: fewer than 3, supply); the 7 has no production.                                                                                    |
| … the hex it conquers produces nothing on that roll               | OK       | `production` hook removes what that hex would pay (the landing itself follows production).                                                                                                                 |
| Walled cities are conquered as normal                             | OK       | T&B's conquest ignores walls.                                                                                                                                                                              |
| A metropolis is never conquered; 4 VP; produces nothing           | OK       | tb seam `BaSlice.safe` (synced each action); its hexes are conquered, so they pay nothing.                                                                                                                 |
| … no improvements on its track while surrounded                   | OK       | `trackCut`: `ck/improve` wrapped and filtered.                                                                                                                                                             |
| No commodities from conquered hexes                               | OK       | C&K's commodities are paid with the conquered hexes' numbers hidden (`withoutConquered`).                                                                                                                  |
| Coins buy resources only                                          | OK       | T&B's `tb/buyResource`.                                                                                                                                                                                    |
| Each city improvement lands a barbarian (2 production dice)       | OK       | `wraps['ck/improve']`.                                                                                                                                                                                     |
| Settlements / cities still land barbarians (BA)                   | OK       | T&B's override; Medicine's city too (ours: it is a city built).                                                                                                                                            |
| Knights recruited on free castle edges (C&K's cost)               | OK       | `back/recruit`; C&K's vertex knight actions are filtered and refused. Activate / promote (Fortress for mighty, once a turn) as C&K: `back/activate`, `back/promote`.                                       |
| End of turn: active 5 paths (lies down), inactive 3, any path     | OK       | `back/startKnights` ends the building (`back/knights`), `back/moveKnight`; once per knight per turn; passing every piece (T&B FAQ 5); never ending on the castle (BA).                                     |
| … a knight activated this turn                                    | ours     | Cannot act (C&K: no action the turn it is activated): it neither moves nor displaces.                                                                                                                      |
| … knights on the castle must leave it (BA FAQ 11)                 | OK       | `endTurn` refused / not offered while one can move.                                                                                                                                                        |
| Displace within 3 paths; both lie down                            | OK       | `back/displace`; the target must be weaker (C&K). The displaced knight: "his owner places him on the next free path" (T&B FAQ 2): the nearest free paths, owner's choice (`back/relocate`, actor = owner). |
| Expulsion by strength; leftover prisoner to the highest strength  | OK       | `expel` (knights.ts): BA's order and dice ties; only active knights fight (**ours**: inactive knights do not count, so they do not fight).                                                                 |
| Losses step down a level, 3 gold each                             | OK       | BA's loss die picks the orientation; a wounded knight fights no second battle that turn (FAQ 8).                                                                                                           |
| Knights stay active after a battle                                | ours     | The sheet is silent (C&K deactivates after a ship attack, which never happens here).                                                                                                                       |
| 3 prisoners = 1 VP; unlimited barbarians, VP tokens               | OK, ours | tb `prisonersPerVp` (3). When the supply drops under 3 (a landing's worth), players with 3+ prisoners (current player first) swap 3 for a VP token (`refill`): the same VP, barbarians keep landing.       |
| The 7                                                             | OK       | C&K discards (commodities, walls), then BA's steal from any player with cards (commodities count).                                                                                                         |
| Intrigue: a barbarian prisoner                                    | OK       | `back/intrigue` → `back/intrigueHex`.                                                                                                                                                                      |
| Invention: the 5 centre numbers                                   | OK       | C&K's Inventor on non-coastal hexes only. Our T5 board has 7 inner numbered hexes; without C&K's 2/6/8/12 those are exactly 5 (4, 5, 10, 9, 3).                                                            |
| Merchant: removed when its hex is conquered                       | OK       | `afterAction`; never placed on a conquered hex (ours: it would be removed at once).                                                                                                                        |
| Taxation: rob each player with an unconquered building on the hex | OK       | `back/taxation` → `back/taxHex` (opponents only; one random resource or commodity each).                                                                                                                   |
| Treason: your knight on the removed knight's edge                 | OK       | `back/deserter`: the opponent picks the knight (C&K); yours of the same level (else basic) takes that path.                                                                                                |
| Smith, Warlord                                                    | OK       | Work on the path knights (`back/smith`; Warlord activates them all).                                                                                                                                       |
| Medicine                                                          | OK, ours | Never on a conquered settlement (BA: no upgrade); playable only with an unconquered settlement.                                                                                                            |
| Win at 13                                                         | OK       | `scenarioVp`.                                                                                                                                                                                              |

## 11. Catan for Two + Cities & Knights — module `twock`, mode `two+ck`

Source: `CATAN for 2 w CnK.pdf` (catan.com, 2025-07), read in full:

- **Setup.** C&K's set-up; Catan for Two's starting pieces and trade tokens.
- **Rules.** Both rule sets with these changes. **Two full Roll Dice and Production phases** before
  the Action phase; in the second, re-roll the production dice (red and yellow) until the result
  differs from the first.
- **Recruit a knight:** each recruit also recruits 1 knight for either neutral player at no cost,
  by the normal placement rules; no valid placement → a neutral road instead. **Promote:** each
  basic → strong promotion also promotes a neutral knight basic → strong if possible; neutral
  knights are never mighty. **Activate:** neutral knights are never activated and do not defend.
  **Knight actions:** neutral knights are "another player's knight".
- **Trade tokens.** The supply is limited (spend before acquiring more). Besides settling on the
  desert / coast, remove one of your knights for 1 / 2 / 3 tokens (basic / strong / mighty).
  **Forced Trade** splits in two (declared first): resource cards only (the opponent sets the
  commodities aside; Catan for Two's price), or resources and / or commodities (twice the price,
  2 or 4 tokens).
- **Winning.** 13 VP during your turn.
- **Progress cards.** Alchemy only before the first Roll Dice phase. Road Building: a neutral road
  after each of the 2 roads. Diplomacy: no neutral road when you remove and rebuild your own road.
  Treason: your opponent's or a neutral knight (the weakest of the chosen colour); placing your own
  knight then is no Recruit (no neutral knight).

Scenario: T&B's variants scenario (the base board with Catan for Two's neutral starts) at 13 VP;
2 players. Tests: `src/expansions/twock/engine/twock.test.ts`, `bots.test.ts`, `ui.test.ts`; the
C&K leak test runs this mode.

| Rule (sheet)                                                        | Status   | Engine                                                                                                                                           |
| ------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| C&K set-up (city second); neutral starts and 5 tokens each          | OK       | C&K's `setupBuilding`; T&B's Catan for Two (ck module players now 2-6, its own mode 3-6).                                                        |
| Two Roll Dice + Production phases; the second's dice differ         | OK       | T&B's two rolls (`rollDice`, `secondRoll`); C&K's event die is rolled in both.                                                                   |
| Recruit → a free neutral knight on the neutral's roads              | OK, ours | `twock/neutral` (`twock/neutralKnight`): an empty land intersection on one of that neutral's roads (its network); 2 basic knights per neutral.   |
| … no spot → a neutral road                                          | OK       | T&B's neutral road step.                                                                                                                         |
| Basic → strong promotion → a neutral one too; never mighty          | OK       | `wraps['ck/promoteKnight']` and the Smith's picks (ours: the Smith promotes too); `twock/neutralPromote` (2 strong per neutral).                 |
| Neutral knights: never active, no defence                           | OK       | Owners 2 and 3 (no seat): never activated; C&K's defence counts active knights only.                                                             |
| Neutral knights are "another player's knight"                       | OK       | C&K knights of another owner: they block routes and Longest Road, stronger knights displace them, Intrigue targets them.                         |
| … a displaced neutral knight retreats                               | OK, ours | Along the neutral's roads (`routeEdges`); the current player picks the spot for it (`twock/relocate`; C&K would ask the owner, who has no seat). |
| Neutral settlements block knights                                   | OK       | ck routes seam: other modules' route blockers count as foreign pieces and occupied spots (no knight on a neutral settlement).                    |
| Remove a knight for 1 / 2 / 3 tokens; limited supply                | OK, ours | `twock/knightForTokens` (once a turn, like T&B's Knight-card trade-in; what the supply still has; none from an empty supply).                    |
| Forced Trade, resources only                                        | OK       | T&B's own Forced Trade: it takes and gives resource cards only, at Catan for Two's price.                                                        |
| Forced Trade, resources and / or commodities, twice the price       | OK       | `twock/forcedTrade` → `twock/forcedGive` (any 2 of your cards back).                                                                             |
| Alchemy before the first roll only                                  | OK       | `ck/alchemist` wrapped and filtered after the first roll.                                                                                        |
| Road Building: a neutral road after each road                       | OK       | T&B's `placeFreeRoad` override.                                                                                                                  |
| Diplomacy: no neutral road for a rebuilt own road                   | OK       | C&K's Diplomat places the road itself (no build action, no neutral road).                                                                        |
| Treason vs a neutral: its weakest knight; no neutral knight follows | OK       | `twock/deserterNeutral` in C&K's Treason step; your knight goes where C&K's Treason puts it (not a Recruit).                                     |
| Win at 13                                                           | OK       | `scenarioVp`.                                                                                                                                    |
| Neutral roads and the Diplomat                                      | ours     | Neutral roads are T&B pieces, not players' roads: the Diplomat never takes them.                                                                 |

Edits to other modules (additive, listed for the merge): C&K (`shipSails` mode table: the event
die's ship never sails, the HUD hides the track and the vertex-knight cards; routes count other
modules' `blocksRoute` pieces as foreign / occupied; the module allows 2 players; its renderer
skips knights of no seat), T&B (`prisonersPerVp`, `baCardsInPlay` mode tables, `BaSlice.safe`,
exported BA helpers `setBarbarians`, `rankByDice`, `edgeDistances`, `rollLossFamily`; the HUD
words the prisoner ratio and hides BA's knight card / count without BA cards).

## 12. Explorers & Pirates + Cities & Knights at 5-6 players

**No official answer exists** (searched 2026-10-26): the E&P + C&K sheet (both versions on
catan.com) gives 3-4 player rules only; the E&P 5-6 rules (CN3086) describe the paired players'
turn for E&P alone and never mention C&K (the "C&K 5-6" strings in its component pictures are
print labels); the E&P, C&K and T&B FAQs and the 5-6 player page say nothing about combining two
expansions at 5-6, nor about C&K actions in the second player's part of a paired turn. So `ep+ck`
keeps refusing 5-6 players (§7 table, unchanged).

Note: catan.com also serves an older E&P + C&K "rules suggestion" (`ExplorersPirates w CnK_0.pdf`,
Klaus Teuber's text: Mining / Irrigation also pay harbor settlements, Inventor swaps every number
except 2, 6, 8, 12 across islands and lairs, a Bishop placing your pirate ship, 22 VP for scenario
4). §7 follows the 2025 sheet; the differences are listed as a follow-up card.

## 13. C5: bots and sims

`back` bots: invariants (path knights on land paths within C&K's limits, no BA knights or cards,
no barbarian ship, no C&K vertex knight, metropolises never conquered, VP tokens) and a steer
that recruits, activates and promotes knights and sends them to the barbarians. `twock` bots:
invariants (neutral knights never active or mighty, within their limits) and a steer that builds
what scores and keeps the random bot from turning its knights in for tokens every turn (the first
runs, without it, averaged 838 turns: knights recruited and traded in at once).

`pnpm sim --mode <mode> --scenario <s> --players <n> --games <g> --bias 0.5 --max-steps 20000`:

SIMS_TABLE

The first runs found one bug, fixed with a test: Medicine was playable when every settlement of
the player was conquered (a stall: no target left).

Online: `e2e:server` plays one `ba+ck` and one `two+ck` game over the room server (2 clients; 2
server bots in `ba+ck`), every view checked for masked C&K hands; `src/net/sessionExpansions.test.ts`
runs both modes (its harness now lets 100 ms pass per human move: a 2-seat game has no bots to wait
for and hit the intent rate limit).
