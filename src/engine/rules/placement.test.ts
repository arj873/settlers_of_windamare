import { describe, expect, it } from 'vitest';
import { freshGame } from '../fixtures';
import { cornerVertex, sideEdge } from '../hex';
import type { GameState } from '../types';
import { canPlaceCity, canPlaceRoad, canPlaceSettlement, isVertexOpen } from './placement';

const V = cornerVertex(0, 0, 'N');
const V_NE = cornerVertex(0, 0, 'NE'); // adjacent to V
const E_N_NE = sideEdge(0, 0, 'NE'); // V -> V_NE
const E_NE_SE = sideEdge(0, 0, 'E'); // V_NE -> SE

function withSettlement(owner = 0): GameState {
  const s = freshGame();
  s.pieces.buildings[V] = { owner, kind: 'settlement' };
  return s;
}

describe('distance rule', () => {
  it('blocks the vertex itself and its neighbors', () => {
    const s = withSettlement();
    expect(isVertexOpen(s, V)).toBe(false);
    expect(isVertexOpen(s, V_NE)).toBe(false);
    expect(isVertexOpen(s, cornerVertex(0, 0, 'SE'))).toBe(true);
  });

  it('rejects off-board vertices', () => {
    expect(isVertexOpen(freshGame(), 'v:9,9,N')).toBe(false);
  });
});

describe('canPlaceSettlement', () => {
  it('needs no road in setup', () => {
    expect(canPlaceSettlement(freshGame(), 0, V, { requireRoad: false })).toBe(true);
  });

  it('needs an own road otherwise', () => {
    const s = freshGame();
    const target = cornerVertex(0, 0, 'SE');
    expect(canPlaceSettlement(s, 0, target, { requireRoad: true })).toBe(false);
    s.pieces.roads[E_NE_SE] = 1;
    expect(canPlaceSettlement(s, 0, target, { requireRoad: true })).toBe(false);
    s.pieces.roads[E_NE_SE] = 0;
    expect(canPlaceSettlement(s, 0, target, { requireRoad: true })).toBe(true);
  });
});

describe('canPlaceCity', () => {
  it('upgrades only own settlements', () => {
    const s = withSettlement(0);
    expect(canPlaceCity(s, 0, V)).toBe(true);
    expect(canPlaceCity(s, 1, V)).toBe(false);
    expect(canPlaceCity(s, 0, V_NE)).toBe(false);
    s.pieces.buildings[V] = { owner: 0, kind: 'city' };
    expect(canPlaceCity(s, 0, V)).toBe(false);
  });
});

describe('canPlaceRoad', () => {
  it('connects from an own building', () => {
    const s = withSettlement(0);
    expect(canPlaceRoad(s, 0, E_N_NE)).toBe(true);
    expect(canPlaceRoad(s, 1, E_N_NE)).toBe(false);
  });

  it('connects from an own road', () => {
    const s = withSettlement(0);
    s.pieces.roads[E_N_NE] = 0;
    expect(canPlaceRoad(s, 0, E_NE_SE)).toBe(true);
    expect(canPlaceRoad(s, 0, E_N_NE)).toBe(false); // occupied
  });

  it('cannot pass through an opponent building', () => {
    const s = freshGame();
    s.pieces.roads[E_N_NE] = 0;
    s.pieces.buildings[V_NE] = { owner: 1, kind: 'settlement' };
    expect(canPlaceRoad(s, 0, E_NE_SE)).toBe(false);
  });

  it('setup roads must touch the given settlement', () => {
    const s = withSettlement(0);
    expect(canPlaceRoad(s, 0, E_N_NE, { fromVertex: V })).toBe(true);
    expect(canPlaceRoad(s, 0, E_NE_SE, { fromVertex: V })).toBe(false);
  });

  it('rejects off-board edges', () => {
    expect(canPlaceRoad(withSettlement(), 0, 'e:9,9,E')).toBe(false);
  });
});
