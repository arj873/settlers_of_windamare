/**
 * Seafarers maps (docs/rules/seafarers.md §2): frames, the fixed ("standard") layouts, the
 * variable set-ups and New World's random board. Map ids are 'seafarers/<key>'.
 *
 * Board hexes = land and fog cells, plus the sea cells of a shuffle group (they can turn into
 * land in a variable set-up) as board hexes of terrain 'sea'. All other playing-area cells and the
 * frame ring are water hexes of the topology. `board.ext.seafarers` (SeaBoard) keeps the playing
 * area, the region tag of every board hex and the bonus area (special VP) of every land hex.
 */
import {
  MAPS,
  type CustomMapDef,
  type GeneratedBoard,
  type HexListFrameDef,
} from '../../../engine/maps';
import { edgeEndpoints, hexId, parseHexId, SIDES, neighbor } from '../../../engine/hex';
import type { Rng } from '../../../engine/rng';
import type {
  Board,
  DevCardCounts,
  HexId,
  HexTile,
  Port,
  PortKind,
  Resource,
  Terrain,
} from '../../../engine/types';
import {
  cellEdge,
  cellHex,
  cellNeighbor,
  footprint,
  frameRing,
  parseCell,
  type BookSide,
  type Cell,
  type FrameKind,
} from './coords';
import * as D from './mapdata';
import type { MapData } from './mapdata';
import { NO_ROBBER } from '../../../engine/expansions/ext';
import { isMapId, mapById } from '../../../engine/mapLookup';

export const SEAFARERS = 'seafarers';
/** The robber beside the board (until the first 7 / Knight): the framework's NO_ROBBER. */
export const OFF_BOARD: HexId = NO_ROBBER;

export type MapKey =
  | 'hns3'
  | 'hns4'
  | 'hns56'
  | 'four3'
  | 'four4'
  | 'six56'
  | 'fog3'
  | 'fog4'
  | 'fog56'
  | 'desert3'
  | 'desert4'
  | 'desert56'
  | 'tribe'
  | 'tribe56'
  | 'cloth'
  | 'cloth56'
  | 'pirates3'
  | 'pirates4'
  | 'pirates56'
  | 'wonders'
  | 'wonders56'
  | 'newworld'
  | 'newworld56';

/** How settling new land pays special VP (§4.6). */
export type BonusKind = 'areas' | 'islands' | null;

interface Spec {
  key: MapKey;
  name: string;
  /** null = New World (all random). */
  data: MapData | null;
  frame: FrameKind;
  players: readonly [number, number];
  /** 5-6 player supply (bank 24, the 34-card deck). */
  big: boolean;
  bonus: BonusKind;
  /** Variable set-up: tag groups shuffled together (deserts never move). */
  shuffle: readonly (readonly string[])[];
  /** Harbour kinds drawn for spots without a printed kind. */
  harborKinds: readonly PortKind[];
}

const SPECIAL5: readonly PortKind[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
const harbors34 = (generic: number): PortKind[] => [
  ...SPECIAL5,
  ...Array<PortKind>(generic).fill('generic'),
];
const HARBORS56: readonly PortKind[] = [...SPECIAL5, 'wool', ...Array<PortKind>(5).fill('generic')];

// prettier-ignore
const SPECS: readonly Spec[] = [
  { key: 'hns3', name: 'Heading for New Shores (3)', data: D.HNS3, frame: 'SHORT', players: [3, 3], big: false, bonus: 'areas', shuffle: [['M'], ['S']], harborKinds: harbors34(3) },
  { key: 'hns4', name: 'Heading for New Shores (4)', data: D.HNS4, frame: 'TALL', players: [4, 4], big: false, bonus: 'areas', shuffle: [['M'], ['S']], harborKinds: harbors34(4) },
  { key: 'hns56', name: 'Heading for New Shores (5-6)', data: D.HNS56, frame: 'A', players: [5, 6], big: true, bonus: 'areas', shuffle: [['S']], harborKinds: HARBORS56 },
  { key: 'four3', name: 'The Four Islands (3)', data: D.FOUR3, frame: 'SHORT', players: [3, 3], big: false, bonus: 'islands', shuffle: [['M']], harborKinds: harbors34(4) },
  { key: 'four4', name: 'The Four Islands (4)', data: D.FOUR4, frame: 'SHORT', players: [4, 4], big: false, bonus: 'islands', shuffle: [['M']], harborKinds: harbors34(4) },
  { key: 'six56', name: 'The Six Islands (5-6)', data: D.SIX56, frame: 'A', players: [5, 6], big: true, bonus: 'islands', shuffle: [['M']], harborKinds: HARBORS56 },
  { key: 'fog3', name: 'The Fog Islands (3)', data: D.FOG3, frame: 'TALL', players: [3, 3], big: false, bonus: null, shuffle: [['M']], harborKinds: harbors34(3) },
  { key: 'fog4', name: 'The Fog Islands (4)', data: D.FOG4, frame: 'TALL', players: [4, 4], big: false, bonus: null, shuffle: [['M']], harborKinds: harbors34(4) },
  { key: 'fog56', name: 'The Fog Island (5-6)', data: D.FOG56, frame: 'B', players: [5, 6], big: true, bonus: null, shuffle: [['M']], harborKinds: harbors34(4) },
  { key: 'desert3', name: 'Through the Desert (3)', data: D.DESERT3, frame: 'SHORT', players: [3, 3], big: false, bonus: 'areas', shuffle: [['M'], ['T', 'S']], harborKinds: harbors34(3) },
  { key: 'desert4', name: 'Through the Desert (4)', data: D.DESERT4, frame: 'TALL', players: [4, 4], big: false, bonus: 'areas', shuffle: [['M'], ['T', 'S']], harborKinds: harbors34(4) },
  { key: 'desert56', name: 'Through the Desert (5-6)', data: D.DESERT56, frame: 'B', players: [5, 6], big: true, bonus: 'areas', shuffle: [['M'], ['T', 'S']], harborKinds: HARBORS56 },
  { key: 'tribe', name: 'The Forgotten Tribe', data: D.TRIBE, frame: 'XTALL', players: [3, 4], big: false, bonus: null, shuffle: [['M']], harborKinds: [...SPECIAL5, 'generic'] },
  { key: 'tribe56', name: 'The Forgotten Tribe (5-6)', data: D.TRIBE56, frame: 'B', players: [5, 6], big: true, bonus: null, shuffle: [['M']], harborKinds: [...SPECIAL5, 'generic', 'generic', 'generic'] },
  { key: 'cloth', name: 'Cloth for Catan', data: D.CLOTH, frame: 'TALL', players: [3, 4], big: false, bonus: null, shuffle: [['M']], harborKinds: harbors34(4) },
  { key: 'cloth56', name: 'Cloth for Catan (5-6)', data: D.CLOTH56, frame: 'A', players: [5, 6], big: true, bonus: null, shuffle: [['M']], harborKinds: HARBORS56 },
  { key: 'pirates3', name: 'The Pirate Islands (3)', data: D.PIRATES, frame: 'XTALL', players: [3, 3], big: false, bonus: null, shuffle: [], harborKinds: harbors34(3) },
  { key: 'pirates4', name: 'The Pirate Islands (4)', data: D.PIRATES, frame: 'XTALL', players: [4, 4], big: false, bonus: null, shuffle: [], harborKinds: harbors34(3) },
  { key: 'pirates56', name: 'The Pirate Islands (5-6)', data: D.PIRATES56, frame: 'B', players: [5, 6], big: true, bonus: null, shuffle: [], harborKinds: harbors34(4) },
  { key: 'wonders', name: 'The Wonders of Catan', data: D.WONDERS, frame: 'XTALL', players: [3, 4], big: false, bonus: 'areas', shuffle: [['M']], harborKinds: harbors34(4) },
  { key: 'wonders56', name: 'The Wonders of Catan (5-6)', data: D.WONDERS56, frame: 'B', players: [5, 6], big: true, bonus: 'areas', shuffle: [['M']], harborKinds: HARBORS56 },
  { key: 'newworld', name: 'New World', data: null, frame: 'TALL', players: [3, 4], big: false, bonus: 'islands', shuffle: [], harborKinds: harbors34(4) },
  { key: 'newworld56', name: 'New World (5-6)', data: null, frame: 'B', players: [5, 6], big: true, bonus: 'islands', shuffle: [], harborKinds: HARBORS56 },
];

export const mapIdOf = (key: MapKey) => `${SEAFARERS}/${key}` as const;

// ---------------------------------------------------------------------------------------------
// Parsed map data
// ---------------------------------------------------------------------------------------------

export interface CellEntry {
  cell: Cell;
  hex: HexId;
  terrain: Terrain;
  token: number | null;
  tag: string;
}

const TERRAINS = new Set([
  'brick',
  'lumber',
  'wool',
  'grain',
  'ore',
  'desert',
  'gold',
  'fog',
  'sea',
]);

function entries(list: string): string[] {
  return list
    .split(/[;\n]/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s.length > 0);
}

/** The cells of a map's data, in data order. */
export function parseCells(data: MapData): CellEntry[] {
  const out: CellEntry[] = [];
  for (const [tag, list] of Object.entries(data.cells)) {
    for (const e of entries(list)) {
      const [pos = '', terrain = '', token] = e.split(' ');
      if (!TERRAINS.has(terrain)) throw new Error(`bad terrain in "${e}"`);
      const cell = parseCell(pos);
      out.push({
        cell,
        hex: cellHex(cell),
        terrain: terrain as Terrain,
        token: token === undefined ? null : Number(token),
        tag,
      });
    }
  }
  return out;
}

export interface HarborSpot {
  /** The land hex the harbour faces. */
  land: HexId;
  /** The water cell it lies on. */
  water: HexId;
  edge: ReturnType<typeof cellEdge>;
  kind: PortKind | null;
}

export function parseHarbors(list: string): HarborSpot[] {
  return entries(list).map((e) => {
    const [pos = '', side = '', kind] = e.split(' ');
    const cell = parseCell(pos);
    const s = side as BookSide;
    if (!['N', 'NE', 'SE', 'S', 'SW', 'NW'].includes(s)) throw new Error(`bad side in "${e}"`);
    return {
      land: cellHex(cell),
      water: cellHex(cellNeighbor(cell, s)),
      edge: cellEdge(cell, s),
      kind: (kind ?? null) as PortKind | null,
    };
  });
}

interface Prepared {
  spec: Spec;
  /** Board hexes (land, fog, group sea), row-major (engine r, then q). */
  boardCells: CellEntry[];
  /** Playing-area cells. */
  inside: HexId[];
  harbors: HarborSpot[];
  frame: HexListFrameDef;
}

const byRowMajor = (a: HexId, b: HexId) => {
  const pa = parseHexId(a);
  const pb = parseHexId(b);
  return pa.r - pb.r || pa.q - pb.q;
};

const HNS56_MAIN = (): CellEntry[] =>
  entries(D.HNS56_MAIN_CELLS).map((s) => {
    const cell = parseCell(s);
    return { cell, hex: cellHex(cell), terrain: 'desert', token: null, tag: 'M' };
  });

function prepare(spec: Spec): Prepared {
  const foot = footprint(spec.frame);
  const inside = foot.map(cellHex);
  const ring = frameRing(foot).map(cellHex);
  let cells: CellEntry[];
  if (spec.data === null) {
    // New World: every playing-area cell is a board hex (land or sea, decided per game).
    cells = foot.map((cell) => ({
      cell,
      hex: cellHex(cell),
      terrain: 'sea',
      token: null,
      tag: 'M',
    }));
  } else {
    cells = parseCells(spec.data);
    if (spec.key === 'hns56') cells = [...HNS56_MAIN(), ...cells];
    // Heading for New Shores: the small-island positions that are sea in the printed layout
    // (every non-main cell not next to the main island) take part in the variable set-up.
    if (spec.key.startsWith('hns')) {
      const main = new Set(cells.filter((c) => c.tag === 'M').map((c) => c.hex));
      const listed = new Set(cells.map((c) => c.hex));
      for (const cell of foot) {
        const h = cellHex(cell);
        if (listed.has(h)) continue;
        const touchesMain = SIDES.some((s) => {
          const p = parseHexId(h);
          const n = neighbor(p.q, p.r, s);
          return main.has(hexId(n.q, n.r));
        });
        if (!touchesMain) cells.push({ cell, hex: h, terrain: 'sea', token: null, tag: 'S' });
      }
    }
  }
  const insideSet = new Set(inside);
  for (const c of cells) {
    if (!insideSet.has(c.hex))
      throw new Error(`${spec.key}: ${c.cell.join(',')} is outside the frame`);
  }
  const boardSet = new Set(cells.map((c) => c.hex));
  if (boardSet.size !== cells.length) throw new Error(`${spec.key}: a cell is listed twice`);
  cells.sort((a, b) => byRowMajor(a.hex, b.hex));
  const harbors = spec.data ? parseHarbors(spec.data.harbors) : [];
  const sea = [...inside.filter((h) => !boardSet.has(h)), ...ring];
  return {
    spec,
    boardCells: cells,
    inside,
    harbors,
    frame: {
      id: `${SEAFARERS}/${spec.key}`,
      hexes: cells.map((c) => c.hex),
      sea,
      harbors: harbors.map((h) => [h.water, h.land] as const),
    },
  };
}

const PREPARED = new Map<MapKey, Prepared>();
export function prepared(key: MapKey): Prepared {
  let p = PREPARED.get(key);
  if (!p) {
    const spec = SPECS.find((s) => s.key === key);
    if (!spec) throw new Error(`unknown Seafarers map ${key}`);
    p = prepare(spec);
    PREPARED.set(key, p);
  }
  return p;
}

export function specOf(key: MapKey): Spec {
  return prepared(key).spec;
}

const BASED = new Map<string, MapKey | null>();
export function mapKeyOf(mapId: string): MapKey | null {
  const key = mapId.startsWith(`${SEAFARERS}/`) ? mapId.slice(SEAFARERS.length + 1) : '';
  if (SPECS.some((s) => s.key === key)) return key as MapKey;
  // A combination map built on a Seafarers map (C2, `basedOn`).
  if (BASED.has(mapId)) return BASED.get(mapId) ?? null;
  if (!isMapId(mapId)) return null;
  const def = mapById(mapId);
  const out = def.layout === 'custom' && def.basedOn !== undefined ? mapKeyOf(def.basedOn) : null;
  BASED.set(mapId, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Static board data (board.ext.seafarers)
// ---------------------------------------------------------------------------------------------

export interface SeaBoard {
  v: 1;
  /** Playing-area cells (land, fog and sea inside the frame); the rest of the water is frame. */
  inside: HexId[];
  /** Region tag of every board hex (mapdata.ts). */
  region: Record<HexId, string>;
  /** Bonus area of a land hex ('S0', 'T', 'I3' ...); absent = none (main / home land). */
  area: Record<HexId, string>;
  /** A combination map's own pirate start (C2; null = no pirate in the game). Absent = the scenario's. */
  pirate?: HexId | null;
}

const isLandTerrain = (t: Terrain) => t !== 'sea' && t !== 'fog';

/** Connected groups of `hexes` (shared side), each sorted, in row-major order of their first hex. */
export function components(hexes: Iterable<HexId>): HexId[][] {
  const set = new Set(hexes);
  const seen = new Set<HexId>();
  const out: HexId[][] = [];
  for (const start of [...set].sort(byRowMajor)) {
    if (seen.has(start)) continue;
    const group: HexId[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const h = stack.pop() as HexId;
      group.push(h);
      const p = parseHexId(h);
      for (const s of SIDES) {
        const n = neighbor(p.q, p.r, s);
        const id = hexId(n.q, n.r);
        if (set.has(id) && !seen.has(id)) {
          seen.add(id);
          stack.push(id);
        }
      }
    }
    out.push(group.sort(byRowMajor));
  }
  return out;
}

/** Region tags and bonus areas of a generated board. */
function seaBoardOf(p: Prepared, hexes: Record<HexId, HexTile>): SeaBoard {
  const region: Record<HexId, string> = {};
  for (const c of p.boardCells) region[c.hex] = c.tag;
  const land = (h: HexId) => {
    const t = hexes[h]?.terrain;
    return t !== undefined && isLandTerrain(t);
  };
  const area: Record<HexId, string> = {};
  if (p.spec.bonus === 'islands') {
    components(p.boardCells.map((c) => c.hex).filter(land)).forEach((g, i) => {
      for (const h of g) area[h] = `I${i}`;
    });
  } else if (p.spec.bonus === 'areas') {
    // Auto tag 'A': the largest island is the main island, every other one a small island.
    const auto = p.boardCells.filter((c) => c.tag === 'A' && land(c.hex)).map((c) => c.hex);
    if (auto.length > 0) {
      const groups = components(auto).sort((a, b) => b.length - a.length);
      groups.forEach((g, i) => {
        for (const h of g) region[h] = i === 0 ? 'M' : 'S';
      });
    }
    const small = p.boardCells
      .filter((c) => region[c.hex] === 'S' && land(c.hex))
      .map((c) => c.hex);
    components(small).forEach((g, i) => {
      for (const h of g) area[h] = `S${i}`;
    });
    for (const c of p.boardCells) if (region[c.hex] === 'T' && land(c.hex)) area[c.hex] = 'T';
  }
  for (const c of p.boardCells) if (region[c.hex] === 'A') region[c.hex] = 'M';
  return { v: 1, inside: p.inside, region, area };
}

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

const isRed = (n: number | null) => n === 6 || n === 8;

function hexNeighborsOf(h: HexId): HexId[] {
  const p = parseHexId(h);
  return SIDES.map((s) => {
    const n = neighbor(p.q, p.r, s);
    return hexId(n.q, n.r);
  });
}

/** No two red tokens on neighbouring hexes. */
export function redsApart(tiles: Record<HexId, HexTile>): boolean {
  for (const t of Object.values(tiles)) {
    if (!isRed(t.token)) continue;
    if (hexNeighborsOf(t.id).some((n) => isRed(tiles[n]?.token ?? null))) return false;
  }
  return true;
}

function portsOf(spots: readonly HarborSpot[], kinds: readonly PortKind[]): Port[] {
  return spots.map((s, i) => {
    const [a, b] = edgeVertices(s.edge);
    return {
      kind: s.kind ?? kinds[i] ?? 'generic',
      edge: s.edge,
      vertices: [a, b],
      waterHex: s.water,
    };
  });
}

const edgeVertices = edgeEndpoints;

/** Harbour kinds for the spots without a printed kind: the scenario supply minus printed ones. */
function drawHarborKinds(rng: Rng, spec: Spec, spots: readonly HarborSpot[]): PortKind[] {
  const left = [...spec.harborKinds];
  for (const s of spots) {
    if (s.kind === null) continue;
    const i = left.indexOf(s.kind);
    if (i >= 0) left.splice(i, 1);
  }
  const bag = rng.shuffle(left);
  return spots.map((s) => s.kind ?? bag.pop() ?? 'generic');
}

function tile(c: CellEntry, terrain = c.terrain, token = c.token): HexTile {
  const { q, r } = parseHexId(c.hex);
  return { id: c.hex, q, r, terrain, token };
}

function robberStart(p: Prepared, hexes: Record<HexId, HexTile>): HexId {
  const r = p.spec.data?.robber ?? 'off';
  if (r === 'off') return OFF_BOARD;
  if (r === 'desert') {
    const d = p.boardCells.find((c) => hexes[c.hex]?.terrain === 'desert');
    return d ? d.hex : OFF_BOARD;
  }
  return cellHex(parseCell(r));
}

function boardWith(p: Prepared, hexes: Record<HexId, HexTile>, ports: Port[]): GeneratedBoard {
  const board: Board = { hexes, ports, ext: { [SEAFARERS]: seaBoardOf(p, hexes) } };
  return { board, robber: robberStart(p, hexes) };
}

/** The base 5-6 island for Heading for New Shores 5-6: base56 terrain and tokens, reds apart. */
function randomMain56(rng: Rng, cells: readonly CellEntry[], into: Record<HexId, HexTile>): void {
  const def = MAPS.base56;
  const terrains: Terrain[] = [];
  for (const [t, n] of Object.entries(def.terrain) as [Terrain, number][]) {
    for (let i = 0; i < n; i++) terrains.push(t);
  }
  const bag = rng.shuffle(terrains);
  cells.forEach((c, i) => (into[c.hex] = tile(c, bag[i] as Terrain, null)));
  dealTokens(
    rng,
    cells.map((c) => c.hex),
    [...def.tokens],
    into,
    () => true,
  );
}

/**
 * Deal `tokens` onto the land hexes of `slots` that need one (resources and gold), keeping red
 * numbers apart (also from tokens already on the board) and `allowed(hex, token)`. Retries
 * with fresh shuffles; falls back to the last shuffle (the constraints can always be met by the
 * printed layouts, so this only guards against an endless loop).
 */
function dealTokens(
  rng: Rng,
  slots: readonly HexId[],
  tokens: readonly number[],
  into: Record<HexId, HexTile>,
  allowed: (h: HexId, token: number) => boolean,
): void {
  const targets = slots.filter((h) => {
    const t = into[h]?.terrain;
    return t !== undefined && t !== 'desert' && isLandTerrain(t);
  });
  if (targets.length !== tokens.length) {
    throw new Error(`need ${targets.length} tokens, got ${tokens.length}`);
  }
  for (let attempt = 0; attempt < 2000; attempt++) {
    const bag = rng.shuffle(tokens);
    targets.forEach((h, i) => {
      const t = into[h];
      if (t) into[h] = { ...t, token: bag[i] ?? null };
    });
    if (redsApart(into) && targets.every((h) => allowed(h, into[h]?.token ?? 0))) return;
  }
}

function fixedBoard(rng: Rng, p: Prepared): GeneratedBoard {
  const hexes: Record<HexId, HexTile> = {};
  for (const c of p.boardCells) hexes[c.hex] = tile(c);
  if (p.spec.key === 'hns56') {
    randomMain56(
      rng,
      p.boardCells.filter((c) => c.tag === 'M'),
      hexes,
    );
  }
  const kinds = drawHarborKinds(rng, p.spec, p.harbors);
  return boardWith(p, hexes, portsOf(p.harbors, kinds));
}

/** Extra token rules of a variable set-up (§2.2-§2.9). */
function tokenRule(p: Prepared, hexes: Record<HexId, HexTile>): (h: HexId, n: number) => boolean {
  const key = p.spec.key;
  if (key.startsWith('desert') || key.startsWith('newworld')) {
    // Through the Desert (S5 p.19) / New World (S6): no red number on a gold field.
    return (h, n) => !(isRed(n) && hexes[h]?.terrain === 'gold');
  }
  if (key === 'tribe') {
    // The 3 hexes at the bottom of the main island never get 5, 6, 8 or 9 (S5 p.20).
    const bottom = new Set(['2,10', '3,11', '4,10'].map((s) => cellHex(parseCell(s))));
    return (h, n) => !(bottom.has(h) && [5, 6, 8, 9].includes(n));
  }
  if (key.startsWith('wonders')) {
    // The hexes next to the deserts get no 6 or 8 (S5 p.28).
    return (h, n) => !(isRed(n) && hexNeighborsOf(h).some((x) => hexes[x]?.terrain === 'desert'));
  }
  return () => true;
}

/**
 * The variable set-up of a scenario (each scenario's "Variable set-up" paragraph): within each
 * shuffle group the terrains (sea positions included, deserts fixed) are shuffled, then the
 * group's number tokens are dealt with red numbers apart; harbour kinds are drawn at random.
 */
export function variableBoard(rng: Rng, key: MapKey): GeneratedBoard {
  const p = prepared(key);
  if (p.spec.data === null) return newWorldBoard(rng, p);
  const hexes: Record<HexId, HexTile> = {};
  for (const c of p.boardCells) hexes[c.hex] = tile(c);
  if (key === 'hns56')
    randomMain56(
      rng,
      p.boardCells.filter((c) => c.tag === 'M'),
      hexes,
    );
  const groups = p.spec.shuffle.map((tags) =>
    p.boardCells.filter((c) => tags.includes(c.tag) && c.terrain !== 'desert'),
  );
  for (const g of groups) {
    const terrains = rng.shuffle(g.map((c) => c.terrain));
    g.forEach((c, i) => (hexes[c.hex] = tile(c, terrains[i] as Terrain, null)));
  }
  const allowed = tokenRule(p, hexes);
  for (const g of groups) {
    const tokens = g.flatMap((c) => (c.token === null ? [] : [c.token]));
    dealTokens(
      rng,
      g.map((c) => c.hex),
      tokens,
      hexes,
      allowed,
    );
  }
  const spots = p.harbors.map((h) => ({ ...h, kind: null }));
  return boardWith(p, hexes, portsOf(spots, drawHarborKinds(rng, p.spec, spots)));
}

// ---------------------------------------------------------------------------------------------
// New World (§2.10)
// ---------------------------------------------------------------------------------------------

const NW34 = {
  terrain: { sea: 19, grain: 5, brick: 4, ore: 4, wool: 5, lumber: 5 },
  // 11s: 2 (the older printing; the 2015 booklet's 3 does not add up, Q19)
  tokens: [2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 12],
};
const NW56 = {
  terrain: { sea: 21, desert: 3, gold: 4, grain: 7, brick: 7, ore: 7, wool: 7, lumber: 7 },
  // 12s: 2 (Q19)
  // prettier-ignore
  tokens: [2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9,
    10, 10, 10, 10, 11, 11, 11, 11, 12, 12],
};

export function newWorldCounts(key: MapKey) {
  return key === 'newworld56' ? NW56 : NW34;
}

/**
 * New World: every cell of the frame gets a random hex, land hexes random tokens (reds apart, no
 * red on gold). Harbours: each one on a random coast edge (between a land hex and a sea or frame
 * cell, lying on the water side), never sharing a corner with another harbour (S6), instead of
 * being placed by the players (§4.12).
 */
function newWorldBoard(rng: Rng, p: Prepared): GeneratedBoard {
  const counts = newWorldCounts(p.spec.key);
  const bag: Terrain[] = [];
  for (const [t, n] of Object.entries(counts.terrain) as [Terrain, number][]) {
    for (let i = 0; i < n; i++) bag.push(t);
  }
  if (bag.length !== p.boardCells.length) throw new Error('New World: hex count');
  for (let attempt = 0; ; attempt++) {
    const terrains = rng.shuffle(bag);
    const hexes: Record<HexId, HexTile> = {};
    p.boardCells.forEach((c, i) => (hexes[c.hex] = tile(c, terrains[i] as Terrain, null)));
    // Every land hex needs a free coast edge for setup ships and harbours: re-deal boards
    // whose land is one blob without enough coast (never happens in practice; bounded anyway).
    dealTokens(
      rng,
      p.boardCells.map((c) => c.hex),
      counts.tokens,
      hexes,
      tokenRule(p, hexes),
    );
    const ports = randomHarbors(rng, p, hexes);
    if (ports.length === p.spec.harborKinds.length || attempt >= 20) {
      return boardWith(p, hexes, ports);
    }
  }
}

function randomHarbors(rng: Rng, p: Prepared, hexes: Record<HexId, HexTile>): Port[] {
  const candidates: { edge: HarborSpot['edge']; water: HexId; land: HexId }[] = [];
  for (const c of p.boardCells) {
    if (!isLandTerrain(hexes[c.hex]?.terrain ?? 'sea')) continue;
    for (const side of ['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const) {
      const w = cellHex(cellNeighbor(c.cell, side));
      const wt = hexes[w]?.terrain;
      if (wt !== undefined && wt !== 'sea') continue; // land on both sides
      candidates.push({ edge: cellEdge(c.cell, side), water: w, land: c.hex });
    }
  }
  const kinds = rng.shuffle(p.spec.harborKinds);
  const used = new Set<string>();
  const out: Port[] = [];
  for (const cand of rng.shuffle(candidates)) {
    if (out.length === kinds.length) break;
    const [a, b] = edgeVertices(cand.edge);
    if (used.has(a) || used.has(b)) continue;
    used.add(a);
    used.add(b);
    out.push({
      kind: kinds[out.length] ?? 'generic',
      edge: cand.edge,
      vertices: [a, b],
      waterHex: cand.water,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// MapDefs
// ---------------------------------------------------------------------------------------------

const DECK34: Readonly<DevCardCounts> = MAPS.baseRandom.devDeck;
const DECK56: Readonly<DevCardCounts> = MAPS.base56.devDeck;

function mapDefOf(spec: Spec): CustomMapDef {
  const id = mapIdOf(spec.key);
  const def: CustomMapDef = {
    id,
    name: spec.name,
    get frame() {
      return prepared(spec.key).frame;
    },
    minPlayers: spec.players[0],
    maxPlayers: spec.players[1],
    layout: 'custom',
    bankPerResource: spec.big ? MAPS.base56.bankPerResource : MAPS.baseRandom.bankPerResource,
    devDeck: spec.big ? DECK56 : DECK34,
    generate(rng) {
      const p = prepared(spec.key);
      return p.spec.data === null ? newWorldBoard(rng, p) : fixedBoard(rng, p);
    },
  };
  return def;
}

export const SEA_MAPS: readonly CustomMapDef[] = SPECS.map(mapDefOf);

/** The static Seafarers board data of a game. */
export function seaBoard(state: { board: Board }): SeaBoard {
  const ext = state.board.ext?.[SEAFARERS] as SeaBoard | undefined;
  if (!ext) throw new Error('not a Seafarers board');
  return ext;
}

/** A resource terrain (for tests and the fog stack). */
export const RESOURCE_TERRAINS: readonly Resource[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
