/**
 * The Caravans (docs/rules/traders-barbarians.md §2.4, §3.5, §4.3): after a turn in which the
 * player built a settlement or city, a voting round (wool / grain bids) decides who extends a
 * caravan by one camel. +1 VP per building between two camels; a road under a camel counts
 * double for Longest Road.
 *
 * Choice made: the T5 coalition step ("a group with a combined majority agrees") needs table
 * talk, so the player with the most votes places; a tie for most leaves it to the player whose
 * turn ended (T5 steps 1, 3, 4; the same as T6's "most votes, else the active player").
 */
import { isCurrent, log } from '../../../engine/actions/common';
import { blocksRoute, hasRouteBlockers } from '../../../engine/expansions/hooks';
import { buildingsOf, roadsOf } from '../../../engine/selectors';
import { edgeVertices, topologyOf, vertexEdges } from '../../../engine/topology';
import type { Action, EdgeId, GameState, PlayerId, VertexId } from '../../../engine/types';
import { payBank, pn } from './common';
import { pathEnds, pathOther, pathsAt } from './paths';
import {
  CAMELS_34,
  CAMELS_56,
  caravansOf,
  isTwo,
  tbBoard,
  type Camel,
  type CaravanSlice,
  type TbPhase,
} from './state';

export function initCaravans(state: GameState): CaravanSlice {
  return {
    camels: [],
    left: state.players.length > 4 ? CAMELS_56 : CAMELS_34,
    heads: (tbBoard(state).caravanStarts ?? []).map(() => null),
    built: false,
    sbpBuilt: false,
  };
}

/**
 * Where the next camel may go: the start edge of an unstarted caravan, or a free path at a head
 * (on a Seafarers map sea paths too, ships or not: T&B + Seafarers).
 */
export function camelOptions(state: GameState): Camel[] {
  const s = caravansOf(state);
  if (s.left <= 0) return [];
  const taken = new Set(s.camels.map((c) => c.edge));
  const out: Camel[] = [];
  const seen = new Set<EdgeId>();
  const starts = tbBoard(state).caravanStarts ?? [];
  s.heads.forEach((head, caravan) => {
    if (head === null) {
      const start = starts[caravan];
      if (start && !taken.has(start.edge) && !seen.has(start.edge)) {
        seen.add(start.edge);
        out.push({ edge: start.edge, head: start.head, caravan });
      }
      return;
    }
    for (const e of pathsAt(state, head)) {
      if (taken.has(e) || seen.has(e)) continue;
      seen.add(e);
      out.push({ edge: e, head: pathOther(state, e, head), caravan });
    }
  });
  return out;
}

export function placeCamel(draft: GameState, camel: Camel): void {
  const s = caravansOf(draft);
  const from = s.heads[camel.caravan] ?? null;
  s.camels.push(camel);
  s.left -= 1;
  // Caravans whose heads meet continue as one.
  s.heads = s.heads.map((h, i) =>
    i === camel.caravan || (from !== null && h === from) ? camel.head : h,
  );
}

/** Camels each vertex touches. */
function camelDegree(state: GameState): Map<VertexId, number> {
  const deg = new Map<VertexId, number>();
  for (const c of caravansOf(state).camels) {
    for (const v of pathEnds(state, c.edge)) deg.set(v, (deg.get(v) ?? 0) + 1);
  }
  return deg;
}

/** +1 VP per settlement or city between two camels. */
export function caravanVictoryPoints(state: GameState, p: PlayerId): number {
  const deg = camelDegree(state);
  return buildingsOf(state, p).filter((v) => (deg.get(v) ?? 0) >= 2).length;
}

/** Longest Road where a road under a camel counts 2 (the base trail rule otherwise). */
export function camelRoadLength(state: GameState, p: PlayerId): number {
  const t = topologyOf(state);
  const roads = state.pieces.roads;
  const camels = new Set(caravansOf(state).camels.map((c) => c.edge));
  const hooked = hasRouteBlockers(state);
  const blocked = (v: VertexId) => {
    const b = state.pieces.buildings[v];
    if (b !== undefined) return b.owner !== p;
    return hooked && blocksRoute(state, v, p);
  };
  const used = new Set<EdgeId>();
  let best = 0;
  const walk = (v: VertexId, len: number): void => {
    if (len > best) best = len;
    for (const e of vertexEdges(t, v)) {
      if (roads[e] !== p || used.has(e)) continue;
      const w = camels.has(e) ? 2 : 1;
      const next = edgeVertices(t, e).find((x) => x !== v) as VertexId;
      if (blocked(next)) {
        if (len + w > best) best = len + w;
        continue;
      }
      used.add(e);
      walk(next, len + w);
      used.delete(e);
    }
  };
  const starts = new Set<VertexId>();
  for (const e of roadsOf(state, p)) for (const v of edgeVertices(t, e)) starts.add(v);
  for (const v of starts) walk(v, 0);
  return best;
}

// ---------------------------------------------------------------------------
// The voting round
// ---------------------------------------------------------------------------

/** Start the voting round after `ender`'s turn, if a camel can be placed. */
export function startVote(
  draft: GameState,
  ender: PlayerId,
  then: 'endTurn' | 'preRoll' = 'endTurn',
): TbPhase | null {
  if (camelOptions(draft).length === 0) return null;
  const n = draft.players.length;
  return {
    kind: 'tb/vote',
    ender,
    order: Array.from({ length: n }, (_, i) => (ender + i) % n),
    bids: draft.players.map(() => 0),
    camels: isTwo(draft) ? 2 : 1,
    placer: null,
    then,
  };
}

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

export function bidBlocker(
  state: GameState,
  p: PlayerId,
  wool: unknown,
  grain: unknown,
): string | null {
  const phase = state.phase as unknown as TbPhase;
  if (phase.kind !== 'tb/vote' || phase.placer !== null) return 'no vote now';
  if (phase.order[0] !== p) return 'not your bid';
  if (!isCount(wool) || !isCount(grain)) return 'bid whole sheep and wheat cards';
  const hand = state.players[p]?.resources;
  if (!hand || hand.wool < wool || hand.grain < grain) return 'you do not have those cards';
  return null;
}

/** Record a bid (cards go to the bank); after the last bid, the placer is decided. */
export function bid(draft: GameState, p: PlayerId, wool: number, grain: number): void {
  const phase = draft.phase as unknown as Extract<TbPhase, { kind: 'tb/vote' }>;
  payBank(draft, p, { wool, grain });
  phase.bids[p] = wool + grain;
  phase.order.shift();
  log(draft, p, `${pn(draft, p)} voted with ${wool + grain} card${wool + grain === 1 ? '' : 's'}`);
  if (phase.order.length > 0) return;
  const max = Math.max(...phase.bids);
  const top = phase.bids.flatMap((b, i) => (b === max ? [i] : []));
  phase.placer = max > 0 && top.length === 1 ? (top[0] as PlayerId) : phase.ender;
  log(draft, phase.placer, `${pn(draft, phase.placer)} decides where the camel goes`);
}

export function camelBlocker(state: GameState, p: PlayerId, edge: unknown): string | null {
  const phase = state.phase as unknown as TbPhase;
  if (phase.kind !== 'tb/vote' || phase.placer === null) return 'no camel to place';
  if (phase.placer !== p) return 'another player places the camel';
  if (!camelOptions(state).some((c) => c.edge === edge)) return 'a camel cannot go there';
  return null;
}

/** Legal bids: a small sample (0-2 of each), the handler accepts any amount held. */
export function caravansLegal(state: GameState): Action[] {
  const phase = state.phase as unknown as TbPhase;
  if (phase.kind !== 'tb/vote') return [];
  if (phase.placer === null) {
    const p = phase.order[0] as PlayerId;
    const out: Action[] = [];
    for (let wool = 0; wool <= 2; wool++) {
      for (let grain = 0; grain <= 2; grain++) {
        if (bidBlocker(state, p, wool, grain) === null) {
          out.push({ type: 'tb/bid', player: p, wool, grain } as unknown as Action);
        }
      }
    }
    return out;
  }
  const placer = phase.placer;
  return camelOptions(state).map(
    (c) => ({ type: 'tb/placeCamel', player: placer, edge: c.edge }) as unknown as Action,
  );
}

/** Actors of the vote: the bidder, then the placer. */
export function voteActors(state: GameState): PlayerId[] | undefined {
  const phase = state.phase as unknown as TbPhase;
  if (phase.kind !== 'tb/vote') return undefined;
  if (phase.placer !== null) return [phase.placer];
  return phase.order.length > 0 ? [phase.order[0] as PlayerId] : [];
}

/**
 * Mark that the current player built (only their own turn's builds call a camel); a build in
 * the special build phase calls one more camel after the phase (T5-56 p.4).
 */
export function noteBuilt(draft: GameState, p: PlayerId): void {
  if (draft.phase.kind === 'specialBuild') {
    caravansOf(draft).sbpBuilt = true;
    return;
  }
  if (
    draft.phase.kind === 'main' &&
    isCurrent(draft, p) &&
    draft.turn.secondSettlerOf === undefined
  ) {
    caravansOf(draft).built = true;
  }
}
