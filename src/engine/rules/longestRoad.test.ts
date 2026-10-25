import { describe, expect, it } from 'vitest';
import { cornerVertex, sideEdge } from '../hex';
import type { EdgeId, GameState } from '../types';
import { longestRoadLength, longestRoadLengths } from './longestRoad';
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
