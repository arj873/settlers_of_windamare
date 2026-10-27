# Scenarios (Oil Springs, Crop Trust) and the Official Combination Matrix

Rules research for the engine/framework agents. Written in our own words from the official
rulebooks (read in full where noted). Nothing here is implemented yet.

**Target editions**

- **Oil Springs**: the only edition is the 2011 Mayfair/Catan GmbH scenario (written against the
  4th/5th-edition base game and its 5-6 extension). Target = that text.
- **Crop Trust**: the only edition is the 2018 Catan Studio scenario. Target = that text.
- **Combination matrix**: target the **2025 official combination PDFs on catan.com** (6th-edition era).
  They are the only official documents that spell out combination rule changes. Where an older
  (5th-edition) rule differs it is listed under "Edition notes".

**How sure am I?** Each section ends with a confidence tag. `[RB]` = read the official rulebook PDF
text. `[IMG]` = read from a diagram image in the rulebook (re-verify against the image).
`[WEB]` = from catan.com product page text only. `[INF]` = my inference, flagged.

**Sources (used throughout)**

- S1. Catan: Oil Springs rulebook, 4 pp, https://tesera.ru/images/items/74859/Catan-OilSprings-Scenario.pdf
  (mirror of the Mayfair/Catan GmbH PDF; free originals were hosted at oilsprings.catan.com). `[RB]`
- S2. Catan Scenario: Crop Trust rules + almanac, https://www.catan.com/sites/default/files/2021-06/catan-crop_trust_rulesalmanaceng_180705xs.pdf `[RB]`
- S3. catan.com Oil Springs page, https://www.catan.com/oil-springs `[WEB]`
- S4. catan.com Crop Trust page, https://www.catan.com/crop-trust `[WEB]`
- S5. catan.com Cities & Knights page (Seafarers/T&B/E&P combination text and PDFs), https://www.catan.com/game/catan-cities-knights-expansion `[WEB]`
- S6. catan.com Seafarers page, https://www.catan.com/game/catan-seafarers-expansion `[WEB]`
- S7. catan.com Explorers & Pirates page, https://www.catan.com/game/catan-explorers-pirates-expansion `[WEB]`
- S8. catan.com Traders & Barbarians page, https://www.catan.com/game/catan-traders-barbarians-expansion `[WEB]`
- S9. Official combination PDFs (all `[RB]`), base `https://www.catan.com/sites/default/files/`:
  - `2025-08/ExplorersPirates%20w%20CnK.pdf` (E&P + C&K)
  - `2025-08/ExplorersPirates%20w%20TnB.pdf` (E&P + T&B)
  - `2025-07/TradersnBarbarians%20w%20CnK.pdf`, `2025-07/Barbarian%20Attack%20w%20CnK.pdf`,
    `2025-07/CATAN%20for%202%20w%20CnK.pdf`, `2025-08/Fishing%20on%20Catan%20w%20CnK.pdf`,
    `2025-07/Merchant%20Trains%20w%20C%26K.pdf`, `2025-07/Rivers%20of%20Catan%20w%20CnK.pdf` (T&B + C&K)
  - `2025-07/TradersBarbarians%20w%20SEA.pdf`, `2025-07/Barbarian%20Attack%20w%20SEA.pdf`,
    `2025-08/Merchant%20Trains%20w%20SEA_21.07.25.pdf`, `2025-07/Fishing%20on%20Catan%20w%20SEA.pdf`,
    `2025-07/Rivers%20of%20Catan%20w%20SEA.pdf` (T&B + Seafarers; bodies are mostly board diagrams)

---

# PART A: CATAN: OIL SPRINGS

Sources: S1 (all of Part A), S3. 3-4 players with the base game; 5-6 players with the base 5-6
extension (S3 confirms).

## A1. Overview and components

Everything from the base game, plus (S1 p1):

| Component                                  | 3-4 players                           | 5-6 players | Box total |
| ------------------------------------------ | ------------------------------------- | ----------- | --------- |
| Oil tokens (back side = "sequestered oil") | 15                                    | 21          | 21        |
| Metropolis tokens                          | 4                                     | 6           | 6         |
| Oil Spring tiles                           | 3                                     | 4           | 4         |
| Champion of the Environment token          | 1                                     | 1           | 1         |
| Victory Point tokens                       | 7 (only 5 can ever be earned, see A6) | 7           | 7         |
| Disaster Track (+ marker)                  | 1                                     | 1           | 1         |

- The Disaster Track has a marker lane 0..5 and a set of **open circles** that receive destroyed
  number tokens. 3-4 players: the game ends when the 5th token is destroyed; 5-6 players: 8th.
  `[INF]` The track therefore needs 5 (3-4p) / 8 (5-6p) circle slots. The text says "if all spaces
  on the track are filled, the game ends" and "8 number tokens destroyed (not 5)". I read these as
  the same thing.
- Oil Spring tile types: desert-backed (numbered tile, replaces the desert) and
  forest/pasture-backed (unnumbered tiles, laid on top of an existing forest/pasture hex, which keeps
  its own number token). `[RB/IMG]`
- Oil is **not** a resource card. It is held face-up in front of the player, always visible.
- Win target is **12 VP** (not 10).

Confidence: `[RB]`.

## A2. Setup

### A2.1 3-4 players, fixed ("first game") layout `[IMG]`

19 hexes, rows top to bottom, tiles left to right. Format: `terrain number` ; `*` = Oil Spring.
Everything is the normal base-game frame (sea ring + 9 harbors); the PDF diagram does not let me
read exact harbor positions, so **use the engine's default harbor layout** `[INF]`.

```
Row 1 (3):  pasture 11 | pasture 12 | fields 9
Row 2 (4):  hills 4    | mountains 6 | hills 5   | pasture 10 *
Row 3 (5):  desert 5 * | forest 3    | fields 11  | forest 4    | fields 8
Row 4 (4):  hills 8    | pasture 10  | forest 9 * | mountains 3
Row 5 (3):  mountains 5| fields 2    | forest 6
```

Check: forest 4, pasture 4, fields 4, hills 3, mountains 3, desert 1 = 19. 3 Oil Springs.
The desert Oil Spring tile carries its **own printed number 5**; it is the only numbered tile.
The forest 9 and pasture 10 oil tiles keep their hex's number token (variable setup says
"keep the hex's production number token"; fixed setup behaves the same). So the number token
multiset on 19 hexes is the standard 18 plus an extra 5 (three 5s total).
Robber starts **off board** (not on the desert). Disaster marker on 0.
Starting settlements/roads: normal base-game snake placement by players (no fixed starting
positions in this scenario). Starting resources: see A10 Q1.

### A2.2 3-4 players, variable setup `[RB]`

1. Lay out the board with the base-game variable setup (random terrain, spiral number tokens).
   The robber starts off board.
2. Numbered Oil Spring tile onto the desert. If possible the desert's number must not be a
   number of a hex adjacent to the desert. `[INF]` meaning: pick (among the numbers available on
   the numbered tile) one not already on any neighbor; the tile is a "numbered" tile, so the
   rulebook intends you to choose its number. The rulebook's wording is thin; the tile has one
   fixed printed number in the fixed layout, so the engine can pick any number token value
   (not 7) not present on adjacent hexes.
3. Unnumbered Oil Spring tile (pasture-art) onto the **2nd-highest-probability pasture hex**
   (keep its token). Ties: choose one not adjacent to another oil spring; swap number tokens if
   needed so no two oil springs are adjacent.
4. Unnumbered Oil Spring tile (forest-art) onto the **2nd-lowest-probability forest hex**.
   Probability order low to high: 2/12 (1/36), 3/11 (2/36), 4/10 (3/36), 5/9 (4/36), 6/8 (5/36).
5. Rulebook warns variable setup "can lead to a very volatile game". Default to the fixed layout.

### A2.3 5-6 players, fixed layout `[IMG]` (terrain NOT visible)

30 hexes, rows (3,4,5,6,5,4,3), numbers only (diagram prints terrain in white):

```
Row 1 (3): 4   | 5    | 2
Row 2 (4): 6   | 11   | 10   | 8
Row 3 (5): 3   | 12   | 9 [desert, OIL] | 12 | 4 [pasture, OIL]
Row 4 (6): 9   | 10 [forest, OIL] | 3 | 6 | 9 | 8
Row 5 (5): 8   | 5    | 2    | 5    | 3
Row 6 (4): 11  | 4    | 9    | 6
Row 7 (3): 11  | 5 [desert, OIL] | 10
```

- Terrain comes from the base 5-6 extension's own fixed layout, with exactly these changes (S1 p3):
  second desert becomes an Oil Spring (numbered tile); the tile in the left "10" position
  becomes a forest and gets an oil spring; the tile in the right "4" position becomes a pasture and
  gets an oil spring. Four oil springs total: 2 desert (9 and 5), forest 10, pasture 4.
- **Uncertainty:** the 5-6 base fixed terrain assignment is not in this PDF. The fixed 5-6 board
  would have to be sourced from the 5-6 rulebook. Recommendation: build the 5-6 board from the
  number layout above plus a legal terrain assignment (5-6 hex mix: 2 desert, 6 forest, 6 pasture,
  6 fields, 5 hills, 5 mountains = 30) with forest/pasture forced at the two oil positions;
  mark it `variable-terrain` in data.
- A stray extra "3" token is drawn outside the board in the diagram; ignore (spare).
- Maximum oil held = **6** (not 4). End condition = **8** destroyed number tokens (not 5).
- Special Building Phase restrictions: see A3.8.

### A2.4 5-6 variable setup

Variable setup from the 5-6 extension, then follow the 3-4 oil steps (A2.2); the only change is
that the **second desert also gets an Oil Spring** (numbered). `[RB]`

## A3. Turn structure and changes vs. base game

Base-game turn order stands; the changes are:

1. **Roll / production.** Resource hexes pay normally. Hexes with an Oil Spring tile pay **oil**
   instead of the underlying resource:
   settlement 1 oil, city 2 oil, metropolis 3 oil. `[RB]`
   - Oil is handed out **one at a time**, starting with the player who rolled, then clockwise,
     repeating, until everyone has all their production or the oil supply runs out.
   - Per-player cap: **4 oil (6 in 5-6)**. Excess production is simply lost (you may not take it).
   - An oil-spring hex with the robber on it does not produce.
   - Oil Spring on pasture/forest: the tile replaces the hex's production entirely (it produces oil,
     not sheep/lumber). `[INF]` The rulebook says "buildings on oil springs produce oil" and never
     mentions the underlying resource again; "numbered Oil Spring tiles" for desert is clearly an
     oil-only hex; the forest/pasture oil tile art shows an oil rig and the underlying hex is
     replaced. Follow that.
2. **7 rolled.** Normal discard rule: oil counts as one card each toward the "more than 7" limit.
   A discarding player may discard oil; discarded oil returns to the supply (this is **not**
   "using" oil, so no pollution). The robber may be moved onto an oil spring hex (it blocks it) but
   never onto a destroyed hex (A4.5).
3. **Stealing.** The robbing player may choose to take **1 oil specifically** instead of a random
   resource card (oil is visible, so the thief picks it deliberately), as long as the thief's oil
   stays under the cap. If the thief picks an unaffordable oil, it is not allowed.
4. **Trade phase.**
   - Maritime trade (4:1, harbors) can **never give you oil** (you may trade resources away for
     other resources as normal; oil as the _input_ of a maritime trade is not allowed either: oil is
     not a resource card. `[INF]`).
   - **Domestic trade can include oil** (the rulebook only restricts it where it would push
     the receiver over the cap). `[RB]` implied by "you may not ... trade with other players for
     oil ... if it would result in holding more than 4 oil".
5. **Build/oil actions (your turn, any order, interleaved with build/trade).**
   - _Convert oil:_ spend 1 oil (return to supply): take 2 resource cards of one chosen
     non-oil type from the bank. Repeatable.
   - _Build metropolis:_ pay 1 brick + 1 grain + 1 ore + **2 oil** (returned to supply):
     place a Metropolis token under one of your cities. See A4.2.
   - _Sequester oil:_ see A4.3 (once per turn, exclusive with using oil).
   - Each oil **used** (convert or metropolis) moves the Disaster marker +1.
   - **Limit:** you may not use oil in a way that moves the marker beyond 5 (A4.4).
6. **Development cards.** Year of Plenty may take oil from the bank; Monopoly may name oil
   (A7). Cap rules apply.
7. **End of turn: Disaster Phase** (only if the marker reached 5). Resolved after the player has
   completely finished the turn and **before** the dice pass on (A4.5). After resolving, marker
   resets to 0.
8. **5-6 players: Special Building Phase (SBP)** follows the end of turn (and the Disaster Phase,
   if one occurred). SBP rules per the 5-6 extension (the player whose turn just ended may not
   build), plus: oil cannot be converted, oil cannot be sequestered; oil may be used **only**
   to build metropolises, and only if the marker does not go beyond 5. A disaster triggered in the
   SBP is resolved immediately after the SBP completes. `[RB]`
9. **Victory check.** The active player wins if, at the **end of their turn** (after the Disaster
   Phase), they have >= 12 VP.

Confidence: `[RB]`.

## A4. New actions, pieces, costs, timing, edge cases

### A4.1 Oil token

- Per-player visible stock. Cap 4 (6 in 5-6): you cannot gain oil by production, stealing, player
  trade, Year of Plenty or Monopoly beyond the cap (excess simply not taken).
- Supply is finite: 15 (3-4p) / 21 (5-6p). Sequestered oil (flipped) and oil removed by disasters
  leave the supply permanently. Oil used for conversion/metropolis and discarded oil go back to
  the supply.

### A4.2 Metropolis

- Cost: **1 brick, 1 grain, 1 ore, 2 oil**. Applies to one of **your own cities** (a settlement
  must first be upgraded to a city); the Metropolis token is placed under the city.
- Effect: produces **3** resources (or 3 oil on an oil spring) instead of 2; worth **3 VP total**
  (the city's 2 VP are replaced, so net +1 VP vs. the city); **immune to coastal flooding** (A4.5).
- Supply limit: 4 tokens (3-4p) / 6 tokens (5-6p) total, shared by all players. Once exhausted no
  more metropolises can be built.
- Counts as using 2 oil (moves the marker by 2). Not allowed if the marker would exceed 5.
- Metropolises cannot be reverted, destroyed or downgraded by disasters.

### A4.3 Sequestering

- On your turn, instead of using that oil, you may flip **one** oil from your stock upside down in
  front of you ("sequestered"). It never returns to the supply.
- **Max 1 per turn**, and (default rules) **not on a turn when you have already used oil**
  (example in S1: after using 2 oil Patricia "can't sequester oil during this turn").
  Equivalently: use-oil and sequester are mutually exclusive each turn. Their "Wide Open Game"
  variant lifts the exclusivity (and also removes the 4-oil cap, and recommends variable setup).
- Not allowed in the SBP.
- Scoring: every **3** sequestered oil = **1 VP** (a VP token). The **Champion of the Environment**
  token (1 VP) goes to the first player to reach 3 sequestered; another player takes it the moment
  they sequester **strictly more** than the current Champion. `[RB]` ("more oil than").
- Sequestered oil is not "used": it does not move the marker.

### A4.4 Pollution and the Disaster Track

- Marker starts at 0. Each oil _used_ (converted or put into a metropolis) = +1. Oil discarded for
  a 7, returned by the robber's theft, or sequestered does **not** count. (Theft: S1 says "(but not
  those ... returned to the bank because of the robber)", i.e. oil discarded under a 7.)
- When the marker is at 5, a disaster is "triggered" and is resolved at end of turn.
- **Hard cap within a turn:** you can only use oil while it keeps the marker at or below 5.
  Marker 4 -> only 1 more oil usable this turn; marker 1 -> up to 4 oil. A metropolis (2 oil) at
  marker 4 is illegal. After reaching 5 no further oil may be used that turn.
- Marker carries over between turns and between players (shared).

### A4.5 Disaster Phase (when marker = 5, at the end of the active player's turn)

Roll both dice (nothing is "rolled for production"):

- **7: Coastal flooding.** Every **settlement** that touches a sea hex is removed from the board and
  returned to its owner's supply. Every **city** on a coast is **reduced to a settlement**.
  Roads unaffected. Metropolises are immune. "Settlements bordering a sea hex" = any building
  on an intersection touching at least one sea/frame hex (i.e. coastal vertex). Destroyed
  settlements may be rebuilt later (even by others, if the site is free and distance rule holds).
- **Any other number:** pollution strikes a hex carrying that number. If several hexes share it,
  pick one at random (die method below). If no hex still carries that number, nothing happens.
  - Hex **without** an oil spring: remove its number token; the hex never produces again.
    Place the token in an open circle on the Disaster Track. (If it was the Nth, the game ends.)
  - Hex **with** an oil spring: remove **3 oil from the general supply** permanently. The tile and
    its number stay; oil-spring hexes can be hit repeatedly.
  - If fewer than 3 oil remain in the general supply and the rest is in player hands: players
    discard one oil at a time, starting with the player who caused the disaster and going
    clockwise, until the 3 are accounted for. (S1 p2 note; exact interplay with supply shortfall is
    ambiguous, see A10 Q4.)
- "Randomly choose" die method (S1 p2): for 2 hexes, die 1-3 = first, 4-6 = second; for 3 hexes,
  1-2/3-4/5-6; for 4 hexes assign 1-4 and re-roll 5 or 6. (More than 4 matching hexes cannot occur
  in the fixed boards; max 2 per number, and the numbered desert tile adds a third bearer for some
  numbers: engine should generalize to uniform choice using the seeded RNG.)
- After the Disaster Phase the marker is reset to 0.
- Hexes whose token was removed are **destroyed** ("destroyed hex"): they produce nothing and the
  robber may **not** be placed on them.

### A4.6 Robbing and oil

Covered in A3 steps 2 and 3. Robber on a oil spring hex stops oil production there.

## A5. Victory conditions and scoring

VP sources: settlement 1, city 2, **metropolis 3**, Longest Road 2, Largest Army 2, VP dev cards 1
each, **VP token 1 per 3 sequestered oil**, **Champion token 1**.

End conditions (S1 p3):

1. First player with **>= 12 VP at the end of their own turn, including resolution of the Disaster
   Phase**, wins. (S1 example: a player reaches 12 through a metropolis, the oil used triggers
   a disaster, a 7 floods the coast, they drop to 10, the game continues.)
2. **Ruin ending:** when the **5th** (3-4p) / **8th** (5-6p) number token is removed, the island
   floods and everyone leaves. No normal winner. The holder of the Champion of the Environment
   token achieves a **"Pyrrhic Victory"** (shown as winner, flavor text: recognized and resettled).
   If no one holds the token, nobody wins (I recommend reporting "no winner").

Max supply-bound VP from sequestering: 3-4p 15 oil -> max 5 VP tokens; 5-6p 21 oil -> 7 VP tokens.
(The 7 VP tokens in the box match the 21 oil.)

## A6. Edge cases and rulings (numbered)

1. Oil may be stolen only by deliberate choice of the robbing player; otherwise the robber steals a
   random _resource card_ (oil is not in the random pool). `[RB]`
2. A player at cap cannot take oil by theft, trade, Year of Plenty, or Monopoly (partial amounts up
   to the cap are fine for Monopoly; see item 5). `[RB]`
3. Maritime 4:1 / harbor trades can never yield oil. Year of Plenty and Monopoly can. `[RB]`
4. Monopoly on oil: take **one oil at a time, starting with the next player to play (clockwise)**,
   going round until your cap is reached or no one has any left. `[RB]`
5. The robber cannot be placed on a destroyed hex; it can be placed on an oil spring (and on a
   hex that later gets destroyed: not specified, see A10 Q8). `[RB]`
6. Destroyed settlements can be rebuilt "at their previous locations or elsewhere" and other players
   may build there if legal. `[RB]`
7. A disaster triggered by the first player's building in the SBP waits until the SBP completes. `[RB]`
8. During the SBP only metropolis building uses oil. `[RB]`
9. Oil discarded for a 7 is not "used"; no pollution. `[RB]`
10. Metropolis token count is a hard shared cap; no metropolis if none left. `[INF]`
11. If a number token already left the board (destroyed hex), a disaster roll of that number does
    nothing. `[RB]`
12. The Champion token is 1 VP and transfers only on a strict increase. `[RB]`

## A7. Interactions with base rules

| Base rule                       | Change                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Win target 10 VP                | 12 VP, checked at end of own turn after the Disaster Phase                                             |
| Resource production             | oil-spring hexes pay oil, round-robin starting with the roller, cap per player                         |
| 7 / discard                     | oil counts as 1 card; oil may be discarded to the supply                                               |
| Robber                          | starts off board; cannot enter destroyed hexes; may block oil springs; theft may target oil            |
| Domestic trade                  | oil tradable (cap-limited); maritime never gives oil                                                   |
| Dev cards                       | Year of Plenty may take oil; Monopoly may take oil (cap, clockwise order)                              |
| Cities                          | may become metropolises (extra tier); metropolis token pool is finite                                  |
| Settlements/cities on the coast | exposed to flooding on a disaster 7                                                                    |
| Longest Road                    | roads never flooded, but removing a coastal settlement can reconnect or cut routes: recompute (A10 Q3) |
| Largest Army                    | unchanged                                                                                              |
| 5-6 SBP                         | oil restrictions described in A3 step 8                                                                |

## A8. Combinations

- **Official:** 5-6 extension only (S1 p3, S3). Needs base + base 5-6 + this scenario.
- No official statement exists about combining with Seafarers, C&K, T&B or E&P, or with Crop
  Trust (S3 mentions only the 5-6 extension). Oil Springs fundamentally changes the sea/coast
  semantic (flooding) and robber start. Treat as **unsupported**; see Part C for the matrix and
  recommended engine behavior.

---

# PART B: CATAN SCENARIO: CROP TRUST

Sources: S2 (all of Part B), S4. 3-4 players, base game only.

## B1. Overview and components

Semi-cooperative: players harvest crops from fields for food (grain) but must also store crops in
a seed vault; the game can end by crop collapse. Grain cards are called **food cards** (same
card, same trading). 10 VP target, plus two crop-collapse endings.

| Component                               | Count | Notes                                                                                                                  |
| --------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| Fields hex (watermarked seed-vial icon) | 1     | **replaces the desert**: board has 5 fields hexes, no desert (4 + this one)                                            |
| Number token "9"                        | 1     | third 9 (matches 19 hexes with no desert)                                                                              |
| Crop tokens                             | 90    | 5 species (beans, maize, quinoa, rice, wheat); front = crop, back = seed-vial. **18 each** `[INF]` (90/5; not printed) |
| Event tokens                            | 41    | 4 categories (see B4.3). Face-down side = seed-vial. **Per-category counts not printed in the sources I could reach**  |
| Seed vault display                      | 1     | one 2-space storage area per player colour (red/white/orange/blue)                                                     |
| Crop Storage Record                     | 4     | one per player; 2 rows x 5 spaces; also lists build costs                                                              |
| Rulebook + almanac                      | 1     |                                                                                                                        |

Per player at setup: 4 crop tokens of an assigned species sit on one of their two vault spaces;
the player keeps 7 face-down event tokens under their unbuilt pieces (3 settlements + 4 cities).
Players: 3-4 only; 3-player: set one colour aside. No 5-6 rules exist (S4).

## B2. Setup

### B2.1 First game ("fixed") layout `[IMG]`

Row by row, left to right. Standard base frame; **desert replaced by extra fields hex**.

```
Row 1 (3): hills 8     | forest 10   | pasture 2  [ROBBER starts here]
Row 2 (4): forest 11   | fields 9    | mountains 8 | fields 3
Row 3 (5): pasture 9   | mountains 5 | pasture 12  | pasture 5 | forest 6
Row 4 (4): fields 10 (the EXTRA fields hex) | hills 3 | fields 6 | hills 11
Row 5 (3): mountains 4 | forest 9    | fields 4
```

Check: hills 3, forest 4, pasture 4, mountains 3, fields 5 = 19; numbers are 2,3,3,4,4,5,5,6,6,
8,8,9,9,**9**,10,10,11,11,12 (three 9s). Harbors: standard 9-harbor frame (positions not
legible in my images, use engine default `[INF]`).
Robber starts on the **pasture hex marked 2** (not off-board, no desert).

Starting settlements (diagram stars mark each player's _second_ settlement = starting resources)
`[IMG]`, described by the 3 hexes around each:

- Red: S1 {hills 8, forest 11, fields 9} (second, gets starting resources), S2 {forest 11, pasture 9, mountains 5}.
- Blue: S1 {forest 10, fields 9, mountains 8}, S2 {pasture 5, fields 6, hills 11} (second).
- Orange: S1 {mountains 8, pasture 12, pasture 5}, S2 {hills 3, fields 6, forest 9} (second).
- White: S1 {fields 3, pasture 5, forest 6}, S2 {fields 10, hills 3, mountains 4} (second).
  Each start road is one adjacent road (edges not read exactly: let the data pick any legal edge).
  Player colours -> crop species for the vault (first game): **Red rice, White beans, Orange maize,
  Blue quinoa**. (Wheat is not seeded in any vault.) 3-player: the unused colour's species/space is
  simply not used `[INF]`.

Crop tokens on fields hexes (first game): the diagram shows the same pattern as the variable
rule below (fields 9 about 4 tokens, fields 3 about 2, fields 10 about 3, fields 6 about 5,
fields 4 about 3); exact species not legible. Use the variable-setup distribution (B2.2) and fix
species per the formula.

### B2.2 Variable setup `[RB]`

Shuffle terrain (the extra fields hex replaces the desert), place number tokens in the printed
spiral (diagram below), place crops on every fields hex **by its number**:

- 2 or 12: 1 quinoa
- 3 or 11: 1 quinoa + 1 maize
- 4 or 10: 1 quinoa + 1 maize + 1 wheat
- 5 or 9: 1 quinoa + 1 maize + 1 wheat + 1 beans
- 6 or 8: 1 of each of the five species (rice included)

Number layout for the variable setup `[IMG]` (the **first-game** number layout differs only in
row 3, col 4 (5 vs 9)):

```
Row 1: 8  10  2
Row 2: 11  9  8  3
Row 3: 9  5  12  9  6
Row 4: 10  3  6  11
Row 5: 4  5  4
```

Vault seeding in the variable setup: the starting player places 4 rice, then clockwise players
take 4 beans, 4 wheat, 4 maize (this differs from the fixed Red/White/Orange/Blue species).

### B2.3 Common setup steps

1. One Crop Storage Record per player; supply of remaining crop tokens beside the board.
2. Each player gets starting resources from their **second** settlement (standard).
3. Shuffle all 41 event tokens face down. Each player takes 7 and places one under each of their
   3 un-built settlement pieces and 4 un-built city pieces (they hold 5 settlements, 2 on the board).
   One more token goes face-down on Longest Road and one on Largest Army. Rest = draw stack.
   (4p: 28 + 2 = 30 used, 11 in the stack; 3p: 21 + 2 = 23 used, 18 in the stack.)

## B3. Turn structure and changes

Base turn with these modifications (S2 pp4-7).

1. **Roll.** On a number matching a fields hex, run **harvest rounds** (B4.1) instead of paying
   grain. Other hexes pay normally. 7: normal (robber).
2. **Trade.** Grain = "food". Normal trading.
3. **Build.** Build as normal. **Each settlement/city built reveals its event token** (B4.3).
   Taking Longest Road / Largest Army (first award or transfer) also reveals the token on the card.
4. **Seed deposit (once per turn, any time in your action phase):** B4.2.
5. **End check.** End conditions B5 evaluated after each event and each harvest.

Robber: blocks harvest on its fields hex as normal (the owner of the building cannot harvest
there on a matching roll), but **does not stop seed deposits** from that hex (S2 p4).

## B4. New mechanics (exact)

### B4.1 Harvesting

- Applies only to **fields hexes** (a fields hex "produces food").
- On a roll matching a fields hex, in **player order starting with the roller** (if the roller has
  no building there, start with the next entitled player clockwise): each entitled player in
  turn decides whether to remove **1 crop token of their choice** from the hex (return to supply)
  and take **1 food card**. They may also decline (take nothing).
- A **city** gets a second harvest round (can remove a 2nd token, take a 2nd food). There are
  therefore at most 2 harvest rounds.
- **Crop shortage:** if the hex lacks tokens for everyone, harvesting simply stops when the hex
  empties; later entitled players get nothing. A hex with no tokens never yields food.
- Removing the last token of a hex may trigger end condition 2/3 (B5).

### B4.2 Seed deposit (once per turn, at most)

Costs and sequence (S2 pp4-5); all four steps are mandatory once you start:

1. **Pay** 1 lumber + 1 ore to the supply.
2. **Record:** take 1 crop token (your choice of species) from a fields hex adjacent to one of
   your settlements/cities (only species present on such a hex are allowed). Place it on an
   unoccupied space of your Crop Storage Record: first token on the green-framed space of the
   upper row, then the next spaces in arrow order. Rules:
   - Max **1 token per species per row**; a species already in the upper row may go in the second row;
     a species already in both rows can't be stored again (and thus can't be deposited).
   - No reward for the 1st token in a row; the **2nd token in a row = 1 free development card**;
     the **3rd, 4th, 5th tokens in a row = 1 VP each** (so up to 3 VP per row, 6 VP total; 2 dev
     cards total).
   - _Row choice:_ the player aid summary says "your choice: top row or bottom row"; the long text
     says upper row first and the second row only if the species is already on the upper row. See
     A10/B7 Q2 (I recommend: free choice of row, subject to the 1-per-species-per-row rule).
3. **Vault:** take 4 tokens of the _same species_ you just recorded from the supply and put them on
   your empty vault space.
4. **Replant:** take the 4 tokens from your _other_ vault space (the previous deposit, or the
   starting seed at the beginning) and place them on **4 different fields hexes**: no adjacency
   requirement, a hex may hold at most **7** tokens (not placeable on a full hex); extra tokens
   that cannot be placed return to the supply. Species can repeat on a hex.
   If the supply has fewer than 4 of the species, vault whatever remains.
   Result: your vault always holds the 4 tokens of your most recent deposit's species.

### B4.3 Event tokens ("Effects of Growth")

Tokens are revealed when:

- you **build a settlement or city**: reveal the token under _that_ piece (the piece you place);
- you gain **Longest Road or Largest Army** (first time or by transfer): reveal the token on that
  card. After the event, take a new token from the stack and put it under the **settlement piece
  you returned to your supply when upgrading to a city**; (for a transferred special card: the new
  owner puts a fresh token on the card).
- Used tokens: shuffled into a new stack when the stack runs out. `[INF]` that used tokens
  go to a discard pile first (the rulebook says "shuffle them" after the stack is exhausted).

Four event categories (S2 pp6, 11):

1. **Regional crop loss:** token shows a species + one or more numbers. Remove **all** tokens of
   that species from the fields hexes bearing those numbers.
2. **Small-scale crop loss:** remove **2** tokens of the shown species from the board. Remove from
   fields hexes adjacent to _your_ settlements/cities first; if fewer than 2 are there, take the
   remainder from other fields hexes.
3. **Large-scale crop loss:** same as small but **3** tokens.
4. **Monoculture:** every fields hex that contains only **one species** (of any species, and any count
   > = 1) loses **all** its tokens.

- **Extinction:** a species with 0 tokens on the board **and** none in any vault is extinct;
  return all of its remaining supply tokens to the box (tokens on Crop Storage Records stay).
  Extinct species cannot be planted, harvested or stored. If you reveal an event token for an
  extinct species: return it to the box and draw another.
- The revealed token's text is read aloud and resolved immediately by the revealing player.

### B4.4 Costs table

| Action                | Cost             | Reward                                                                                       |
| --------------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| Seed deposit step 1   | 1 lumber + 1 ore | records the crop; free dev card on 2nd token per row; 1 VP on each 3rd/4th/5th token per row |
| Harvest               | none             | 1 food per removed crop token (1 per settlement, up to 2 for a city)                         |
| Settlement/city build | normal cost      | reveals 1 event token                                                                        |

## B5. Victory conditions and scoring

VP target **10**. The game ends as soon as one of these happens:

1. A player has **10 VP on their own turn** -> that player wins (checked at the end of their action).
   Even if they just built, they must still reveal the event token first; if the token ends the game
   per 2 or 3, those endings take precedence (but see the build-phase exception below).
2. **3 of the 5 fields hexes contain no crop tokens.**
3. **2 of the 5 species are extinct.**
   Endings 2/3: the winner is the player with the **most crop tokens on their Crop Storage Record**;
   ties: most VP; still tied: tied players share the win.
   Exceptions (S2 p7):

- If the player who **removed a crop during the production phase (harvest)** causes ending 2 or 3,
  they **lose**, even if they have the most stored tokens; the player with the second-most wins.
- If a player hits 10 VP on their **build phase**, then reveals an event token that causes ending 2 or 3,
  they can still win if they hold the most stored tokens.

VP sources: standard + 1 VP for each 3rd/4th/5th token in a row of the Crop Storage Record.
Special VP cards remain 2 each.

## B6. Edge cases and rulings (numbered)

1. Seed deposit does not need the fields hex to be unblocked by the robber. `[RB]`
2. You can only deposit species present on a fields hex adjacent to your own settlement/city. `[RB]`
3. Maximum 7 tokens per fields hex on replanting; excess tokens go back to the supply. `[RB]`
4. If a species has no more tokens in the supply, the vault gets what is left (may be < 4). `[RB]`
5. An event token showing an extinct species is discarded to the box and a new one is drawn. `[RB]`
6. If the event stack runs out, shuffle the discards into a new stack. `[RB]`
7. When Longest Road/Largest Army changes hands the new owner reveals the card's token (event hits the
   new owner), then draws a new token for the card. `[RB]`
8. Event damage ("small/large crop loss") prioritizes hexes adjacent to the revealer's buildings. `[RB]`
9. "Regional" and "Monoculture" events are global (not owner-prioritized). `[RB]`
10. Harvest is optional per player and per round. `[RB]`
11. The wheat/grain card is called "food". It is the only resource tied to the crops. `[RB]`
12. A 3-player game sets aside the pieces of one colour (their event tokens aren't dealt). `[RB]`

## B7. Interactions with base rules

| Base rule        | Change                                                            |
| ---------------- | ----------------------------------------------------------------- |
| Grain production | replaced for fields hexes by harvest rounds consuming crop tokens |
| Desert           | removed; extra fields hex instead; robber starts on pasture 2     |
| Robber           | blocks harvest but not deposit                                    |
| Build            | each settlement/city reveals an event token                       |
| Special cards    | Longest Road / Largest Army reveal an event on each award         |
| Win condition    | 10 VP _or_ the collapse endings; harvesting to collapse = loss    |
| Dev cards        | gained free via 2nd record token per row                          |
| Trading          | unchanged (food = grain)                                          |

## B8. Combinations

No official combination document. S4 says the scenario "requires the base game" and generically that
it may be combined with the base game or expansions (without naming any). Seafarers/C&K/T&B/E&P do
not provide a Crop Trust combination PDF. See Part C.

---

# PART C: COMBINATION MATRIX

## C1. What is officially supported

Legend: **OFF** official with rules, **OFF-p** official but only listed scenarios, **NO** officially
impossible, **UNS** no official statement; treat as unsupported.

| A \ B           | 5-6 ext | Seafarers                        | Cities & Knights           | Traders & Barbarians         | Explorers & Pirates                     | Oil Springs             | Crop Trust          |
| --------------- | ------- | -------------------------------- | -------------------------- | ---------------------------- | --------------------------------------- | ----------------------- | ------------------- |
| **Base 5-6**    | n/a     | OFF (Seafarers 5-6 ext; 4 boxes) | OFF (C&K 5-6 ext; 4 boxes) | OFF (T&B 5-6; 4 boxes)       | OFF (E&P 5-6 rules PDF CN3086; 4 boxes) | OFF (Oil 5-6 variation) | UNS (S4: 3-4p only) |
| **Seafarers**   | OFF     | n/a                              | **OFF-p** (S5/S6)          | **OFF-p** (S9, per scenario) | **NO** (S7)                             | UNS                     | UNS                 |
| **C&K**         | OFF     | OFF-p                            | n/a                        | **OFF-p** (S9)               | **OFF** (S9, 2025-08)                   | UNS                     | UNS                 |
| **T&B**         | OFF     | OFF-p                            | OFF-p                      | n/a                          | **OFF-p** (S9; Fishing only, see C5)    | UNS                     | UNS                 |
| **E&P**         | OFF     | NO                               | OFF                        | OFF-p                        | n/a                                     | UNS                     | UNS                 |
| **Oil Springs** | OFF     | UNS                              | UNS                        | UNS                          | UNS                                     | n/a                     | UNS                 |
| **Crop Trust**  | UNS     | UNS                              | UNS                        | UNS                          | UNS                                     | UNS                     | n/a                 |

Notes

- S5 (C&K page) also states the Seafarers scenarios chosen for C&K must be suitable; S6 repeats it.
- A catan.com summary snippet attributes the sentence "impossible to combine these expansions"
  (ship rules differ) to the **E&P** page; S7 confirms that is E&P vs Seafarers. T&B + Seafarers is
  officially supported by S9. Anyone reading the Seafarers page text may mis-attribute this.
- 5-6 + Seafarers + C&K (three expansions at once): not documented anywhere I found. The C&K page
  lists boxes needed for C&K 5-6 and Seafarers 5-6 separately; a triple is UNS.
- Any combination of more than two expansions: UNS, except that T&B scenarios are packaged
  per-scenario and each lists its own Seafarers/C&K combination.

## C2. Seafarers + Cities & Knights (S5, S6) `[WEB]`

Official summary (the only official text I found; the Seafarers rulebook is not online as text):

1. **Scenarios:** suitable = Heading for New Shores, Through the Desert. Exploratory scenarios and
   those with many small islands are unsuitable.
2. **Raise each scenario's VP target by 2.**
3. Everything that applies to roads (cities & knights: Road Building, Diplomacy, etc.) must also be
   possible for ships.
4. Barbarian attacks: in multi-island scenarios the normal C&K rules apply (strength = cities
   incl. metropolis; defense = active knights; barbarian track as usual).
5. **Knights and ships:** a knight may cross the sea if start/end intersections are connected by
   roads and ships, or by ships alone. An active knight may move to an intersection between 3 sea
   hexes if one of your ships touches it (it is then considered "on" that ship).
6. A knight at the end intersection of a shipping route **closes** that route (the ship can't move
   away from it); a knight must never cut off its owner's connection to the owner's coloured settlement
   (route integrity).
7. A knight or settlement that interrupts another player's shipping route counts as breaking it for
   Longest Trade Route; the route owner cannot repair it by moving ships next to the foreign knight.
8. **Pirate:** deactivating an active knight next to the pirate's sea hex lets you move the pirate.
9. A city on a **gold field** gets resources only (no commodities). The merchant cannot be placed
   on a gold field.
10. The robber rule also applies to the pirate: neither may enter play until the barbarians first
    reach Catan (my reading of the truncated bullet; the cut-off source text says "robber rule also
    applies to the pirate: neither may move until ..."). `[INF]`
    Edition note: older (5th ed) C&K combined rules are the same list.

## C3. E&P + C&K (S9) `[RB]`

Setup: return 1 field hex **and** 1 forest hex to the box (instead of 2 field hexes); use the barbarian
track sea frame; first placement = a **city**, second = a **harbor settlement**.
Rules: barbarian strength = number of cities incl. metropolises (no harbor settlements, include
parrot/goose-island cities); defenders = knights on board (no crews). No gold-for-commodity trades
with the supply. Settlements may become cities **or** harbor settlements (a city can't become a
harbor settlement or vice versa). Aqueduct (Science 3): if no cards on a 7, take 1 resource + 1 gold.
Knights move only on their island, don't take part in missions, may not be built/moved next to
unexplored hexes. Missions: Fast Gold = once in the action phase, trade 1 resource/commodity for 1
gold (twice if crew on both Fast Gold hexes). **Win at 5 VP more than the E&P scenario requires**
(the sheet's example: Spices for Catan -> 19; but Spices is 15 VP in the Mission Guide, so the
rule gives 20: we follow the rule, combos.md §7). Progress cards: Medicine (1 wheat + 2 ore for a city, or 1 wheat + 1 ore
for a harbor settlement), Taxation (activate the pirate ship instead of the robber), Treason (knights
only), Road Building (roads only, no ships).

## C4. T&B + C&K (S9) `[RB]`

Generic (Traders & Barbarians scenario "TnB"): remove 1 forest (instead of 1 field); use the
barbarian-track frame; Barbarian Attack's development cards unused. Two barbarian sets: the C&K track
barbarians and the 3 wagon-blocking barbarians of the scenario. Coins buy resources only, not
commodities. "Chase away the robber": an active knight adjacent to a barbarian may move it to any
free edge (steal 1 random resource/commodity if on a road); the knight deactivates. **Win 15 VP.**
Per-scenario (all use "Except where noted, both rules apply"):

- **Barbarian Attack + C&K** (sheet read in full for C5, engine status: combos.md §10): do not use the C&K sea frame/barbarian ship or the scenario's knights
  and dev cards. The 3 dice: a ship on the event die places a barbarian on the coastal hex
  matching the production roll (max 3 per hex; not on a 7). Walls conquer as normal; a metropolis
  city is not conquered but stops producing (still 4 VP) and blocks its track improvement. Each
  improvement built triggers a 2-dice barbarian placement. Recruited knights go on castle edges.
  Knight actions at **end of turn**: move active knights up to 5, inactive up to 3 paths, anywhere;
  displace within 3 paths. Combat uses knight strength; losses downgrade; each lost knight pays 3 gold;
  3 prisoners = 1 VP. Special progress cards (Intrigue, Invention, Merchant, Taxation, Treason).
  **Win 13 VP.**
- **CATAN for Two + C&K** (sheet read in full for C5, combos.md §11): two full roll+production phases per turn; recruiting/promoting a knight
  also recruits/promotes a neutral knight (never mighty); neutral knights can't be activated; trade
  tokens can be gained by removing a knight (1/2/3 tokens by level); forced trade splits in two
  versions (resource-only; or resource+commodity at double cost). **Win 13 VP.**
- **Fishing on Catan + C&K:** fish tokens are not resources/commodities, immune to progress cards;
  Science-3 gives 1 resource if only fish received; 3 fish = steal a random card (resource or
  commodity); 4 fish = take 1 resource (no commodities); 7 fish = take any progress card.
  **Win 13 VP (14 with the old boot).**
- **Merchant Trains + C&K:** normal setup of both; the robber doesn't enter until after the first
  barbarian attack; the voting round bids brick/wood instead of wool/wheat. **Win 15 VP.**
- **Rivers of Catan + C&K:** 1 gold per setup building on a river intersection (setup only);
  trade commodities for gold at the normal rates; spend gold for up to 2 resources (not commodities)
  per turn; knights move across bridges as roads; pillaged city can be saved for 5 gold; Diplomacy
  can't remove a bridge, removing a road on a river hex costs 1 gold (and a free replacement road when
  you remove your own). **Win 13 VP (12 with the old boot).**

## C5. T&B + Seafarers (S9) `[RB]`

General rules for each scenario's Seafarers combination:

- **Traders & Barbarians (main scenario):** wagons may cross sea hexes: 2 MP if the edge has no ship,
  1 MP if it has your ship, 1 MP + 1 gold (paid to the owner) if it has another player's ship. Robber
  and pirate are not in the game. A barbarian may be placed on a sea edge without a barbarian. **Win +3 VP.**
- **Barbarian Attack + SEA:** needs one continuous land mass with unique coastal numbers; only
  "Heading for New Shores" is adapted; ships may be built on edges of conquered hexes; routes may
  only be changed if they connect to an unconquered building; robber/pirate not used.
- **Merchant Trains + SEA:** wagons may be placed on sea edges (even with a ship), nose-to-tail;
  a wagon on a ship edge counts as an additional ship for Longest Route. **Win +2 VP.**
- **Fishing on Catan + SEA:** lake only surrounded by land; 2 fish = remove the pirate; 5 fish = a free
  ship; ships do not affect fishing; pirate may block a fishing ground; per-scenario setup list
  (playable with: Heading for New Shores, Four Islands, Fog Islands, Through the Desert, Forgotten
  Tribe, Cloth for Catan, Wonders of Catan, New World; **not** Pirate Islands). Old boot = +1 VP needed.
- **Rivers of Catan + SEA:** 1 gold per ship built on a river-tile edge, pay 1 gold to move away; no
  ships on bridge sites; playable with Heading for New Shores and Fog Islands (not Four Islands);
  Fog Islands: robber starts on a swamp hex, gold fields produce resources.
  Edition note: all of these PDFs are the 2025 (6th-ed) documents.

## C6. E&P + T&B (S9) `[RB]`

Only the **Fishing on Catan** pairing is described (setup for 6 fishing grounds, optional lake at the
12 hex after removing 1 mountain, fish -> gold if only fish are received, spend fish: 2 fish ignores
the pirate ship). **Friendly Robber, Harbors of Catan: impossible** (no robber/harbors in E&P). Event
cards: may be used for dice distribution only, ignoring effects. Other T&B scenarios: no combo doc, UNS.

## C7. 5-6 player rules

Each expansion has a dedicated 5-6 player product and requires 4 boxes in total (base, expansion,
base 5-6, expansion 5-6) (S5-S8). Oil Springs adds its own 5-6 board/limits (A2.3). Crop Trust is 3-4.
Combined 5-6 + 2 expansions: UNS.

## C8. Engine-level combination policy (recommendation)

- Represent each mode as a feature flag with an explicit `compat` table; reject unsupported
  combos at game-setup validation, with the reason from this matrix.
- Oil Springs / Crop Trust are mutually exclusive with everything but the base game (and Oil Springs +
  5-6). Both change the **win target, robber start, board generation and base production**.
- Resolving VP target for combinations: take the scenario's target and add the combination increment
  (C&K combo: +2 for Seafarers scenarios; per-scenario values in C3-C5).

---

# PART D: IMPLEMENTATION NOTES (engine)

## D1. New state

**Oil Springs**

- `oil[playerId]`, `sequesteredOil[playerId]`, `oilSupply`, `reserveRemoved` (oil removed by disasters).
- `disasterMarker` (0..5), `destroyedTokens: number[]` (+ slot count 5/8), hex `destroyed: boolean`,
  hex `oilSpring: boolean` (+ numbered tile flag for desert).
- `metropolis: Set<vertexId>`, metropolis tokens left, `championOfEnvironment: PlayerId | null`.
- `oilUsedThisTurn` and `sequesteredThisTurn` flags (exclusive).
- 5-6: `maxOil = 6`, ruin threshold 8, SBP restrictions (`phase: 'sbp'`).

**Crop Trust**

- `crops: {hexId: Record<Species, number>}` per fields hex (cap 7), `species[5]`, `extinct` flags.
- Per player: `vault: {species, count}`, `record: [row1: Species[], row2: Species[]]`,
  `eventTokens` under pieces (settlement slots, city slots) + on LR/LA, `eventStack`, `eventDiscard`.
- `foodCards` = existing grain; `depositedThisTurn`.
- End conditions 2/3 triggered from harvest/events.

## D2. New phases/actions

Oil: `convertOil`, `buildMetropolis`, `sequesterOil`, `resolveDisaster` (auto, seeded RNG), `stealOil`
variant on robber, oil discard choice on 7, round-robin oil distribution, Monopoly/YoP oil.
Crop: `harvest` decisions (new interactive phase per roll; bots need `harvest|decline`),
`depositSeed` (compound action with species + row + 4 replant hexes), event reveal auto-resolve
(with a choice only for small/large loss ordering within equal adjacent hexes), end-game evaluator
with the "harvester loses" and "build-phase" rules.

## D3. HUD

Oil: oil count, sequestered count, disaster track (marker + destroyed tokens), champion, metropolis
count remaining. Crop: per-hex crop pips (species colours), vault display, record panel (2x5),
event stack/last event log, extinct species indicator, fields-hex emptiness progress (n/5, species n/5).

## D4. Bots

Oil: simple greedy convert/metropolis under marker cap; sequester heuristics; random is fine for legal moves.
Crop: random harvest/decline (always harvest), deposit when affordable; ensure `legalActions` only offers
legal species/rows/hexes.

## D5. Suggested tests

Oil: oil round-robin distribution with supply shortage; cap enforcement via production/theft/trade/
YoP/Monopoly; marker cap 5 per turn (metropolis at marker 4 rejected); disaster flood (7) removes coastal
settlements, downgrades cities, spares metropolis; hex hit removes token to track; oil hex hit removes 3
supply oil; 5th/8th destroyed token ends game with Champion pyrrhic result; sequester exclusivity and
3-oil VP; champion strict transfer; SBP oil restrictions; robber cannot enter destroyed hex; win check
after disaster (12 -> 10 continues).
Crop: harvest rounds with shortage; city double harvest; robber blocks harvest not deposit; deposit
rewards (dev card on 2nd, VP on 3rd-5th per row, both rows); replant 7-cap and distinct hexes; vault
swap; every event type incl. monoculture; extinction cascade and replacement draw; event stack
reshuffle; end condition precedence and the production-phase-loses rule; variable-setup crop counts.

---

# PART E: OPEN QUESTIONS (with recommended interpretation)

## Oil Springs

1. **Starting resources:** do oil-spring hexes give oil at the second settlement? Not stated.
   Recommend: yes, oil (subject to the cap), because the base rule gives one resource card per
   adjacent hex.
2. **Flood on 7 vs. order of destruction** (settlements first, then city downgrade) to avoid running
   out of settlement pieces. Recommend settlements first.
3. **Longest Road after flooding:** removing a building can reconnect a broken road: recompute Longest
   Road immediately after the disaster. Unspecified; recommend recompute.
4. **Disaster on an oil spring when supply < 3:** use: remove min(3, supply) from the supply first, then
   the remainder from players one at a time clockwise from the disaster causer. S1 states this only for
   the supply-empty case.
5. **Win vs. ruin simultaneity:** if the 5th/8th token is destroyed in the same Disaster Phase where
   a player is at >= 12 VP, recommend ruin takes precedence (no VP winner; Champion Pyrrhic).
6. **Pyrrhic Victory with no Champion:** recommend "no winner" (game over, no victor).
7. **Metropolis requirement** "your own city": engine should refuse on a settlement. Recommend: forbid.
8. **Robber on a hex that later is destroyed:** not specified; recommend the robber stays but the hex is
   already dead (no production anyway).
9. **Numbered desert Oil Spring number in variable setup:** which number? Recommend pick a number token
   not on an adjacent hex, as the rulebook hints.
10. **Oil as input of maritime trade/oil as card for dev cards:** disallow.
11. **5-6 fixed terrain:** see A2.3; recommend variable terrain with forced forest/pasture at the oil
    positions, flagged in the data.
12. **VP tokens:** only (supply of oil)/3 can be earned; don't model physical tokens, compute VP.

## Crop Trust

1. **Event category counts (41):** unknown. They are not in the rulebook text or on catan.com, and I
   did not invent numbers. Recommend a data-driven event deck (species x category x numbers), seeded
   with a clearly marked placeholder, and verify against the physical product before shipping.
   The regional-loss number sets also come from the physical tokens, so they are unknown too.
2. **Row choice for deposits:** recommend the player aid's "free choice of row" (subject to the
   1-per-species-per-row rule), filling spaces left to right.
3. **Crops per species (18):** assumption from 90/5.
4. **3-player vault species for the missing colour:** unspecified; leave unused.
5. **Event token for "build settlement" when the piece's token was drawn but the stack is empty:** reshuffle first.
6. **Who chooses which tokens to remove in small/large loss among eligible adjacent hexes?** Recommend
   the revealing player chooses.
7. **Monoculture on a hex with a single token:** the token is removed (rule says "only 1 type").
8. **Extinction check timing:** after every removal and after the vault changes; recommend after each
   complete action resolution to avoid transient states, but test the end conditions per removal for
   the "harvester loses" rule.
9. **Harvest on a hex when the roller has no building:** start from the next entitled player.

## General

1. T&B/E&P/C&K combination PDFs are 2025 6th-ed documents and may differ from 5th-ed boxes; our target
   is the 2025 set.
2. Triple expansions and any scenario + expansion: UNS, rejected by validation.
