/**
 * Catan for Two + C&K for the simulator: the pair's invariants (neutral knights: owners 2 and 3,
 * never active, never mighty, within their piece limits, on empty intersections) and a steer that
 * builds what scores and keeps bots from turning in their knights for tokens (a random bot
 * recruits and trades in a knight nearly every turn). The C&K and T&B bot extensions run too.
 */
import { steerAway, type BotExtension } from '../../bots/expansions';
import type { Violation } from '../../bots/invariants';
import type { GameState, VertexId } from '../../engine';
import { KNIGHTS_PER_LEVEL, ckSlice, type Knight } from '../ck/engine';
import { TWOCK, neutralOf } from './engine';

function check(state: GameState): Violation[] {
  const out: Violation[] = [];
  const bad = (message: string) => out.push({ code: 'expansion', message: `twock: ${message}` });
  const s = state.ext[TWOCK] as { v?: number } | undefined;
  if (!s || s.v !== 1) return [{ code: 'expansion', message: 'twock: missing or malformed slice' }];
  if (state.players.length !== 2) bad('Catan for Two with more than two players');
  const count = new Map<string, number>();
  for (const [v, k] of Object.entries(ckSlice(state).knights) as [VertexId, Knight][]) {
    const i = neutralOf(state, k.owner);
    if (i === null) {
      if (!state.players[k.owner]) bad(`knight of no seat or neutral on ${v}`);
      continue;
    }
    if (k.active) bad(`an active neutral knight on ${v}`);
    if (k.level > 2) bad(`a mighty neutral knight on ${v}`);
    const key = `${i}:${k.level}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  for (const [key, n] of count) if (n > KNIGHTS_PER_LEVEL) bad(`${n} neutral knights ${key}`);
  return out;
}

/** Builds that score, in the order a greedy player would take them. */
const SCORING = ['buildCity', 'ck/improve', 'buildSettlement', 'buildRoad'] as const;
const away = steerAway(['twock/knightForTokens']);

const steer: NonNullable<BotExtension['steer']> = (state, player, options, rng) => {
  for (const type of SCORING) {
    const xs = options.filter((a) => a.type === type);
    if (xs.length > 0) return rng.pick(xs);
  }
  return away(state, player, options, rng);
};

export const twockBots: BotExtension = {
  id: TWOCK,
  invariants: check,
  steer,
};
