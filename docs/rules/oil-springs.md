# Catan: Oil Springs: rules, sources and engine status

Module: `src/expansions/oil` (id `oil`, mode `oil`, scenarios `oil/oilSprings` = the rulebook
layout, `oil/oilSpringsVariable` = the variable setup). 3-6 players, 12 VP. Combines with the base
game only (the 5-6 player version uses the base 5-6 board); no other combination is official
(`scenarios-and-combos.md` part A/C).

Status key: **done** = implemented and tested, **sim** = covered by the simulator invariants only,
**assumed** = the text is silent or unclear and we chose (see "Uncertain rules"), **gap** = not
implemented.

## Sources

- S1. _Catan: Oil Springs_ rulebook (Erik Assadourian & Ty Hansen, Catan GmbH / Mayfair Games, 2011,
  4 pp.), https://tesera.ru/images/items/74859/Catan-OilSprings-Scenario.pdf (mirror of the free
  PDF that was hosted at oilsprings.catan.com). Read in full from the PDF text layer; the board
  diagrams are images (read by eye, see below).
- S2. https://www.catan.com/oil-springs (3-4 players, 5-6 with the base 5-6 extension).
- The longer research notes (component counts, edge cases): `docs/rules/scenarios-and-combos.md` Part A.

## Rules and engine status

| #   | Rule (S1 page)                                                                                                                                                                                                                        | Status                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Base game + oil tokens (15 for 3-4, 21 for 5-6), 4 / 6 metropolis tokens, 3 / 4 spring tiles, Champion token, Disaster Track. Win at **12 VP**. (p1)                                                                                  | done (`oilScale`, tests "oil setup")                                             |
| 2   | Setup: board as printed, springs on the desert, the 9 forest and the north-east 10 pasture; the robber starts off the board; marker on 0. (p1)                                                                                        | done (`oil/fixed19`)                                                             |
| 3   | Variable setup (p3): numbered spring on the desert (number not next to it), unnumbered spring on the 2nd most probable pasture and the 2nd least probable forest (ties: not next to another spring).                                  | done (`oil/random19`), token swapping for adjacency not done (**assumed**)       |
| 4   | 5-6 players (p3): the second desert is also a numbered spring; left "10" becomes forest, right "4" pasture, each with a spring; max oil 6; special building phase rules.                                                              | done (`oil/fixed30`, `oil/random30`); terrain of the fixed board **assumed**     |
| 5   | Production (p1): spring hexes pay oil instead of resources: settlement 1, city 2, metropolis 3. Oil is handed out one at a time from the roller clockwise until everyone has theirs or the supply is empty. Robber blocks a spring.   | done                                                                             |
| 6   | Cap: at most 4 oil (6 with 5-6 players) held; excess from production, theft, trade or dev cards cannot be taken. (p1)                                                                                                                 | done                                                                             |
| 7   | Oil counts as 1 card on a 7; discarding may include oil, which returns to the supply (and is not "used"). (p1)                                                                                                                        | done (`handSize` hook, `oil/discard`)                                            |
| 8   | The robber may sit on a spring. A thief may take 1 oil instead of a random card. (p1)                                                                                                                                                 | done (`oil/steal`)                                                               |
| 9   | Oil cannot be obtained by maritime trade; domestic trade may include oil. Year of Plenty can take oil; Monopoly can name oil (one at a time from the next player clockwise, up to the cap). (pp1-2, 4)                                | done (`oil/offerTrade` etc., `oil/yearOfPlenty`, `oil/monopoly`)                 |
| 10  | Convert 1 oil into 2 cards of one other resource, any number of times a turn. (p2)                                                                                                                                                    | done (`oil/convert`)                                                             |
| 11  | Metropolis: 1 brick + 1 grain + 1 ore + 2 oil on one of your cities; produces 3, worth 3 VP (net +1), immune to flooding; the shared token supply limits them. (p2)                                                                   | done (`oil/metropolis`)                                                          |
| 12  | Sequester: once a turn flip 1 oil out of the game; 3 sequestered = 1 VP; the first player with 3 takes the Champion token (1 VP), moving only to a player with strictly more. Not on a turn you used oil. (p2)                        | done (`oil/sequester`)                                                           |
| 13  | Pollution: each oil used (converted or spent on a metropolis; not discarded or sequestered) moves the marker; oil may only be used while the marker stays at or below 5. (p2)                                                         | done                                                                             |
| 14  | Disaster phase (marker at 5): resolved after the turn, before the dice pass; roll 2 dice: **7** floods the coast (coastal settlements removed, coastal cities reduced, metropolises and roads safe).                                  | done (`afterAction`)                                                             |
| 15  | Any other number: a hex with that number is hit (random if several; nothing if none). A plain hex loses its number token for good (placed on the Disaster Track); a spring loses 3 oil from the supply, tile and number stay. (p2)    | done; shortfall rule: players give up oil one at a time from the cause clockwise |
| 16  | The marker resets to 0 after the disaster. The robber may not be put on a destroyed hex. (pp2, 4)                                                                                                                                     | done                                                                             |
| 17  | End: the first player with 12 VP **at the end of their turn, after the disaster phase** wins; when the 5th (8th with 5-6) number token is destroyed the island is lost: no winner, the Champion holder gets a "Pyrrhic Victory". (p3) | done (`deferVictory` hook + `afterAction`)                                       |
| 18  | Special building phase (5-6): oil cannot be converted or sequestered; it may only be used to build metropolises, and only if the marker stays at or below 5; a disaster triggered there is resolved after the phase. (p3)             | done; see gaps for who is asked to build                                         |

## Uncertain rules and what the engine does

1. **Fixed 5-6 board terrain.** The rulebook prints only the number layout (and that the second
   desert, the "10" and the "4" positions become springs); the terrain comes from the base 5-6
   rulebook, which we did not have. `oil/fixed30` uses the printed numbers with the 26 other terrains
   shuffled each game (5 forest, 5 pasture, 6 fields, 5 hills, 5 mountains). **assumed**
2. **Harbours** are not legible in the diagrams: the 3-4 fixed board uses the beginner board's
   harbour kinds, the others shuffle theirs. **assumed**
3. **Numbered desert tile.** The fixed 3-4 layout carries a printed 5 on the desert spring (so three
   5s); in the variable setup the number is drawn from 2-12 without 7, avoiding the neighbours' numbers
   when possible. **assumed**
4. **A spring replaces its hex's production** (a forest spring gives oil, not lumber). The text
   says buildings on springs produce oil and never mentions the underlying resource again.
5. **Disaster shortfall (p2 note).** "If the general supply no longer contains oil ... they discard
   one oil at a time beginning with the player who caused the disaster". Implemented as: take 3
   from the supply first, then one at a time from the players clockwise from the player whose turn
   ended; the removed oil is out of the game.
6. **Ruin vs 12 VP.** If one disaster both destroys the last token and leaves the active player with
   12 VP, the ruin wins (the text does not say). **assumed**
7. **A city that cannot become a settlement** (the owner has no settlement piece left) is removed
   by a flood. The rulebook is silent. **assumed**
8. **Sequester and use order.** The rulebook example says you cannot sequester after using oil;
   we also forbid using oil after sequestering ("Wide Open" variant lifts both). **assumed**
9. **Domestic oil trades** are single-partner offers (`oil/offerTrade`, the partner accepts or
   declines; at most 3 offers a turn, like the base game's limit). Oil for oil is not allowed.

## Known gaps

- "Wide Open Game" variant options (no oil cap, use and sequester in one turn, variable setup) are
  not offered.
- Special building phase: a player whose only possible build is a metropolis is skipped by the core
  (it decides who may build from the base builds); a metropolis is possible there only for a player
  who can also build something else.
- Oil trading is one partner at a time (no open offers to several players).
- No smarter bot: the random bot plays `legalActions`.
