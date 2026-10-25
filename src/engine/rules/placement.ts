/**
 * Geometric placement rules shared by setup (T2), building (T2) and Road Building (T3).
 * These check the board only — NOT cost, phase, or remaining pieces (see piecesLeft).
 */
import {
  edgeVertices,
  isBoardEdge,
  isBoardVertex,
  vertexEdges,
  vertexNeighbors,
} from '../topology';
import type { EdgeId, GameState, PlayerId, VertexId } from '../types';

/** Distance rule: vertex empty and all adjacent vertices empty. */
export function isVertexOpen(state: GameState, v: VertexId): boolean {
  if (!isBoardVertex(v)) return false;
  const b = state.pieces.buildings;
  return b[v] === undefined && vertexNeighbors(v).every((n) => b[n] === undefined);
}

/** True if `player` has a road on any edge touching vertex `v`. */
export function touchesOwnRoad(state: GameState, player: PlayerId, v: VertexId): boolean {
  return vertexEdges(v).some((e) => state.pieces.roads[e] === player);
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
  if (!isVertexOpen(state, v)) return false;
  return !opts.requireRoad || touchesOwnRoad(state, player, v);
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
  if (!isBoardEdge(e) || state.pieces.roads[e] !== undefined) return false;
  const ends = edgeVertices(e);
  if (opts.fromVertex !== undefined) return ends.includes(opts.fromVertex);
  return ends.some((v) => {
    const b = state.pieces.buildings[v];
    if (b !== undefined) return b.owner === player;
    return vertexEdges(v).some((other) => other !== e && state.pieces.roads[other] === player);
  });
}
