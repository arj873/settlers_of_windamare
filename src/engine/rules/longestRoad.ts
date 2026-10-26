/**
 * OWNER: T3 (rules-trade).
 * Longest Road length = the longest trail (no edge used twice; vertices may repeat, so loops
 * count fully) in the player's road graph. A vertex holding an OPPONENT's building breaks the
 * road: a trail may end there but not pass through. The player's own buildings never break it.
 * Brute-force DFS over edges: a player has at most 15 roads, so this is cheap.
 */
import {
  blocksRoute,
  hasRoadLengthHook,
  hasRouteBlockers,
  hookRoadLength,
} from '../expansions/hooks';
import { edgeVertices, topologyOf, vertexEdges } from '../topology';
import { roadsOf } from '../selectors';
import type { EdgeId, GameState, PlayerId, VertexId } from '../types';

export function longestRoadLength(state: GameState, player: PlayerId): number {
  const t = topologyOf(state);
  const roads = state.pieces.roads;
  const buildings = state.pieces.buildings;
  const hooked = hasRouteBlockers(state);
  const blocked = (v: VertexId) => {
    const b = buildings[v];
    if (b !== undefined) return b.owner !== player;
    return hooked && blocksRoute(state, v, player);
  };

  const used = new Set<EdgeId>();
  let best = 0;
  const walk = (v: VertexId, len: number): void => {
    if (len > best) best = len;
    for (const e of vertexEdges(t, v)) {
      if (roads[e] !== player || used.has(e)) continue;
      const [a, b] = edgeVertices(t, e) as [VertexId, VertexId];
      const next = a === v ? b : a;
      if (blocked(next)) {
        if (len + 1 > best) best = len + 1;
        continue;
      }
      used.add(e);
      walk(next, len + 1);
      used.delete(e);
    }
  };

  // Starting at a blocked vertex is fine: the trail simply ends there.
  const starts = new Set<VertexId>();
  for (const e of roadsOf(state, player)) for (const v of edgeVertices(t, e)) starts.add(v);
  for (const v of starts) walk(v, 0);
  return best;
}

/**
 * Longest Road length of every player, indexed by PlayerId, as the award counts it: the road
 * trail, changed by expansions' roadLength hooks (Seafarers: trade routes).
 */
export function longestRoadLengths(state: GameState): number[] {
  const hooked = hasRoadLengthHook(state);
  return state.players.map((p) => {
    const base = longestRoadLength(state, p.id);
    return hooked ? hookRoadLength(state, p.id, base) : base;
  });
}
