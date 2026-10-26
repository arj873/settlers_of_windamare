/** Seafarers maps (docs/rules/seafarers.md §2): printed component tables, islands, variable set-ups. */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../../engine/rng';
import { topologyFor } from '../../../engine/topology';
import type { HexId, HexTile, PortKind, Terrain } from '../../../engine/types';
import { cellHex, footprint, parseCell } from './coords';
import {
  components,
  mapIdOf,
  newWorldCounts,
  prepared,
  redsApart,
  SEA_MAPS,
  variableBoard,
  type MapKey,
  type SeaBoard,
} from './maps';

const KEYS = SEA_MAPS.map((m) => m.id.slice('seafarers/'.length) as MapKey);

function count<T extends string | number>(xs: readonly T[]): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}

function fixed(key: MapKey, seed = 1) {
  const def = SEA_MAPS.find((m) => m.id === mapIdOf(key));
  if (!def) throw new Error(key);
  return def.generate(new Rng(seed), def.minPlayers);
}

const terrains = (hexes: Record<HexId, HexTile>) =>
  count(Object.values(hexes).map((h) => h.terrain));
const tokens = (hexes: Record<HexId, HexTile>) =>
  count(Object.values(hexes).flatMap((h) => (h.token === null ? [] : [h.token])));
const harborKinds = (ports: { kind: PortKind }[]) => count(ports.map((p) => p.kind));
/** Land + sea cells of the playing area (board sea hexes + topology sea). */
const seaCells = (key: MapKey, hexes: Record<HexId, HexTile>) =>
  prepared(key).inside.filter((h) => hexes[h] === undefined || hexes[h]?.terrain === 'sea').length;

describe('frames (§2.0.1)', () => {
  it('footprints have the printed cell counts', () => {
    expect(footprint('SHORT')).toHaveLength(35);
    expect(footprint('TALL')).toHaveLength(42);
    expect(footprint('XTALL')).toHaveLength(49);
    expect(footprint('A')).toHaveLength(56);
    expect(footprint('B')).toHaveLength(63);
  });

  it.each(KEYS)('%s: topology builds, every harbour faces its land hex from water', (key) => {
    const t = topologyFor(mapIdOf(key));
    const p = prepared(key);
    expect(t.landHexes).toHaveLength(p.boardCells.length);
    for (const h of p.harbors) {
      expect(t.water[h.water], `${key} harbour water ${h.water}`).toBeDefined();
      expect(t.hex[h.land]).toBeDefined();
    }
  });

  it.each(KEYS)('%s: harbours never share a corner', (key) => {
    const { board } = fixed(key);
    const corners = board.ports.flatMap((p) => p.vertices);
    expect(new Set(corners).size).toBe(corners.length);
  });
});

/** Printed component tables (S5 / S56). Terrain names: grain = fields, brick = hills, ... */
const TABLES: Partial<
  Record<MapKey, { t: Partial<Record<Terrain, number>>; n: number[]; h: number; sea: number }>
> = {
  hns3: {
    t: { gold: 2, grain: 4, brick: 4, ore: 4, wool: 5, lumber: 3 },
    n: [1, 2, 3, 3, 2, 3, 2, 3, 2, 1],
    h: 8,
    sea: 13,
  },
  hns4: {
    t: { desert: 1, gold: 2, grain: 5, brick: 5, ore: 5, wool: 5, lumber: 5 },
    n: [2, 3, 3, 3, 3, 3, 3, 3, 3, 1],
    h: 9,
    sea: 14,
  },
  four3: {
    t: { grain: 4, brick: 4, ore: 4, wool: 4, lumber: 4 },
    n: [1, 2, 2, 3, 2, 2, 3, 2, 2, 1],
    h: 9,
    sea: 15,
  },
  four4: {
    t: { grain: 5, brick: 4, ore: 4, wool: 5, lumber: 5 },
    n: [1, 2, 3, 3, 2, 2, 3, 3, 3, 1],
    h: 9,
    sea: 12,
  },
  fog3: {
    t: { grain: 2, brick: 2, ore: 2, wool: 4, lumber: 4, fog: 12 },
    n: [0, 1, 1, 2, 2, 2, 2, 1, 2, 1],
    h: 8,
    sea: 16,
  },
  fog4: {
    t: { grain: 3, brick: 3, ore: 3, wool: 4, lumber: 4, fog: 12 },
    n: [1, 1, 2, 2, 3, 2, 2, 1, 2, 1],
    h: 9,
    sea: 13,
  },
  desert3: {
    t: { desert: 3, gold: 2, grain: 4, brick: 3, ore: 4, wool: 4, lumber: 5 },
    n: [1, 2, 3, 3, 3, 3, 3, 2, 2, 0],
    h: 8,
    sea: 10,
  },
  desert4: {
    t: { desert: 3, gold: 2, grain: 5, brick: 5, ore: 5, wool: 5, lumber: 5 },
    n: [1, 3, 3, 3, 3, 3, 3, 3, 3, 2],
    h: 9,
    sea: 12,
  },
  tribe: {
    t: { desert: 3, gold: 2, grain: 5, brick: 5, ore: 5, wool: 5, lumber: 5 },
    n: [1, 2, 2, 2, 2, 2, 2, 2, 2, 1],
    h: 0,
    sea: 19,
  },
  cloth: {
    t: { desert: 2, gold: 2, grain: 5, brick: 3, ore: 4, wool: 4, lumber: 4 },
    n: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    h: 9,
    sea: 18,
  },
  pirates3: {
    t: { desert: 3, gold: 2, grain: 5, brick: 5, ore: 5, wool: 5, lumber: 5 },
    n: [1, 2, 3, 3, 3, 3, 3, 3, 2, 1],
    h: 8,
    sea: 19,
  },
  wonders: {
    t: { desert: 3, gold: 2, grain: 5, brick: 5, ore: 5, wool: 5, lumber: 5 },
    n: [2, 3, 3, 3, 3, 3, 3, 3, 3, 1],
    h: 9,
    sea: 19,
  },
  // 5-6: no printed terrain table in the doc; these are the diagram's counts (32 / 38 / 41 /
  // 32 / 37 / 39 land as printed).
  six56: {
    t: { grain: 6, brick: 6, ore: 6, wool: 7, lumber: 7 },
    n: [2, 3, 4, 4, 4, 3, 4, 4, 2, 2],
    h: 11,
    sea: 24,
  },
  fog56: {
    t: { desert: 1, gold: 2, grain: 5, brick: 5, ore: 5, wool: 4, lumber: 4, fog: 25 },
    n: [1, 3, 3, 2, 3, 3, 2, 3, 3, 2],
    h: 9,
    sea: 12,
  },
  tribe56: {
    t: { desert: 4, gold: 3, grain: 7, brick: 7, ore: 6, wool: 7, lumber: 7 },
    n: [1, 4, 4, 4, 3, 3, 3, 3, 3, 1],
    h: 0,
    sea: 22,
  },
  cloth56: {
    t: { desert: 4, gold: 2, grain: 6, brick: 4, ore: 5, wool: 5, lumber: 6 },
    n: [2, 4, 2, 2, 3, 3, 2, 2, 4, 2],
    h: 11,
    sea: 24,
  },
  pirates56: {
    t: { desert: 5, gold: 4, grain: 5, brick: 4, ore: 7, wool: 6, lumber: 6 },
    n: [1, 4, 4, 4, 4, 4, 3, 3, 4, 1],
    h: 9,
    sea: 26,
  },
  wonders56: {
    t: { desert: 4, gold: 3, grain: 6, brick: 6, ore: 6, wool: 7, lumber: 7 },
    n: [2, 3, 4, 4, 4, 4, 4, 4, 4, 2],
    h: 11,
    sea: 24,
  },
};
const TOKEN_VALUES = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

describe('printed component tables (§2.2-§2.10)', () => {
  it.each(Object.keys(TABLES) as MapKey[])('%s', (key) => {
    const want = TABLES[key];
    if (!want) throw new Error(key);
    const { board } = fixed(key);
    const got = terrains(board.hexes);
    delete got.sea;
    expect(got).toEqual(want.t);
    const tk = tokens(board.hexes);
    expect(TOKEN_VALUES.map((v) => tk[v] ?? 0)).toEqual(want.n);
    expect(board.ports).toHaveLength(want.h);
    expect(seaCells(key, board.hexes)).toBe(want.sea);
  });

  it('3-4 harbours: one 2:1 of each resource plus 3:1s', () => {
    for (const key of [
      'hns3',
      'hns4',
      'four3',
      'four4',
      'fog3',
      'fog4',
      'desert3',
      'desert4',
    ] as MapKey[]) {
      const k = harborKinds(fixed(key).board.ports);
      for (const r of ['brick', 'lumber', 'wool', 'grain', 'ore'] as const)
        expect(k[r], `${key} ${r}`).toBe(1);
    }
  });

  it('printed harbour kinds are kept (Heading for New Shores 3p)', () => {
    const ports = fixed('hns3').board.ports;
    expect(ports[0]?.kind).toBe('generic');
    expect(ports[1]?.kind).toBe('ore');
    expect(ports.find((p) => p.waterHex === cellHex(parseCell('3,7')))?.kind).toBe('wool');
  });

  it('New World: 23 land hexes and 23 tokens (Q19); 5-6: 39 tokens', () => {
    expect(newWorldCounts('newworld').tokens).toHaveLength(23);
    expect(newWorldCounts('newworld56').tokens).toHaveLength(39);
    const { board } = fixed('newworld', 3);
    const land = Object.values(board.hexes).filter((h) => h.terrain !== 'sea');
    expect(land).toHaveLength(23);
    expect(board.ports).toHaveLength(9);
  });
});

const ext = (b: { ext?: Record<string, unknown> }) => b.ext?.seafarers as SeaBoard;
const areaCount = (sb: SeaBoard) => new Set(Object.values(sb.area)).size;

describe('islands and bonus areas (§4.6)', () => {
  it('Heading for New Shores 3p and 4p: 3 small islands', () => {
    expect(areaCount(ext(fixed('hns3').board))).toBe(3);
    expect(areaCount(ext(fixed('hns4').board))).toBe(3);
  });

  it('Through the Desert: 4 foreign areas (the strip + 3 islands)', () => {
    expect(areaCount(ext(fixed('desert3').board))).toBe(4);
    expect(areaCount(ext(fixed('desert4').board))).toBe(4);
    expect(Object.values(ext(fixed('desert4').board).area)).toContain('T');
  });

  it('The Four Islands: 4 islands; The Six Islands: 6', () => {
    expect(areaCount(ext(fixed('four3').board))).toBe(4);
    expect(areaCount(ext(fixed('four4').board))).toBe(4);
    expect(areaCount(ext(fixed('six56').board))).toBe(6);
  });

  it('Wonders: two small islands (NE and SW)', () => {
    expect(areaCount(ext(fixed('wonders').board))).toBe(2);
  });

  it('components() groups hexes sharing a side', () => {
    const a = cellHex([0, 2]);
    const b = cellHex([0, 4]);
    const c = cellHex([4, 4]);
    expect(
      components([a, b, c])
        .map((g) => g.length)
        .sort(),
    ).toEqual([1, 2]);
  });
});

describe('variable set-ups', () => {
  it.each([
    'hns3',
    'hns4',
    'four4',
    'fog3',
    'desert3',
    'desert4',
    'tribe',
    'cloth',
    'wonders',
    'six56',
  ] as MapKey[])('%s: same components, reds apart, deterministic', (key) => {
    const a = variableBoard(new Rng(7), key);
    const b = variableBoard(new Rng(7), key);
    expect(a).toEqual(b);
    const f = fixed(key);
    expect(terrains(a.board.hexes)).toEqual(terrains(f.board.hexes));
    expect(tokens(a.board.hexes)).toEqual(tokens(f.board.hexes));
    expect(redsApart(a.board.hexes)).toBe(true);
  });

  it('Through the Desert: deserts stay and no red number on gold', () => {
    for (let seed = 1; seed < 20; seed++) {
      const { board } = variableBoard(new Rng(seed), 'desert4');
      for (const c of ['4,2', '5,3', '6,4'])
        expect(board.hexes[cellHex(parseCell(c))]?.terrain).toBe('desert');
      for (const h of Object.values(board.hexes)) {
        if (h.terrain === 'gold') expect([6, 8]).not.toContain(h.token);
      }
    }
  });

  it('Forgotten Tribe: the 3 bottom hexes get no 5, 6, 8 or 9', () => {
    for (let seed = 1; seed < 20; seed++) {
      const { board } = variableBoard(new Rng(seed), 'tribe');
      for (const c of ['2,10', '3,11', '4,10']) {
        expect([5, 6, 8, 9]).not.toContain(board.hexes[cellHex(parseCell(c))]?.token);
      }
    }
  });

  it('New World: random each seed, reds apart', () => {
    const a = fixed('newworld', 1);
    const b = fixed('newworld', 2);
    expect(a.board.hexes).not.toEqual(b.board.hexes);
    expect(redsApart(a.board.hexes)).toBe(true);
  });
});
