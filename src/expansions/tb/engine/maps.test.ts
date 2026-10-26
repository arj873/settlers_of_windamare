/** T&B boards (docs/rules/traders-barbarians.md §2): terrain / token / component counts. */
import { describe, expect, it } from 'vitest';
import { generateBoard } from '../../../engine/board';
import { Rng } from '../../../engine/rng';
import { topologyFor } from '../../../engine/topology';
import type { Board, HexId, MapId, Terrain } from '../../../engine/types';
import {
  CASTLE,
  GLASSWORKS,
  LAKE,
  OASIS,
  QUARRY,
  SWAMP,
  TRADE_CASTLE,
  caravanStart,
  type TbBoard,
} from '.';

const gen = (map: MapId, seed = 1, n = 4) => generateBoard(map, new Rng(seed), n);
const count = (b: Board, t: Terrain) =>
  Object.values(b.hexes).filter((h) => h.terrain === t).length;
const tokens = (b: Board) =>
  Object.values(b.hexes)
    .map((h) => h.token)
    .filter((t): t is number => t !== null)
    .sort((a, z) => a - z);
const ext = (b: Board) => b.ext?.['tb'] as TbBoard;

describe('Fishermen', () => {
  it('3-4: one inner lake (2,3,11,12), no desert, 18 tokens, 6 fishing grounds 4-10', () => {
    for (const seed of [1, 2, 3]) {
      const { board, robber } = gen('tb/fish19', seed);
      expect(count(board, LAKE)).toBe(1);
      expect(count(board, 'desert')).toBe(0);
      expect(tokens(board)).toHaveLength(18);
      const e = ext(board);
      const lake = e.lakes?.[0];
      expect(lake?.numbers).toEqual([2, 3, 11, 12]);
      expect(topologyFor('tb/fish19').hex[lake?.hex as HexId]?.neighbors).toHaveLength(6);
      expect(e.grounds?.map((g) => g.number).sort((a, z) => a - z)).toEqual([4, 5, 6, 8, 9, 10]);
      for (const g of e.grounds ?? []) expect(g.vertices.length).toBeGreaterThanOrEqual(2);
      const all = (e.grounds ?? []).flatMap((g) => g.vertices);
      expect(new Set(all).size).toBe(all.length);
      expect(robber).toBe('h:999,999');
    }
  });

  it('5-6: two lakes, 8 fishing grounds, 28 tokens', () => {
    const { board } = gen('tb/fish30', 1, 6);
    expect(count(board, LAKE)).toBe(2);
    expect(tokens(board)).toHaveLength(28);
    expect(ext(board).grounds).toHaveLength(8);
    expect(ext(board).lakes?.map((l) => l.numbers)).toEqual([
      [2, 3, 11, 12],
      [4, 10],
    ]);
  });
});

describe('Rivers', () => {
  it('3-4: 7 river hexes incl. 2 swamps, 7 bridge sites, 17 tokens, the 2 on the 12', () => {
    const { board, robber } = gen('tb/rivers19');
    const e = ext(board);
    expect(e.rivers).toHaveLength(7);
    expect(count(board, SWAMP)).toBe(2);
    expect(e.bridgeSites).toHaveLength(7);
    expect(tokens(board)).toHaveLength(17);
    expect(tokens(board)).not.toContain(2);
    expect(board.hexes[e.twoOnTwelve as HexId]?.token).toBe(12);
    expect(board.hexes[robber]?.terrain).toBe(SWAMP);
    // Land: forest 4, pasture 3, fields 4, hills 3, mountains 3, swamp 2.
    expect([count(board, 'lumber'), count(board, 'wool'), count(board, 'grain')]).toEqual([
      4, 3, 4,
    ]);
    expect([count(board, 'brick'), count(board, 'ore')]).toEqual([3, 3]);
  });

  it('5-6: 10 river hexes, 11 bridge sites, 28 tokens, no 2-on-12', () => {
    const { board } = gen('tb/rivers30', 1, 6);
    expect(ext(board).rivers).toHaveLength(10);
    expect(ext(board).bridgeSites).toHaveLength(11);
    expect(tokens(board)).toHaveLength(28);
    expect(ext(board).twoOnTwelve).toBeNull();
  });
});

describe('Caravans', () => {
  it('3-4: oasis at the centre, 3 caravan starts leaving the NW, NE and S corners', () => {
    const { board } = gen('tb/caravans19');
    expect(board.hexes['h:0,0']?.terrain).toBe(OASIS);
    expect(tokens(board)).toHaveLength(18);
    expect(ext(board).caravanStarts).toEqual([
      { edge: 'e:-1,0,NE', head: 'v:-1,0,N' },
      { edge: 'e:1,-1,SE', head: 'v:1,0,N' },
      { edge: 'e:-1,1,E', head: 'v:-1,2,N' },
    ]);
  });

  it('a caravan start never uses an oasis side', () => {
    const t = topologyFor('tb/caravans19');
    const s = caravanStart(t, 'h:0,0', 'NW');
    expect(t.hex['h:0,0']?.edges).not.toContain(s.edge);
  });

  it('5-6: two oases, 6 starts', () => {
    const { board } = gen('tb/caravans30', 1, 6);
    expect(count(board, OASIS)).toBe(2);
    expect(ext(board).caravanStarts).toHaveLength(6);
  });
});

describe('Barbarian Attack', () => {
  it('3-4: castle and desert fixed, the printed numbers, every number once on the coast', () => {
    const { board } = gen('tb/ba19');
    expect(board.hexes['h:-2,2']?.terrain).toBe(CASTLE);
    expect(board.hexes['h:2,-2']?.terrain).toBe('desert');
    expect(board.hexes['h:0,2']?.token).toBe(2);
    expect(board.hexes['h:-2,0']?.token).toBe(12);
    const coast = ext(board).coast ?? [];
    expect(coast).toHaveLength(10);
    expect(coast[0]).toBe('h:-2,1');
    const nums = coast.map((h) => board.hexes[h]?.token).sort((a, z) => (a ?? 0) - (z ?? 0));
    expect(nums).toEqual([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
  });

  it('5-6: two castles, two deserts, 5 and 9 twice on the coast', () => {
    const { board } = gen('tb/ba30', 1, 6);
    expect(count(board, CASTLE)).toBe(2);
    expect(count(board, 'desert')).toBe(2);
    const coastNums = (ext(board).coast ?? []).map((h) => board.hexes[h]?.token);
    expect(coastNums.filter((n) => n === 5)).toHaveLength(2);
    expect(coastNums.filter((n) => n === 9)).toHaveLength(2);
  });
});

describe('Traders & Barbarians', () => {
  it('3-4: three trade hexes at fixed corners, 16 tokens without 2 and 12, no desert', () => {
    const { board } = gen('tb/traders19');
    expect(board.hexes['h:-2,0']?.terrain).toBe(TRADE_CASTLE);
    expect(board.hexes['h:2,-2']?.terrain).toBe(QUARRY);
    expect(board.hexes['h:0,2']?.terrain).toBe(GLASSWORKS);
    expect(count(board, 'desert')).toBe(0);
    expect(tokens(board)).toHaveLength(16);
    expect(tokens(board)).not.toContain(2);
    expect(tokens(board)).not.toContain(12);
    expect(board.ports).toHaveLength(9);
  });

  it('3-4: plazas with 4 spokes; the sea-only corners and sea sides are banned', () => {
    const t = topologyFor('tb/traders19');
    expect(t.vertex['v:2,-2,C']?.edges).toHaveLength(4);
    const e = ext(gen('tb/traders19').board);
    expect(e.noBuild).toHaveLength(6);
    expect(e.noBuild).toContain('v:2,-2,N'); // the quarry's N corner
    expect(e.noRoad).toHaveLength(9);
  });

  it('5-6: 37 hexes, 7 trade hexes with 6 spokes each, 2 deserts, 28 printed numbers', () => {
    const { board } = gen('tb/traders37', 1, 6);
    expect(Object.keys(board.hexes)).toHaveLength(37);
    expect(board.hexes['h:0,0']?.terrain).toBe(TRADE_CASTLE);
    expect(count(board, QUARRY)).toBe(3);
    expect(count(board, GLASSWORKS)).toBe(3);
    expect(count(board, 'desert')).toBe(2);
    expect(tokens(board)).toHaveLength(28);
    expect(topologyFor('tb/traders37').vertex['v:0,0,C']?.edges).toHaveLength(6);
    expect(ext(board).noBuild).toEqual([]);
  });
});

describe('determinism', () => {
  it('the same seed gives the same board', () => {
    for (const m of [
      'tb/fish19',
      'tb/rivers19',
      'tb/caravans19',
      'tb/ba19',
      'tb/traders19',
    ] as const) {
      expect(gen(m, 5)).toEqual(gen(m, 5));
    }
  });
});
