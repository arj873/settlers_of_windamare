/**
 * E&P + C&K for the simulator: the pair's own invariants (no city is a harbor settlement, no
 * knight beside an unexplored hex, the 7's Aqueduct queue only while a 7 is resolved, cities
 * produce and score) and a steer towards C&K's victory points in the Action phase (cities, city
 * improvements, defence when the barbarians are close). The C&K and E&P bot extensions run too:
 * when this steer has nothing, E&P's sails and builds harbors.
 */
import type { BotExtension } from '../../bots/expansions';
import type { Violation } from '../../bots/invariants';
import type { Action, GameState, PlayerId, VertexId } from '../../engine';
import {
  BARBARIAN_STEPS,
  barbarianStrength,
  besideFog,
  ckSlice,
  defenderStrength,
} from '../ck/engine';
import { epSlice } from '../ep/engine';
import { inMovement } from '../ep/engine/actions';
import { EPCK, epckSlice } from './engine';

function check(state: GameState): Violation[] {
  const out: Violation[] = [];
  const bad = (message: string) => out.push({ code: 'expansion', message: `epck: ${message}` });
  const s = state.ext[EPCK] as { v?: number; aqueduct?: unknown } | undefined;
  if (!s || s.v !== 1 || !Array.isArray(s.aqueduct)) {
    return [{ code: 'expansion', message: 'epck: missing or malformed slice' }];
  }
  const harbors = epSlice(state).harbors;
  for (const [v, b] of Object.entries(state.pieces.buildings) as [VertexId, { kind: string }][]) {
    if (b.kind === 'city' && harbors[v] !== undefined) bad(`city on ${v} is a harbor settlement`);
  }
  for (const v of Object.keys(ckSlice(state).knights) as VertexId[]) {
    if (besideFog(state, v)) bad(`knight on ${v} beside an unexplored hex`);
  }
  // The 7's Aqueduct waits only while the 7 is being resolved (discards, the pirate).
  const k = state.phase.kind;
  if (
    epckSlice(state).aqueduct.length > 0 &&
    k !== 'discard' &&
    k !== 'ep/pirate' &&
    k !== 'ep/pirateSteal' &&
    k !== 'gameOver'
  ) {
    bad(`Aqueduct queue left over in ${k}`);
  }
  return out;
}

/** Builds that score, in the order a greedy player would take them. */
const SCORING = ['buildCity', 'ck/improve'] as const;
/** Defence when the barbarians are close and Catan is weaker than them. */
const DEFENCE = ['ck/activateKnight', 'ck/buildKnight', 'ck/promoteKnight'] as const;

function steer(
  state: GameState,
  player: PlayerId,
  options: readonly Action[],
  rng: { pick<T>(xs: readonly T[]): T },
): Action | null {
  if (state.phase.kind !== 'main' || state.turn.current !== player || inMovement(state)) {
    return null;
  }
  const ck = ckSlice(state);
  const weak =
    ck.barbarian >= BARBARIAN_STEPS - 3 && defenderStrength(state) <= barbarianStrength(state);
  for (const type of weak ? [...DEFENCE, ...SCORING] : SCORING) {
    const xs = options.filter((a) => a.type === type);
    if (xs.length > 0) return rng.pick(xs);
  }
  return null;
}

export const epckBots: BotExtension = {
  id: EPCK,
  invariants: check,
  steer,
};
