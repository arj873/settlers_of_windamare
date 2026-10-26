/** Board model generalisation (docs/EXPANSIONS.md §6): hex-list frames, sea geometry, helpers. */
import { describe, expect, it } from 'vitest';
import { assembleBoard, dealTokens } from '../board';
import {
  hexNeighbors,
  isBoardEdge,
  isSeaEdge,
  isWaterHex,
  topologyFor,
  topologyOfFrame,
} from '../topology';
import { Rng } from '../rng';
import { FRAME_STD19, type HexListFrameDef } from '../maps';
import type { HexId, Terrain } from '../types';
import { doubledToHexId, NO_ROBBER } from './ext';
import { emptyBoardGame } from '../actions/testkit';
import { cornerVertex, sideEdge } from '../hex';
import { canPlaceRoad, edgeTouchesLand } from '../rules/placement';

/** Two islands: a 3-hex triangle and a single hex, an interior strait and extra open ocean. */
const ISLANDS: HexListFrameDef = {
  id: 'test/islands',
  hexes: ['h:0,0', 'h:1,0', 'h:0,1', 'h:3,0'],
  sea: ['h:2,0', 'h:5,-1', 'h:5,0'],
  harbors: [['h:1,-1', 'h:1,0']],
};

describe('hex-list frames', () => {
  const t = topologyOfFrame(ISLANDS);

  it('keeps the listed hex order and finds every water hex', () => {
    expect(t.landHexes).toEqual(ISLANDS.hexes);
    expect(isWaterHex(t, 'h:2,0')).toBe(true); // the strait (also in the ring)
    expect(isWaterHex(t, 'h:5,-1')).toBe(true); // explicit open ocean, not touching land
    expect(isWaterHex(t, 'h:0,0')).toBe(false);
    expect(new Set(t.waterHexes).size).toBe(t.waterHexes.length);
    expect(hexNeighbors(t, 'h:3,0')).toEqual([]); // the single-hex island
  });

  it('builds sea geometry: land vertices/edges get seas, sea-only ones are separate', () => {
    expect(t.vertices).toHaveLength(13 + 6); // the 3-hex triangle + the single island
    for (const v of t.vertices) expect(t.seaVertex[v]).toBeUndefined();
    // Every coastal edge touches a frame water hex (it is a ship edge AND a road edge).
    for (const e of t.edges) {
      const info = t.edge[e];
      if (info?.coastal) expect(isSeaEdge(t, e), e).toBe(true);
      else expect(info?.seas, e).toEqual([]);
    }
    // Open ocean: sea-only vertices/edges exist, are not road edges, and connect to each other.
    expect(t.seaEdges.length).toBeGreaterThan(0);
    for (const e of t.seaEdges) {
      expect(isBoardEdge(t, e)).toBe(false);
      expect(isSeaEdge(t, e)).toBe(true);
      expect(t.seaEdge[e]?.hexes).toEqual([]);
      expect(t.seaEdge[e]?.edges.length).toBeGreaterThanOrEqual(2);
    }
    for (const v of t.seaVertices) expect(t.seaVertex[v]?.seas.length).toBeGreaterThan(0);
  });

  it('marks listed sea as playable, the automatic ring as frame', () => {
    expect(t.water['h:5,-1']?.playable).toBe(true);
    expect(t.water['h:2,0']?.playable).toBe(true); // listed, though also in the ring
    expect(t.water['h:1,-1']?.playable).toBe(false);
    expect(Object.values(topologyFor('base').water).every((w) => !w.playable)).toBe(true);
  });

  it('roads need an edge next to a land hex (a hex revealed as sea is not)', () => {
    const s = emptyBoardGame();
    const coast = sideEdge(0, -2, 'NE'); // h:0,-2's outer side: its only board hex is h:0,-2
    s.pieces.buildings[cornerVertex(0, -2, 'N')] = { owner: 0, kind: 'settlement' };
    expect(canPlaceRoad(s, 0, coast)).toBe(true);
    const tile = s.board.hexes['h:0,-2'];
    if (!tile) throw new Error('no hex');
    s.board = { ...s.board, hexes: { ...s.board.hexes, 'h:0,-2': { ...tile, terrain: 'sea' } } };
    expect(edgeTouchesLand(s, coast)).toBe(false);
    expect(canPlaceRoad(s, 0, coast)).toBe(false);
  });

  it('places explicit harbors and accepts frames without any', () => {
    expect(t.portSlots).toHaveLength(1);
    expect(t.portSlots[0]?.waterHex).toBe('h:1,-1');
    const bare = topologyOfFrame({ id: 'test/bare', hexes: ['h:0,0'], harbors: [] });
    expect(bare.portSlots).toEqual([]);
    expect(bare.coastalEdges).toHaveLength(6);
  });

  it('rejects a harbor that does not face its land hex', () => {
    expect(() =>
      topologyOfFrame({ id: 'test/badharbor', hexes: ['h:0,0'], harbors: [['h:3,3', 'h:0,0']] }),
    ).toThrow(/bad harbor/);
  });

  it('assembles boards from per-hex terrain and deals tokens without adjacent 6/8', () => {
    // The triangle's 3 hexes touch each other, so at most one of them may get a 6 or 8.
    const terrains: Terrain[] = ['grain', 'ore', 'gold', 'fog'];
    expect(() => dealTokens(new Rng(3), t, terrains, [6, 8, 5])).toThrow(/could not place/);
    const tokens = dealTokens(new Rng(3), t, terrains, [6, 4, 5]);
    expect(tokens[3]).toBeNull(); // fog gets no token
    const red = (n: number | null) => n === 6 || n === 8;
    const at = new Map(t.landHexes.map((h, i) => [h, tokens[i] ?? null]));
    for (const h of t.landHexes) {
      if (red(at.get(h) ?? null)) {
        for (const n of hexNeighbors(t, h)) expect(red(at.get(n) ?? null)).toBe(false);
      }
    }
    expect(() => dealTokens(new Rng(1), t, terrains, [6])).toThrow(/need 3 tokens/);
    const { board, deserts } = assembleBoard(t, terrains, tokens, ['ore']);
    expect(deserts).toEqual([]);
    expect(board.hexes['h:3,0']).toMatchObject({ terrain: 'fog', token: null });
    expect(board.ports[0]).toMatchObject({ kind: 'ore', waterHex: 'h:1,-1' });
  });
});

describe('base frames are unchanged by the sea geometry', () => {
  it('19-hex board: same counts as before, plus the outer ring as sea-only', () => {
    const t = topologyFor('base');
    expect([t.landHexes.length, t.waterHexes.length, t.vertices.length, t.edges.length]).toEqual([
      19, 18, 54, 72,
    ]);
    expect(t).toBe(topologyOfFrame(FRAME_STD19));
    // Land vertices keep land-only edge lists (road rules unchanged).
    for (const v of t.vertices) {
      for (const e of t.vertex[v]?.edges ?? []) expect(isBoardEdge(t, e)).toBe(true);
    }
    expect(t.seaEdges.length).toBeGreaterThan(0);
  });
});

describe('helpers', () => {
  it('doubledToHexId converts the rules docs tables (q = (c - r - p) / 2)', () => {
    expect(doubledToHexId(1, 0, 1)).toBe('h:0,0');
    expect(doubledToHexId(4, 2, 0)).toBe('h:1,2');
    expect(doubledToHexId(0, 1, 1)).toBe('h:-1,1');
    expect(() => doubledToHexId(1, 0, 0)).toThrow(/parity/);
  });

  it('NO_ROBBER is off every board', () => {
    expect(isWaterHex(topologyFor('base78'), NO_ROBBER)).toBe(false);
    const hex: HexId = NO_ROBBER;
    expect(topologyFor('base78').hex[hex]).toBeUndefined();
  });
});
