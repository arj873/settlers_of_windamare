/** OWNER: T2 (rules-core). Small formatting helpers for log lines. */
import { RESOURCES, resourceWord } from '../constants';
import type { GameState, PlayerId, ResourceBundle, SecretText } from '../types';

export function playerName(state: GameState, p: PlayerId): string {
  return state.players[p]?.name ?? `Player ${p}`;
}

/** Cards as a log names them: ['wool', 'ore', 'wool'] -> "2 wool, 1 ore" (first-seen order). */
export function describeCards(cards: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts].map(([c, n]) => `${n} ${resourceWord(c)}`).join(', ');
}

/**
 * The private text of a steal (#32, `LogEntry.secret`): thief and victim read which cards moved,
 * e.g. "Red stole 1 wool from Blue (Bishop)". None when nothing was taken.
 */
export function stealSecret(
  state: GameState,
  thief: PlayerId,
  victim: PlayerId,
  cards: readonly (string | null)[],
  suffix = '',
): SecretText[] {
  const taken = cards.filter((c): c is string => c !== null);
  if (taken.length === 0) return [];
  const text = `${playerName(state, thief)} stole ${describeCards(taken)} from ${playerName(state, victim)}${suffix}`;
  return [{ to: [thief, victim], text }];
}

/** `{ lumber: 2, brick: 1 }` -> "1 brick, 2 lumber"; empty -> "nothing". */
export function describeBundle(bundle: ResourceBundle): string {
  const parts = RESOURCES.flatMap((r) => {
    const n = bundle[r] ?? 0;
    return n > 0 ? [`${n} ${resourceWord(r)}`] : [];
  });
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}
