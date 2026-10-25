/**
 * OWNER: T2 (rules-core).
 * discard (phase discard, any player with pending > 0): exactly pending[player] cards at once,
 *   returned to the bank. When all pending are 0 -> moveRobber{resume:'main'}.
 * moveRobber (phase moveRobber, current player): must move to a DIFFERENT land hex.
 *   Candidates = other players with a building on that hex and >= 1 card.
 *   none -> phase = resume; otherwise -> steal{candidates, resume}.
 * steal (phase steal): victim in candidates; take one random card via Rng -> phase = resume.
 */
import type { Action, GameState } from '../types';
import { type HandlerMap, type LegalGenerator, notImplemented } from './common';

export const robberHandlers: HandlerMap<'discard' | 'moveRobber' | 'steal'> = {
  discard: () => notImplemented(),
  moveRobber: () => notImplemented(),
  steal: () => notImplemented(),
};

export const robberLegal: LegalGenerator = (_state: GameState): Action[] => [];
