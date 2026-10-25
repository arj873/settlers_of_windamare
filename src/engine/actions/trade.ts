/**
 * OWNER: T3 (rules-trade).
 * bankTrade (main): give `ratio` of one resource for 1 of another. ratio = 2 with that
 *   resource's port, else 3 with a generic port, else 4 (see portsOf()). Bank must have it.
 * Player trading (main, current player only offers):
 *   offerTrade   -> phase trade{offer}; responses[p] = 'pending' for addressed p, else null.
 *                   give/want non-empty, disjoint resources, offerer must hold `give`.
 *   acceptTrade  -> addressed player marks 'accepted' (must hold `want` at accept time)
 *   rejectTrade  -> addressed player marks 'rejected'
 *   confirmTrade -> offerer executes with one accepted partner -> main
 *   cancelTrade  -> offerer withdraws -> main
 *   Suggested: auto-return to main when every response is 'rejected'.
 * legalActions note: offerTrade is open-ended; return a bounded sample (e.g. 1:1 offers to all).
 */
import type { Action, GameState } from '../types';
import { type HandlerMap, type LegalGenerator, notImplemented } from './common';

export const tradeHandlers: HandlerMap<
  'bankTrade' | 'offerTrade' | 'acceptTrade' | 'rejectTrade' | 'cancelTrade' | 'confirmTrade'
> = {
  bankTrade: () => notImplemented(),
  offerTrade: () => notImplemented(),
  acceptTrade: () => notImplemented(),
  rejectTrade: () => notImplemented(),
  cancelTrade: () => notImplemented(),
  confirmTrade: () => notImplemented(),
};

export const tradeLegal: LegalGenerator = (_state: GameState): Action[] => [];
