# CATAN: Traders & Barbarians — rules research for the engine

Written for the engine-framework agent and the later engine agents. It covers the whole box: 4 variants and
5 scenarios, for 3–4 players and for the 5–6 extension. Rules are in our own words. Facts read from a
diagram (not from text) are tagged **[img]**; facts we derived are tagged **[inferred]**. Anything the
sources leave open is listed in §10 with a recommendation. Researched 2026-10-25. No code was changed.

---

## 0. Edition decision, sources, how to read this document

### 0.1 Two editions exist and they differ

| Key       | Edition                                                                                                                                        | Notes                                                                                                                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T5**    | _Traders & Barbarians — Variant Rules & Campaign Scenarios_, **2015 printing (5th edition), © 2007/2008/2015 Catan GmbH & Mayfair**, 24 pages. | Pairs with the base game R5 that `docs/RULES.md` uses. Names: Friendly Robber, Catan Event Cards, Harbormaster, Catan for Two; Fishermen of Catan, Rivers of Catan, Caravans, Barbarian Attack, Traders & Barbarians. |
| **T5-56** | _T&B 5-6 Player Extension_, 2020 printing, 12 pages.                                                                                           | Uses the **Special Build Phase**.                                                                                                                                                                                     |
| **T6**    | _CATAN – Traders & Barbarians_ rulebook CN3089 v6.250701 (**6th edition, 2025**), 24 pages.                                                    | Redesign by the Catan Studio team. Renames and re-tunes most things (§0.3). Pairs with R6.                                                                                                                            |
| **T6-56** | _T&B 5–6 Expansion_ CN3090, 2025.                                                                                                              | Uses the **paired players turn** instead of the SBP.                                                                                                                                                                  |
| **FAQ**   | Official FAQ, 70 numbered entries. It is the Mayfair-era FAQ, so it matches **T5**.                                                            | https://www.catan.com/faq/traders-barbarians                                                                                                                                                                          |
| **CMB**   | Ten official 2025 "combination" sheets (T&B scenario × T&B scenario).                                                                          | §8.1.                                                                                                                                                                                                                 |
| **RULES** | `docs/RULES.md` (base game, our engine reference).                                                                                             |                                                                                                                                                                                                                       |

URLs:

- T5: https://cdn.1j1ju.com/medias/ee/78/a4-catan-traders-barbarians-rulebook.pdf (retail mirror of the catan.com/Mayfair PDF; also https://archive.org/details/traders-barbarians).
- T5-56: https://fgbradleys.com/wp-content/uploads/catan_t_b_5-6_2020_rules_200820.pdf
- T6: https://www.catan.com/sites/default/files/2025-04/CN3089%20CATAN%20%E2%80%93%20T%26B%20Rulebook.pdf
- T6-56: https://www.catan.com/sites/default/files/2025-04/CN3090%20CATAN%20%E2%80%93%20T%26B%205-6%20Expansion%20Rulebook.pdf
- Product page and index of all official PDFs: https://www.catan.com/traders-barbarians
- CMB sheets (all under `https://www.catan.com/sites/default/files/`): `2025-07/Barbarian%20Attack%20w%20TradersnBarbarians.pdf`, `2025-07/Merchant%20Trains%20w%20Barbarian%20Attack.pdf`, `2025-07/Merchant%20Trains%20w%20Traders%26Barbarians.pdf`, `2025-07/Fishing%20on%20Catan%20w%20Merchant%20Trains.pdf`, `2025-07/Fishing%20on%20Catan%20w%20Rivers%20of%20Catan.pdf`, `2025-07/Fishing%20on%20Catan%20w%20Barbarian%20Attack.pdf`, `2025-09/Fishing%20on%20Catan%20wTradersnBarbarians.pdf`, `2025-07/RiversOfCatan%20w%20BarbarianAttack.pdf`, `2025-07/Rivers%20of%20Catan%20w%20Merchant%20Trains.pdf`, `2025-07/Rivers%20of%20Catan%20w%20TradersnBarbarians.pdf`.
- Dev-deck count cross-check (unofficial, matches T6 exactly): https://www.scribd.com/doc/315536242/Catan-Components-List

### 0.2 Target edition: **T5 (2015, 5th edition)**, with T6 as a documented alternate

Reasons:

1. `docs/RULES.md` baselines the 5th-edition base game (R5). T5 is its companion. T6 assumes R6 conventions (paired turn, "Resolve a 7", "Longest Route").
2. The task and the official FAQ both use the T5 names and mechanics (Caravans, Harbormaster, Friendly Robber, camels, baggage train cards).
3. T5's boards are fully determined by diagrams we could read, and the 5–6 booklet (T5-56) is public.

Every scenario below is written for T5. The T6 differences are in **§0.3** (summary) and in a "T6:" line inside each section. We recommend that the engine keep `edition: 'tb5' | 'tb6'` as a setting and put every T5/T6 difference behind a named flag (list in §9.9). Implement T5 first.

### 0.3 T5 → T6 differences at a glance (details in each section)

| Topic                          | T5 (target)                                                                                                                                                                      | T6 (2025)                                                                                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Names                          | Fishermen of Catan; Rivers of Catan; Caravans; Barbarian Attack; Traders & Barbarians; Harbormaster; Wealthiest/Poor **Settler**; camels; baggage train cards                    | Fishing on Catan; Rivers of Catan; **Merchant Trains**; Barbarian Attack; Traders & Barbarians; **Strongest Ports**; Wealthiest/Poor **Catanian**; wagons; **wagon board**                                                        |
| Friendly Robber                | Robber may not go next to a player with only 2 VP. If no hex is legal it goes to (or stays on) the desert and nothing is stolen from 2-VP players.                               | Same ban. If no hex is legal: desert, and you **may** steal from a player with an adjacent building if they have more than 2 VP.                                                                                                  |
| Harbormaster / Strongest Ports | 3 "harbor points" (settlement 1, city 2) for the card; +1 to the VP goal.                                                                                                        | Same (called "VPs in buildings on ports"); tile is worth 2 VP; +1 to the VP goal.                                                                                                                                                 |
| Event deck                     | 36 events + New Year (+ summary card). Names: Catan Prospers, Neighborly Assistance.                                                                                             | Same 36+1 composition, renamed ("A Beautiful Day", "Helpful Neighbor"); small text changes (Conflict, Trade Advantage). With Catan for Two: always use the second card, even if equal.                                            |
| Catan for Two                  | Same trade tokens / forced trade / robber to desert. Two rolls per turn. If an event deck is used, two cards; an equal second card is not re-drawn and its result applies twice. | Same rules.                                                                                                                                                                                                                       |
| Fishermen                      | Lake can be any non-coastal hex; fishing grounds placed on a free frame vertex of each frame section. When fish runs short at payout, nobody gets fish.                          | Lake + 6 random hexes fill the inner 7 hexes; fishing grounds on 6 fixed "V" spots; the fish supply is reshuffled when empty; 2-fish-per-turn limit rule worded "once per turn"; fish are drawn clockwise from the active player. |
| Rivers                         | 3 river tiles (7 river hexes), 7 bridge sites; up to 3 Poor Settler tiles; maritime gold only 4:1/3:1.                                                                           | 2 river tiles (4-hex + 3-hex); 4 Poor tiles; bridge sites defined as "where the river crosses or meets an edge"; maritime gold also at 2:1 with a port; may not build a bridge past an opponent's building.                       |
| Caravans → Merchant Trains     | Votes: wool/grain; majority/coalition rule; 22 camels; oasis at center with 3 start arrows.                                                                                      | Votes: wool/wheat; plurality-of-location rule; 22 wagons; watering hole at center, 3 start edges; **no vote majority rule**.                                                                                                      |
| Barbarian Attack               | Intrigue card. Gold only from 3-gold payouts and Treason (2).                                                                                                                    | Intrigue → **Capture**; may not build on edges/intersections of conquered hexes; ports next to conquered buildings are disabled (same as T5).                                                                                     |
| Traders & Barbarians           | Baggage train cards 1–5 per player; wagon moves after trade/build; **Longest Road not used**. Same MP costs.                                                                     | Wagon board with cube track (same numbers: MP 4/5/6/7/7, gold 1–5); 9 "X" markers on the 3 sea edges of each commodity hex.                                                                                                       |
| 5–6 players                    | Special Build Phase.                                                                                                                                                             | Paired players turn.                                                                                                                                                                                                              |

---

## 1. Overview and components

### 1.1 What is in the box

T&B is not stand-alone. It needs CATAN (base). It adds **4 variants** (play with any base game, combine freely) and **5 scenarios** (a "Campaign" of rising difficulty, recommended order: Fishermen → Rivers → Caravans → Barbarian Attack → Traders & Barbarians; T5 p.8). 3–4 players; the 5–6 extension adds 5–6 players; the two-player rules are the variant "Catan for Two" (T5 p.6).

| Kind     | Name                                    | Short idea                                                                | VP to win (3–4p)          |
| -------- | --------------------------------------- | ------------------------------------------------------------------------- | ------------------------- |
| Variant  | **Friendly Robber**                     | Robber may not touch players with only 2 VP.                              | unchanged                 |
| Variant  | **Catan Event Cards**                   | A 36-card event deck replaces the dice.                                   | unchanged                 |
| Variant  | **Harbormaster** (6th: Strongest Ports) | Harbor points → a 2-VP card.                                              | **+1**                    |
| Variant  | **Catan for Two**                       | 2 players + 2 neutral players, trade tokens.                              | unchanged                 |
| Scenario | **The Fishermen of Catan**              | Lake and fishing grounds produce fish tokens → special actions; old boot. | 10 (11 with the old boot) |
| Scenario | **The Rivers of Catan**                 | River hexes, bridges, gold, Wealthiest/Poor Settler.                      | 10                        |
| Scenario | **The Caravans**                        | Voting on where camels extend caravans from an oasis; +VP between camels. | 12                        |
| Scenario | **Barbarian Attack**                    | Barbarians conquer coastal hexes; knights expel them; prisoners score.    | 12                        |
| Scenario | **Traders & Barbarians**                | Wagons carry commodities between 3 trade hexes for gold and VP.           | 13                        |

Official duration hints (T5): Fishermen 45–60 min, Rivers 45–60, Caravans ~60, Barbarian Attack 60–90, T&B ~90.

### 1.2 Components, 3–4 player box (T5 p.2; our reading of the diagrams in brackets)

| Component                     | Count                                                                                                                                                                               | Used by                                  | Notes                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Knights (wood)                | 24 = 6 per colour                                                                                                                                                                   | Barbarian Attack                         | 6 each (4 colours).                                                                                                                          |
| Bridges (wood)                | 12 = 3 per colour                                                                                                                                                                   | Rivers                                   |                                                                                                                                              |
| Wagons (wood)                 | 4 = 1 per colour                                                                                                                                                                    | T&B                                      |                                                                                                                                              |
| Barbarians (bronze)           | 36                                                                                                                                                                                  | Barbarian Attack (30 used); T&B (3 used) | The box holds 36; BA uses 30 (T5 p.15); T&B uses 3.                                                                                          |
| Camels (brown)                | 22                                                                                                                                                                                  | Caravans                                 |                                                                                                                                              |
| Gold coins                    | 40 = **25 worth 1** + **15 worth 5**                                                                                                                                                | Rivers, Barbarian Attack, T&B            | The coin supply is physically limited, but making change is never an issue in the rules.                                                     |
| Trade tokens ("chits")        | 20 (the component list says 21; the variant page and T6 say 20)                                                                                                                     | Catan for Two                            | Treat as **20**.                                                                                                                             |
| Fish tokens                   | 29 = 11×1 fish, 10×2 fish, 8×3 fish; **plus 1 old boot**                                                                                                                            | Fishermen                                | 55 fish in total.                                                                                                                            |
| Commodity tokens              | 36 (3 stacks of 12 [inferred: 6 + 6 of each stack's two types, see 4.7.2])                                                                                                          | T&B                                      | Backs show castle / quarry / glassworks.                                                                                                     |
| Lake hex                      | 1                                                                                                                                                                                   | Fishermen                                | Printed production numbers **2, 3, 11, 12**.                                                                                                 |
| Fishing ground tiles          | 6, printed numbers **4, 5, 6, 8, 9, 10**                                                                                                                                            | Fishermen                                | Chevron-shaped, sit on the sea frame.                                                                                                        |
| Oasis hex                     | 1                                                                                                                                                                                   | Caravans                                 | Printed with 3 start arrows.                                                                                                                 |
| Castle hex (Barbarian Attack) | 1                                                                                                                                                                                   | Barbarian Attack                         | Has 6 numbered edge marks forming 3 opposite-edge pairs (1&4, 2&5, 3&6).                                                                     |
| Trade hexes                   | 3: **castle**, **quarry**, **glassworks**                                                                                                                                           | T&B                                      | Each has a central plaza and 4 interior paths.                                                                                               |
| River tiles                   | 3 tiles carrying 7 river hexes (a 4-hex river and a 3-hex river)                                                                                                                    | Rivers                                   | See §2.3. (T5's own text says "a 3-hex river on 1 tile and a 4-hex river on 2 tiles"; the diagram shows 4 + 3 = 7 hexes.)                    |
| Sea frame pieces              | 4 replacement pieces: 2 for Rivers (replace pieces labelled 4–5 and 5–6), 2 for T&B (replace pieces 1–2 and 5–6)                                                                    | Rivers, T&B                              | They change the coast art only. **Harbor positions are unchanged: 9 ports** [img].                                                           |
| Special tiles                 | Wealthiest Settler ×1, Poor Settler ×3 [4 in T6]                                                                                                                                    | Rivers                                   |                                                                                                                                              |
| Harbormaster card             | 1                                                                                                                                                                                   | Harbormaster                             |                                                                                                                                              |
| Cards                         | Event deck (36 events + 1 New Year + 1 brief-rules card); Fishermen overview cards ×4; Barbarian Attack dev deck (26); T&B dev deck (**25**); baggage train cards 20 (5 per colour) |                                          | The T5 manifest lists 15 Knights in the T&B dev deck, which sums to 24. The picture caption and T6 (16 Knights) give 25. **Use 16 Knights.** |

Card tallies:

- **Event deck (36 + New Year)**: Robber Attacks ×6, Catan Prospers ×16, Epidemic ×2, Earthquake ×1, Good Neighbors ×1, Tournament ×1, Trade Advantage ×1, Calm Seas ×2, Robber Flees ×2, Neighborly Assistance ×2, Conflict ×1, Plentiful Year ×1 (these 12 types total 36); plus 1 New Year. Production numbers in §4.2.
- **Barbarian Attack dev deck (26)**: Knighthood ×14, Swift Knight ×4, Treason ×4, Intrigue ×4 (T6: Capture ×4 instead of Intrigue).
- **T&B dev deck (25)**: Knight ×16, Road Building ×3, Swift Journey ×3, Victory Point ×3 (Toolmaking, Glassmaking, Quarry; 1 VP each).
- **Baggage train cards**: 5 per player, numbered 1–5 (§4.7.4).

### 1.3 Components, 5–6 extension (T5-56 p.1)

| Component           | Count                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bridges             | 6 (3 per colour)                                                                                                                                                                                       |
| Knights             | 12 (6 per colour)                                                                                                                                                                                      |
| Wagons              | 2                                                                                                                                                                                                      |
| Barbarians          | 12 (bronze) [**42 total** with the box]                                                                                                                                                                |
| Camels              | 11 [33 total]                                                                                                                                                                                          |
| Terrain/frame tiles | 12 tiles incl. 2 fishing grounds (numbers **5, 9**), 1 lake hex (numbers **4, 10**), 2 river tiles (3-hex river on each; T5-56 p.3), 1 oasis, 1 castle hex, 2 quarries, 2 glassworks, new frame pieces |
| Gold coins          | 16 (8×1, 8×5)                                                                                                                                                                                          |
| Poor Settler tiles  | 2 [5 in total]                                                                                                                                                                                         |
| Commodity tokens    | 18 [54 in total]                                                                                                                                                                                       |
| Fish tokens         | 14 = 4×1, 5×2, 5×3 [43 + the old boot in total]                                                                                                                                                        |
| Cards               | 2 Fishermen overview cards; T&B dev cards +12 (Knight ×6, Road Building ×3, Swift Journey ×3); baggage train cards +10 (5 per colour)                                                                  |

### 1.4 Per-player pieces by scenario

| Scenario         | Extra pieces per player                                   | Piece cap behaviour                                          |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| Fishermen        | fish tokens (secret hand); overview card                  | max **7 fish tokens** held (the old boot does not count).    |
| Rivers           | **3 bridges**; coins (public); 0 or 1 Poor Settler tile   | Bridges are separate from the 15 roads.                      |
| Caravans         | none (camels are shared)                                  | 22 camels; 33 with 5–6.                                      |
| Barbarian Attack | **6 knights**                                             | A knight removed in a victory returns to its owner's supply. |
| T&B              | **1 wagon**; baggage train cards 1–5; 5 gold at the start |                                                              |
| Catan for Two    | 5 trade tokens each (10 in the supply)                    | 20 tokens in total.                                          |

---

## 2. Setup and boards

### 2.0 Conventions used in this section

All boards use the engine's coordinates (`docs/ARCHITECTURE.md` §2): pointy-top hexes, axial `(q, r)`, `r` grows downward, neighbours `E(+1,0) W(-1,0) NE(+1,-1) NW(0,-1) SE(0,+1) SW(-1,+1)`. Hexes are written `(q,r)`. Vertex and edge ids use the engine's rule (`v:q,r,N|S`, `e:q,r,NE|E|SE`).

**19-hex frame** (radius 2 around `(0,0)`, 3-4-5-4-3):

| Row    | Hexes left → right              |
| ------ | ------------------------------- |
| r = −2 | (0,−2) (1,−2) (2,−2)            |
| r = −1 | (−1,−1) (0,−1) (1,−1) (2,−1)    |
| r = 0  | (−2,0) (−1,0) (0,0) (1,0) (2,0) |
| r = +1 | (−2,1) (−1,1) (0,1) (1,1)       |
| r = +2 | (−2,2) (−1,2) (0,2)             |

Ring 0 = `(0,0)`; ring 1 = the 6 hexes around it ("inner"); ring 2 = the 12 coastal hexes. The six **corner hexes** (3 sides on the sea) are (0,−2), (2,−2), (2,0), (0,2), (−2,2), (−2,0).

**30-hex frame** (3-4-5-6-5-4-3, the 5–6 base board, same as `FRAME_STD30`):

| Row    | Hexes left → right                    |
| ------ | ------------------------------------- |
| r = −3 | (1,−3) (2,−3) (3,−3)                  |
| r = −2 | (0,−2) (1,−2) (2,−2) (3,−2)           |
| r = −1 | (−1,−1) (0,−1) (1,−1) (2,−1) (3,−1)   |
| r = 0  | (−2,0) (−1,0) (0,0) (1,0) (2,0) (3,0) |
| r = +1 | (−2,1) (−1,1) (0,1) (1,1) (2,1)       |
| r = +2 | (−2,2) (−1,2) (0,2) (1,2)             |
| r = +3 | (−2,3) (−1,3) (0,3)                   |

**37-hex frame** (4-5-6-7-6-5-4, same as `FRAME_HEX37`) is used only by the T&B 5–6 map:

| Row    | Hexes left → right                           |
| ------ | -------------------------------------------- |
| r = −3 | (0,−3) (1,−3) (2,−3) (3,−3)                  |
| r = −2 | (−1,−2) (0,−2) (1,−2) (2,−2) (3,−2)          |
| r = −1 | (−2,−1) (−1,−1) (0,−1) (1,−1) (2,−1) (3,−1)  |
| r = 0  | (−3,0) (−2,0) (−1,0) (0,0) (1,0) (2,0) (3,0) |
| r = +1 | (−3,1) (−2,1) (−1,1) (0,1) (1,1) (2,1)       |
| r = +2 | (−3,2) (−2,2) (−1,2) (0,2) (1,2)             |
| r = +3 | (−3,3) (−2,3) (−1,3) (0,3)                   |

All maps were read from the rulebook diagrams. Positions marked **[img]** are exact to the hex; anything finer (edge or vertex positions) is checked against the picture geometry and listed in §10 if we are not sure.

**Common to every scenario** (T5 "Variable Setup" of the base game): shuffle the land hexes (except the fixed ones named below), place the 9 harbors randomly on the fixed 9 harbor slots (`portSlots`), give each player their pieces, then do the normal two-round snake placement of 2 settlements + 2 roads (second settlement pays 1 card per adjacent producing hex) — except where a scenario changes it (BA and T&B: the second settlement is a **city**). Number tokens are normally placed in the spiral order A–R (5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11) starting at a corner; `docs/RULES.md` §2.5 documents that the engine uses random placement with no two adjacent 6/8 instead. **Recommendation:** keep that method for all random T&B boards (skip hexes without tokens, apply the per-scenario token changes below).

### 2.1 Variants — setup

| Variant               | Setup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Friendly Robber**   | None.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Catan Event Cards** | Set aside the brief-rules card and the New Year card. Shuffle the other 36. Put **5** of them face down (unseen) as the bottom of the deck. Put the New Year card on those 5 (it may be shuffled with them, optional rule on the brief-rules card). Put the remaining **31** cards on top. The two dice are not used (C&K: the event die and red die are still rolled). T5 p.4.                                                                                                                                                                                                                                                                                                                           |
| **Harbormaster**      | Place the card beside the board. VP goal +1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Catan for Two**     | Variable Setup board. Two unused colours become **neutral players 0 and 1**, each with a full piece set (15 roads, 5 settlements, 4 cities). Each real player takes **5 trade tokens**; 10 stay in the supply. Place **1 neutral settlement (no road) per neutral player** on the two marked intersections [img T5 p.6]: **`v:1,-2,S`** (S corner of the top-middle hex) and **`v:-1,2,N`** (N corner of the bottom-middle hex). Then the real players do the normal setup (2 settlements + 2 roads each; **no neutral pieces are built during setup**). After setup each real player has 2 settlements + 2 roads, each neutral player has 1 settlement. Trade tokens are earned during setup too (§4.4). |

### 2.2 Fishermen of Catan — board

Terrain pool (19 hexes): forest 4, pasture 4, fields 4, hills 3, mountains 3, **lake 1** (the lake replaces the desert; no desert exists). Tokens: the 18 normal tokens go on the 18 non-lake hexes. The lake has its own printed numbers **2, 3, 11, 12** (it carries no loose token).

| Item            | Placement (T5 p.8)                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lake            | Any **non-coastal** hex, i.e. one of the 7 inner hexes. The diagram shows `(0,−1)` [img]; we recommend a random inner hex.                                                                                                                                                                                                                                   |
| Fishing grounds | 6 tiles (numbers 4, 5, 6, 8, 9, 10), **one on each of the 6 frame sections**, on a free (no harbor) coastal vertex of that section, pointing inland. Each tile touches **3 coastal intersections** (the tip vertex between two coastal hexes plus its two neighbours along the shore [inferred]). In the diagram one tile sits on every frame section [img]. |
| Fish pool       | The 29 fish tokens + old boot, mixed face down next to the cards.                                                                                                                                                                                                                                                                                            |
| Robber          | Starts **off the board**. It enters when the first 7 is rolled or the first Knight is played.                                                                                                                                                                                                                                                                |
| Start           | Normal. If your **second** settlement touches a fishing ground **or** the lake, draw 1 random fish token in addition to your starting cards.                                                                                                                                                                                                                 |

T6: lake + 6 random hexes shuffled into the 7 inner hexes; the other 12 hexes make the ring; 6 fishing grounds on fixed "V" spots (approximated from the diagram: `v:1,-3,S`, `v:-1,-1,N`, `v:2,0,N`, `v:2,0,S`, `v:-2,1,S`, `v:-2,3,N` [img, ±1 vertex]); each placed tile is a random one of the six.

**5–6 players (T5-56 p.2):** the two **deserts** are replaced by **two lake hexes** (base lake 2/3/11/12 and the 5–6 lake 4/10), both non-coastal. Fishing grounds 4,5,6,8,9,10 + 5,9 = **8**, one on each coastal frame space that has no harbor. Fish pool = 43 tokens + old boot. No fish use during a Special Build Phase.

### 2.3 Rivers of Catan — board

Remove the 7 hexes _2 mountains, 2 hills, 2 pasture, 1 desert_ from the pool; the 7 river hexes replace them. Final land: forest 4, pasture 3, fields 4, hills 3, mountains 3, **swamp 2** (19 hexes). The 12 loose hexes are forest 4, pasture 2, fields 4, hills 1, mountains 1, shuffled into the 12 free slots.

River hexes [img T5 p.11]:

| River                        | Hexes (W → E)                                                             |
| ---------------------------- | ------------------------------------------------------------------------- |
| **R1** (4 hexes, row r = −1) | `(−1,−1)` **swamp**, `(0,−1)` pasture, `(1,−1)` hills, `(2,−1)` mountains |
| **R2** (3 hexes, row r = +1) | `(−2,1)` **swamp**, `(−1,1)` hills, `(0,1)` mountains                     |

Free slots for the 12 loose hexes: (0,−2) (1,−2) (2,−2) (−2,0) (−1,0) (0,0) (1,0) (2,0) (1,1) (−2,2) (−1,2) (0,2).

**Bridge sites** (the 7 dotted paths, "a path that crosses a river"): the 5 edges between horizontally adjacent river hexes — `e:-1,-1,E`, `e:0,-1,E`, `e:1,-1,E`, `e:-2,1,E`, `e:-1,1,E` — plus **one coastal edge at each swamp mouth**: NW side of `(−1,−1)` = `e:-1,-2,SE` and SW side of `(−2,1)` = `e:-3,2,NE` [img + count of 7]. Roads may **never** be built on a bridge site.

| Item         | Rule                                                                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Swamps       | Produce nothing (no token). The robber starts on **either swamp**.                                                                                                                                                         |
| Tokens       | Set aside the "2" (B). Place the other 17 tokens by the normal rule, skipping swamps, starting on any coastal hex. Finally put the "2" on the hex that holds the "12" (H): that hex produces on a 2 **or** a 12.           |
| Pieces       | Each player also takes 3 bridges. Coins and the Wealthiest/Poor tiles sit beside the board; **nobody starts with coins** other than through setup builds.                                                                  |
| Setup builds | Normal 2 + 2 placement, but roads may not use bridge sites. Each setup settlement adjacent to ≥ 1 river hex gives **1 coin**; each setup road on an edge adjacent to a river hex gives **1 coin** (so 0–4 starting coins). |

**5–6 players (T5-56 p.3):** 30-hex board; remove 3 mountains, 2 hills, 3 pasture, **2 deserts** (10 hexes) and use **10 river hexes** [img]:

| River                       | Hexes                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **R1** (7 hexes, diagonal)  | (2,−3) **swamp** → (1,−2) hills → (0,−1) mountains → (−1,0) mountains → (−1,1) hills → (−1,2) pasture → (−1,3) **swamp** |
| **R2** (3 hexes, row r = 0) | (1,0) mountains → (2,0) pasture → (3,0) pasture (mouth at the east coast)                                                |

Final land: the 30 hexes minus the removed 10 plus these 10; tokens: all **28** (2,12 appear twice; the "2 on the 12" rule does **not** apply), skipping the 2 swamps. Bridge sites: every shared edge between consecutive river hexes (6 on R1, 2 on R2) plus the coastal edge at each mouth (R1: both swamps; R2: east end) = **11** [inferred from the 3–4 pattern]. 6 players take 3 bridges each (18 in total).

### 2.4 The Caravans — board

Terrain pool: forest 4, pasture 4, fields 4, hills 3, mountains 3 + **oasis 1** (replaces the desert). **The oasis is at `(0,0)`**, any orientation is allowed. Tokens: the 18 normal tokens on the 18 non-oasis hexes. Robber **off board**; on the first 7 (or Knight) it goes on any hex with a token, **not the oasis**. Camels beside the board.

Caravan starting points: the oasis has **3 arrows** at alternating corners; we fix them at **NW, NE, S** of the oasis [img] (any rotation is equally valid; random rotation is fine). The outward path from each arrow corner and the camel's front (head) are:

| Caravan | Start edge  | Camel tail → head vertex |
| ------- | ----------- | ------------------------ |
| 1       | `e:-1,0,NE` | `v:0,-1,S` → `v:-1,0,N`  |
| 2       | `e:1,-1,SE` | `v:1,-1,S` → `v:1,0,N`   |
| 3       | `e:-1,1,E`  | `v:0,0,S` → `v:-1,2,N`   |

**5–6 players (T5-56 p.4):** 30-hex board with **two oases** at `(0,−1)` and `(1,1)` [img] (same arrow pattern each), giving 6 caravans. 33 camels. Oases replace the 2 deserts.

### 2.5 Barbarian Attack — board (T5 p.15)

Fixed hexes: **castle `(−2,2)`** (SW corner), **desert `(2,−2)`** (NE corner) [img]. Pool: 17 land hexes for the other 17 slots.

| Group            | Slots                                                               | Hexes (random inside the group)                     |
| ---------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| **Coastal** (10) | (0,−2) (1,−2) (2,−1) (2,0) (1,1) (0,2) (−1,2) (−2,1) (−2,0) (−1,−1) | forest 2, hills 2, pasture 3, mountains 1, fields 2 |
| **Inner** (7)    | (0,−1) (1,−1) (−1,0) (0,0) (1,0) (−1,1) (0,1)                       | forest 1, pasture 1, hills 1, mountains 2, fields 2 |

(One forest hex is not used.) **Fixed number tokens** [img] — 17 tokens (the second "11" is removed):

| Hex     | Token | Hex    | Token  | Hex    | Token  |
| ------- | ----- | ------ | ------ | ------ | ------ |
| (0,−2)  | 3     | (1,−2) | 8      | (2,−2) | desert |
| (−1,−1) | 9     | (0,−1) | 4      | (1,−1) | 5      |
| (2,−1)  | 10    | (−2,0) | 12     | (−1,0) | 6      |
| (0,0)   | 10    | (1,0)  | 8      | (2,0)  | 11     |
| (−2,1)  | 4     | (−1,1) | 9      | (0,1)  | 3      |
| (1,1)   | 5     | (−2,2) | castle | (−1,2) | 6      |
| (0,2)   | 2     |        |        |        |        |

Every number 2–6, 8–12 appears on **exactly one coastal hex**, which is what makes the barbarian rolls work. **Start barbarians:** 1 on the coastal "2" hex `(0,2)` and 1 on the coastal "12" hex `(−2,0)`; the other 28 form the supply (30 in the game). Each player takes 6 knights. Use the BA dev deck (26 cards); **no base dev cards, no Largest Army, no robber** (Longest Road stays). Start: second placement is a **city**, which pays 1 card per adjacent hex. No starting gold. 40 coins in the supply.

**Check order** for victories: start at the coastal "4" hex `(−2,1)` (next to the castle) and go **clockwise** around the island: (−2,1) → (−2,0) → (−1,−1) → (0,−2) → (1,−2) → (2,−2 desert, skipped) → (2,−1) → (2,0) → (1,1) → (0,2) → (−1,2) → (−2,2 castle, skipped).

**Castle orientation:** the castle's 6 edges are marked 1–6; opposite edges form the pairs **1&4, 2&5, 3&6**. Opposite edges are parallel, so a pair is the same as "an orientation family" (the three directions of edges in a hex grid: `NE/SW`, `E/W`, `SE/NW`). A knight is on "an edge with that orientation" if its edge belongs to that family. Which pair name maps to which family does not change the odds (each is 1/3).

**5–6 players (T5-56 p.5–7):** 30-hex board with **two castles** at `(−2,0)` and `(3,0)` (both with the same orientation marks) and **two deserts** at `(−2,1)` and `(3,−1)` [img]. Terrain: outer ring 12 hexes get forest 3, hills 3, pasture 2, mountains 2, fields 2; the inner 14 get forest 2, hills 2, pasture 3, mountains 3, fields 4 (one forest and one pasture are unused). **Numbers [img]:**

| Row  | Hexes → numbers                                              |
| ---- | ------------------------------------------------------------ |
| r=−3 | (1,−3)=12 (2,−3)=9 (3,−3)=3                                  |
| r=−2 | (0,−2)=4 (1,−2)=5 (2,−2)=10 (3,−2)=8                         |
| r=−1 | (−1,−1)=5 (0,−1)=11 (1,−1)=6 (2,−1)=3 (3,−1)=desert          |
| r=0  | (−2,0)=castle (−1,0)=8 (0,0)=10 (1,0)=4 (2,0)=6 (3,0)=castle |
| r=+1 | (−2,1)=desert (−1,1)=3 (0,1)=8 (1,1)=11 (2,1)=9              |
| r=+2 | (−2,2)=6 (−1,2)=4 (0,2)=9 (1,2)=10                           |
| r=+3 | (−2,3)=2 (−1,3)=5 (0,3)=11                                   |

(26 tokens; one "2" and one "12" are left out.) The coastal "5" appears twice, at `(−1,−1)` and `(−1,3)`, and the coastal "9" twice, at `(2,−3)` and `(2,1)`. 42 barbarians in total: start 1 on a coastal "2" and 1 on a coastal "12" hex (`(−2,3)`, `(1,−3)`), the rest in the supply. 12 more knights.

### 2.6 Traders & Barbarians — board (T5 p.19–21)

**Frame:** replace pieces 1–2 and 5–6 (cosmetic; 9 harbors in the usual slots). Remove from play: the desert, 1 pasture, 1 fields and the "2" and "12" tokens. Land: forest 4, pasture 3, fields 3, hills 3, mountains 3 (16 hexes, random) + 3 trade hexes (fixed corners). Tokens: the 16 remaining tokens, skipping the trade hexes.

| Trade hex                  | Position [img] | Sea sides | Settlement corners (touch ≥ 1 other land hex) | Sea-only corners (no settling) |
| -------------------------- | -------------- | --------- | --------------------------------------------- | ------------------------------ |
| **Castle** (commodity hex) | `(−2,0)`       | NW, W, SW | N, NE, SE, S                                  | NW, SW                         |
| **Quarry**                 | `(2,−2)`       | NW, NE, E | SE, S, SW, NW                                 | N, NE                          |
| **Glassworks**             | `(0,2)`        | SW, SE, E | NW, N, NE, SW                                 | S, SE                          |

Each trade hex has a **central plaza** (a vertex) joined by **4 interior paths** ("spokes") to its 4 settlement corners [inferred; consistent with the count of 10 paths in T5-56 p.10 = 4 spokes + 6 hex sides, and 12 = 6 + 6 for the 5–6 hexes]. The sea side of each trade hex lies against the frame.

**Start barbarians (3):** on the paths marked X [img]: `e:1,-2,SE`, `e:-2,1,NE`, `e:0,1,E` (read to the nearest edge from the diagram geometry).

**Piles:** commodity tokens sorted into 3 stacks by the picture on the back (castle, quarry, glassworks), shuffled, one stack by each trade hex. Each player gets 5 gold, their 5 baggage train cards (stack face down in order 5-4-3-2, with card 1 face up as the active card) and a wagon. Second settlement is a **city**; place the wagon on the **city's intersection**. No Longest Road tile, no robber. T&B dev deck (25 cards).

**5–6 players (T5-56 p.8–10):** a **37-hex** board (rows 4-5-6-7-6-5-4) with these fixed hexes [img]: quarries at (0,−3), (3,0), (−3,3); glassworks at (3,−3), (0,3), (−3,0); castle at **(0,0)**; deserts at (0,−2) and (0,2). Full layout:

| Row  | Hexes → contents (T5-56 p.9)                                                       |
| ---- | ---------------------------------------------------------------------------------- |
| r=−3 | (0,−3)=quarry (1,−3)=6 (2,−3)=10 (3,−3)=glassworks                                 |
| r=−2 | (−1,−2)=4 (0,−2)=desert (1,−2)=3 (2,−2)=12 (3,−2)=8                                |
| r=−1 | (−2,−1)=3 (−1,−1)=5 (0,−1)=10 (1,−1)=5 (2,−1)=9 (3,−1)=11                          |
| r=0  | (−3,0)=glassworks (−2,0)=8 (−1,0)=12 (0,0)=**castle** (1,0)=2 (2,0)=6 (3,0)=quarry |
| r=+1 | (−3,1)=11 (−2,1)=9 (−1,1)=4 (0,1)=9 (1,1)=5 (2,1)=3                                |
| r=+2 | (−3,2)=6 (−2,2)=2 (−1,2)=11 (0,2)=desert (1,2)=4                                   |
| r=+3 | (−3,3)=quarry (−2,3)=10 (−1,3)=8 (0,3)=glassworks                                  |

The 2 deserts are at (0,−2) and (0,2). The remaining 28 land hexes are the base + 5–6 terrain minus both deserts, random. 28 tokens as above (2 and 12 appear twice; **no re-roll of 2/12** here because tokens for them exist, and trade hexes produce nothing except as the 5–6 note says). 3 barbarians at the X marks: `e:2,-3,SE`, `e:-3,1,NE`, `e:0,2,E` [img]. The 5–6 booklet says the new trade hexes (2 quarries, 2 glassworks, from the 5–6 box) have **6 settlement corners and 12 paths** (roads and settlements allowed on the coast, needed to reach some harbors); the T&B-box quarry and glassworks keep 4 corners / 10 paths. Which three of the six trade hexes are the older design is not stated; we recommend giving all six the 6-corner design (§10 Q14). Commodity stacks: 3 stacks next to the quarries and 3 next to the glassworks (any stack may be drawn from if one is empty); castle tokens beside the board. Still only 3 barbarians.

---

## 3. Turn structure and rule changes

### 3.1 Turn skeleton (T5, base game R5 + extension points)

| Phase                      | Base game                                         | T&B hooks                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 Pre-roll**            | May play 1 dev card (base: also before the roll). | Catan for Two: spend trade tokens (before rolling allowed, FAQ 34). Fishermen: spend fish. Rivers/BA/T&B: spend gold for a card (2 gold → 1 card, ≤ 2×/turn).                     |
| **P1 Production**          | Roll 2 dice, produce, or 7.                       | Event Cards: reveal a card instead (§4.2). Catan for Two: **two** rolls (§4.4). Fishermen: fishing grounds/lake also produce fish. T&B/Rivers: 2/12 handling. BA/T&B: 7 handling. |
| **P2 Action**              | Trade + build in any order, dev cards.            | New builds (bridges, knights via cards), wagon upgrades, gold, fish actions, trade tokens. BA: barbarian attack interrupts on every settlement/city built.                        |
| **P3 End of turn** _(new)_ | Pass the turn.                                    | BA: move knights, then expel barbarians. T&B: move wagon (optional). Caravans: voting round + 1 camel.                                                                            |
| **SBP** (5–6)              | After P3, other players may build.                | BA: victory check happens before the SBP starts; Caravans: 2nd camel after SBP if anything was built there (§3.8).                                                                |

Win check: "if you have enough VP **at any point during your turn**" the game ends at once. That covers prisoner VP at the end of a BA turn, a commodity delivery at the end of a T&B turn, and a hidden VP card revealed at the right moment. Nobody wins on an opponent's turn (including the SBP).

### 3.2 7s and the robber, by scenario/variant

| Setting                           | Roll of 7 (production)                                                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base, Fishermen, Rivers, Caravans | Normal: players with > 7 cards discard half (rounded down), then move the robber and steal 1 card. Rivers: gold is not a card; Fishermen: fish is not a card.                          |
| Barbarian Attack (no robber)      | Discard as normal, then **draw 1 random resource from a player of your choice** (any player with cards).                                                                               |
| T&B (no robber)                   | No production. Discard as normal. Then **move 1 barbarian** to any path without a barbarian; if the path has a road, draw 1 random resource card from its owner (gold is never drawn). |
| Friendly Robber                   | Robber placement restricted (§4.1). Discard unchanged.                                                                                                                                 |
| Catan for Two                     | Each 7 (first or second roll) resolves normally before the next roll.                                                                                                                  |
| Event cards                       | "Robber Attacks!" = a 7 (production number 7).                                                                                                                                         |

T&B and Rivers re-roll rules for 2 and 12 are in §3.5 and §3.4.

### 3.3 Fishermen — step by step

1. P1: roll. A hex with that number produces cards as usual. Additionally: every fishing ground whose number was rolled pays each adjacent settlement **1 fish token** and each city **2**; the lake pays the same when **2, 3, 11 or 12** is rolled. Robber on the lake blocks the lake (all four numbers). Robber may not stand on a fishing ground.
2. Tokens are drawn at random from the face-down pool. If the pool cannot cover **everyone's** payout this roll, **nobody gets fish** this roll. Draw the old boot → reveal it at once (it stays face up in front of its owner). The last token drawn → shuffle the used (spent) tokens face down into a new pool.
3. A player at **7 fish tokens** (boot excluded) who would receive more may **exchange** one held token for a drawn one (T5 wording; T6: once per turn, discard 1, take replacement, stop drawing). Recommendation: T6 wording (§10 Q5).
4. P0/P2: on your turn spend fish for actions (§4.5). After the roll the owner of the boot may give it away (§4.5.3).
5. Win at 10 VP, **11 with the boot** (12 if Harbormaster is also used).

### 3.4 Rivers — step by step

1. P1: roll. A 2 or 12 produces on the one hex that carries both tokens (no re-roll). Swamps never produce.
2. P2: building a settlement (not an upgrade) on an intersection adjacent to a river hex → 1 coin. Building a road on an edge adjacent to a river hex → 1 coin. Building a bridge → **3 coins**. Gold actions §4.6.
3. After **every** coin change recompute Wealthiest (+1 VP, unique maximum) and Poor Settler (−2 VP each, everyone tied at the minimum, including 0). Both are derived states.
4. Win at 10 VP (11 with Harbormaster).

### 3.5 Caravans — step by step

1. After set-up, whenever you **build at least one settlement or upgrade at least one settlement to a city** during your turn, **exactly 1 camel** is placed at the end of your turn (not one per building).
2. End of turn: **voting round** (§4.3.2) decides the camel's position; then the next player's turn (or the SBP).
3. 2/12: no special handling (tokens exist).
4. Win at 12 VP (13 with Harbormaster).

### 3.6 Barbarian Attack — step by step

1. P0/P1/P2 as normal, with these differences: no base dev cards; dev cards resolve immediately when bought; no robber (§3.2).
2. **Barbarians land** every time you build a settlement or upgrade to a city (§4.8.1) — immediately, mid-turn.
3. **Cards:** each dev card you build is revealed and resolved at once, discarded, then you may build another (§4.8.5). Empty deck → shuffle the discard pile.
4. **P3, in order:** (a) move your knights (optional; castle-edge knights must move), (b) **expel the barbarians** (§4.8.4): check all coastal hexes clockwise from the "4" hex, hex by hex, resolving each victory completely (prisoners, liberation, die for knight losses) before the next hex.
5. Win at 12 VP (13 with Harbormaster); prisoners count (2 per VP).

### 3.7 Traders & Barbarians — step by step

1. P1: roll. 2 or 12 → **re-roll** (repeat as needed). 7 → §3.2 (move 1 barbarian).
2. P2: normal trading/building, **no Longest Road**. Upgrade your baggage train card (§4.7.4). Road building on the interior spokes of a trade hex is allowed; not on its sea sides.
3. P3: move your wagon (§4.7.3) and deliver/pick up.
4. Win at 13 VP (14 with Harbormaster).

### 3.8 5–6 players and Special Build Phase interactions (T5-56)

| Scenario  | Rule                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All       | After each turn each other player gets one SBP turn (base rule `docs/RULES.md` §16.10).                                                                                                                                                                                                                                                                                                                        |
| Fishermen | **No fish actions** in the SBP (T5-56 p.2).                                                                                                                                                                                                                                                                                                                                                                    |
| Rivers    | **No gold→card purchases** in the SBP (p.3). Gold can still be earned by building (inferred).                                                                                                                                                                                                                                                                                                                  |
| Caravans  | Camel after the owner's turn (if they built a settlement/city) **before** the SBP. If any SBP builder builds a settlement/city, **another camel is placed after the SBP ends**; the owner (who just finished the turn) starts that vote and breaks ties (p.4).                                                                                                                                                 |
| BA        | Victory check after the owner's knight moves, **before** the SBP. In the SBP: build/buy as usual; a Knighthood placed in the SBP must be moved off the castle at the end of that builder's step; all knights bought are placed before any is moved; after each builder's step, check victories again (start at the hex left of one castle, clockwise, then the other castle) (p.6–7). No gold→card in the SBP. |
| T&B       | No wagon movement or use in the SBP, but upgrading the wagon is allowed. No gold→card (p.10).                                                                                                                                                                                                                                                                                                                  |

T6-56: the SBP is replaced by the **paired players turn**: player 1 takes a full turn, then player 2 (3rd to the left) takes Action + End of Turn only, without trading with other players; a win ends the game at once; Caravans/Merchant Trains: a voting round is held after each of the two parts if the part built a building. The base repo documents it as `docs/RULES.md` §16.D.

---

## 4. New actions, cards, pieces

### 4.1 Friendly Robber (T5 p.3)

- Applies whenever the robber moves (a 7, a Knight card, the "Move Robber" token action, fish actions that place the robber, event "Robber Attacks!").
- The robber may **not** be moved to a hex adjacent to a settlement/city of a player who has **only 2 VP**. VP used for the test are **public** VP (face-down VP cards ignored, FAQ 54).
- **Fallback:** if no hex is legal, the robber moves to (or stays on) the **desert**; **nothing is stolen** from a player with only 2 VP.
- The 7-discard still applies.
- Does not restrict the mover's own buildings (FAQ 55: a legal hex may be next to _your own_ building) [see §10 Q8 for the 2-VP mover].
- Seafarers pirate is also friendly (FAQ 53).
- T6: same ban; fallback → desert **and** steal from any adjacent player with > 2 VP.

### 4.2 Catan Event Cards (T5 p.4–5)

One card is revealed at the start of each turn **instead of rolling**. **Resolve the event first, then produce using the card's number disc** (7 = "Robber Attacks" production, i.e. no hexes produce). When the **New Year** card is revealed, build a new deck (§2.1) and reveal its top card at once and resolve it. The first card of the game is revealed after setup.

**Deck of 36 (+ New Year):**

| Card                                          | Copies | Production #                       | Effect (T5)                                                                                                                                                                                              |
| --------------------------------------------- | ------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catan Prospers (6th: A Beautiful Day)         | 16     | 3, 4, 5×2, 6×2, 8×4, 9×3, 10×2, 11 | No event.                                                                                                                                                                                                |
| Robber Attacks!                               | 6      | 7                                  | Resolve as a 7: discards, move robber, steal 1 card.                                                                                                                                                     |
| Robber Flees!                                 | 2      | 4, 4                               | The robber **returns to the desert**; nobody is robbed. With no desert (Fishermen, Rivers, Caravans, BA, T&B): robber off the board until the next 7/Knight (BA/T&B: nothing happens).                   |
| Epidemic                                      | 2      | 6, 8                               | Cities produce only **1** card this turn.                                                                                                                                                                |
| Earthquake                                    | 1      | 6                                  | Each player turns **1 road** sideways ("damaged"). No new roads, and no settlements next to a damaged road, until the road is repaired (1 brick + 1 lumber). Damaged roads still count for Longest Road. |
| Good Neighbors                                | 1      | 6                                  | Each player gives 1 card of their choice to the player on their left (if they have any).                                                                                                                 |
| Neighborly Assistance (6th: Helpful Neighbor) | 2      | 10, 11                             | The player(s) with the most VP give(s) 1 card to a player with fewer VP (giver's choice, if any). Public VP.                                                                                             |
| Tournament                                    | 1      | 5                                  | Player(s) with the most face-up Knight cards take(s) 1 resource of choice from the bank.                                                                                                                 |
| Trade Advantage                               | 1      | 5                                  | Holder of Longest Road (if unclaimed: the single player with the most roads; tie → no event) draws 1 random resource from any player (no dev card).                                                      |
| Conflict                                      | 1      | 3                                  | Largest Army holder (if unclaimed: the single player with the most face-up Knights; tie → no event) takes 1 random resource from any player.                                                             |
| Calm Seas                                     | 2      | 9, 12                              | Player(s) with the most harbors (buildings on harbors) take 1 resource of choice from the bank.                                                                                                          |
| Plentiful Year                                | 1      | 2                                  | Each player takes 1 resource of choice from the bank.                                                                                                                                                    |
| New Year                                      | 1      | —                                  | Rebuild the deck; reveal.                                                                                                                                                                                |

The production-number multiset (excluding New Year): 2×1, 3×2, 4×3, 5×4, 6×5, 7×6, 8×5, 9×4, 10×3, 11×2, 12×1 = the 36 dice outcomes. Each full cycle uses 31 cards + New Year + 5 unseen = 37 cards in all.

**Scenario overrides:** BA/T&B (no robber): Robber Attacks → discard, then the active player draws 1 random card from a player of choice; Robber Flees → nothing; Conflict → player with strictly most knights **on the board** draws 1. T&B: Earthquake → moving a wagon along a damaged road costs 2 MP (as for a road-less edge). Fishermen/Rivers/Caravans: Robber Flees → off board. With **Catan for Two**: draw two cards per turn; an equal second card is not drawn (T5 text) / always use the second card (T6). With **Friendly Robber** as written. Dice are still needed for barbarian attacks, die-roll tie-breaks, etc.

### 4.3 Caravans pieces

#### 4.3.1 Camels

- A **camel** is an oriented piece on an **edge** (front = head vertex). 22 camels (33 with 5–6).
- One camel may share an edge with a road; one edge holds at most one camel.
- **Start:** the first camel of a caravan must go on the edge named in §2.4 (one per arrow, each caravan starts from a different arrow), pointing away from the oasis. It may **not** use an edge of the oasis hex.
- **Extend:** each later camel goes on a free edge that starts at the head vertex of the caravan's last camel and points away. At most **2** free edges exist (3 at a vertex minus the one you came from). Coastal edges are legal. Edges between water and water are not.
- **No branching.** Caravans may **merge**: when the heads of two caravans are on the same vertex, the next camel placed there continues as one caravan.
- A caravan **ends** when no edge is free at its head, or when the camel supply is empty (then all caravans end). A caravan may return to the oasis: a camel may go on an oasis-hex edge if its front reaches an oasis vertex that has a free edge (FAQ 42).
- If no legal placement exists for the pending camel, nothing is placed (§10 Q10).

#### 4.3.2 Voting round (T5 p.14)

After your turn ends, starting with you and going clockwise, each player may place any number of **wool and/or grain** cards face up. Each card is **1 vote**. Only players who bid ≥ 1 card take part. Each player has one chance to bid. Then:

1. A player with **more votes than all others combined** chooses the placement.
2. Else, a group of ≥ 2 players with a combined **majority** that agree on a placement sets it.
3. Else the player with the **most votes** chooses (even if a minority).
4. Else (tie for most) the **player who just finished the turn** chooses, even with 0 votes.

Then **all bids are discarded** to the bank. T6 replaces 1–4 with: each voter assigns **all** votes to one location; the location with the most votes wins; else the voter with most votes places; else the active player places (§0.3). Catan for Two: each round places **2 camels** (the winner places both, on 2 different caravans; on a tie each player places 1, active player first).

#### 4.3.3 Scoring effects

- **+1 VP** for every settlement or city located **between 2 camels**, i.e. on a vertex touched by ≥ 2 camel edges (any caravans). Cities get +1 too, once.
- A **road on the same edge as a camel counts as 2** for Longest Road (a road with no camel: 1; a camel with no road: 0). A 4-road chain with 2 camel-doubled roads counts as 6 (T5 p.14).

### 4.4 Catan for Two

- **Two production rolls** per turn, one after the other, before the Action phase. The second roll must **differ** from the first (re-roll until it does). After each roll, resolve it fully (production, or discards + robber on a 7). Neutral settlements never produce.
- **Neutral building:** each time you build a **road** (including Road Building cards, fish-token roads, bridges), also build **1 free road** for **either neutral player** (your choice), obeying normal placement rules for that neutral colour (must connect to that neutral's own piece; neutral roads count for Longest Road, and a neutral can hold the Longest Road tile). Each time you build a **settlement**, also build 1 free **settlement** for a neutral player, by the normal rules (distance rule; connected to that neutral's road). **If there is no legal neutral settlement spot, build a neutral road instead.** Cities, upgrades and dev cards do not trigger anything. With Rivers: after your bridge, a neutral bridge if a legal site exists, otherwise a neutral road (FAQ 27). Neutral pieces never receive resources or gold (FAQ 26).
- **Trade tokens** (20 in all, 5 each at the start): earn **2** when you build a settlement on the desert (adjacent to the desert hex), **1** when you build a settlement on the coast, **3** if it is both (FAQ 29); also during setup. **Once per turn** discard 1 of your **face-up** Knight cards → 2 tokens (the card goes to the dev discard pile, FAQ 35; this may change Largest Army: if afterwards you no longer hold strictly more face-up Knights than your opponent, or have fewer than 3, the Largest Army card is set aside, then the player with the most (≥ 3) takes it).
- **Spend tokens:** on your turn, before rolling or at any time in the Action phase, pay **1 token** if your public VP ≤ the other player's, else **2 tokens**, and take **one** action [T6: "once during your turn"]: **Forced Trade** (take 2 random cards from the other player's hand and give them 2 cards of your choice; if they hold only 1, take it and still give 2; if 0, impossible; you may give back the cards you took, FAQ 30/32) or **Move Robber** (to the desert; **no stealing**, FAQ 33; usable before rolling). Spent tokens return to the supply.
- Combination with Event Cards: see §4.2. Largest Army must not be excluded (so not with BA).
- Combination notes per scenario (T5): Fishermen → **no trade tokens**; each player starts with 5 fish (2×1, 2×2, 1×3); the player with fewer VP pays 1 fish less per action; fish arrive **only** from fishing grounds/lake rolls (not from settling on the coast or discarding Knights). Rivers → a settlement next to a swamp gives **+2 trade tokens**; "move robber to the desert" means a swamp. Caravans → place 2 camels per round; robber "to the desert" means off board. BA → after your first knight, build 1 **neutral knight** (free, normal placement) that both players may move; when you build a settlement and then a neutral settlement, **two** attacks resolve; "Move Robber" token action moves a barbarian instead; neutral knight's roll for prisoners is always **3**; a neutral knight is never removed; lost knights pay 2 gold + 1 trade token. T&B → settling next to a trade hex gives 1 token; neutral-road wagon fees are split half to the supply (rounded up) and half to the other player (rounded down); "Move Robber" token action moves a barbarian to a path without road or barbarian.

### 4.5 Fishermen — pieces and actions

#### 4.5.1 Fish tokens

- Hidden hand of tokens (1/2/3 fish). Not cards: not discarded on a 7, not stealable, not tradeable. Max 7 held.

#### 4.5.2 Fish actions (T5 p.9) — during your turn, any number, one at a time

| Cost   | Effect                                                                              |
| ------ | ----------------------------------------------------------------------------------- |
| 2 fish | Remove the robber from the board (no stealing). It returns on the next 7 or Knight. |
| 3 fish | Steal 1 random resource card from another player.                                   |
| 4 fish | Take 1 resource card of your choice from the bank.                                  |
| 5 fish | Build a road for free (normal placement rules).                                     |
| 7 fish | Draw a free development card.                                                       |

Pay with whole tokens (no change; an overpayment is lost) and finish paying one action before the next (FAQ 49). Spent tokens go face up beside the pool.

#### 4.5.3 Old boot

- Whoever draws it reveals it. It stays in front of that player, and that player needs **1 extra VP** to win (not a negative VP, FAQ 47, and not counted in the 7-token cap, FAQ 48).
- After the roll on your turn you may give it to any player whose **public** VP is **≥ yours** (FAQ 45). If you alone have the most VP you must keep it.

### 4.6 Rivers — pieces and actions

- **Bridge:** cost **2 brick + 1 lumber**; 3 per player; only on a bridge site; must connect to one of your roads, settlements or cities; counts as a road for Longest Road and for settlement connection; worth 0 VP; **you receive 3 coins**. The Road Building card cannot build a bridge. T6: cannot be built "past" an opponent's building.
- **Coins:** public; not resources (not stolen, not discarded, not taken by Monopoly). Gained: 1 per settlement built next to a river hex (**not** for an upgrade), 1 per road built on an edge next to a river hex, 3 per bridge. Spend: **2 coins → 1 resource of your choice from the bank, up to 2 times per turn** (may spend on the turn gained). Trade coins freely with other players. Maritime: **4 identical resources → 1 coin** (3 with a 3:1 harbor; 2:1 harbors do not help, T5).
- **Wealthiest Settler** (+1 VP): the player with **strictly the most coins**; ties → nobody. **Poor Settler** (−2 VP): every player tied for the **fewest** coins (even 0). Recompute after every change; the tile moves as soon as the condition changes.

### 4.7 Traders & Barbarians — pieces and actions

#### 4.7.1 Trade hexes

See §2.6. You may build **roads** on interior spokes and on a trade hex's land-side edges (never on its sea sides). You may **not** settle on the plaza. You may settle/city on the settlement corners (distance rule applies).

#### 4.7.2 Commodities

| Trade hex  | Needs (delivery target of…) | Produces (tokens in its stack) |
| ---------- | --------------------------- | ------------------------------ |
| Castle     | glass, marble               | tools, sand                    |
| Quarry     | tools                       | marble, sand                   |
| Glassworks | sand                        | glass, tools                   |

Delivery routes: **glass → castle, marble → castle, tools → quarry, sand → glassworks.** Each stack has 12 tokens [inferred: 6 of each of its two types]; 36 total.

#### 4.7.3 Wagon movement (end of turn, after trade/build)

- Wagons move vertex to vertex along edges (including spokes into plazas). Several wagons may share a vertex.
- Start each turn with **4 movement points (MP)**; upgrade for more. Pay **1 grain** once per turn (after any MP already used) for **+2 MP** this turn.
- **Edge cost:** 2 MP with no road; **1 MP** with one of **your** roads; **1 MP + 1 gold paid to the owner** with another player's road; **+2 MP** if a barbarian stands on the edge. You cannot enter an edge unless you can pay all its MP (no partial moves). Unused MP are lost. You may stop on any vertex.
- **Plazas:** entering a trade hex plaza **ends** your move at once.
- **Driving off a barbarian** (needs ≥ 1 upgrade): while stopped on a vertex next to a barbarian's edge, roll 1 die; if it is in your card's range, **move that barbarian** to any path without a barbarian (no stealing). Each barbarian may be attempted once per turn; you then keep moving. FAQ 66: not after your move has ended. FAQ 68: you cannot drive a barbarian off and then avoid using that path.
- **Initial destination:** none is declared in the engine; your first plaza visit with no commodity gives no gold (nothing to deliver) and you draw the top token of that hex's stack.
- **Delivery:** if you hold a commodity and stop on the plaza of the hex that wants it: turn the token face down (**1 VP**), take gold = your card's value (1–5), then draw the top token of that hex's stack as your next commodity. One commodity at a time.

#### 4.7.4 Baggage train cards (per player, 5 cards)

| Card | MP  | Gold per delivery | Drive-off die values | Upgrade cost to reach it                            |
| ---- | --- | ----------------- | -------------------- | --------------------------------------------------- |
| 1    | 4   | 1                 | none                 | —                                                   |
| 2    | 5   | 2                 | 6                    | 1 lumber + 1 wool + 1 ore                           |
| 3    | 6   | 3                 | 5–6                  | 1 lumber + 1 wool + 1 ore                           |
| 4    | 7   | 4                 | 4–6                  | 2 lumber + 1 wool + 1 ore                           |
| 5    | 7   | 5                 | 3–6                  | 2 lumber + 1 wool + 1 ore, **+1 VP** on reaching it |

The T6 wagon board prints exactly these numbers and costs [img T6 p.22]; the T5 cards agree on MP and gold (4/5/6/7/7, 1–5) and on card 2's roll of 6 [img T5 p.20, 22]. Costs and the ranges for cards 3–5 on the T5 cards are [inferred from T6] (§10 Q12). Upgrade during trade/build, one card at a time in order 1→5; no per-turn limit is stated (recommended: unlimited if you can pay).

#### 4.7.5 Barbarians (T&B)

3 barbarians stand on edges; one per edge; roads may still be built under them. Moved by a 7, a Knight card, a successful drive-off. They never conquer.

#### 4.7.6 T&B dev cards (25)

| Card                                            | Copies | Effect                                                                                                                                                                                                                  |
| ----------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Knight                                          | 16     | Move 1 barbarian to another path. If you place it on a road you may draw 1 resource card from the road's owner. No Largest Army effect is documented for the barbarian-moving "Knight" besides the base tile (§10 Q13). |
| Road Building                                   | 3      | Place 2 roads as if you had just built them (no bridges).                                                                                                                                                               |
| Swift Journey                                   | 3      | If you have moved your wagon in the regular way this turn, move it **again** (a fresh set of MP; pay grain again for +2; also after reaching a plaza; FAQ 69, 70).                                                      |
| Victory Point (Toolmaking, Glassmaking, Quarry) | 3      | 1 VP each; reveal only when with it you reach the target.                                                                                                                                                               |

Base dev-card timing applies (one per turn, not the turn bought except VP).

### 4.8 Barbarian Attack — pieces and actions

#### 4.8.1 Barbarians land

Every time you **build a settlement or upgrade to a city** (and only then; not setup), **interrupt your turn** and resolve an attack **if barbarians remain in the supply**:

1. Roll the dice until the result is **not 7**; place 1 barbarian on the **coastal** hex with that number (if it already holds 3, place none and do **not** re-roll).
2. Roll until not 7 **and different from the first number**; do the same.
3. Roll until not 7 and different from both earlier numbers; do the same.

Stop when the supply is empty. With 5–6: the coastal 5 and 9 each exist twice; a 5 or 9 lands a barbarian on **both** hexes (up to 5 per attack).

#### 4.8.2 Conquest

- A coastal hex with **3 barbarians** is **conquered**: turn its token face down; it no longer produces; no more barbarians land on it.
- You may not build **roads** on edges adjacent to a conquered hex, nor **settlements** on vertices adjacent to one.
- A settlement/city is **conquered** when **every land hex around it is conquered** (frame and sea ignored). The castle and desert hexes can never be conquered, so buildings next to them are safe. Lay it on its side (still on its vertex): it gives **0 VP** and its **harbor is unusable**.
- T6: you may not build on the edges or vertices of a conquered hex at all.

#### 4.8.3 Knights

- Each player has 6 knights. A knight is an **edge piece**; one knight per edge.
- Enter only through dev cards (§4.8.5): **Knighthood** (castle edge), **Swift Knight** (any free edge).
- **Move** (P3, before expelling): each knight up to **3** edges (adjacent edge = shares a vertex), or up to **5** if you pay **1 grain** for that knight. Ignore roads, buildings and other knights while passing, but the final edge must be empty (yours or anyone's). **No knight may end on an edge of the castle hex**; knights standing there at the start of P3 must move.
- Removed knights return to their owner's supply.

#### 4.8.4 Expelling barbarians (P3, after moving)

For each coastal hex in the clockwise order of §2.5, with ≥ 1 barbarian on it: a **victory** happens if the number of knights on the hex's 6 edges (all players) is **strictly greater** than the number of barbarians on the hex.

On a victory:

1. **Prisoners:** the defeated barbarians (all on that hex) leave the board as **prisoners** and go to the "involved" players (those with ≥ 1 knight on an edge of the hex).
   - One involved player: gets all.
   - Several: each gets 1 if enough exist. If there are fewer prisoners than players, each involved player rolls a die; prisoners go to the highest rolls in descending order (re-roll ties); an involved player who gets none receives **3 gold**.
   - If one prisoner is left over after each involved player took 1, it goes to the player with the **most involved knights**; on a tie, tied players roll, the high roller takes it, the loser(s) get **3 gold**.
2. **Liberation:** if the hex was conquered, turn the token face up; adjacent conquered buildings stand up again (production, VP, harbor).
3. **Knight losses:** one involved player rolls a die (1&4, 2&5 or 3&6 picks an orientation family). Every knight **involved in this victory** standing on an edge of that family returns to its owner, who receives **3 gold per knight lost**.

Prisoners are held until the end of the game: **2 prisoners = 1 VP**; an odd prisoner is worth 0. Prisoners do **not** return to the supply (so the supply of barbarian landings runs out).

#### 4.8.5 BA development cards (26)

| Card                   | Copies | Effect                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Knighthood             | 14     | Place 1 of your knights on one of the **castle hex's 6 edges** that has no knight.                                                                                                                                                                                                                             |
| Swift Knight           | 4      | Place 1 of your knights on **any** edge that has no knight.                                                                                                                                                                                                                                                    |
| Treason                | 4      | Take **2 gold**; move 2 barbarians from 2 different coastal hexes to 2 other unconquered coastal hexes (a hex may not exceed 3). If fewer than 2 barbarians are on the board, take the missing ones from the supply. A source hex that was conquered is liberated; a destination reaching 3 becomes conquered. |
| Intrigue (T6: Capture) | 4      | Remove 1 barbarian from a coastal hex of your choice and take it as a prisoner. If none are on the coast, discard and draw again.                                                                                                                                                                              |

Each card is **played immediately when built** (the card is built, resolved, discarded). Empty deck → shuffle the discard pile.

#### 4.8.6 Gold (BA)

Same coin rules as Rivers (§4.6) — 2 gold → 1 card ≤ 2×/turn; trade gold; maritime 4:1/3:1 to gold; not a card; not stolen; no Monopoly. Sources: 3 gold per lost knight, 3 gold for a failed prisoner roll, 2 gold from Treason.

### 4.9 Harbormaster (T5 p.6; T6: Strongest Ports)

- **Harbor points:** a settlement on a harbor = 1, a city on a harbor = 2 (any harbor type; each vertex belongs to one harbor).
- The first player to have **3** gets the card (2 VP). A player with **strictly more** takes it. Ties: holder keeps it.
- The VP goal is **+1** (so Fishermen 11, Rivers 11, Caravans 13, BA 13, T&B 14; with the old boot +1 more).
- T6: "buildings on ports"; the combined games add their own +1.

---

## 5. Victory conditions and scoring

### 5.1 VP target by scenario (3–4 players, T5)

| Mode                                         | VP to win                                | Edition difference     |
| -------------------------------------------- | ---------------------------------------- | ---------------------- |
| Base game + any variants except Harbormaster | 10                                       | —                      |
| + Harbormaster                               | **+1** to whatever the scenario requires | T6: same               |
| Fishermen                                    | 10; **11 with the old boot**             | same (12/13 combos)    |
| Rivers                                       | 10                                       | same                   |
| Caravans                                     | **12**                                   | same (Merchant Trains) |
| Barbarian Attack                             | **12**                                   | same                   |
| T&B                                          | **13**                                   | same                   |
| Catan for Two                                | 10                                       | same                   |

5–6 players: targets are the same as for 3–4 players (T5-56 does not change them). The 2025 combination sheets set their own targets (§8.1).

### 5.2 VP sources by mode

| Mode             | VP sources                                                                                                  | Not used                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| All              | settlements 1, cities 2, Longest Road 2, Largest Army 2, VP dev cards 1                                     |                                           |
| Harbormaster     | card +2                                                                                                     |                                           |
| Fishermen        | old boot: +1 VP needed (not −1 VP)                                                                          |                                           |
| Rivers           | Wealthiest Settler +1; Poor Settler −2                                                                      |                                           |
| Caravans         | +1 per building between 2 camels; Longest Road counts camel-doubled roads                                   |                                           |
| Barbarian Attack | prisoners: 1 per 2; conquered buildings count 0                                                             | Largest Army tile, base dev cards, robber |
| T&B              | 1 per delivered commodity token (face-down tokens); +1 for reaching baggage card 5; 3 VP dev cards (1 each) | Longest Road tile, base dev cards, robber |

---

## 6. Edge cases and official FAQ rulings (numbered)

Numbers are the entry numbers on catan.com's T&B FAQ (read 2026-10-25). Wording is ours.

**Barbarian Attack**

1. Two captured barbarians = 1 VP; a single one is worth nothing yet (matters for tie questions about Master Merchant / Wedding).
2. A displaced knight goes to the next free path.
3. Surviving knights stay on their hex and fight again later if they outnumber the barbarians.
4. Knight losses are decided after each battle. A wounded knight cannot fight again.
5. All knights move first; battles come afterwards (no interleaving).
6. Treason places barbarians only on **coastal** hexes.
7. A knight placed on the castle must move, but only after you finish trading and building that turn.
8. After a victory, roll a die and place it on the castle; its result selects a pair of opposite paths, knights on paths of that orientation are removed.
9. With the Wonders scenario: a settlement next to the wasteland is threatened from the start.
   3–5 (with C&K): gold cannot be used for 3:1/4:1 trades; a Diplomat may move a road that carries a knight; knights may pass foreign knights, settlements and cities. 6 (with Seafarers): a conquered settlement stays but interrupts a trade route.

**Event Cards**

12. A knight may be built next to a damaged road. 13. A Diplomat cannot remove a damaged road and replace it. 14. With the red die: reveal the card and roll the event die; the red die value is printed on the card (Mayfair); German edition rolls the red die. 15/16. Alchemist: play it _instead of_ revealing a card, then roll only the event die; you cannot play it and then reveal. 17. "Robber flees!" does not move the pirate. 18. With no desert the robber waits beside the board until a 7 or Knight. 19. Ships can be built when a road is damaged but roads cannot be continued. 20. A ship cannot be turned sideways instead of a road. 22. A settlement may not touch only a damaged road; it may touch an intact road or ship. 23. Road Building can repair a damaged road. 24. The event comes **before** production. 21. A bridge can be built after an earthquake if it is next to an intact road or settlement.

**Catan for Two**

25. A road from a development card or fish token also triggers a neutral road. 26. Neutral players never get gold (so never Wealthiest Settler). 27. A bridge you build also triggers a neutral bridge, otherwise a road. 28. Only face-up VP count for trade-token costs. 29. A settlement touching the desert **and** the coast gives 3 tokens. 30. You may hand back cards received in a forced trade. 31. A dev card may move the robber between the two production rolls. 32. Forced trade with fewer than 2 cards: take 1 and give 2; with 0 cards no trade. 33. No stealing after the robber token action. 34. Tokens may be used before rolling. 35. Knights discarded for tokens go to the discard pile.

**General**

36. No wooden German edition exists. 38. Other scenario combinations are on catan.com's core-family games page.

**Harbormaster**

37. A C&K metropolis counts 2 points.
38. A Forgotten Tribe harbor gives no harbor point unless it can be built at once.

**Fishermen**

43. The C&K Aqueduct gives a resource if only fish were received (fish are not resources). 44. 3 fish may be paid to steal before the barbarians arrive. 45. Only face-up VP count for the old boot. 46. The last setup settlement next to a fishing ground gives a fish token. 47. The old boot does not reduce VP; the owner needs 1 more. 48. It does not count toward the 7-fish limit. 49. Each action is paid separately, so overpaying may happen. 50. The robber may go on the lake. 51. Fish cannot be traded. 52. When exchanging fish at the limit you draw from the **face-down** supply, never the discard.

**Friendly Robber**

53. The pirate is friendly too. 54. Face-down VP are not considered. 55. The robber may sit next to your own building if all other spots touch players under 3 VP. 56. If all opponents have 2 VP you may move the robber without stealing.

**Rivers**

58. With Seafarers: ships may be built on dotted lines if they would be allowed without the line. 59. River source hexes are river hexes. 60. Roads cannot cross a river (only the 2005 giveaway edition allowed it).

**Caravans**

40. Camels affect neighbouring ships. 41. A camel may be placed on the coast (a land/water edge is a path). 42. A camel may be placed on the oasis hex's edge when the caravan returns, if the last camel faces a free intersection at the oasis.

**T&B**

62. With C&K: only the two production dice are re-rolled on 2/12 (not the event die). 63. Barbarians on roads may be driven off before the first attack. 64. A Diplomat can move a road with a barbarian on it. 65. A wagon can move from a road onto a ship without a settlement between (Seafarers). 66. A barbarian cannot be driven off after the wagon's move has ended. 67. MP cannot be bought in advance. 68. You cannot drive off a barbarian and then avoid using the path. 69. Swift Journey can be used after reaching a trade hex. 70. Swift Journey grants one more full use of the MP; grain must be paid again.

**Rulebook-only rulings used in this document** (numbered 71+ by us, not FAQ entries)

71. T5 p.14: "each player is offered only one opportunity to vote"; later bids cannot be added.
72. T5 p.17: a victory needs ≥ 1 barbarian on the hex and **more** knights than barbarians.
73. T5 p.9: if there are not enough fish tokens for everyone's payout, nobody gets any that turn.
74. T5 p.10: the Rivers scenario states "you can start the game with up to 4 coins".

---

## 7. Interactions with base rules

| Base rule (RULES.md §) | Change in T&B                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Robber/7 (§5)          | BA, T&B: no robber (see §3.2). Fishermen: robber off board at start; 2-fish removal; no robber on fishing grounds; may go on the lake. Rivers: robber starts on a swamp; may be moved to any hex (swamps are not special). Caravans: off board, enters on first 7/Knight (not on the oasis). Friendly Robber. Event "Robber Flees". |
| Trading (§6)           | Domestic trade may include **gold** (Rivers/BA/T&B) but not fish, trade tokens or commodities. Maritime: coins at 4:1/3:1. The "2 gold → 1 card" bank action is up to 2×/turn.                                                                                                                                                      |
| Building (§7)          | Rivers: bridges; road ban on bridge sites; coin rewards. BA: city instead of 2nd settlement; conquered hex bans. T&B: trade-hex path rules; city 2nd. Earthquake blocks roads/settlements.                                                                                                                                          |
| Dev cards (§8)         | BA and T&B **replace** the base deck; BA cards are played at once. Fishermen: 7 fish → a free dev card. Rivers: Road Building cannot build bridges; Monopoly cannot take coins.                                                                                                                                                     |
| Longest Road (§9)      | Camel-doubled roads (Caravans); bridges count as roads (Rivers); **no tile in T&B**; damaged roads count (Earthquake). Neutral players can hold the tile (Catan for Two).                                                                                                                                                           |
| Largest Army (§10)     | **Not used in BA.** Catan for Two needs it. Discarding Knights for tokens can change it.                                                                                                                                                                                                                                            |
| Victory (§11)          | Different targets (§5.1); Poor Settler −2; Wealthiest +1; old boot; Harbormaster +2. Check at any point in your own turn.                                                                                                                                                                                                           |
| Hand size              | Gold, fish, trade tokens, commodities are never cards.                                                                                                                                                                                                                                                                              |
| Setup (§2)             | BA/T&B second settlement = city. Fishermen: fish token for 2nd settlement next to fishing ground. Rivers: setup coins.                                                                                                                                                                                                              |
| 5–6 (§16)              | SBP restrictions (§3.8).                                                                                                                                                                                                                                                                                                            |

---

## 8. Combinations

### 8.1 Official 2025 sheets for T&B scenario pairs (CMB; edition T6)

| Combination                   | Setup and rule changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | VP to win    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **Barbarian Attack + T&B**    | BA board; return 1 forest, 1 pasture, the desert; 3 commodity hexes + 9 X markers + castle in their normal places; coast 2 hills 1 forest 2 pasture 2 fields 1 mountain, inner 1 hill 1 forest 1 pasture 2 fields 2 mountains; the castle commodity hex gets the **12** disc, the glassworks the **2** disc; no Longest Route, Largest Army or robber; BA dev cards; start barbarians 1 on castle, 1 on glassworks. Barbarians are placed on a hex **and associated with an edge/path** (center if full); a conquered commodity hex stops producing but deliveries are unaffected; 2/12 → place a barbarian on that coastal hex (no re-roll); 7: discard, **no barbarian move**, steal 1 random card; a successful drive-off places the barbarian on any unconquered hex. | **14**       |
| **Merchant Trains + BA**      | BA board, watering hole replaces the desert (coastal, so only 2 start locations); barbarians do not affect wagons.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 12           |
| **Merchant Trains + T&B**     | Return 1 hill, 1 forest, 1 pasture, the desert; commodity hexes, X markers, watering hole at center; **commodity hexes produce**: quarry brick, glassworks wood, castle wool; no Longest Route/robber; barbarians don't affect wagons.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **15**       |
| **Fishing + Merchant Trains** | Lake replaces a forest, next to the watering hole; the 12 disc shares the hex with the 2 disc.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 12 (13 boot) |
| **Fishing + Rivers**          | No lake; 6 fish pay for a free bridge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 10 (11 boot) |
| **Fishing + BA**              | No lake; 2 fish move one of your knights up to 5 edges (no robber); no fish builds on a conquered hex's edges; conquered buildings get no fishing production.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 12 (13 boot) |
| **Fishing + T&B**             | No lake; 2 fish = +2 wagon MP (no robber).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 12 (13 boot) |
| **Rivers + BA**               | Return 2 hills, 1 forest, 2 pastures, 2 mountains, the desert; castle and river tiles in place; coast 1 hill 2 forests 2 pastures 2 fields, inner 1 forest 2 fields 1 mountain; the 2/12 hex also receives a barbarian for either number; Poor Catanian gives no −VP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 12           |
| **Rivers + Merchant Trains**  | Return 2 hills, 2 pastures, 1 field, 2 mountains, the desert; watering hole at center; the 2 and 12 discs go on the two number-3 hexes; wagons may be placed on bridge sites and treat bridges as roads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 12           |
| **Rivers + T&B**              | Return 2 hills, 1 forest, 3 pastures, 1 field, 2 mountains, the desert; commodity hexes + X markers, river tiles not adjacent; the 2 disc shares the 12 hex; players start with 3 gold plus setup gold (settlement/city on a river tile gives 1 gold **only during setup**); bridges give **2** gold; Poor Catanian gives no −VP; wagon MP across a river: 3 without a bridge, 1 with your bridge, 1 + 2 gold with another player's bridge. Commodity hexes produce (quarry brick, glassworks wood, castle wool).                                                                                                                                                                                                                                                         | **13**       |

### 8.2 T5-era combinations

T5 states that every variant combines with every scenario (with per-scenario notes already included in §4.4 and the scenario sections), and with the T&B and Seafarers scenarios "in theory"; scenario×scenario combinations were published on catan.com (no longer indexed). **Do not implement** scenario×scenario combinations for T5; if wanted, use the CMB sheets above (T6) as a ruleset.

Per-variant combination rules from T5:

| Variant                         | With                               | Rule                                       |
| ------------------------------- | ---------------------------------- | ------------------------------------------ |
| Friendly Robber                 | everything                         | none                                       |
| Event Cards                     | every scenario                     | §4.2 overrides; C&K event die still rolled |
| Harbormaster                    | every scenario                     | VP goal +1                                 |
| Catan for Two                   | all but those without Largest Army | §4.4 per-scenario notes                    |
| Harbormaster + Fishermen/Rivers |                                    | 11 (12 with boot)                          |

### 8.3 Other expansions (out of scope for the engine)

Seafarers and Cities & Knights combinations exist for most variants and scenarios (T6 index at https://www.catan.com/traders-barbarians, "Combinations with Seafarers / Cities & Knights"). We do not support them. FAQ items that mention them (3–5, 6, 43, 44, 53, 58, 62–65) are listed in §6 for reference only.

### 8.4 5–6 players (summary)

| Item          | Rule                                |
| ------------- | ----------------------------------- |
| Turn          | SBP (T5-56) or paired turn (T6-56). |
| Boards        | §2.2–2.6.                           |
| Extras        | §1.3.                               |
| Special rules | §3.8.                               |

---

## 9. Implementation notes for the engine

### 9.1 Order of work

1. **Framework:** `settings.expansion = { edition, variants, scenario }`, extra state slices, board features (§9.3), setup builders.
2. **Variants** (small, independent): Friendly Robber → Harbormaster → Event Cards → Catan for Two.
3. **Scenarios:** Fishermen → Rivers → Caravans → Barbarian Attack → Traders & Barbarians (the Campaign order; BA and T&B are the large ones).
4. 5–6 maps/rules last (§2, §3.8).

### 9.2 New settings

```ts
tb?: {
  edition: 'tb5' | 'tb6';
  scenario?: 'fishermen' | 'rivers' | 'caravans' | 'barbarianAttack' | 'tradersBarbarians';
  friendlyRobber?: boolean;
  harbormaster?: boolean;     // vpToWin + 1
  eventCards?: boolean;       // replaces balancedDice
  forTwo?: boolean;           // 2 real players, 2 neutral
}
```

Rules: scenarios are mutually exclusive (unless a CMB combination is added later); `forTwo` needs `players = 2`; `eventCards` and `balancedDice` are mutually exclusive; BA excludes `forTwo` Largest-Army parts; `vpToWin` defaults per §5.1 and is derived, not stored twice.

### 9.3 New board features (`topology`)

| Feature           | Representation                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New terrains      | `lake`, `oasis`, `castle`, `quarry`, `glassworks`, `swamp` (+ `riverHex: boolean`).                                                                                                                                                   |
| Fixed hex layouts | A `ScenarioMap` that lists fixed hexes (`h:q,r → terrain/token`) and the random pools (§2). Token layouts for BA and 5–6 are explicit.                                                                                                |
| Fishing grounds   | `{ id, number, vertices: [v,v,v] }` stored in topology (not hexes). Production uses `vertices`. Lake is a hex with `tokens: [2,3,11,12]` (a hex may carry several numbers).                                                           |
| Bridge sites      | `bridgeSites: EdgeId[]` (§2.3). `canPlaceRoad` must reject them; `canBuildBridge` accepts only them.                                                                                                                                  |
| Trade hexes       | extra vertex `plaza` per trade hex and 4 (or 6) **spoke edges** `s:q,r,k`; `isBoardVertex/Edge` and adjacency must include them for roads, wagon movement, barbarians. Plaza is not buildable. Corner hex sea-sides are non-roadable. |
| Camel edges       | any board edge, but each edge also has `camel?: { caravan, head }`.                                                                                                                                                                   |
| Edge pieces       | A second map `edgePieces: Record<EdgeId, { knight?: playerId; barbarian?: true; camel?: ...; wagon?: ... }>`.                                                                                                                         |
| Conquered         | `conquered: Record<HexId, boolean>`, `barbarians: Record<HexId, number>` (BA) ; T&B barbarians on edges.                                                                                                                              |

### 9.4 New state

```ts
interface TbState {
  fish?: { pool: FishToken[]; discard: FishToken[]; hands: FishToken[][]; boot: PlayerId | null };
  coins?: { balance: number[] }; // Rivers / BA / T&B
  rivers?: { bridgesLeft: number[] }; // bridge pieces
  caravans?: {
    camelsLeft: number;
    caravans: { edges: { edge: EdgeId; head: VertexId }[] }[];
    startUsed: boolean[];
    pendingCamels: number;
    vote?: VoteState;
  };
  ba?: {
    supply: number;
    onHex: Record<HexId, number>;
    prisoners: number[];
    knights: Record<PlayerId, number>;
    devDeck: BaCard[];
  };
  tb?: {
    wagon: Record<PlayerId, VertexId>;
    baggage: number[];
    commodity: (Commodity | null)[];
    stacks: Commodity[][];
    delivered: number[];
    barbarians: EdgeId[];
    grainBonus: boolean;
    moved: boolean;
  };
  forTwo?: {
    tradeTokens: number[];
    supplyTokens: number;
    neutral: [PlayerPieces, PlayerPieces];
    rollsLeft: number;
  };
  events?: { deck: EventId[]; discard: EventId[]; current: EventId | null };
  harbormaster?: PlayerId | null;
}
```

Derived (never stored): Wealthiest/Poor (from `coins`), VP totals, conquered buildings, caravan scoring.

### 9.5 New phases and actions

| Phase                  | Actions                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `preRoll`, `main`      | `spendFish{action}`, `giveBoot{to}`, `spendCoins{resource}`, `buyCoin{give}`, `buildBridge{edge}`, `useTradeTokens{action:'forcedTrade'\|'moveRobber', …}`, `discardKnightForTokens`, `upgradeWagon`, `playKnight`-variants per deck |
| `roll` (Catan for Two) | two rolls: a phase value `{ rollsLeft }`                                                                                                                                                                                             |
| `barbarianAttack` (BA) | none needed if resolved atomically inside `buildSettlement/buildCity` with RNG; log each roll. Treat as automatic.                                                                                                                   |
| `knightMove` (BA, P3)  | `moveKnight{from,to,grain}`, `endKnightMove`; after it, **automatic** `expel` (needs RNG for dice; if a player must choose nothing, no decision).                                                                                    |
| `wagonMove` (T&B, P3)  | `wagonStep{edge}`, `payGrain`, `driveOff{barbarian}`, `endWagon`.                                                                                                                                                                    |
| `caravanVote`          | `bidVote{wool,grain}` in seat order, then `assignVote{location}` per bidder (or an auto-resolver for bots), then `placeCamel{edge}` by the winner.                                                                                   |
| `eventRoll`            | automatic: reveal, resolve, produce. Some events ask for choices (resource of choice; steal target; card to give) → short decision phases.                                                                                           |

Deterministic randomness must go through the state RNG: fish draws, event deck shuffles, barbarian dice, tie-break dice, knight-loss die, drive-off die, second Catan-for-Two roll, commodity stacks.

### 9.6 What the HUD must show

- Always: scenario/variants badge, VP goal (with the +1 effects), hidden/visible VP.
- Fishermen: fish count per player (hidden for others; count only), boot owner, pool size, fish action buttons with costs (2/3/4/5/7), fishing ground numbers and highlight on production.
- Rivers: coins, Wealthiest/Poor markers, bridges left, bridge-site highlights.
- Caravans: caravan paths, pending camel, vote UI (bid wool/grain, assign), +VP vertices.
- BA: barbarian counts per coastal hex, conquered hexes, knights per edge, prisoners, supply, knight-move UI with grain toggle, castle orientation.
- T&B: wagon positions, MP remaining, edge costs preview, gold owed, commodity held, delivered tokens, baggage card (MP/gold/drive-off range), plaza highlights, barbarians on edges.
- Catan for Two: neutral pieces (distinct colour), trade tokens, "second roll" indicator.
- Event Cards: current event card with text, deck progress (next New Year hidden), history.
- Friendly Robber: illegal hexes greyed out with the reason.

### 9.7 What bots need

- `legalActions` must enumerate all new actions (cap the combinatorics: knight moves by `from`/`to` pairs with reachable set; wagon moves step by step; voting as a small enumerated set).
- A random bot needs: end condition for P3 phases (`endKnightMove`, `endWagon`), safe default for a vote (bid 0), a deterministic choice for choices of "resource of choice".
- Simulator: add a headless full-game test per scenario (random bots, 200 seeds, never stuck, VP target reachable).

### 9.8 Suggested test list

**Framework/board**

1. Each scenario map builds with the exact terrain counts of §2; tokens count per scenario; harbors 9; every hex id valid.
2. BA token table matches §2.5; every non-7 number is on exactly one coastal hex (3–4), and 5/9 twice (5–6).
3. T&B trade hexes: plaza vertex, spokes, settlement corners, sea-only corners per §2.6; road on sea side rejected; settlement on plaza rejected.
4. Rivers: bridge sites count 7 (3–4) / 11 (5–6); road on a bridge site rejected; bridge accepted only on sites and only when connected.

**Variants** 5. Friendly Robber: robber cannot move next to a 2-VP player; fallback to desert; no steal from 2-VP players; 7 discards unchanged; hidden VP ignored. 6. Harbormaster: 1/2 points for settlement/city; first to 3 gets the card; strictly more takes it; VP goal +1. 7. Event deck: composition (36, 5 unseen + New Year + 31); New Year rebuild; every event effect; C&K flavour text ignored; production uses the card's number. 8. Event + no-robber scenarios: Robber Attacks/Flees/Conflict overrides. 9. Catan for Two: two rolls differ; each roll resolves 7s; neutral road after each road; neutral settlement or fallback road; no neutral on city/dev card; trade token income (desert 2, coast 1, both 3); forced trade (0/1/2+ cards); robber to desert no steal; cost 1 vs 2 by public VP; knight-discard changes Largest Army.

**Scenarios** 10. Fishermen: fishing ground and lake production (settlement 1, city 2); robber on lake blocks all four numbers; robber cannot go on a fishing ground; supply shortage → nobody; 7-fish cap exchange; old boot give-away and 11 VP; each fish action; boot not stealable. 11. Rivers: coin awards (settlement, road, bridge 3, not city upgrade), 2→1 card ≤ 2/turn, maritime coins, Wealthiest/Poor derivation including ties at 0, 2/12 on one hex, swamp robber start. 12. Caravans: first camel only on the 3 start edges; extend rules; merge; end; oasis return; voting algorithm (all four steps, ties); camel on road edges; Longest Road doubling; +1 VP between 2 camels; 22-camel cap; setup builds don't place camels; one camel per turn regardless of builds. 13. BA: attack rolls (non-7, distinct, full hex no re-roll, supply empty stops); conquest of hex/building; build bans; knight placement and movement (3/5 edges, grain, castle-must-move, ending on occupied edge rejected); victory detection and clockwise order; prisoner distribution (single, multi, shortage, leftover, ties); knight-loss die; liberation; 2 prisoners = 1 VP; Treason/Intrigue edge cases; immediate dev card resolution; deck reshuffle. 14. T&B: MP costs (own/other/none/barbarian), +2 MP grain once, partial move rejected, plaza ends move, delivery routes, gold payments, stack draw, baggage upgrades and VP, drive-off roll ranges, 7 moves a barbarian and steals, 2/12 re-roll, Swift Journey, no Longest Road. 15. 5–6: each map builds; SBP restrictions (no fish, no gold, no wagon); camel after SBP; BA checks after each SBP step. 16. Win checks: each scenario's target, boot +1, Harbormaster +1; win only on own turn; prisoner VP at P3 triggers a win. 17. Determinism: same seed → identical logs for each scenario with random bots.

### 9.9 Edition flags (T5/T6)

`friendlyRobberStealOnFallback`, `eventDeckTwoCardEqualReuse`, `fishSupplyReshuffleWhenEmpty`, `fishOnceExchange`, `fishLakeFixedInner`, `bridgeBlockedPastOpponent`, `maritimeGold2to1`, `caravanVotePlurality`, `baNoBuildOnConquered`, `mpWagonBoard` (data-only), `pairedPlayersInsteadOfSBP`.

---

## 10. Open questions and ambiguities (our recommendation)

| #   | Question                                                                                                                           | Recommendation                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Fishing ground positions (T5): "free vertex of each frame section"; the exact vertex is not fixed.                                 | Random free coastal "V" per section, stored in topology; use the T6 fixed spots when `edition = tb6`.                     |
| Q2  | Lake position (T5): "not on the coast".                                                                                            | Random inner hex.                                                                                                         |
| Q3  | Bridge sites at the swamp mouths: derived from the 7-site count and the dotted lines.                                              | Use §2.3; the 5–6 count of 11 is our extension.                                                                           |
| Q4  | Trade-hex spokes: which 4 corners do they reach?                                                                                   | The 4 settlement corners (§2.6).                                                                                          |
| Q5  | Fish at the 7-token cap: T5 "exchange one", T6 "once per turn, then stop".                                                         | T6 wording (once per turn).                                                                                               |
| Q6  | Is a Rivers upgrade to a city next to a river rewarded?                                                                            | No (T5 explicit).                                                                                                         |
| Q7  | Harbormaster holder drops (conquered harbor building in BA).                                                                       | Recompute: holder keeps the card if still ≥ 3 and ≥ all others; else a unique maximum ≥ 3 takes it; else it is set aside. |
| Q8  | Friendly Robber: does a mover with only 2 VP also forbid their own buildings?                                                      | No: opponents' buildings only (FAQ 55 allows own).                                                                        |
| Q9  | BA: can a conquered city be upgraded/rebuilt? A settlement adjacent to a conquered hex (but not itself conquered) may upgrade.     | Upgrades allowed unless the building itself is conquered. T6: nothing may be built on an edge/vertex of a conquered hex.  |
| Q10 | No legal camel placement / no knight edge available / no knights in supply?                                                        | The pending camel is skipped; the card does nothing and is discarded (BA); report in the log.                             |
| Q11 | Treason: may both destinations be the same hex?                                                                                    | No: two different destination hexes, each different from its source.                                                      |
| Q12 | Baggage train cards 3–5 costs/ranges on T5 cards (not readable).                                                                   | Same as T6 (§4.7.4).                                                                                                      |
| Q13 | T&B: does a Knight card count for Largest Army? (Largest Army is not excluded in T&B, and Conflict mentions knights on the board.) | Yes: Largest Army is in play in T&B; the barbarian-moving Knight counts as a played Knight.                               |
| Q14 | T&B 5–6: old-design (4-corner) vs new-design (6-corner) trade hexes.                                                               | All six use the 6-corner/12-path design.                                                                                  |
| Q15 | Event card + T&B: card with production 2 or 12 (no tokens exist).                                                                  | Resolve the event; no hex produces. Do not re-draw.                                                                       |
| Q16 | Caravan vote: T5 coalition rule vs T6 plurality.                                                                                   | Implement T5's four steps for `tb5`; T6's rule behind `caravanVotePlurality`.                                             |
| Q17 | Catan for Two: once per turn or many token actions?                                                                                | Once per turn (T6 explicit).                                                                                              |
| Q18 | Gold supply exhaustion (25 + 15 coins).                                                                                            | Unlimited coins.                                                                                                          |
| Q19 | Trade token supply (20 tokens).                                                                                                    | Track the supply; if the supply is short, take what is left.                                                              |
| Q20 | Knights: can a knight stay put in P3 (0 moves)? Distance counted as steps in the edge-adjacency graph.                             | Yes (except castle-edge knights); BFS over edges sharing a vertex, passing through anything.                              |
| Q21 | Barbarians on the sea-sides of trade hexes / spokes.                                                                               | Allowed anywhere a wagon can move (every edge incl. spokes and sea sides).                                                |
| Q22 | T5 wagon: gold owed when passing several foreign road edges in one move.                                                           | 1 gold per edge, paid when entering it; reject if unpayable.                                                              |
| Q23 | Dice in event-card games for BA/T&B/Fishermen die rolls.                                                                           | The engine always has seeded dice; event cards only replace the production roll.                                          |
| Q24 | Neutral piece limits (5 settlements, 15 roads each) in Catan for Two.                                                              | Enforce; when a limit is hit the neutral build is skipped.                                                                |
| Q25 | The `Largest Army` interplay with the token-discard rule in a tie.                                                                 | After the discard: if the holder is not **strictly** ahead, release; then a unique maximum (≥ 3) takes it.                |

---

## 11. Engine status (E4)

Module `tb` (`src/expansions/tb`), one mode `tb` with six scenarios: `tb/fishermen`,
`tb/rivers`, `tb/caravans`, `tb/barbarianAttack`, `tb/traders` and `tb/variants` (the base
board with the T&B variants only). Edition: **T5** (+ T5-56). Each scenario switches on a
_feature_ (`featuresOf` in `engine/state.ts`); a 2-player game is Catan for Two. Tests: one file
per feature under `engine/` (`*.test.ts`), plus `sound.test.ts` (every legal action accepted,
JSON-safe, input never mutated) and `module.test.ts` (settings). Sim invariants: `bots.ts`.

Status: **OK** = implemented and tested; **ours** = our reading of an open point (§10); **—** = not
implemented.

### 11.1 Variants

| Rule (§)                 | Status   | Engine                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Friendly Robber §4.1     | OK       | The core variant `robberMode: 'friendly'` (RULES.md §18). Refused in BA / T&B (no robber).                                                                                                                                                                                                                                                               |
| Event Cards §4.2         | OK       | The core variant `eventCards` (V1). Robber Flees: off the board in Fishermen / Rivers / Caravans (`onRoll`), nothing in BA / T&B (the robber never enters, `afterAction`). Robber Attacks = 7 with each scenario's 7 rule. A 2 / 12 card in T&B: the event, no production (Q15). Conflict counts played Knights (not knights on the board: deviation).   |
| Harbormaster §4.9        | OK       | Option `tb.harbormaster` (`vpBonus: 1`): harbour points settlement 1 / city 2 (conquered buildings 0), first to 3, strictly more takes it, the holder keeps it on a tie; recomputed after every action; 2 VP part "Harbormaster". Q7: holder drops below 3 or is beaten → the unique leader with 3+ or nobody.                                           |
| Catan for Two §2.1, §4.4 | OK       | 2 players (`isTwo`): neutral settlements on `v:1,-2,S` / `v:-1,2,N`; a neutral road after each road (built, free, fish road, bridge: a neutral bridge if a site is free, FAQ 27), a neutral settlement after each settlement, else a road (`tb/neutral` phase).                                                                                          |
| — two rolls              | OK       | After the first roll is resolved the phase returns to `preRoll`; the second total differs (`rollDice` hook). Event Cards: the second card is always used (T6).                                                                                                                                                                                           |
| — trade tokens           | OK       | 5 each + 10 in the supply; desert 2 / coast 1 / both 3 (FAQ 29), Rivers: swamp 2, T&B: next to a trade hex 1; supply-limited (Q19). One token action per turn (Q17): Forced Trade (take 2, give 2 back, FAQ 30/32), robber to the desert without stealing (FAQ 33; Rivers: a swamp; Caravans: off the board; T&B: a barbarian to a path without a road). |
| — Knight for tokens      | OK, ours | Once per turn, 2 tokens; Largest Army set aside unless still strictly ahead with 3+ (Q25).                                                                                                                                                                                                                                                               |
| — neutral Longest Road   | OK, ours | A neutral trail of 5+ beats players with a shorter trail (`roadLength` hook); the holder keeps it on a tie.                                                                                                                                                                                                                                              |
| — scenario notes         | OK / —   | Fishermen: no tokens, 5 fish each, the player behind pays 1 fish less. Caravans: 2 camels per vote (the winner places both). T&B: neutral-road toll to the supply. BA: not offered (no Largest Army; scenario players 3-6).                                                                                                                              |

### 11.2 Scenarios

| Rule (§)                    | Status   | Engine                                                                                                                                                                                                                                                                                                     |
| --------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fishermen board §2.2        | OK, ours | `tb/fish19` / `tb/fish30`: lake on a random inner hex (Q2), 2 lakes for 5-6; fishing grounds on a free coastal notch per frame section (Q1), each touching the notch and its 2 coastal neighbours. Robber off the board.                                                                                   |
| Fish production §3.3        | OK       | `afterProduction`: grounds and lakes pay 1 / 2 per settlement / city, the robber on the lake blocks it; nobody gets fish when the pool is short (73); boot revealed; the pool refills from the spent tokens. Second setup settlement on a ground / the lake: 1 fish.                                       |
| Fish cap §3.3               | OK, ours | 7 tokens: a bigger catch replaces the smallest held token (Q5: automatic T5 exchange).                                                                                                                                                                                                                     |
| Fish actions §4.5           | OK       | `tb/fish`: 2 robber off, 3 steal, 4 resource, 5 free road (`roadBuilding{1}`), 7 dev card; smallest overpayment picked (49); own turn, not in the SBP.                                                                                                                                                     |
| Old boot §4.5.3             | OK       | Hidden −1 VP (its owner needs one more, FAQ 47); `tb/giveBoot` after the roll to a player with ≥ public VP (FAQ 45).                                                                                                                                                                                       |
| Rivers board §2.3           | OK       | `tb/rivers19` (7 river hexes, 7 bridge sites, 2 on the 12) / `tb/rivers30` (10, 11, no 2-on-12). Robber starts on a swamp.                                                                                                                                                                                 |
| Bridges §4.6                | OK       | `tb/buildBridge` (2 brick + 1 lumber, 3 each, connected, +3 gold); bridges are road pieces (Longest Road, connection) marked in the slice; roads never on a site (`edgeBlocked`).                                                                                                                          |
| River gold §3.4             | OK       | +1 per settlement / road next to a river (setup too), not for a city (Q6).                                                                                                                                                                                                                                 |
| Wealthiest / Poor §4.6      | OK       | Derived: +1 strictly the most gold; −2 to everyone tied at the least (0 included).                                                                                                                                                                                                                         |
| Gold §4.6                   | OK       | `tb/buyResource` 2 gold → 1 card, 2 per turn, not in the SBP; `tb/sellForGold` 4:1 (3:1 with a generic harbour). — Gold in player trades.                                                                                                                                                                  |
| Caravans board §2.4         | OK       | `tb/caravans19` (oasis at the centre, starts at NW / NE / S) / `tb/caravans30` (two oases). Robber off the board, never on an oasis.                                                                                                                                                                       |
| Camels §4.3.1               | OK       | Start edge first, then a free edge at the head; no branching; meeting caravans merge; ends when stuck or out of camels (Q10: skipped).                                                                                                                                                                     |
| Voting §4.3.2               | OK, ours | `tb/vote`: every player bids once in turn order from the ender (`tb/bid`, cards to the bank); most votes places (`tb/placeCamel`), a tie → the ender. The T5 coalition step is not modelled (Q16, needs table talk).                                                                                       |
| Camel scoring §4.3.3        | OK       | +1 VP per building between 2 camels; a road under a camel counts 2 for Longest Road (`roadLength`).                                                                                                                                                                                                        |
| Caravans 5-6 §3.8           | OK       | A settlement / city built in the SBP calls one more vote after the phase, led by the owner (not with Rush mode).                                                                                                                                                                                           |
| BA board §2.5               | OK       | `tb/ba19` / `tb/ba30` with the printed numbers; check order clockwise from the hex after the castle; 2 start barbarians; BA deck (26) replaces the base deck.                                                                                                                                              |
| Landing §4.8.1              | OK       | After each settlement / city: up to 3 rolls, not 7, distinct; a full hex takes none; empty supply stops; 5-6: 5 and 9 land on both hexes.                                                                                                                                                                  |
| Conquest §4.8.2             | OK, ours | 3 barbarians: no production (`production` hook), no road / settlement next to it; a building with only conquered hexes around: 0 VP, harbour unusable, no upgrade (Q9).                                                                                                                                    |
| Knights §4.8.3              | OK       | Knighthood (castle edge) / Swift Knight (any free edge), 6 each; move up to 3 edges, 5 for 1 grain, through anything, never onto the castle or a knight; castle knights must move; once each per turn; moving knights ends building.                                                                       |
| Expulsion §4.8.4            | OK       | At the end of the turn, in check order: more knights than barbarians → prisoners (single, shared, shortage roll-off, leftover to the most knights with a roll-off, 3 gold for the losers), liberation, loss die per orientation (3 gold per knight). 2 prisoners = 1 VP; a win at the end of the own turn. |
| BA cards §4.8.5             | OK, ours | Bought and resolved at once (`tb/buyCard`); Treason 2 gold + 2 moves (Q11), from the supply when the coast has none; Intrigue redraws with no barbarian on the coast; empty deck reshuffles.                                                                                                               |
| BA 7 §3.2                   | OK       | Discards, then steal from any player.                                                                                                                                                                                                                                                                      |
| BA 5-6 SBP §3.8             | —        | Knighthood in the SBP / re-checks after each step: the expulsion runs once, at the end of the owner's turn.                                                                                                                                                                                                |
| T&B board §2.6 (F2)         | OK, ours | `tb/traders19` / `tb/traders37`: trade hexes get a plaza (`v:q,r,C`) and spokes (`e:q,r,C<corner>`, core topology F2); sea-only corners / sea sides banned (3-4); all six 5-6 trade hexes use the 6-corner design (Q14). 3 barbarians on the X paths.                                                      |
| Wagons §4.7.3               | OK, ours | End of turn (`tb/startWagon` then `tb/wagonStep`; building ends): 4-7 MP by card, own road 1, foreign road 1 + 1 gold toll per edge (Q22), none 2, barbarian +2, damaged road = none; no partial moves; a plaza ends the move; 1 grain = +2 MP once per move.                                              |
| Deliveries §4.7.3           | OK, ours | At the plaza that wants it: 1 VP + gold by card, then the hex's next commodity; the first visit only loads; an empty stack draws from another hex.                                                                                                                                                         |
| Baggage cards §4.7.4        | OK, ours | Upgrades with the T6 costs (Q12); level 5 = +1 VP.                                                                                                                                                                                                                                                         |
| Drive-off §4.7.3            | OK       | Card 2+, wagon next to the barbarian during its move, once per barbarian per turn, die in range → move it (no theft).                                                                                                                                                                                      |
| T&B 7 / Knight §3.2, §4.7.6 | OK, ours | Discards, then move a barbarian (pick it, then a path) and rob that road's owner; the Knight does the same and counts for Largest Army (Q13). 2 and 12 are rolled again. No Longest Road.                                                                                                                  |
| T&B deck §4.7.6             | OK, ours | 16 Knight, 3 Road Building, 3 VP in the base deck; 3 Swift Journey in the slice, drawn by their share of the cards left; Swift Journey: a fresh move after a regular one (FAQ 69/70).                                                                                                                      |
| SBP restrictions §3.8       | OK       | No fish / gold actions / wagon moves in the SBP; upgrades, bridges, BA cards allowed.                                                                                                                                                                                                                      |

### 11.3 Combinations

| Combination                                   | Status | Note                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T&B × T&B scenario sheets (§8.1, T6 2025)     | partly | The four Fishing pairs: mode `tb+tb` (module `tbpair`, C2; docs/rules/combos.md §2c), two features per scenario through `playsAs`. The six others (T6 boards and rules) are not built.                                                                                     |
| With Cities & Knights (FAQ 3-5, 43, 62-64)    | OK     | Mode `tb+ck` (module `tbck`), 2025 sheets; Barbarian Attack: mode `ba+ck` (`back`), Catan for Two: mode `two+ck` (`twock`) (C5, docs/rules/combos.md §10-11).                                                                                                              |
| With Seafarers (FAQ 6, 17-20, 40, 53, 58, 65) | OK     | Mode `tb+seafarers` (module `tbsea`, C2): each scenario on Heading for New Shores, 2025 sheets; FAQ 58 replaced by the 2025 "no ship on a bridge site" (docs/rules/combos.md §2b). On a map with open sea wagons, camels and barbarians use sea paths (`engine/paths.ts`). |

### 11.4 Known gaps

- Gold in player trades (Rivers / BA / T&B) and fish / tokens are never tradeable anyway; gold
  trades need an offer extra like C&K's.
- BA's 5-6 special build phase details, the Caravans T5 coalition vote, the T6 rules.
- Online play is base only (`src/net/protocol.ts`); fish hands and deck orders would need slice
  masking in `viewFor`.
