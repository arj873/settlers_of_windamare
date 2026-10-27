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
  hookRoadPath,
} from '../expansions/hooks';
import type { RouteTrail } from '../expansions/types';
import { edgeVertices, topologyOf, vertexEdges } from '../topology';
import { roadsOf } from '../selectors';
import type { EdgeId, GameState, PlayerId, VertexId } from '../types';

export function longestRoadLength(state: GameState, player: PlayerId): number {
  return longestRoadTrail(state, player).length;
}

/**
 * The longest road trail of `player` and its edges in order (one of them on a tie). `weight`
 * counts an edge more than once (T&B Caravans: a road under a camel counts twice).
 */
export function longestRoadTrail(
  state: GameState,
  player: PlayerId,
  weight: (e: EdgeId) => number = () => 1,
): RouteTrail {
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
  const path: EdgeId[] = [];
  let best: RouteTrail = { length: 0, edges: [] };
  const walk = (v: VertexId, len: number): void => {
    if (len > best.length) best = { length: len, edges: [...path] };
    for (const e of vertexEdges(t, v)) {
      if (roads[e] !== player || used.has(e)) continue;
      const [a, b] = edgeVertices(t, e) as [VertexId, VertexId];
      const next = a === v ? b : a;
      const w = weight(e);
      if (blocked(next)) {
        if (len + w > best.length) best = { length: len + w, edges: [...path, e] };
        continue;
      }
      used.add(e);
      path.push(e);
      walk(next, len + w);
      path.pop();
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

/**
 * The edges of `player`'s counted Longest Road (#51: drawn on the board): the road trail, or an
 * expansion's longer route (roadPath hooks: Seafarers ships, T&B camels). [] when the award's
 * length is 0 for them (no roads, or a module that switches the award off).
 */
export function longestRoadPath(state: GameState, player: PlayerId): EdgeId[] {
  if ((longestRoadLengths(state)[player] ?? 0) === 0) return [];
  const base = longestRoadTrail(state, player);
  return [...hookRoadPath(state, player, base).edges];
}
