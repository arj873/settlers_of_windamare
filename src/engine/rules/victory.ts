/**
 * OWNER: T2 (rules-core).
 * Post-action hook, runs after updateAwards on every successful action.
 * Official rule: a player wins only on THEIR OWN turn, when victoryPoints() >= settings.vpToWin.
 * On win: draft.winner = current, draft.phase = { kind: 'gameOver' }, log it. Mutate in place.
 * Not checked during setup (no turn has started yet), so a tiny vpToWin can't end setup early.
 * Not checked during specialBuild either (FAQ: "Can I win during the special building phase?
 * No. You can only win during your own turn."). A builder at vpToWin wins when their own turn
 * starts (the pass that hands them the turn runs this check), unless someone wins first.
 */
import { victoryPoints } from '../selectors';
import type { GameState } from '../types';
import { playerName } from './text';

export function checkVictory(draft: GameState): void {
  const kind = draft.phase.kind;
  if (kind === 'gameOver' || kind === 'setup' || kind === 'specialBuild') return;
  if (draft.winner !== null) return;
  const current = draft.turn.current;
  const vp = victoryPoints(draft, current);
  if (vp < draft.settings.vpToWin) return;
  draft.winner = current;
  draft.phase = { kind: 'gameOver' };
  draft.log.push({
    turn: draft.turn.number,
    player: current,
    text: `${playerName(draft, current)} wins with ${vp} victory points!`,
  });
}
