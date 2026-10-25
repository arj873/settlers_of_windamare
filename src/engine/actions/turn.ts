/**
 * OWNER: T2 (rules-core).
 * rollDice (phase preRoll): two dice via Rng, set state.dice, then
 *   - 7  -> discard phase if anyone holds > DISCARD_THRESHOLD cards, else moveRobber{resume:'main'}
 *   - else production: each settlement 1 / city 2 of the hex's resource, skipping the robber hex.
 *     If the bank can't pay a resource to everyone owed, nobody gets it — unless only one player
 *     is owed, who then gets what's left.
 *   -> main
 * endTurn (phase main): merge newDevCards into devCards, devCardPlayed=false,
 *   advance current, turn.number++, dice stay as last roll, phase = preRoll.
 */
import type { Action, GameState } from '../types';
import { type HandlerMap, type LegalGenerator, notImplemented } from './common';

export const turnHandlers: HandlerMap<'rollDice' | 'endTurn'> = {
  rollDice: () => notImplemented(),
  endTurn: () => notImplemented(),
};

export const turnLegal: LegalGenerator = (_state: GameState): Action[] => [];
