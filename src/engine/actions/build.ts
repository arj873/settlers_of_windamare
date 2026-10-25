/**
 * OWNER: T2 (rules-core).
 * Phase main only. Pay COSTS.* into the bank; respect piecesLeft().
 * buildCity returns the settlement piece to the supply (implicit: piecesLeft is derived).
 * Helpers: canPlaceRoad, canPlaceSettlement(.., { requireRoad: true }), canPlaceCity.
 */
import type { Action, GameState } from '../types';
import { type HandlerMap, type LegalGenerator, notImplemented } from './common';

export const buildHandlers: HandlerMap<'buildRoad' | 'buildSettlement' | 'buildCity'> = {
  buildRoad: () => notImplemented(),
  buildSettlement: () => notImplemented(),
  buildCity: () => notImplemented(),
};

export const buildLegal: LegalGenerator = (_state: GameState): Action[] => [];
