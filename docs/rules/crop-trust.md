# Catan Scenario: Crop Trust: rules, sources and engine status

Module: `src/expansions/crop` (id `crop`, mode `crop`, scenarios `crop/cropTrust` = the first-game
layout, `crop/cropTrustVariable` = the variable setup). 3-4 players, 10 VP. Base game only; no 5-6
version exists (catan.com) and no combination is official (`scenarios-and-combos.md` part B/C).

Status key: **done** = implemented and tested, **assumed** = unclear, we chose (see below),
**gap** = not implemented.

## Sources

- S1. _Catan Scenario: Crop Trust_ rules + almanac (Klaus & Benjamin Teuber with the Crop Trust,
  Catan Studio, 2018), https://www.catan.com/sites/default/files/2021-06/catan-crop_trust_rulesalmanaceng_180705xs.pdf.
  Rules pages read from the PDF text layer; the board and token diagrams are images.
- S2. https://www.catan.com/crop-trust.
- Longer notes: `docs/rules/scenarios-and-combos.md` Part B.

## Rules and engine status

| #   | Rule (S1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Status                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 1   | Desert replaced by a fifth fields hex (+ a third "9"); the robber starts on the pasture "2". Grain cards are "food". (p3-4)                                                                                                                                                                                                                                                                                                                                                          | done (`crop/first19`)                                                             |
| 2   | 90 crop tokens, 18 of each of beans, maize, quinoa, rice, wheat. Crops start on every fields hex by its number: 2/12: 1 quinoa; 3/11: +1 maize; 4/10: +1 wheat; 5/9: +1 beans; 6/8: one of each. (p8)                                                                                                                                                                                                                                                                                | done (also used for the first-game board, whose diagram is an image: **assumed**) |
| 3   | Variable setup: shuffled terrain on the printed number layout (8 10 2 / 11 9 8 3 / 9 5 12 9 6 / 10 3 6 11 / 4 5 4). (p8)                                                                                                                                                                                                                                                                                                                                                             | done (`crop/random19`; robber on the "2" hex)                                     |
| 4   | Seed vaults: each player has 2 vault spaces; one holds 4 crop tokens. Starting player: rice, then clockwise beans, wheat, maize (variable setup rule; the first game assigns by colour: Red rice, White beans, Orange maize, Blue quinoa). (p3, p8)                                                                                                                                                                                                                                  | done (the variable-setup rule is used for both, **assumed**)                      |
| 5   | 41 event tokens: each player puts 7 under their 3 unbuilt settlements and 4 unbuilt cities; 1 on Longest Road, 1 on Largest Army; the rest are the face-down stack. 3 players: one colour set aside (tokens only dealt to players). (p3)                                                                                                                                                                                                                                             | done                                                                              |
| 6   | **Harvest:** a fields hex does not pay grain. On its number, in player order from the roller, each player with a building there may remove 1 crop token of their choice for 1 food card; a city harvests a 2nd time. Stops when the hex is empty. The robber blocks it. (p4-5)                                                                                                                                                                                                       | done (`crop/harvest`, `crop/skipHarvest`, multi-actor phase)                      |
| 7   | **Seed deposit**, once a turn: pay 1 lumber + 1 ore; take 1 crop token from a fields hex next to your building onto your Crop Storage Record (1 per species per row, any row); the 2nd token of a row gives a free development card, the 3rd/4th/5th 1 VP each; fill your empty vault space with 4 tokens of that species; replant the 4 tokens of the other space on 4 different fields hexes (max 7 per hex, extra tokens return to the supply). The robber does not stop it. (p6) | done (`crop/deposit`, `crop/plant`)                                               |
| 8   | **Event tokens:** building a settlement or city reveals the token under that piece (a city then puts a fresh token under the returned settlement piece); taking Longest Road or Largest Army reveals the card's token (new token drawn for the card). (p7)                                                                                                                                                                                                                           | done (`afterAction`)                                                              |
| 9   | Event kinds: regional loss (all crops of a species on hexes with the shown numbers), small / large loss (2 / 3 crops of a species, hexes next to your buildings first), monoculture (every single-species fields hex is emptied). (p11)                                                                                                                                                                                                                                              | done; see "Event token counts" and "Loss choice" below                            |
| 10  | Extinction: a species with no token on the board or in a vault is extinct; its supply returns to the box; an event of an extinct species goes back to the box and another is drawn. When the stack is empty the used tokens are reshuffled. (p10)                                                                                                                                                                                                                                    | done                                                                              |
| 11  | The game ends when a player has 10 VP on their turn, **or** 3 of the 5 fields hexes have no crops, **or** 2 species are extinct. With 10 VP reached by building, the event is revealed first and a collapse takes precedence. (p8)                                                                                                                                                                                                                                                   | done                                                                              |
| 12  | Collapse winner: most crop tokens on the Crop Storage Record; ties: most VP; still tied: both win. The player whose **harvest** causes the collapse loses (the next most wins); a player who reached 10 VP by building and then reveals a collapsing event can still win with the most crops. (p8)                                                                                                                                                                                   | done (a full tie is shown as one winner, see "Uncertain")                         |

## Uncertain rules and what the engine does

1. **Event token counts.** S1 gives only "41 tokens in 4 categories"; the per-category numbers and
   the number sets on the regional-loss tokens are in the artwork. We use 15 regional (3 per species,
   number groups {2,3,11,12}, {4,5,9,10}, {5,6,8,9}), 10 small, 10 large and 6 monoculture. **assumed**
2. **Loss choice.** The text says to take small/large losses "starting with hexes next to your
   buildings", leaving the choice of hex to the player. The engine picks the adjacent hex with the most
   of that species (ties: hex id), then the other hexes the same way. **assumed**
3. **Row choice** in the seed deposit: the text says the first token goes on the green space of the
   top row and then along the arrows; the player aid says "top row or bottom row, your choice". The
   engine lets you pick the row each time (1 token per species per row). **assumed**
4. **First-game layout.** Starting settlements, roads and exact crop tokens are shown only in the
   diagram; the engine uses the normal setup placement and the by-number crop rule. **assumed**
5. **Which crop is the deposit's token when several hexes have it:** the player picks species, hex
   and row. The collapse check happens after the replanting is finished. **assumed**
6. **Full tie at the end** (same stored crops and VP): the rules say both win; `GameState.winner`
   holds one player, so the first of them is recorded and the log names all of them.
7. **Deposit that reaches 10 VP** ends the game at once, even before the seeds are replanted (the
   tokens in hand are out of play).
8. **Dev card from a deposit** goes to the player's new cards (playable next turn), like a bought one.

## Known gaps

- No 5-6 player version (none exists); no combinations.
- Choosing which hexes a loss event hits is automatic (see 2).
- No smarter bot: the random bot plays `legalActions`.
