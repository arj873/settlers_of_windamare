/**
 * OWNER: T2 (rules-core).
 * Post-action hook, runs after updateAwards on every successful action.
 * Official rule: a player wins only on THEIR OWN turn, when victoryPoints() >= settings.vpToWin.
 * On win: draft.winner = current, draft.phase = { kind: 'gameOver' }, log it. Mutate in place.
 */
import type { GameState } from '../types';

export function checkVictory(_draft: GameState): void {
  // not implemented — T2
}
