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

For card E5b the two Explorers & Pirates sheets were read in full (text and diagrams, 2026-10-26):

- `2025-08/ExplorersPirates w CnK.pdf` (E&P + C&K, 2 pp., §7 below)
- `2025-08/ExplorersPirates w TnB.pdf` (E&P + T&B, 2 pp., §8 below; the fishing-ground places
  are a board diagram, decoded in §8)

and, to check them, the E&P Mission Guide (`2025-04/CN3085 … Missions.pdf`: VP targets, the
Land Ho! board) and Rulebook.

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

| Mode           | Order                      | First-wins hooks decided by the combo                                                                                                                                                                                                                                              |
| -------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seafarers+ck` | `seack`, `ck`, `seafarers` | `afterProduction`: C&K commodities → Seafarers gold (and cloth) → the Aqueduct for players who got nothing (gold counts). `onSeven`: C&K's (Seafarers has none). Robber vs pirate: a 7 moves either; a knight's chase moves what it chased.                                        |
| `tb+ck`        | `tbck`, `ck`, `tb`         | `afterProduction`: C&K commodities + Aqueduct players, then T&B fish (fish are no cards: FAQ 43). `onSeven`: C&K first (sleeping robber; in T&B the barbarians' 7 move sleeps too), then T&B. `rollDice`: T&B only (2/12 re-roll; the event die is a C&K `onRoll` step, FAQ 62).   |
| `ep+ck`        | `epck`, `ck`, `ep`         | `setupBuilding` / `setupOrder`: city first (pays), harbor second. `afterProduction`: C&K commodities + Aqueduct, then E&P gold. `onSeven`: E&P's pirate is awake from the first 7 (C&K's sleeping robber is skipped), the Aqueduct pays 1 gold at once and 1 resource after the 7. |
| `ep+tb`        | `eptb`, `tb`, `ep`         | None shared: T&B's and E&P's `afterProduction` both return nothing (fish, then gold).                                                                                                                                                                                              |

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
| Explorers & Pirates + C&K / + T&B                       | Built (E5b): §7 and §8. E&P + Seafarers is officially impossible (`conflicts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

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
| 5-6 players                                                           | —        | Not offered: no official text (the sheet is 3-4; C&K 5-6 + E&P 5-6 paired turns would need a ruling for C&K actions in player 2's part).                                                               |

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
