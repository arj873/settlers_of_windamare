# CATAN – Explorers & Pirates: rules reference for the engine

Written for the engine-framework agent and the engine agents who implement the mode. Everything is in
our own words, with sources per section. Where the rules are silent or the sources disagree, §10
gives our recommended reading. **Do not code a rule from memory; check this file, then the source.**

Compiled 2026-10-25 by the rules-researcher agent (branch `s3/rules-ep`). No code was touched.

## 0. Sources, target edition, edition differences

### 0.1 Sources

| Key       | Source                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R6**    | _Explorers & Pirates Rulebook_ (CN3085, 6th ed., 2025, 16 pp; contains the full game). https://www.catan.com/sites/default/files/2025-04/CN3085%20CATAN%20%E2%80%93%20E%26P%20Rulebook.pdf                                                                                                                                                                                   |
| **M6**    | _Explorers & Pirates Mission Guide_ (6th ed., 2025, 20 pp; four teaching scenarios, each with a board map and hex/disc tables). https://www.catan.com/sites/default/files/2025-04/CN3085%20CATAN%20%E2%80%93%20E%26P%20Missions.pdf                                                                                                                                          |
| **E56-6** | _Explorers & Pirates 5–6 Player Expansion_ (CN3086, 2025, 8 pp). https://www.catan.com/sites/default/files/2025-04/CN3086%20CATAN%20%E2%80%93%20E%26P%205-6%20Expansion%20Rules.pdf                                                                                                                                                                                          |
| **CK**    | _Explorers & Pirates combined with Cities & Knights_ (2025, 2 pp). https://www.catan.com/sites/default/files/2025-08/ExplorersPirates%20w%20CnK.pdf                                                                                                                                                                                                                          |
| **TB**    | _Explorers & Pirates combined with Traders & Barbarians_ (2025, 2 pp). https://www.catan.com/sites/default/files/2025-08/ExplorersPirates%20w%20TnB.pdf                                                                                                                                                                                                                      |
| **R5**    | _Explorers & Pirates_ rule book, **5th edition** (Catan Studio, "Catan-E&P 2015 Rule Book", 16 pp). Hosted copy (not catan.com): https://cdn.1j1ju.com/medias/8d/db/3c-catan-explorers-pirates-rulebook.pdf                                                                                                                                                                  |
| **E56-5** | _Explorers & Pirates 5–6_ (Catan Studio, 2020, 2 pp). https://www.catan.com/sites/default/files/2021-08/catan_e_p_5-6_2020_rules.pdf                                                                                                                                                                                                                                         |
| **FAQ**   | Official FAQ, 12 entries, no edition label; the page refs in it ("page 15", "page 19") match the 5th-ed. book. https://www.catan.com/faq/explorer-pirates (read 2026-10-25). We number the entries FAQ-1…12 in page order. The page content was read through a summarising fetch, so quote the exact wording from the site before relying on a fine point (see FAQ-6 in §6). |
| **PROD**  | Product page, lists the PDFs above. https://www.catan.com/explorers-pirates                                                                                                                                                                                                                                                                                                  |
| **IMG**   | The board maps, component pages and mission tracks in R6, M6, E56-6 and R5, rendered and read by eye. Every coordinate in §2 comes from here. Our reading was cross-checked by counting hexes against the component tables (see §2.0); it is not an official data file.                                                                                                      |
| **BASE**  | `docs/RULES.md` (our base-game reference, R5/R6 base rules). Base rules not mentioned here still apply.                                                                                                                                                                                                                                                                      |

One thing we did **not** use: officialgamerules.org. Its Explorers & Pirates page contradicts the
official books (invented scenario names, wrong ship cost). Ignore it.

### 0.2 Target edition: the 2025 6th edition (R6/M6), with R5 as a cross-check

Our brief said to prefer the 5th edition unless something better is clear. Something better is
clear: the 6th-edition PDFs are the **current official catan.com files**, they include all four
teaching scenarios with full maps, the 5–6 player expansion and the Cities & Knights /
Traders & Barbarians combination sheets. **The gameplay rules of the 5th and 6th editions are
almost identical** (same costs, same piece counts, same VP targets, same missions, same maps), so the
choice costs us nothing. §0.3 lists every difference we found. Anything marked **[5e]** is the older
wording; anything marked **[6e]** is the 2025 wording. Unmarked rules are the same in both.

### 0.3 5th vs 6th edition: every difference we found

| #   | Topic                 | 5th edition (R5, 2015 print)                                                                                                      | 6th edition (R6/M6, 2025) – **our target**                                                                                                         |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Mission scoring       | Mission cards + VP cards (separate pieces).                                                                                       | Mission tracks printed on frame pieces + bonus VP tiles. Same spaces, same VP.                                                                     |
| D2  | Winning               | "You win if you have N VP **on your turn**."                                                                                      | "N or more VP **at any point during your turn**, the game ends immediately."                                                                       |
| D3  | Spice sack            | Place a crew on the village **in exchange for** a spice sack.                                                                     | Unload 1 crew onto the farm **first**, then load the sack. Crew stays forever.                                                                     |
| D4  | Pirate Bonus numbers  | Two villages show a die face of 5 and 4.                                                                                          | "The number shown on the hex". Same result (4 and 5; both → 4, 5, 6).                                                                              |
| D5  | Gold compensation     | Explicit: you get 1 gold when a roll gives **you** no resources, **except on a 7**; applies to every player, whoever rolled.      | "If you do not receive any resources from producing hexes, you receive 1 gold." No 7 exception and no statement about non-roller players (§10 Q3). |
| D6  | 7 discard             | Discard half (rounded down) if you hold **more than 7** resource cards.                                                           | "Select half (rounded down) of your cards." The 7-card threshold is the base rule (R6 base); BASE §5.2 uses "more than 7".                         |
| D7  | 5–6 players           | Special Building Phase (E56-5): after each turn, others may build in order. No ship moves, no trading, no gold purchases.         | **Paired players turn** (E56-6): player 2 takes an Action + Movement phase after player 1's turn. See §8.                                          |
| D8  | 5–6 scenarios         | Only one: _Explorers & Pirates 5–6_ (full game), plus a "Pirate Lairs 5–6" island description.                                    | Scenarios 2, 3, 4 and the full game. No Land Ho! for 5–6.                                                                                          |
| D9  | Scenario 1 / 2 maps   | Fixed island for Land Ho and Pirate Lairs, **random** terrain from scenario 3 on (numbers always fixed).                          | Same. M6 adds an optional "randomise terrain" note for Pirate Lairs, numbers never change.                                                         |
| D10 | Setup, 2 players      | Neutral harbor settlements then settlements placed in turn order; Land Ho: neutral pieces remain, **only settler ships removed**. | Neutral pieces placed the same way; Land Ho: "do not place any neutral ships".                                                                     |
| D11 | Extra-move wording    | "Buy 2 additional MP for 1 wool, once per ship per turn."                                                                         | Player aid: "Extra Ship Move, 1 wool, 1× per ship per turn, +1–2 extra spaces". Rulebook: "move up to six edges instead of four".                  |
| D12 | New small components  | —                                                                                                                                 | "Trade rate tile" (reminder card: 3:1 and 2 gold:1, twice per turn). No rule change.                                                               |
| D13 | Fish delivery wording | "Move your marker forward 1 space."                                                                                               | Rulebook says "one **additional** space"; Mission Guide example says one space. We read it as **1 space** (§10 Q7).                                |
| D14 | 3-player Land Ho      | "Don't place the pieces of the fourth, unused color."                                                                             | Silent.                                                                                                                                            |

Differences in hex/token counts: none found for 3–4 players. We read the text of the 5th-edition 5–6
book (E56-5) but did not decode its maps; all 5–6 coordinates in this file come from the 2025 book.

---

## 1. Overview and components

Sources: R6 pp. 3–5; M6 pp. 2, 5; E56-6 p. 2; IMG.

### 1.1 What the expansion is

A seafaring module for the base game. It is **not** a standalone game and it **replaces** large parts
of the base game rather than adding to them. Players start on one home island. They build harbor
settlements and ships, carry settlers and crews across the sea, turn over unexplored hexes, and
complete up to three missions set by the Council of Catan.

Scenarios (each uses all rules of the previous one):

| #   | Scenario                       | Adds                                                                    | VP to win |
| --- | ------------------------------ | ----------------------------------------------------------------------- | --------- |
| 1   | **Land Ho!**                   | harbor settlements, ships, settlers, exploring, gold, gold trading      | 8         |
| 2   | **Pirate Lairs**               | crews, pirate ships, tribute, chasing, gold fields, lair mission        | 12        |
| 3   | **Fish for Catan**             | Council of Catan hex, fish shoals + hauls, fish mission                 | 15        |
| 4   | **Spices for Catan**           | spice farms + sacks, farm advantages, spice mission (drops gold fields) | 15        |
| 5   | **Explorers & Pirates** (full) | all three missions together                                             | 17        |

Official scope: 3–4 players; a 2-player variant exists (§2.10); 5–6 players need the 5–6 extension (§8).
The base game's **development cards, cities, robber, Longest Road / Largest Army, bonus VP tiles and harbors (ports) are not used** (R6 p. 5; R5 p. 3).

### 1.2 Per-player pieces

| Piece                 | Count / player | Source                | Notes                                                                            |
| --------------------- | -------------- | --------------------- | -------------------------------------------------------------------------------- |
| Road                  | 15             | CATAN                 | roads only on explored land hexes                                                |
| Settlement            | 5              | CATAN                 | 1 VP. Returned to supply when replaced by a harbor settlement                    |
| **Harbor settlement** | 4              | E&P                   | 2 VP, produces like a settlement (1 card), basin holds 1 large or 2 small pieces |
| **Ship**              | 3              | E&P                   | holds 1 large or 2 small pieces                                                  |
| **Settler**           | 2              | E&P                   | "large". Becomes a settlement on arrival                                         |
| **Crew**              | 9              | E&P (not in Land Ho!) | "small". Soldiers on lairs, merchants on spice farms                             |
| **Pirate ship**       | 1              | E&P (not in Land Ho!) | only one pirate ship on the board at a time                                      |
| **Mission marker**    | 3              | E&P                   | one per mission track used (up to 3)                                             |
| Player aid            | 1              | E&P                   | building-cost card (§4.1)                                                        |
| Gold                  | 2 at start     | E&P coins             |                                                                                  |

Size classes: **large** = settler, fish haul (1 per hold or basin). **small** = crew, spice sack (2 per hold or basin).

### 1.3 Shared components (3–4 players, full game)

From the E&P box (R6 pp. 3–4):

| Component                          | Count | Notes                                                                                                                              |
| ---------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Parrot hexes (back: green parrots) | 17    | north region. 1 hill, 1 forest, 1 pasture, 1 field, 2 mountains, 2 seas, 3 gold fields, 3 fish shoals (1, 2, 3), 3 spice farms     |
| Goose hexes (back: orange geese)   | 17    | south region. 1 hill, 1 forest, 1 pasture, **2 fields**, 1 mountain, 2 seas, 3 gold fields, 3 fish shoals (4, 5, 6), 3 spice farms |
| Parrot number discs                | 6     | 3, 4, 5, 6, 9, 10 (one each)                                                                                                       |
| Goose number discs                 | 6     | 4, 5, 8, 9, 10, 11 (one each)                                                                                                      |
| Sea hexes                          | 23    | plain face-up water                                                                                                                |
| Council of Catan hex               | 1     | counts as a sea hex; has 2 anchors (§4.9)                                                                                          |
| Pirate lair tokens                 | 6     | face shows a lair, back shows a number disc. **The six numbers are not printed in any text we could read** (§10 Q1)                |
| Fish hauls                         | 6     | large                                                                                                                              |
| Spice sacks                        | 24    | small. Exactly 6 farms × 4 players                                                                                                 |
| Coins                              | 76    | 36 × "3 gold", 40 × "1 gold" (value 148)                                                                                           |
| Bonus VP tiles                     | 3     | Greatest Pirate Scourge, Best Fisher, Greatest Spice Merchant, 1 VP each                                                           |
| Mission track frame pieces         | 3     | Lairs (7 spaces), Fish (7 spaces), Spices (6 spaces), see §4.8                                                                     |
| Sea frame pieces                   | 8     | one carries a **printed pasture hex** (with the 6 disc), one a **printed sea hex** (§2.0)                                          |
| Trade rate tile                    | 1     | reminder only                                                                                                                      |
| Player aids                        | 4     |                                                                                                                                    |
| Pieces for 4 colours               | —     | 16 harbor settlements, 12 ships, 8 settlers, 36 crews, 4 pirate ships, 12 markers                                                  |

From the base game (R6 p. 5): 14 land hexes (2 hills, 4 forests, 3 pastures, 2 fields, 3 mountains),
15 number discs (3×2, 4×2, 5×1, 6×2, 8×2, 9×1, 10×2, 11×2, 12×1), 6 frame pieces (flipped, no coast
or ports), 95 resource cards (19 each), 20 settlements, 60 roads, 2 dice, 2 card trays. **Back in the
base box:** dev cards, bonus VP tiles, cities, robber, 1 hill, 1 pasture, 2 fields, the desert, and the discs 2, one 5 and one 9.

Per scenario, hex and disc counts are in §2 (tables under each map).

### 1.4 5–6 player components (E56-6 p. 2)

| Component                    | Count  | Notes                                                                                         |
| ---------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| Parrot hexes                 | 4      | 1 forest, 1 field, 1 mountain, 1 gold field                                                   |
| Goose hexes                  | 4      | 1 hill, 1 pasture, 1 mountain, 1 gold field                                                   |
| Parrot number discs          | 3      | 2, 5, 9                                                                                       |
| Goose number discs           | 3      | 3, 4, 10                                                                                      |
| Sea hexes                    | 9      |                                                                                               |
| Pirate lair tokens           | 2      | 8 in total with the base box                                                                  |
| Fish hauls / spice sacks     | 2 / 12 | 8 hauls and 36 sacks in total (6 farms × 6 players)                                           |
| Coins                        | 12     | 6 × 3 gold, 6 × 1 gold                                                                        |
| Pieces for 2 colours         | —      | 8 harbor settlements, 6 ships, 4 settlers, 18 crews, 2 pirate ships, 6 markers                |
| Paired-player markers        | 2      | "player 1" and "player 2" markers                                                             |
| Player aids                  | 2      |                                                                                               |
| From CATAN 5–6 (also needed) | —      | 7 land hexes and discs, extra frame pieces, 25 resource cards, 2 colours of roads/settlements |

With the extension, the full game has 40 unexplored hexes (20 + 20) and 22 island hexes (21 random + 1 printed). Each region still holds 3 spice farms, so 6 farms × up to 6 players = the 36 sacks.

---

## 2. Setup

Sources: R6 pp. 6–7; M6 pp. 3–5, 8–9, 14–17; E56-6 pp. 4–7; IMG. Numbers: IMG.

### 2.0 How to read the board data (read this first)

- All hexes are **pointy-top**, like our engine. We describe a board as rows `r = 0…` from the top, and a
  **doubled column** `c` within a row: neighbours are E `(c+2, r)`, W `(c−2, r)`, NE `(c+1, r−1)`, NW `(c−1, r−1)`,
  SE `(c+1, r+1)`, SW `(c−1, r+1)`. A position exists only if `c ≡ r + p (mod 2)`.
  - 3–4 player maps: **p = 1** (row 0 has odd `c`).
  - 5–6 player maps: **p = 0** (row 0 has even `c`).
- Conversion to our engine's axial `(q, r)` (ARCHITECTURE §2): `q = (c − r − p) / 2`, same `r`.
  The origin is arbitrary; shift as needed.
- Every board has the same skeleton: the **starting island** on the left (west), then sea, then two
  face-down **unexplored regions**: the **parrot** (green) region in the north and the **goose** (orange)
  region in the south, mirrored top to bottom, with a **sea corridor** between them on the central row.
  The Council of Catan hex (if the scenario has it) sits just east of the island's middle row.
- **Frame:** the frame pieces form a water border. The frame has no hexes but **is water**: ships may
  sail along frame edges, a pirate may **not** be placed on it (§4.7). The frame also carries the mission tracks.
- **Printed hexes:** two hexes are printed on frame pieces: a **pasture with a 6** at the west end of the
  middle row (always at column 0), and a **plain sea** at the east end of the middle row. They are part of
  the board and need no setup. Our hex counts balance exactly once you add them (checked for every map below).
- **Fill rule:** every board position that is not island, region, Council or printed is a **face-up sea hex**.
- Each region's hexes are shuffled face-down into the region (§2.2). Hidden content = terrain + (for land
  hexes) a number disc drawn when explored. Gold fields get a lair token instead of a disc.

### 2.1 Frame assembly

Turn the six base frame pieces over (no coast, no ports), then join them with the E&P frame pieces as
the scenario map shows (R6 p. 6; M6 p. 3). Pure geometry: our engine needs only the **set of hex
positions** and which edges lie on the outer border (for ships and for "coastal" tests).

### 2.2 Common setup steps (all scenarios)

1. Frame, then island, then regions (below).
2. **Island:** 14 land hexes from the base game (+ the printed pasture). Number discs are **fixed by position**
   (§2.3). Terrain is fixed in Land Ho! and Pirate Lairs, **random in Fish, Spices and the full game**
   (and optionally random in Pirate Lairs; the numbers never move). **[5e] and [6e] agree.**
3. **Regions:** shuffle the parrot hexes face-down into the north region and the goose hexes face-down into
   the south region. In the full game, first return one of the two sea hexes of each deck to the box (§2.8).
   Shuffle each disc set face-down; they are drawn when a land hex is explored.
4. **Supply:** resource cards in 5 stacks, face up. Place fish hauls, spice sacks, coins and the trade
   rate tile beside the board. Mix the parrot discs into one face-down stack, and the goose discs into
   another; the lair tokens are also kept as a face-down stack (R6 p. 6).
5. **First player:** highest dice roll. Each player takes 1 colour, its pieces, **1 player aid and 2 gold**.
6. Mission markers start on the **start space** of each mission track in play.

### 2.3 The starting island (3–4 players): positions, numbers, harbor spots

Doubled coordinates, `p = 1`. The numbers are the same on every 3–4 player board (Land Ho!, Pirate Lairs,
Fish, Spices, full game). 15 hexes: 14 random/fixed + the printed pasture.

| row | c: number                  | c: number | c: number |
| --- | -------------------------- | --------- | --------- |
| 0   | 3: **11**                  | 5: **9**  |           |
| 1   | 2: **3**                   | 4: **8**  |           |
| 2   | 1: **4**                   | 3: **10** |           |
| 3   | 0: **6** (printed pasture) | 2: **12** | 4: **8**  |
| 4   | 1: **10**                  | 3: **4**  |           |
| 5   | 2: **11**                  | 4: **6**  |           |
| 6   | 3: **3**                   | 5: **5**  |           |

Discs (15): 3×2, 4×2, 5×1, 6×2, 8×2, 9×1, 10×2, 11×2, 12×1.

**Terrain by scenario** (fixed layouts; `—` = random in that scenario):

| (c,r) | Land Ho! (fixed)  | Pirate Lairs (fixed) | Fish / Spices / full |
| ----- | ----------------- | -------------------- | -------------------- |
| (3,0) | mountains         | pasture              | random               |
| (5,0) | forest            | forest               | random               |
| (2,1) | fields            | fields               | random               |
| (4,1) | pasture           | pasture              | random               |
| (1,2) | hills             | hills                | random               |
| (3,2) | pasture           | mountains            | random               |
| (0,3) | pasture (printed) | pasture (printed)    | pasture (printed)    |
| (2,3) | mountains         | mountains            | random               |
| (4,3) | forest            | forest               | random               |
| (1,4) | fields            | fields               | random               |
| (3,4) | pasture           | pasture              | random               |
| (2,5) | forest            | forest               | random               |
| (4,5) | hills             | mountains            | random               |
| (3,6) | mountains         | hills                | random               |
| (5,6) | forest            | forest               | random               |

Random terrain pool (14 hexes): 2 hills, 4 forests, **3 pastures**, 2 fields, 3 mountains (the printed
pasture is the 4th pasture on the island). Each fixed layout uses exactly this pool plus the printed pasture. No desert, no robber.

**Starting harbor spots** (green marks in R6 p. 6, M6 pp. 8, 14, 16): for each row, the **NE and SE
corners of the row's easternmost island hex**. Easternmost columns by row 0…6: 5, 4, 3, 4, 3, 4, 5.
That is **14 legal vertices** (2 per row). Setup harbor settlements must stand on one of these.
Not used in Land Ho!, whose starting pieces are fixed (§2.4).

### 2.4 Scenario 1: Land Ho! (3–4 players, win at 8 VP)

Source: M6 pp. 4–7; R5 p. 2 (identical figure).

**Board.** Rows `r`, column range (`c`, step 2): r0 3..13, r1 2..14, r2 1..15, r3 0..16, r4 1..15, r5 2..14, r6 3..13.
(51 positions; counts: 15 island + 16 region + 19 face-up seas + the printed pasture [counted in the island] + the printed sea at (16,3). Check: 33 face-up + 16 + 1 printed pasture + 1 printed sea = 51.)

- **Parrot (8):** (11,0) (13,0) (10,1) (12,1) (14,1) (9,2) (13,2) (15,2). Contents: 2 seas, 1 hill, 1 forest, 1 pasture, 1 field, 2 mountains. Discs: 3, 4, 5, 6, 9, 10.
- **Goose (8):** (9,4) (13,4) (15,4) (10,5) (12,5) (14,5) (11,6) (13,6). Contents: 2 seas, 1 hill, 1 forest, 1 pasture, 2 fields, 1 mountain. Discs: 4, 5, 8, 9, 10, 11.
- Face-up: 19 seas, the 14 island hexes, the printed pasture.
- No Council hex, no gold fields, no fish, no spice, no crews, no pirate, no missions.

**Fixed starting pieces** (each player: 1 settlement + 1 road, 1 harbor settlement + 1 ship carrying 1 settler).
Read from the figure; corner names are N, NE, SE, S, SW, NW of the named hex.

| Colour | Settlement at                                            | Road on                                    | Harbor settlement at                                  | Ship on                          | Starting cards (1 per adjacent hex) |
| ------ | -------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- | -------------------------------- | ----------------------------------- |
| Blue   | S of (3,0) = {(3,0) mtn 11, (2,1) fld 3, (4,1) pas 8}    | SE side of (3,0) (between (3,0) and (4,1)) | SE of (4,5) = {(4,5) hills 6, (5,6) for 5, sea (6,5)} | NE side of (5,6) (towards (6,5)) | ore, grain, wool                    |
| Red    | SE of (2,5) = {(2,5) for 11, (4,5) hills 6, (3,6) mtn 3} | NE side of (3,6) (between (3,6) and (4,5)) | S of (5,0) = {(5,0) for 9, (4,1) pas 8, sea (6,1)}    | SE side of (5,0) (towards (6,1)) | lumber, brick, ore                  |
| Orange | SW of (1,2) = {(1,2) hills 4, (0,3) pas 6}               | SW side of (1,2) (between (1,2) and (0,3)) | SE of (3,2) = {(3,2) pas 10, (4,3) for 8, sea (5,2)}  | NE side of (4,3) (towards (5,2)) | brick, wool                         |
| White  | SE of (0,3) = {(0,3) pas 6, (2,3) mtn 12, (1,4) fld 10}  | SW side of (2,3) (between (2,3) and (1,4)) | S of (4,3) = {(4,3) for 8, (3,4) pas 4, sea (5,4)}    | SE side of (4,3) (towards (5,4)) | wool, ore, grain                    |

(The 3-player game omits one colour, 2-player: neutral pieces stand in as obstacles, §2.8.)
Placement is easy to get wrong by one vertex; verify every row against M6 p. 4 (and R5 p. 2) when you write the fixture, and assert distance rule, harbor settlement is coastal, ship edge touches harbor vertex.

### 2.5 Scenario 2: Pirate Lairs (win at 12 VP)

Source: M6 pp. 8–13.

**Board.** Rows: r0 3..15, r1 2..16, r2 1..17, r3 0..18, r4 1..17, r5 2..16, r6 3..15. 58 positions (15 island + 22 region + 20 face-up seas + 1 printed sea at (18,3), counting the printed pasture inside the island).
Check: 34 face-up (20 seas + 14 land) + 22 + 1 + 1 = 58.

- **Parrot (11):** (11,0) (13,0) (15,0) (10,1) (12,1) (14,1) (16,1) (9,2) (11,2) (15,2) (17,2).
  Contents: 2 seas, 1 hill, 1 forest, 1 pasture, 1 field, 2 mountains, **3 gold fields**. Discs: 3, 4, 5, 6, 9, 10.
- **Goose (11):** (9,4) (11,4) (15,4) (17,4) (10,5) (12,5) (14,5) (16,5) (11,6) (13,6) (15,6).
  Contents: 2 seas, 1 hill, 1 forest, 1 pasture, 2 fields, 1 mountain, **3 gold fields**. Discs: 4, 5, 8, 9, 10, 11.
- Mission track: **Pirate Lairs** (frame, north edge). One bonus tile: Greatest Pirate Scourge.
- Pieces added per player: 9 crews, 1 pirate ship, 1 marker.

**Setup (variable, "free"):** §2.7.

### 2.6 Scenario 3: Fish for Catan (win at 15 VP)

Source: M6 pp. 14–15.

**Board.** Same positions as Pirate Lairs (58): r0 3..15 … r6 3..15, region coordinates as in §2.5. **Plus the Council of Catan hex at (6,3)** instead of one face-up sea
(the figure does not draw it but the counts require it and it matches Spices/full, §10 Q4). Face-up: 19 seas + Council + 14 land.

- **Parrot (11):** 1 hill, 1 forest, 1 pasture, 1 field, 2 mountains, 3 gold fields, **2 fish shoals** (draw 2 at random from the 3 parrot shoals 1, 2, 3; return the third unseen). **No sea hexes** in the deck.
- **Goose (11):** 1 hill, 1 forest, 1 pasture, 2 fields, 1 mountain, **2 gold fields**, 3 fish shoals (4, 5, 6).
- Discs as before. 6 lair tokens in the supply (only 5 gold fields exist; one token is spare).
- Mission tracks: Pirate Lairs and **Fish for Catan**. Bonus tiles: Pirate Scourge, Best Fisher. 6 fish hauls.
- Each player: 2 markers (one per track).

### 2.7 Scenario 4: Spices for Catan (win at 15 VP)

Source: M6 pp. 16–18.

**Board.** Rows: r0 3..17, r1 2..18, r2 1..19, r3 0..20, r4 1..19, r5 2..18, r6 3..17 (65 positions). Council hex at (6,3). Printed sea at (20,3). Face-up seas 22.
Check: 15 island (incl. printed pasture) + 1 Council + 13 + 13 + 22 seas + 1 printed sea = 65.

- **Parrot (13):** (11,0) (13,0) (15,0) (17,0) (10,1) (12,1) (14,1) (16,1) (18,1) (9,2) (11,2) (15,2) (19,2).
  Contents: 1 sea, 1 hill, 1 forest, 1 pasture, 1 field, 2 mountains, **3 fish shoals (1, 2, 3)**, **3 spice farms**.
- **Goose (13):** (9,4) (11,4) (15,4) (19,4) (10,5) (12,5) (14,5) (16,5) (18,5) (11,6) (13,6) (15,6) (17,6).
  Contents: 1 sea, 1 hill, 1 forest, 1 pasture, 2 fields, 1 mountain, 3 fish shoals (4, 5, 6), 3 spice farms.
- **No gold fields, no lair mission.** Pirate ships and tribute still apply (R6/M6: "uses all rules from Fish for Catan").
- Discs: parrot 3, 4, 5, 6, 9, 10; goose 4, 5, 8, 9, 10, 11. (M6 p. 16's table shows 9 ×2 for parrot with a total of 6: a misprint. R6 p. 3 shows one 9 in each deck.)
- Mission tracks: Fish and **Spices**. Tiles: Best Fisher, Greatest Spice Merchant. 6 fish hauls, 24 spice sacks.

### 2.8 Scenario 5: Explorers & Pirates (full game, win at 17 VP)

Source: R6 pp. 6–7.

**Board.** Rows: r0 3..19, r1 2..20, r2 1..21, r3 0..22, r4 1..21, r5 2..20, r6 3..19 (72 positions).
Council hex at (6,3). Printed sea at (22,3). Face-up: 23 seas + 14 land hexes + printed pasture.
Check: 15 island + 1 Council + 16 + 16 + 23 seas + 1 printed sea = 72.

- **Parrot (16 of 17; return 1 of its 2 seas to the box):**
  r0: (11,0) (13,0) (15,0) (17,0) (19,0); r1: (10,1) (12,1) (14,1) (16,1) (18,1) (20,1); r2: (9,2) (11,2) (15,2) (19,2) (21,2).
  Contents: 1 sea, 1 hill, 1 forest, 1 pasture, 1 field, 2 mountains, 3 gold, 3 fish (1, 2, 3), 3 spice.
- **Goose (16 of 17; return 1 sea):**
  r4: (9,4) (11,4) (15,4) (19,4) (21,4); r5: (10,5) (12,5) (14,5) (16,5) (18,5) (20,5); r6: (11,6) (13,6) (15,6) (17,6) (19,6).
  Contents: 1 sea, 1 hill, 1 forest, 1 pasture, 2 fields, 1 mountain, 3 gold, 3 fish (4, 5, 6), 3 spice.
- All three mission tracks; all three tiles; 6 lair tokens, 6 fish hauls, 24 spice sacks.
- Each player: 3 markers, 9 crews, 1 pirate ship, 3 ships, 2 settlers, 4 harbor settlements.
- Spice farms: each region holds exactly one hex of each advantage (§4.12), i.e. 6 farms in total with 3 different ability faces ×2.

### 2.9 Starting placement for scenarios 2–5 ("variable setup")

Source: R6 p. 7; M6 p. 9; R5 p. 10.

1. Order: the base "Variable Setup" snake: round 1 clockwise from the first player, round 2 counter-clockwise (our BASE 2.13).
2. **Round 1: each player places a harbor settlement** (no road) on one of the **marked harbor vertices** (§2.3).
3. **Round 2: each player places a settlement** (no road) on **any** island intersection, including marked ones. Distance rule applies to both pieces.
4. After all pieces are placed, starting with the first player and then clockwise, each player places **1 road adjacent to their settlement** (not the harbor settlement) **and 1 ship carrying 1 settler** on a sea edge adjacent to their harbor settlement.
5. Each player takes **1 resource card per adjacent hex of their settlement** (only the settlement counts, not the harbor settlement).
6. The first player takes the first turn. (Our engine: `startingPlayer`.)

**Differences from the base game setup:** pieces are placed as pairs per round (harbor, then settlement), roads/ships come last, not after each settlement.

### 2.10 Two-player variant (not required for 3–4 but easy)

- Land Ho!: the unchosen colours' roads, settlements and harbor settlements stand on the island as obstacles in their printed places; **no neutral ships**.
- Scenarios 2–5: after both harbor settlements, the first player and then the second place a **neutral** harbor settlement; after both settlements, the second player and then the first place a **neutral** settlement. Neutral pieces never score and never act.

---

## 3. Turn structure and every rule change vs the base game

Sources: R6 pp. 8–12; M6 pp. 3, 5–7, 10–13; R5 pp. 3–8.

### 3.1 The turn

A turn has three phases in this order; after the third, pass the dice clockwise unless someone has won:

1. **Production phase.**
2. **Action phase** (trade and build, in any order, any number of times).
3. **Movement phase.**

There are **no development cards and no play before the roll**. No trading and no building in or after the Movement phase, **except** the settlement you create by landing a settler (§4.5) and the free hex-exploration rewards. **Winning is checked continuously during your own turn** [6e]: the game ends the moment you have the target VP (even mid-Movement phase). Lair capture results resolve after your Movement phase, and may win the game then (§4.8).

### 3.2 Phase 1: Production

| Step              | Rule                                                                                                                                                                                                                            | Change vs base                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Roll              | 2 dice, sum 2–12. Every hex with that number produces for every adjacent building, whoever's turn it is.                                                                                                                        | Same.                                          |
| Resource hexes    | Settlement or harbor settlement: **1 card** of the hex's resource per building, per hex. **No cities** (harbor settlements do **not** produce double).                                                                          | Cities gone; harbor settlement ≠ city.         |
| Gold fields       | Once a lair is captured the field carries a number (the lair token's flip side). On that number each building adjacent produces **2 gold** (not cards).                                                                         | New.                                           |
| Gold compensation | If you receive **no resources** from the roll, take **1 gold** (§10 Q3 for scope).                                                                                                                                              | New.                                           |
| Shortages         | Resource-card bank shortage rules as BASE §4.7–4.10.                                                                                                                                                                            | Same. Gold has no shortage rule here (§10 Q9). |
| Rolling a 7       | (1) Every player with **more than 7** resource cards discards half, rounded down (gold never counts). (2) The roller **activates their pirate ship** (§4.7). In **Land Ho!** there is no pirate: discard only and **no steal**. | Robber replaced by pirate.                     |
| Fish shoals/spice | Shoals have no number token and **never produce**. Spice farms never produce. Sea hexes never produce.                                                                                                                          | New hex types.                                 |

### 3.3 Phase 2: Action

**Trade** (R6 p. 8):

- With other players: any combination of resources **and gold**. Same offer rules as the base game. (5-6: player 2 of a pair may not trade with players, §8.)
- With the supply:
  - **3:1** – return 3 cards of one resource to the supply, take **1 card of another resource or 1 gold**.
  - **2 gold → 1 resource of your choice, at most twice per turn.**
  - There are **no harbors/ports** and no 4:1 or 2:1 resource trades. (Base 4:1 is gone: the 3:1 replaces it.)
- **Fast gold** (spice-farm advantage, §4.12): once or twice per turn, pay 1 resource card for 1 gold.

**Build** (costs in §4.1): road, settlement (via road), settler, harbor settlement, ship, crew, **extra ship move** (R6 lists it in the cost table; you pay it when moving, §3.4). Placement limits:

- Roads and settlements only on **explored land hexes**, never on an edge or vertex that is shared with an **unexplored** hex (R6 p. 8 "green tick / red X" figure).
- Not on a **gold field hex until its lair is captured**, and not on a **spice farm hex until you personally have a crew on it** (§4.11).
- Settlements and harbor settlements obey the distance rule (no building on a vertex adjacent to another building).
- A road must connect to your network as in the base game; a settlement built by road must touch your road.

### 3.4 Phase 3: Movement

All of these may be done in any order, any number of times, subject to each ship's movement points, during **your** Movement phase only:

1. Move ships (§4.4), paying tribute where required (§4.7).
2. Buy extra movement for a ship (1 wool, once per ship per turn, §4.4).
3. Load / unload / swap cargo (§4.6).
4. Explore (automatic when a ship's end touches an unexplored hex, §4.3).
5. Land a settler: build a settlement (§4.5).
6. Chase away the pirate (§4.7).
7. Mission actions: put crews on a lair (§4.8), roll for fish and load/deliver hauls (§4.9), unload a crew on a spice farm and load sacks, deliver sacks (§4.10).

The pirate affects **movement**, not building: you may build a ship next to a pirate hex without paying tribute (R5 p. 7; R6 p. 11).

### 3.5 Timing windows (checklist)

| Event                                  | When                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Gold compensation                      | end of the production step, before any trade                                                                       |
| Pirate activation after a 7            | immediately after all discards                                                                                     |
| Fast Gold / 2-gold purchase / 3:1      | Action phase                                                                                                       |
| Buying a harbor settlement             | Action phase only (FAQ-7: you cannot upgrade in the Movement phase)                                                |
| Buying a settler/crew **and** using it | settler/crew built in the Action phase; a settler may then ride and land in the same turn's Movement phase (FAQ-7) |
| Pirate chase rolls                     | Movement phase, only with ships that have not moved this turn                                                      |
| Fish roll                              | Movement phase, once per turn, before or after moving **a ship** (not mid-move)                                    |
| Lair capture resolution                | after the active player's Movement phase                                                                           |
| Mission-track VP                       | counts immediately as markers move                                                                                 |
| Win check                              | whenever your VP reaches the target during your turn                                                               |

---

## 4. New pieces, actions and rules in detail

### 4.1 Costs (player aid, R6 p. 4; R5 p. 3)

| Item                  | Cost                                  | VP  | Notes                                                                                      |
| --------------------- | ------------------------------------- | --- | ------------------------------------------------------------------------------------------ |
| Road                  | 1 brick + 1 lumber                    | 0   | not a ship; no Longest Road in this game                                                   |
| Settlement            | 1 brick + 1 lumber + 1 wool + 1 grain | 1   | built by road. No city upgrade exists                                                      |
| **Settler**           | same as a settlement                  | 0   | placed in an empty basin / empty ship hold only                                            |
| **Harbor settlement** | 2 grain + 2 ore                       | 2   | replaces one of your **coastal** settlements (the settlement piece returns to your supply) |
| **Ship**              | 1 lumber + 1 wool                     | 0   | placed next to one of your harbor settlements                                              |
| **Extra ship move**   | 1 wool                                | 0   | +2 movement points for one ship, once per ship per turn (§4.4)                             |
| **Crew**              | 1 ore + 1 wool                        | 0   | placed in an empty basin slot or on a ship adjacent to a harbor settlement                 |

Not in this game: development cards, city.

### 4.2 Harbor settlement

- Worth **2 VP**. Produces **1 card** like a settlement.
- Built by **upgrading** a coastal settlement of yours (remove the settlement, return to supply, place the harbor settlement on that vertex) [R6 p. 8]. "Coastal" = the vertex touches a sea-type hex or the frame (R5 p. 5).
- Exception: in setup a harbor settlement is **placed directly** on a marked vertex (§2.9).
- Limit **4**. No more. (Upgrades free up a settlement piece, so 5 settlements + 4 harbor settlements can stand at once.)
- It has a **basin** (cargo space): 1 large or 2 small pieces.
- Roads and settlements may build outward from a harbor settlement as from a settlement (FAQ-5).
- A settlement or harbor settlement on a **spice farm** hex scores like any other (FAQ-12: settlement 1 VP, upgrade +1 more).

### 4.3 Exploring

- **Trigger:** as soon as one **end** of one of your ships is at a vertex that is a corner of an **unexplored** hex, you **must** flip that hex [R6 p. 12]. A ship's **ends** are the two vertices of the edge it sits on.
- **Exploring ends that ship's movement** for the turn (remaining MP are lost).
- **Reveal:**
  - Land hex (hill, forest, pasture, field, mountain): draw a disc from the stack whose symbol matches the hex's back (parrot/goose) and place it, number up.
  - Gold field: place a **pirate lair token** on it, face (lair) up, without looking at the number.
  - Spice farm: place **1 spice sack per player** on the hex.
  - Fish shoal or sea: nothing more.
- **Reward:** **1 resource card** of the hex's type; if the hex has no resource (sea, gold field, fish shoal, spice farm) take **2 gold** instead [R6 p. 12; R5 p. 4]. The M6 text says explicitly: gold field → 2 gold, fish shoal → 2 gold, spice farm → 2 gold, sea → 2 gold.
- Roads and ships cannot reveal hexes. Ships cannot be **built** on an edge that borders an unexplored hex (R6 p. 9). Roads/settlements may not be built next to unexplored hexes (§3.3).
- A ship may **sail along** edges next to the frontier only by exploring: the exploration triggers the moment the end touches an unexplored corner. Corner case (two unexplored hexes at one corner): §10 Q5.

### 4.4 Ships and movement

- Each ship stands on **one edge** of a sea hex (a **sea route**): any edge with at least one **water** side (sea hex, fish shoal, Council hex or the frame). Edges between two land hexes are not sea routes. Up to **2 ships** (same or different owners) may share an edge. A coastal edge may also carry 1 road (FAQ-10).
- **Building:** pay 1 lumber + 1 wool, place on an empty-enough sea edge that **has your harbor settlement's vertex as an end**, not an edge of an unexplored hex. If you have no ship left in supply, first **return one of your ships on the board, with all its cargo** (cargo goes back to supply), then build. (R6 p. 9; R5 p. 3.)
- **Moving:** a ship moves along a continuous chain of sea edges, **1 MP per edge step** (to an edge sharing a vertex). **4 MP** per ship per turn. Any direction, may reverse, may revisit.
- **Extra move:** pay **1 wool** per ship: that ship has **6 MP** instead of 4 (once per ship per turn). Swift Voyage (§4.12) adds MP on top: base 4 + Swift (0–2) + purchased 2; maximum 8 (R5 p. 15).
- **Rules:** finish one ship's movement before starting another; a ship may pass other ships but must **end** on an edge with fewer than 2 ships; a ship may stop with unused MP.
- Cargo transfers cost **no MP** and may happen mid-move (§4.6).
- Movement is a **Movement phase** action only.

### 4.5 Settlers and building a settlement by landing

- A **settler** (large piece) sits in a harbor basin or a ship hold. It cannot move on land.
- **Landing:** when a ship carrying a settler has an end at a vertex that is a corner of an **explored land hex**, you may build a settlement there for **free**: return the **settler and the ship** to your supply, place a settlement. [R6 p. 12]
  - The distance rule applies.
  - The vertex must not be shared with an unexplored hex, must not be on an uncaptured gold field, and must not be on a spice farm unless you have a crew there (§3.3, §4.11).
  - Needs a settlement piece in your supply (you may free one by upgrading first, in the Action phase).
- First settlement on a new island is always by settler; later settlements/roads follow normal road rules (R5 p. 5).
- You can **buy a settler and land it in the same turn** (FAQ-7): buy in the Action phase, load, sail, land in the Movement phase.
- **A settler never scores** while carried (FAQ-2).

### 4.6 Loading, unloading, swapping

- A **harbor settlement basin** and **ship hold** each hold 1 large **or** 2 small pieces.
- **Between a ship and an adjacent harbor settlement** ("adjacent" = the ship's edge has the harbor's vertex as an end): load, unload, or **swap**. A **ship cannot hand cargo directly to another ship**; use the harbor basin as a relay (R5 p. 6; R6 p. 11 example).
- **Between a ship and an explored hex**: when one end of the ship is a corner of the hex you may unload crews onto it (lair, spice farm) or load fish hauls / spice sacks / surviving crews from it. (R6 p. 11.)
- Newly built crews and settlers must be placed directly in an **empty slot** of a harbor basin or an adjacent ship. If all such slots are full you may **throw away** one piece of yours (back to supply) to make room (R6 p. 9).
- **Fish hauls and spice sacks can be moved** ship → basin → another ship (FAQ-3).
- Not-yet-delivered cargo is **lost if its ship is removed** (§4.4).

### 4.7 Pirate ships (scenarios 2–5)

Each player owns **1 pirate ship**; **at most one** is on the board at any time.

**Activate the pirate ship** (the action, used after a 7 and after a successful chase):

1. If **no** pirate is on the board: place yours.
2. If **yours** is on the board: move it to a **different** sea hex.
3. If an **opponent's** is on the board: return it to its owner, then place yours on a different sea hex than where it stood (R6 p. 8 says "a different sea hex"; R5 p. 7 allows the same hex as the removed ship).
4. Placement limits: any sea hex (including fish shoal hexes) **except** hexes adjacent to the starting island (this includes the Council hex) and **never on the frame**. Gold fields and land hexes are not sea hexes.
5. **Steal:** take **1 random resource card** from a player who has **a ship on an edge of that hex** (settlements are not affected). If several players qualify, you choose. A victim with **no resource cards** may lose **1 gold** instead; a victim with cards must give a card (R5 p. 7).
6. If a fish haul sits on that shoal, it is returned to the supply (§4.9).

**Tribute** (R6 p. 10): for each of **your** ships that moves **onto, off of, or along the edges** of a sea hex containing an **opponent's** pirate ship, pay **1 gold to the supply, once per ship per turn** no matter how many such steps that ship makes. You may not move there without paying. Your own pirate never charges you. Building a ship there costs nothing.

**Chase away** (R6 p. 11): on your turn, for each **battle-ready** ship, roll 1 die. A ship is battle-ready if it **has not moved this turn** and **one of its ends is at a corner of the pirate's hex**. A **6** chases the pirate off (it returns to its owner) and you **activate your own pirate ship** (place it and steal). Afterwards you may still move those ships (paying tribute if the pirate remained). Spice-farm Pirate Bonus lowers the threshold (§4.12). **Once chased away, no more rolls are needed** for that pirate (the ship is gone).

### 4.8 Pirate lairs mission (scenarios 2, 3, 5)

- **Gold fields** start face-down in a region. Exploring one puts a **lair token** on it (face up, number hidden) and pays 2 gold. While the token is lair-side up, nobody may build roads or settlements on the hex's edges and vertices (R6 p. 8).
- **Capturing:** a player with a ship whose end touches the hex may **unload 1 or 2 crews** onto the lair (5th ed.: max 3 crews on a lair). The lair is **captured when the 3rd crew** stands on it. The crews may belong to **one or several** players. A player may place crews on a lair that has 1–2 crews of others already.
- **Resolution** once the active player has finished their Movement phase:
  1. Starting with the **active player** and then clockwise, each **involved** player (≥ 1 crew on the lair) gets **2 gold** and moves their marker **1 space** on the Lairs track.
  2. Each involved player rolls 1 die and adds the **number of their crews on the lair**. Highest total is the **hero of the battle**. Tie → the player with **more crews**; still tied → the tied players reroll until one wins.
  3. The hero moves **1 more space** and returns **1 of their crews** from the lair to their supply.
  4. A sole involved player is automatically the hero (no roll): 2 gold, **2 spaces**, 1 crew returned.
  5. Flip the lair token: its number now stands on the gold field. The field produces **2 gold per adjacent building** when rolled, and roads/settlements may be built on it.
- Remaining crews stay on the hex and may be loaded onto your ships on a later turn (a ship end must touch the hex).
- **Track:** 7 spaces, VP 1, 1, 2, 2, 2, 3, 3 (§4.13). Bonus tile **Greatest Pirate Scourge** (1 VP).
- The mission is "resolved" only after movement: if two lairs are captured in one turn, resolve one after the other in capture order (§10 Q10).

### 4.9 Fish for Catan mission (scenarios 3, 4, 5)

- **Council of Catan hex:** a sea hex; its **only land contact is the island hex to its west**. Roads, settlements and ships may be built only where it touches that land hex. Ships may **sail along** any of its edges (FAQ-8). Pirate ships may never be placed on it. It has **2 anchors**: its **north and south corners**. Delivering means ending (or passing) with an end of your ship at an anchor vertex.
- **Fish shoal hexes** show a die face. Exploring one pays 2 gold. There are 5 (3–4 players, scenario 3) or 6 shoals in play.
- **Fish roll:** **once per turn**, in your Movement phase, **before or after moving a ship** (never in the middle of one ship's move), roll 1 die. If it equals the number of an **explored** shoal, place a fish haul on that hex, **unless** the hex already has a haul, a pirate ship is there, or no haul is in the supply. Rolling an unexplored shoal's number does nothing.
- **Catch:** a ship whose end touches the shoal's corner can load the haul onto the ship (a haul is large: the hold must be empty). It costs **no movement points** (FAQ-4: even a ship with 0 MP left may load).
- **Deliver:** with an end at an anchor of the Council hex, unload the haul to the supply and move **1 space** on the Fish track (§10 Q7).
- **Pirate on a shoal:** the haul goes back to the supply; cargo already on ships is safe.
- **Track:** 7 spaces, VP 1, 1, 2, 2, 2, 3, 3. Tile **Best Fisher**.

### 4.10 Spices for Catan mission (scenarios 4, 5)

- **Spice farm hexes** (3 per region). Exploring one pays 2 gold and puts **1 spice sack per player** on it.
- **Befriend:** with a ship whose end touches the farm, **unload one crew** from the ship onto the farm. The crew stays **for the rest of the game** (can never be picked up). Both editions say "only 1 crew on each spice farm". We read that as **1 crew per player per farm**: sacks are supplied 1 per player and each player loads at most 1 per farm (§10 Q15).
- **Load:** each player may load **at most 1 sack per farm** (hence 1 sack per player per farm on the hex). Sacks are small (2 per hold).
- **Deliver:** at a Council anchor, unload; **move 1 space per sack**. Delivered sacks leave play.
- You may not build roads or settlements on a spice farm hex until **you** have a crew there (FAQ-12: once you do, a settlement there scores and can be upgraded).
- **Track:** 6 spaces, VP 1, 1, 2, 2, 3, 3. Tile **Greatest Spice Merchant**.

### 4.11 Hex-restriction summary

| Hex                  | Roads/settlements allowed?                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Unexplored           | never (and neither on its shared edges/corners)                                                  |
| Gold field, lair on  | never                                                                                            |
| Gold field, captured | yes                                                                                              |
| Spice farm           | only for a player with their own crew there                                                      |
| Fish shoal, sea      | no (water)                                                                                       |
| Council              | only where it touches the island (a road on the shared edge; a building on the 2 shared corners) |
| Resource land hex    | yes                                                                                              |

### 4.12 Spice-farm advantages

Each region holds one of each; you get the benefit **immediately** when you place a crew (it does **not** require delivering a sack):

| Advantage        | Effect                                                                                                     | Two farms |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | --------- |
| **Swift Voyage** | **+1 MP** for all your ships (including ones that already moved: the ship gains the point at once, FAQ-9). | +2 MP     |
| **Pirate Bonus** | You chase away the pirate with a **6 or the number printed on that hex** (4 and 5 on the two farms).       | 4, 5, 6   |
| **Fast Gold**    | Once per Action phase you may pay **1 resource card for 1 gold**.                                          | twice     |

(FAQ-1: Fast Gold may be combined with the 2-gold purchase and the 3:1 trade.)

### 4.13 Mission tracks and VP

- Each mission has a track. A marker starts on **start** (0 VP) and advances one space per unit of progress. Entering a space that already holds an opponent's marker: place yours **on top**.
- Your **mission VP** equals the number of VP pips on your marker's space.
- The **bonus tile** (1 VP) belongs to whoever is **furthest** along; on a tie the marker **lowest in the stack** (earliest to arrive) keeps/gets it. The tile moves only when someone passes the holder.
- If a marker would move beyond the last space it stays on the last space.

| Track            | Spaces (VP)            | Progress units                                              |
| ---------------- | ---------------------- | ----------------------------------------------------------- |
| Pirate Lairs     | 7: 1, 1, 2, 2, 2, 3, 3 | +1 per captured lair you took part in; +1 more for the hero |
| Fish for Catan   | 7: 1, 1, 2, 2, 2, 3, 3 | +1 per fish haul delivered                                  |
| Spices for Catan | 6: 1, 1, 2, 2, 3, 3    | +1 per spice sack delivered                                 |

---

## 5. Victory conditions and scoring

| Scenario            | Win at | Counts                                                       |
| ------------------- | ------ | ------------------------------------------------------------ |
| Land Ho!            | 8      | settlements, harbor settlements                              |
| Pirate Lairs        | 12     | + Lairs track + Pirate Scourge tile                          |
| Fish for Catan      | 15     | + Fish track + Best Fisher tile                              |
| Spices for Catan    | 15     | settlements, harbors, Fish track + tile, Spices track + tile |
| Explorers & Pirates | 17     | all of the above                                             |

- VP sources: settlement 1, harbor settlement 2, mission-track space (0–3 each), 3 bonus tiles (1 each). **Settlers, crews, ships, gold, cards score nothing.** No Longest Road, Largest Army, cities, VP cards.
- Maximum on the board: 5 settlements + 4 harbor settlements = 13; missions: 3 + 3 + 3 + 3 tiles = 12 (full game).
- Check **after every action in your own turn**; the first to reach the target wins at once [6e]. Another player never wins on your turn.
- 5–6 players: the paired player 2 can win on their part of the turn (§8).
- With Cities & Knights: target + 5 (§8.4).

---

## 6. Edge cases and official rulings (numbered)

Official FAQ (PROD → FAQ page; wording summarised, §0.1):

- **FAQ-1** Fast Gold stacks with the 2-gold-for-1-resource purchase and with 3:1. An erratum exists for the "page 15" Fast Gold text of the 5th-ed. book: with one friendly village you may sell 1 resource for 1 gold per Action phase, with both villages twice.
- **FAQ-2** A settler never scores, on a ship or anywhere. Only settlements, harbor settlements and missions count.
- **FAQ-3** Fish hauls and spice sacks may be moved from a ship into a harbor basin and then loaded onto another ship.
- **FAQ-4** Loading/unloading a fish haul costs no movement. A ship with 0 MP left may load a haul if an end of the ship touches the shoal's corner.
- **FAQ-5** A harbor settlement is a settlement with extras: upgrade a coastal settlement (not in setup), build ships next to it, it has a basin, 2 VP. Roads may leave it as from a settlement.
- **FAQ-6** Gold compensation: the 1 gold applies if the roll yields **no resource cards**, even if you did receive **gold** from a captured gold field (gold is not a resource). Treat this as our reading of a summarised answer: confirm on the site.
- **FAQ-7** Same-turn settler: buy the settler, load it, sail, land: allowed (no resources needed to land). You cannot then upgrade that settlement to a harbor settlement in the Movement phase (it costs resources). Buying extra movement needs wool.
- **FAQ-8** A ship may sail along the edge between the starting island and the Council hex.
- **FAQ-9** Swift Voyage grants its extra MP at once, even to a ship that has already moved.
- **FAQ-10** Roads can be built on any land-hex edge, including coast edges. A coastal edge can hold 1 road and up to 2 ships.
- **FAQ-11** Misprint: the pasture at the west end of the setup diagram (position A1 in the 5th-ed. book) should carry a **6**.
- **FAQ-12** A settlement on a spice farm hex scores 1 VP (once you may build there) and can be upgraded to a harbor settlement for 2 VP.

Rulings drawn from the rule text (R = R6 unless stated):

- **E1.** Gold has no hand limit and is never discarded on a 7. Treat gold counts as public (the rules never hide it).
- **E2.** On a 7, only **resource cards** are halved. Steals take a card, or gold only from a player with 0 cards.
- **E3.** A ship **cannot be built** on an edge that borders an unexplored hex, but it **can move** onto one (and explores).
- **E4.** Exploring stops that ship; other ships may still move.
- **E5.** A ship with cargo that is **removed** to build a new ship loses its cargo (cargo returns to supply: crews and settlers become available again, fish hauls return).
- **E6.** The **pirate** hurts only ships that move onto/off/along its hex edges. Settlements are never harmed.
- **E7.** You can pay tribute only if you have the gold. Without it the ship may not use those routes.
- **E8.** A pirate may be placed on a hex with a fish haul: the haul is removed (carried hauls are safe).
- **E9.** Lair capture can be started by **any** player's crews; later arrivals (even from other players) can complete it and everyone with a crew there takes part.
- **E10.** Crews left on a captured lair are still yours and can be loaded again; they never block building.
- **E11.** The hero returns **one of their own crews from the lair** to their supply (the hero always has at least one there).
- **E12.** A harbor settlement's basin holds cargo even when no ship is adjacent; swapping needs an adjacent ship.
- **E13.** There are no harbors (ports) and no maritime trade rates in this game: the Harbors of Catan expansion is incompatible (TB).
- **E14.** The Council hex is never a legal pirate hex.
- **E15.** The robber does not exist. Knight/Largest Army/dev-card effects do not exist.
- **E16.** You cannot trade, build or buy in the Movement phase (except landing a settler and exploring rewards).

---

## 7. Interactions with base rules that change

| Base rule (our BASE §)           | In Explorers & Pirates                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| 19 land hexes, desert, harbors   | **No desert, no ports.** Island of 15 hexes (22 for 5–6) + sea + unexplored regions. |
| Robber on 7                      | **Pirate ship** (scenarios 2+). Land Ho!: no steal at all.                           |
| Discard on 7                     | Unchanged (more than 7, round down; gold exempt).                                    |
| Trading with the bank            | 4:1 and harbor rates **removed**. 3:1 (or into gold); 2 gold:1 twice per turn.       |
| Cities                           | **Removed.** Harbor settlements replace the upgrade, 2 VP, produce 1 card.           |
| Dev cards, Knights, Largest Army | **Removed.**                                                                         |
| Longest Road                     | **Removed.** Roads exist only to connect settlements on explored land.               |
| Production                       | Gold compensation; gold fields produce 2 gold.                                       |
| Setup                            | Harbor settlement + settlement, then roads + ship (§2.9), 14 marked harbor vertices. |
| Distance rule                    | Unchanged, also for settlements created by landing.                                  |
| Win                              | Target varies per scenario (8 / 12 / 15 / 15 / 17).                                  |
| Bank (resource cards)            | 19 each, same shortage rules.                                                        |
| Turn                             | Roll → Action → **Movement**. No play of dev card before roll.                       |

---

## 8. Combinations with other products

### 8.1 5–6 players (official, E56-6)

Needs CATAN + CATAN 5–6 + E&P + the E&P 5–6 box. **All rules for 3–4 apply**, with these changes.

- **Scenarios:** Pirate Lairs, Fish for Catan, Spices for Catan, Explorers & Pirates (no Land Ho!). Win targets as in 3–4 (the 5–6 book repeats "the scenario's Winning the Game condition" and prints no separate numbers: assume 12 / 15 / 15 / 17, §10 Q11).
- **Board:** island of **22 hexes** (21 random + printed pasture); regions are bigger (§8.2, §8.3). Island numbers are fixed. Setup is as §2.9 with **18 marked harbor vertices**.
- **Components:** §1.4 (8 lair tokens, 8 hauls, 36 sacks, extra gold).
- **Paired players turn** (replaces the old Special Building Phase), 5 or 6 players:
  - The **first player** holds a "player 1" marker; the **third player to their left** (clockwise) holds "player 2". Same for 5 and 6 players.
  - Turn: **Player 1:** Production, Action, Movement. **Player 2:** Action, Movement. Then pass dice and **both markers one seat left**.
  - Player 1 takes a normal full turn, including winning mid-turn: if they win, the game ends immediately, **before** player 2's phases.
  - Player 2 takes an **Action phase and a Movement phase**, but **may not trade with other players** (trading with the supply, gold purchases, Fast Gold and building are fine).
  - Player 2 may **win** during their part.
  - Player 2 has no Production phase and does not roll (the turn chart shows none): our inference, consistent with the printed phase list.
  - Lair-capture resolution happens after the Movement phase of whoever captured it during their own part of the turn.
- **5th-edition 5–6 (E56-5):** the Special Building Phase: after each turn, in order, each other player may **only build** (no trade, no ship moves, **no gold spending**).

### 8.2 5–6 island and number layout (p = 0, doubled coordinates)

Rows 0…8. Numbers, fixed:

| row | cells (c: number)                                        |
| --- | -------------------------------------------------------- |
| 0   | 4: **2**, 6: **9**                                       |
| 1   | 3: **11**, 5: **8**                                      |
| 2   | 2: **4**, 4: **10**                                      |
| 3   | 1: **10**, 3: **3**, 5: **8**                            |
| 4   | 0: **6** (printed pasture), 2: **5**, 4: **4**, 6: **5** |
| 5   | 1: **3**, 3: **10**, 5: **6**                            |
| 6   | 2: **8**, 4: **4**                                       |
| 7   | 3: **11**, 5: **6**                                      |
| 8   | 4: **12**, 6: **9**                                      |

22 discs: 2×1, 3×2, 4×3, 5×2, 6×3, 8×3, 9×2, 10×3, 11×2, 12×1. Random terrain pool (21 hexes): **3 hills, 5 forests, 5 pastures, 3 fields, 5 mountains** (+ printed pasture). **Harbor start vertices:** NE and SE corners of the easternmost hex per row; easternmost columns r0…r8: 6, 5, 4, 5, 6, 5, 4, 5, 6 → 18 vertices. All 5–6 maps are **mirror images top/bottom** about row 4. Council hex at (8,4) where present.

### 8.3 5–6 boards (decoded)

| Scenario     | Rows c-range (step 2)                                                                                                            | Parrot (north) cells                                                                   | Goose (south) cells                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Pirate Lairs | r0 4..16, r1 3..17, r2 2..18, r3 1..19, r4 0..20, r5 1..19, r6 2..18, r7 3..17, r8 4..16 (79; printed sea (20,4))                | r0: 12, 16 · r1: 11 13 15 17 · r2: 10 12 14 16 18 · r3: 11 15 19 (14)                  | r5: 11 15 19 · r6: 10 12 14 16 18 · r7: 11 13 15 17 · r8: 12 16 (14)                   |
| Fish, Spices | r0 4..18, r1 3..19, r2 2..20, r3 1..21, r4 0..22, r5 1..21, r6 2..20, r7 3..19, r8 4..18 (88; printed sea (22,4); Council (8,4)) | r0: 12 16 18 · r1: 11 13 15 17 19 · r2: 10 12 14 20 · r3: 11 15 17 21 (16)             | r5: 11 15 17 21 · r6: 10 12 14 20 · r7: 11 13 15 17 19 · r8: 12 16 18 (16)             |
| Full         | r0 4..20, r1 3..21, r2 2..22, r3 1..23, r4 0..24, r5 1..23, r6 2..22, r7 3..21, r8 4..20 (97; printed sea (24,4); Council (8,4)) | r0: 12 16 20 · r1: 11 13 15 17 19 21 · r2: 10 12 14 16 18 20 22 · r3: 11 15 19 23 (20) | r5: 11 15 19 23 · r6: 10 12 14 16 18 20 22 · r7: 11 13 15 17 19 21 · r8: 12 16 20 (20) |

Hex contents (E56-6 pp. 4–7), "island 21 hexes: 3 hills, 5 forests, 5 pastures, 3 fields, 5 mountains":

| Scenario     | Face-up seas                                          | Parrot                                                                                | Goose                                                                                 |
| ------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Pirate Lairs | 28                                                    | 1 sea, 1 hill, 2 forest, 1 pasture, 2 field, 3 mountain, 4 gold = 14                  | 1 sea, 2 hill, 1 forest, 2 pasture, 2 field, 2 mountain, 4 gold = 14                  |
| Fish         | 32                                                    | 1 hill, 2 forest, 1 pasture, 2 field, 3 mountain, 4 gold, **3 fish** = 16 (no sea)    | 2 hill, 1 forest, 2 pasture, 2 field, 2 mountain, 4 gold, 3 fish = 16                 |
| Spices       | 32                                                    | 1 sea, 1 hill, 2 forest, 1 pasture, 2 field, 3 mountain, 3 fish, 3 spice = 16         | 1 sea, 2 hill, 1 forest, 2 pasture, 2 field, 2 mountain, 3 fish, 3 spice = 16         |
| Full         | 33 (take the extra one from the 2 returned deck seas) | 1 sea, 1 hill, 2 forest, 1 pasture, 2 field, 3 mountain, 4 gold, 3 fish, 3 spice = 20 | 1 sea, 2 hill, 1 forest, 2 pasture, 2 field, 2 mountain, 4 gold, 3 fish, 3 spice = 20 |

Discs: parrot (9) 2, 3, 4, 5×2, 6, 9×2, 10; goose (9) 3, 4×2, 5, 8, 9, 10×2, 11. Lair tokens 8 (Lairs, Fish, Full); fish hauls 8 (Fish, Spices, Full); 36 sacks (Spices, Full); spice farms stay at 3 per region (one each of Swift Voyage, Pirate Bonus, Fast Gold), as in 3–4 players.
Mission tracks (5–6): replace **3-hex frame pieces** with the tracks the scenario needs (Lairs/Fish/Spices as in 3–4). Number of spaces unchanged.

### 8.4 Cities & Knights (CK, 2025)

- Remove 1 field **and 1 forest** (not 2 fields); use the barbarian-track frame.
- First placement is a **city** (not a settlement), second a **harbor settlement**.
- Barbarian strength = number of **cities** (incl. metropolises, **not** harbor settlements); defenders = **knights** (not crews).
- Cities upgrade from settlements; **harbor settlements** also from settlements; a city cannot become a harbor settlement or vice versa.
- Can't trade gold for commodities. Fast Gold also lets you pay 1 **commodity**.
- Knights stay on their island, do not take part in missions, never on corners next to unexplored hexes.
- Win target **+5** (e.g. Spices: 19).
- Aqueduct (Science 3): on a 7 with no cards, take 1 resource of choice and 1 gold. Medicine: settlement → city for 1 grain + 2 ore, or settlement → harbor settlement for 1 grain + 1 ore. Taxation: activates the pirate ship instead of moving the robber. Treason: knights only. Road Building: roads only (no ships).

### 8.5 Traders & Barbarians (TB, 2025)

- **Incompatible:** Friendly Robber, Harbors of Catan, Rivers, Merchant Trains, Barbarian Attack, the full T&B scenario.
- **Event cards:** may be used for a smoother number distribution, effects ignored.
- **Fishing for Catan:** fishing grounds (6, randomly on the island frame) and lake (on the 12, remove 1 mountain); fish tokens are not resource cards (only tokens → 1 gold). Spend: 2 fish = ignore the pirate (no tribute) · 5 fish = free road or ship · 7 fish = move 1 ship a second time.

### 8.6 Not covered

Seafarers and any other expansion: no official E&P rules.

---

## 9. Implementation notes for our engine

### 9.1 Scope and a suggested shape

- Treat Explorers & Pirates as a **map + ruleset mode** (`mode: 'explorersPirates'`, `scenario: 'landHo' | 'pirateLairs' | 'fishForCatan' | 'spicesForCatan' | 'full'`, 2–4 players, 5–6 with `paired: true`). Dev deck, cities, robber, Longest Road, Largest Army are **off**.
- Target edition: §0.2. Make 6e-vs-5e differences data, not branches, where cheap (e.g. a `vpToWin` per scenario).

### 9.2 Board and geometry (new)

The current engine's board is only land (`terrain` + water ring). E&P needs:

- **Hex kinds:** `land` (5 resources), `sea`, `goldField`, `fishShoal`, `spiceFarm`, `council`, plus an `explored: boolean`. Sea-type: sea, fishShoal, council.
- **Hidden hexes** in two regions. Store the shuffled content in state (state already carries hidden info); the UI must not render `explored:false` content. Draw a disc on explore from the matching stack (parrot/goose) using the seeded RNG for the shuffle at setup, not at reveal.
- **Frame:** a ring of edges outside the hex set. Ships may use frame-adjacent edges; the pirate may not stand on frame; the frame is not a hex.
- **Non-planar edge classes:** an edge can have a **road** (land edge), up to **2 ships** (sea edge), or both (coast edge). Store `roads: Record<EdgeId, PlayerId>` and `ships` separately.
- **"Coastal"** for the upgrade test: vertex touches a sea-type hex or frame water.
- **Topology generator** must accept an arbitrary hex set (the engine now builds from `frame` row widths): add `FrameDef` variants built from the §2 tables (rows + c-ranges), plus `islandHexes`, `regions: {north, south}`, `councilHex`, `harborStartVertices`, `printedHexes`.
- Convert the tables with `q = (c − r − p)/2` (§2.0).
- **Edge/vertex helpers needed:** `seaEdgesOf(vertex)`, `edgeEnds`, `adjacentUnexploredHexes(vertex)`, `shipNeighbours(edge)` (edges sharing a vertex that are sea routes).
- Coordinates in §2 were **read from figures**. Add a unit test per map asserting the hex-count totals, parity (`c ≡ r + p`), terrain counts, symmetry (north/south mirror) and that every harbor start vertex is coastal (§9.9).

### 9.3 New state (additions to `GameState`; bump `schemaVersion` + migration)

```ts
settings.ep?: { scenario: ScenarioId; paired: boolean }   // fixed after createGame
board.hexes[id]: { ...; kind: HexKind; explored: boolean; token: number|null; lairNumber?: number }
board.lairQueue / discsNorth / discsSouth: number[]       // face-down stacks (parrot / goose)
players[i].gold: number
players[i].supply: { ships, settlers, crews, harbors }    // or derived like piecesLeft
pieces.harbors?  // or buildings[v].kind = 'harbor' with cargo
pieces.buildings[v]: { owner, kind: 'settlement'|'harbor', cargo: Cargo[] }  // cargo only on harbors
ships: { id, owner, edge: EdgeId, cargo: Cargo[], movedThisTurn, mpUsed, extraMoveBought }[]
Cargo = 'settler' | 'crew' | 'fish' | 'spice'
hexPieces: Record<HexId, { crews: PlayerId[]; fishHaul: boolean; spiceSacks: number }>
spiceCrews: { hex, player }[]                              // permanent
lairs: Record<HexId, { captured: boolean; crews: PlayerId[] }>
pirate: { owner: PlayerId; hex: HexId } | null
missions: { lairs?: Track; fish?: Track; spices?: Track }
Track = { marks: Record<PlayerId, number>; order: PlayerId[][]  /* stacks per space */; tile: PlayerId|null }
supply: { fishHauls, spiceSacks }
turn: { ..., fishRolled: boolean, fastGoldUsed: number, goldBuysUsed: number, pendingLair: HexId[] }
```

- VP is **derived**: settlements + 2×harbors + sum(track space pips) + tiles.
- Pieces left remain derived (15 roads / 5 settlements / 4 harbors / 3 ships / 2 settlers / 9 crews).

### 9.4 Phases and actions

Phase machine: `setup(harbor round, settlement round, roads+ships)` → `preRoll` → (`discard` → `pirate` choose hex → `pirateSteal` choose victim) → `main` (Action) → `movement` → `endTurn`. Paired: after `endTurn` of player 1, `pairedAction` → `pairedMovement` for player 2 (no `trade` with players).

New actions (all pure, validated in `applyAction`, enumerated in `legalActions`):

`buildHarbor(vertex)`, `buildShip(edge)`, `buildSettler(target: {harbor|ship})`, `buildCrew(target)`, `buyExtraMove(shipId)`,
`tradeSupply(give3 → resource|gold)`, `buyWithGold(resource)`, `fastGold(resource)`,
`moveShip(shipId, path: EdgeId[])` (single call per path; engine computes MP, tribute and stops on explore),
`loadCargo / unloadCargo / swapCargo(shipId, harborVertex | hex, piece)`,
`settleFromShip(shipId, vertex)`, `placeCrew(shipId, hex)`, `pickUpCrew(shipId, hex)`,
`rollFish()`, `loadFish(shipId, hex)`, `deliver(shipId)` (fish and/or sacks), `befriendSpice(shipId, hex)` (unload crew + load sack),
`chasePirate(shipId)` (rolls with seeded RNG), `activatePirate(hex, victim?)`, `endMovement`.

Setup actions: `placeHarbor(vertex)`, `placeSettlement(vertex)`, `placeRoad(edge)`, `placeShip(edge)`.

### 9.5 Engine rules to get right (checklist)

1. Discard threshold stays "more than 7" and counts resource cards only.
2. Pirate steal victims = players with a **ship** on an edge of the hex; gold only if victim has 0 resource cards.
3. Tribute: once per ship per turn, only for **opponent** pirates, charged on first step onto/off/along the hex.
4. Explore triggers on **ship end** vertices and ends that ship's movement; reveal pays 1 card or 2 gold; gold fields get a lair token; spice farms get one sack per player.
5. Build checks: never on a vertex/edge adjacent to an unexplored hex; not on uncaptured gold field; spice farm only with the player's own crew.
6. Lair resolution after the Movement phase of the active player; track order for stacking starts with the active player.
7. Win check after **every** action, not just at end of turn.
8. Mission tile tie-break by stack bottom.
9. Cargo is destroyed with its removed ship.
10. Harbor upgrade returns the settlement piece to supply (so the 5-settlement limit is not blocking).
11. Gold supply unlimited (§10 Q9).

### 9.6 HUD (must show)

Gold per player; per-player pieces (ships on board/left, crews, settlers); each ship's cargo and MP left; basin cargo; mission tracks with all markers, VP pips and tile holders; pirate ship location and owner; tribute cost preview when hovering a path; fish haul markers and spice sack counts on hexes; lair token (face-up) and crews on it; explored/unexplored fog; per-scenario target VP and per-player VP breakdown; the trade/gold offers (3:1, 2 gold:1 left this turn); Fast Gold uses left; whose pair-turn it is (5–6); disabled-button reasons (the project convention).

### 9.7 Bots

Random bot must handle: movement-phase loops (cap actions per turn), `moveShip` paths, pirate steal choice, discard, lair/hero rolls. Simulator invariants: pieces conserved (hauls + sacks + crews + settlers), gold ≥ 0, ≤ 2 ships/edge, ≤ 1 pirate on board. A sensible heuristic bot: explore → settle → upgrade to harbors → missions; later.

### 9.8 Determinism

All randomness via seeded RNG: region shuffles, disc draws, lair token numbers, dice, chase rolls, hero rolls, steals. No `Math.random`.

### 9.9 Suggested test list

Board data: hex counts per map (§2 checks: 51/58/58/65/72 and 79/88/88/97); parity; terrain pools; mirror symmetry (5–6); harbor start vertices coastal; Council touches only the island hex (3–4 and 5–6).
Setup: placement order; setup constraints (harbor on marked vertices only; settlement anywhere; no roads until both pieces placed); starting cards only from the settlement; 2-player neutrals.
Production: 1 card per building; gold field 2 gold only after capture; gold compensation (and not on a 7 per R5).
Building: costs for each item; harbor upgrade needs coastal settlement and returns the piece; ship build adjacency and unexplored-edge ban; ship removal destroys cargo; crew/settler placement rules and discard-your-own-piece.
Movement: 4 MP, 6 MP with wool (once), 2 ships per edge, end-edge rule, discovery stops movement, pass-through limits, frame edges, Council edge sailing.
Explore: reward cards vs gold, disc draws match region, spice sacks = players, lair token placement, two unexplored hexes at one corner (§10 Q5).
Settlers: landing builds a settlement and returns ship + settler; distance rule; blocked on gold fields/spice farms/unexplored corners.
Pirate: placement exceptions (island-adjacent, frame, Council); steal rules (ship on hex, gold only at 0 cards); tribute once per ship per turn; chase rolls 6 (and Pirate Bonus 4/5/6); pirate removal of fish hauls.
Missions: lair capture (3 crews, mixed owners), involvement order, hero tie-breaks, solo hero 2 steps, crew return, token flip, build ban lifted; fish roll (once, conditions), load w/ 0 MP, deliver; spice (crew stays, 1 sack per farm per player, advantages immediate); track stacking and tile tie-break; end-of-track clamp.
Victory: thresholds per scenario; win mid-Movement; lair win after movement; VP derivation incl. tiles; paired player 2 wins; paired player 2 may not trade.
Serialisation: JSON round-trip; hidden hex content not leaked by the board view API; save upgrade.
Interactions: Cities & Knights +5 target (if implemented).

---

## 10. Open questions and recommended interpretations

| #   | Question                                                                                                                                             | Recommendation                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | **Numbers on the 6 lair tokens (8 with 5–6)** are not stated in any text we could read. A fan 3D-print file suggests 2, 3, 5, 6, 8, 11 (unverified). | Make them **configurable data**. Default to a spread of mid and low-probability numbers, e.g. `[3,4,5,9,10,11]`; for 5–6 add two more. **Verify against a physical copy before locking it in.**                               |
| Q2  | Which die-roll numbers trigger fish rolls for **unexplored** shoals?                                                                                 | R6 says "an explored shoal"; unexplored match = nothing, no re-roll.                                                                                                                                                          |
| Q3  | **Gold compensation:** is it for every player on every roll (R5 yes) and does it apply on a 7?                                                       | Follow R5: **every player**, **not on a 7**, trigger = no resource cards (gold from gold fields does not count as a resource, FAQ-6).                                                                                         |
| Q4  | The Fish for Catan map figure (M6 p. 14) draws **no Council hex**, though the scenario text and component counts need one.                           | Place it at (6,3) as in Spices and the full game. Counts then balance (58 = 15 + 22 + 19 seas + Council + printed sea).                                                                                                       |
| Q5  | A ship end touching a corner shared by **two or three unexplored hexes**: flip all, or one?                                                          | Flip **all** unexplored hexes at that corner (and at the other end if it also touches one), each paying its reward. (R6/R5 say "that hex" in the singular; this case is not addressed.) Mark as house ruling; easy to change. |
| Q6  | **Extra ship move timing:** when exactly may you buy it?                                                                                             | Any time in your Movement phase **before that ship's last MP is spent**, once per ship per turn, +2 MP. (Player aid says "+1–2 extra spaces": using fewer is always allowed.)                                                 |
| Q7  | **Fish delivery:** 1 space or "one additional space"?                                                                                                | **1 space** (Mission Guide example).                                                                                                                                                                                          |
| Q8  | **Can a pirate be placed on a hex where it blocks nothing** / on the same hex it just left?                                                          | Not on the same hex when moving your own (R6). For "remove opponent's and place yours": R6 says "a different sea hex", R5 allows the same: follow R6.                                                                         |
| Q9  | **Coin supply:** 76 coins can run out in theory.                                                                                                     | Treat gold as an **unlimited counter** (no shortage rule exists).                                                                                                                                                             |
| Q10 | Several lairs captured in one turn: resolution order?                                                                                                | In the order they were captured; each resolves fully (gold, +1, hero roll) before the next.                                                                                                                                   |
| Q11 | 5–6 win targets: the 5–6 booklet gives none.                                                                                                         | Same as 3–4 (12 / 15 / 15 / 17).                                                                                                                                                                                              |
| Q12 | **3-player Land Ho!:** which colour is left out?                                                                                                     | Any unused colour; its pieces are simply not placed. In 2-player, neutral pieces are placed as in §2.10.                                                                                                                      |
| Q13 | Land Ho! starting positions in §2.4 were read from a figure (vertex-level).                                                                          | Verify each in a fixture against M6 p. 4 / R5 p. 2, **and** assert distance rule + coastal + ship edge touches harbor vertex.                                                                                                 |
| Q14 | Can the engine support **2 players**?                                                                                                                | Yes, easy; neutral pieces are only obstacles. Optional.                                                                                                                                                                       |
| Q15 | **Spice farm crews:** "only 1 crew on each spice farm": per player or in total?                                                                      | **Per player.** Sacks are provided 1 per player and each player loads at most 1 per farm, which only makes sense if every player may befriend every farm once.                                                                |
| Q16 | Lair crews: may one player bring a lair to 3 crews alone, and may players place more than 3?                                                         | Yes to the first (R6: "crews may belong to a single player"). No to the second: maximum 3 on a lair (R5 p. 10).                                                                                                               |
| Q17 | A 7 is rolled in a scenario with a pirate but the roller cannot legally place it (every sea hex excluded)?                                           | Cannot happen on the official boards (plenty of non-island-adjacent sea hexes exist). Skip the placement if it ever does.                                                                                                     |
| Q18 | Can the discard threshold differ in 6e ("select half of your cards", no "more than 7")?                                                              | Keep the base rule (BASE §5.2, more than 7). R6 does not restate the threshold.                                                                                                                                               |

---

## Appendix: figure-reading audit

Every board was reconstructed by hand from the printed illustrations, then checked with arithmetic:

- Position count = island (incl. printed pasture) + regions + Council (if any) + face-up seas + 1 printed sea: Land Ho! 51, Lairs 58, Fish 58, Spices 65, full 72, 5–6 Lairs 79, 5–6 Fish/Spices 88, 5–6 full 97.
- Island discs total 15 (3–4) and 22 (5–6) and match the component tables.
- Region cell counts match the table totals (8, 11, 11, 13, 16, 14, 16, 20) and top/bottom regions mirror in 5–6 and in 3–4 Lairs/Spices/full.
- The Misprint in M6 p. 16 (parrot 9 ×2) was detected because the row would sum to 7 not 6.

If anything in §2 looks wrong when a fixture is built, check the corresponding printed figure first: the PDFs are the ground truth, this file is our reading of them.

---

## 11. Engine status (E5, `src/expansions/ep`)

Mode `ep`, five scenarios `ep/<key>` (`landHo`, `pirateLairs`, `fish`, `spices`, `full`), each with
a 3-4 player map and (not Land Ho!) a 5-6 player map: `ep/landHo`, `ep/pirateLairs`, `ep/fish`,
`ep/spices`, `ep/full`, `ep/pirateLairs56`, `ep/fish56`, `ep/spices56`, `ep/full56` (9 maps,
`engine/maps.ts`). Target edition: 6th (2025). Tests: `engine/maps.test.ts` (position and
component counts, mirror symmetry, the Council, harbor spots), `engine/setup.test.ts`,
`engine/rules.test.ts`, `engine/sea.test.ts`, `ui.test.ts`, `bots.test.ts`; sim invariants in
`invariants.ts`. Sim: `pnpm sim --mode ep --scenario ep/<key> --games 300 --bias 0.5`.

How the pieces map onto the core: a **harbor settlement** is a settlement piece flagged in the
slice (`harbors[vertex]` = its basin): it produces 1 card like a settlement, the `victoryPoints`
hook adds its second VP and `pieceLimit` gives the settlement piece back. **Face-down hexes** are
board hexes of terrain `ep/parrot` / `ep/goose` (kind `fog`, their backs are public), their content
lives in the slice (`hidden`) and the board is replaced copy-on-write when one is explored.
Face-up sea positions are board hexes of terrain `sea` too (so the board view frames the whole
playing area); the automatic water ring is the frame. **Gold** is a per-player counter in the slice (not a resource card). **Ships** are the module's
own pieces (`ships[]`: id, owner, edge, cargo), up to 2 per edge, moved by `ep/moveShip`.

| Rule                                                                                                                                                                                                                        | Status                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1.1 no dev cards, cities, robber, ports, Longest Road, Largest Army                                                                                                                                                        | done (map `devDeck` all 0, `pieceLimit` city 0 + `buildCity` refused, `NO_ROBBER`, no ports, `roadLength` / `armySize` 0); the HUD hides the City card (`hideBaseCards`)                                                                                                    |
| §1.2 pieces: 15 roads, 5 settlements, 4 harbors, 3 ships, 2 settlers, 9 crews (none in Land Ho!), 2 gold                                                                                                                    | done (`pieceLimit` hook; supply derived from the board)                                                                                                                                                                                                                     |
| §2.0 doubled coordinates → axial (`doubledToHexId`), frame, printed pasture (6) and printed sea                                                                                                                             | done; every position count of the appendix asserted (51/58/58/65/72, 79/88/88/97)                                                                                                                                                                                           |
| §2.3 island numbers fixed; terrain fixed in Land Ho! / Pirate Lairs, random in Fish / Spices / full                                                                                                                         | done; 5-6 islands random (no fixed layout printed). The optional random Pirate Lairs island (M6) is not offered                                                                                                                                                             |
| §2.3 / §8.2 starting harbor spots (NE + SE corner of each row's easternmost island hex; 14 / 18)                                                                                                                            | done                                                                                                                                                                                                                                                                        |
| §2.4 Land Ho! fixed starting pieces and cards (3 players: the 4th colour stays out)                                                                                                                                         | done (Blue, Red, Orange, White = seats 0-3; asserted: distance rule, coastal harbors, ship at the harbor, starting cards)                                                                                                                                                   |
| §2.4-2.8, §8.3 region decks (Fish 3-4: 2 of the 3 parrot shoals; full: 1 deck sea out) and disc stacks                                                                                                                      | done (dealt face down by the module's `init`)                                                                                                                                                                                                                               |
| §2.9 variable setup: harbor round on the marked spots, settlement round, then road + ship with a settler                                                                                                                    | done (core setup + override / filter + `afterAction`, then phase `ep/setupFleet`: `ep/setupRoad`, `ep/setupShip`); only the settlement pays                                                                                                                                 |
| §2.10 2-player variant (neutral pieces)                                                                                                                                                                                     | not done (3-6 players)                                                                                                                                                                                                                                                      |
| §3.1 turn: production, Action phase, Movement phase                                                                                                                                                                         | done: `main` = Action phase; `ep/startMovement` starts the Movement phase (`turn.movement`); `endTurn` from either                                                                                                                                                          |
| §3.1 / §5 win at any point of your own turn                                                                                                                                                                                 | done (core check after every action); no win during `ep/setupFleet` (`deferVictory`)                                                                                                                                                                                        |
| §3.2 production 1 card per building, harbor = 1                                                                                                                                                                             | done                                                                                                                                                                                                                                                                        |
| §3.2 gold compensation: every player with no resource from a roll, not on a 7 (§10 Q3), FAQ-6                                                                                                                               | done (`afterProduction`; Event Cards too)                                                                                                                                                                                                                                   |
| §3.2 captured gold field: 2 gold per adjacent building on its number                                                                                                                                                        | done                                                                                                                                                                                                                                                                        |
| §3.2 7: discard (> 7 resource cards, gold exempt), then the roller's pirate; Land Ho!: discard only                                                                                                                         | done (`moveRobber` turned into `ep/pirate`; Robber Attacks event card the same)                                                                                                                                                                                             |
| §3.3 trade: 3:1 with the supply (no 4:1, no ports), 3 cards → 1 gold, 2 gold → 1 card (twice a turn)                                                                                                                        | done (`bankTradeRatio` 3, `ep/sellForGold`, `ep/buyWithGold`); player trades as in the base game                                                                                                                                                                            |
| §3.3 player trades with **gold**                                                                                                                                                                                            | done (E5b): `ep/offerTrade` (resources and gold on either side; M6 p. 5 "any combination of resources and coins"), gold moves on confirm (`engine/trade.ts`); resource-only offers stay the base offer                                                                      |
| §3.3 / §4.11 roads and settlements never at an unexplored hex, an uncaptured lair, or a spice farm without your crew                                                                                                        | done (`vertexBlocked` / `edgeBlocked` hooks + per-player override and filter)                                                                                                                                                                                               |
| §3.4 / E16 no trading or building in the Movement phase                                                                                                                                                                     | done (filter + overrides)                                                                                                                                                                                                                                                   |
| §4.2 harbor settlement: upgrade a coastal settlement for 2 grain 2 ore, 2 VP, Action phase only                                                                                                                             | done (`ep/buildHarbor`)                                                                                                                                                                                                                                                     |
| §4.3 exploring: a ship end at a face-down corner turns it over, pays 1 card (empty bank: none) or 2 gold, stops the ship; disc from its region; lair token; 1 sack per player                                               | done (moving and building ships)                                                                                                                                                                                                                                            |
| §10 Q5 several face-down hexes at one corner                                                                                                                                                                                | all would turn over; cannot happen on these boards (a move arrives over a fog-free corner; tested)                                                                                                                                                                          |
| §4.4 ships: sea routes (water on a side, frame edges, Council edges), 2 per edge, build at an own harbor (not beside a face-down hex), replace one when none is left (cargo lost)                                           | done (`ep/buildShip`, `replace`)                                                                                                                                                                                                                                            |
| §4.4 movement: 4 MP, +2 for 1 wool once per ship per turn (§10 Q6), Swift Voyage +1 at once (FAQ-9), pass ships, stop only with room, one ship at a time                                                                    | done (`ep/selectShip`, `ep/moveShip` to any reachable edge, `ep/extraMove`; another ship moving finishes the previous one)                                                                                                                                                  |
| §4.5 settler lands at an end of its ship: free settlement, distance rule, ship + settler home (FAQ-7)                                                                                                                       | done (`ep/land`)                                                                                                                                                                                                                                                            |
| §4.6 basin / hold 1 large or 2 small; load / unload / swap with an own adjacent harbor; no ship-to-ship; build into an empty slot; throw a piece away                                                                       | done (`ep/load`, `ep/unload`, `ep/swap`, `ep/buildSettler`, `ep/buildCrew`, `ep/dump`)                                                                                                                                                                                      |
| §4.7 pirate: placement (sea or shoal, not next to the island, not the Council or frame, not where it stood), steal a card (gold if none), haul removed                                                                      | done (`ep/placePirate`, `ep/pirateSteal`); friendly robber protects as for the robber                                                                                                                                                                                       |
| §4.7 tribute 1 gold once per ship per turn onto / off / along an opponent's pirate hex; no gold = no way                                                                                                                    | done (path search prefers free ways)                                                                                                                                                                                                                                        |
| §4.7 chase: unmoved ship touching the hex, 6 (+ Pirate Bonus numbers) chases it home, then your pirate                                                                                                                      | done (`ep/chase`, one roll per ship per turn)                                                                                                                                                                                                                               |
| §4.8 lairs: 1-3 crews of any players, captured at 3, resolved after the Movement phase in capture order: 2 gold + 1 space each, hero (die + crews, ties: crews, reroll) +1 and a crew back; sole player = hero; token flips | done (`ep/dropCrew`, resolution in the `endTurn` override, may win); crews stay and can be picked up (`ep/pickCrew`)                                                                                                                                                        |
| §10 Q1 lair token numbers                                                                                                                                                                                                   | **our data**: 3, 4, 5, 9, 10, 11 (+ 2, 12 for 5-6), `LAIR_TOKENS` in `maps.ts`                                                                                                                                                                                              |
| §4.9 fish: Council anchors (N, S corners), fish roll once per turn not mid-move, haul unless one is there / the pirate / none left, catch with no MP, deliver 1 space each (§10 Q7)                                         | done (`ep/rollFish`, `ep/catchFish`, `ep/deliver`)                                                                                                                                                                                                                          |
| §4.10 spice: 1 crew per player per farm, stays (§10 Q15); one sack per player per farm after befriending; deliver 1 space each                                                                                              | done (`ep/dropCrew` on a farm, `ep/loadSpice`, `ep/deliver`)                                                                                                                                                                                                                |
| §4.12 farm advantages: Swift Voyage, Pirate Bonus (4 parrot / 5 goose), Fast Gold (once per farm per turn)                                                                                                                  | done (`ep/fastGold`); which region's farm shows 4 is **our choice**                                                                                                                                                                                                         |
| §4.13 tracks, VP per space, end clamps, bonus tile to the furthest (ties: first to arrive)                                                                                                                                  | done                                                                                                                                                                                                                                                                        |
| §5 VP targets 8 / 12 / 15 / 15 / 17 (5-6 the same, §10 Q11)                                                                                                                                                                 | done (scenario `vpToWin`)                                                                                                                                                                                                                                                   |
| §8.1 5-6: paired players' turn (player 2: Action + Movement, no trades with players, may win)                                                                                                                               | done: the core Second Settler step, on by default via the new `ScenarioDef.pairedTurns56`; the special building phase is refused                                                                                                                                            |
| §8.1 5th-edition 5-6 special building phase                                                                                                                                                                                 | not offered (6th edition only)                                                                                                                                                                                                                                              |
| §8.4 E&P + Cities & Knights, §8.5 E&P + Traders & Barbarians                                                                                                                                                                | done (E5b): modes `ep+ck` (module `epck`) and `ep+tb` (module `eptb`), rule by rule in `docs/rules/combos.md` §7-8; seams here: `citiesInPlay` / `isHarborStep`; Seafarers is a `conflict`                                                                                  |
| Variants                                                                                                                                                                                                                    | Event Cards (numbers only: the events are dropped, E&P + T&B sheet), balanced dice, friendly robber (pirate), robber off (no pirate on a 7), chess clock, Rush, Turbo work; setup placement variants, the special building phase, rules56 and map balance rules are refused |
| Statistics                                                                                                                                                                                                                  | resource cards classified (exploring = event, builds = build, gold trades = bank, pirate = steal); VP chips Harbors / Pirate Lairs / Fish for Catan / Spices for Catan / Bonus tiles; gold is not counted                                                                   |
| Free roads (C&K Road Building, T&B fish in the combinations)                                                                                                                                                                | obey the spice farms like built roads (E5b fix)                                                                                                                                                                                                                             |
| Online play                                                                                                                                                                                                                 | works (X1): the lobby offers `ep`, `ep+ck` and `ep+tb`; `maskFor` hides the face-down hexes and the stacks                                                                                                                                                                  |
