# CATAN base game rules: the reference for this engine

The rules of the base game for 3–4 players, written in our own words. Each rule is marked with
how `src/engine` handles it. **This is the rules reference for every agent.** If you change
engine behaviour, update the status here. If a rule is unclear, check the cited source; do not
go from memory.

Compiled by T8 (2026-10-25). Rule numbers (e.g. **5.3**) are stable; tests cite them, e.g.
`src/engine/rulesAudit.test.ts`.

## Sources

| Key       | Source                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R5**    | _Catan Game Rules & Almanac_, 5th ed. (2015 rules, 2020 printing): https://www.catan.com/sites/default/files/2021-06/catan_base_rules_2020_200707.pdf. Page numbers are cited as R5 p.N. **This is our baseline.** |
| **R6**    | _CATAN – The Game_ rulebook, 6th ed. (2025): https://www.catan.com/sites/default/files/2025-03/CN3081%20CATAN%E2%80%93The%20Game%20Rulebook%20secure%20%281%29.pdf. Used to clarify and cross-check.               |
| **FAQ**   | Official base game FAQ: https://www.catan.com/faq/basegame. Entries are numbered #n in page order (77 entries, read 2026-10-25).                                                                                   |
| **IMG**   | R5 p.3 Illustration A (the beginner map), rendered at high resolution and read by eye.                                                                                                                             |
| **E56**   | _Catan 5–6 Player Extension_ rules, 5th ed. (© 2020 Catan GmbH / Catan Studio), 4 pages. Copy hosted by a retailer: https://www.world-of-board-games.com.sg/docs/Catan-5-6-Ext.pdf (read 2026-10-25). See §16.     |
| **PPT**   | _The Paired Players Turn Rule for the 5-6 Player Extensions_ (catan.com, 2021): https://www.catan.com/sites/default/files/2021-09/CATAN_New5-6Player_ruleEN.pdf. See §16.D.                                        |
| **FAQ56** | The 5-6 player questions on catan.com's FAQ page https://catan.com/node/68 (read 2026-10-25), e.g. "Can I win during the special building phase? No." See §16.A.1.                                                 |
| **COL**   | Colonist.io rules page "5-6 / 7-8 Players": https://colonist.io/catan-rules/5-6-player (read 2026-10-25). **Unofficial** (a digital adaptation); used only for the 7-8 player supply, see §16.C.                   |

Variant sources (V1, §18):

| Key      | Source                                                                                                                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SBF**  | settlersboard.com "Catan 5-6 rules FAQ": https://settlersboard.com/catan-5-6-rules-faq (read 2026-10-26). A **third-party** fan page with internal contradictions; see §19 and §20 for how each was resolved.                                   |
| **TB**   | _CATAN – Traders & Barbarians_ rulebook (catan.com, 2020): https://www.catan.com/sites/default/files/2021-06/catan-t_b_2020_rule_book_200820.pdf. p.3 Friendly Robber, pp.4–5 Event Cards, p.23 card list.                                      |
| **COLF** | Colonist.io Friendly Robber: room option text "Can't rob players under 3 VPs" (Colonist's en_strings locale file, read 2026-10-25); blog https://blog.colonist.io/ranked-1v1-comprehensive-strategy-guide-colonist-io/ (VP cards do not count). |
| **COLR** | Colonist.io "Colonist Rush" rules page: https://colonist.io/catan-rules/colonist-rush (read 2026-10-25). **Unofficial** (a digital mode).                                                                                                       |

R5 p.14: the 2015 rules take precedence over all earlier editions. We found no documented
gameplay change between the 4th and 5th editions. R6 (2025) mostly renames things (see §14).

### Status legend

| Status        | Meaning                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------- |
| **OK**        | The engine implements the rule as written.                                                      |
| **deviation** | A deliberate difference, with the reason given. The ruling is ours.                             |
| **bug→fixed** | The engine was wrong. T8 fixed it, and a test pins the fix.                                     |
| **unclear**   | No primary source covers the case. The engine's choice is given.                                |
| **n/a**       | Not modelled: a social or physical rule, or something for the UI or controller, not the engine. |

The **Where** column points to the code: `a/` is `src/engine/actions/` and `r/` is `src/engine/rules/`.

---

## 1. Components

| #   | Rule                                                                                                                   | Source      | Status | Where                        |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ---------------------------- |
| 1.1 | 19 terrain hexes: 4 forest (lumber), 4 pasture (wool), 4 fields (grain), 3 hills (brick), 3 mountains (ore), 1 desert. | R5 p.2      | OK     | `TERRAIN_COUNTS`             |
| 1.2 | 18 number tokens: one 2 and one 12, two each of 3–6 and 8–11. There is no 7. The desert gets no token.                 | R5 p.10, 13 | OK     | `NUMBER_TOKENS`              |
| 1.3 | 9 harbors: 4 generic (3:1) and one 2:1 for each resource.                                                              | R5 p.2, 9   | OK     | `PORT_KINDS`                 |
| 1.4 | 19 cards of each resource (95 total), held by the bank.                                                                | R5 p.2      | OK     | `BANK_PER_RESOURCE`          |
| 1.5 | 25 development cards: 14 Knight, 5 Victory Point, 2 Road Building, 2 Year of Plenty, 2 Monopoly.                       | R5 p.2, 10  | OK     | `DEV_DECK_COMPOSITION`       |
| 1.6 | Each player has 15 roads, 5 settlements and 4 cities.                                                                  | R5 p.3, 6   | OK     | `PIECE_LIMITS`, `piecesLeft` |
| 1.7 | Longest Road and Largest Army are each worth 2 VP.                                                                     | R5 p.2      | OK     | `AWARD_VP`                   |
| 1.8 | Development cards are never reshuffled. Once the deck is empty, no more can be bought.                                 | R5 p.5      | OK     | `canBuyDevCard`              |

## 2. Setup

| #    | Rule                                                                                                                                                                                     | Source              | Status    | Where / notes                                                                                                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.1  | Beginner set-up: a fixed map (see §12), with 2 settlements and 2 roads per colour pre-placed. Each player takes the resources of their starred settlement.                               | R5 p.2–3, 13        | deviation | We use the beginner **map** but play the normal placement phase (2.12–2.19). The pre-placed pieces are not encoded (they are listed in §12.3).                                                                           |
| 2.2  | With 3 players in the beginner set-up, red is left out (R6: white).                                                                                                                      | R5 p.3; R6          | n/a       | Follows from 2.1.                                                                                                                                                                                                        |
| 2.3  | Variable set-up: the terrain hexes are shuffled and placed randomly.                                                                                                                     | R5 p.12             | OK        | `randomBoard`                                                                                                                                                                                                            |
| 2.4  | The harbor pieces are placed randomly on the frame's 9 fixed harbor spots.                                                                                                               | R5 p.12–13          | OK        | Port kinds are shuffled; positions are `TOPOLOGY.portSlots`.                                                                                                                                                             |
| 2.5  | Number tokens, standard method: lay them out in a spiral (A–R) from a corner, skipping the desert. Alternative method: place them randomly, but no two red tokens (6/8) may be adjacent. | R5 p.13             | OK        | We use the alternative method. The spiral is not implemented. Since V2 the no-touching rules are the configurable **map rules** (§19): by default no 6/8, no 2/12, no equal numbers and no equal resources side by side. |
| 2.6  | The robber starts on the desert.                                                                                                                                                         | R5 p.11–12          | OK        | `assemble`                                                                                                                                                                                                               |
| 2.7  | Starting player: whoever rolls highest (beginner set-up in R5: the oldest player).                                                                                                       | R5 p.3, 12; FAQ #18 | OK (T14)  | A uniformly random seat starts, drawn from the seed (`settings.startingPlayer`, `randomStartingPlayer`): the same odds as rolling for it, without the roll. Logged as "Blue starts". Until T14 seat 0 always started.    |
| 2.12 | 2 placement rounds. Each turn of a round places 1 settlement, then 1 road.                                                                                                               | R5 p.12             | OK        | `a/setup.ts`                                                                                                                                                                                                             |
| 2.13 | Snake order: round 1 goes clockwise from the starting player, round 2 in reverse (1-2-3-4-4-3-2-1).                                                                                      | R5 p.12             | OK        | `setupPlayerAt(index, n, startingPlayer)`                                                                                                                                                                                |
| 2.15 | The setup road must touch the settlement just placed.                                                                                                                                    | R5 p.12             | OK        | `canPlaceRoad(.., {fromVertex})`                                                                                                                                                                                         |
| 2.16 | The distance rule applies to setup settlements.                                                                                                                                          | R5 p.12             | OK        |                                                                                                                                                                                                                          |
| 2.17 | Setup settlements need no road connection, and the second need not connect to the first.                                                                                                 | R5 p.12; FAQ #51    | OK        |                                                                                                                                                                                                                          |
| 2.18 | A setup settlement may be placed on a harbor.                                                                                                                                            | FAQ #47             | OK        |                                                                                                                                                                                                                          |
| 2.19 | Only the **second** settlement pays starting resources: 1 per adjacent non-desert hex.                                                                                                   | R5 p.12             | OK        |                                                                                                                                                                                                                          |
| 2.20 | After setup, the starting player takes the first turn.                                                                                                                                   | R5 p.12             | OK        | `turn.current = settings.startingPlayer`                                                                                                                                                                                 |

## 3. Turn structure

| #   | Rule                                                                                                                                                 | Source            | Status | Where / notes                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ | ------------------------------------------------------------------------------------------- |
| 3.1 | Turn order: roll for production, then trade and build, then pass to the left.                                                                        | R5 p.3, 8         | OK     | `preRoll` → `main` → `endTurn`                                                              |
| 3.2 | After the roll, trading and building may happen in any order. R5 calls this the "combined trade/build phase" variant; R6 makes it the standard rule. | R5 p.6; R6        | OK     | A single `main` phase. Consequence (FAQ #70): a harbor can be used on the turn it is built. |
| 3.4 | One development card may be played at any time during your turn, **including before rolling**.                                                       | R5 p.3, 7; FAQ #5 | OK     | Allowed in `preRoll` and `main` (see 8.8).                                                  |
| 3.5 | Trading and building happen only after the roll.                                                                                                     | R5 p.7, 14        | OK     | `main` only                                                                                 |
| 3.6 | Rolling is mandatory.                                                                                                                                | R5 p.3            | OK     | `endTurn` is only legal in `main`.                                                          |

## 4. Production

| #    | Rule                                                                                                           | Source              | Status | Where               |
| ---- | -------------------------------------------------------------------------------------------------------------- | ------------------- | ------ | ------------------- |
| 4.1  | Every hex with the rolled number produces for all adjacent buildings, whoever's turn it is.                    | R5 p.4              | OK     | `r/production.ts`   |
| 4.2  | A settlement gets 1 card and a city gets 2, for each producing hex.                                            | R5 p.4, 10          | OK     |                     |
| 4.3  | The hex holding the robber produces nothing. Other hexes with the same number still produce.                   | R5 p.5; FAQ #66     | OK     |                     |
| 4.4  | The desert never produces, and a 7 produces nothing.                                                           | R5 p.5, 7           | OK     |                     |
| 4.6  | Production cannot be declined.                                                                                 | FAQ #30             | OK     | It is automatic.    |
| 4.7  | Bank shortage, per resource: if the bank cannot pay everyone owed that resource, **nobody** gets it this roll. | R5 p.4, 10; FAQ #34 | OK     | `payableProduction` |
| 4.8  | …except when only **one** player is owed that resource. That player gets whatever is left.                     | R5 p.10; FAQ #33    | OK     |                     |
| 4.9  | A shortage of one resource does not affect the others.                                                         | R5 p.10             | OK     |                     |
| 4.10 | Shortages are decided by counting totals first. Cards are never handed out partially in turn order.            | FAQ #34, #36        | OK     |                     |

## 5. Rolling a 7 and the robber

| #    | Rule                                                                                                                          | Source           | Status    | Where / notes                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.2  | Every player with **more than 7** resource cards, including the roller, discards half, rounded down. Discards go to the bank. | R5 p.5, 11       | OK        | `discardAmounts`. The 7 is `settings.discardLimit` (default 7, range 5–20; a house-rule option since T10).                                                                                                              |
| 5.3  | Only resource cards count toward the 7-card limit. Development cards do not.                                                  | R5; R6 p.9       | OK        | `rulesAudit.test.ts`                                                                                                                                                                                                    |
| 5.4  | Each player discards once per 7, even if they still hold more than 7 afterwards.                                              | FAQ #56          | OK        |                                                                                                                                                                                                                         |
| 5.5  | Only a rolled 7 causes discards. A Knight never does.                                                                         | FAQ #2           | OK        | `rulesAudit.test.ts`                                                                                                                                                                                                    |
| 5.6  | The robber **must** move to a **different** hex.                                                                              | R5 p.5; FAQ #55  | OK        |                                                                                                                                                                                                                         |
| 5.7  | The robber may be moved to the desert.                                                                                        | R5 p.5; FAQ #59  | OK        |                                                                                                                                                                                                                         |
| 5.8  | The roller steals 1 **random** resource card from an opponent with a settlement or city on the new hex.                       | R5 p.5, 11       | OK        | `steal` uses the seeded RNG.                                                                                                                                                                                            |
| 5.9  | The steal applies on the desert too.                                                                                          | FAQ #57          | OK        | `rulesAudit.test.ts`                                                                                                                                                                                                    |
| 5.10 | If several opponents qualify, the roller chooses one.                                                                         | R5 p.5           | OK        | `steal{candidates}`                                                                                                                                                                                                     |
| 5.11 | A victim with no cards gives nothing. You may choose an empty-handed victim (stealing nothing).                               | R5 p.8; FAQ #63  | deviation | Empty-handed opponents are not offered as candidates. If no candidate has cards, there is no steal step. The outcome is the same, since stealing nothing equals not stealing; there is just one fewer pointless choice. |
| 5.12 | You never steal from yourself. With no adjacent opponent, there is no steal.                                                  | R5 (inferred)    | OK        |                                                                                                                                                                                                                         |
| 5.13 | Only resource cards can be stolen, never development cards.                                                                   | R6 p.9           | OK        |                                                                                                                                                                                                                         |
| 5.15 | Hand **sizes** are public; hand contents are private.                                                                         | R5 p.8; FAQ #31  | n/a       | For the UI. The state holds everything; redact it for online play.                                                                                                                                                      |
| 5.16 | No trading until the 7 is fully resolved (you cannot trade down below 8).                                                     | FAQ #54          | OK        | The `discard`, `moveRobber` and `steal` phases. `rulesAudit.test.ts`                                                                                                                                                    |
| 5.17 | Afterwards, the turn continues normally.                                                                                      | R5 p.11; FAQ #58 | OK        | Resumes to `main`.                                                                                                                                                                                                      |
| 5.19 | The robber does not block building or harbors.                                                                                | FAQ #41, #42     | OK        | `rulesAudit.test.ts`                                                                                                                                                                                                    |
| 5.20 | The robber may move twice in one turn: once for the 7, once for a Knight.                                                     | FAQ #60          | OK        | `rulesAudit.test.ts`                                                                                                                                                                                                    |
| 5.21 | Order: all discards, then move the robber, then steal. Whether discards are simultaneous is not specified.                    | R5 p.11          | OK        | Discarding players may act in any order. Each discards all their cards in **one** action (one decision per player).                                                                                                     |

## 6. Trading

| #    | Rule                                                                                                                                      | Source             | Status        | Where / notes                                                                                                                                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1  | Trading with other players happens only on your own turn, after rolling.                                                                  | R5 p.7, 14         | OK            | `offerTrade` is only legal in `main`, by the current player.                                                                                                                                                                |
| 6.2  | The active player takes part in every trade. Other players may not trade with each other.                                                 | R5 p.4, 7; FAQ #67 | OK            |                                                                                                                                                                                                                             |
| 6.4  | No gifts: both sides of a trade must be non-empty.                                                                                        | R5 p.7; FAQ #68    | OK            |                                                                                                                                                                                                                             |
| 6.5  | No like-for-like trades (e.g. 2 wool for 1 wool).                                                                                         | R5 p.7, 14         | OK            | Stricter than the rule: `give` and `want` may share **no** resource. That changes nothing in practice, since any overlap reduces to a smaller trade.                                                                        |
| 6.6  | Development cards cannot be traded.                                                                                                       | R5 p.7             | OK            | Only resources are tradable.                                                                                                                                                                                                |
| 6.7  | Any number of trades per turn.                                                                                                            | R5 p.7, 14         | **deviation** | House rule: at most `MAX_TRADE_OFFERS_PER_TURN` = 3 player **offers** per turn. Bank trades are unlimited. Without a limit, bots loop offer → reject forever. Raise the constant if humans find 3 tight (ARCHITECTURE §12). |
| 6.8  | Other players may make counter-offers.                                                                                                    | R5 p.4             | **deviation** | Responders can only accept or reject. A counter-offer has to become a new offer from the active player. Card idea: a `counterOffer` action.                                                                                 |
| 6.9  | No credit, no promises. Only cards in hand change hands.                                                                                  | FAQ #72            | OK            | Both sides are re-checked at `confirmTrade`.                                                                                                                                                                                |
| 6.10 | Trades are public.                                                                                                                        | FAQ #69            | OK            | Offers are logged.                                                                                                                                                                                                          |
| —    | How the engine runs a negotiation: the offer goes to chosen players, each accepts or rejects, and the offerer confirms with one acceptor. | (ours)             | OK            | A two-step confirm models table negotiation. When every responder has rejected, the offer closes automatically.                                                                                                             |
| 6.13 | Bank trades only on your own turn.                                                                                                        | R5 p.14            | OK            | `rulesAudit.test.ts`                                                                                                                                                                                                        |
| 6.14 | 4:1 with the bank is always available. You receive a **different** resource.                                                              | R5 p.4, 9; R6      | OK            | `bankTradeRatio`                                                                                                                                                                                                            |
| 6.15 | A generic harbor gives 3:1 on any resource.                                                                                               | R5 p.9             | OK            |                                                                                                                                                                                                                             |
| 6.16 | A 2:1 harbor gives 2:1 only for its pictured resource. It does not give 3:1 on the others.                                                | R5 p.9; FAQ #73    | OK            |                                                                                                                                                                                                                             |
| 6.17 | Multiples are allowed (e.g. 4 ore at an ore harbor for 2 cards).                                                                          | R5 p.9             | OK            | Done as one `bankTrade` per card received.                                                                                                                                                                                  |
| 6.18 | You use a harbor through your own settlement or city on one of its 2 intersections.                                                       | R5 p.4, 8; FAQ #71 | OK            | `portsOf`                                                                                                                                                                                                                   |
| 6.19 | Bank trade for a resource the bank has run out of.                                                                                        | —                  | unclear       | Rejected: the bank cannot give what it does not have.                                                                                                                                                                       |

## 7. Building

| #    | Rule                                                                                                                                     | Source          | Status | Where / notes                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------ | ------------------------------------ |
| 7.1  | Costs: road = brick + lumber; settlement = brick + lumber + wool + grain; city = 3 ore + 2 grain; development card = ore + wool + grain. | R5 p.4–5        | OK     | `COSTS`                              |
| 7.2  | Payments go to the bank.                                                                                                                 | R5 p.6          | OK     |                                      |
| 7.3  | Build as much as you can pay for, while pieces last.                                                                                     | R5 p.6; FAQ #3  | OK     |                                      |
| 7.4  | One road per edge. Coastal edges are allowed.                                                                                            | R5 p.4, 10      | OK     |                                      |
| 7.5  | A new road must connect to your own road, settlement or city.                                                                            | R5 p.4          | OK     | `canPlaceRoad`                       |
| 7.6  | A road cannot continue through an opponent's building. It may end at one.                                                                | FAQ #40; R6 p.7 | OK     | `placement.test.ts`, `build.test.ts` |
| 7.7  | A settlement goes on an empty intersection.                                                                                              | R5 p.7          | OK     |                                      |
| 7.8  | Distance rule: none of the adjacent intersections may hold a building, including your own.                                               | R5 p.4; FAQ #52 | OK     | `isVertexOpen`                       |
| 7.9  | After setup, a settlement must touch one of your own roads.                                                                              | R5 p.4; FAQ #51 | OK     |                                      |
| 7.10 | Coastal intersections (touching 1–2 land hexes) are valid sites.                                                                         | R5 p.6; FAQ #49 | OK     |                                      |
| 7.11 | A city only upgrades one of your own settlements.                                                                                        | R5 p.4; FAQ #45 | OK     | `canPlaceCity`                       |
| 7.12 | The upgraded settlement returns to your supply.                                                                                          | R5 p.4; FAQ #53 | OK     | `piecesLeft` is derived.             |
| 7.14 | Piece limits: 15 / 5 / 4. With all 5 settlements on the board, you must upgrade one before building another.                             | R5 p.4, 12      | OK     |                                      |
| 7.15 | Pieces are permanent.                                                                                                                    | R5 p.6; FAQ #50 | OK     | No removal action.                   |

## 8. Development cards

| #     | Rule                                                                                                                                                    | Source                    | Status    | Where / notes                                                                                                                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1   | Buying costs ore + wool + grain. You draw the top card and keep it hidden.                                                                              | R5 p.4–5                  | OK        | `buyDevCard` (`main` only)                                                                                                                                                                                        |
| 8.2   | Any number may be bought per turn.                                                                                                                      | FAQ #3                    | OK        |                                                                                                                                                                                                                   |
| 8.4   | At most **one** development card is played per turn: a Knight or a progress card.                                                                       | R5 p.5, 7; FAQ #5         | OK        | `turn.devCardPlayed`                                                                                                                                                                                              |
| 8.5   | A card bought this turn cannot be played this turn.                                                                                                     | R5 p.5, 7                 | OK        | `newDevCards`                                                                                                                                                                                                     |
| 8.6   | VP cards are exempt from 8.4 and 8.5. They count as soon as they are held, including on the turn they are bought.                                       | R5 p.5; FAQ #14           | OK        | `victoryPoints` counts VP cards in `devCards` and `newDevCards`.                                                                                                                                                  |
| 8.7   | A card played before rolling uses up the one play for the turn.                                                                                         | FAQ #5                    | OK        |                                                                                                                                                                                                                   |
| 8.8   | A card may be played at any time on your turn, including in the middle of trading.                                                                      | R5 p.3; FAQ #12           | deviation | Allowed in `preRoll` and `main`. Not while your own trade offer is open (`trade` phase): cancel or close the offer first. This only constrains the order of play.                                                 |
| 8.9   | Cards are played only on your own turn.                                                                                                                 | FAQ #13                   | OK        | `rulesAudit.test.ts`                                                                                                                                                                                              |
| 8.10  | Playing a card between rolling a 7 and moving the robber.                                                                                               | —                         | unclear   | Disallowed. Dev cards can only be played in `preRoll` and `main`, so the 7 must be resolved first (by analogy with FAQ #54). `rulesAudit.test.ts`                                                                 |
| 8.11  | **Knight**: move the robber and steal (5.6–5.13). No discards. May be played before rolling. Played knights stay face up and count toward Largest Army. | R5 p.5, 8; FAQ #2, #7, #9 | OK        | `knightsPlayed`                                                                                                                                                                                                   |
| 8.12  | **Road Building**: place 2 roads for free, following the normal rules.                                                                                  | R5 p.10                   | OK        | The `roadBuilding` phase.                                                                                                                                                                                         |
| 8.12a | Road Building with fewer than 2 placeable roads or road pieces.                                                                                         | —                         | unclear   | Place as many as possible: `remaining = min(2, roads left)`, and the phase ends early when no spot is left. If **no** road can be placed, the card cannot be played (kept: it saves a card that would be wasted). |
| 8.13  | **Year of Plenty**: take any 2 resources from the bank, the same or different.                                                                          | R5 p.10                   | OK        |                                                                                                                                                                                                                   |
| 8.13a | Year of Plenty when the bank cannot give the pair you want.                                                                                             | —                         | unclear   | That pair is rejected; you choose a pair the bank has. If the bank holds fewer than 2 cards in total, the card cannot be played (there is no partial grant). This is extremely rare.                              |
| 8.14  | **Monopoly**: name one resource. Every other player gives you all of it.                                                                                | R5 p.5, 10; R6            | OK        |                                                                                                                                                                                                                   |
| 8.15  | Progress cards leave the game once played.                                                                                                              | R5 p.5; FAQ #6            | OK        | Recorded in `Player.progressCardsPlayed` (T8), so deck + hands + played = 25 exactly (sim invariant).                                                                                                             |
| 8.16  | VP cards stay hidden until they win the game.                                                                                                           | R5 p.5, 14                | n/a       | For the UI: `publicVictoryPoints` versus `victoryPoints`.                                                                                                                                                         |

## 9. Longest Road

| #   | Rule                                                                                                                                                                                                                                                                              | Source                  | Status | Where / notes                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------ | ------------------------------------------------------------------ |
| 9.1 | The first player with a continuous road of **at least 5** segments takes the card.                                                                                                                                                                                                | R5 p.4, 9               | OK     | `r/awards.ts`                                                      |
| 9.2 | Branches do not add up; only the single longest path counts (in graph terms, the longest trail).                                                                                                                                                                                  | R5 p.9                  | OK     | `r/longestRoad.ts`                                                 |
| 9.3 | Loops count fully. A ring of 6 roads counts 6.                                                                                                                                                                                                                                    | FAQ #22                 | OK     | `longestRoad.test.ts`                                              |
| 9.4 | Your own buildings never break your road.                                                                                                                                                                                                                                         | FAQ #23, #48            | OK     |                                                                    |
| 9.5 | An opponent's building on an intersection breaks the road there. Opponent **roads** do not.                                                                                                                                                                                       | R5 p.9; FAQ #24, #29    | OK     | `longestRoad.test.ts`                                              |
| 9.6 | To take the card, you need a **strictly** longer road. A tie leaves it with the holder.                                                                                                                                                                                           | R5 p.4; FAQ #27         | OK     | `awardHolder`                                                      |
| 9.7 | The card changes hands immediately, even mid-turn or on another player's turn.                                                                                                                                                                                                    | R5 p.4, 9               | OK     | Recomputed after every road-changing action (see ARCHITECTURE §7). |
| 9.8 | After a road is broken: if the holder is still longest or tied for longest (with 5 or more), the holder keeps the card. Otherwise a unique leader with 5 or more takes it. Otherwise (a tie, or nobody at 5) the card is set aside until exactly one player leads with 5 or more. | R5 p.9; FAQ #28; R6 p.8 | OK     | `awards.test.ts`                                                   |

## 10. Largest Army

| #    | Rule                                                                                  | Source          | Status | Where         |
| ---- | ------------------------------------------------------------------------------------- | --------------- | ------ | ------------- |
| 10.1 | The first player with **3** played knights takes the card.                            | R5 p.5, 8       | OK     | `r/awards.ts` |
| 10.2 | A challenger needs strictly **more** knights than the holder. A tie keeps the holder. | R5 p.8; FAQ #20 | OK     |               |
| 10.3 | Only played knights count.                                                            | FAQ #21         | OK     |               |

## 11. Victory

| #    | Rule                                                                                                                           | Source        | Status | Where / notes                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------ | ---------------------------------------------------------------------- |
| 11.1 | VP: settlement 1, city 2, Longest Road 2, Largest Army 2, VP card 1.                                                           | R5 p.14       | OK     | `victoryPoints`                                                        |
| 11.2 | You win **immediately** on reaching 10 VP **during your own turn**, in any phase.                                              | R5 p.5, 7, 14 | OK     | `checkVictory` runs after every action, for the current player only.   |
| 11.3 | Reaching 10 on another player's turn (e.g. Longest Road shifting to you) does not win. You win at the start of your next turn. | R5 p.7        | OK     | `victory.test.ts`                                                      |
| 11.4 | If you start your turn with 10 or more VP, you win without rolling.                                                            | FAQ #75       | OK     | The `endTurn` that hands you the turn triggers `checkVictory` for you. |
| 11.5 | The game ends at once; scoring stops.                                                                                          | FAQ #76       | OK     | The `gameOver` phase rejects every action.                             |
| —    | Configurable target (`vpToWin`, default 10).                                                                                   | (ours)        | OK     | For tests and short games.                                             |

## 12. Beginner map and harbor positions

Source: R5 p.3, Illustration A, checked by eye at high resolution (**IMG**). The map is pointy-top,
in rows of 3/4/5/4/3, read top to bottom and left to right. This is `TOPOLOGY.landHexes` order.

### 12.1 Terrain and number tokens

| Row | 1            | 2           | 3          | 4         | 5           |
| --- | ------------ | ----------- | ---------- | --------- | ----------- |
| 1   | mountains 10 | pasture 2   | forest 9   |           |             |
| 2   | fields 12    | hills 6     | pasture 4  | hills 10  |             |
| 3   | fields 9     | forest 11   | **desert** | forest 3  | mountains 8 |
| 4   | forest 8     | mountains 3 | fields 4   | pasture 5 |             |
| 5   | hills 5      | fields 6    | pasture 11 |           |             |

Status: **OK** (`BEGINNER_HEXES`, pinned in `board.test.ts`). Our resource names are ore =
mountains, wool = pasture, lumber = forest, grain = fields, brick = hills.

### 12.2 Harbors (clockwise from top-left, slot = `TOPOLOGY.portSlots[i]`)

| Slot | Kind       | Faces (land hex, side) |
| ---- | ---------- | ---------------------- |
| 0    | 3:1        | mountains 10, NW       |
| 1    | 2:1 grain  | pasture 2, NE          |
| 2    | 2:1 ore    | hills 10, NE           |
| 3    | 3:1        | mountains 8, E         |
| 4    | 2:1 wool   | pasture 5, SE          |
| 5    | 3:1        | fields 6, SE           |
| 6    | 3:1        | hills 5, SW            |
| 7    | 2:1 brick  | forest 8, W            |
| 8    | 2:1 lumber | fields 12, W           |

- Status: **bug→fixed** (T8). Slots 2, 5 and 8 sat one coastal edge off: forest 9 E, pasture 11 SW and fields 9 NW. The kinds were already right. Pinned in `topology.test.ts` and `board.test.ts`.
- **General frame rule:** a harbor sits on every other water hex, starting top-left. A water hex that touches 2 land hexes faces the one that is **not** a corner of the land hexagon. That leaves 2, 3, 2 free coastal edges between harbors, repeating (3-fold symmetric).
- The 5th-edition frame's harbor spots are fixed. R5 p.12–13 says to place the harbor pieces randomly on them, so the random layout shuffles only the kinds (2.4).
- Cross-check: catanatron (https://github.com/bcollazo/catanatron, `models/map.py`) puts its fixed harbors on the same 9 edges.

### 12.3 Beginner starting pieces (not encoded; for a future "beginner start" option)

Intersections are written as the 3 hexes that meet there (row/column). ★ marks the settlement
that pays starting resources. Read from IMG; confidence is medium to high. Blue's ★ matches the
R5 p.4 example ("1 brick, 1 lumber, 1 ore").

| Colour | Settlement A         | Road A      | Settlement B         | Road B      |
| ------ | -------------------- | ----------- | -------------------- | ----------- |
| Red    | {r1c1, r1c2, r2c2}   | r1c2 / r2c2 | ★ {r3c1, r3c2, r4c1} | r3c2 / r4c1 |
| White  | ★ {r2c1, r2c2, r3c2} | r2c1 / r3c2 | {r3c4, r3c5, r4c4}   | r3c4 / r3c5 |
| Orange | {r1c3, r2c3, r2c4}   | r1c3 / r2c3 | ★ {r4c2, r4c3, r5c2} | r4c3 / r5c2 |
| Blue   | ★ {r4c1, r4c2, r5c1} | r4c2 / r5c1 | {r4c3, r4c4, r5c3}   | r4c3 / r4c4 |

With 3 players, leave out red (R5) or white (R6).

## 13. Common misreadings (all handled correctly)

1. You cannot trade before rolling. Only a dev card may be played before the roll (3.4, 3.5).
2. You cannot trade during a 7 to avoid discarding (5.16).
3. Knights never cause discards (5.5).
4. A Knight played before rolling is legal, e.g. to move the robber off your own hex (8.11).
5. The robber may go to the desert and still steal (5.7, 5.9). It may not stay on the same hex (5.6).
6. A 2:1 harbor gives nothing for other resources (6.16).
7. Ties never take Longest Road or Largest Army (9.6, 10.2). A broken road can leave Longest Road with nobody (9.8).

## 14. 6th edition (2025) differences, for awareness

- Renames: Year of Plenty → Invention, Longest Road → Longest Route, special cards → tiles, harbor → port.
- Combined trade/build is now the standard turn. We already work this way (3.2).
- Development cards are explicitly excluded from the 7-card count and from theft. We already do this (5.3, 5.13).
- Beginner set-up: the highest roll starts, and white is left out with 3 players.
- The core rules are unchanged.

## 15. Audit summary (T8)

- **Bugs found and fixed:** 1. Three harbor positions were wrong (12.2).
- **Deliberate deviations:**
  - The fixed first player (2.7). Fixed in T14: a seeded random seat starts.
  - The beginner pre-placed pieces are not used (2.1).
  - Empty-handed steal candidates are dropped (5.11).
  - The 3-offer trade cap (6.7).
  - No counter-offers (6.8).
  - No dev card play while an offer is open (8.8).
- **Unclear in the sources, our choices:** 6.19, 8.10, 8.12a, 8.13a.
- **Every other rule checked: OK.** The OK rules are covered by the per-area `*.test.ts` files. Rules the audit found without an explicit test now have one in `src/engine/rulesAudit.test.ts`.

## 16. Larger boards: 5-6 and 7-8 players (T10)

Compiled by T10 (2026-10-25). Map ids, definitions and counts live in `src/engine/maps.ts`;
tests in `src/engine/maps.test.ts`. Players per map: `base`/`baseRandom` 3–4, `base56` 3–6,
`base78` 3–8. Everything not listed here follows the base rules above.

### 16.A 5-6 player extension (official, `base56`)

| #     | Rule                                                                                                                                                               | Source     | Status    | Where / notes                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16.1  | Adds 11 terrain hexes (1 desert, 2 each of fields, forest, pasture, mountains, hills): 30 in all = 6 forest, 6 pasture, 6 fields, 5 hills, 5 mountains, 2 deserts. | E56 p.1    | OK        | `MAPS.base56.terrain`                                                                                                                                          |
| 16.2  | 28 number tokens (the extension's own set replaces the base set): two each of 2 and 12, three each of 3–6 and 8–11.                                                | E56 p.1–2  | OK        | `MAPS.base56.tokens`. The pdf text extraction of Illustration B is ambiguous about one 2/12 token; 2×2 + 12×2 is the only split that sums to 28 symmetrically. |
| 16.3  | 11 harbors: the base 9 plus one generic 3:1 and one wool 2:1, shuffled onto the frame's harbor spots.                                                              | E56 p.1, 3 | OK        | `MAPS.base56.harbors`                                                                                                                                          |
| 16.4  | Bank: +5 cards per resource, so 24 each.                                                                                                                           | E56 p.1    | OK        | `bankPerResource: 24`                                                                                                                                          |
| 16.5  | Dev deck: +9 cards (6 Knight, 1 Monopoly, 1 Year of Plenty, 1 Road Building) = 34: 20 / 5 VP / 3 / 3 / 3.                                                          | E56 p.1    | OK        | `MAPS.base56.devDeck`                                                                                                                                          |
| 16.6  | Each player still has 5 settlements, 4 cities and 15 roads.                                                                                                        | E56 p.1    | OK        | `PIECE_LIMITS` unchanged                                                                                                                                       |
| 16.7  | Board: 30 hexes in rows 3-4-5-6-5-4-3, the base frame plus 4 small frame pieces (2 plain sea, 1 generic harbor, 1 wool harbor).                                    | E56 p.1–2  | OK        | `FRAME_STD30`. Harbor spots: §16.B.                                                                                                                            |
| 16.8  | Tokens are placed in a lettered spiral (A–Za/Zb/Zc) skipping the deserts.                                                                                          | E56 p.3    | deviation | Like 2.5: random placement, no adjacent 6/8 (rejection sampling). The spiral is not implemented.                                                               |
| 16.9  | The robber starts on **either** desert.                                                                                                                            | E56 p.3    | OK        | `randomBoard` picks one with the game RNG.                                                                                                                     |
| 16.10 | Special Building Phase after each turn: in clockwise order every other player may build or buy dev cards (no trading, no dev card play).                           | E56 p.3–4  | OK        | `settings.specialBuildPhase` (default on with 5+ players, any player count allowed). Phase `specialBuild`, details 16.10a–h (T13). Paired turns: §16.D.        |

#### 16.A.1 Special Building Phase details (T13)

Source **FAQ56**: the catan.com base game FAQ page (https://catan.com/node/68, read 2026-10-25),
which also holds the 5-6 player questions. Its entries are quoted by question, not number.
All rules below: `a/turn.ts` (phase flow), `a/build.ts` / `a/dev.ts` (what is allowed), tests in
`a/specialBuild.test.ts`.

| #      | Rule                                                                                                                                            | Source                                                                         | Status    | Where / notes                                                                                                                                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16.10a | The phase comes after the turn ends, between turns. Each other player, in clockwise order from the next player, gets one special build turn.    | E56 p.3                                                                        | OK        | `endTurn` → `specialBuild{builder, owner}`. `turn.current` = builder (as in setup); `turn.number` still counts the ended turn. After the last builder, owner+1's turn starts (`preRoll`).                                                                                                                |
| 16.10b | The builder may build roads, settlements and cities and buy development cards, with the cards in hand.                                          | E56 p.3                                                                        | OK        | `buildRoad/buildSettlement/buildCity/buyDevCard`, then `passSpecialBuild`.                                                                                                                                                                                                                               |
| 16.10c | A card bought in the phase may be played on the buyer's next turn.                                                                              | FAQ56 ("…bought…during the special building phase right before my turn…": Yes) | OK        | It goes straight into `devCards` (not `newDevCards`), since it was bought before the buyer's turn.                                                                                                                                                                                                       |
| 16.10d | No trading with players, no maritime (bank/harbor) trade, no dev card play (incl. Road Building), no rolling.                                   | E56 p.3; FAQ56                                                                 | OK        | All are `main`/`preRoll`-only actions. **Optional exception:** with the 5+ player rule set one card may be played (§20.1).                                                                                                                                                                               |
| 16.10e | The player who just ended their turn does not take part.                                                                                        | FAQ56                                                                          | OK        |                                                                                                                                                                                                                                                                                                          |
| 16.10f | The phase happens even if the player who ended the turn built nothing.                                                                          | FAQ56                                                                          | OK        |                                                                                                                                                                                                                                                                                                          |
| 16.10g | **You cannot win during the special building phase.** "Can I win during the special building phase? No. You can only win during your own turn." | FAQ56                                                                          | OK        | `checkVictory` skips `specialBuild`. A builder who reaches `vpToWin` wins when their own turn starts (11.4), unless someone wins first. The same holds for an owner who gains Longest Road during someone's step (11.3).                                                                                 |
| 16.10h | Players who could not build or buy anything are skipped.                                                                                        | (ours)                                                                         | deviation | Saves a pointless step (and a hotseat "pass the screen" cover) per player per turn. It shows that the skipped player could afford nothing, which their public hand size often shows anyway. If nobody can act, `endTurn` goes straight to the next turn. A builder who spent everything must still pass. |

### 16.B 5-6 harbor spots

Read by eye from E56 p.2 Illustration A (rendered at 900 dpi). Clockwise from the top-left
corner of the water ring, as `[water hex, land hex it faces]` in our axial coordinates
(`FRAME_STD30` in `maps.ts`; land rows centered half a hex right of x = 0):

`[1,-4 → 1,-3] [3,-4 → 2,-3] [4,-3 → 3,-3] [4,0 → 3,0] [2,2 → 1,2] [1,3 → 0,3] [-1,4 → -1,3] [-3,4 → -2,3] [-3,2 → -2,2] [-3,1 → -2,1] [-2,-1 → -1,-1]`

The **water hexes** are clear in the image. The **facing** (which of two touching land hexes the
harbor's piers point to) is small in the illustration; where unclear we used the base-frame rule
(face the non-corner hex) and checked that no two harbors share a vertex. Coastal-edge gaps
between harbors are 3,3,6,4,2,3,3,3,2,4,5: the long gaps (6, 5) sit where the plain sea pieces
are inserted (joints A, D) and the short ones (2, 2) where the harbor pieces are (B, C), which
matches the assembly text. Confidence: water hexes high, facing medium.

### 16.C 7-8 players (`base78`): our design

We could **not** find an official 7-8 player rulebook. Searches (catan.com, retailers, BGG) only
turned up the 5-6 extension and a BGG thread about a long out-of-print 1st-edition 7-8 rulebook
that joined two boards. The only concrete numbers come from Colonist.io's digital version
(**COL**, unofficial): 37 tiles, 29 cards per resource, 43 dev cards (26 Knight, 5 VP, 4 Road
Building, 4 Year of Plenty, 4 Monopoly). So `base78` is our own design in the spirit of the
5-6 extension:

| Item     | Value                                                                                    | Basis                                                                       |
| -------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Shape    | 37 hexes, rows 4-5-6-7-6-5-4 (the radius-3 hexagon), water ring of 24                    | COL's 37 tiles; the most symmetric shape of that size                       |
| Terrain  | 7 forest, 8 pasture, 7 fields, 6 hills, 6 mountains, 3 deserts                           | ours: base ratios (brick/ore scarcest), ~1 desert per 12 hexes              |
| Tokens   | 34: two each of 2 and 12, three each of 3 and 11, four each of 4–6 and 8–10              | ours: symmetric, follows the dice odds more closely than adding flat copies |
| Harbors  | 12 on every other ring hex (6-fold symmetric, gaps 4,3): 6 generic, 2 wool, 1 each other | ours: base 9 + 5-6's two (generic, wool) + one more generic                 |
| Bank     | 29 per resource                                                                          | COL                                                                         |
| Dev deck | 43: 26 Knight, 5 VP, 4 Road Building, 4 Year of Plenty, 4 Monopoly                       | COL                                                                         |
| Pieces   | unchanged (15 / 5 / 4)                                                                   | as 16.6                                                                     |
| 6/8 rule | no adjacent 6/8 (random placement, as 2.5)                                               | as 16.8                                                                     |
| Robber   | starts on a random desert                                                                | as 16.9                                                                     |

If an official 7-8 extension turns up, only `MAPS.base78` / `FRAME_HEX37` need changing.

### 16.D Turn structure with 5+ players (for T13)

- E56 (2020 printing) still describes the **Special Building Phase** (16.10).
- **PPT** (catan.com, 2021) says a "paired players' turn" rule "officially replaces the previous
  special build phase": each turn has two players, Catanian 1 (rolls, trades, builds, plays a dev
  card) and Catanian 2, the **third player to the left**, who afterwards may trade with the bank
  and build and play a dev card, but may not roll, trade with players, or play a dev card before
  Catanian 1's roll. It lists Seafarers, C&K, T&B and E&P extensions; whether it also applies to
  the base 5-6 extension is implied ("applies to CATAN and to all extensions") but not spelled out.
- **Decision (T13): we implement the Special Building Phase only.** It is what E56, the printed
  rules of the extension we model, describes, and it works the same for 3–8 players. Paired turns
  are a different turn structure (two active players, a second player who trades with the bank
  and plays a dev card), and catan.com does not spell out that it applies to the base 5-6
  extension. `settings.specialBuildPhase` stays a boolean. Paired turns are a backlog idea; they
  would make the setting a 3-value turn mode (`'normal' | 'specialBuild' | 'pairedTurns'`).
- 7-8 players (`base78`, our design): the same Special Building Phase, default on.
- **Update (V1):** paired turns are now available as the option "Second Settler Mode"
  (`settings.secondSettler`, §18.6). The Special Building Phase stays the default; the two exclude
  each other.

### 16.E Other T10 settings (house rules / client options)

| Setting             | Engine status                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discardLimit`      | Implemented: replaces the 7 in 5.2 (5–20, default 7). Only `discardAmounts` reads it; tested at 5, 9 and 20 (T13).                                       |
| `vpToWin`           | Implemented since T2; range now validated 3–20.                                                                                                          |
| `balancedDice`      | Implemented (T13), see §17.                                                                                                                              |
| `specialBuildPhase` | Implemented (T13), see 16.10 and §16.D.                                                                                                                  |
| `hideBankCards`     | Client-side only: the UI hides bank counts. The engine ignores it.                                                                                       |
| `turnTimerSec`      | House rule, client-side (T14): the controller times humans and on timeout makes only the minimum legal moves (ARCHITECTURE §13b). The engine ignores it. |
| V1 variants         | Robber mode, Event Cards, Rush, Turbo, chess clock, turn order, map selection, setup placement: see §18.                                                 |

## 17. Balanced dice (`settings.balancedDice`, T13)

A variant in the spirit of the official _Catan Event Cards_ / dice deck: rolls come from a deck
instead of dice, so over a cycle every outcome appears as often as the odds say. The
event-card texts of that product are **not** modelled here; only the dice values are. The full
Event Cards deck, with its events, is the separate option `settings.eventCards` (§18.2).

| #    | Rule                                                                                                                                                   | Status | Where / notes                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 17.1 | The deck has 36 cards, one per ordered outcome of two dice (so a total of 7 appears 6 times, 2 and 12 once each).                                      | OK     | `DICE_CARDS` in `r/dice.ts`; card = `(d1-1)*6 + (d2-1)`. Kept in `state.diceDeck` (undrawn cards), drawn with `pop()`.                     |
| 17.2 | Before a roll, when **5 or fewer** cards remain, all 36 are reshuffled. The last cards of a cycle stay unknown, so the final rolls cannot be counted.  | ours   | `DICE_DECK_RESHUFFLE_AT = 5`. A cycle is 31 rolls; the 5 unseen cards are discarded. The deck starts empty, so the first roll shuffles.    |
| 17.3 | Shuffles use the seeded game RNG, so games stay deterministic per seed. Plain-dice games use the RNG exactly as before.                                | OK     | `rollTwoDice`                                                                                                                              |
| 17.4 | A roll is still two dice values in `state.dice`; the roll log line is unchanged. A reshuffle adds the log line "The dice deck was shuffled".           | OK     |                                                                                                                                            |
| 17.5 | Per cycle, drawn + unseen cards = the 36-card deck exactly. So over k cycles each total appears at most `ways × k` and at least `ways × k − 5k` times. | OK     | `r/dice.test.ts`. Because of 17.2, counts over 36·k rolls are **not** exact; they are exact per cycle once the 5 unseen cards are counted. |
| 17.6 | Saves: the deck is part of the state (schema v3). Older saves get an empty deck, so their next balanced roll shuffles a fresh one.                     | OK     | `migrate.ts`                                                                                                                               |

## 18. Game-setting variants (V1)

Optional room settings in the style of Colonist.io's room options. Every one is an **optional**
`GameSettings` field that is absent by default; absent means the official rules above. They are
read only through `src/engine/variants.ts` / `clock.ts`. Tests: `src/engine/variants.test.ts`,
`src/engine/clock.test.ts`, `src/game/variants.test.ts`, `src/ui/variants.test.ts`. Every variant
runs in the sim with 0 violations (`pnpm sim -- --help` lists the flags).

Status `ours` = no primary source defines it; the definition is ours (flagged for review).

### 18.1 Robber mode (`settings.robberMode`: `'normal' | 'friendly' | 'none'`)

| #     | Rule                                                                                                                                   | Source | Status | Where / notes                                                                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | -------------------------------------------------------------------------------------------------- |
| 18.1a | Friendly robber: the robber may not be moved to a hex next to a player with 2 or fewer victory points.                                 | TB p.3 | OK     | `robberTargets`. Colonist: "Can't rob players under 3 VPs" (COLF).                                 |
| 18.1b | Those players cannot be robbed either.                                                                                                 | TB p.3 | OK     | `stealCandidates` skips them (also when the robber had to go to the desert).                       |
| 18.1c | Only **public** points count: settlements, cities, Longest Road, Largest Army. VP cards do not.                                        | COLF   | OK     | `publicVictoryPoints`. TB counts "victory points" too; the hidden cards are not visible anyway.    |
| 18.1d | If no hex is allowed, the robber moves to (or stays on) the desert.                                                                    | TB p.3 | OK     | Then the robber may stay on its own desert hex (the only exception to 5.6).                        |
| 18.1e | The mover's own buildings do not restrict them.                                                                                        | (ours) | ours   | Protection is for the victims; you may block yourself.                                             |
| 18.1f | **No robber**: on a 7, players over the limit still discard; nobody moves the robber or steals. A Knight counts for Largest Army only. | (ours) | ours   | `startRobber`. Colonist has no such option; added as the third "common" choice. No hex is blocked. |

### 18.2 Event Cards (`settings.eventCards`)

The official _Catan Event Cards_ deck (in TB, also sold separately) replaces the dice.

| #     | Rule                                                                                                                                                                                                | Source      | Status  | Where / notes                                                                                                                                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 18.2a | 36 event cards. Each shows a number 2–12; per number the counts follow two dice (1-2-3-4-5-6-5-4-3-2-1).                                                                                            | TB pp.4, 23 | OK      | `EVENT_CARDS` in `r/events.ts` (list below).                                                                                                                                                                                                |
| 18.2b | The New Year card lies under the last 5 cards; when it comes up, all 36 are reshuffled.                                                                                                             | TB p.4      | OK      | Reshuffle when ≤ 5 remain (as balanced dice, §17). Logged "New Year: the event deck was shuffled".                                                                                                                                          |
| 18.2c | Each turn the card is revealed instead of rolling: the event is resolved first, then the number produces.                                                                                           | TB p.4      | OK      | `resolveEventRoll`. `state.dice` shows the number as two even faces (8 = 4+4); `state.lastEvent` is the event.                                                                                                                              |
| 18.2d | **Robber Attacks!** (6 cards, all 7s): as a rolled 7 (discards, robber, steal).                                                                                                                     | TB          | OK      | `resolveSeven`                                                                                                                                                                                                                              |
| 18.2e | **Epidemic** (6, 8): each city produces only 1 resource this turn.                                                                                                                                  | TB          | OK      | `produce(.., { cityYield: 1 })`                                                                                                                                                                                                             |
| 18.2f | **Earthquake** (6): each player turns 1 of their roads sideways. They may not build roads until it is repaired (1 lumber + 1 brick), nor a settlement next to it. It still counts for Longest Road. | TB          | OK      | Task `damageRoad` (board click), `state.damagedRoads`, action `repairRoad`. "Next to it" = at either end of **your** damaged road. Also blocks Road Building (it builds roads). A player who already has a damaged road is not asked again. |
| 18.2g | **Good Neighbors** (6): each player gives the player to their left 1 resource of their choice (if they have one).                                                                                   | TB          | OK      | "Left" = next in turn order. Task `give`.                                                                                                                                                                                                   |
| 18.2h | **Tournament** (5): the player(s) with the most knights played take 1 resource of their choice from the bank.                                                                                       | TB          | OK      | Needs ≥ 1 knight. Task `gain`.                                                                                                                                                                                                              |
| 18.2i | **Trade Advantage** (5): the Longest Road holder (if unclaimed: the player with more roads than any other) may take 1 resource card from any player.                                                | TB          | OK      | Optional (may pass); the card taken is random. Task `steal`.                                                                                                                                                                                |
| 18.2j | **Calm Sea** (9, 12): the player(s) with the most harbors take 1 resource of their choice from the bank.                                                                                            | TB          | OK      | Needs ≥ 1 harbor.                                                                                                                                                                                                                           |
| 18.2k | **Robber Flees** (4, 4): the robber returns to the desert. No card is taken.                                                                                                                        | TB          | OK      | With several deserts: the first one. Nothing happens without a robber (18.1f).                                                                                                                                                              |
| 18.2l | **Neighborly Assistance** (10, 11): the player(s) with the most victory points give 1 resource of their choice to a player with fewer points (if they have a card).                                 | TB          | OK      | Public VP (hidden cards are secret). Nobody gives when everyone is tied. Task `give` with a choice of recipient.                                                                                                                            |
| 18.2m | **Conflict** (3): the Largest Army holder (if unclaimed: the player with the most knights) takes 1 random resource card from a player of their choice. A tie for most knights: no effect.           | TB          | unclear | TB words the tie rule in two slightly different ways; we use the card's wording (holder first, else a unique leader).                                                                                                                       |
| 18.2n | **Plentiful Year** (2): each player takes 1 resource of their choice from the bank.                                                                                                                 | TB          | OK      |                                                                                                                                                                                                                                             |
| 18.2o | "Catan prospers" (16 cards): no event.                                                                                                                                                              | TB          | OK      | 3, 4, 5×2, 6×2, 8×4, 9×3, 10×2, 11.                                                                                                                                                                                                         |
| 18.2p | Players act on event choices in any order (like discards). A choice that becomes impossible (empty bank, empty hands) is dropped.                                                                   | (ours)      | ours    | Phase `event{tasks}`, actions `eventGain / eventGive / eventSteal / eventDamageRoad`.                                                                                                                                                       |
| 18.2q | Not combinable with balanced dice (both replace the dice).                                                                                                                                          | (ours)      | ours    | `createGame` throws.                                                                                                                                                                                                                        |

The C&K notes printed on the cards are not modelled (base game only).

### 18.3 Rush Mode (`settings.rushMode`) — **flagged**

Colonist's Rush (COLR) is real-time: "No turns. Everyone builds & trades at the same time.
Automatic dice rolls." on a fixed interval (5–20 s), "7 dice = alternating robber", discard limit 9,
10 VP, friendly robber on by default, one dev card per player per roll, and turn-based initial
placement. Our engine is turn-based, so **simultaneous play is not implemented**. What we
implement:

| #     | Rule                                                                                                 | Source | Status | Where / notes                                                        |
| ----- | ---------------------------------------------------------------------------------------------------- | ------ | ------ | -------------------------------------------------------------------- |
| 18.3a | Automatic dice rolls: the roll happens as the turn starts (no `preRoll`, so no knight before it).    | COLR   | ours   | `beginTurn` (also after setup). Works with event cards.              |
| 18.3b | Choosing Rush on the setup screen sets the Colonist Rush defaults: discard limit 9, friendly robber. | COLR   | OK     | UI only (`toggle` in `ui/setup/model.ts`); both can be changed back. |

A short chess clock (Bullet/Blitz) gives the time pressure. Real simultaneous play is a card idea.

### 18.4 Turbo Mode (`settings.turboMode`) — **flagged, our definition**

No source found: not in Colonist's UI strings or blog, no catan.com or forum hit. Our
definition, chosen because it is a well-known speed-up house rule that fits "turbo":
**both setup settlements pay starting resources** (18.4a, `a/setup.ts`), not only the second (2.19).

### 18.5 Turn timer: chess clock (`settings.timer`) — presets are ours

Colonist only has per-turn timers (15 s … 240 s). The chess-clock presets follow the request
(Classic = 20 min bank + 30 s per turn) and scale the chess names down:

| Preset  | Bank per player | Added after each turn |
| ------- | --------------- | --------------------- |
| Bullet  | 3 min           | 5 s                   |
| Blitz   | 5 min           | 10 s                  |
| Rapid   | 10 min          | 15 s                  |
| Classic | 20 min          | 30 s                  |
| Custom  | 1–180 min       | 0–600 s               |

The bank of whoever is on the clock runs (the same slots as the per-turn timer: own turn and
setup placements, discards, trade replies, event choices, special build / second settler steps).
The increment is added when a player's turn, setup placement or build step ends. An empty bank
means the minimum moves are made for that player (as with the per-turn timer) until their next
increment. The engine stores only the settings; the clock maths is pure (`src/engine/clock.ts`)
so a server can enforce it. `settings.turnTimerSec` (per turn) still works and old saves keep it.

### 18.6 Turn order (`settings.seatOrder`, `settings.secondSettler`)

| #     | Rule                                                                                                                                                                                                                     | Source | Status | Where / notes                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 18.6a | **Randomize Turn Order**: the seats are shuffled when the game is created; seat 1 of the new order starts.                                                                                                               | (ours) | ours   | Colonist has "Play Order Selection" instead. Own seeded stream (`order:<seed>`), so the board and deck of a seed do not change. `seatOrder[p]` = config index. |
| 18.6b | **Second Settler Mode** = the paired players' turn: after Catanian 1's turn, Catanian 2 (the **third player to the left**) may trade with the bank, build and play one development card; no roll, no trade with players. | PPT    | OK     | Name from CATAN Universe ("Settler 2"). `turn.secondSettlerOf`; the step is a `main` phase for Catanian 2. Then the next player's turn starts.                 |
| 18.6c | A card bought as Catanian 2 can be played on that player's own later turn (not in the same step).                                                                                                                        | PPT    | OK     | It goes to `newDevCards`, merged when the step ends.                                                                                                           |
| 18.6d | Both players are "taking their turn": Catanian 2 can win in their step; Catanian 1 wins first if both reach the goal.                                                                                                    | PPT    | OK     | `checkVictory` checks the current player (Catanian 2 in the step).                                                                                             |
| 18.6e | Needs 4+ players (with 3, the third to the left is yourself). Replaces the special building phase (16.10).                                                                                                               | PPT    | ours   | `createGame` throws on 3 players or with `specialBuildPhase: true`; with 5+ players SBP defaults off when it is on.                                            |

### 18.7 Map selection (`settings.mapSelection`: `'fixed' | 'random' | 'veto'`)

| #     | Rule                                                                                                                                                                                                                                                   | Source | Status | Where / notes                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 18.7a | Fixed: the map picked on the setup screen (default).                                                                                                                                                                                                   |        | OK     |                                                                                                                                                           |
| 18.7b | Random: a seeded pick among every map that fits the player count.                                                                                                                                                                                      | (COL)  | ours   | Colonist has a "Random" map choice. `randomMapFor` (own stream `map:<seed>`).                                                                             |
| 18.7c | Veto: 3 candidate boards of the picked map are generated (the beginner map votes on random layouts). Players veto one map each, in turn, until one is left; that one is played. Vetoers go counter-clockwise from the seat before the starting player. | (ours) | ours   | Phase `mapVeto`, action `vetoMap`. With 3 maps only two players veto; starting with the players who place last balances the starting player's first pick. |

### 18.8 Setup placement (`settings.setupPlacement`)

Per round (1st and 2nd building): the building (**Settlement** or **City**) and the restriction
(**Distance rule** = official, or **None (any vertex)** = any empty vertex). Colonist has no such
options; C&K places a city as the 2nd building ("On your second initial placement, place a city",
colonist.io/catan-rules/cities-and-knights). Starting resources stay 1 per adjacent hex also for a
city (our reading of C&K). A city placed in setup uses a city piece. Status: ours.

## 19. Map rules / balance rules (V2, `settings.mapRules`)

Which neighbouring land hexes may touch on **randomly generated** maps (`baseRandom`, `base56`,
`base78`, and a random pick or veto of them). The fixed beginner map (`base` with
`mapSelection: 'fixed'`) is the official printed layout and is never changed. All flags have
"allow" polarity, so **off = constrained**, and **the default is all off**. Only `true` flags are
stored in settings (`mapRules` is absent by default, no schema bump). Code: `randomBoard` in
`src/engine/board.ts`, tests `src/engine/mapRules.test.ts`, UI section "Balance rules".

| #    | Rule                                                                                                                                                                                                                                       | Source  | Status | Where / notes                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19.1 | `allowRedTouch` off: no two 6/8 tokens (any mix of 6 and 8, so also 6-6 and 8-8) on adjacent hexes.                                                                                                                                        | R5 p.13 | OK     | The official rule of the alternative token method (2.5). Now switchable.                                                                                                         |
| 19.2 | `allowExtremeTouch` off: no two tokens from {2, 12} (2-12, 2-2, 12-12) on adjacent hexes ("dead corners").                                                                                                                                 | SBF     | OK     | SBF lists "2/12 adjacency" as a balance toggle without defining it; our definition is every pair of low-probability tokens.                                                      |
| 19.3 | `allowSameNumberTouch` off: no two equal tokens on adjacent hexes.                                                                                                                                                                         | SBF     | OK     | Overlaps 19.1/19.2 for 6-6, 8-8, 2-2, 12-12, which stay forbidden while their own rule is off.                                                                                   |
| 19.4 | `allowSameResourceTouch` off: no two adjacent land hexes of the same resource terrain. Deserts are exempt (two deserts may touch); the sea does not count.                                                                                 | (ours)  | ours   | New in V2 (user request); in no source. `sameTerrain` in `board.ts`.                                                                                                             |
| 19.5 | Terrain is placed first, then tokens on the non-desert hexes, each with the seeded game RNG (`Rng`): randomized depth-first search with random order and bounded restarts.                                                                 | (ours)  | ours   | `fill` in `board.ts`: 60 restarts × 4000 nodes per relaxation level. Deterministic per seed.                                                                                     |
| 19.6 | **Relaxation order** if no layout is found in the budget (never seen in tests, 150 seeds per map with all rules on): tokens drop same numbers, then 2 & 12, then everything; terrain drops same resources. Red 6/8 is the last rule to go. | (ours)  | ours   | The last resort is a plain shuffle, so generation always terminates. All four rules together are satisfiable on every map, 7-8P included (checked over 150 seeds per map, test). |
| 19.7 | The fixed beginner board ignores the flags. The setup screen disables the four switches (with a note) while Base is picked with Fixed map selection.                                                                                       | R5 p.3  | OK     | `mapRulesApply` in `ui/setup/model.ts`. A veto or random pick lands on a random layout, so the switches stay on.                                                                 |
| 19.8 | Online: `variants.mapRules` in `RoomConfig` (strict keys, only `true` kept).                                                                                                                                                               | (ours)  | OK     | `parseVariants` in `net/protocol.ts`.                                                                                                                                            |

Seed-dependent consequence: the default boards of random maps changed (2/12, equal numbers and
equal resources now also stay apart, which re-orders the RNG draws). Existing saves keep their
boards. No test or fixture depended on a specific random layout, so none needed an update.

## 20. Optional 5+ player rule set (V2, `settings.rules56`)

Needs 5+ players (any map), the special building phase (the 5+ default; a `false` is refused) and
no Second Settler. Source **SBF**, cross-checked against **E56** (2020 printing, read as text from
the pdf), **PPT** (2021) and **FAQ56**. Tests: `src/engine/actions/rules56.test.ts`,
`src/ui/setup/setup.test.ts`, `src/bots/variants.test.ts`.

| #    | Rule                                                                                                                                                                                                                              | Source       | Status | Where / notes                                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20.1 | In the special build step the builder may **play one development card** (Knight, Road Building, Year of Plenty, Monopoly). Still no trading with players, no bank/harbor trade, no roll.                                          | SBF; PPT p.2 | OK     | `canPlay` in `a/dev.ts`. SBF and PPT (Catanian 2 may play one) allow it; **E56 p.3 forbids it** ("you may not play a development card during the special build phase"). That is why it is optional. Not a base rule.                                    |
| 20.2 | One card per step (`turn.devCardPlayed`, reset for each builder). A Knight or Road Building goes through the usual interrupt phases (`moveRobber`/`steal`/`roadBuilding`) and **returns to the step** (`resume: 'specialBuild'`). | PPT; FAQ     | OK     | `resumePhase` in `a/common.ts`; `turn.specialOwner` keeps the owner while the step is interrupted.                                                                                                                                                      |
| 20.3 | **Buying dev cards stays allowed** in the step. SBF is silent; E56 p.3 and PPT allow buying. A card bought in the step cannot be played in it (FAQ rule: not in the turn it is bought) but is playable on the buyer's own turn.   | E56 p.3; PPT | OK     | With the rule set the card goes to `newDevCards` and merges when the step ends (`advanceSpecialBuild`); without it, as before (16.10c), straight to `devCards`.                                                                                         |
| 20.4 | A player whose only option is a playable card is not skipped (16.10h extended).                                                                                                                                                   | (ours)       | ours   | `canSpecialBuild` in `a/turn.ts`.                                                                                                                                                                                                                       |
| 20.5 | Nobody wins in the step, also not by a Knight taking Largest Army or by Road Building taking Longest Road there. The builder wins when their own turn starts (16.10g).                                                            | FAQ56        | OK     | `checkVictory` skips while `turn.specialOwner` is set.                                                                                                                                                                                                  |
| 20.6 | The robber starts on the **first desert** and may **never be moved onto the second desert** (it may return to the first). "First" = first desert hex in `landHexes` order: rows top to bottom, left to right.                     | SBF          | OK     | `firstDesert` / `robberTargets` in `variants.ts`, `randomBoard(.., firstDesertOnly)`. E56 p.3 says "any one of the desert hexes" for the start, so the official start is random; SBF's "first desert" is ours to define, hence this deterministic rule. |
| 20.7 | The friendly robber's fallback ("to the desert", 18.1d) uses the first desert only. Robber Flees (18.2k) already returns to the first desert.                                                                                     | (ours)       | ours   |                                                                                                                                                                                                                                                         |
| 20.8 | **Suggested 12 VP**: enabling the rule set on the setup screen moves the slider from the default 10 to 12; any other value the player picked stays, and switching off undoes only that preset. Not an engine rule.                | SBF (house)  | ours   | `toggle` in `ui/setup/model.ts`. SBF: the official target stays 10; "some house rules use 12".                                                                                                                                                          |
| 20.9 | Online: `variants.rules56` in `RoomConfig`; refused below 5 seats or together with Second Settler.                                                                                                                                | (ours)       | OK     | `parseRoomConfig`.                                                                                                                                                                                                                                      |

### 20.A Contradictions in SBF and how they were resolved

| SBF says                                                                                        | Decision                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Red 6/8 adjacency "still applies" **and** is "disabled by default" in the balance section.      | Read as: the official rule (no touching red numbers) is what the toggle's default enforces. `allowRedTouch` is off by default = constrained (19.1).                                                                      |
| Adds "24 resource cards" but "4 of each resource" (= 20).                                       | E56 p.2 (components): **25** cards, 5 of each resource, so the bank is 19 + 5 = **24 per resource**. Matches ours (`bankPerResource: 24`).                                                                               |
| Dev cards: "4 extra Knights" and a "second extra Knight"; "identical to the base game" vs "+9". | E56 p.2: 9 cards = **6 Knights, 1 Monopoly, 1 Year of Plenty, 1 Road Building** (deck 34: 20/5/3/3/3). Matches ours. "Identical" is read as "same card types in a bigger deck".                                          |
| 11 harbours = **6 generic 3:1 + 5 specific 2:1**.                                               | E56 p.2: the frame pieces add **one generic 3:1 and one wool 2:1** to the base 9 (4 generic + 5 specific). So 11 = **5 generic + 6 specific** (wool twice). **SBF is wrong; ours is unchanged** (`MAPS.base56.harbors`). |
| Robber cannot go on the second desert after setup, but unclear for the first.                   | The first desert is allowed (20.6).                                                                                                                                                                                      |
| Build phase may play a dev card.                                                                | Contradicts E56 p.3, agrees with PPT; implemented as an optional rule (20.1).                                                                                                                                            |
| Skipping the build phase is not allowed.                                                        | Unchanged: players who can do nothing are skipped (16.10h, our deviation, no information is hidden that a hand count does not show).                                                                                     |

Component audit of `base56` against E56 pp.1–2 (all OK, nothing changed): 30 hexes (6 forest, 6
pasture, 6 fields, 5 hills, 5 mountains, 2 deserts), 28 tokens (two each of 2 and 12, three each
of 3–6 and 8–11, so three 6s and three 8s), 11 harbours, bank 24 per resource, dev deck 34. The
tokens are not placed in E56's lettered spiral but randomly (map rules, §19).
