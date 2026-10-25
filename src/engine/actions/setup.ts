/**
 * OWNER: T2 (rules-core).
 * Initial placement in snake order (see Phase 'setup' in types.ts).
 * Round-2 settlements (index >= n) produce one resource per adjacent non-desert hex.
 * After the last road: turn.number = 1, current = 0, phase = preRoll.
 * Helpers: canPlaceSettlement(.., { requireRoad: false }), canPlaceRoad(.., { fromVertex }),
 * setupPlayerAt().
 */
import type { Action, GameState } from '../types';
import { type HandlerMap, type LegalGenerator, notImplemented } from './common';

export const setupHandlers: HandlerMap<'placeSetupSettlement' | 'placeSetupRoad'> = {
  placeSetupSettlement: () => notImplemented(),
  placeSetupRoad: () => notImplemented(),
};

export const setupLegal: LegalGenerator = (_state: GameState): Action[] => [];
