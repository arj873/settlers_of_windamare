import { describe, expect, it } from 'vitest';
import { cornerVertex, sideEdge } from '../hex';
import { edgeVertices, topologyOf } from '../topology';
import type { EdgeId, GameState } from '../types';
import {
  longestRoadLength,
  longestRoadLengths,
  longestRoadPath,
  longestRoadTrail,
} from './longestRoad';
import { addRoads, emptyBoard, ring, settle, zigzag, zigzagJoint } from './roadTestBoard';

function len(edges: EdgeId[], setup?: (s: GameState) => void): number {
  const s = emptyBoard();
  addRoads(s, 0, edges);
  setup?.(s);
  return longestRoadLength(s, 0);
}

describe('longestRoadLength', () => {
  it('is 0 without roads and 1 for a single road', () => {
    expect(len([])).toBe(0);
    expect(len(zigzag(-2, 0, 1))).toBe(1);
  });

  it('counts a straight chain', () => {
    expect(len(zigzag(-2, 0, 7))).toBe(7);
    expect(len(zigzag(-2, 0, 10))).toBe(10);
  });

  it('takes the longer of two disjoint networks', () => {
    expect(len([...zigzag(-2, 0, 3), ...zigzag(-2, 1, 4)])).toBe(4);
  });

  it('does not count both arms of a fork', () => {
    // Trunk of 6 along row 0; at the joint after edge 1 a 3-edge branch goes down.
    // Arms from that joint: 2 (left), 4 (right), 3 (branch) -> best trail 4 + 3 = 7 of 9 roads.
    const branch = [sideEdge(-2, 0, 'E'), sideEdge(-2, 1, 'NE'), sideEdge(-2, 1, 'E')];
    expect(len([...zigzag(-2, 0, 6), ...branch])).toBe(7);
  });

  it('counts a closed loop fully', () => {
    expect(len(ring(0, 0))).toBe(6);
  });

  it('counts a loop plus a tail', () => {
    // E side of (0,-1) touches the N corner of (0,0).
    expect(len([...ring(0, 0), sideEdge(0, -1, 'E')])).toBe(7);
  });

  it('counts every edge of two loops sharing a side (Euler trail)', () => {
    const edges = [...new Set([...ring(0, 0), ...ring(1, 0)])];
    expect(edges).toHaveLength(11);
    expect(len(edges)).toBe(11);
  });

  it('is broken by an opponent building in the middle', () => {
    const road = zigzag(-2, 0, 6);
    expect(len(road, (s) => settle(s, 1, zigzagJoint(-2, 0, 2)))).toBe(3);
    expect(len(road, (s) => settle(s, 1, zigzagJoint(-2, 0, 1)))).toBe(4);
  });

  it('is not broken by an opponent city either', () => {
    const road = zigzag(-2, 0, 6);
    const v = zigzagJoint(-2, 0, 2);
    expect(len(road, (s) => (s.pieces.buildings[v] = { owner: 2, kind: 'city' }))).toBe(3);
  });

  it("is not broken by the player's own building", () => {
    expect(len(zigzag(-2, 0, 6), (s) => settle(s, 0, zigzagJoint(-2, 0, 2)))).toBe(6);
  });

  it('is not shortened by an opponent building at an end', () => {
    expect(len(zigzag(-2, 0, 6), (s) => settle(s, 1, cornerVertex(-2, 0, 'NW')))).toBe(6);
  });

  it('keeps a loop whole when an opponent sits on one of its corners', () => {
    expect(len(ring(0, 0), (s) => settle(s, 1, cornerVertex(0, 0, 'S')))).toBe(6);
  });

  it('cannot pass through an opponent at the loop/tail junction', () => {
    const edges = [...ring(0, 0), sideEdge(0, -1, 'E')];
    expect(len(edges, (s) => settle(s, 1, cornerVertex(0, 0, 'N')))).toBe(6);
  });

  it('ignores opponent roads', () => {
    expect(
      len(zigzag(-2, 0, 4), (s) => {
        addRoads(s, 1, [sideEdge(-2, 0, 'E'), ...zigzag(0, 0, 4)]);
      }),
    ).toBe(4);
  });

  it('reports every player', () => {
    const s = emptyBoard();
    addRoads(s, 0, zigzag(-2, 0, 5));
    addRoads(s, 2, zigzag(-2, 1, 3));
    expect(longestRoadLengths(s)).toEqual([5, 0, 3, 0]);
  });
});

/** `edges` form one trail: distinct, each consecutive pair sharing a vertex. */
function isTrail(s: GameState, edges: readonly EdgeId[]): boolean {
  const t = topologyOf(s);
  if (new Set(edges).size !== edges.length) return false;
  return edges.every((e, i) => {
    const prev = edges[i - 1];
    if (prev === undefined) return true;
    const a = edgeVertices(t, prev);
    return edgeVertices(t, e).some((v) => a.includes(v));
  });
}

// #51: the board draws the counted road.
describe('longestRoadTrail / longestRoadPath', () => {
  function path(edges: EdgeId[], setup?: (s: GameState) => void) {
    const s = emptyBoard();
    addRoads(s, 0, edges);
    setup?.(s);
    return { s, trail: longestRoadTrail(s, 0), path: longestRoadPath(s, 0) };
  }

  it('is empty without roads', () => {
    expect(path([]).path).toEqual([]);
    expect(path([]).trail).toEqual({ length: 0, edges: [] });
  });

  it('is the whole chain, in order', () => {
    const road = zigzag(-2, 0, 6);
    const { s, path: p } = path(road);
    expect(new Set(p)).toEqual(new Set(road));
    expect(isTrail(s, p)).toBe(true);
  });

  it('leaves the shorter arm of a fork out', () => {
    const branch = [sideEdge(-2, 0, 'E'), sideEdge(-2, 1, 'NE'), sideEdge(-2, 1, 'E')];
    const { s, path: p } = path([...zigzag(-2, 0, 6), ...branch]);
    expect(p).toHaveLength(7);
    expect(isTrail(s, p)).toBe(true);
    expect(p).toEqual(expect.arrayContaining(branch));
    // The left arm (2 roads) is the one left out.
    expect(p).not.toContain(zigzag(-2, 0, 6)[0]);
  });

  it('covers a loop plus its tail', () => {
    const edges = [...ring(0, 0), sideEdge(0, -1, 'E')];
    const { s, path: p } = path(edges);
    expect(new Set(p)).toEqual(new Set(edges));
    expect(isTrail(s, p)).toBe(true);
  });

  it('stops at an opponent building', () => {
    const road = zigzag(-2, 0, 7);
    // Cut after road 3 of 7: the 4 roads past the opponent count, the 3 before do not.
    const { s, path: p } = path(road, (st) => settle(st, 1, zigzagJoint(-2, 0, 2)));
    expect(p).toHaveLength(4);
    expect(p).not.toContain(road[0]);
    expect(isTrail(s, p)).toBe(true);
  });

  it("matches the award's length for every player", () => {
    const s = emptyBoard();
    addRoads(s, 0, zigzag(-2, 0, 5));
    addRoads(s, 2, [...ring(0, 0), sideEdge(0, -1, 'E')]);
    const lengths = longestRoadLengths(s);
    for (const p of s.players) expect(longestRoadPath(s, p.id)).toHaveLength(lengths[p.id] ?? 0);
  });

  it('weights edges (T&B camels count a road twice)', () => {
    const road = zigzag(-2, 0, 4);
    const s = emptyBoard();
    addRoads(s, 0, road);
    expect(longestRoadTrail(s, 0, (e) => (e === road[1] ? 2 : 1)).length).toBe(5);
  });
});
