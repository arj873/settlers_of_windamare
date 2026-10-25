/** Test helpers for road geometry (used by longestRoad/awards/dev tests). Not used at runtime. */
import { freshGame } from '../fixtures';
import { cornerVertex, sideEdge } from '../hex';
import type { EdgeId, GameState, PlayerId, VertexId } from '../types';

/** Empty board, main phase, 4 players, player 0 to act. */
export function emptyBoard(): GameState {
  const s = freshGame();
  s.pieces = { buildings: {}, roads: {} };
  s.turn = { number: 5, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  return s;
}

/**
 * `n` connected edges zig-zagging along the top of row `r`, starting at hex (q0, r):
 * NW side, NE side of (q0,r), NW side, NE side of (q0+1,r), ...
 */
export function zigzag(q0: number, r: number, n: number): EdgeId[] {
  const out: EdgeId[] = [];
  for (let i = 0; out.length < n; i++) {
    out.push(sideEdge(q0 + i, r, 'NW'));
    if (out.length < n) out.push(sideEdge(q0 + i, r, 'NE'));
  }
  return out;
}

/** The vertex joining edge k and edge k+1 of `zigzag(q0, r, …)`. */
export function zigzagJoint(q0: number, r: number, k: number): VertexId {
  const q = q0 + Math.floor(k / 2);
  return cornerVertex(q, r, k % 2 === 0 ? 'N' : 'NE');
}

/** The 6 sides of hex (q, r). */
export function ring(q: number, r: number): EdgeId[] {
  return (['NE', 'E', 'SE', 'SW', 'W', 'NW'] as const).map((s) => sideEdge(q, r, s));
}

export function addRoads(s: GameState, p: PlayerId, edges: EdgeId[]): void {
  for (const e of edges) s.pieces.roads[e] = p;
}

export function settle(s: GameState, p: PlayerId, v: VertexId): void {
  s.pieces.buildings[v] = { owner: p, kind: 'settlement' };
}
