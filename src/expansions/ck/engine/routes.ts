/**
 * Knight routes (§4.2, CK-25, CK-26, CK-29): walking a player's own roads, passing over their own
 * pieces but never over a foreign building or knight. Also the Diplomat's "open road" (§4.6).
 *
 * Other modules may add edges to a player's route (`routeEdges` hook: Seafarers + C&K ships);
 * the walk then also crosses sea vertices, where a knight can stand but never be recruited.
 */
import { blocksRoute, extraRouteEdges, terrainKind } from '../../../engine/expansions/hooks';
import { touchesLand } from '../../../engine/rules/placement';
import {
  edgeInfo,
  edgeVertices,
  topologyOf,
  vertexEdges,
  vertexHexes,
} from '../../../engine/topology';
import type { EdgeId, GameState, PlayerId, VertexId } from '../../../engine/types';
import { ckSlice } from './state';

/** No seat: other modules' pieces that block every player's route (`blocksRoute`). */
const NOBODY = -1 as PlayerId;

/**
 * Does a piece of someone other than `player` stand on `v` (building or knight, or another
 * module's route blocker: Catan for Two's neutral settlements)?
 */
export function foreignPieceAt(state: GameState, v: VertexId, player: PlayerId): boolean {
  const b = state.pieces.buildings[v];
  if (b && b.owner !== player) return true;
  const k = ckSlice(state).knights[v];
  if (k !== undefined) return k.owner !== player;
  return b === undefined && blocksRoute(state, v, player);
}

/** Is `v` empty (no building, no knight, no other module's piece: a neutral settlement)? */
export function isEmptyVertex(state: GameState, v: VertexId): boolean {
  return (
    state.pieces.buildings[v] === undefined &&
    ckSlice(state).knights[v] === undefined &&
    !blocksRoute(state, v, NOBODY)
  );
}

/** `player`'s route edges at each vertex: roads, plus other modules' route pieces (ships). */
function routeAt(state: GameState, player: PlayerId): (v: VertexId) => readonly EdgeId[] {
  const t = topologyOf(state);
  const roads = state.pieces.roads;
  const extra = extraRouteEdges(state, player);
  const own = (v: VertexId) => vertexEdges(t, v).filter((e) => roads[e] === player);
  if (extra.length === 0) return own;
  const more = new Map<VertexId, EdgeId[]>();
  for (const e of extra) {
    for (const v of edgeInfo(t, e)?.vertices ?? []) more.set(v, [...(more.get(v) ?? []), e]);
  }
  return (v) => [...own(v), ...(more.get(v) ?? [])];
}

/**
 * Every vertex reachable from `from` along `player`'s roads. The walk passes over vertices with
 * the player's own pieces (or nothing) and stops at a foreign piece: such a vertex is reached
 * (it is a possible displacement target) but not walked through. `from` itself is included.
 */
export function reachable(state: GameState, player: PlayerId, from: VertexId): Set<VertexId> {
  const t = topologyOf(state);
  const edgesAt = routeAt(state, player);
  const seen = new Set<VertexId>([from]);
  const stack: VertexId[] = [from];
  while (stack.length > 0) {
    const v = stack.pop() as VertexId;
    if (v !== from && foreignPieceAt(state, v, player)) continue;
    for (const e of edgesAt(v)) {
      for (const w of edgeInfo(t, e)?.vertices ?? []) {
        if (!seen.has(w)) {
          seen.add(w);
          stack.push(w);
        }
      }
    }
  }
  return seen;
}

/** Is `v` linked to one of `player`'s settlements / cities by their own route (CK-25)? */
export function connectedToBuilding(state: GameState, player: PlayerId, v: VertexId): boolean {
  if (state.pieces.buildings[v]?.owner === player) return true;
  if (foreignPieceAt(state, v, player)) return false;
  for (const w of reachable(state, player, v)) {
    if (state.pieces.buildings[w]?.owner === player) return true;
  }
  return false;
}

/** Every vertex linked to one of `player`'s buildings by their route (knight spots, legal). */
export function networkOf(state: GameState, player: PlayerId): Set<VertexId> {
  const out = new Set<VertexId>();
  for (const [v, b] of Object.entries(state.pieces.buildings) as [VertexId, { owner: number }][]) {
    if (b.owner !== player || out.has(v)) continue;
    for (const w of reachable(state, player, v)) out.add(w);
  }
  return out;
}

/** Does one of `player`'s roads (or other route pieces) touch `v`? */
export function touchesRoad(state: GameState, player: PlayerId, v: VertexId): boolean {
  return routeAt(state, player)(v).length > 0;
}

/**
 * Is `v` a corner of an unexplored (fog-kind) hex? No knight is recruited or moved there (E&P +
 * C&K sheet: "intersections adjacent to unexplored hexes"; no fog in C&K's other games).
 */
export function besideFog(state: GameState, v: VertexId): boolean {
  return vertexHexes(topologyOf(state), v).some((h) => {
    const t = state.board.hexes[h]?.terrain;
    return t !== undefined && terrainKind(t) === 'fog';
  });
}

/**
 * Can a knight of `player` be recruited on `v`: empty, touching land (never on the open sea),
 * not beside an unexplored hex, touched by their route. The link to a building is checked
 * separately (networkOf).
 */
export function isRecruitSpot(state: GameState, player: PlayerId, v: VertexId): boolean {
  return (
    isEmptyVertex(state, v) &&
    touchesLand(state, v) &&
    !besideFog(state, v) &&
    touchesRoad(state, player, v)
  );
}

/** Can `player` recruit a knight on `v`: a recruit spot linked to a building (§4.2)? */
export function canPlaceKnightAt(state: GameState, player: PlayerId, v: VertexId): boolean {
  return isRecruitSpot(state, player, v) && connectedToBuilding(state, player, v);
}

/** Empty vertices a knight of `player` standing on `from` can move to. */
export function moveTargets(state: GameState, player: PlayerId, from: VertexId): VertexId[] {
  return [...reachable(state, player, from)].filter(
    (w) => w !== from && isEmptyVertex(state, w) && !besideFog(state, w),
  );
}

/**
 * Is `player`'s road `e` open (Diplomat): at one end there is none of the owner's pieces and
 * no other of their roads (a dead end, CK-58)?
 */
export function isOpenRoad(state: GameState, e: EdgeId): boolean {
  const owner = state.pieces.roads[e];
  if (owner === undefined) return false;
  const t = topologyOf(state);
  const s = ckSlice(state);
  return edgeVertices(t, e).some(
    (v) =>
      state.pieces.buildings[v]?.owner !== owner &&
      s.knights[v]?.owner !== owner &&
      !vertexEdges(t, v).some((o) => o !== e && state.pieces.roads[o] === owner),
  );
}
