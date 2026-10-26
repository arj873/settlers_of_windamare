# CATAN: Seafarers — rules reference for the engine

Written for the engine-framework agent and the later scenario agents. It covers the Seafarers
expansion for 3–4 players and the Seafarers 5–6 Player Extension, in our own words. Base-game rules are
in `docs/RULES.md` (rule numbers like **5.3** refer to it). Nothing here changes the base rules unless a
section says so.

Compiled 2026-10-25 by the rules researcher on branch `s3/rules-seafarers`. No code was touched.

## 0. Sources, target edition, edition differences

### 0.1 Sources

| Key       | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S5**    | _CATAN: Seafarers_ Game Rules & Scenarios, 5th English ed. (2015 rules; catan.com hosts the 2021 printing, same text): https://www.catan.com/sites/default/files/2021-06/catan-seafarers_2021_rule_book_201201.pdf. The catan.com PDF has blank boxes where the wonder cards and some art should be, so map diagrams and wonder-card icons were read from a retailer-hosted copy of the 2015 booklet: https://world-of-board-games.com.sg/docs/Catan-Seafarers-5ed.pdf. Page numbers below are S5 p.N. **This is our target.**                       |
| **S56**   | _CATAN: Seafarers 5-6 Player Extension_, 2020 printing (special build phase): https://www.catan.com/sites/default/files/2021-08/catan_seafarers_5-6_2020_rules.pdf. Map diagrams read from the identical retailer copy https://world-of-board-games.com.sg/docs/Catan-Seafarers-56-Players.pdf. Page numbers S56 p.N.                                                                                                                                                                                                                                |
| **S56b**  | The same extension, 2023 revision (paired player turn instead of the special build phase): https://www.catan.com/sites/default/files/2024-03/Catan%20Seafarers%205-6%202023%20Rules%20220313.pdf                                                                                                                                                                                                                                                                                                                                                     |
| **S6**    | _CATAN – Seafarers_ rulebook, 6th ed. (2025): https://www.catan.com/sites/default/files/2025-03/CN3083%20CATAN%E2%80%93Seafarers%20Rulebook%202025%20secured%20reduced.pdf. Used only for the edition differences in §0.3.                                                                                                                                                                                                                                                                                                                           |
| **S6-56** | _Seafarers 5–6 Player Expansion_, 6th ed. (2025): https://www.catan.com/sites/default/files/2025-03/CN3084%20CATAN%20%E2%80%93%20Seafarers_%205-6%20Player_%20Rulebook.pdf (components and turn rule only; it has no scenario text).                                                                                                                                                                                                                                                                                                                 |
| **FAQ**   | Official Seafarers FAQ, 18 entries, numbered #1–#18 in page order (read 2026-10-25): https://www.catan.com/faq/seafarers                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **PAGE**  | catan.com Seafarers product page, combination notes (Cities & Knights, Traders & Barbarians), read 2026-10-25: https://www.catan.com/seafarers                                                                                                                                                                                                                                                                                                                                                                                                       |
| **COMBO** | Official "… with Seafarers" PDFs, 2025: Barbarian Attack https://www.catan.com/sites/default/files/2025-07/Barbarian%20Attack%20w%20SEA.pdf · Merchant Trains https://www.catan.com/sites/default/files/2025-08/Merchant%20Trains%20w%20SEA_21.07.25.pdf · Fishing https://www.catan.com/sites/default/files/2025-07/Fishing%20on%20Catan%20w%20SEA.pdf · Rivers https://www.catan.com/sites/default/files/2025-07/Rivers%20of%20Catan%20w%20SEA.pdf · T&B overall https://www.catan.com/sites/default/files/2025-07/TradersBarbarians%20w%20SEA.pdf |
| **MAYF**  | Older Mayfair printing, unofficial copy, used only to resolve two printed typos in the New World token tables (§2.10): https://lot.ahml.info/Catan_Seafarers_Rules.pdf                                                                                                                                                                                                                                                                                                                                                                               |

Map data in §2 was **transcribed by eye** from the printed scenario diagrams (rendered at 120–210 dpi) and
cross-checked against the printed component tables. A script parsed every fixed-layout block of §2 and the
terrain counts and number-token counts match the printed tables for every map, **except** the 4-player Fog
Islands token table (§2.4, Q24). Positions of tokens inside a map can still be wrong even when the counts
match. Treat harbor-facing details and anything marked **(verify)** as best effort; §10 lists them.

### 0.2 Target edition

We implement the **English 5th edition (2015 rules, still printed in 2020/2021)** of Seafarers, and for 5–6
players the **S56 2020 extension** with the special build phase we already have (`settings.specialBuildPhase`).
Reasons: it is the baseline of `docs/RULES.md` (R5), it has all nine scenarios fully specified, and the 2021
printing of S5 reads the same as 2015 (we compared the extracted text of the two PDFs for ships, pirate, gold,
the longest trade route and the scenario sections and found no rule change).

Two things worth knowing about the newer printings:

- The **2023 revision** of the 5–6 extension (S56b) replaces the special build phase with the _paired
  player turn_. We do not implement paired turns yet (`docs/RULES.md` §16.D), so S56b is only a note.
- The **6th edition (2025)** rewrote the rulebook and changed some rules and all components. See §0.3. We
  do **not** target it, but a few of its wordings are clearer than S5; where that is so, §3–§6 quote it as a
  tie-breaker and say so.

### 0.3 Differences between editions

| Topic                                 | 5th ed. (2015/2021) — **our target**                                                                                                                                        | 6th ed. (2025, S6)                                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terms                                 | "Longest Trade Route", "harbor", "Catan chit", "gold field", "bolts of cloth"                                                                                               | "Longest Route" tile, "port", "VP token", "cloth token", "pirate lair token"                                                                          |
| Number tokens                         | Round number tokens                                                                                                                                                         | Number discs                                                                                                                                          |
| Scenario list                         | 9: Heading for New Shores, The Four Islands, The Fog Islands, Through the Desert, The Forgotten Tribe, Cloth for Catan, The Pirate Islands, The Wonders of Catan, New World | Same 9 voyages (box says "nine voyages"); a separate box _Legend of the Sea Robbers_ adds 4 more scenarios, **out of scope** here                     |
| Free ship move: which ends are "open" | One of its ends is "not adjacent to any of your other pieces" (S5 p.4; roads count)                                                                                         | An end is open "when it is not next to one of your ships or buildings" (roads not mentioned)                                                          |
| Ships next to the pirate              | May not build one on the border of the pirate's hex; may not move one away from it (S5 p.6)                                                                                 | Same, and also "may not move a ship **to** or from an edge of the hex occupied by the pirate" (S6 p.2)                                                |
| Pirate placement                      | Any sea hex                                                                                                                                                                 | "The frame or a new sea hex" (S6 p.2). FAQ #4 allows the frame in 5th ed. too, "unless the scenario forbids it"                                       |
| Road Building card                    | 2 roads, 2 ships, or 1 + 1                                                                                                                                                  | Same, "at no cost"                                                                                                                                    |
| Longest route threshold               | 5 (base rule)                                                                                                                                                               | 5 continuous roads and/or ships; tile worth 2 VP                                                                                                      |
| Wonders of Catan                      | 5 wonder cards, requirements on cards; first to start picks first; ship placed on the card marks "started"                                                                  | Wonder tiles with Great Wall / Great Bridge map markers, "X" markers; pay on claiming; wonder marker per player. Wonder table in §2.9 is 5th ed. only |
| New World VP                          | **One** special VP per player in total (S5 p.30)                                                                                                                            | **1 VP per unexplored island** (S6 p.19)                                                                                                              |
| Pirate Islands                        | Exactly one ship line per player, no other routes ("You can build only one shipping route")                                                                                 | One line to the western islands, but "You may create other routes around the main island"                                                             |
| Pirate Islands attack                 | "you **can** attack … at the end of your turn"; tie loses the ship next to the fortress                                                                                     | "you attack" at the end of the Action phase; tie loses 1 ship; same numbers                                                                           |
| Forgotten Tribe end                   | "3 or fewer villages still hold a chit" (8 villages)                                                                                                                        | "5 or more villages without cloth tokens" (same condition)                                                                                            |
| Frames                                | Thin frame pieces; harbors may sit on the frame                                                                                                                             | Same idea, new art                                                                                                                                    |
| 5–6 players                           | S56: special build phase. S56b (2023): paired player turn                                                                                                                   | S6-56: paired player turn; new components (2 player aids, 2 paired-player markers, Lighthouse/"beachhead" markers)                                    |
| Combos                                | C&K and T&B notes on catan.com (§8)                                                                                                                                         | Same pages                                                                                                                                            |

## 1. Overview and components

### 1.1 What Seafarers adds

Seafarers changes five things. Everything else is base Catan.

1. **Ships**: pieces on sea edges that act like roads, and that can **move** once per turn (§4.1).
2. **Sea hexes, a frame, and many islands**: the board is a scenario map, not the fixed island (§2).
3. **Gold fields**: a hex that pays any resource you pick (§4.3).
4. **The pirate**: a second blocker, moved on a 7 or a Knight instead of the robber (§4.4).
5. **Scenario goals**: special victory points (Catan chits) for settling new islands, plus scenario rules for
   fog, cloth, pirates, wonders and so on (§2, §4.6–§4.10).

Each scenario sets its own **victory point target**, special rules, setup and pirate/robber start (§2).

### 1.2 Box contents (S5 p.2, S56 p.2)

| Component                 | Seafarers (3–4)                                                            | 5–6 Extension                              |
| ------------------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| Frame pieces              | 6 (combine with the 6 base-game frame pieces, flipped to the all-sea side) | 2                                          |
| Sea hexes                 | 19                                                                         | 7                                          |
| Terrain hexes             | 11: 2 gold, 2 desert, 1 fields, 1 forest, 1 pasture, 2 mountains, 2 hills  | 3: 2 gold, 1 desert                        |
| Number tokens             | 10 (one side printed)                                                      | — (use base game and 5–6 extension tokens) |
| Harbor tokens             | 10 (do **not** use the small harbor tokens of the base game)               | 2                                          |
| Catan chits               | 50                                                                         | 35                                         |
| Ships                     | 60 wooden ships, 15 in each of 4 colors                                    | 30 wooden ships, 15 in each of 2 colors    |
| Pirate                    | 1 black pirate ship                                                        | —                                          |
| Wonder cards (scenario 8) | 5 printed in the booklet, "copy or cut out" (S5 p.27)                      | 2 more printed in the booklet (S56 p.3)    |

Every scenario also needs the pieces of the base game (and, for 5–6 players, the base 5–6 extension).
The 5–6 extension needs **four boxes in total** (base, 5–6 base, Seafarers, Seafarers 5–6) (PAGE).

### 1.3 Pieces per player

| Piece       | Count  | Note                                                        |
| ----------- | ------ | ----------------------------------------------------------- |
| Roads       | 15     | unchanged                                                   |
| Settlements | 5      | unchanged                                                   |
| Cities      | 4      | unchanged                                                   |
| **Ships**   | **15** | 15 per color in every box, so 6 colors work for 5–6 players |

Building costs (S5 p.3, card on the frame piece): **Ship = 1 lumber + 1 wool** (the "Ship" cost card is
printed on the frame). Road, settlement, city and development card costs are unchanged. There are **no gold
resource cards**: gold is never in a hand and never in the bank (S5 p.6).

### 1.4 Scenario summary (3–4 players)

"Main / small" = counts for the main island and for the small islands / foreign areas, as printed.
VP = victory points needed on your own turn. Harbors = special 2:1 (one per resource) + generic 3:1.

| #   | Scenario               | VP to win       | Harbors        | Hexes (land + sea)                                         | Number tokens        | Chits / extras                        | Robber / pirate                                                           |
| --- | ---------------------- | --------------- | -------------- | ---------------------------------------------------------- | -------------------- | ------------------------------------- | ------------------------------------------------------------------------- |
| 1   | Heading for New Shores | 14              | 3p 5+3; 4p 5+4 | 3p 35 = 22 land + 13 sea; 4p 42 = 28 land + 14 sea         | 3p 22; 4p 27         | 3p 18; 4p 24                          | both. Pirate: marked sea hex. Robber: 3p hills "12", 4p desert            |
| 2   | The Four Islands       | 13              | 5+4            | 3p 35 = 20 land + 15 sea; 4p 35 = 23 land + 12 sea         | 3p 20; 4p 23         | 3p 18; 4p 24                          | both. Robber on the "12" hex; pirate on marked sea hex                    |
| 3   | The Fog Islands        | 12              | 3p 5+3; 4p 5+4 | 3p/4p 42 = 30 face-up + 12 face-down                       | 3p 24; 4p 27         | none (no chit VP)                     | both. Robber on the "12" hex; pirate on marked sea hex                    |
| 4   | Through the Desert     | 14              | 3p 5+3; 4p 5+4 | 3p 35 = 25 main + 10 foreign; 4p 42 = 30 main + 12 foreign | 3p 22; 4p 27         | 3p 24; 4p 32                          | both. Robber on one of the 3 deserts; pirate marked                       |
| 5   | The Forgotten Tribe    | 13              | 5+1            | 49 = 30 land + 19 sea                                      | 18                   | 8 chits + 4 dev cards placed on edges | both. Robber on any desert; pirate marked                                 |
| 6   | Cloth for Catan        | 14 or cloth end | 5+4            | 42 = 24 land + 18 sea                                      | 28 (20 + 8 villages) | 50 chits = 8 villages × 5 + 10 supply | both. Robber on fields "12" (not on the 4 village islands); pirate marked |
| 7   | The Pirate Islands     | 10 + capture    | 5+3            | 49 = 30 land + 19 sea                                      | 24                   | 12 chits (4 fortresses × 3)           | **pirate fleet only, no robber**                                          |
| 8   | The Wonders of Catan   | wonder or 10+   | 5+4            | 49 = 30 land + 19 sea                                      | 27                   | 10 chits + 5 wonder cards             | robber on a desert; **no pirate**                                         |
| 9   | New World              | 12              | 5+4            | 42 = 23 land + 19 sea                                      | 23                   | 16 chits                              | both, start on the frame                                                  |

### 1.5 Scenario summary (5–6 players)

The 5–6 booklet (S56) has nine scenarios with the same rules as 3–4 players ("as specified in the 3–4 player
scenario") except where §2 says otherwise. **No victory point target is printed for 5–6 players, so use the
3–4 player target** (see §10, Q18). Counts below are the printed component tables.

| #   | Scenario               | Harbors           | Hexes (land + sea)                          | Number tokens | Chits | Notes                                                                  |
| --- | ---------------------- | ----------------- | ------------------------------------------- | ------------- | ----- | ---------------------------------------------------------------------- |
| 1   | Heading for New Shores | 6 sp + 5 gen = 11 | 56 = 30 base-5–6-island + 10 small + 16 sea | 28 + 10       | 48    | main island is the base 5–6 island (30 hexes), built per the 5–6 rules |
| 2   | The Six Islands        | 11                | 56 = 32 land + 24 sea                       | 32            | 60    | replaces The Four Islands                                              |
| 3   | The Fog Island         | 5+4 = 9           | 63 = 38 face-up + 25 face-down              | 25 + 13       | 0     | named "Fog **Island**" in S56; same rules                              |
| 4   | Through the Desert     | 11                | 63 = 43 land + 20 sea                       | 38            | 20    | 5 deserts                                                              |
| 5   | The Forgotten Tribe    | 5+3 = 8           | 63 = 41 land + 22 sea                       | 29            | 10    | 6 dev cards on edges, 10 chits                                         |
| 6   | Cloth for Catan        | 11                | 56 = 32 land + 24 sea                       | 38            | 70    | 12 villages × 5 chits + 10 supply; robber on fields "11"               |
| 7   | The Pirate Islands     | 5+4 = 9           | 63 = 37 land + 26 sea                       | 32            | 18    | 6 colors; in a 5-player game do not use the brown pieces; "!" hex rule |
| 8   | The Wonders of Catan   | 11                | 63 = 39 land + 24 sea                       | 35            | 18    | 7 wonder cards (5 + 2), 4 deserts                                      |
| 9   | New World              | 11                | 63 = 42 land + 21 sea                       | 39            | 50    | token table has a printing typo, see §2.10                             |

## 2. Setup

### 2.0 How to read the maps in this section

Every scenario below gives its **fixed ("standard") layout** exactly as printed, as data. Terrain and numbers
on the printed diagram are the fixed set-up. The "Variable set-up" paragraph of each scenario says how to
randomize; the engine should offer the fixed layout as the default and the randomized layout as an option
(§9).

**Hex orientation.** The Seafarers diagrams are drawn with **flat-top hexes in vertical columns**. Our
engine uses pointy-top axial coordinates, so §2.0.3 gives a conversion.

**Cell coordinates `(c, r)`.** `c` = column, 0 at the left, increasing to the right. `r` = half-row index,
0 at the top of the tallest column, increasing downward. A hex sits at every `(c, r)` with `c + r` even.

```
neighbors of (c, r):   N (c, r-2)    S (c, r+2)
                       NE (c+1, r-1) SE (c+1, r+1)
                       NW (c-1, r-1) SW (c-1, r+1)
```

All maps below use these **canonical coordinates** (the printed diagrams use two different origins;
§2.0.2 gives the rule, and the data below is already converted). A cell can be **land**, **sea**, **frame**
(outside the playing area, but harbors, the pirate and the robber may start there, and ships may use the edges
next to it), or **fog** (empty until discovered, §4.7).

**Corners and sides of a flat-top hex** `(c, r)`:

| Corner | Shared by the cells         | Side | Neighbor cell |
| ------ | --------------------------- | ---- | ------------- |
| NE     | (c,r), (c,r-2), (c+1,r-1)   | N    | (c, r-2)      |
| E      | (c,r), (c+1,r-1), (c+1,r+1) | NE   | (c+1, r-1)    |
| SE     | (c,r), (c+1,r+1), (c,r+2)   | SE   | (c+1, r+1)    |
| SW     | (c,r), (c-1,r+1), (c,r+2)   | S    | (c, r+2)      |
| W      | (c,r), (c-1,r-1), (c-1,r+1) | SW   | (c-1, r+1)    |
| NW     | (c,r), (c,r-2), (c-1,r-1)   | NW   | (c-1, r-1)    |

A **vertex** is written `V(c,r,corner)`; an **edge** `E(c,r,side)`. Any vertex or edge has several
equivalent names (it is shared by 2–3 cells); the engine should canonicalize.

#### 2.0.1 Playing-area footprints (cells inside the frame)

All cells not listed as land, harbor-bearing or special are **sea** inside the footprint. The footprint
depends on the frame assembled for the scenario. Cells outside it are **frame**.

| Frame           | Used by                                                          | Cells | Columns `c: r-range` (only cells with c+r even)                     |
| --------------- | ---------------------------------------------------------------- | ----- | ------------------------------------------------------------------- |
| **SHORT** (3–4) | HNS 3p, Four Islands 3p and 4p, Through the Desert 3p            | 35    | 0: 2–8 · 1: 1–9 · 2: 0–10 · 3: 1–9 · 4: 0–10 · 5: 1–9 · 6: 2–8      |
| **TALL** (3–4)  | HNS 4p, Fog 3p and 4p, Through the Desert 4p, Cloth, New World   | 42    | 0: 2–10 · 1: 1–11 · 2: 0–12 · 3: 1–11 · 4: 0–12 · 5: 1–11 · 6: 2–10 |
| **XTALL** (3–4) | Forgotten Tribe, Pirate Islands, Wonders                         | 49    | 0: 2–12 · 1: 1–13 · 2: 0–14 · 3: 1–13 · 4: 0–14 · 5: 1–13 · 6: 2–12 |
| **A** (5–6)     | HNS, Six Islands, Cloth                                          | 56    | 0: 2–14 · 1: 1–15 · 2: 0–16 · 3: 1–15 · 4: 0–16 · 5: 1–15 · 6: 2–14 |
| **B** (5–6)     | Fog, Desert, Forgotten Tribe, Pirate Islands, Wonders, New World | 63    | 0: 2–16 · 1: 1–17 · 2: 0–18 · 3: 1–17 · 4: 0–18 · 5: 1–17 · 6: 2–16 |

(The footprints were derived from the diagrams and verified: for every scenario, footprint cells = the sum of
the printed terrain counts, e.g. HNS 3p 23 + 12 = 35.) Components that lie outside the footprint in the
diagrams (harbors on the frame, the pirate on the bottom frame hex, Forgotten Tribe development cards) are
given with explicit frame cells such as `(1,-1)`.

#### 2.0.2 Where the numbers come from

Diagrams on S5 pp. 9, 10, 12, 13, 15, 16, 18, 19, 23, 29, 31 are printed with a half-row origin one row
lower than pp. 21, 25 and the 5–6 diagrams. The data below is **already converted to one origin**: `r = 0`
is the top cell of the tallest column (columns 2 and 4) of the frame. If you re-read the diagrams, convert
with: pp. 9–19, 23, 29, 31: `r = (printed half-row) - 1`.

#### 2.0.3 Converting to the engine's pointy-top axial `(q, r)`

Rotate the board 90° counter-clockwise (this keeps clockwise as clockwise, which matters for the pirate
fleet path). Every frame has 7 columns, so with the canonical `(c, r)` of this document (`c + r` even):

```
axial r = 6 - c            (the book's left column becomes the bottom row)
axial q = (r + c - 6) / 2  (always an integer, because c + r is even; r on the right is the book r)
```

Check: book N (c, r-2) → axial (q-1, r) = W; book S → E; book NE (c+1, r-1) → (q, r-1) = NW; book SE → (q+1,
r-1) = NE; book SW (c-1, r+1) → (q, r+1) = SE; book NW → (q-1, r+1) = SW. Re-center the result as the
engine's frames do.

Direction names rotate as follows. Flat-top **side / neighbor** → pointy-top **side**: N→W, NE→NW, SE→NE,
S→E, SW→SE, NW→SW. Flat-top **corner** → pointy-top **corner**: E→N, NE→NW, NW→SW, W→S, SW→SE, SE→NE
(our corner names are N, NE, SE, S, SW, NW). A mirror image (transpose, `axial r = c`) is also a legal map,
but then the pirate fleet path and the "clockwise" text read counter-clockwise.

### 2.1 Common setup rules (all scenarios)

1. **Assemble the frame** (S5 p.3): turn the six base-game frame pieces to the all-sea side (ignore their
   printed harbors) and combine them with the Seafarers frame pieces as the diagram shows. The frame is
   only a border; it has no production.
2. **Place hexes and number tokens exactly as the diagram** (fixed setup), or per the scenario's variable
   set-up (§2.2–§2.9).
3. **Harbors.** Take the harbor tokens named in the scenario text, shuffle them **face down**, and place
   them one by one on the marked spots (the diagram shows each spot with a small ship; some 3-player
   diagrams print the token face-up, which is one possible outcome). A harbor sits on a sea cell (or on the
   frame) and touches a **coastal edge** of a land hex; both of its two corners are vertices of that edge.
   Harbors in the 3–4 player diagrams are the "spot list" in §2.2–§2.9. (S5 p.2, p.7)
4. **Robber and pirate** start where each scenario says. If a scenario has **no desert**, the robber starts
   **beside the board** and enters on any land hex at the first 7 or Knight (FAQ #9, S5 p.6). The pirate
   starts where the diagram shows it (a marked sea hex, or the frame).
5. **Starting settlements and roads** (S5 p.2–p.6; base rules 2.12–2.19 of `docs/RULES.md` for the snake
   order and starting resources): place 2 settlements and 2 roads, **except** that a starting settlement on
   the coast may take a **ship instead of a road** ("Starting with a Ship", S5 p.6). The ship must be placed
   adjacent to the settlement and legally, i.e. also not next to the pirate (FAQ #5: **no** ship next to the
   pirate during starting setup). Where the settlements may go is scenario-specific (§2.2–§2.9).
6. **Starting resources.** The second settlement (third in Cloth for Catan) pays 1 card per adjacent
   producing hex as in the base game. If it touches a gold field, the player takes **any resource**
   (open point, §10 Q5).
7. **Victory** is checked on your own turn: the target is per scenario (§1.4). Longest Trade Route and
   Largest Army count as in the base game except where a scenario says otherwise.

### 2.2 Scenario 1 — Heading for New Shores

_S5 pp. 8–10. Beginner scenario: a main island plus several small islands that each pay 2 special VP the
first time you settle them._

**Rules for this scenario**

- Players build their two starting settlements (and roads/ships) **on the main island** (the big island).
- **Special VP:** each time you build a settlement **for the first time on one of the small islands** you get
  **2 special VP** (2 Catan chits under that settlement). You can earn them once per small island, **even if
  another player already settled it** (S5 p.8). A "small island" is a connected group of land hexes that is
  not part of the main island (§4.6 gives the engine definition).
- Robber and pirate both play. The pirate starts on the marked sea hex. In a 4-player game the robber starts
  on the desert; in a 3-player game on the hills hex with the "12".
- **Game ends** as soon as a player has **14 VP** on their turn.

**Components (S5 p.8)** — first number "main island", second "small islands" (red tokens go on the small islands):

|                               | 3 players                                          | 4 players                                          |
| ----------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| Harbors                       | 8 (5 special + 3 generic)                          | 9 (5 special + 4 generic)                          |
| Chits                         | 18                                                 | 24                                                 |
| Sea                           | 9 / 4                                              | 10 / 4                                             |
| Desert                        | 0 / 0                                              | 1 / 0                                              |
| Gold                          | 0 / 2                                              | 0 / 2                                              |
| Fields                        | 3 / 1                                              | 4 / 1                                              |
| Hills                         | 2 / 2                                              | 3 / 2                                              |
| Mountains                     | 2 / 2                                              | 3 / 2                                              |
| Pasture                       | 4 / 1                                              | 4 / 1                                              |
| Forest                        | 3 / 0                                              | 4 / 1                                              |
| Hex total                     | 23 / 12 = 35                                       | 29 / 13 = 42                                       |
| Tokens 2/3/4/5/6/8/9/10/11/12 | 1/1/1/2/2/2/1/2/2/0 = 14 · 0/1/2/1/0/1/1/1/0/1 = 8 | 1/2/2/2/2/2/2/2/2/1 = 18 · 1/1/1/1/1/1/1/1/1/0 = 9 |

**Fixed layout, 3 players** (frame SHORT; format `terrain number`; the 6s and 8s are the red tokens):

```
Main island (14):
 c0: r2 grain 6   | r4 lumber 5
 c1: r1 grain 11  | r3 ore 3      | r5 brick 11
 c2: r0 brick 8   | r2 wool 10    | r4 wool 9    | r6 lumber 8
 c3: r1 wool 2    | r3 ore 5      | r5 lumber 10
 c4: r2 grain 4   | r4 wool 6
Small islands (8 land + 4 sea; 12 positions):
 c0: r8 brick 10
 c1: r9 ore 8
 c3: r9 GOLD 4
 c4: r8 grain 3
 c5: r7 wool 4    | r9 ore 9
 c6: r2 brick 12 [robber start]  | r4 GOLD 5
Pirate: frame cell (3,11), the bottom centre of the frame.
```

Small-island groups in this layout: {(0,8),(1,9)}, {(3,9),(4,8),(5,7),(5,9)}, {(6,2),(6,4)} → **3 small
islands**, 6 VP maximum from them.

Harbors, 3 players (printed face up: 3:1 shown with a "?"). Format `sea cell → coastal edge of land cell`:

| #   | Harbor     | Sea / frame cell | Touches (side of the land hex)       |
| --- | ---------- | ---------------- | ------------------------------------ |
| H1  | 3:1        | (1,-1) frame     | (2,0), side NW                       |
| H2  | ore 2:1    | (3,-1) frame     | (2,0), side NE                       |
| H3  | brick 2:1  | (0,0) frame      | (0,2), side N                        |
| H4  | grain 2:1  | (4,0)            | (4,2), side N                        |
| H5  | lumber 2:1 | (-1,3) frame     | (0,4), side NW (or (0,2) SW; verify) |
| H6  | 3:1        | (0,6)            | (0,4), side S                        |
| H7  | 3:1        | (4,6)            | (4,4), side S                        |
| H8  | wool 2:1   | (3,7)            | (2,6), side SE                       |

**Fixed layout, 4 players** (frame TALL):

```
Main island (19):
 c0: r2 grain 8   | r4 lumber 2   | r6 ore 10
 c1: r1 ore 3     | r3 wool 4     | r5 brick 9    | r7 wool 8
 c2: r0 brick 6   | r2 lumber 10  | r4 DESERT [robber] | r6 grain 11 | r8 lumber 5
 c3: r1 grain 12  | r3 brick 11   | r5 grain 3    | r7 wool 9
 c4: r2 wool 5    | r4 lumber 6   | r6 ore 4
Small islands (9 land + 4 sea; 13 positions):
 c0: r10 grain 6
 c1: r11 brick 3
 c3: r11 GOLD 10
 c4: r10 lumber 9
 c5: r9 brick 5   | r11 ore 2
 c6: r2 ore 8     | r4 wool 11    | r8 GOLD 4
Pirate: frame cell (3,13).
```

Small-island groups: {(0,10),(1,11)}, {(3,11),(4,10),(5,9),(5,11),(6,8)}, {(6,2),(6,4)} → 3 small islands.
The 4 sea hexes among the 13 "small-island positions" are not marked on the diagram; the printed layout has
them as sea (§10 Q1).

Harbors, 4 players (9 tokens, drawn face down at random: 5 special + 4 generic):

| #   | Sea / frame cell | Touches                              |
| --- | ---------------- | ------------------------------------ |
| A   | (1,-1) frame     | (1,1), side N                        |
| B   | (3,-1) frame     | (3,1), side N                        |
| C   | (-1,1) frame     | (0,2), side NW                       |
| D   | (-1,5) frame     | (0,4), side SW                       |
| E   | (5,1)            | (4,2), side NE                       |
| F   | (5,5)            | (4,4), side SE (or (4,6) NE; verify) |
| G   | (0,8)            | (1,7), side SW                       |
| H   | (4,8)            | (3,7), side SE                       |
| I   | (2,10)           | (2,8), side S                        |

**Variable set-up (S5 p.8–9).**

- **3 players:** shuffle the 14 main-island land hexes and 8 harbor tokens onto the printed main-island and
  harbor positions; deal number tokens randomly onto the main-island land; **red numbers (6, 8) must not
  touch** (the 3-player diagram's own wording). Small islands: shuffle the 8 small-island land hexes + 4 sea
  into the **12 positions** that are not adjacent to the main island (use the red-marked tokens for them),
  then deal the small-island tokens.
- **4 players:** same for the 19 main-island hexes (harbors "according to the rules for basic Catan"), and
  13 small-island positions (9 land + 4 sea). "Red production numbers should not be placed next to each
  other."

### 2.3 Scenario 2 — The Four Islands (Six Islands for 5–6)

_S5 pp. 11–13._ Four islands of similar size; the point is to visit the others.

**Rules for this scenario**

- Starting settlements go on **any one island or two islands**, both on the same or on different ones. Each
  player then has 1 or 2 **home islands**; all others are **foreign** to that player.
- **Special VP:** the **first settlement you build on a foreign island = 2 special VP**. Then again on a
  second foreign island, and again on a third. A player who starts on two islands can earn at most 4;
  starting on one island, at most 6. It does not matter whether others are already there, even if it is
  their home island. Each time **you** settle an island that was foreign to **you** for the first time you
  earn the points (S5 p.11). Additional settlements on the same island do not pay again.
- Both robber and pirate play. The robber starts on the hex with the "12"; the pirate on the marked sea hex.
- **Game ends at 13 VP** on your turn.

**Components (S5 p.11):**

|                               | 3 players                | 4 players                |
| ----------------------------- | ------------------------ | ------------------------ |
| Harbors                       | 9 (5+4)                  | 9 (5+4)                  |
| Chits                         | 18                       | 24                       |
| Sea                           | 15                       | 12                       |
| Fields                        | 4                        | 5                        |
| Hills                         | 4                        | 4                        |
| Mountains                     | 4                        | 4                        |
| Pasture                       | 4                        | 5                        |
| Forest                        | 4                        | 5                        |
| Hex total                     | 35                       | 35                       |
| Tokens 2/3/4/5/6/8/9/10/11/12 | 1/2/2/3/2/2/3/2/2/1 = 20 | 1/2/3/3/2/2/3/3/3/1 = 23 |

**Fixed layout, 3 players** (frame SHORT):

```
NW island (6):  c0: r2 wool 12 [robber] | c1: r1 lumber 5, r3 wool 9 | c2: r0 grain 11, r2 ore 8, r4 lumber 3
NE island (4):  c4: r0 wool 6, r2 ore 10 | c5: r1 ore 4, r3 lumber 9
SE island (6):  c4: r6 lumber 8, r8 brick 11 | c5: r7 grain 9, r9 brick 5 | c6: r6 grain 4, r8 wool 3
SW island (4):  c1: r7 ore 2, r9 grain 5 | c2: r8 brick 10, r10 brick 6
Pirate: sea cell (3,5), the middle of the board.
```

Harbors, 3 players (printed face up):

| #   | Harbor | Sea / frame cell | Touches         |
| --- | ------ | ---------------- | --------------- |
| 1   | 3:1    | (1,-1) frame     | (2,0), side NW  |
| 2   | lumber | (3,1)            | (2,0), side SE  |
| 3   | 3:1    | (5,-1) frame     | (4,0), side NE  |
| 4   | wool   | (0,4)            | (1,3), side SW  |
| 5   | ore    | (4,4)            | (5,3), side SW  |
| 6   | 3:1    | (2,6)            | (1,7), side NE  |
| 7   | brick  | (3,7)            | (4,8), side NW  |
| 8   | 3:1    | (6,10) frame     | (5,9), side SE  |
| 9   | grain  | (1,11)           | (2,10), side SW |

**Fixed layout, 4 players** (frame SHORT):

```
NW island (7):  c0: r2 wool 10, r4 grain 11 | c1: r1 grain 6, r3 ore 4, r5 brick 2 | c2: r0 brick 4, r2 wool 9
NE island (4):  c4: r0 grain 5, r2 lumber 3 | c5: r1 brick 10 | c6: r2 wool 8
Centre-east (8): c3: r5 lumber 6 | c4: r6 brick 5, r8 ore 10 | c5: r5 ore 3, r7 grain 12 [robber], r9 wool 5
                 c6: r6 lumber 9, r8 lumber 11
SW island (4):  c0: r8 grain 4 | c1: r9 ore 8 | c2: r8 lumber 9, r10 wool 11
Pirate: frame cell (3,11).
```

Harbors, 4 players:

| #   | Harbor | Sea / frame cell | Touches         |
| --- | ------ | ---------------- | --------------- |
| 1   | brick  | (1,-1) frame     | (2,0), side NW  |
| 2   | wool   | (0,0) frame      | (0,2), side N   |
| 3   | 3:1    | (3,1)            | (4,0), side SW  |
| 4   | grain  | (5,-1) frame     | (5,1), side N   |
| 5   | 3:1    | (2,4)            | (1,3), side SE  |
| 6   | 3:1    | (4,4)            | (3,5), side NE  |
| 7   | ore    | (3,9)            | (2,10), side NE |
| 8   | lumber | (4,10)           | (5,9), side SW  |
| 9   | 3:1    | (1,11)           | (2,10), side SW |

**Variable set-up.** "The contours of the four islands should not be altered. Within these contours, the
terrains and number tokens can be redistributed freely. Make sure forest and pasture do not get unfavorable
tokens" (S5 p.12; S6 spells out the bad tokens as 2, 3, 11 and 12).

**5–6 players: The Six Islands (S56 pp. 8–9).** Same rules as above (S56 p.8: "as specified in … The Four
Islands"). Six islands, 56 cells (frame A); 11 harbors (6 special incl. an extra wool 2:1, plus 5 generic);
60 chits.

```
Fixed layout, frame A (32 land):
NW (5):   c0: r2 wool 5, r4 ore 6 | c1: r1 lumber 9, r3 grain 12 | c2: r2 brick 4
NE (6):   c4: r0 brick 11, r2 grain 9 | c5: r1 lumber 8, r3 ore 10 | c6: r2 wool 12, r4 ore 4
W-mid (5): c0: r8 wool 2 | c1: r7 grain 5, r9 ore 3 | c2: r8 wool 8, r10 lumber 10
E-mid (5): c4: r6 wool 3, r8 lumber 4 | c5: r7 ore 11, r9 brick 10 | c6: r8 lumber 6
SW (6):   c0: r12 brick 5, r14 grain 2 | c1: r13 brick 8, r15 wool 9 | c2: r14 lumber 5, r16 grain 6
SE (5):   c4: r14 lumber 4 | c5: r13 grain 3, r15 brick 10 | c6: r12 ore 9, r14 wool 6
Pirate: frame cell (3,-1) (top centre). No desert, so the robber starts beside the board.
```

Harbors (11 face-down): (1,1) N · (4,2) NW · (6,4) NE · (5,3) SW · (0,4) SE · (1,7) NW · (6,8) SE · (0,12) NW ·
(5,13) NW · (6,14) SE · (1,15) S, as "land cell, side that the harbor touches".

### 2.4 Scenario 3 — The Fog Islands (The Fog Island for 5–6)

_S5 pp. 14–16._ Two island groups with a fog bank between them. Empty cells are filled by drawing hexes as
ships arrive (discovery, §4.7).

**Rules for this scenario**

- Starting settlements go on the **upper and/or lower island** (the face-up land).
- **Discovery** (§4.7). **No special victory points** and no chits.
- Robber starts on the "12" hex, pirate on the marked sea hex.
- **Game ends at 12 VP.**

**Components (S5 p.14):** "Face-up" are placed at setup; "Face-down stack" are hidden and used to fill the
fog cells. Each count is printed as "3 players / 4 players" (the footnote "use red #'s for 4 players" only
says that the 4-player numbers are the second figures).

|                                       | 3 players                                                                   | 4 players                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Harbors                               | 8 (5+3)                                                                     | 9 (5+4)                                                                          |
| Face-up terrain                       | sea 16, fields 2, hills 2, mountains 2, pasture 4, forest 4 = 30            | sea 13, fields 3, hills 3, mountains 3, pasture 4, forest 4 = 30                 |
| Face-up tokens 2/3/4/5/6/8/9/10/11/12 | 0/1/1/2/2/2/2/1/2/1 = 14                                                    | 1/2/2/2/2/2/2/2/1/1 = 17                                                         |
| Face-down terrain stack               | sea 2, gold 2, fields 2, hills 2, mountains 2, pasture 1, forest 1 = **12** | the same 12 (sea 2, gold 2, fields 2, hills 2, mountains 2, pasture 1, forest 1) |
| Face-down token stack                 | 3s 2, 4s 1, 5s 1, 6s 1, 8s 1, 9s 1, 10s 1, 11s 1, 12s 1 = 10                | 3s 1, 4s 1, 5s 1, 6s 1, 8s 1, 9s 1, 10s 1, 11s 2, 12s 1 = 10                     |

The 12 face-down cells are exactly the 12 fog cells; the stack holds 10 land + 2 sea, so exactly 10 of the 12
fog cells become land. (10 tokens for 10 land hexes: the gold fields get tokens too.)

**Discrepancy (4 players):** the printed face-up token counts (3s 2, 6s 2, 10s 2, 11s 1) differ from the
tokens actually printed on the 4-player diagram (3s 1, 6s 3, 10s 1, 11s 2); both total 17. The fixed layout
below follows the **diagram**; the table applies to the variable set-up (§10 Q24). The 3-player diagram and
table agree.

**Fixed layout, 3 players** (frame TALL). "Fog" cells are shown as `?`:

```
Upper island (7):  c0: r4 wool 12 [robber] | c1: r3 ore 8, r5 grain 10 | c2: r2 brick 11, r4 lumber 9
                   c3: r1 lumber 6, r3 wool 5
Lower island (7):  c3: r11 ore 4 | c4: r10 wool 8, r12 wool 9 | c5: r9 lumber 5, r11 grain 3
                   c6: r8 brick 6, r10 lumber 11
Fog cells (12):    (5,1) (6,2) (5,3) (6,4) (5,5) (4,6) (3,7) (0,8) (2,8) (1,9) (0,10) (1,11)
Pirate: frame cell (3,-1).
```

Harbors, 3 players:

| #   | Harbor | Sea / frame cell | Touches         |
| --- | ------ | ---------------- | --------------- |
| 1   | ore    | (2,0)            | (3,1), side NW  |
| 2   | lumber | (1,1)            | (2,2), side NW  |
| 3   | 3:1    | (0,2)            | (0,4), side N   |
| 4   | brick  | (0,6)            | (1,5), side SW  |
| 5   | 3:1    | (7,9) frame      | (6,8), side SE  |
| 6   | wool   | (6,12) frame     | (6,10), side S  |
| 7   | 3:1    | (3,13) frame     | (3,11), side S  |
| 8   | grain  | (5,13) frame     | (4,12), side SE |

**Fixed layout, 4 players** (frame TALL):

```
Upper island (7):  c0: r2 wool 2, r4 lumber 5 | c1: r1 brick 9, r3 wool 6 | c2: r0 grain 6, r2 lumber 4
                   c3: r1 ore 3
Lower island (10): c3: r11 grain 11 | c4: r10 wool 10, r12 brick 12 [robber] | c2: r12 lumber 5
                   c5: r7 wool 9, r9 lumber 8, r11 ore 8 | c6: r6 brick 4, r8 grain 6, r10 ore 11
Fog cells (12):    (5,1) (6,2) (5,3) (4,4) (3,5) (2,6) (1,7) (3,7) (0,8) (2,8) (1,9) (0,10)
Pirate: frame cell (3,-1).
```

Harbors, 4 players: ore (1,-1) frame → (2,0) NW · lumber (3,-1) frame → (3,1) N · 3:1 (0,0) frame → (0,2) N ·
3:1 (-1,3) frame → (0,4) NW · wool (7,7) frame → (6,6) SE · grain (7,9) frame → (6,8) SE (verify; may be
(6,10) NE) · 3:1 (6,12) frame → (6,10) S · brick (5,13) frame → (4,12) SE · 3:1 (3,13) frame → (2,12) SE.

**Variable set-up (S5 p.14).** The outlines of the upper and lower island must not change. Within them, the
face-up terrains and tokens may be redistributed freely (S5 p.14). S6 adds that red 6/8 may end up next to
each other in this scenario.

**5–6 players: The Fog Island (S56 p.10–11).** Frame B (63 cells); 25 face-down cells; 9 harbors (5+4).

```
Fixed layout (face-up land 26 incl. 1 desert and 2 gold; 25 fog cells):
 GOLD (0,2) 4 and GOLD (0,16) 10 on the far left edge
 East island:
  c3: r7 lumber 5 | r9 grain 11 | r11 wool 8
  c4: r4 lumber 8 | r6 grain 9 | r8 brick 3 | r10 ore 12 | r12 grain 10 | r14 lumber 3
  c5: r3 grain 2 | r5 wool 4 | r7 ore 6 | r9 ore 10 | r11 wool 9 | r13 brick 12 | r15 lumber 4
  c6: r2 brick 5 | r4 wool 6 | r6 ore 3 | r8 DESERT | r10 brick 11 | r12 brick 8 | r14 ore 11 | r16 grain 6
 Fog cells (25): c0: r4,6,8,10,12,14 · c1: r1,3,5,7,9,11,13,15,17 · c2: r0,2,4,14,16,18 · c3: r1,17 · c4: r0,18
 Pirate: sea cell (3,15)
Face-up components: sea 12, desert 1, gold 2, fields 5, hills 5, mountains 5, pasture 4, forest 4 = 38;
  tokens 2s 1,3s 3,4s 3,5s 2,6s 3,8s 3,9s 2,10s 3,11s 3,12s 2 = 25.
Face-down stack: sea 12, gold 1, fields 2, hills 2, mountains 2, pasture 3, forest 3 = 25 hexes;
  tokens 2s 2,3s 1,4s 1,5s 2,6s 1,8s 1,9s 2,10s 1,11s 1,12s 1 = 13 (13 land).
```

Harbors (9, face down): (5,3) N · (6,2) SE · (4,6) NW · (6,6) NE · (6,10) SE · (3,9) SW · (4,12) SW ·
(6,16) NE · (5,15) S. The robber start follows the 3–4 text ("the hex with the 12"), which is the hills 12 at
(5,13); the diagram also has a desert (open question Q10). Starting settlements go on the face-up
land ("upper/lower island" in the 3–4 text; here the east island; the two gold hexes are single-hex
islands (verify)).

### 2.5 Scenario 4 — Through the Desert

_S5 pp. 17–19._ A big island split by a desert belt; the part beyond the desert, and the small islands, are
"foreign".

**Rules for this scenario**

- A desert belt (3 deserts; 5 in the 5–6 game) divides the largest island into a **small land strip**
  (upper right) and the **main island**. The strip's hexes: 4p fields 8, mountains 11, gold 10; 3p
  fields 6, forest 3, gold 4.
- **Starting settlements go on the main island.** The small islands and the strip are "foreign areas".
- **Special VP:** the **first settlement you build in each foreign area** (each small island, and the strip)
  gets **2 special VP**. Each player can earn at most 8 in the printed layout (4 areas × 2). It does not
  matter if another player already settled there.
- Robber starts on one of the 3 deserts; pirate on the marked sea hex.
- **Game ends at 14 VP.**

**Components (S5 p.17):** first number = main island, second = foreign areas.

|                               | 3 players                                          | 4 players                                           |
| ----------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| Harbors                       | 8 (5+3)                                            | 9 (5+4)                                             |
| Chits                         | 24                                                 | 32                                                  |
| Sea                           | 8 / 2                                              | 10 / 2                                              |
| Desert                        | 3 / 0                                              | 3 / 0                                               |
| Gold                          | 0 / 2                                              | 0 / 2                                               |
| Fields                        | 2 / 2                                              | 2 / 3                                               |
| Hills                         | 3 / 0                                              | 4 / 1                                               |
| Mountains                     | 2 / 2                                              | 2 / 3                                               |
| Pasture                       | 3 / 1                                              | 4 / 1                                               |
| Forest                        | 4 / 1                                              | 5 / 0                                               |
| Hex total                     | 25 / 10 = 35                                       | 30 / 12 = 42                                        |
| Tokens 2/3/4/5/6/8/9/10/11/12 | 1/1/2/1/2/2/2/2/1/0 = 14 · 0/1/1/2/1/1/1/0/1/0 = 8 | 0/2/2/2/2/2/2/2/2/1 = 17 · 1/1/1/1/1/1/1/1/1/1 = 10 |

**Fixed layout, 3 players** (frame SHORT):

```
Main island (14 land + 3 desert):
 c0: r2 wool 8   | r4 wool 4
 c1: r1 ore 10   | r3 grain 9   | r5 lumber 8
 c2: r0 lumber 11 | r2 brick 6  | r4 grain 2   | r6 brick 9
 c3: r3 ore 3    | r5 lumber 10
 c4: r2 DESERT   | r4 brick 5   | r6 wool 6
 c5: r3 DESERT [robber] | r5 lumber 4
 c6: r4 DESERT
Strip (foreign): c4: r0 grain 6 | c5: r1 lumber 3 | c6: r2 GOLD 4
Small islands (foreign): c0: r8 ore 5 | c1: r9 grain 9 | c3: r9 GOLD 5 | c5: r9 wool 11 | c6: r8 ore 8
Foreign sea hexes (2, red outline): (2,10) and (4,10) (verify: they are not unambiguous on the diagram)
Pirate: frame cell (3,11).
```

Foreign areas, 3 players: {strip}, {(0,8),(1,9)}, {(3,9)}, {(5,9),(6,8)} → 4 areas.

Harbors, 3 players (printed face up: 5 special + 3 generic):

| #   | Harbor | Sea / frame cell | Touches                       |
| --- | ------ | ---------------- | ----------------------------- |
| 1   | wool   | (1,-1) frame     | (2,0), side NW                |
| 2   | ore    | (0,0) frame      | (0,2), side N                 |
| 3   | grain  | (3,1)            | (2,2), side NE                |
| 4   | brick  | (-1,3) frame     | (0,2) SW or (0,4) NW (verify) |
| 5   | 3:1    | (0,6)            | (0,4), side S                 |
| 6   | 3:1    | (1,7)            | (2,6), side SW                |
| 7   | 3:1    | (3,7)            | (2,6), side SE                |
| 8   | lumber | (6,6)            | (5,5), side SE                |

**Fixed layout, 4 players** (frame TALL):

```
Main island (17 land + 3 desert):
 c0: r4 lumber 9
 c1: r1 wool 3    | r3 wool 11    | r5 ore 4
 c2: r0 brick 12  | r2 brick 6    | r4 grain 5    | r6 lumber 8
 c3: r3 lumber 10 | r5 brick 11   | r7 wool 9
 c4: r2 DESERT    | r4 ore 8      | r6 grain 10   | r8 lumber 4
 c5: r3 DESERT [robber] | r5 brick 3 | r7 wool 6
 c6: r4 DESERT    | r6 lumber 5
Strip (foreign): c4: r0 grain 8 | c5: r1 ore 11 | c6: r2 GOLD 10
Small islands (foreign): c0: r8 ore 6, r10 grain 12 | c2: r10 GOLD 5, r12 wool 3 | c4: r12 brick 2
                         c5: r11 grain 4 | c6: r10 ore 9
Foreign sea hexes (2): (1,9) and (1,11) (inferred, see §10 Q2)
Pirate: frame cell (3,13).
```

Foreign areas, 4 players: {strip}, {(0,8),(0,10)}, {(2,10),(2,12)}, {(4,12),(5,11),(6,10)} → 4 areas.

Harbors, 4 players (9 tokens: 5 special + 4 generic). The 4-player diagram prints face-up tokens:

| #   | Harbor | Sea / frame cell | Touches        |
| --- | ------ | ---------------- | -------------- |
| 1   | grain  | (1,-1) frame     | (2,0), side NW |
| 2   | ore    | (0,2)            | (1,1), side SW |
| 3   | wool   | (3,1)            | (3,3), side N  |
| 4   | 3:1    | (-1,3) frame     | (0,4), side NW |
| 5   | lumber | (0,6)            | (0,4), side S  |
| 6   | 3:1    | (1,7)            | (2,6), side SW |
| 7   | 3:1    | (3,9)            | (4,8), side SW |
| 8   | 3:1    | (5,9)            | (4,8), side SE |
| 9   | brick  | (6,8)            | (6,6), side S  |

**Variable set-up (S5 p.18–19).**

1. Put the **3 deserts** on their printed cells.
2. Shuffle the **main-island** land hexes (3p 14; 4p 17, not counting the deserts) and deal them onto the
   rest of the main island; place the main-island harbors on the printed spots.
3. Place the 8 (3p) or 10 (4p) **sea** hexes next to the main island as printed.
4. Deal the **main-island number tokens** (14 for 3p, 17 for 4p) onto the main-island land hexes (not the
   desert).
5. Shuffle the **foreign-area hexes** (3p: 8 land + 2 sea; 4p: 10 land + 2 sea) onto the foreign positions
   (red outline on the diagram: the strip and the small islands plus 2 sea hexes), then deal the foreign
   tokens.
6. **Red numbers (6 and 8) must not be adjacent to each other, and must not go on gold fields** (S5 p.19).

**5–6 players: Through the Desert (S56 pp. 12–13).** Frame B, 63 cells, 5 deserts in a vertical belt, 11
harbors (6 special incl. an extra wool + 5 generic), 20 chits. Rules: as 3–4 players; the "foreign areas" are
the east strip/coast and the small islands (my reading, §10 Q2).

```
Desert belt: (5,5) (5,7) (5,9) (5,11) (5,13)      Pirate: sea cell (0,14)       Robber: one of the 5 deserts
Land (38 numbered):
 c0: r2 wool 6 | r6 wool 8 | r8 grain 2 | r12 GOLD 4 | r16 grain 9
 c1: r1 brick 9 | r3 ore 11 | r15 wool 11 | r17 lumber 3
 c2: r0 wool 12 | r2 grain 3 | r4 brick 12 | r6 ore 6 | r8 brick 11 | r10 ore 3 | r12 grain 9 | r18 ore 8
 c3: r1 ore 4 | r3 lumber 5 | r5 grain 10 | r7 brick 5 | r9 wool 10 | r11 lumber 4 | r13 brick 8
 c4: r6 grain 2 | r8 lumber 8 | r10 wool 9 | r12 lumber 10 | r18 GOLD 10
 c5: r1 lumber 5 | r3 wool 2
 c6: r2 GOLD 4 | r4 ore 6 | r6 brick 11 | r10 lumber 12 | r12 grain 5 | r14 ore 3 | r16 brick 6
```

Harbors: only **10 of the 11 sites** could be read, as "land hex, side the harbor touches": (2,0) NW ·
(3,1) NE · (0,2) NW · (1,3) SW · (2,4) SW · (3,5) NE · (2,8) NW · (2,12) NW · (3,13) SW · (3,13) SE
(§10 Q1). The "foreign" areas are the east coast strip (c5/c6) and the small islands, my reading (§10 Q2).

### 2.6 Scenario 5 — The Forgotten Tribe

_S5 pp. 20–21._ A long island with small inhabited islands around it, some of which hold gifts for the first
ship that arrives.

**Rules for this scenario**

- **Starting settlements on the main island** (the big central island).
- **Placed on the board at setup:**
  - **8 Catan chits** on the marked coast edges (each is worth **1 VP** to whoever takes it).
  - **4 development cards** (the 4 topmost of the shuffled deck, **face down**, not looked at) on the marked
    edges.
  - **6 harbor tokens** (5 special 2:1 + 1 generic), **face down** and then flipped, on the marked edges.
- **You may not build settlements** on the small islands "that do not produce resources": the small islands
  have **no number tokens**, so no settlement can be built there. (Only hexes that carry a number token are
  buildable. S5 p.20.)
- **Gifts.** When you **build or move a ship onto the edge** that carries a gift, you take it:
  - **Catan chit**: put it face up in front of you. It is worth 1 VP.
  - **Development card**: you may use it like a bought card (S5 p.20: "the usual restrictions" — one dev
    card played per turn, not playable the turn you take it, a VP card is revealed only if it wins the
    game).
  - **Harbor**: if you have a coastal settlement, you must immediately put the harbor on an **adjacent
    edge**; harbors must never be on adjacent or the same edges. If you have no suitable coastal settlement,
    keep the harbor aside until you have one. You may use it immediately, even the same turn.
- **Robber / pirate:** both play. The robber starts on **any desert**; **the robber cannot move to the small
  islands**; once it has left its desert it cannot go back to that desert. The pirate starts on the marked
  sea hex. A 7 or Knight moves either.
- **Game ends at 13 VP** on your turn.

**Components (S5 p.20):** 6 harbors (5+1); 8 chits; sea 19, desert 3, gold 2, fields 5, hills 5, mountains
5, pasture 5, forest 5 = **49 hexes**; tokens 2s 1, 3s 2, 4s 2, 5s 2, 6s 2, 8s 2, 9s 2, 10s 2, 11s 2, 12s 1
= **18** (all on the main island).

**Fixed layout, 3–4 players** (frame XTALL; `c+r` even). "Main island" = 18 numbered hexes:

```
Main island (18):
 c2: r0 lumber 11 | r2 grain 9  | r4 ore 3   | r6 wool 8   | r8 brick 10 | r10 grain 3
 c3: r1 wool 10   | r3 brick 8  | r5 wool 4  | r7 grain 12 | r9 lumber 5 | r11 wool 2
 c4: r0 grain 6   | r2 lumber 9 | r4 ore 11  | r6 brick 5  | r8 lumber 6 | r10 ore 4
Small islands (12, no tokens, no settlements):
 West:  c0: r2 DESERT | r4 brick | r8 brick | r10 DESERT [robber figure shown] | r12 GOLD
 East:  c6: r2 GOLD  | r4 ore   | r8 DESERT | r10 ore | r12 grain
 South: c2: r14 lumber | c4: r14 wool
Sea inside the footprint (the rest): includes (0,6) and (6,6) [pirate start is (6,6)]
```

Development cards (4): on the **sea cells beyond the island ends**: top-left (0,0), top-right (6,0),
bottom-left (0,14), bottom-right (6,14); each is "next to" the island's end hex edge: N side of (0,2), N side
of (6,2), S side of (0,12), S side of (6,12). A ship on that edge takes the card.

Chits (8) on coast edges: (0,2) SW · (0,8) NW · (0,12) SW · (6,2) SE · (6,8) SE · (6,12) SE · (2,14) S · (4,14) S
(edge "side" is of that hex).

Harbors (the **5 identified sites**; the rules say 6 tokens, one site is not identifiable on the diagram):
(0,2) NW · (0,8) SW · (6,2) NE · (2,14) SW · (4,14) SE.

The three deserts are all on small islands: (0,2), (0,10) and (6,8). The rule says the robber starts on "any
desert", and also that it "cannot be moved to the small islands". So the robber **starts** on a small-island
desert but can never be **moved** onto a small island afterwards. The diagram shows its figure on (0,10); use
(0,10) by default (§10 Q8).

**Variable set-up (S5 p.20):** the main island's terrains and tokens can be rearranged freely, but the 3
hexes at the bottom of the main island must not get 5, 6, 8 or 9.

**5–6 players: The Forgotten Tribe (S56 pp. 14–15).** Frame B (63 cells). 8 harbors (5+3), 10 chits, **6
development cards**.

```
Main island (29), c2/c3/c4 columns:
 c2: r0 lumber 6 | r2 ore 4 | r4 grain 9 | r6 brick 8 | r8 lumber 11 | r10 ore 3 | r12 wool 4 | r14 grain 6 | r16 lumber 3 | r18 ore 6
 c3: r1 lumber 11 | r3 wool 12 | r5 lumber 5 | r7 grain 10 | r9 wool 5 | r11 brick 9 | r13 grain 2 | r15 wool 9 | r17 brick 10
 c4: r0 grain 3 | r2 brick 5 | r4 ore 11 | r6 wool 8 | r8 brick 4 | r10 lumber 10 | r12 grain 4 | r14 brick 3 | r16 lumber 8 | r18 ore 5
Small islands (12, no tokens): West c0: r2 DESERT | r4 DESERT [robber] | r8 ore | r10 brick | r14 grain | r16 GOLD
                                East  c6: r2 DESERT | r4 DESERT | r8 GOLD | r10 GOLD | r14 wool | r16 wool
Pirate: sea cell (0,6)
Dev-card spots (6): sea cells (0,0), (6,0), (0,18), (6,18), and two tilted ones at (-1,7) (next to (0,8) NW) and (7,11) (next to (6,10) SE)
Chits (10): (0,4) NW · (6,2) NE · (6,4) NE · (0,8) SW · (0,10) NW · (6,8) SE · (6,10) NE · (6,14) NE · (0,14) SW · (0,16) SW
Harbors (8): (0,2) NW · (0,4) SW · (6,4) SE · (6,8) NE · (0,10) SW · (0,14) NW · (6,14) SE · (6,16) SE
```

**Open:** the dev-card, chit and harbor "sides" for this and the 3–4 map were read from icons next to coast
hexes; the exact edge may be one over (§10 Q1).

### 2.7 Scenario 6 — Cloth for Catan

_S5 pp. 22–23._ Two big islands and four tiny "village" islands in the middle. You cannot settle the tiny
ones; you trade with them.

**Rules for this scenario**

- **Starting settlements:** on the two **main islands** (either one, or one on each). **Three** starting
  settlements: place the first two as usual (snake order); once the last player has placed their second,
  everyone, **starting with the same player and going clockwise**, places a third settlement. **You receive
  your starting resources when placing the third** (not after the second). (S5 p.22; S6 says the same: for the
  first two settlements "you do not collect any resources".)
- **Villages:** each of the **4 small islands in the middle** has **two number tokens placed on its
  intersections** (the left and right corners of the hex). **8 villages** in total. Each village starts with
  **5 cloth chits** beside it; **10 more chits** are the general supply. You may never settle the 4 islands.
- **Establishing trade relations.** When you have a **shipping route** (ships) from one of your
  settlements/cities that reaches a village's intersection, you:
  - immediately take **1 cloth** (Catan chit) from that village's supply;
  - from then on, each time that village's number is rolled you take **1 more cloth** from its supply.
- If **two or more players** are connected to a village when its number is rolled, **each** gets 1 cloth. If
  the village's supply runs short, the missing chits come from the **general supply**; if the village has
  **0** cloth left, nobody gets anything and the general supply is **not** used.
- **2 cloth chits = 1 VP**. A single, unpaired chit is worth 0.
- **Moving ships.** A shipping route connecting one of your buildings to a village is **closed**: you can
  never move its ships, but you may keep adding ships to it.
- **Robber and pirate.** Both play. The robber starts on the fields hex with the "12" and **cannot be
  moved to the 4 small islands**. The pirate starts on the marked sea hex and **you may not move it until you
  have at least one shipping route to a village**. When you move the pirate you either draw a resource card
  **or take a cloth chit** from a player whose ship is next to the new pirate hex.
- **No Longest Trade Route VP** in this scenario (the special card is not used).
- **Game ends** when a player has **14 VP** on their turn, **or when 3 or fewer villages still have at
  least one cloth chit** (that is, 5 or more are empty). In the second case the player with most VP
  wins; a tie goes to the player with more cloth chits.

**Components (S5 p.22):** harbors 9 (5+4); sea 18, desert 2, gold 2, fields 5, hills 3, mountains 4, pasture
4, forest 4 = **42**; tokens 2s 2, 3s 3, 4s 3, 5s 3, 6s 3, 8s 3, 9s 3, 10s 3, 11s 3, 12s 2 = **28** (20 on the
main islands + 8 village tokens); **50 chits**.

**Fixed layout** (frame TALL):

```
West island (10): c0: r2 wool 10 | r4 lumber 6 | r6 ore 5 | r8 grain 10 | r10 brick 8
                  c1: r1 brick 9 | r3 grain 2  | r9 wool 11 | r11 ore 4
                  c2: r12 ore 2
East island (10): c4: r0 grain 12 [robber]
                  c5: r1 grain 3 | r3 lumber 12 | r9 lumber 3 | r11 ore 9
                  c6: r2 lumber 4 | r4 wool 6 | r6 brick 5 | r8 wool 11 | r10 grain 8
Village islands (4), each hex has two village number tokens on its left (W) and right (E) corners:
  (3,3) DESERT   villages: W 9, E 10
  (2,6) GOLD     villages: W 3, E 6
  (4,6) GOLD     villages: W 8, E 11
  (3,9) DESERT   villages: W 5, E 4
Pirate: frame cell (3,13).
```

Harbors (9, face down, 5+4): (1,-1) frame → (1,1) N · (5,-1) frame → (5,1) N · (7,3) frame → (6,2) SE ·
(-1,3) frame → (0,2) SW (or (0,4) NW) · (-1,9) frame → (0,8) SW · (0,12) frame → (1,11) SW · (2,14) frame →
(2,12) S · (5,13) frame → (5,11) S. **Only 8 of the 9 sites could be read on the diagram** (§10 Q1). All
harbors are on the frame or on sea hexes next to the coast.

**Variable set-up (S5 p.23):** the terrains and tokens of the two main islands can be rearranged freely. The
position and tokens of the 4 centre islands should not change.

**5–6 players (S56 pp. 16–17):** frame A (56 cells), **12 villages** (6 islands: 2 gold + 4 desert), 5 chits
each + 10 general supply = **70 chits**; 11 harbors. The robber starts on the **fields hex with the "11"**.
Rules as 3–4 players.

```
West (13): c0: r2 wool 10 | r4 lumber 6 | r6 ore 5 | r8 lumber 11 | r10 lumber 8 | r12 grain 10 | r14 brick 6
           c1: r1 brick 9 | r3 grain 2 | r13 wool 11 | r15 ore 4
           c2: r0 ore 8 | r16 ore 2
East (13): c4: r0 grain 11 [robber] | r16 wool 3
           c5: r1 grain 3 | r3 lumber 12 | r13 lumber 3 | r15 ore 9
           c6: r2 lumber 4 | r4 wool 6 | r6 brick 5 | r8 grain 12 | r10 brick 3 | r12 wool 11 | r14 grain 8
Village islands (6): (3,3) GOLD W 9 E 4 · (2,6) DESERT W 12 E 6 · (4,6) DESERT W 5 E 2
                     (2,10) DESERT W 10 E 9 · (4,10) DESERT W 8 E 10 · (3,13) GOLD W 5 E 4
Pirate: frame cell (3,17).  Harbors: 12 sites visible on the diagram for 11 tokens (Q1).
```

### 2.8 Scenario 7 — The Pirate Islands

_S5 pp. 24–26._ The pirates have captured the western islands. You must build a navy and win your fortress back.

**Rules for this scenario**

- **Special cards:** the **Longest Trade Route and Largest Army cards are not used** (S5 p.24).
  **There is no robber**; the black pirate piece is the **pirate fleet**.
- **Development cards:** 3 players: **remove the VP cards**. 4 players: the VP cards stay and act as
  **Knights** in every way (they count as Knights for conversion, §4.10; they do not give VP).
- **Setup:** the eastern island is the only one you can colonize in the normal way; the western islands are
  "pirate islands". Each player starts with 1 settlement + 1 ship already on the eastern coast (placed as
  shown), and then places **2 more settlements** with roads/ships on the eastern island → **3 settlements**.
- **Pirate fortresses (4):** each is 3 Catan chits with 1 settlement of the player's colour on top, standing
  on the intersection shown on a western island. **In a 3-player game, remove the white player's fortress
  and white pieces.** Fortresses **do not produce** resources until captured.
- **Shipbuilding.** You may build **only one shipping route**, a single line of ships. It begins at one of
  your coastal settlements/cities on the eastern island, goes to the **intersection with a circle in your
  colour** ("beachhead"), and on to the pirate fortress of your colour. It cannot branch and cannot continue
  beyond the fortress. It must be the **shortest** route: you may not veer off to block others. (6th ed. also
  allows "other routes around the main island"; S5 does not, see §0.3.)
- **Settling the beachhead.** Once your route reaches the circle of your colour you may pay the normal
  settlement cost and build a settlement there. **Only one**; it can become a city. (It doubles the chance of
  being hit by the fleet.)
- **Warships.** When you **reveal a Knight card** (or, with 4 players, a VP card), you can convert your
  **hindmost** "normal" ship (the one closest to the starting settlement/city of your route) into a
  **warship**, laid on its side, and put the card on a discard pile. If the development card deck is
  exhausted, no more development cards can be bought and discarded cards do not return.
- **The pirate fleet.** It sails clockwise around the two desert islands along the printed path. Every time
  you roll the dice, **before anything else** (before production, before a 7 is resolved) the fleet moves a
  number of hexes equal to the **lower** of the two dice (if both are the same, that number).
- **Pirate attack.** If the fleet ends on a hex adjacent to **one of your settlements or cities**, you are
  attacked at once:
  - Pirate strength = the die result used for the move. Your strength = number of your warships.
  - Pirate stronger: you lose 1 resource card, plus 1 more for each of your cities, chosen at random from
    your hand and discarded.
  - You stronger: you get a resource card of your choice. Equal: nothing happens.
- **Conquering a fortress.** If your route has reached the fortress of your colour, you may attack it **at the
  end of your turn**: roll one die = the fortress's strength for this turn.
  - Warships **>** roll: win; remove one of the 3 chits under the fortress.
  - Warships **<** roll: lose; remove the **2 ships nearest the fortress**.
  - Warships **=** roll: lose the ship adjacent to the fortress.
  - After an attack your turn is over, so at most one attack per turn. After a tie or a defeat you must
    build 1 (or 2) ships again before attacking again.
  - When all **3 chits are gone** the fortress becomes your settlement (it gives VP, produces, and can
    become a city).
- **A 7** is rolled: there is no robber, but players with more than 7 cards still discard half, and the
  roller then steals a card from **any one other player** (their choice).
- **Game ends:** you win if you have **captured the fortress of your colour AND have at least 10 VP**. If all
  fortresses are captured before the game ends, remove the pirate fleet.
- **Variable set-up:** none, "except for the harbors" (S5 p.26).

**Components (S5 p.24):** harbors 8 (5+3); sea 19, desert 3, gold 2, fields 5, hills 5, mountains 5, pasture
5, forest 5 = **49**; tokens 2s 1, 3s 2, 4s 3, 5s 3, 6s 3, 8s 3, 9s 3, 10s 3, 11s 2, 12s 1 = **24**; 12
chits. **Three** land hexes carry **no number token**: the pasture on the left two-hex centre island and the
two hills on the western islands at the top.

**Fixed layout** (frame XTALL; the diagram labels its top "WEST" and its bottom "EAST"):

```
Pirate islands ("west", top of the diagram):
 NW island:  c1: r1 brick (NO token)      | c2: r0 grain 10
 NE island:  c4: r0 grain 4               | c5: r1 brick (NO token)
 W islet:    c0: r2 GOLD 3                | c0: r4 ore 6
 E islet:    c6: r2 GOLD 11               | c6: r4 ore 6
 Centre:     c3: r3 ore 8
Desert islands (centre):
 left 2-hex:  c1: r7 wool (NO token) | c2: r6 DESERT
 right 2-hex: c4: r6 DESERT          | c5: r7 DESERT
Eastern island ("east", 17 land, the only land you may settle normally):
 c0: r10 grain 10 | r12 brick 4
 c1: r11 ore 5    | r13 lumber 2
 c2: r10 wool 11  | r12 lumber 8 | r14 wool 9
 c3: r9 grain 6   | r11 brick 9  | r13 wool 12
 c4: r10 lumber 3 | r12 wool 8   | r14 lumber 5
 c5: r11 ore 9    | r13 lumber 10
 c6: r10 grain 4  | r12 brick 5
Pirate fleet start: sea cell (0,8) (black ship).    No robber.
```

(Land of the eastern island by count: c0 2, c1 2, c2 3, c3 3, c4 3, c5 2, c6 2 = 17.)

Pirate fortresses (settlement + 3 chits, on a **vertex of a western-island hex**):

| Colour | Fortress vertex | Beachhead (circle) vertex, a vertex of … |
| ------ | --------------- | ---------------------------------------- |
| Orange | V(0,2,W)        | V(0,4,SW)                                |
| Blue   | V(1,1,E)        | V(3,3,W)                                 |
| White  | V(5,1,W)        | V(3,3,E)                                 |
| Red    | V(6,2,E)        | V(6,4,SE)                                |

(In a 3-player game remove the **white** fortress, circle and pieces.) The route of each colour runs from
a coastal building of that colour on the eastern island, through the beachhead vertex, to the fortress
vertex.

Starting pieces on the eastern coast (1 settlement + 1 ship per colour):

| Colour | Settlement vertex | Ship edge  |
| ------ | ----------------- | ---------- |
| Blue   | V(3,9,W)          | E(3,9,NW)  |
| White  | V(3,9,E)          | E(3,9,NE)  |
| Orange | V(0,10,E)         | E(0,10,NE) |
| Red    | V(6,10,W)         | E(6,10,NW) |

**Pirate fleet path (14 sea cells, clockwise):**
`(0,8) → (0,6) → (1,5) → (2,4) → (3,5) → (4,4) → (5,5) → (6,6) → (6,8) → (5,9) → (4,8) → (3,7) → (2,8) → (1,9) → (0,8)`.
The fleet moves **n steps along this ring** (n = lower die, or the shared value on doubles).

Harbors (8 face-down on the eastern coast; 5 special + 3 generic): (6,10) NE · (6,12) NE · (6,12) S ·
(5,13) S · (3,13) S · (2,14) SW · (1,13) SW · (0,10) SW — sides are of the land hex (§10 Q1).

**5–6 players: The Pirate Islands (S56 pp. 18–19).** Frame B (63 cells). **6 colours**; in a 5-player game
**do not use the brown pieces**. Each colour has a fortress, a circle, and a starting settlement + ship.
**Extra rule:** if the fleet ends its move on the sea hex marked with the large white **"!"**, there are **no
pirate attacks that turn**. 9 harbors (5+4). 18 chits (6 fortresses × 3).

```
North (13): GOLD (2,0) 11 | GOLD (4,0) 11 | GOLD (0,2) 3 | GOLD (6,2) 3
            DESERT (2,2) | DESERT (4,2) | ore (2,4) 6 | ore (4,4) 8 | ore (0,6) 8 | ore (6,6) 6
Centre deserts: (3,7) (1,9) (5,9)     "!" sea hex: (3,5)
Home island (24):
 c0: r12 lumber 9 | r14 grain 5 | r16 lumber 4
 c1: r13 grain 11 | r15 ore 9   | r17 brick 8
 c2: r12 wool 2   | r14 wool 10 | r16 brick 3  | r18 wool 5
 c3: r11 grain 6  | r13 grain 4 | r15 ore 5    | r17 wool 8
 c4: r12 lumber 12| r14 lumber 6| r16 wool 4   | r18 lumber 10
 c5: r13 ore 3    | r15 brick 10| r17 lumber 11
 c6: r12 wool 5   | r14 grain 4 | r16 brick 9
Pirate fleet start (0,8); ring (clockwise, 14): (0,8) (1,7) (2,6) (3,5) (4,6) (5,7) (6,8) (6,10) (5,11) (4,10) (3,9) (2,10) (1,11) (0,10)
Fortresses:  brown V(0,2,NW)  green V(0,2,E)   orange V(2,0,SE)  blue V(4,0,SW)  white V(6,2,W)  red V(6,2,NE)
Circles:     brown V(0,6,SW)  green V(0,6,E)   orange V(2,4,SE)  blue V(4,4,SW)  white V(6,6,W)  red V(6,6,SE)
Start pieces (settlement vertex / ship on the edge above): brown V(0,12,NW) · green V(1,13,NW) · orange V(2,12,NE)
             · blue V(4,12,NW) · white V(5,13,NE) · red V(6,12,NE)
Harbors (9): (0,14) NW · (0,16) NW · (1,17) SW · (1,17) S · (3,17) S · (5,17) S · (6,16) S · (6,16) NE · (6,14) NE
```

### 2.9 Scenario 8 — The Wonders of Catan

_S5 pp. 27–29._ After the pirates are gone, the tribes race to build a Wonder.

**Rules for this scenario**

- **Starting settlements** go on the main island, but **not** on the small islands, **not** on the
  intersections marked with a coloured square (brown and purple), and **not** on the intersections marked
  with a red "!". The booklet states these bans **only for the set-up phase**. The squares are the places you
  need for the Great Bridge / Great Wall later, so they are open after setup. Whether "!" stays banned is
  not said (§10 Q23).
- **Each player gets 1 Catan chit** (the level marker). Wonder cards sit next to the board.
- **Special VP:** the first settlement you build on a **small island** gives **1 special VP** (1 chit), once
  per small island and regardless of other players.
- **Wonder cards (5 in 3–4 players, 7 in 5–6).** You may **start only one wonder**, and only if you already meet its
  **requirement**. The first player to start can choose any of the five; others take what is left (and a
  started wonder is gone for the others).
- **Starting** a wonder: on your turn, once you meet the requirement, place **one of your ships on the
  wonder card** (preferably below the cost icons). From then on you are committed: you have to build it.
- **Levels:** each wonder has **4 levels**; **each level costs the same 5 resources** printed on its card.
  You may build several levels in one turn. After paying for level 1, put a chit on field "1"; move it up as
  you finish levels. You pay the resources to the **bank**.
- **Robber** starts on one of the 3 deserts; the **pirate is not used**.
- **You win** (on your turn): when you finish your wonder (4th level), **or** when you have **10 VP** and your
  wonder is on a **higher level than every other player's** (strictly higher).
- **Variable set-up:** the terrains and tokens of the main island can be rearranged freely inside the
  frame. The two hexes next to the deserts must not get 6 or 8 (S5 p.28).

**Wonders (5th ed., S5 p.27; costs read from the card icons)**

| Wonder       | Requirement to start                                                                    | Cost of each of the 4 levels |
| ------------ | --------------------------------------------------------------------------------------- | ---------------------------- |
| Cathedral    | 1 city and at least **6 VP**                                                            | 1 brick, 1 grain, 3 ore      |
| Great Bridge | a settlement/city **at the strait**: on a purple square                                 | 3 lumber, 1 grain, 1 wool    |
| Great Wall   | a settlement/city **at the wasteland**: on a brown square                               | 3 brick, 1 lumber, 1 grain   |
| Monument     | a **city at a harbor** and a trade route of **5** roads/ships (consecutive, unbranched) | 3 grain, 2 ore               |
| Theater      | **2 cities**                                                                            | 1 lumber, 1 brick, 3 wool    |

5–6 players add **2 more wonder cards** (S56 p.3): in the 2020 printing the two are a second **Great Bridge**
and a second **Cathedral** (same card text); the older printing had **Great Bridge** and a **Library** (2
cities; 1 lumber, 1 brick, 3 wool, i.e. Theater's cost). The wonder tiles of the 6th edition are different
(§0.3).

**Components (S5 p.27):** harbors 9 (5+4); sea 19, desert 3, gold 2, fields 5, hills 5, mountains 5,
pasture 5, forest 5 = **49 hexes**; tokens 2s 2, 3s 3, 4s 3, 5s 3, 6s 3, 8s 3, 9s 3, 10s 3, 11s 3, 12s 1 =
**27**; 5 wonder cards; 10 chits.

**Fixed layout** (frame XTALL):

```
Main island (22 land + 3 desert):
 c0: r2 ore 5     | r6 wool 11   | r8 wool 2
 c1: r3 lumber 3  | r7 lumber 8  | r9 grain 9
 c2: r0 brick 8   | r2 wool 9    | r8 brick 10
 c3: r1 ore 3     | r3 grain 4   | r5 ore 6     | r7 wool 5  | r9 brick 4 | r11 DESERT
 c4: r0 ore 12    | r2 grain 6   | r4 brick 11  | r6 grain 10| r8 wool 3  | r10 lumber 9 | r12 DESERT [robber]
 c5: r7 lumber 11 | r11 DESERT
 c6: r8 ore 10
Small islands (5 land, 1 VP chit for the first settlement on each):
 NE:  c6: r2 GOLD 8 | r4 brick 2         (one 2-hex island)
 SW:  c0: r12 grain 5 | c1: r13 lumber 4 | c2: r14 GOLD 6    (one 3-hex island)
Sea: the rest of the footprint.  Robber start: any desert (diagram shows (4,12)).  No pirate.
```

Special vertices (purple / brown squares and red "!" marks):

| Mark                                           | Vertices                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| Purple (2) — "strait", Great Bridge            | V(1,3,SW) and V(0,6,NE) — the two ends of the sea–sea edge E((0,4)–(1,5)) |
| Red "!" (4) — no settlement during setup (Q23) | V(1,3,W), V(1,3,SE), V(0,6,NW), V(0,6,E)                                  |
| Brown (5) — "wasteland", Great Wall            | V(3,9,SW), V(4,10,W), V(4,10,E), V(4,10,SW), V(4,10,SE)                   |

Harbors (9, face down, 5 special + 4 generic), as "sea/frame cell → land hex, side":
(3,-1)→(3,1) N · (1,1)→(1,3) N · (5,1)→(4,2) NE · (2,4)→(3,3) SW · (5,5)→(4,6) NE or (4,4) SE (verify) ·
(-1,7)→(0,6) SW · (0,10)→(1,9) SW · (2,10)→(1,9) SE · (5,9)→(4,8) SE.

Components per player: a level marker (chit), plus one ship used as a "started" marker on the card.

**Variable layout.** The two hexes adjacent to the deserts must avoid 6/8 (above). Everything inside the
frame outline of the main island may be reshuffled.

**5–6 players: The Wonders of Catan (S56 pp. 20–21).** Frame B, **7 wonder cards**, **4 deserts**
(robber on one of them), 11 harbors, 18 chits. 3 gold fields; 2 straits (4 purple squares); 6 brown squares.

```
Land (35 numbered + 4 desert):
 c0: r4 ore 5    | r6 lumber 9  | r10 wool 2   | r12 wool 11 | r16 GOLD 6
 c1: r1 GOLD 6   | r5 lumber 10 | r7 ore 3     | r11 ore 9   | r13 grain 4 | r17 lumber 4
 c2: r4 brick 8  | r6 wool 5    | r10 brick 4  | r12 lumber 8| r14 ore 12
 c3: r3 grain 9  | r5 ore 3     | r7 lumber 4  | r9 ore 6    | r11 grain 10| r13 wool 9 | r15 brick 10 | r17 DESERT
 c4: r2 brick 2  | r4 wool 5    | r6 grain 6   | r8 brick 5  | r10 grain 3 | r12 wool 8 | r14 lumber 11 | r16 DESERT
 c5: r5 brick 11 | r9 lumber 11 | r15 DESERT   | r17 DESERT
 c6: r2 GOLD 8   | r6 wool 10   | r10 grain 12
Purple (4): W strait V(1,7,SW), V(0,10,NE); E strait V(6,6,SW), V(5,9,NE)
Red "!" (8): V(1,7,W), V(1,7,SE), V(0,10,NW), V(0,10,E), V(6,6,W), V(6,6,SE), V(5,9,NW), V(5,9,E)
Brown (6): V(3,17,W), V(3,17,NW), V(3,17,NE), V(4,16,NW), V(4,16,NE), V(5,15,NW)
Harbors (11): (4,2) N · (3,3) NW · (0,4) SW · (2,4) NW · (4,4) NE · (4,6) SE · (3,7) SW · (0,10) SW · (4,10) SE · (1,13) SW · (2,14) SW
```

### 2.10 Scenario 9 — New World

_S5 pp. 30–31._ Free play: you build the map.

**Setup (S5 p.30):**

1. Assemble the frame (TALL, 42 cells for 3–4 players; frame B, 63 cells for 5–6).
2. Shuffle **all** the listed hexes face down and place them face up at random in the frame.
3. Shuffle the number tokens and put one on each land hex (not on sea). **Red tokens (6, 8) may not touch.** If
   you draw a second red token next to a red one, swap it with a random token from the stack; if the last
   token ends up next to a red one, swap it with any legal token already on the board (all players must
   agree on the swap).
4. Starting with the oldest player and going around, each player takes a random harbor (face up) and places
   it on an edge between a **sea hex and a land hex**, or between **a land hex and a frame piece**: the
   harbor lies on the sea hex/frame piece and **both corners touch the land hex**. S6 adds: stay at least
   one edge away from every other harbor (S5 does not say so; we use the S6 rule).
5. Players may agree to change the hex arrangement ("too many small islands, a main island that is too big").

**Rules**

- **Starting settlements** may go on any islands: both on one island or on two. These are your **home
  islands**; the rest are foreign.
- **Special VP:** if you build a settlement on a foreign island you earn **1 special VP** (one chit), **but each
  player may earn only ONE in total** (S5 p.30). (6th ed.: 1 VP per unexplored island.)
- **Robber and pirate** both play, **starting on the frame** as shown; each enters play when first moved.
- **Game ends at 12 VP.**
- **Variable set-up:** whatever the players agree. FAQ #10: for a custom map, the VP target is **the number
  of terrain hexes without the deserts, divided by 2**.

**Components (S5 p.30; the token table has a printing typo):** harbors 9 (5+4); sea 19; fields 5, hills 4,
mountains 4, pasture 5, forest 5 = 23 land → **42 hexes**; tokens: 2s 1, 3s 3, 4s 3, 5s 3, 6s 2, 8s 2, 9s 3,
10s 3, 11s **2**, 12s 1 = **23** (the 2015 booklet prints 11s as 3 and the total as 23; the older printing
gives 11s = 2: MAYF, consistent with 23 land hexes); 16 chits.

**5–6 players (S56 pp. 22–23):** 63 hexes: sea 21, desert 3, gold 4, fields/hills/mountains/pasture/forest 7
each; tokens 2s 2, 3s 3, 4s 4, 5s 5, 6s 5, 8s 5, 9s 5, 10s 4, 11s 4, 12s **2** = 39 (the 2020 booklet prints
12s as 3 and a total of 39; the older printing gives 2: MAYF); 11 harbors (6+5); 50 chits. Robber and pirate
start on the frame (top and bottom).

**Footprint** (empty frame; every cell is filled at setup): the TALL frame for 3–4 (42 cells) and frame B for
5–6 (63 cells), see §2.0.1.

## 3. Turn structure and every rule change vs the base game

The turn order is the base game's (`docs/RULES.md` §3). 5–6 players add the special build phase (§8.1).
Below, each step lists what Seafarers adds or changes. Anything not mentioned is unchanged.

### 3.1 Turn, step by step

| Step | Base game                                             | Seafarers change (S5 unless noted)                                                                                                                                                                                                                                                         |
| ---- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | Before rolling: may play a Knight or another dev card | **Knight** now has two targets: you move the **robber or the pirate** (p.6). Road Building builds roads and/or ships (p.5).                                                                                                                                                                |
| 1    | Roll two dice                                         | **Pirate Islands only:** immediately after the roll, **before anything else**, move the pirate fleet and resolve its attacks (p.26, §4.10). This is also before resource production and before a 7 is resolved.                                                                            |
| 2    | Production                                            | **Gold fields** pay any resource of your choice (p.6, §4.3). **Cloth for Catan:** villages pay cloth (§4.9). Fog Islands: newly discovered hexes produce like any hex. The robber blocks its hex; **the pirate blocks nothing** on the hexes.                                              |
| 3    | A 7 is rolled: discard, move robber, steal            | Discard as usual (more than 7 cards, lose half). Then the roller moves **either the robber or the pirate** (§4.4). In Pirate Islands there is no robber: the roller just steals a card from another player (p.26). In Forgotten Tribe / Cloth the robber has movement limits (§2.6, §2.7). |
| 4    | Trade and build, any order                            | **Ships** can be built (§4.1) and **one ship may be moved per turn** (§4.2). Scenario actions fit here: pick up gifts (a side effect of a ship move/build), start or build a wonder level, convert a ship to a warship by revealing a Knight (§4.10, §4.11).                               |
| 5    | End of turn                                           | Pirate Islands: **attack your fortress at the end of your turn** if your route has reached it; it ends your turn (§4.10). 5–6 players: special build phase / paired turn (§8).                                                                                                             |
| —    | Victory: 10 VP on your turn                           | The target is **per scenario** (§1.4), special VP count (§5).                                                                                                                                                                                                                              |

The **setup phase** is the base setup (snake order, second settlement pays) with these changes: the first
two settlements must go where the scenario says (§2); a coastal starting settlement may take a **ship
instead of a road** (p.6); Cloth for Catan has a **third** round of settlements (§2.7); Pirate Islands gives
each player a third settlement and a ship before setup, as shown in §2.8.

### 3.2 Ships: who may be built where (all of these must hold)

A **new ship** (built, or moved, or a free ship from Road Building):

1. Is placed on an **edge** that is **not between two land hexes**: it needs at least one non-land side
   (sea hex, frame piece, or a discovered sea hex). A ship on a **coast** edge (land | sea) is allowed unless a
   **road** is already on that edge (S5 p.3; FAQ #17: one piece per edge, so roads and ships cannot lie
   side by side on the same coastline).
2. **Edges next to the frame** (FAQ #15): ships may use the **inner** edges of the frame (the edge between a
   playing-area hex and the frame piece), never the **outer** edge; on the frame itself only at certain spots
   (§10 Q4: we allow only edges that have at least one playing-area hex on one side).
3. **Connects to your network**: one of the edge's endpoints is one of **your buildings** or the end of **one
   of your ships** (S5 p.3). A **road does not connect to a ship** (§3.3). An opponent's building on that
   endpoint blocks it ("you may not build a ship past an opponent's building", S6 p.2, same rule as roads).
4. Is **not on an edge of the hex the pirate stands on** (p.6). This is also true during setup (FAQ #5).
5. Costs **1 lumber + 1 wool**; you must have a ship left (15 per player).
6. The distance and connection rules for settlements apply to what you build afterwards, e.g. a ship reaching
   a coast lets you build a settlement there, **even on another island**, but the **distance rule** still
   holds there (p.4).

### 3.3 Roads and ships are separate networks

- A road is only connected to other roads and to your settlements/cities. A ship only to ships and to
  settlements/cities. They meet **only at a settlement or city of yours** (p.4, FAQ #16): they may reach the
  same intersection, but they are **not connected** (for building and for the Longest Trade Route) until you
  build a settlement or city there. Unconnected networks count separately for the Longest Trade Route.
- **A road can be built on a coast edge** (it follows the base rules) and cannot be built on a sea–sea edge.
- A **Road Building** card (p.5): 2 roads, or 2 ships, or 1 road + 1 ship (FAQ #1: build them one after the
  other, i.e. you can't build a road, then a settlement, then a ship "with the same card").

### 3.4 Open and closed routes, and moving a ship

Moving (S5 p.4; FAQ #12, #13, #14, #18; S6 p.2): **one ship per turn, during your build phase, free of
charge.** All of the following must hold:

1. The ship was **not built this turn** (S5 p.4). Only one move per turn is allowed, so a ship that was just
   moved is not moved again either.
2. It is **not part of a closed route** (below).
3. One of its **two ends is not adjacent to any of your other pieces** (ship, road, settlement or city of
   yours; 5th ed. wording. The 6th edition lists ships and buildings only, §0.3).
4. It is **not adjacent to the pirate**: you may not move a ship away from an edge of the pirate's hex (p.6).
   6th ed.: you also may not move a ship **onto** an edge of that hex.
5. The **destination** is any edge where you could build a **new** ship (FAQ #13), evaluated with the ship
   removed: connected to your remaining pieces, empty, not next to the pirate, not a land–land edge.

**Closed shipping route**: an unbroken line of your ships that **interconnects two of your settlements/cities**.
Its ships can **never** move, even if moving one would not break the connection (p.4). **Open route**: any
other route (FAQ #18).

FAQ #18 details: (a) an opponent's settlement built on your closed route **interrupts** the trade route but
the adjacent ships **do not** become open; (b) a loop that starts and ends at **one** settlement leaves **one**
end open; (c) ships in a loop that connects to no settlement are **all** open. FAQ #14 says the same for
interruption.

**Engine consequence:** "closed" cannot be derived from the current board (rule (a)); it must be **stored per
ship** and set the moment a route becomes closed (§9.2, §10 Q6).

### 3.5 The Longest Trade Route (p.5; replaces Longest Road; FAQ #12, #16)

- Same card, same **2 VP**, same minimum length (**5**), same tie rule (the holder keeps it on a tie) as the
  base Longest Road (`docs/RULES.md` 9.1–9.8).
- The route counts **roads and ships** (open or closed). Roads and ships join **only at your own settlement
  or city** (§3.3). Only the **single longest branch** counts: a path with no repeated edge, no branching.
- An **opponent's settlement/city** on a vertex of the path interrupts it there (base rule).
- Moving a ship does **not** by itself cost you the card: you keep it "as long as your continuous route is at
  least as long as before" (FAQ #12). The award is recomputed after every action.
- **Cloth for Catan:** the card is **not used**; no VP (p.22). **Pirate Islands:** **not used** (p.24).
- 6th edition calls it the "Longest Route" tile (§0.3), same thresholds.

### 3.6 Settlements, cities, and the distance rule

- **Distance rule:** a settlement needs every adjacent vertex empty, **also across a narrow water gap** between
  islands (FAQ #11), and applies when you land on a new island (p.4).
- A settlement must be **connected** to your road **or** ship network (end of an own road/ship at the vertex),
  except in setup.
- **Starting settlements on the coast** may place a **ship** instead of a road next to them (p.6): "you can
  then go out to sea at once". It must be on a coast/sea edge adjacent to that settlement and not next to the
  pirate (FAQ #5).
- Scenario limits: only hexes **with a number token** may be settled in Forgotten Tribe (§2.6); never the 4
  village islands in Cloth (§2.7); in Wonders, never the "!" and square vertices **during setup** (§2.9,
  Q23).

### 3.7 Harbors

Harbors work as in the base game (2:1 for one resource, 3:1 for any), **except:** they can be on the frame,
Forgotten Tribe harbors are **taken** from the board by ships (§4.8), and in New World players place them
(§2.10). A harbor token is a coastal edge with two vertices; owning a settlement/city on **either** gives
the rate (base rule). Do not mix with the small harbor tokens of the base game (p.2).

### 3.8 Development cards

- **Knight:** moves the robber or the pirate (§4.4). Counts for Largest Army either way.
- **Road Building:** §3.3.
- **Year of Plenty, Monopoly, VP cards:** unchanged. **Pirate Islands changes the deck** (§2.8): no VP cards
  for 3 players; for 4 players VP cards act as Knights and **give no VP**; Knights and VP cards are consumed
  to build warships.
- **Forgotten Tribe:** a development card picked up from the board is **used like a bought card**: it may not
  be played the turn you take it, you still play only one dev card per turn, and a VP card is revealed only
  if it wins you the game (p.20).

## 4. New actions, pieces and cards: exact rules

### 4.1 Ship

| Item         | Value                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cost         | 1 lumber + 1 wool (S5 p.3)                                                                                                                                    |
| Supply       | 15 per player                                                                                                                                                 |
| Where        | §3.2                                                                                                                                                          |
| Counts for   | Longest Trade Route (§3.5); the pirate steals from a player who has a ship adjacent to a hex (§4.4); "route reaches a village / gift / fortress" in scenarios |
| Timing       | Build phase of your turn (and the special build phase for 5–6 players); also as a free piece from Road Building; also at setup instead of a road              |
| Warship      | Pirate Islands only: a ship laid on its side (§4.10). Otherwise no difference.                                                                                |
| Ship removal | Pirate Islands only: lost battles remove ships (§4.10). Ships are otherwise never destroyed. A removed ship returns to your supply.                           |

### 4.2 Moving a ship

Rules: §3.4. Timing: **once per turn, during the trade/build phase** (not before the roll, not during the
special build phase of 5–6 players; S56 p.3). No cost. The move is an atomic "remove + place". Effects of the
new placement fire as if the ship were built there: **discovery** (§4.7), **gifts** (§4.8: "build (or move) a
ship"), **village connection** (§4.9), **route reach** (§4.10).

### 4.3 Gold fields (S5 p.6; FAQ #2, #3)

- A **gold field hex** has a number token like any other hex, but produces **no card of its own**: when its
  number is rolled each settlement next to it gives **1 resource of your choice** (grain, lumber, ore, brick
  or wool) and each city **2**, in **any combination** (FAQ #2: two of the same, or two different).
- **Cities and settlements** are treated per building; the bank pays as usual (bank shortage: open point,
  §10 Q5).
- The **robber blocks** a gold field as any hex. **There are no gold cards.**
- A **small island** or "foreign island" consisting only of gold fields still pays the usual special VP
  (FAQ #3).
- Red numbers on gold: the Through-the-Desert variable setup forbids red 6/8 on gold fields (S5 p.19); S6's
  free-play note says the same for New World ("Gold fields should not receive red" numbers).

### 4.4 The pirate (S5 p.6; FAQ #4–#7)

- One black piece. It is placed near the board (or on the marked sea hex, or the frame) at setup.
- **Move:** when you roll a **7** you may move the pirate instead of the robber; when you play a **Knight**
  you choose one of the two. The pirate is placed **in the centre of a sea hex** (the frame counts too, FAQ #4,
  "unless the scenario forbids it"). It never goes on land. After moving it you **steal 1 random resource
  card from one player who has a ship on an edge of that hex** (FAQ #7: a coastal settlement/city alone does
  **not** qualify). If the hex has ships of several players you choose **one** victim; if a victim has several
  ships there you still steal **only one** card.
- **Effects while it sits on a hex:**
  - **No new ship** may be built on an edge of that hex (pirate hex: all 6 sides).
  - **No ship may be moved away** from an edge of that hex.
  - Roads, settlements and cities next to it are **not affected** (FAQ #6).
  - It **does not block production** of any hex.
- **Scenario overrides:** Forgotten Tribe / Cloth (restrictions on moving and steal choices), Pirate Islands
  (it is the fleet, not this piece, §4.10), Wonders (not used), New World (starts on the frame and enters play
  when first moved).
- **Robber without a desert:** it starts beside the board and enters play on the first 7 or Knight (FAQ #9).

### 4.5 Catan chits and special victory points (S5 p.5)

- A chit is a VP **token**. When you earn one you **place it under the settlement or city that earned it**;
  it stays with that building (the building cannot be removed). They count **on top of** the building's own
  VP (a small-island settlement is worth 1 + the chits).
- Chits can also be **markers** (wonder level, cloth, gifts) per scenario.
- A chit is **never traded**; it is not a resource card. (Not stated; §10 Q15.)

### 4.6 Islands and "first settlement" bonuses

Definitions the engine needs (derived from S5 pp. 8, 11, 17, 27, 30):

- An **island** = a connected set of land hexes (adjacent by a shared edge). Recompute after discovery.
- **Main island** and **small islands** are named by the scenario map: in the fixed layouts of §2.2, §2.5,
  §2.9 the main island is listed first. In **Four Islands** and **New World** there is no main island:
  every island is **home** (it holds one of your starting settlements) or **foreign** (all others), **per
  player** (S5 p.11).
- **Foreign area bonus (Heading for New Shores, Through the Desert, Wonders): first settlement of each player on each
  non-main island/area** → 2 VP (HNS, Desert) / 1 VP (Wonders). **Four Islands:** first settlement on each
  foreign island → 2 VP (max 6, or 4 with two home islands). **New World:** 1 VP once per player in total
  (S5 p.30).
- It does **not matter** if another player already settled there, or whose home island it is (S5 pp. 8, 11, 17).
- Additional settlements on the island never pay again; cities never pay.
- Through the Desert: a **foreign area** is the **strip** (the part above/behind the desert belt) or **each
  small island**; the main island has none.

### 4.7 Fog (The Fog Islands only; S5 p.14)

- The "fog" cells are the empty (white, "?") cells of the map. The **face-down stack** has the hexes of §2.4
  (12 hexes: 10 land + 2 sea; 25 in the 5–6 game), shuffled with their reverse sides up; the **number token
  stack** (10 tokens; 13 in 5–6) is also shuffled face down.
- **Discovery:** when you place a **ship or road** (built, free, or moved) whose end vertex is a corner of a fog
  cell, you **discover** that cell: turn the top stack hex and put it in the cell. If it is **land**, also take
  the top token and put it on it, **then take 1 resource card of that hex's type from the bank** as a
  reward. If it is **sea**, nothing else happens ("sorry", p.14).
- A placement may touch several fog cells: discover all of them (one by one, the order does not matter for
  the stack).
- A discovered land hex is a normal land hex: it produces and can be settled; if it was **gold**, the reward
  and the production are "any resource" (open point §10 Q9).
- If the stack runs out, no more hexes appear (cannot happen when counts match; the stack has exactly as many
  hexes as fog cells).
- No special VP, no chits (p.14).

### 4.8 Forgotten Tribe gifts (S5 p.20)

- Gifts lie on **edges**. You collect one when you **build or move a ship onto that edge**.
- **VP chit:** face up in front of you; **1 VP**.
- **Development card:** you get it without paying and it counts as bought this turn (not playable until next
  turn, one dev card played per turn).
- **Harbor:** you take the token. If you have a coastal **settlement/city**, you **must immediately** place
  the harbor on an **adjacent edge** (an edge of a hex next to your settlement/city); harbors may never be on
  adjacent or the same edges. If you cannot, keep it until you can. A placed harbor works **immediately,
  even the same turn**.
- Settlements are only allowed on hexes that **carry a number token**; the small islands carry none.

### 4.9 Cloth (Cloth for Catan only; S5 p.22)

- **Villages** are number tokens on the corners (W and E vertices) of the four centre hexes. Each starts
  with 5 cloth chits (8 villages × 5 = 40 + 10 supply = 50).
- You **connect to a village** when a **ship route** of yours from one of your buildings reaches that vertex
  (the end vertex of one of its ship edges is the village vertex). Any route that connects a building to a
  village **is closed** (§3.4): you may add ships to it but not move the ships on it.
- On connection: take **1 cloth** from that village. Every time the village's number is rolled: **each connected
  player takes 1 cloth** from it; if the village runs short the missing chits come from the **general
  supply**; if the village is **empty** nobody gets anything and the supply is **not used**.
- **2 cloth = 1 VP**; an odd chit counts 0.
- **Moving the pirate** (when allowed, §2.7): steal either a resource card or a cloth chit from a player with
  a ship on an edge of the new hex.
- **End:** 14 VP, or when **3 or fewer villages still hold a chit** at the moment checked (end of that
  turn in S6: "at the end of the turn"). Winner = most VP; tie → most cloth.

### 4.10 Pirate Islands (S5 p.24–26)

- **Fleet movement:** each roll, **before anything else**, the black pirate piece moves **n steps along the
  printed ring** (§2.8); n = the **lower** of the two dice; on doubles n = that value.
- **Attack:** a player is **attacked** if one of their settlements or cities is adjacent to the hex where
  the fleet **stops** (not to hexes it passes). Pirate strength = **the die used for the move**. Player
  strength = the **number of warships** they have.
  - Pirate stronger: the player loses 1 random resource card + 1 more per city (random from the hand, to the
    bank). If the hand is smaller, they lose what they have (§10 Q12).
  - Player stronger: they gain **1 resource of their choice** (from the bank).
  - Equal: nothing. With several attacked players each is resolved separately (order: §10 Q12).
  - The attack comes **before production** and before the 7 effects.
- **Ship line:** exactly **one** route per player (no branching; shortest path; ends at the fortress) in the
  5th edition (§2.8). Ships on that route are the only ones that may become warships.
- **Beachhead:** a settlement may be built on the beachhead vertex once the route reaches it; **one only**;
  it can become a city.
- **Warship conversion:** whenever you **play** (reveal) a Knight (or a VP card in a 4-player game) you may
  convert the hindmost standard ship of your route into a warship (turn on its side) and **discard the card**.
  Knights have no other use in this scenario (there is no robber, and the Largest Army card is not in play).
  S6 adds: "Knight cards may only be used to convert ships into warships".
- **Attack on the fortress:** at the **end of your turn**, if your route **has reached** the fortress of your
  colour, you **may** attack: roll **one die**. `warships > roll` → remove one chit; `warships < roll` → remove
  the **two ships nearest to the fortress**; `warships == roll` → remove **the ship adjacent to the
  fortress**. Your turn then ends; one attack per turn. After a loss you need to **rebuild** the missing ships
  to reach the fortress again.
- **Fortress capture:** when its **third chit** is removed the fortress is **your** settlement: 1 VP,
  produces, upgrades. It was not producing before (S6 note).
- **End:** capture your fortress **and** have **≥ 10 VP** (checked on your turn).

### 4.11 Wonders of Catan (S5 p.27–28)

State per player: `wonder: {card, level 0..4}`. The "start" marker is a ship from the player's supply on the
card.

- **Start (turn action):** if you hold no wonder, meet the requirement of a wonder card nobody has started,
  you place a ship on it. No resources are paid by this action itself.
- **Build a level:** pay the 5 resources of the card; level +1. **Any number per turn.** Resources go to the
  bank.
- **Requirement checking:** only at the moment you **start** (the requirement need not stay true).
  "Settlement at the strait / wasteland" = a settlement **or city** (the card says settlement; the 6th
  edition says "a building"; §10 Q14) on a purple / brown vertex. "Trade route with at least 5 consecutive,
  unbranched roads or ships" = your **longest trade route** (§3.5), length ≥ 5.
- **Win:** level 4, or (≥ 10 VP and your level strictly higher than every other player's, checked on your turn).
- 5–6 players: two more cards (§2.9).

### 4.12 Harbor placement in New World (S5 p.30)

Start with the oldest player and go around: each player takes a random harbor token (face up) and puts it on
an edge between a **sea hex and a land hex** (or a **land hex and a frame piece**), lying on the sea hex/frame
piece, **both corners touching land**, and (S6) at least **one edge away** from every other harbor.

## 5. Victory conditions and scoring

### 5.1 Points

A player's VP = settlements (1 each) + cities (2 each) + Longest Trade Route (2) + Largest Army (2) + VP
development cards (1) + **special VP** (chits under buildings; Forgotten Tribe chits in front of the player;
**cloth chits ÷ 2** rounded down) + **fortress** (1, when captured; it counts as a settlement) as per scenario.

### 5.2 Targets and special conditions

| Scenario          | VP target                     | Special VP                            | Longest Trade Route / Largest Army      | Extra win / end condition                                                |
| ----------------- | ----------------------------- | ------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| 1 HNS             | 14                            | 2 per small island (first settlement) | used                                    | —                                                                        |
| 2 Four Isl.       | 13                            | 2 per foreign island (max 6/4)        | used                                    | —                                                                        |
| 3 Fog             | 12                            | none                                  | used                                    | —                                                                        |
| 4 Desert          | 14                            | 2 per foreign area (max 8)            | used                                    | —                                                                        |
| 5 Forgotten Tribe | 13                            | 8 chits (1 each) from edges           | used                                    | —                                                                        |
| 6 Cloth           | 14                            | cloth: 2 chits = 1 VP                 | **Longest not used**; Largest Army used | Or end when ≤ 3 villages still hold cloth: most VP wins; tie: more cloth |
| 7 Pirates         | 10 + fortress                 | fortress capture                      | **neither card used**                   | Win only with fortress of your colour captured **and** ≥ 10 VP           |
| 8 Wonders         | 10 + higher level, or level 4 | 1 per small island                    | used                                    | Complete wonder (level 4) wins at once                                   |
| 9 New World       | 12                            | 1 once in total (5th ed.)             | used                                    | —                                                                        |

VP checks follow the base rule (`docs/RULES.md` 11.2–11.4): you win **during your own turn**; reaching the
target on someone else's turn wins at the start of your next turn. With C&K add 2 VP (§8.2). The cloth
ending is the only end that is not "a player reaches X": S6 says it is checked "at the end of the turn".

## 6. Edge cases and official rulings

### 6.1 Official Seafarers FAQ (catan.com, 18 entries, our paraphrase)

| #   | Topic         | Ruling                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | Road Building | One card can build a road **and** a ship, but one after the other (not road, settlement, ship, with the same card).                                                                                                                                                                                                                                                      |
| F2  | Gold          | A city on a gold field gives you **two of the same** or two different resources: your choice.                                                                                                                                                                                                                                                                            |
| F3  | Gold          | A gold-only island still gives the special VP where the scenario gives them for a first settlement on a foreign island (two VP, including gold-only islands).                                                                                                                                                                                                            |
| F4  | Pirate        | The pirate may go "on an edge" (frame/edge hexes) **unless the scenario says no**.                                                                                                                                                                                                                                                                                       |
| F5  | Pirate        | You may **not** place a starting ship next to the pirate.                                                                                                                                                                                                                                                                                                                |
| F6  | Pirate        | Roads, settlements and cities **may** be built next to the pirate. **Ships may not.**                                                                                                                                                                                                                                                                                    |
| F7  | Pirate        | You cannot steal from the owner of a **coastal settlement** next to the pirate's hex (only from owners of **ships** there).                                                                                                                                                                                                                                              |
| F8  | Roads         | A road may be built **between two desert hexes** (the edge counts as a normal land edge).                                                                                                                                                                                                                                                                                |
| F9  | Robber        | No desert in the scenario: the robber starts **beside the board** and enters on any terrain hex at the first 7 or Knight, then moves normally.                                                                                                                                                                                                                           |
| F10 | Custom maps   | VP target for a custom scenario: count the terrain hexes **not counting deserts** and **halve** it.                                                                                                                                                                                                                                                                      |
| F11 | Settlements   | The distance rule **applies across a narrow waterway** between islands.                                                                                                                                                                                                                                                                                                  |
| F12 | Ships         | Moving a ship does **not** cost you the Longest Trade Route as long as your continuous route afterwards is **at least as long as before**.                                                                                                                                                                                                                               |
| F13 | Ships         | An open ship may move to **any spot where you could build a new ship**.                                                                                                                                                                                                                                                                                                  |
| F14 | Ships         | An opponent's settlement that splits your route does **not** make the adjacent ships open.                                                                                                                                                                                                                                                                               |
| F15 | Ships         | Frame pieces: **inner edge always**, **outer edge never**, **on the frame only at certain spots**.                                                                                                                                                                                                                                                                       |
| F16 | Ships         | A road and a shipping route can meet at an intersection, but unless a settlement joins them they count as **two separate** trade routes.                                                                                                                                                                                                                                 |
| F17 | Ships         | Roads and ships may **not run in parallel** along the same coastline.                                                                                                                                                                                                                                                                                                    |
| F18 | Ships         | A ship is **open** at the end of a route; a route linking two settlements/cities (or knights in C&K) is **closed** and its ships cannot move; an opponent's settlement on the route interrupts the trade route but does not reopen the ships; a loop starting and ending at one settlement leaves one end open; ships of a loop connected to no settlement are all open. |

### 6.2 More rulings (from the scenario text, numbered for tests)

| #   | Ruling                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | A ship cannot be placed on an edge between two land hexes, even if one of the hexes is a desert.                                                              |
| E2  | A ship and a road cannot share an edge; whoever is there first blocks the other.                                                                              |
| E3  | A closed route's ships can still be **extended**; only moving them is forbidden (Cloth: "you may keep adding ships to it").                                   |
| E4  | A ship moved to a new edge counts as placed there for gifts, discovery and village connection; the **old** edge keeps nothing.                                |
| E5  | The first **special-VP** settlement is per player and per island, even when another player is already there.                                                  |
| E6  | Four Islands: the 2-VP bonus is lost on **home** islands. If you start on **two** islands the maximum is 4 VP; on one island it is 6.                         |
| E7  | A fog hex that turns out to be sea gives **nothing**; a land hex gives **1 resource of the hex's type** to the player who discovered it.                      |
| E8  | A gift **harbor** must be placed at once on an adjacent coast edge of one of your buildings; two harbors can never be on adjacent edges or the same edge.     |
| E9  | A Forgotten Tribe **development card** taken from the board cannot be played in the same turn.                                                                |
| E10 | Cloth: an empty village gives nothing even if the general supply still has chits.                                                                             |
| E11 | Cloth: the pirate cannot be moved by a player with no ship route to a village; **robber** is not restricted that way, but cannot enter the 4 village islands. |
| E12 | Pirate Islands: your strength against the fleet is the number of **all** your warships; only ships on your one route can become warships.                     |
| E13 | Pirate Islands: the fleet only attacks where it **ends** its move.                                                                                            |
| E14 | Pirate Islands: no fortress produces resources until captured.                                                                                                |
| E15 | Pirate Islands: no Longest Trade Route and no Largest Army card at all.                                                                                       |
| E16 | Wonders: a wonder you started has to be built; a started wonder cannot be started by another player.                                                          |
| E17 | Wonders: buying several levels in a turn is allowed; a level is paid in full (5 cards), never partially.                                                      |
| E18 | Wonders: the "higher level than any other player" check is **strict**; ties do not win.                                                                       |
| E19 | New World: robber and pirate begin on the frame and are put in play the first time they are moved.                                                            |

## 7. Interactions with the base rules

| Base rule                  | With Seafarers                                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Board                      | A scenario map with sea cells, a frame and islands; not the fixed island (§2).                                                                                                                 |
| Terrain and production     | New terrain **gold** (§4.3). Sea never produces. Fog hexes produce once discovered (§4.7).                                                                                                     |
| Robber                     | May start beside the board (FAQ #9); scenario restrictions on where it can go; shares the 7/Knight with the pirate (§4.4).                                                                     |
| Rolling a 7                | Discard as usual, then **robber or pirate**; Pirate Islands: no robber, just steal from any player (S5 p.26).                                                                                  |
| Knight / Largest Army      | Knights move robber **or** pirate; Largest Army counts them all; not used in Pirate Islands.                                                                                                   |
| Road Building              | Two roads, two ships, or one of each (§3.3).                                                                                                                                                   |
| Longest Road               | Becomes **Longest Trade Route** counting roads **and ships** (§3.5); not used in Cloth/Pirate Islands.                                                                                         |
| Settlements: distance rule | Applies across water and on new islands (FAQ #11).                                                                                                                                             |
| Settlements: connection    | Own road **or** ship (never a road to a ship without a building).                                                                                                                              |
| Trading (players and bank) | Unchanged. Gold has no card, so cannot be traded. Cloth chits are not traded (§4.5, Q15).                                                                                                      |
| Harbors                    | May be on the frame; Forgotten Tribe picks them up; New World places them (§3.7).                                                                                                              |
| Development cards          | Deck composition unchanged except Pirate Islands (§3.8). The card pile is **not reshuffled**: when empty, no more purchases (also the discard pile of warship cards does not return, S5 p.24). |
| Victory                    | Per scenario target, special VP and special win rules (§5).                                                                                                                                    |
| Bank                       | 19 of each resource (3–4 players), 24 for 5–6 (the 5–6 bank of `docs/RULES.md` §16). No gold or cloth cards in the bank; cloth chits come from the village / general supply.                   |
| Special build phase (5–6)  | Ships may be built but not moved; no trading (§8.1).                                                                                                                                           |

## 8. Combination rules

### 8.1 With the 5–6 player extension (Seafarers 5–6)

- You need **both** 5–6 extensions (base and Seafarers) plus the base and Seafarers boxes (PAGE: "four
  game boxes").
- **Turn:** S56 (2020): the **special build phase** from the base 5–6 extension after every turn (S56 p.3).
  Players act in turn after the active player's end of turn: they may **build** (roads, **ships**,
  settlements, cities) and **buy development cards**; **no trading** (also not with the bank); **no moving
  of ships** (S56 p.3: "you cannot move ships during the special build phase").
- **S56b (2023)** replaces this with the **paired player turn** (chart "New Rules for 5–6 Players": player 1
  rolls, trades with players and the supply, builds, does scenario actions; player 2 trades with the supply
  only, builds and does scenario actions). Not implemented in our engine; a note only.
- **Scenarios** use the same rules, with scenario-specific differences in §2.x: Six Islands replaces Four
  Islands; Pirate Islands adds 2 players (brown/green) and the "!" hex; Cloth has 12 villages; Wonders has 7
  wonders; HNS uses the 5–6 base island as its main island (S56 p.6–7).
- **Victory points** are not restated for 5–6 (§1.5, Q18).

### 8.2 With Cities & Knights (PAGE)

Official adjustments (catan.com Seafarers page):

1. Use only suitable scenarios: **Heading for New Shores** and **Through the Desert** are suitable; the
   exploratory scenarios (Fog Islands, New World) and the many-islands scenarios are **not**.
2. **Raise every scenario's VP target by 2.**
3. A **city on a gold field** gets **resources only, never commodities**.
4. The **merchant** may not be placed on a gold field.
5. A **knight** may move across the sea if the intersection it starts from is connected (ships carry a
   knight): "a knight can also be moved across the sea if the intersection he starts from is connected"; an
   active knight may move to an intersection between three sea hexes.
6. A knight on an intersection bordered by the **last ship of a shipping route** **closes** that route.
7. If you interrupt a **foreign** shipping route with a knight (or a settlement), the owner cannot break it up by
   moving its ships bordering your knight.
8. **Deactivating** an active knight adjacent to the sea hex of the pirate lets you move the pirate.
9. The rule "the robber must not move until the barbarians have reached Catan for the first time" also
   applies to the **pirate**.
10. The barbarian attack works like C&K on every island.

### 8.3 With Traders & Barbarians (PAGE, COMBO)

- The Seafarers product page says the expansions cannot be combined as "rules for building and moving ships
  are significantly different", yet the introduction says Seafarers "can also be combined with" T&B and links
  five official PDFs (COMBO). The page does not resolve the contradiction (§10 Q20). The PDFs support
  scenarios of T&B with a Seafarers map:
  - **Barbarian Attack** needs one continuous land surface with distinctly numbered coastal hexes, so most
    scenarios are unsuitable; ships may be built on the edges of conquered hexes, and routes may only be changed
    if connected to an unconquered building; no robber, no pirate.
  - **Merchant Trains:** wagons may go on sea edges without a wagon (though with a ship); a wagon on the
    same edge as a ship counts as an extra ship for the longest route; **+2 VP** needed.
  - **Fishing for Catan:** the lake hex only where surrounded by land; 2 fish tokens remove the pirate; 5 fish
    build a free ship; ships have no effect on acquiring fish tokens; the pirate may sit on a fishing ground
    and block it; the player with the old boot needs +1 VP.
  - **Rivers of Catan:** each ship on a river edge pays 1 gold; no ship on a bridge site.
  - **Traders & Barbarians (overall):** wagons may move across sea hexes (2 MP, 1 MP with your ship, 1 MP + 1
    gold with an opposing ship); the robber and the pirate are not used; a Knight may place a barbarian on a
    sea edge; players need **3 extra VP**.
- **Not in scope for us**; listed so the engine design leaves room.

## 9. Implementation notes for our engine

### 9.1 What changes in the engine (architecture level)

`docs/ARCHITECTURE.md` fixes a **land-only board with an implicit water ring**, hexes in pointy-top axial
coordinates and frames `std19/std30/hex37`. Seafarers needs:

1. **Explicit cells.** `board.hexes` must hold **sea**, **frame** and **fog** cells too (or keep sea
   implicit but as an explicit list for the footprint). A cell has `kind: 'land'|'sea'|'frame'|'fog'`.
2. **Terrain `gold`** besides the five resources and desert.
3. **Edge kinds:** `land` (both sides land), `coast` (land | non-land), `sea` (none land). Roads: land or
   coast. Ships: coast or sea. Needs a topology that is built from the **cell list** instead of the frame
   id (`topologyOf(state)` currently derives from `frame`). A cell at the board edge touches the frame:
   frame cells are valid neighbours (their other edges are not valid ship edges, §3.2).
4. **Vertices:** a vertex is a **building site** if at least one of its 3 cells is land (and, per scenario,
   not blocked). A vertex with no land neighbour is only an end of ships.
5. **Pieces:** `pieces.ships: Record<EdgeId, {owner, warship?: true, closed?: true}>`; **per-turn** fields in
   `turn`: `shipsBuilt: EdgeId[]` (may not be moved this turn), `shipMoved: boolean`.
6. **Pirate:** `pirate: HexId | null` plus the fleet position for Pirate Islands (`fleet: number` index on the
   ring). `robber: HexId | null` (null = beside the board).
7. **Maps as data:** a `ScenarioDef` (§9.3) used by `createGame`, not code per scenario.
8. **Special state:** `specialVP: Record<PlayerId, {source: string, vp: number}[]>`, `fog: {hexes, tokens}`
   (shuffled at game creation with the game RNG, like `devDeck`), `gifts`, `cloth`, `wonders`, `fortresses`.
9. **Save migration:** bump `schemaVersion`, `upgradeState` adds defaults for all new fields.

### 9.2 State (proposed names; the framework agent decides)

```ts
interface SeafarersState {
  scenario: ScenarioId;
  island: Record<HexId, number>; // connected component id of land hexes; recomputed on discovery
  specialVP: Record<PlayerId, { vp: number; vertex: VertexId; why: string }[]>;
  fog?: { hexes: Terrain[]; tokens: number[] }; // face-down stacks, top = end
  gifts?: Record<EdgeId, { kind: 'chit' | 'dev' | 'harbor'; payload?: DevCardType | Port }>; // Forgotten Tribe
  villages?: Record<VertexId, number>; // Cloth: chits left
  clothSupply?: number;
  cloth?: Record<PlayerId, number>; // chits held
  villageLinks?: Record<VertexId, PlayerId[]>; // who is connected (derivable from routes, store for speed)
  wonders?: { started: Record<WonderId, PlayerId | null>; level: Record<PlayerId, number> };
  pirateIslands?: {
    fleet: number;
    fortress: Record<Color, { vertex: VertexId; lair: number }>;
    route: Record<PlayerId, EdgeId[]>;
  };
}
// pieces.ships[e] = { owner, warship?, closed? }  (closed is persistent; see §3.4)
// turn: { ..., shipsBuilt: EdgeId[], shipMoved: boolean }
```

### 9.3 `ScenarioDef` data

```ts
interface ScenarioDef {
  id; name; players: [min, max]; vpToWin; frame: 'short'|'tall'|'xtall'|'A'|'B'|'empty';
  cells: Array<{ c: number; r: number; kind: 'land'|'sea'|'frame'|'fog'; terrain?; token?; region?: 'main'|'small'|'strip'|string; unnumbered?: true }>;
  harbors: Array<{ cell: [c, r]; land: [c, r]; side: Side; kind?: 'generic' | Resource; faceDown: boolean }>;
  harborSupply: { special: Resource[]; generic: number };
  robber: [c, r] | 'offboard'; pirate: [c, r] | 'frame' | null;
  specials: { vpIslands?: …; fogStack?: …; gifts?: …; villages?: …; fortresses?: …; wonders?: …; markers?: … };
  variable?: { regions: …; rules: … };      // §2.2–§2.10 "Variable set-up" in data form
}
```

Use the data in §2 as test fixtures: **every scenario map must satisfy its printed component table** (hex
counts by terrain, number token counts by value, harbor counts) — assert in `maps.test`.

### 9.4 New actions and phases

| Action / phase                           | Notes                                                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildShip{edge}`                        | §3.2. Triggers discovery/gift/village/route events. Cost 1 lumber + 1 wool.                                                                                                 |
| `moveShip{from,to}`                      | §3.4. Once per turn.                                                                                                                                                        |
| `placeSetupRoad` accepts a **ship** edge | Starting ship (§2.1): extend `setup.ts`; only if the settlement is coastal.                                                                                                 |
| `moveRobber` / `movePirate`              | Choice at 7/Knight: `{piece:'robber'                                                                                                                                        | 'pirate', hex}`; steal candidates differ (§4.4). |
| `chooseGold` (phase `gold{pending}`)     | After production, each player entitled to gold picks resources; resolved with the discard-style pending map. Bank shortage rule §10 Q5.                                     |
| `startWonder{card}` / `buildWonderLevel` | §4.11.                                                                                                                                                                      |
| `convertWarship` (via Knight/VP card)    | Pirate Islands only.                                                                                                                                                        |
| `attackFortress`                         | End of turn (Pirate Islands). A die roll from the game RNG.                                                                                                                 |
| `placeHarbor{edge}`                      | Forgotten Tribe gift and New World setup.                                                                                                                                   |
| Setup variants                           | Cloth for Catan third round; Pirate Islands pre-placed pieces.                                                                                                              |
| Pirate fleet                             | Part of `rollDice` in Pirate Islands: move + attacks before production; attacks may need a "choose" step only for the winner's reward (resource of choice) → pending phase. |

Everything random goes through the seeded RNG: the fog stack, the harbor draw, the Cloth/Fortress dice, the
fortress strength roll, the pirate victim's stolen card.

### 9.5 Algorithms the engine must implement

1. **Ship legality** (`canBuildShip(state, p, edge)`): §3.2; reuse the road code with a different edge-kind
   predicate and "connection" definition: one endpoint holds your building **or** one of your ships' endpoints
   and is not held by an opponent's building.
2. **Closed-route detection** (on every build/move): union-find over your **ship edges** with your buildings
   as nodes. A ship edge is on a **closed route** if it lies on a **path between two different buildings**
   of yours in the ship graph (Steiner path); mark them `closed` once and never clear it (except when the ship
   is removed). Dead-end branches are not on such a path and stay open (§10 Q6).
3. **Movable ship:** not in `shipsBuilt`, not `closed`, has an **end vertex with no other piece of yours**
   (5th ed.), not next to the pirate.
4. **Longest trade route**: DFS over edges (roads **and** ships) as in the existing longest-road code in `src/engine/rules/`, with
   transitions between a road edge and a ship edge allowed **only at a vertex holding your building**;
   opponents' buildings block.
5. **Island ids** by flood fill; update on discovery.
6. **First-settlement VP:** after `buildSettlement`, if the vertex touches a land hex of an island that is
   `small`/foreign for that player and the player has no settlement there yet, add `specialVP`.
7. **Gold:** production produces a pending choice per player, not cards.
8. **Pirate steal candidates:** players with a ship on an edge of the hex.
9. **Production blocked** only by the robber; the pirate does nothing there.

### 9.6 HUD (what the UI must show)

Per player: VP with a **breakdown** (buildings, trade route, army, special VP, cloth/2, fortress); ships left;
whether the free ship move was used this turn; the pirate and robber positions; legal ship destinations when
a ship is selected (greyed edges with reason: blocked by pirate, closed route, built this turn); **gold
choice dialog**; **fog stack counters**; **discovery log lines** ("discovered a 6 pasture"); islands marked
"home/foreign" with remaining bonus; Cloth: village supplies and cloth per player; Forgotten Tribe: gift
markers on edges; Pirate Islands: fleet position, strength of the last roll, warship count and the route to
the fortress with the 3 lair chits; Wonders: card levels and requirements checklist; **win condition text**
per scenario; the **Longest Trade Route** label and length.

### 9.7 Bots

- The random bot must only choose from `legalActions` (so `legalActions` must include `buildShip`,
  `moveShip`, `chooseGold`, `movePirate`, etc.).
- A simple heuristic bot needs: settle new islands first when special VP are available, don't strand ships,
  prefer gold on a missing resource, build toward the fortress in Pirate Islands.
- Simulator invariants to add: ship count per player ≤ 15; no ship on a land–land edge; no road on a sea edge;
  every chit/gift appears exactly once; fog stack sizes match the number of undiscovered cells; sum of cloth
  chits constant (supply + villages + held); wonder cost paid; the number of dev cards conserved.

### 9.8 Suggested tests

Rules (each cites the rule id):

1. A ship cannot be placed on a land–land edge (E1); a ship can on a coast and a sea edge (3.2).
2. Road and ship on the same coast edge is rejected (F17, E2).
3. A road and a ship that meet at an intersection are not connected until a settlement is built there (F16).
4. A ship needs an adjacent own building or own ship end; not through an opponent building.
5. Ships next to the pirate cannot be built or moved (F5, F6); roads/settlements next to it can.
6. Moving a ship: one per turn; not the ship built this turn; not a closed ship; needs a free end; destination
   per F13; F12: keep Longest Trade Route.
7. F14: an opponent's settlement between your ships does not reopen them.
8. F18 loop cases.
9. Longest Trade Route counts ships and roads joined at a settlement; ≥ 5 needed; ties keep the holder.
10. Road Building: 2 ships, 1+1, 2 roads (F1).
11. Gold: settlement pays 1, city pays 2, any combination; robber blocks; bank shortage.
12. Pirate: 7 with the pirate: steals only from a ship owner (F7), only one card.
13. Robber off board at start when there is no desert (F9).
14. Special VP: first settlement per island per player (E5, E6); gold-only island (F3).
15. Fog: discovery on build and on move; land → token + reward; sea → nothing; stack counts.
16. Forgotten Tribe: gift on build/move; harbor placement and the adjacency rule; dev card restrictions.
17. Cloth: connect → 1 cloth; roll → 1 cloth for each connected player; empty village; closed routes;
    2 chits = 1 VP; end conditions; third settlement and starting resources after the third.
18. Pirate Islands: fleet movement lower die; attack only on stop; strengths; fortress strength die; captured
    fortress counts as a settlement; both victory conditions; 3 vs 4 players (VP cards removed vs Knights).
19. Wonders: requirements, ship marker, level costs, several levels per turn, wins (level 4 / ≥ 10 VP and
    strictly higher).
20. Scenario maps: component tables (terrain counts, tokens, harbors) match §2; no red neighbours in
    variable maps; island counts for the fixed layouts: HNS 3p 3 islands; Desert 3p/4p 4 areas, etc.
21. Determinism: same seed → same fog order, same harbor draw.
22. JSON-safe state and `legalActions` ⊆ `applyAction` accepted for all new actions.

## 10. Open questions and ambiguities (with our recommendation)

| Q   | Question                                                                                                                                      | Recommendation                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Harbor sides and some sites were read from small icons (HNS, FT 6th harbor, Cloth 9th, Desert 5–6 11th, Pirate edges, Wonders).               | Treat the listed (sea cell → land side) as a default; where the text says "or", pick the first. Randomized-harbor scenarios do not depend on the exact edge. Test: the number of sites equals the printed harbor count where known.                |
| Q2  | Foreign sea hexes in Through the Desert (2) and "foreign area" outline in 5–6.                                                                | 3p: (2,10),(4,10); 4p: (1,9),(1,11). For 5–6: strip + east coast and small islands.                                                                                                                                                                |
| Q3  | HNS "small island positions" that are sea (4 of 12 / 13) are not marked.                                                                      | Fixed layout: as printed. Variable: the 4 printed sea cells + the 8/9 land cells of the printed layout are the shuffle positions.                                                                                                                  |
| Q4  | FAQ #15 "on the frame itself only at certain spots".                                                                                          | Ships allowed on every edge with at least one playing-area cell on a side; frame-only edges are not buildable. Pirate may sit on a frame cell.                                                                                                     |
| Q5  | Bank shortage with gold picks; gold at the 2nd settlement; discovery of gold.                                                                 | Gold picks are limited to resources the bank still has; evaluate players in turn order from the roller; second settlement pays "any resource" for gold; discovered gold = player's choice of resource.                                             |
| Q6  | "Closed" status after interruption, loops at one settlement (FAQ #18).                                                                        | Persistent `closed` per ship set when a ship path joins two different buildings of the owner; a loop at a single building is **not** closed and stays subject to the free-end test, so none of its ships is movable if both ends touch own pieces. |
| Q7  | Free-end test: do roads count as "other pieces" (5th) or not (6th)?                                                                           | 5th (roads count). Recorded as a setting later if needed.                                                                                                                                                                                          |
| Q8  | Forgotten Tribe: robber start on a small-island desert although it may never move there.                                                      | Start on the printed desert (0,10); forbidden destinations only apply to moves.                                                                                                                                                                    |
| Q9  | Fog discovery of gold: reward and number token.                                                                                               | Reward: 1 resource of the player's choice. Token: from the stack as usual (10 tokens match 10 land hexes).                                                                                                                                         |
| Q10 | 5–6 Fog robber start ("the hex with the 12") while the 5–6 map has a desert.                                                                  | Desert (6,8) in 5–6.                                                                                                                                                                                                                               |
| Q11 | Pirate Islands: is the attack on the fortress compulsory?                                                                                     | Optional (5th: "can"), 6th: automatic. Engine: an explicit `attackFortress` action available only at the end of the turn.                                                                                                                          |
| Q12 | Pirate Islands: order of resolving several attacked players; fewer cards than the loss.                                                       | Clockwise from the roller; lose all cards if you have fewer.                                                                                                                                                                                       |
| Q13 | Does moving a ship through the fog count for discovery?                                                                                       | Yes (S5: "place a ship or road").                                                                                                                                                                                                                  |
| Q14 | Great Bridge / Great Wall "settlement at …": does a city also qualify?                                                                        | Yes (a building; the 6th ed. says "a building").                                                                                                                                                                                                   |
| Q15 | Can cloth chits or gold be traded?                                                                                                            | No.                                                                                                                                                                                                                                                |
| Q16 | Wonders: the "start" ship comes from supply or from the board?                                                                                | From the player's supply (reduces available ships by 1); never removed.                                                                                                                                                                            |
| Q17 | Can a player build wonder levels during the special build phase (5–6)?                                                                        | Yes (it is "building"); no trading.                                                                                                                                                                                                                |
| Q18 | VP targets for 5–6 players.                                                                                                                   | Same as 3–4 for each scenario.                                                                                                                                                                                                                     |
| Q19 | New World token table typo (11s: 3 vs 2; 5–6 12s: 3 vs 2).                                                                                    | Use the values that sum to the land hex count (§2.10).                                                                                                                                                                                             |
| Q20 | T&B contradiction on the catan.com page.                                                                                                      | Out of scope; treat T&B + Seafarers as unsupported for now.                                                                                                                                                                                        |
| Q21 | Wonder cards in 5–6: the two extra wonders differ between the 2020 (Great Bridge + Cathedral) and an older printing (Great Bridge + Library). | Implement the 2020 pair; keep costs in data.                                                                                                                                                                                                       |
| Q22 | Wonders: costs were read from icons on the card images (the catan.com PDF omits the card art).                                                | Costs in §2.9 were read at high resolution from the Mayfair printing's card image and are consistent with the 2015 booklet image and with the 2020 5–6 booklet's Great Bridge and Cathedral cards. Verify once against the box.                    |
| Q24 | Fog Islands 4 players: the printed face-up token table disagrees with the diagram (3s, 6s, 10s, 11s).                                         | Fixed layout = the diagram; the table is used for the randomized layout. Test the diagram against its own sums only (17 tokens).                                                                                                                   |
| Q23 | Wonders: do the red "!" vertices (and the squares) stay banned after setup?                                                                   | Banned **only during setup**, as written. (The "!" next to a purple square would otherwise let someone block a strait by distance rule.) Make it a map flag `noSettleAfterSetup`.                                                                  |

## 11. Engine status (E2, `src/expansions/seafarers`)

Mode `seafarers`, nine scenarios `seafarers/<key>` (`newShores`, `fourIslands`, `fogIslands`,
`throughTheDesert`, `forgottenTribe`, `clothForCatan`, `pirateIslands`, `wondersOfCatan`,
`newWorld`), each with a 3-player, 4-player and 5-6 player map (`seafarers/hns3` ... `newworld56`;
20 maps, `engine/maps.ts`, data in `engine/mapdata.ts`). Option `seafarers.layout`: `fixed`
(the printed map, default) or `variable` (the scenario's variable set-up). Tests:
`engine/maps.test.ts` (printed component tables), `engine/ships.test.ts`, `engine/scenarios.test.ts`,
`bots.test.ts`; sim invariants in `invariants.ts`.

| Rule                                                                                                                                                                                                                                                                                         | Status                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §2.0 book coordinates → axial, footprints SHORT / TALL / XTALL / A / B, the frame ring                                                                                                                                                                                                       | done (`coords.ts`)                                                                                                                                                 |
| §2.1 harbours drawn face down onto the printed spots (printed kinds kept where the doc gives them)                                                                                                                                                                                           | done                                                                                                                                                               |
| §2.1 robber / pirate start (marked hex, frame, beside the board)                                                                                                                                                                                                                             | done (`OFF_BOARD` = the framework's `NO_ROBBER`)                                                                                                                   |
| §2.1 starting ship instead of a road (FAQ #5: not next to the pirate)                                                                                                                                                                                                                        | done (`seafarers/placeSetupShip`; none in Pirate Islands, one route only)                                                                                          |
| §2.1 a paying starting settlement on gold picks a free resource (Q5)                                                                                                                                                                                                                         | done (gold phase interrupts setup)                                                                                                                                 |
| §2.x starting settlements only on the main island(s)                                                                                                                                                                                                                                         | done (`setupRegions`, override + filter)                                                                                                                           |
| §2.2-§2.10 fixed layouts and component tables                                                                                                                                                                                                                                                | done for all 20 maps; HNS 5-6 has no printed layout: **our design** (30-hex base 5-6 island + 3 small islands)                                                     |
| §2.x variable set-ups (shuffle groups, reds apart, no red on gold, FT / Wonders token bans)                                                                                                                                                                                                  | done; deserts never move (HNS 4p's desert stays, **assumed**); New World harbours placed at random, at least one edge apart (instead of by the players)            |
| Harbour sites the doc could not read (Q1)                                                                                                                                                                                                                                                    | ours: FT 6th (6,8) NE, Cloth 9th (6,6) SE, Desert 5-6 11th (6,16) SE, Cloth 5-6 all 11; Pirate Islands 5-6 (1,17) S → (2,18) S (two printed sites shared a corner) |
| §3.2 ship placement (sea side or inner frame edge, never land–land, connection, no road on the edge, not next to the pirate)                                                                                                                                                                 | done (`canPlaceShip`)                                                                                                                                              |
| §3.3 roads and ships separate; joined only at your settlement / city                                                                                                                                                                                                                         | done                                                                                                                                                               |
| §3.3 Road Building: 2 roads, 2 ships or 1 + 1                                                                                                                                                                                                                                                | done (override + `seafarers/placeFreeShip`)                                                                                                                        |
| §3.4 moving a ship (once a turn, main phase only, not built this turn, free end, not closed, not next to the pirate, anywhere a new ship could go)                                                                                                                                           | done (`seafarers/pickShip` → `seafarers/moveShip` / `cancelMove`)                                                                                                  |
| §3.4 closed routes stored per ship, never reopened (FAQ #14, #18)                                                                                                                                                                                                                            | done (`markClosedRoutes`; routes to a Cloth village close too)                                                                                                     |
| §3.5 Longest Trade Route (roads + ships, ≥ 5, holder keeps ties)                                                                                                                                                                                                                             | done (`roadLength` hook); not used in Cloth / Pirate Islands                                                                                                       |
| §3.6 settlements reached by ship; distance rule across a strait (FAQ #11)                                                                                                                                                                                                                    | done (override + `vertexBlocked`)                                                                                                                                  |
| §4.3 gold fields (settlement 1, city 2, any mix; robber blocks; bank limit)                                                                                                                                                                                                                  | done (`seafarers/gold` phase, `seafarers/pickGold`)                                                                                                                |
| §4.4 the pirate (7 or Knight: robber or pirate; any sea or frame hex; robs a ship owner only)                                                                                                                                                                                                | done (`seafarers/movePirate`)                                                                                                                                      |
| §4.5-§4.6 special VP for new land (per player per island; HNS / Desert 2, Wonders 1, Four Islands foreign islands 2, New World 1 once)                                                                                                                                                       | done (`awardNewLand`, chits under the settlement)                                                                                                                  |
| §4.7 fog: discovery by ship or road (built, free or moved), token, 1 card (gold: a free pick)                                                                                                                                                                                                | done                                                                                                                                                               |
| §4.8 Forgotten Tribe gifts (chit 1 VP, dev card as bought, harbour placed at once or kept); no settlement without a token; robber not on the small islands                                                                                                                                   | done                                                                                                                                                               |
| §4.9 Cloth: three setup rounds (only the third pays), village links, cloth per roll, supply, 2 cloth = 1 VP, closed routes, pirate only with a link and may take cloth, robber not on the villages, end at ≤ 3 villages                                                                      | done (`setupOrder` hook = card F3); end checked at the end of a turn (S6 wording)                                                                                  |
| §4.10 Pirate Islands: one shortest ship line, beachhead, warships by Knights (VP cards are Knights with 4+ players, removed with 3), fleet sails the lower die before anything else, attacks, fortress attack ends the turn, capture, win = fortress + 10 VP, no LTR / LA, 7 robs any player | done (`pirates.ts`, `armySize` hook)                                                                                                                               |
| §4.10 5-6: "!" hex (no attack there), 6 colours, 5 players drop brown                                                                                                                                                                                                                        | done                                                                                                                                                               |
| §4.11 Wonders: requirement at the start, a ship marks the card, several levels a turn, level 4 wins, 10 VP + strictly highest level wins; marked corners closed in setup only (Q23)                                                                                                          | done; 5-6 adds a second Great Bridge and Cathedral (Q21)                                                                                                           |
| §5 victory per scenario                                                                                                                                                                                                                                                                      | done (core check; Pirate Islands / Wonders through the `wins` hook, after the awards)                                                                              |
| §8.1 5-6 players: special build phase (ships yes, moves no)                                                                                                                                                                                                                                  | done; the 2023 paired turn = the `secondSettler` variant                                                                                                           |
| §8.2 Seafarers + C&K, §8.3 + T&B                                                                                                                                                                                                                                                             | not done (no C&K / T&B modules on this branch)                                                                                                                     |

Variants: Event Cards, the friendly robber, the chess clock, balanced dice, rush / turbo, random
turn order and the second settler work with every scenario. Refused in `createGame` (and so on the
setup screen): Event Cards with the Pirate Islands (the fleet sails by the dice), the 5+ rule set
and map balance rules (scenario maps have their own set-ups). `robberMode: 'none'` also keeps the
pirate still (both move on the same 7 / Knight step). When the scenario's robber bans (with the
friendly robber's limits) leave no hex and the pirate cannot move, the robber may go to any land
hex, so a 7 never stalls the game.

Statistics: gold picks count as production, discovery and fleet rewards as events, pirate
steals as steals, the fleet's attacks as stolen cards; special VP show as "New land", "Gifts"
and "Cloth" chips (`statsCategory` hook, `victoryPoints().parts`). Online play is base-only (the protocol
pins `mode: 'base'`); the fog stack and gift cards are not masked by `viewFor` yet.

Open questions answered by the engine (§10): Q4 frame edges, Q5 gold with a short bank, Q6
closed routes, Q7 roads count for the free end, Q8 FT robber start, Q9 discovered gold, Q11
fortress attack optional, Q12 attack order clockwise from the roller, Q13 moving through fog
discovers, Q14 a city qualifies for the strait / wasteland, Q15 no trading cloth, Q16 the
wonder marker ship comes from the supply, Q17 wonder levels in the special build phase, Q18 5-6 VP
targets as 3-4, Q19 New World tokens, Q21 2020 wonder pair, Q23 marks only in setup. The Pirate
Islands line is the strict shortest route (a player whose every shortest step is taken waits).
