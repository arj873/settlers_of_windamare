/** OWNER: T2 (rules-core). Small formatting helpers for log lines. */
import { RESOURCES } from '../constants';
import type { GameState, PlayerId, ResourceBundle } from '../types';

export function playerName(state: GameState, p: PlayerId): string {
  return state.players[p]?.name ?? `Player ${p}`;
}

/** `{ lumber: 2, brick: 1 }` -> "1 brick, 2 lumber"; empty -> "nothing". */
export function describeBundle(bundle: ResourceBundle): string {
  const parts = RESOURCES.flatMap((r) => {
    const n = bundle[r] ?? 0;
    return n > 0 ? [`${n} ${r}`] : [];
  });
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}
