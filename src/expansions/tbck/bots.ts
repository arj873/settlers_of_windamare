/**
 * T&B + C&K for the simulator: the pair's own invariants (no development cards, no knight on a
 * trade hex's plaza, nobody past the progress hand limit in a T&B end-of-turn step) and a steer
 * towards victory points before T&B's own (wagons, camels). The C&K and T&B bot extensions run
 * too.
 */
import type { BotExtension } from '../../bots/expansions';
import type { Violation } from '../../bots/invariants';
import {
  isCentreVertex,
  type Action,
  type GameState,
  type PlayerId,
  type VertexId,
} from '../../engine';
import { PROGRESS_HAND_MAX, ckSlice } from '../ck/engine';
import { has } from '../tb/engine';
import { TBCK } from './engine';

function check(state: GameState): Violation[] {
  const out: Violation[] = [];
  const bad = (message: string) => out.push({ code: 'expansion', message: `tbck: ${message}` });
  const s = state.ext[TBCK] as { v?: number } | undefined;
  if (!s || s.v !== 1) return [{ code: 'expansion', message: 'tbck: missing or malformed slice' }];
  if (state.devDeck.length > 0) bad('a development deck with Cities & Knights');
  state.players.forEach((p, i) => {
    const held = Object.values(p.devCards).reduce((a, b) => a + b, 0);
    const fresh = Object.values(p.newDevCards).reduce((a, b) => a + b, 0);
    if (held + fresh > 0) bad(`player ${i} holds development cards`);
  });
  if (has(state, 'traders')) {
    for (const v of Object.keys(ckSlice(state).knights) as VertexId[]) {
      if (isCentreVertex(v)) bad(`knight on the plaza ${v}`);
    }
  }
  const k = state.phase.kind;
  if (k === 'tb/wagon' || k === 'tb/vote') {
    const p = state.turn.current;
    if ((ckSlice(state).players[p]?.progress.length ?? 0) > PROGRESS_HAND_MAX && k === 'tb/wagon') {
      bad(`player ${p} moves the wagon holding too many progress cards`);
    }
  }
  return out;
}

/** Builds that score, in the order a greedy player would take them. */
const SCORING = ['buildCity', 'buildSettlement', 'ck/improve'] as const;

function steer(
  _state: GameState,
  _player: PlayerId,
  options: readonly Action[],
  rng: { pick<T>(xs: readonly T[]): T },
): Action | null {
  for (const type of SCORING) {
    const xs = options.filter((a) => a.type === type);
    if (xs.length > 0) return rng.pick(xs);
  }
  return null;
}

export const tbckBots: BotExtension = {
  id: TBCK,
  invariants: check,
  steer,
};
