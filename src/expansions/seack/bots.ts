/**
 * Seafarers + C&K for the simulator: the pair's own invariants (knights at sea stand on their
 * owner's ship, a ship under a knight never moves, the chase flag only lives in a moveRobber
 * phase) and a steer towards victory points (16 VP take random bots long otherwise). The C&K and
 * Seafarers bot extensions run too (their invariants are checked as well).
 */
import type { BotExtension } from '../../bots/expansions';
import type { Violation } from '../../bots/invariants';
import {
  touchesLand,
  topologyOf,
  type Action,
  type GameState,
  type PlayerId,
  type VertexId,
} from '../../engine';
import { ckSlice } from '../ck/engine';
import { seaSlice } from '../seafarers/engine';
import { graph } from '../seafarers/engine/geometry';
import { SEACK, seackSlice } from './engine';

function check(state: GameState): Violation[] {
  const out: Violation[] = [];
  const bad = (message: string) => out.push({ code: 'expansion', message: `seack: ${message}` });
  const s = state.ext[SEACK] as { v?: number; chase?: unknown } | undefined;
  if (!s || s.v !== 1) return [{ code: 'expansion', message: 'seack: missing or malformed slice' }];
  const chase = seackSlice(state).chase;
  if (chase !== null && chase !== 'robber' && chase !== 'pirate') bad(`chase ${String(chase)}`);
  if (chase !== null && state.phase.kind !== 'moveRobber') bad(`chase ${chase} outside moveRobber`);

  // The robber and the pirate sleep until the first barbarian attack (C2.10).
  const start = seackSlice(state).start;
  if (start && ckSlice(state).attacks === 0) {
    if (state.robber !== start.robber) bad('the robber moved before the first attack');
    if (seaSlice(state).pirate !== start.pirate) bad('the pirate moved before the first attack');
  }

  const t = topologyOf(state);
  const ships = seaSlice(state).ships;
  const knights = ckSlice(state).knights;
  const g = graph(state);
  for (const [v, k] of Object.entries(knights) as [VertexId, { owner: PlayerId }][]) {
    if (!t.vertex[v] && !t.seaVertex[v]) bad(`knight on unknown vertex ${v}`);
    if (touchesLand(state, v)) continue;
    // At sea: the knight is "on" one of its owner's ships (C2.5).
    if (!(g.edgesAt.get(v) ?? []).some((e) => ships[e]?.owner === k.owner)) {
      bad(`knight on ${v} at sea without its owner's ship`);
    }
  }
  if (state.phase.kind === 'seafarers/moveShip') {
    const from = (state.phase as { from?: string }).from as keyof typeof ships;
    const ends = g.ends.get(from) ?? [];
    if (ends.some((v) => knights[v] !== undefined)) bad(`ship ${from} picked up under a knight`);
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

export const seackBots: BotExtension = {
  id: SEACK,
  invariants: check,
  steer,
};
