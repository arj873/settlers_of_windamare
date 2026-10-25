/**
 * OWNER: T3 (rules-trade).
 * buyDevCard (main): pay COSTS.devCard, pop devDeck into newDevCards.
 * play* (preRoll or main): at most one per turn (turn.devCardPlayed), only from devCards
 *   (never newDevCards). VP cards are never "played"; they count automatically.
 *   playKnight        -> knightsPlayed++, phase moveRobber{resume: <phase it was played in>}
 *   playRoadBuilding  -> phase roadBuilding{remaining: min(2, roads left), resume}
 *   placeFreeRoad     -> free road (canPlaceRoad); when remaining hits 0 or no legal edge -> resume
 *   playYearOfPlenty  -> take 2 from bank (must be available)
 *   playMonopoly      -> all other players give all of that resource
 */
import type { Action, GameState } from '../types';
import { type HandlerMap, type LegalGenerator, notImplemented } from './common';

export const devHandlers: HandlerMap<
  | 'buyDevCard'
  | 'playKnight'
  | 'playRoadBuilding'
  | 'placeFreeRoad'
  | 'playYearOfPlenty'
  | 'playMonopoly'
> = {
  buyDevCard: () => notImplemented(),
  playKnight: () => notImplemented(),
  playRoadBuilding: () => notImplemented(),
  placeFreeRoad: () => notImplemented(),
  playYearOfPlenty: () => notImplemented(),
  playMonopoly: () => notImplemented(),
};

export const devLegal: LegalGenerator = (_state: GameState): Action[] => [];
