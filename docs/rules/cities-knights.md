# Catan: Cities & Knights — rules reference for our engine

Researched 2026-10-25 on branch `s3/rules-ck`. Written in our own words for engine agents. **Target
edition: the current English 5th edition** (rules of Jan 1 2015, Catan Studio 2020 printing), with
the 5-6 player extension. The 6th edition (2025) is cross-checked; every difference is in §0.3.
No code was changed.

Rule numbers (**CK-n**) are stable so tests and cards can cite them. Where a source is silent the
text says **UNCLEAR** and §10 gives our recommended ruling.

## 0. Sources, conventions, edition differences

### 0.1 Sources

| Key      | Source                                                                                                                                                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S5**   | _Catan: Cities & Knights Game Rules & Almanac_, 5th English ed. (20 pp., © 2015/2020). Hosted copy: https://catancollector.com/images/rules-archive/5e-2020-cs/05-catan_c_k_2020_rules.pdf. Cited as S5 p.N. **Our baseline.** p.2 says rules as of 1 Jan 2015 override older ones. |
| **S5o**  | Older Mayfair printing (© 1997–2006) of the same rulebook, 20 pp: https://www.exodusbooks.com/Samples/Games/9180sample.pdf. Text is almost identical to S5; used only as a cross-check (card list and examples agree).                                                              |
| **S6**   | _CATAN – Cities & Knights Expansion_, 6th ed. rulebook (2025, 16 pp.): https://catancollector.com/images/rules-archive/6e-2025/05-CN3087-CATAN-CitiesKnights-Rulebook.pdf. Many costs are icons only; those were taken from S5 and the S6 examples.                                 |
| **FAQ**  | Official catan.com C&K FAQ, 122 entries: https://www.catan.com/faq/cities-knights (read 2026-10-25). Cited as FAQ Qn using the page's own numbering. Entries were read through a page summariser; every entry quoted in §6 was re-read verbatim in a second fetch.                  |
| **E56**  | _C&K 5-6 Player Extension_ rules (2020, 4 pp.): https://catancollector.com/images/rules-archive/5e-2020-cs/06-catan_c_k_5-6_2020_rules.pdf                                                                                                                                          |
| **E56P** | Same extension, 2023 revision with Paired Players (4 pp.): https://catancollector.com/images/rules-archive/5e-2023-pairedplayers/catan-ck-5-6%202023v2.pdf                                                                                                                          |
| **PROD** | Product page, combinations: https://catan.com/game/catan-cities-knights-expansion                                                                                                                                                                                                   |
| **BGA**  | Board Game Arena help (barbarian track length): https://en.doc.boardgamearena.com/Gamehelpcatan                                                                                                                                                                                     |
| **BASE** | Our own `docs/RULES.md` (base game, 5-6 player board in §16, special build phase §16.10, paired players §16.D). Everything not changed here follows it.                                                                                                                             |

### 0.2 Conventions

- "Commodity" = paper, cloth, coin. "Resource" = lumber, brick, wool, grain, ore. "Card" in a hand
  limit = resource or commodity card. Progress cards are never "cards" for 7s, robbers or trades.
- "Active/inactive" knight. "Own route" = the player's continuous network of roads (and ships with
  Seafarers).
- VP always means public victory points (all C&K VP sources are face up).
- 5th-ed card names are used; the 6th-ed names are in the card tables.

### 0.3 5th vs 6th edition (and older) differences

| #   | Topic                                | 5th ed (our target)                                                                                                                                                                                                | 6th ed (2025)                                                                                                                                                                                               |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Turn shape                           | Roll → event die → draw progress cards → production → any order of actions (S5 p.5).                                                                                                                               | Same order, named phases: Roll Dice (Alchemy, roll, ship/attack, draw), Production, Action (S6 p.6–7). No rule change.                                                                                      |
| D2  | First player                         | Highest roller places first in setup; **the player who placed the last city takes the first turn** (S5 p.4–5).                                                                                                     | Highest roller is first player, places first and takes the first turn; setup round 2 is reverse order (S6 p.5). Same player in both: **no effective difference**.                                           |
| D3  | Names of improvements                | Trade: Market, Merchant Guild, Trading House, Bank, L5 name unclear. Politics: Town Hall, Church, Fortress, Cathedral, L5 ?. Science: Abbey, Library, Aqueduct, Theater, L5 ? (S5 p.7–9; L5 names are image-only). | Science: School, Library, Aqueduct, Theater, University. Trade: Market, Trading House, Merchant Guild, Bank, Great Exchange. Politics: Town Hall, Embassy, Fortress, Courthouse, High Assembly. Names only. |
| D4  | Level 3 abilities                    | Trade: trade a **commodity** 2:1 for any commodity or resource, own turn only. Politics: strong → mighty. Science: aqueduct.                                                                                       | Same effects. Trade wording: "any 2 identical commodities for any 1 other commodity or resource". No timing sentence, but it is a trade, so own turn.                                                       |
| D5  | Metropolis                           | First to level 4 may place it; level 5 takes it for good (S5 p.8).                                                                                                                                                 | Level 4 = "temporary control", level 5 = permanent (S6 p.8). Same logic, clearer words.                                                                                                                     |
| D6  | Pillage with no settlement piece     | Not covered in S5. FAQ Q15: lay a city on its side and treat it as a settlement.                                                                                                                                   | Same, plus "must upgrade that one before any other settlement" (S6 p.11).                                                                                                                                   |
| D7  | Who is pillaged                      | Lowest strength; players with no city or only metropolises are not counted (S5 p.11).                                                                                                                              | Lowest strength; if that player has nothing pillageable, the next lowest, and so on (S6 p.11). **Same outcome** (FAQ Q14).                                                                                  |
| D8  | Progress hand limit                  | Discard the 5th card at once if it is not your turn; on your turn it must be played or discarded (S5 p.9; FAQ Q102).                                                                                               | Same; on your own turn "by the end of your Action phase" (S6 p.12).                                                                                                                                         |
| D9  | Robber at start                      | Robber sits on the desert but is inert until the first attack (S5 p.5).                                                                                                                                            | Robber starts beside the barbarian track, is put on the desert after the first attack and is then active (S6 p.6). Same effect.                                                                             |
| D10 | Card names                           | See §4.6.                                                                                                                                                                                                          | Alchemy, Engineering, Invention, Printing, Smithing, Taxation (Bishop), Treason (Deserter), Diplomacy, Sabotage, Espionage (Spy), Encouragement (Warlord), Guild Dues (Master Merchant). Counts unchanged.  |
| D11 | Progress draw timing                 | Event die is resolved first; the draw happens before production.                                                                                                                                                   | Same.                                                                                                                                                                                                       |
| D12 | Seafarers combination                | Variant list on S5 p.13; no extra VP.                                                                                                                                                                              | Adds "+2 VP to win" (S6, Seafarers section) and a pirate rule: pirate is inert until the first attack, Taxation moves only the robber.                                                                      |
| D13 | Supply shortage on Mining/Irrigation | Silent.                                                                                                                                                                                                            | "Take as many as remain" (S6 p.13).                                                                                                                                                                         |
| D14 | Components                           | Flip-charts ("city calendars"), metropolis token + gate piece, cardboard barbarian tile.                                                                                                                           | Improvement boards + cubes, 6 VP tokens, barbarian track printed on the sea frame, 4 player aids.                                                                                                           |
| D15 | 5-6 players                          | 2020: Special Build Phase (E56). 2023: Paired Players (E56P).                                                                                                                                                      | Not covered by the retrieved 6th-ed rulebook.                                                                                                                                                               |

The older S5o printing differs from S5 only in cosmetic names (e.g. level 2 trade "Trading House",
level 3 "Counting House") and in using "his". No gameplay change was found.

---

## 1. Overview and components

C&K replaces the development cards of the base game with **progress cards**, adds **commodities**,
**city improvements**, **knights**, **city walls**, **metropolises**, the **barbarian ship**, the
**merchant** and a third die. Everything else is base Catan. Win at **13 VP** (S5 p.12).

### 1.1 What is removed from the base game (S5 p.2)

- The 25 development cards, the Largest Army card (there is no Largest Army, FAQ Q40) and the
  building-cost cards. **Dev cards cannot be bought at all** (S5 p.6).
- Kept: Longest Road (2 VP), all resource cards, roads/settlements/cities, robber, harbors, red and
  yellow dice. The "Longest Road" card is used as in base.

### 1.2 Component counts

| Item                                         | 3–4 players (S5 p.2–4)                                                                                                                           | + 5–6 extension (E56 p.1)                | Total for 5–6         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | --------------------- |
| Commodity cards                              | 36: **12 paper**, **12 cloth**, **12 coin**                                                                                                      | +18: +6 each                             | **18 / 18 / 18** (54) |
| Progress cards                               | **54**: 18 trade (yellow flag), 18 politics (blue), 18 science (green)                                                                           | none                                     | 54 (same)             |
| "Defender of Catan" VP cards                 | **6** (1 VP each)                                                                                                                                | +2                                       | **8**                 |
| Development flip-charts (improvement boards) | 4                                                                                                                                                | +2                                       | 6                     |
| City walls                                   | 12 (3 per colour)                                                                                                                                | +6                                       | 18                    |
| Knights                                      | 24 (6 per colour: 2 basic, 2 strong, 2 mighty)                                                                                                   | +12                                      | 36                    |
| Metropolis pieces                            | 3 (one per track) plus 3 matching cardboard tokens                                                                                               | none                                     | 3                     |
| Barbarian tile + barbarian ship              | 1 + 1 (track of 7 steps, see §3.4)                                                                                                               | none                                     | same                  |
| Merchant                                     | 1 (wooden cone)                                                                                                                                  | none                                     | same                  |
| Dice                                         | base yellow + red numbered dice, plus **1 event die**: 3 ship faces + 3 city-gate faces (1 yellow = trade, 1 blue = politics, 1 green = science) | none                                     | same                  |
| Resource cards                               | 19 each (95)                                                                                                                                     | base 5-6 adds 5 each (24 each, BASE §16) | 24 each               |
| Robber                                       | 1, starts on the desert (either desert in 5-6)                                                                                                   | —                                        | —                     |

**Per player (S5 p.4):** 5 settlements, 4 cities, 15 roads (base) + **6 knights** (2 basic, 2
strong, 2 mighty) + **3 city walls** + **1 flip-chart**. The 6th-ed box has the same per-player
pieces plus 3 improvement cubes (S6 p.2).

**Piece limits that matter:** at most **3 city walls** on the board per player; at most **2 knights
of each level** on the board per player (the piece supply is the limit); **3 metropolises** in the
whole game; only **1 metropolis per city** (a city has one gate, FAQ Q26).

**Defender of Catan cards** run out after 6 (8). The player still scores; mark the point with any
other token (FAQ Q6). The engine should count them as a number, not a finite physical deck.

**Commodity supply** is physical (12 each, 18 in 5-6). Bank shortage follows the base rule
(BASE 4.x): if the bank cannot cover everyone's production of one card type, and more than one
player is owed it, nobody gets that type; if only one player is owed it, they get what remains.
Test this per card type, because a city yields one resource and one commodity separately.

### 1.3 City improvements: tracks, levels, costs, red-die values

Three tracks, 5 levels each (S5 p.7). A player starts at level 0 on every track.

| Track        | Flag/gate colour | Commodity paid (FAQ/S5 p.7) | Level 3 ability                                        |
| ------------ | ---------------- | --------------------------- | ------------------------------------------------------ |
| **Trade**    | yellow           | **cloth**                   | commodity 2:1 trading (§4.3)                           |
| **Politics** | blue             | **coin**                    | promote strong → mighty knights (§4.4)                 |
| **Science**  | green            | **paper**                   | Aqueduct: free resource on a no-production roll (§4.3) |

**Cost of reaching level n = n commodities** of the track's commodity: level 1 = 1, level 2 = 2, …
level 5 = 5; 15 in total per track (S5 p.7: "the first costs 1, the second 2, each next is 1 more").
Buying is one level at a time; no skipping. Several levels, in any tracks, in one turn are fine
(FAQ Q19). The colour of the last event die is irrelevant to buying (FAQ Q18).

**Progress-draw eligibility ("red dice" on the flip-chart).** Level n shows n + 1 red dice:
level 1 = {1, 2}, level 2 = {1, 2, 3} (both confirmed by S5 p.8 and S6 p.7 examples). The rulebook
text ("two red dice, then three, and so on", S5 p.9) gives level 3 = {1–4}, level 4 = {1–5},
level 5 = {1–6}. **The level 3–5 sets are derived from that sentence, not seen on a printed chart.**
Level 0 shows nothing, so a player with level 0 in a track never draws that colour.

| Level          | 0   | 1   | 2     | 3          | 4          | 5          |
| -------------- | --- | --- | ----- | ---------- | ---------- | ---------- |
| Red die values | —   | 1,2 | 1,2,3 | 1–4 (der.) | 1–5 (der.) | 1–6 (der.) |

Names (cosmetic) are in §0.3 D3. 5th-ed level names L1–L4 per S5 p.7–9: Trade Market, Merchant
Guild, Trading House, Bank; Politics Town Hall, Church, Fortress, Cathedral; Science Abbey, Library,
Aqueduct, Theater. S5 p.8 names the ability buildings as Trading House (L3 trade), Fortress (L3
politics), Aqueduct (L3 science) and the metropolis buildings as Bank (L4 trade), Cathedral (L4
politics), Theater (L4 science).

### 1.4 Knights

| Level | Name   | Strength | Recruit cost (S5 p.6)                                                                     | Promote cost                                                              |
| ----- | ------ | -------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1     | Basic  | 1        | **1 wool + 1 ore** (always recruited basic)                                               | —                                                                         |
| 2     | Strong | 2        | via promotion (or "build a strong directly" = recruit + promote, 2 wool + 2 ore, FAQ Q47) | **1 wool + 1 ore** from basic                                             |
| 3     | Mighty | 3        | via promotion                                                                             | **1 wool + 1 ore** from strong, **only with Politics level 3 (Fortress)** |

Activate: **1 grain** (any level). City wall: **2 brick**. These all go to the bank.

### 1.5 Production table for cities (S5 p.5, Illustration G; S5 p.20)

| Hex type  | Settlement | City                   |
| --------- | ---------- | ---------------------- |
| Forest    | 1 lumber   | **1 lumber + 1 paper** |
| Pasture   | 1 wool     | **1 wool + 1 cloth**   |
| Mountains | 1 ore      | **1 ore + 1 coin**     |
| Fields    | 1 grain    | **2 grain** (as base)  |
| Hills     | 1 brick    | **2 brick** (as base)  |

The resource and the commodity are both mandatory; a player may not take two resources, or one
card only (FAQ Q32, Q35). Commodities come only from cities and only from forest, pasture and
mountains (S5 p.7). A metropolis city produces exactly as a city.

---

## 2. Setup

### 2.1 Board and frame

C&K uses the **base-game frame and map shapes**. For 3–4 players that is the 19-hex island with the
18-hex sea ring and 9 harbors (BASE §12, `std19`). The only new board object is the **barbarian
tile/track**, placed beside the board; it is **off-map for the engine** (a counter, §3.4). In the
6th ed the track is printed on one sea-frame piece instead (S6 p.4); no hexes change.

For 5–6 players use the base 5-6 board (BASE §16: 30 land hexes rows 3-4-5-6-5-4-3, 28 number
tokens, 11 harbors, 2 deserts) unchanged; the C&K 5-6 booklet adds no terrain (E56 p.2).

### 2.2 The fixed beginner board (3–4 players) — the only official fixed C&K map

S5 p.4 (Illustration D) and p.20, S6 p.4. Same in both editions. **No pieces are pre-placed**: players
do the normal setup phase on it. It is **not** the base-game beginner map: the two differ
(see BASE §12.1 for that one). Hexes read by eye from the rulebook art at high resolution; terrain
counts and token multiset were checked (4 forest, 4 pasture, 4 fields, 3 hills, 3 mountains,
1 desert; tokens 2, 3×2, 4×2, 5×2, 6×2, 8×2, 9×2, 10×2, 11×2, 12; 6 and 8 are never adjacent).

Pointy-top, rows 3/4/5/4/3, row-major top to bottom, left to right (our `landHexes` order). Axial
`h:q,r` as in ARCHITECTURE.md §2.

| Row | Col 1               | Col 2                | Col 3               | Col 4              | Col 5            |
| --- | ------------------- | -------------------- | ------------------- | ------------------ | ---------------- |
| 1   | hills 6 `h:0,-2`    | mountains 2 `h:1,-2` | hills 5 `h:2,-2`    |                    |                  |
| 2   | forest 3 `h:-1,-1`  | mountains 9 `h:0,-1` | **desert** `h:1,-1` | forest 10 `h:2,-1` |                  |
| 3   | forest 8 `h:-2,0`   | fields 4 `h:-1,0`    | hills 11 `h:0,0`    | pasture 3 `h:1,0`  | fields 8 `h:2,0` |
| 4   | pasture 10 `h:-2,1` | fields 5 `h:-1,1`    | mountains 6 `h:0,1` | pasture 4 `h:1,1`  |                  |
| 5   | fields 9 `h:-2,2`   | pasture 12 `h:-1,2`  | forest 11 `h:0,2`   |                    |                  |

Resource names: forest = lumber (paper), hills = brick, pasture = wool (cloth), fields = grain,
mountains = ore (coin). Robber starts on the desert `h:1,-1`.

**Harbors (confidence medium-low, read from the S6 p.4 picture).** Clockwise from the top-left,
with the land hex each faces; the coast edge could be off by one position, and S5 p.20's picture is
too small to read:

| #   | Kind       | Faces                                   |
| --- | ---------- | --------------------------------------- |
| 1   | 2:1 brick  | hills 6 (west / north-west side)        |
| 2   | 2:1 ore    | mountains 2 (north-west side)           |
| 3   | 2:1 lumber | hills 5 / forest 10 (north-east / east) |
| 4   | 3:1        | pasture 4 (east / south-east)           |
| 5   | 3:1        | forest 11 (south-east)                  |
| 6   | 2:1 grain  | fields 9 / pasture 12 (south)           |
| 7   | 3:1        | fields 9 (south-west)                   |
| 8   | 2:1 wool   | pasture 10 (west)                       |
| 9   | 3:1        | forest 8 (west)                         |

Count check: 4 generic + one 2:1 each of 5 resources = 9. This differs slightly from the
base-frame slot list in BASE §12.2 (no harbor on fields 8's east coast; one at the south).
**Recommendation:** treat the harbors as a shuffled list on the existing 9 frame slots (as the base
variable board does) and, only if a faithful beginner map is wanted, verify the slot positions
against the printed art. Gameplay does not depend on it.

Beginners' note (S5 p.3): this layout gives balanced production, in particular enough grain and ore,
which C&K consumes fast.

### 2.3 Variable board (the normal way to play)

"Normally you play on a random, variable board like base Catan" (S5 p.3): shuffle the same 19
terrain hexes and 18 tokens, harbors and frame as BASE §2. C&K has **no scenario book of its own**,
no fog, no rivers, no sea hexes of its own. For 5-6 players use `base56` (BASE §16).

### 2.4 Pieces and order of setup

1. Build frame and board; **barbarian tile** beside it; barbarian ship on the tile's start space
   (S5 p.4).
2. Sort resource cards (5 stacks) and commodity cards (3 stacks) face up.
3. Split the 54 progress cards by flag colour into **3 face-down shuffled stacks**.
4. Place the 3 metropolises, the merchant, the 3 dice and the Longest Road card beside the island.
5. Robber on the **desert** (5-6: either desert). It is **inert until the first barbarian attack**
   (§3.3, CK-30).
6. Each player takes a colour and the pieces of §1.2; flip-chart shows page 1 (all tracks level 0).
7. Everyone rolls the dice (yellow + red); the highest starts the placement.
8. **Round 1:** from the starter, clockwise: each player places **1 settlement + 1 road**.
9. **Round 2:** from the **last** player to place, counter-clockwise: each places **1 city + 1 road**
   (not a second settlement). Distance rule applies as in base (S5 p.4).
10. Immediately after placing the city, the player takes **1 resource card per hex adjacent to the
    city** (always one card per hex, even fields and hills; **no commodities** at setup; S5 p.4;
    S6 p.5 "only 1 card for each hex").
11. **Who takes the first turn:** 5th ed, the player who placed the **last city** (S5 p.5). Round 2
    runs in reverse order, so that is the round-1 starter (the highest roller). 6th ed says the
    same player (the first player) starts (S6 p.5). The editions agree in effect (CK-2).

Our engine already draws the starting seat from the seed (`startingPlayer`, BASE 2.7); keep that and
do the city in round 2.

### 2.5 Optional setup rules (S5 p.13, all "agree before the game")

| Variant               | Effect                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Easy Start**        | Each player's first two turns: re-roll a 7; **the event die is not rolled** (no ship move, no progress draw). From a player's 3rd turn on everything is normal.                       |
| **Knight-Errant**     | A player may use an **active** knight to chase the robber **before rolling** (knight deactivates); like playing a Knight in base. FAQ Q57/Q121 forbid this in the standard rules.     |
| **Nasty ("meanies")** | At an attack each player announces how many of their active knights they commit; only committed knights count for strength and for who is weakest and only those deactivate (FAQ Q1). |

---

## 3. Turn structure and every change vs base

### 3.1 Sequence of a turn (S5 p.5–6)

1. **Pre-roll:** the only progress card that may be played is the **Alchemist** (§4.6). Nothing else
   (no trading, no building, no knight actions: FAQ Q57, Q95, Q99).
2. **Roll all three dice:** yellow, red, event.
3. **Resolve the event die first (CK-20..23):**
   - **Ship face:** barbarian ship moves 1 step. On reaching the last step the attack resolves
     now (§3.3).
   - **Gate face (yellow/blue/green):** progress draw (§3.2). No ship move in that roll.
4. **Production** from yellow + red total (§3.5). A 7 produces nothing: discard + robber (§3.6).
5. **Main phase, any order, any number of times:** trade (players and bank), build (roads,
   settlements, cities, knights, city walls, city improvements), knight activate / promote /
   actions, play progress cards (FAQ Q122).
6. **End turn.** (5-6 players: special build phase / paired players, §8.)

The event die is resolved **before** production, so a barbarian attack that costs a city happens
before that turn's production and the pillaged city produces as a settlement (FAQ Q13).

### 3.2 Drawing progress cards (S5 p.5, 9)

On a gate face, **each** player (not only the roller) is checked, **starting with the roller then
clockwise**:

- Eligible if their track of the **gate's colour** shows the **red die's value** (§1.3).
- Eligible players draw the **top card of the matching stack**. Cards are drawn in that order, one
  each.
- Hand limit **4** progress cards. A player who now holds 5 and it is not their turn must discard
  one **immediately** (their choice, to the bottom of the stack it belongs to, face down). On the
  roller's own turn they may keep 5 until the end of their turn, then must play or discard down to
  4 (FAQ Q102). A player may look at the 5th card before choosing (FAQ Q96). Unplayed cards cannot
  be discarded for no reason (FAQ Q97).
- **Victory point cards (Printer, Constitution)** are revealed and placed face up at once, even on
  another player's turn; they do not count towards the 4 (S5 p.9).
- If a stack is empty, eligible players draw in order until it runs out; the remaining ones get
  nothing (FAQ Q101). Played cards go **face down under their own stack** (never shuffled; FAQ Q103,
  Q104). VP cards stay on the table, so each of those two stacks shrinks by one for good.
- A progress card may be played on the turn it is drawn, if it is the player's turn (S5 p.9).
- Progress cards cannot be traded, stolen by the robber or seen by others, except by Spy / Master
  Merchant rules (they never take a progress card with Master Merchant).

### 3.3 The barbarian ship and the attack (S5 p.10–11, FAQ Q1–Q16)

**Track.** The ship starts on the start space. Each event-die ship face moves it **1 step**. The
track has **7 steps**: the attack happens when the ship reaches the 7th space, i.e. on the **7th ship
face** after the last reset (BGA; counted on the S6 p.4 art: start + 6 waves + landing). _If a table
count of 6 ever turns up, only a constant changes._

**Attack timing:** immediately on that roll, before progress draws (there are none that roll) and
before production. Nobody may activate knights in response (FAQ Q4).

**Step 1: strengths.**

- Barbarian strength = **number of cities on the board, over all players, counting metropolis
  cities once** (S5 p.11 example: 4 cities + 1 metropolis = 5; FAQ Q2 `b = s + m`). Settlements
  count 0. With Seafarers, all islands count.
- Defender strength = sum of strength (1/2/3) of **all active knights** of **all** players
  (including players without cities). Inactive knights add nothing.

**Step 2a: barbarians win (strength > defenders).**

- Each player has a contribution = their own active-knight total (0 if none).
- Only players who own at least one **pillageable city** (a city **without** a metropolis) are
  candidates. Players with no city, or whose only cities have metropolises, are skipped (S5 p.11).
- The candidate(s) with the **lowest contribution** each lose **one** city. A tie for lowest means
  each of the tied players loses one city. If no candidate exists at the lowest level, go up to the
  next lowest, and so on, until some city is lost (FAQ Q14; S6 p.11).
- The **owner chooses** which of their cities is pillaged (FAQ Q16), among non-metropolis cities.
- Pillaged city → replace by a settlement. Its **city wall is destroyed** and goes back to the owner's
  supply (S5 p.6). A city wall never protects the city (FAQ Q12, Q27).
- If the owner has no settlement piece left in supply (5 on board), lay the city on its side and
  treat it as a settlement (1 VP, settlement production) until upgraded (FAQ Q15; 6th ed also says it
  must be upgraded before any other settlement).
- The pillaged player may keep playing; production for that city on the same turn is as a settlement
  (FAQ Q13).

**Step 2b: defenders win (defenders ≥ barbarians).**

- The player with the **highest** active-knight total is the **Defender of Catan** and gets one
  Defender of Catan card (1 VP, face up, permanent). Having no city is irrelevant (FAQ Q8).
- **Tie for highest:** nobody gets the VP card. Instead **each tied player** draws the top card of
  **one progress stack of their choice**, clockwise starting from the player who rolled; a drawn
  victory-point card is kept as normal (FAQ Q9). The 4-card limit then applies as usual.
- Zero strength on both sides: see CK-33.

**Step 3, always:** ship returns to the start space; **all knights of all players are turned
inactive** (FAQ Q1, Q3: you cannot weaken a knight on purpose).

**First attack:** the robber becomes active from now on (§3.6); until then robber moves are
forbidden (CK-30). It is legal to move the robber on the very turn the ship landed (FAQ Q119).

### 3.4 Barbarian track representation

`barbarian: { position: 0..7 }` — 0 = start, 7 = attack. A ship face does `position += 1`; at 7, resolve
then set to 0. Also store `barbarianAttacks: number` (0 until the first attack; drives the robber
rule) and, for the Defender cards, `defenderCardsTaken` per player (a count).

### 3.5 Production (S5 p.5)

All hexes whose number equals yellow + red produce for **every** player: settlement 1 resource, city
resource(s) + commodity per §1.5. The robber's hex produces nothing. Both resources and commodities
are produced at the same time by the same number; they go to the same hand.

**Aqueduct (Science level 3 and above):** if a player receives **no** cards at all from a production
roll (neither resource nor commodity), they may take **1 resource of their choice** from the bank.
Not on a 7 (S5 p.8). "No cards" includes the case where all their hexes are blocked by the robber or
their number did not come up. The resource has to exist in the bank. Several players may use it on the
same roll.

### 3.6 Rolling a 7 (S5 p.5–6)

1. **Discard:** every player with **more than 7 + 2 × (their city walls)** cards in hand
   (resource + commodity cards) discards half (rounded down) of the whole hand, their choice of
   cards. Progress cards never count and are never discarded here. Walls help immediately: the
   limit is 7, 9, 11 or 13.
2. **Robber and steal only once the barbarians have attacked for the first time.** Before that the
   roller does **not** move the robber, steals nothing, the robber stays on the desert (S5 p.5).
   Hands are still checked and discarded. **Progress cards that move the robber (Bishop) and knight
   chase-away are forbidden until then** (S5 p.5; FAQ Q98 implies Bishop is unplayable).
3. After the first attack: roller moves the robber to a different hex and steals 1 random card
   (resource or commodity) from a player with a settlement/city adjacent to the new hex (FAQ Q23: also
   from metropolis owners; FAQ Q28 walls don't protect commodities).
4. Alchemist can set the dice to a 7 (FAQ Q68).

### 3.7 Trade (S5 p.6–7, FAQ Q36, Q61)

- Domestic trade: any mix of resources and commodities between players; progress cards never.
- Bank (4:1): **4 identical** cards of a kind (resource **or** commodity) for **1 card of anything**
  (resource or commodity).
- Generic harbor (3:1): 3 identical for 1 of anything. **Specific 2:1 harbor: only that resource**,
  2 of it for 1 of anything (a 2:1 harbor does nothing for commodities).
- 4:1 / 3:1 / 2:1 for a commodity "for resources and commodities freely" holds both ways: you may buy
  a commodity with resources at the same ratio (S5 p.7).
- Trade-track level 3 (§4.3) and Merchant (§4.8) and Merchant Fleet add better ratios; the best
  applicable ratio is used.

### 3.8 Victory

13 VP on your own turn at any time ends the game (S5 p.12). Details in §5.

---

## 4. New actions, cards and pieces

### 4.1 City walls (S5 p.3, 6; FAQ Q27–Q30)

| Item                          | Rule                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Cost                          | 2 brick to the bank                                                                                                                        |
| Placement                     | Under one of **your cities** (a metropolis city is fine, the wall stays; FAQ Q30). Never under a settlement. 1 per city, max 3 per player. |
| Effect                        | **+2** to the safe hand size on a 7 for each wall                                                                                          |
| Lost                          | When the city is pillaged the wall is removed (back to supply).                                                                            |
| Not                           | No protection from barbarians, none from the robber.                                                                                       |
| Upgrade settlement→city later | The wall can only be added after the city exists.                                                                                          |

### 4.2 Knights (S5 p.3, 6, 9–10; FAQ Q37–Q57)

**Recruit.** Pay 1 wool + 1 ore; place a **basic** knight, **inactive**, on an **empty intersection
that is touched by one of your roads** (end or middle of the road; FAQ Q52; Q49 says the spot must
be free and on your own connected road, never on top of another piece). The distance rule does not
apply. A knight must stay connected to one of your settlements/cities by your own roads (FAQ Q90).
If you have no basic knight left in supply you cannot recruit (promote one first, S6 p.9).
Limits: 2 per level in your supply.

**Activate.** Pay 1 grain; flip an inactive knight to active. A knight can be recruited and activated
in the same turn, and may be activated right after taking an action the same turn, but **a knight that
was activated this turn cannot take an action this turn** (S5 p.6, 10; FAQ Q45, Q57). An activated
knight can still be promoted, can still be built around, nothing else is restricted (FAQ Q55).

**Promote.** Pay 1 wool + 1 ore. The old token returns to supply and the next level takes its place in
the same spot; **active/inactive status does not change** (FAQ Q39). A given knight may be promoted
**once per turn**, but a knight may be promoted on the turn it was recruited (FAQ Q53) and a
promoted knight may act the same turn **if it was activated on an earlier turn** (FAQ Q48). Strong →
mighty needs **Politics level 3**. If all next-level tokens of that player are on the board, no
promotion.

**Knight action (one per active knight per turn; afterwards the knight is inactive; S5 p.10):**

1. **Move** to an empty intersection reachable along your own continuous route. The route may pass
   over intersections holding **your own** pieces (settlements, cities, knights) but not over any
   **foreign** piece (FAQ Q51). A just-built road may be used at once (FAQ Q50). Can't move if the
   only destination would break the connection rules (S5 p.10).
2. **Displace** an opponent's knight: move to the intersection of a **strictly weaker** enemy knight
   along your own route. A basic knight can never displace. Only on your own turn (FAQ Q37). The
   victim moves their knight to any **empty intersection reachable by their own routes from the spot
   it was displaced from** (that includes the spot the attacker left, if connected to the victim's
   roads too, FAQ Q43); its active/inactive state is unchanged. If there is no such place it is
   **removed** (back to its owner's supply). Your own knights can't be displaced. Your displacing
   knight ends up inactive (S5 p.10).
3. **Chase away the robber.** Any strength. The knight must stand on an intersection of the hex
   holding the robber. Move the robber to any other land hex with a number (or any hex the base rules
   allow), and steal 1 card from a player with a building there (as with a base Knight card). Not
   before the first attack. Knight becomes inactive (S5 p.10; FAQ Q45).

**Blocking and roads (S5 p.9; FAQ Q38, Q56, Q116, Q117):** a knight, active **or** inactive, blocks
another player from building a road past it, blocks building a settlement on its intersection, and
**splits opponents' roads for Longest Road** like a building. Your own roads placed between
opponents' knights need not be removed. A settlement on an intersection that holds **your own** knight
requires moving that knight first; if it cannot move, the settlement can't be built (S5 p.10).

**Never** can a player remove their own knight (FAQ Q54), nor deactivate one without an action
(FAQ Q46).

### 4.3 City improvements and level-3 abilities (S5 p.7–8)

- Pay the track's commodity (§1.3) to the bank and advance one level.
- **Condition:** the player needs **at least one city on the board** to buy a new level. If they lose
  their last city they **keep** improvements, progress cards and all level-3 abilities (FAQ Q10, Q17)
  but cannot buy more until they own a city again.
- **Level 3 abilities (kept forever, also at levels 4 and 5, FAQ Q20):**
  - **Trade — 2:1 commodity trade:** during **your own turn**, trade 2 identical commodities for 1
    of any commodity or resource (S5 p.8). It does **not** work for resources and is not usable in
    other players' turns. It is as if a 2:1 commodity harbor.
  - **Politics — Fortress:** strong → mighty knight promotions allowed (cost unchanged).
  - **Science — Aqueduct:** free resource on a no-production, non-7 roll (§3.5).
- **Metropolis** (§4.4).

### 4.4 Metropolises (S5 p.8; FAQ Q21–Q26)

- One per track, so at most 3 in the game. A metropolis is a gate piece placed **over one of your
  cities** plus a coloured token on your flip-chart.
- The **first** player to reach **level 4** of a track takes that track's metropolis and places it on
  any of their cities **without** a metropolis. Level 4 in a track whose metropolis someone else
  already holds gets you nothing.
- A player who reaches **level 5** before the current owner has done so **takes the metropolis
  away** (piece and token) and re-places it on one of their cities. A player at level 5 can never be
  displaced. The old owner cannot get it back (FAQ Q22).
- To buy level 4 or level 5 of a track you must **own a city where a metropolis could be placed**
  (a city without a gate): S5 p.8, S6 p.8. If you have none, wait until you have built one more
  city (FAQ Q26). See CK-52 for the exact scope.
- Worth **2 VP** (so a metropolis city is 4 VP in total); lost with the metropolis (FAQ Q24).
- A metropolis city **cannot be pillaged**, but it **counts** for barbarian strength (§3.3).
- You may own several metropolises, each on a **different** city (FAQ Q26).
- Robber and thieves treat the owner as any other player (FAQ Q23).

### 4.5 Merchant (S5 p.12; FAQ Q58–Q62)

- Put in play by any **Merchant** progress card (6 in the deck). The player who plays it places the
  figure on any **land hex** (not sea; 6th ed: not a gold-field hex) adjacent to one of their
  settlements/cities.
- Controller gets **1 VP** and may trade the **resource of that hex type 2:1** with the bank (also to
  receive a commodity, FAQ Q61); it works like a 2:1 harbor for that resource only, **only for the
  controller** (FAQ Q59), usable the turn the card is played (FAQ Q62), even if the robber sits on
  the hex (FAQ Q60).
- A later Merchant card moves the figure to a new hex next to **the new player's** building and transfers
  control: the old holder loses the VP and the rate. A player may re-play their own Merchant card to move it.
- The robber does not affect or move the merchant.

### 4.6 Progress cards: all 54 (S5 p.14–18; FAQ Q63–Q115)

Played **only on your own turn after the roll**, any number, any order (except Alchemist). Resolve fully,
then place the card face down under its stack. A card with no effect still counts as played; but you
may not **knowingly** play a card that can't do anything (Q98). Counts are per deck in the play
deck. 6th-ed name in brackets.

#### Science (green, 18)

| Card (6e)                  | #   | Effect (5th ed) and edge cases                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Alchemist** (Alchemy)    | 2   | **Pre-roll only.** Choose both numbered dice (yellow, red), any 1–6 each, including a 7 total (Q68). You must name a result (no skip, Q69). Then roll the **event die** normally. The set values drive production, the red die also drives progress eligibility (Q67). Only one of "Alchemist" and a normal roll (Q72). Applies to all players (Q71). |
| **Crane**                  | 2   | Next city improvement bought **this turn** costs **1 commodity less**; only 1 Crane per improvement (Q79, Q80); a level 1 improvement becomes free (Q81). Needs no commodity if free; still needs a city on the board.                                                                                                                                |
| **Engineer** (Engineering) | 1   | Build 1 city wall for free (normal limits: under a city without a wall, max 3).                                                                                                                                                                                                                                                                       |
| **Inventor** (Invention)   | 2   | Swap **2 number tokens** of your choice (not 2, 6, 8 or 12). No adjacency to your buildings needed; the token under the robber may be swapped; the robber stays and blocks the new number (Q105–Q107). Desert has no token.                                                                                                                           |
| **Irrigation**             | 2   | Take **2 grain per fields hex** adjacent to at least one of your settlements/cities (a city does not double; one bonus per hex even with several buildings). Bank shortage: take what remains (6e).                                                                                                                                                   |
| **Medicine**               | 2   | Upgrade one settlement to a city for **2 ore + 1 grain** (saves 1 ore, 1 grain). Not combinable twice on the same city (Q108). The normal city cost is 3 ore + 2 grain.                                                                                                                                                                               |
| **Mining**                 | 2   | Take **2 ore per mountains hex** adjacent to at least one of your buildings, same rules as Irrigation.                                                                                                                                                                                                                                                |
| **Printer** (Printing)     | 1   | **1 VP.** Reveal immediately when drawn, even out of turn; never in the hand, never counted for the hand limit, cannot be stolen.                                                                                                                                                                                                                     |
| **Road Building**          | 2   | Build **2 roads for free** (not necessarily connected to each other; normal placement rules). With Seafarers: 2 roads, 1 road + 1 ship, or 2 ships.                                                                                                                                                                                                   |
| **Smith** (Smithing)       | 2   | **Promote up to 2 knights one level each for free**, active or inactive (status unchanged); each knight at most once per turn (so two Smith cards need different knights, Q111); one knight is allowed (Q112, Q113). Strong → mighty only with the Fortress. Mighty can't be promoted.                                                                |

#### Politics (blue, 18)

| Card (6e)                   | #   | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bishop** (Taxation)       | 2   | Move the robber (normal rules, **only after the first attack**), then steal **1 random card from every player** with a settlement or city adjacent to the new hex (one card per player even with several buildings, Q74). A hex with no adjacent building is legal (Q75). Pirate not movable with it (Q63).                                                                                                                                                                                                                                                                                                                                                            |
| **Constitution**            | 1   | **1 VP**, revealed at once, not stealable, not in hand limit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Deserter** (Treason)      | 2   | Choose an opponent; **they choose** one of their knights to remove (Q87) and it returns to their supply. You may then place one of your own knights of **the same level** (any status of the removed one: yours gets the same active/inactive status), by normal placement rules (a free intersection on your route; may be the very spot, Q86); the card is playable even if you can't place (Q85). If you have no such level left in supply you may place a **basic** one instead; if you can't place any, nothing (the victim still removes one, Q82). A mighty may be placed without the Fortress (Q84). An active deserted knight may act at once (Q83).          |
| **Diplomat** (Diplomacy)    | 2   | Remove an **open** road: one with no building, knight (same colour) at one end, i.e. a chain end that dead-ends. Opponent's road goes back to its owner and nothing is placed. Own road: **you may place it again** immediately elsewhere for free (normal placement), or not. Interrupting a continuous road by an enemy piece does **not** open it (Q89). You can't remove a road that would leave a knight unconnected to a settlement/city (Q90) but may orphan a settlement/city (Q91). Longest Road is not lost while moving if the road stays at least as long (Q88). With ships, ships follow the same rule and you may only replace a removed ship by a ship. |
| **Intrigue**                | 2   | **Displace an opponent's knight without using one of yours.** The target must stand on an intersection touched by one of your roads/ships. It moves per §4.2 (or is removed if it can't). You need no knights. Afterwards you may build or move into the freed spot as usual.                                                                                                                                                                                                                                                                                                                                                                                          |
| **Saboteur** (Sabotage)     | 2   | Every **other** player with **as many or more VP** than you discards half (rounded down) of their cards (resources and commodities; they choose) to the bank. Compare public VP at the time of playing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Spy** (Espionage)         | 3   | Look at another player's progress hand, take **1** card (not VP cards, which are never in hands) into yours; if it is a Spy you may play it at once. Subject to the 4-card limit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Warlord** (Encouragement) | 2   | **Activate all your knights for free.** (Knights activated this way cannot act this turn, as normal; a knight that already acted may be activated.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Wedding**                 | 2   | Each player with **strictly more VP** than you gives you **2 cards** of their choice (resource and/or commodity); with 1 card they give 1, with 0 nothing. Equal or fewer VP: unaffected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

#### Trade (yellow, 18)

| Card (6e)                        | #   | Effect                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Commercial Harbor**            | 2   | For **each other player once** this turn: offer them **1 resource** from your hand; they must give back **1 commodity of their choice**; a player with no commodity returns your resource (trade void; the card is not refunded, Q76). You choose which resource (Q78); the victim chooses which commodity (Q77). May be done at any moment of the turn you play it. |
| **Master Merchant** (Guild Dues) | 2   | Pick a player with **strictly more VP** than you; look at their resource/commodity hand and take **any 2 cards**. No defence. If they hold fewer, take what they have.                                                                                                                                                                                               |
| **Merchant**                     | 6   | §4.5. Gives control of the merchant figure, 1 VP and the 2:1 rate on the hex's resource.                                                                                                                                                                                                                                                                             |
| **Merchant Fleet**               | 2   | Choose one resource **or** commodity type; for the rest of the turn you may make **any number of trades with the bank at 2:1 where you give 2 of that type** for 1 card of any other type (Q109), commodities and resources both allowed.                                                                                                                            |
| **Resource Monopoly**            | 4   | Name a resource; every other player gives you **2** of it (1 if they only have 1, 0 if none). No refund if nobody has any (Q115).                                                                                                                                                                                                                                    |
| **Trade Monopoly**               | 2   | Name a commodity; every other player gives you **1** of it if they have one.                                                                                                                                                                                                                                                                                         |

Deck check: science 2+2+1+2+2+2+2+1+2+2 = 18; politics 2+1+2+2+2+2+3+2+2 = 18; trade 2+2+6+2+4+2 = 18;
total 54. The only progress cards that score are Printer, Constitution (1 VP each, 2 in the game) and
the Merchant (1 VP while controlled).

**6th-ed wording differences that matter:** Medicine costs 1 grain + 2 ore in both editions. Taxation
may only be played after the first attack. Treason: your placed knight may be "same strength or lower".
Diplomacy's "open" test is "one end not next to one of your roads or buildings, and the road is not part
of a route joining two of your buildings/knights". These agree with the 5th-ed rulings above.

---

## 5. Victory conditions and scoring

**Win:** first player with **13 or more VP at any moment of their own turn** wins at once (S5 p.12;
S6 p.12). A player cannot win on someone else's turn. 5-6 players: also 13; no win during a special
build phase (BASE 16.10g). With Seafarers (6th ed) add 2 to the scenario's target.

| Source                 | VP     | Notes                                                                                                                               |
| ---------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Settlement             | 1      | A pillaged city counts 1.                                                                                                           |
| City                   | 2      |                                                                                                                                     |
| Metropolis             | +2     | Moves with the metropolis (§4.4). City + metropolis = 4.                                                                            |
| Longest Road           | 2      | 5+ road pieces, strictly longer than the holder's; knights of other players (active or not) break roads (FAQ Q56). No Largest Army. |
| Defender of Catan card | 1 each | Permanent (cannot be lost or stolen).                                                                                               |
| Printer (Printing)     | 1      | Permanent.                                                                                                                          |
| Constitution           | 1      | Permanent.                                                                                                                          |
| Merchant control       | 1      | Lost when another Merchant card is played.                                                                                          |
| Hidden VP              | none   | All VP is public in C&K, so Saboteur/Wedding/Master Merchant comparisons use public VP.                                             |

A player who is at 13 or more through an event on another player's turn (say a Defender card) waits
and wins only when their own turn comes, **unless** their VP drops below 13 meanwhile.

---

## 6. Edge cases and official rulings (numbered)

Each ruling cites the source; "FAQ Qn" numbers are catan.com's. Rulings **made by us** are marked (ours).

### 6.1 Setup and turn structure

- **CK-1** Setup round 2 places a **city**, not a settlement, and pays 1 card per adjacent hex with
  **no commodities** (S5 p.4).
- **CK-2** First turn goes to the player who placed the last city, which is the round-1 starter in
  both editions' effect (S5 p.5; S6 p.5). Our `startingPlayer` already fits.
- **CK-3** Trading/building/knight actions/progress cards (but Alchemist) only after the roll (FAQ
  Q57, Q95, Q99, Q121). No "pre-roll" Knight like base unless the Knight-Errant variant is on.
- **CK-4** Trades, builds, knight actions and progress cards may be done in any order and repeated
  (FAQ Q122; S5 p.6).
- **CK-5** After losing a city mid-turn on the attack roll, production that same turn is for a settlement
  (FAQ Q13).

### 6.2 Barbarians and knights

- **CK-10** All active knights of all players defend, whether or not their owner has a city (FAQ Q7,
  Q8; S5 p.11).
- **CK-11** All knights deactivate after every attack, win or lose (FAQ Q1). Nasty variant: only
  committed ones.
- **CK-12** Knights cannot be activated "in response" to the ship arriving (FAQ Q4).
- **CK-13** A knight can't be weakened for the battle (FAQ Q3).
- **CK-14** Barbarian strength = number of cities on the board (metropolis cities once) (FAQ Q2; S5 p.11
  example).
- **CK-15** City walls do not protect cities (FAQ Q12, Q27).
- **CK-16** Lowest contribution loses; if that player can't lose a city, the next lowest loses one
  (FAQ Q14). Tied lowest: **each** loses one (S5 p.11).
- **CK-17** Metropolis-only and city-less players are never pillaged and are skipped (S5 p.11).
- **CK-18** The victim chooses which city (FAQ Q16).
- **CK-19** With no settlement piece available, a city lies on its side and counts as a settlement
  (FAQ Q15).
- **CK-20** Event die: ship face = ship moves; gate face = progress draws. Exactly one per roll.
- **CK-21** After a ship move that is not yet the 7th step nothing else happens.
- **CK-22** Barbarians reset to 0 after every attack regardless of result (FAQ Q11; S5 p.11).
- **CK-23** Defender VP card: highest total only; tie → nobody scores, each tied player draws a progress
  card of a stack of their choice, clockwise from the roller (S5 p.11; FAQ Q9: a drawn VP card stays).
  Cards run out → use any marker (FAQ Q6).
- **CK-24** A losing last city keeps improvements, progress cards and abilities (FAQ Q10, Q17).
- **CK-25** Knights must be connected to one of their own settlements/cities via own roads; no
  action may break this (FAQ Q90; with ships S5 p.13).
- **CK-26** The displaced knight may land on the attacker's former spot if both players' roads touch
  it (FAQ Q43); it may not go to an unconnected spot (Q44).
- **CK-27** A strong knight moved by a Move action cannot displace in the same action; displacing is a
  separate action performed on your own turn only (FAQ Q37).
- **CK-28** A knight can be promoted right after being recruited (FAQ Q53), and a promoted knight
  acts if it was activated earlier (FAQ Q48); promotion doesn't change its status (FAQ Q39).
- **CK-29** Knights block roads, can't be passed (FAQ Q51, Q117), break Longest Road even when inactive
  (FAQ Q38, Q56) and own roads between two enemy knights stay (FAQ Q116).
- **CK-30** Before the first attack: no robber move at all (7, Bishop, knight), no steal on 7, but
  discarding applies (S5 p.5; S6 p.6). After it: the robber is active from then on (FAQ Q119: same turn
  as the attack is fine).
- **CK-31** A robber can be placed next to an active knight (FAQ Q120); the robber is **not** blocked by knights.
- **CK-32** A strong knight can be recruited directly for 2 wool + 2 ore if a basic one is in supply
  (FAQ Q47), i.e. recruit then promote the same turn.
- **CK-33** (ours, UNCLEAR) Zero barbarian strength (no cities) or zero defender strength with
  nobody active: if defenders ≥ barbarians and the highest knight total is 0, **no one** is Defender
  and the tie reward is not given (nobody contributed). FAQ Q7 only says the barbarians can be beaten
  with no city.

### 6.3 Improvements, metropolises, commodities, walls

- **CK-40** Each improvement level costs its level number in the track's commodity (§1.3); Crane −1,
  level 1 can become free.
- **CK-41** You may buy several improvements per turn (FAQ Q19) and ignore the event die colour (Q18).
- **CK-42** Level-3 abilities persist at levels 4–5 and after losing all cities (FAQ Q17, Q20).
- **CK-43** You can't recover a metropolis stolen from you (FAQ Q22) but you may keep improving (Q25).
- **CK-44** You may not own two metropolises on the same city (FAQ Q26). A metropolis over a walled
  city keeps the wall (FAQ Q30).
- **CK-45** Robbers and thieves treat metropolis owners like anyone (FAQ Q23). They steal commodities
  like resources (FAQ Q28, Q31, Q34); commodities may be discarded on a 7 (Q33).
- **CK-46** A commodity city always yields exactly 1 resource + 1 commodity; no alternative (FAQ Q32, Q35).
- **CK-47** Commodities can be traded 3:1 at a generic harbor (FAQ Q36). 2:1 specific harbors apply
  to their resource only (S5 p.7).
- **CK-48** Walls add 2 to the 7-limit each (S5 p.6); example: 2 walled cities → 11 cards safe.
- **CK-49** Merchant VP is lost when an opponent plays a Merchant (FAQ Q58); the 2:1 applies to the
  owner only (Q59); the robber doesn't affect it (Q60).
- **CK-50** The robber's tricks cannot target progress cards (S5 p.9), only the Spy/Master Merchant
  rules above.
- **CK-51** Progress hand max 4; 5th card discarded immediately out of turn, by end of turn on your own
  (FAQ Q102; S5 p.9); you may look at it first (Q96); played cards go under their stack (Q103–Q104).
- **CK-52** (ours, UNCLEAR) The "need a city where you could put a metropolis" purchase condition for
  level 4/5: apply it **only when the purchase would actually award a metropolis** (first to level 4;
  taking one with level 5). Literal reading: always for L4/L5. See §10 Q3.
- **CK-53** Progress cards "that cannot have an effect" may not be played if you can know in advance
  (FAQ Q98); unknowable cases (monopolies, Spy) can (Q98, Q115).

### 6.4 Progress-card rulings (FAQ)

- **CK-54** Alchemist: dice can be set to 7; you can't skip production; the event die is still rolled; only
  one of Alchemist or physical numbered dice (FAQ Q67–Q72).
- **CK-55** Bishop steals from the players next to the **new** robber hex, only one card per player
  (Q73–Q74). Placed on a hex with nobody: fine (Q75).
- **CK-56** Cranes: one per improvement, level 1 free (Q79–Q81).
- **CK-57** Deserter: victim chooses; if the victim picks a level you can't place, you place basic or
  nothing; mighty without Fortress is fine; may place in the same spot; usable at once if it was active
  (Q82–Q87).
- **CK-58** Diplomat: Q88–Q94 as in the card table. An interruption doesn't open a road (Q89).
- **CK-59** Inventor can swap the token under the robber; robber stays (Q105–Q107).
- **CK-60** Smith: two cards in one turn need different knights; one knight is fine (Q111–Q113).
- **CK-61** Spy can't take VP cards (Q114). Saboteur: each affected player picks the cards (Q110).
- **CK-62** Merchant Fleet: pick a type, then pay 2 of it per card taken (Q109).
- **CK-63** Commercial Harbor: you choose the resource, the victim the commodity; no refund of the card
  (Q76–Q78).
- **CK-64** Monopolies don't give the card back if nobody has any (Q115). A play that has no effect for
  a reason you couldn't know is still played.

---

## 7. Interactions with changed base rules

| Base rule                                                    | In C&K                                                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development cards, Largest Army                              | **Gone.** Progress cards instead; no Largest Army; knights give no army VP.                                                                                   |
| Knight dev cards / Year of Plenty / Monopoly / Road Building | Replaced by Knight actions (§4.2), Mining/Irrigation, Trade/Resource Monopoly, Road Building (progress).                                                      |
| Robber on a 7                                                | Inert until the first barbarian attack; knights can chase it away (no strength needed, deactivates).                                                          |
| Discard on a 7                                               | Counts resources **and** commodities; limit 7 + 2 per wall; progress cards exempt.                                                                            |
| Steal                                                        | Steals a random resource **or commodity** card.                                                                                                               |
| Production                                                   | Cities give resource + commodity on forest/pasture/mountains; 2 cards on fields/hills; Aqueduct on a no-card roll (not 7).                                    |
| Bank trading                                                 | Commodities tradable, commodity-for-resource both ways; Trade L3 and Merchant add 2:1; harbors per §3.7.                                                      |
| Longest Road                                                 | Opponent knights (any status) break roads; only 5+ roads qualify; 2 VP.                                                                                       |
| Building                                                     | Knights block settlement spots and road extension; knights ignore the distance rule; own knights must be moved before building on their spot.                 |
| Cities                                                       | A pillage can reduce them to settlements; a pillaged city's wall is lost. Metropolis cities are immune.                                                       |
| Winning points                                               | 13, not 10.                                                                                                                                                   |
| Dice                                                         | Yellow + red for production; red alone for progress; event die for ships/gates. Balanced dice (BASE setting) can keep applying to the two numbered dice only. |
| Setup                                                        | 2nd round is a city; start resources are 1 per adjacent hex.                                                                                                  |
| Special building phase                                       | See §8.                                                                                                                                                       |

---

## 8. Official combinations

### 8.1 5-6 players (E56 2020; E56P 2023)

- **Board:** the base 5-6 board (BASE §16) with the barbarian tile beside it; robber on **either**
  desert (E56 p.2). No new hexes, harbors, or progress cards. Extra pieces in §1.2.
- **Supply:** commodities 18 each; Defender cards 8; 6 colours, 6 flip-charts.
- **2020 rules — Special Build Phase (SBP),** E56 p.2–3: after your turn, every other player in
  clockwise order starting with the one to your left may build; they may **build roads, settlements,
  cities, knights, city walls, city improvements** and **activate or promote** knights. They may
  **not** trade (players or bank), play progress cards or take knight actions (move, displace,
  chase). Dev cards cannot be bought (no dev cards in C&K). A knight activated in an SBP may act on its
  owner's next turn, since "the knight may not act on the turn it was activated" and the SBP is not
  its turn (E56 p.3 example). Our BASE SBP already can't win (BASE 16.10g).
- **2023 rules — Paired Players,** E56P p.3 (rules text for the pair order itself are in the base
  5-6 2023 booklet, BASE §16.D): player 1 rolls and may trade with everyone; **player 2 does not
  roll**, may trade **with the bank only**, and both may build, buy improvements, play progress cards
  and perform knight actions. A knight can be activated in the player-2 turn and acts on its owner's next
  turn.
- **Which one to implement:** the engine already has the SBP (BASE §16.10); C&K with 5-6 players should
  reuse it with the C&K allowances above. Paired players can be a later option (BASE §16.D).

### 8.2 Seafarers (S5 p.13; S6 Seafarers section; PROD)

Official variant (PROD says C&K is also compatible with Seafarers and Traders & Barbarians; **no
official rules for the Traders & Barbarians mix were found**):

- All C&K rules for roads apply to ships.
- Barbarians attack **all islands at once**; count every city and knight of all islands.
- Knights move across sea along a continuous road+ship route, and may end on an intersection of
  sea hexes if a line of ships leads there (a knight can't be _recruited_ on sea). A knight is considered on
  the adjacent ship; ships can't be moved if that would break the knight's link to a settlement/city.
- A knight on a sea intersection can chase away the **pirate**; Taxation/Bishop moves the robber only (6th).
- Pirate inert until the first attack (6th). Road Building: roads and/or ships (§4.6).
- Gold fields produce **resources only, never commodities**; the merchant can't go on a gold hex (6th).
- Best with scenarios that have no fog and few small islands. 6th ed: +2 VP to the scenario target.

### 8.3 Other

- Not found: any official rule for C&K with Traders & Barbarians (only PROD's one-line compatibility),
  or a 7-8 player C&K.

---

## 9. Implementation notes for our engine

This section is advice for the framework agent and later engine agents; none of it is implemented.
Names are suggestions that follow `types.ts`/ARCHITECTURE.md conventions.

### 9.1 New state

```ts
type Commodity = 'paper' | 'cloth' | 'coin';
type Track = 'trade' | 'politics' | 'science'; // gate colours: yellow, blue, green
type KnightLevel = 1 | 2 | 3;

interface Knight {
  owner: PlayerId;
  vertex: VertexId;
  level: KnightLevel;
  active: boolean;
  /** activated this turn */ activatedTurn?: number;
}

interface CKPlayer {
  // add to Player
  commodities: Record<Commodity, number>;
  improvements: Record<Track, 0 | 1 | 2 | 3 | 4 | 5>;
  progress: ProgressCardType[]; // hidden, max 4 (+1 transient); VP cards go to progressCardsPlayed/table
  defenderCards: number; // VP
  knightPromotedThisTurn: VertexId[]; // reset at endTurn (once per turn per knight)
}
interface CKState {
  // add to GameState (null when the expansion is off)
  knights: Knight[]; // or keyed by VertexId (an intersection holds ≤1 knight)
  walls: VertexId[]; // cities with a wall; pillage removes
  metropolis: Record<Track, { owner: PlayerId; vertex: VertexId } | null>;
  barbarian: { position: number }; // 0..7
  attacksResolved: number; // robber active iff ≥ 1
  merchant: { hex: HexId; owner: PlayerId } | null;
  progressDecks: Record<Track, ProgressCardType[]>; // top = pop(); played/discarded go to the bottom (unshift)
  commodityBank: Record<Commodity, number>; // 12 (18 in 5-6)
  event: 'ship' | Track | null; // last event die
  /** pillaged-city-on-its-side bookkeeping when settlements are exhausted */
  pillaged: VertexId[];
}
```

- `dice: [yellow, red]` must be ordered; add `eventDie`. Alchemist sets both numbered dice.
- `settings.expansions: { citiesKnights?: { variants: ('easyStart'|'knightErrant'|'nasty')[] } }`,
  `vpToWin` default 13, `discardLimit` 7 (+2 per wall computed), `specialBuildPhase` for 5-6.
- `schemaVersion` bump + `migrate.ts`; clone/serialization must stay JSON-safe (use arrays/objects,
  not Maps).
- Piece counts: `piecesLeft` needs knights per level, walls, metropolis availability.
- Supply: `bankPerResource` stays; add commodity bank.

### 9.2 New board features

None geometric. The barbarian track is a counter, not hexes. No fog, rivers or sea hexes. Reuse
existing frames. A knight sits on a **vertex**; adjacency to the robber hex is vertex→hex.
Needed topology queries: "vertices of hex" (exists), "own route reachability from a vertex" (BFS
over own edges, passing own pieces, blocked by foreign pieces), "edges at vertex". With Seafarers
later, the same BFS covers ships.

### 9.3 Phases and actions

Pre-roll phase gains `playAlchemist{red,yellow}`. New phases (each keeps `resume`):

| Phase/step         | Who acts                                  | Notes                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `barbarianPillage` | each loser, in turn order from the roller | choose city (skip if only one candidate).                                                                                                                                                                                                                                                                                        |
| `defenderTieDraw`  | each tied player in order                 | choose a stack.                                                                                                                                                                                                                                                                                                                  |
| `progressDiscard`  | a player at 5 cards (maybe out of turn)   | allowed any time they are "pending"; the engine must accept an out-of-turn action only in this phase.                                                                                                                                                                                                                            |
| `knightRelocate`   | displaced player                          | choose destination or auto-remove if none.                                                                                                                                                                                                                                                                                       |
| Card sub-phases    | the card's player or a victim             | Deserter (victim picks knight, then placement), Saboteur (victims discard), Wedding (victims give), Master Merchant (take 2), Spy (take 1), Commercial Harbor (per-player), Diplomat (road then replace), Inventor (2 hexes), Road Building (reuse), Bishop (reuse `moveRobber`+multi steal), Smith (≤2 promotions), Monopolies. |

New actions: `buildKnight`, `activateKnight`, `promoteKnight`, `moveKnight`, `displaceKnight`,
`chaseRobber`, `buildCityWall`, `buyImprovement{track}`, `playProgress{card, ...args}` (one per card, or
a tagged union), `pillageChoice`, `discardProgress`, `defenderDraw`, `commodityTrade`/extend
`bankTrade` to commodities. `bankTrade` currently takes one `Resource`; make the ratio a function of
the **given** type: `ratioFor(player, type)` combining 4:1, harbors, Trade L3 (commodities only), Merchant
(resource of its hex), Merchant Fleet (turn flag).

`legalActions` must enumerate: knight placements (empty vertices touched by own roads), moves
(BFS), displacements, chase targets, improvement purchases (with Crane flag), metropolis placements.
Progress-card plays with hidden info: `legalActions(state)` for the current player only reveals own
cards.

Order inside `rollDice`: roll three dice → event → (ship step → maybe attack → pillage prompts) |
(gate → draws) → production unless 7 → discard/robber (inert before first attack).

### 9.4 Cost helpers (single source of truth in `constants.ts`)

`KNIGHT_RECRUIT = {wool:1, ore:1}`, `KNIGHT_PROMOTE = {wool:1, ore:1}`, `KNIGHT_ACTIVATE = {grain:1}`,
`CITY_WALL = {brick:2}`, `IMPROVEMENT_COST(level) = level` of `TRACK_COMMODITY[track]`
(trade→cloth, politics→coin, science→paper), `MEDICINE_COST = {ore:2, grain:1}`,
`HAND_LIMIT = 7 + 2*walls`, `WIN_VP = 13`, `BARBARIAN_STEPS = 7`, `PROGRESS_HAND_MAX = 4`,
`RED_DIE_SET(level) = 1..level+1` (levels 3–5 derived, §1.3), `METROPOLIS_VP = 2`.

### 9.5 Victory and awards

`victoryPoints(state, p)` = settlements + 2·cities + 2·metropolises + 2·longestRoad + defenderCards +
printer + constitution + merchant. Remove Largest Army and dev-card VP when the expansion is on. Longest
Road must treat **every** knight of another player as a blocker (like a building); its tests
exist in `longestRoad.test.ts`.

### 9.6 HUD

- Per player: VP (broken down), cards in hand (resources + commodities by type), progress cards
  (own: card faces; others: only count), improvements on three tracks (level, next cost, red-die
  set, unlocked ability), metropolis owner badges, walls, knights list with level/active, Defender
  cards.
- Board: knights on vertices (level + active), walls and metropolis on cities, merchant, robber
  with an "inert until barbarians land" marker.
- Barbarian track with 7 steps and the current position; the strength preview (cities vs active
  knights) with per-player contribution bars; who would be pillaged.
- Event die and red die results with the "you draw a green card" prompt; progress hand limit
  prompts; discard-on-7 modal with the wall-aware limit.
- Disabled-button reasons: "need a city", "no Fortress", "knight activated this turn", "no basic knight
  in supply", "not reachable", etc.

### 9.7 Bots

- Random bot: must choose from `legalActions` including the new sub-phase choices; ensure no
  infinite loop on activate/deactivate (no deactivate action exists, good).
- Heuristic hooks: track `barbarian.position`; at position ≥ 5 raise active knight strength to at
  least cities − (largest rival contribution); don't leave the weakest contribution (lowest knights)
  while holding a pillageable city; recruit/activate knights before the 7th ship; buy Aqueduct early
  if on poor numbers; hold progress cards, play VP-cards at once (forced).
- Simulator: count attacks, pillages, Defender awards per game to catch rule bugs.

### 9.8 Suggested tests (one per rule where possible)

1. Setup: round-2 piece is a city; start cards one per hex, no commodities.
2. City on forest/pasture/mountains yields resource + commodity; on fields/hills 2 cards; settlement 1.
3. Commodity bank shortage (12): single owed player gets remainder; two owed players get none.
4. Hand limit with 0–3 walls (7/9/11/13), commodities counted, progress cards not.
5. 7 before first attack: discard happens, robber not moved, no steal; Bishop and knight chase rejected.
6. 7 after first attack: robber moves, steals a commodity possible.
7. Event die: exactly one of ship/gate; ship increments; 7th ship triggers attack; reset to 0.
8. Attack: strength = cities (metropolis city once); defenders ≥ wins (equal is a win).
9. Pillage: lowest contribution loses a city of their choice; ties each lose one; no-city and
   metropolis-only players skipped; walled city loses wall; no-settlement-piece city on its side.
10. Defender VP: single highest gets a card; tie → no VP, each tied draws from a stack of choice
    clockwise from the roller; VP card kept face up.
11. Knights all inactive after attack; inactive knights contribute 0.
12. Recruit cost/placement (own-road vertex, no distance rule, empty), inactive, 2 per level cap.
13. Activate cost; activated-this-turn knight cannot act; act-then-activate allowed.
14. Promote cost, once per knight per turn, status preserved, mighty needs Fortress.
15. Move: route BFS passes own pieces, blocked by foreign pieces; just-built road usable.
16. Displace: only strictly weaker, own turn, victim relocation connected, removal if none.
17. Chase robber: adjacency, any strength, steal, inactive afterwards, not before first attack.
18. Knight blocks road building/settlement, breaks Longest Road even if inactive.
19. Improvements: cost = level, level skip rejected, needs ≥ 1 city, persists after last city lost.
20. Red die eligibility: level 1 {1,2}, level 2 {1,2,3}, draw order from roller clockwise.
21. Progress hand: 5th card discarded out of turn at once; own turn by turn end; VP cards exempt.
22. Metropolis: first L4 takes it, L4 by a second player gets nothing; L5 steals it; L5 owner immune;
    needs a free city; immune to pillage; +2 VP moves with it.
23. Level-3 abilities: Trade 2:1 commodities (own turn, not resources), Fortress, Aqueduct (not on 7,
    only when zero cards).
24. Each progress card: one test of the base effect plus its listed edge cases (§4.6, §6.4), incl.
    Alchemist-then-event-die, Medicine cost, Smith twice on two knights, Deserter fallbacks, Diplomat
    open-road, Wedding/Saboteur/Master Merchant VP comparisons, Merchant VP transfer, Merchant Fleet.
25. VP total at 13 on own turn only; Defender gained on the attack roll can win immediately.
26. Merchant: 2:1 only for owner, even under the robber, VP transfer on replay.
27. 5-6: SBP allows build/improve/activate/promote, forbids trade/cards/knight actions; no win in SBP.
28. Serialization round-trip of the full CK state; deterministic replays with the seeded RNG
    (deck shuffles for three progress decks + event die go through the same RNG).

---

## 10. Open questions and recommended interpretations

| #   | Question                                                                                        | Evidence                                                                                                     | Recommendation                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Red-die sets for improvement levels 3–5                                                         | Levels 1–2 confirmed; the rest implied by "two, then three, and so on" (S5 p.9)                              | {1..level+1}; make the table data (`RED_DIE_SET`) so it can be corrected. Check against a physical flip-chart if any exists.                                           |
| Q2  | Number of barbarian steps: 7 ship faces vs 6                                                    | BGA says 7th space; art count is start + 6 + landing                                                         | 7 faces, a constant `BARBARIAN_STEPS`.                                                                                                                                 |
| Q3  | Level 4/5 purchase needs a free city: always, or only when you'd gain a metropolis?             | S5 p.8 "unless you have a city where you could build a metropolis", S6 "you may not purchase level 4 (or 5)" | Literal for gaining cases; for a level-4 in an already-taken colour, or an L5 on your own metropolis, allow (the rule's purpose is placement). Flag it in the UI text. |
| Q4  | Aqueduct: does "no resources or commodities" include a production blocked by the robber, and 7? | S5 p.8, S6 aqueduct ("no production", not on a 7)                                                            | Yes: any roll except 7 where the player received 0 cards. A bank shortage that gave them 0 cards also qualifies.                                                       |
| Q5  | Both sides zero strength                                                                        | FAQ Q7 allows winning with no cities; nothing on "0 vs 0"                                                    | Defenders win ties; nobody earns a Defender card or tie draws when the top contribution is 0 (CK-33).                                                                  |
| Q6  | Moving an own knight off an intersection to build a settlement requires an _active_ knight?     | S5 p.10 says "first move the knight"; moving needs an active knight                                          | Disallow building on an occupied vertex; user must perform a normal Move action first (needs active, non-fresh knight).                                                |
| Q7  | Can a displaced knight's relocation use the attacker's vacated spot?                            | FAQ Q43 yes when both route sets connect it                                                                  | Yes.                                                                                                                                                                   |
| Q8  | Commercial Harbor: atomic vs spread over the turn                                               | Card text allows "any point during the turn", once per player                                                | Resolve atomically at play time: ask each opponent in order; a simpler UI and the same outcomes except for timing tricks.                                              |
| Q9  | Which edition's improvement names                                                               | D3                                                                                                           | Use the 6th-ed names in the UI (current, consistent) and keep ids `trade1..5` etc.; the engine uses track+level only.                                                  |
| Q10 | Metropolis stealing when the thief has no free city                                             | Same sentence as Q3                                                                                          | A player at level 4 who is first can't take one without a free city; they keep the level.                                                                              |
| Q11 | Progress card draw when a stack is empty and a player is eligible                               | FAQ Q101                                                                                                     | Draw in order until empty; the rest get nothing.                                                                                                                       |
| Q12 | Merchant on a hex not adjacent to any of the player's buildings later (after loss of buildings) | Not covered                                                                                                  | Control and benefits continue (the figure never moves except via another Merchant card).                                                                               |
| Q13 | Pillaged-on-its-side city (6th ed "upgrade first")                                              | FAQ Q15 vs S6 p.11                                                                                           | Model as `pillaged` flag: counts 1 VP, settlement production; must be the next settlement upgraded.                                                                    |
| Q14 | Seafarers/Traders & Barbarians                                                                  | PROD only                                                                                                    | Out of scope for now; design the knight route BFS so ships can be added.                                                                                               |
| Q15 | 7-8 player C&K                                                                                  | No official rules                                                                                            | Unsupported.                                                                                                                                                           |
| Q16 | Knight-Errant vs FAQ Q57/Q121                                                                   | The variant is optional (S5 p.13)                                                                            | Default off; the variant lets an active knight chase the robber pre-roll.                                                                                              |

---

## Appendix A: card name map (5th → 6th)

Alchemist→Alchemy · Crane→Crane · Engineer→Engineering · Inventor→Invention · Irrigation→Irrigation ·
Medicine→Medicine · Mining→Mining · Printer→Printing · Road Building→Road Building · Smith→Smithing ·
Bishop→Taxation · Constitution→Constitution · Deserter→Treason · Diplomat→Diplomacy ·
Intrigue→Intrigue · Saboteur→Sabotage · Spy→Espionage · Warlord→Encouragement · Wedding→Wedding ·
Commercial Harbor→Commercial Harbor · Master Merchant→Guild Dues · Merchant→Merchant ·
Merchant Fleet→Merchant Fleet · Resource Monopoly→Resource Monopoly · Trade Monopoly→Trade Monopoly.
Counts and effects match in both editions.

## Appendix B: things we could not verify

- Exact harbor positions on the fixed beginner map (§2.2).
- Red-die sets for levels 3–5 (§1.3).
- Level-5 improvement names in the 5th edition (cosmetic).
- Whether the barbarian track has 6 or 7 steps in practice (§3.3, §10).
- Official C&K + Traders & Barbarians rules, and any 7-8 player C&K rules (not found).
