/**
 * Barbarian Attack + C&K for the simulator: the pair's invariants (knights on land paths within
 * C&K's piece limits, no BA knights or cards, no barbarian ship, metropolises never conquered,
 * VP tokens) and a steer that recruits knights and sends active ones to the barbarians. The C&K
 * and T&B bot extensions run too.
 */
import type { BotExtension } from '../../bots/expansions';
import type { Violation } from '../../bots/invariants';
import {
  topologyOf,
  type Action,
  type EdgeId,
  type GameState,
  type HexId,
  type PlayerId,
} from '../../engine';
import { KNIGHT_LEVELS, KNIGHTS_PER_LEVEL, ckSlice, metropolisVertices } from '../ck/engine';
import { baOf, isConqueredBuilding, tbBoard } from '../tb/engine';
import { isLandPath } from '../tb/engine/paths';
import { BACK, backSlice, type BackSlice } from './engine';

function check(state: GameState): Violation[] {
  const out: Violation[] = [];
  const bad = (message: string, player?: PlayerId) =>
    out.push({
      code: 'expansion',
      message: `back: ${message}`,
      ...(player === undefined ? {} : { player }),
    });
  const s = state.ext[BACK] as BackSlice | undefined;
  if (!s || s.v !== 1) return [{ code: 'expansion', message: 'back: missing or malformed slice' }];
  const t = topologyOf(state);
  for (const [e, k] of Object.entries(s.knights) as [EdgeId, BackSlice['knights'][EdgeId]][]) {
    if (!t.edge[e] || !isLandPath(state, e)) bad(`knight off the land paths on ${e}`);
    if (!KNIGHT_LEVELS.includes(k.level)) bad(`knight level ${k.level}`);
    if (!state.players[k.owner]) bad(`knight of no seat on ${e}`);
  }
  state.players.forEach((_, p) => {
    for (const l of KNIGHT_LEVELS) {
      const n = Object.values(s.knights).filter((k) => k.owner === p && k.level === l).length;
      if (n > KNIGHTS_PER_LEVEL) bad(`${n} knights of level ${l}`, p);
    }
    if ((s.tokens[p] ?? 0) < 0) bad('negative VP tokens', p);
  });
  const ba = baOf(state);
  if (Object.keys(ba.knights).length > 0) bad('a Barbarian Attack knight on the board');
  if (ba.deck.length + ba.discard.length > 0) bad('Barbarian Attack development cards');
  const ck = ckSlice(state);
  if (ck.barbarian !== 0 || ck.attacks !== 0) bad('the barbarian ship sailed');
  if (Object.keys(ck.knights).length > 0) bad('a C&K knight on an intersection');
  for (const v of metropolisVertices(state)) {
    if (isConqueredBuilding(state, v)) bad(`the metropolis on ${v} was conquered`);
  }
  return out;
}

/** Edges of coastal hexes where the active knights do not yet beat the barbarians. */
function needs(state: GameState): Set<EdgeId> {
  const t = topologyOf(state);
  const s = backSlice(state);
  const out = new Set<EdgeId>();
  for (const [h, n] of Object.entries(baOf(state).onHex) as [HexId, number][]) {
    const edges = t.hex[h]?.edges ?? [];
    const strength = edges.reduce(
      (a, e) => a + (s.knights[e]?.active ? (s.knights[e]?.level ?? 0) : 0),
      0,
    );
    if (strength <= n) for (const e of edges) out.add(e);
  }
  return out;
}

const edgeOf = (a: Action) => (a as { edge?: EdgeId }).edge;

function steer(
  state: GameState,
  _p: PlayerId,
  options: readonly Action[],
  rng: { float(): number; pick<T>(xs: readonly T[]): T },
): Action | null {
  const of = (type: string) => options.filter((a) => a.type === type);
  const want = needs(state);
  const k = state.phase.kind;
  if (k === 'back/knights') {
    const move = [...of('back/displace'), ...of('back/moveKnight')].filter((a) =>
      want.has(edgeOf(a) as EdgeId),
    );
    if (move.length > 0) return rng.pick(move);
    // Knights already where they are needed stay; others may still be picked up.
    const pick = of('back/selectKnight').filter((a) => !want.has(edgeOf(a) as EdgeId));
    if (pick.length > 0 && rng.float() < 0.5) return rng.pick(pick);
    return of('endTurn')[0] ?? null;
  }
  if (k !== 'main' && k !== 'specialBuild') return null;
  const grow = [...of('back/activate'), ...of('back/recruit'), ...of('back/promote')];
  if (grow.length > 0 && rng.float() < 0.6) return rng.pick(grow);
  // Knights that can reach a threatened coast: end the building and send them.
  const free = (tbBoard(state).coast ?? []).length > 0 && want.size > 0;
  const go = of('back/startKnights').filter((a) => !want.has(edgeOf(a) as EdgeId));
  if (free && go.length > 0 && rng.float() < 0.3) return rng.pick(go);
  return null;
}

export const backBots: BotExtension = {
  id: BACK,
  invariants: check,
  steer,
};
