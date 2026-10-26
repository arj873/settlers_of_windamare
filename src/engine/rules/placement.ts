/**
 * Geometric placement rules shared by setup (T2), building (T2) and Road Building (T3).
 * These check the board only — NOT cost, phase, or remaining pieces (see piecesLeft).
 */
import {
  edgeVertices,
  isBoardEdge,
  isBoardVertex,
  topologyOf,
  vertexEdges,
  vertexHexes,
  vertexNeighbors,
} from '../topology';
import { blocksRoute, edgeBlocked, terrainKind, vertexBlocked } from '../expansions/hooks';
import type { EdgeId, GameState, PlayerId, VertexId } from '../types';

/** Distance rule: vertex empty and all adjacent vertices empty. */
export function isVertexOpen(state: GameState, v: VertexId): boolean {
  const t = topologyOf(state);
  if (!isBoardVertex(t, v)) return false;
  const b = state.pieces.buildings;
  return (
    b[v] === undefined &&
    vertexNeighbors(t, v).every((n) => b[n] === undefined) &&
    !vertexBlocked(state, v)
  );
}

/** True if `player` has a road on any edge touching vertex `v`. */
export function touchesOwnRoad(state: GameState, player: PlayerId, v: VertexId): boolean {
  return vertexEdges(topologyOf(state), v).some((e) => state.pieces.roads[e] === player);
}

/**
 * Settlement placement. `requireRoad: false` for setup, `true` for normal building
 * (must touch one of the player's roads).
 */
export function canPlaceSettlement(
  state: GameState,
  player: PlayerId,
  v: VertexId,
  opts: { requireRoad: boolean },
): boolean {
  if (!isVertexOpen(state, v) || !touchesLand(state, v)) return false;
  return !opts.requireRoad || touchesOwnRoad(state, player, v);
}

/**
 * The edge borders a land hex (terrainKind 'land'): a road edge. Always true on base boards; an
 * edge between revealed-sea / fog board hexes is not.
 */
export function edgeTouchesLand(state: GameState, e: EdgeId): boolean {
  return (topologyOf(state).edge[e]?.hexes ?? []).some((h) => {
    const tile = state.board.hexes[h];
    return tile !== undefined && terrainKind(tile.terrain) === 'land';
  });
}

/**
 * The vertex touches a land hex (terrainKind 'land'). Always true on base boards; on scenario
 * boards a vertex between sea / fog board hexes is not settleable.
 */
export function touchesLand(state: GameState, v: VertexId): boolean {
  return vertexHexes(topologyOf(state), v).some((h) => {
    const tile = state.board.hexes[h];
    return tile !== undefined && terrainKind(tile.terrain) === 'land';
  });
}

/** City placement: must upgrade one of the player's own settlements. */
export function canPlaceCity(state: GameState, player: PlayerId, v: VertexId): boolean {
  const b = state.pieces.buildings[v];
  return b !== undefined && b.owner === player && b.kind === 'settlement';
}

/**
 * Road placement. Edge must be empty and connect to the player's network:
 * an endpoint holds the player's building, or an endpoint (not blocked by an
 * opponent's building) touches one of the player's roads.
 * Setup: pass `fromVertex` (the settlement just placed) — the road must touch it.
 */
export function canPlaceRoad(
  state: GameState,
  player: PlayerId,
  e: EdgeId,
  opts: { fromVertex?: VertexId } = {},
): boolean {
  const t = topologyOf(state);
  if (!isBoardEdge(t, e) || state.pieces.roads[e] !== undefined) return false;
  if (edgeBlocked(state, e) || !edgeTouchesLand(state, e)) return false;
  const ends = edgeVertices(t, e);
  if (opts.fromVertex !== undefined) return ends.includes(opts.fromVertex);
  return ends.some((v) => {
    const b = state.pieces.buildings[v];
    if (b !== undefined) return b.owner === player;
    if (blocksRoute(state, v, player)) return false;
    return vertexEdges(t, v).some((other) => other !== e && state.pieces.roads[other] === player);
  });
}
