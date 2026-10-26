/**
 * Explorers & Pirates boards (docs/rules/explorers-pirates.md §2, §8.2-8.3): the starting island,
 * the face-down parrot (north) and goose (south) regions, the Council of Catan hex and the sea.
 * Map ids are 'ep/<key>'.
 *
 * Board hexes = every position: the island, the region hexes (terrain 'ep/parrot' / 'ep/goose'
 * until explored), the Council hex and face-up sea (terrain 'sea'). The automatic ring around
 * them is the frame (ships may sail along it, the pirate may not stand on it).
 * What the face-down hexes hide is dealt by the module's init (state.ts `hidden`).
 */
import { BANK_PER_RESOURCE, RESOURCES } from '../../../engine/constants';
import { doubledToHexId, NO_ROBBER } from '../../../engine/expansions/ext';
import { cornerVertex, parseHexId } from '../../../engine/hex';
import type { CustomMapDef, GeneratedBoard, HexListFrameDef } from '../../../engine/maps';
import type { Rng } from '../../../engine/rng';
import type {
  DevCardCounts,
  HexId,
  HexTile,
  MapId,
  Resource,
  Terrain,
  VertexId,
} from '../../../engine/types';
import { EP, type ScenarioKey, type SpiceKind } from './state';

export const T = {
  parrot: 'ep/parrot',
  goose: 'ep/goose',
  fish: 'ep/fish',
  spice: 'ep/spice',
  council: 'ep/council',
} as const satisfies Record<string, Terrain>;

export type Region = 'parrot' | 'goose';

export type MapKey =
  | 'landHo'
  | 'pirateLairs'
  | 'fish'
  | 'spices'
  | 'full'
  | 'pirateLairs56'
  | 'fish56'
  | 'spices56'
  | 'full56';

/** A face-down hex in a region deck: a terrain, a fish shoal with its die face, or a spice farm. */
export type Content =
  Resource | 'sea' | 'gold' | { shoal: number } | { spice: SpiceKind; number?: number };

/** A doubled-coordinate position (§2.0): [c, r]. */
type Pos = readonly [c: number, r: number];

interface Spec {
  key: MapKey;
  scenario: ScenarioKey;
  name: string;
  big: boolean;
  /** Board width: row r spans c = |m - r| .. width - |m - r| (m = the middle row). */
  width: number;
  parrot: readonly Pos[];
  goose: readonly Pos[];
  council: boolean;
  /** Region decks (all the hexes that go face down). Fish 3-4: 2 of the 3 parrot shoals. */
  decks: { parrot: readonly Content[]; goose: readonly Content[]; parrotShoalsUsed?: number };
  /** Fixed island terrain (Land Ho!, Pirate Lairs 3-4), keyed 'c,r'; absent = random. */
  island?: Readonly<Record<string, Resource>>;
}

// ---------------------------------------------------------------------------------------------
// The island (§2.3, §8.2)
// ---------------------------------------------------------------------------------------------

/** [c, r, number]; the printed pasture is the cell with c = 0. */
// prettier-ignore
const ISLAND34: readonly (readonly [number, number, number])[] = [
  [3, 0, 11], [5, 0, 9], [2, 1, 3], [4, 1, 8], [1, 2, 4], [3, 2, 10],
  [0, 3, 6], [2, 3, 12], [4, 3, 8], [1, 4, 10], [3, 4, 4], [2, 5, 11], [4, 5, 6], [3, 6, 3], [5, 6, 5],
];
// prettier-ignore
const ISLAND56: readonly (readonly [number, number, number])[] = [
  [4, 0, 2], [6, 0, 9], [3, 1, 11], [5, 1, 8], [2, 2, 4], [4, 2, 10], [1, 3, 10], [3, 3, 3], [5, 3, 8],
  [0, 4, 6], [2, 4, 5], [4, 4, 4], [6, 4, 5], [1, 5, 3], [3, 5, 10], [5, 5, 6], [2, 6, 8], [4, 6, 4],
  [3, 7, 11], [5, 7, 6], [4, 8, 12], [6, 8, 9],
];

/** Random island terrain (the printed pasture is extra). */
const POOL34: Readonly<Record<Resource, number>> = {
  brick: 2,
  lumber: 4,
  wool: 3,
  grain: 2,
  ore: 3,
};
const POOL56: Readonly<Record<Resource, number>> = {
  brick: 3,
  lumber: 5,
  wool: 5,
  grain: 3,
  ore: 5,
};

// prettier-ignore
const LAND_HO_ISLAND: Readonly<Record<string, Resource>> = {
  '3,0': 'ore', '5,0': 'lumber', '2,1': 'grain', '4,1': 'wool', '1,2': 'brick', '3,2': 'wool',
  '2,3': 'ore', '4,3': 'lumber', '1,4': 'grain', '3,4': 'wool', '2,5': 'lumber', '4,5': 'brick',
  '3,6': 'ore', '5,6': 'lumber',
};
// prettier-ignore
const LAIRS_ISLAND: Readonly<Record<string, Resource>> = {
  '3,0': 'wool', '5,0': 'lumber', '2,1': 'grain', '4,1': 'wool', '1,2': 'brick', '3,2': 'ore',
  '2,3': 'ore', '4,3': 'lumber', '1,4': 'grain', '3,4': 'wool', '2,5': 'lumber', '4,5': 'ore',
  '3,6': 'brick', '5,6': 'lumber',
};

// ---------------------------------------------------------------------------------------------
// Regions (§2.4-2.8, §8.3)
// ---------------------------------------------------------------------------------------------

const row = (r: number, ...cs: number[]): Pos[] => cs.map((c) => [c, r] as const);
const mirror = (cells: readonly Pos[], mid: number): Pos[] =>
  cells.map(([c, r]) => [c, 2 * mid - r] as const);

const n = <T>(x: T, k: number): T[] => Array.from({ length: k }, () => x);
const shoals = (...faces: number[]): Content[] => faces.map((f) => ({ shoal: f }));
/** One farm of each advantage per region; Pirate Bonus farms show 4 (parrot) and 5 (goose). */
const farms = (bonus: number): Content[] => [
  { spice: 'swift' },
  { spice: 'bonus', number: bonus },
  { spice: 'fast' },
];
const LAND_P34: Content[] = ['brick', 'lumber', 'wool', 'grain', 'ore', 'ore'];
const LAND_G34: Content[] = ['brick', 'lumber', 'wool', 'grain', 'grain', 'ore'];
const LAND_P56: Content[] = [
  'brick',
  ...n<Content>('lumber', 2),
  'wool',
  ...n<Content>('grain', 2),
  ...n<Content>('ore', 3),
];
const LAND_G56: Content[] = [
  ...n<Content>('brick', 2),
  'lumber',
  ...n<Content>('wool', 2),
  ...n<Content>('grain', 2),
  ...n<Content>('ore', 2),
];

const LANDHO_P = [...row(0, 11, 13), ...row(1, 10, 12, 14), ...row(2, 9, 13, 15)];
const LAIRS_P = [...row(0, 11, 13, 15), ...row(1, 10, 12, 14, 16), ...row(2, 9, 11, 15, 17)];
const SPICES_P = [
  ...row(0, 11, 13, 15, 17),
  ...row(1, 10, 12, 14, 16, 18),
  ...row(2, 9, 11, 15, 19),
];
const FULL_P = [
  ...row(0, 11, 13, 15, 17, 19),
  ...row(1, 10, 12, 14, 16, 18, 20),
  ...row(2, 9, 11, 15, 19, 21),
];
const LAIRS56_P = [
  ...row(0, 12, 16),
  ...row(1, 11, 13, 15, 17),
  ...row(2, 10, 12, 14, 16, 18),
  ...row(3, 11, 15, 19),
];
const FISH56_P = [
  ...row(0, 12, 16, 18),
  ...row(1, 11, 13, 15, 17, 19),
  ...row(2, 10, 12, 14, 20),
  ...row(3, 11, 15, 17, 21),
];
const FULL56_P = [
  ...row(0, 12, 16, 20),
  ...row(1, 11, 13, 15, 17, 19, 21),
  ...row(2, 10, 12, 14, 16, 18, 20, 22),
  ...row(3, 11, 15, 19, 23),
];

// prettier-ignore
const SPECS: readonly Spec[] = [
  { key: 'landHo', scenario: 'landHo', name: 'Land Ho!', big: false, width: 16,
    parrot: LANDHO_P, goose: mirror(LANDHO_P, 3), council: false, island: LAND_HO_ISLAND,
    decks: { parrot: [...n<Content>('sea', 2), ...LAND_P34], goose: [...n<Content>('sea', 2), ...LAND_G34] } },
  { key: 'pirateLairs', scenario: 'pirateLairs', name: 'Pirate Lairs', big: false, width: 18,
    parrot: LAIRS_P, goose: mirror(LAIRS_P, 3), council: false, island: LAIRS_ISLAND,
    decks: { parrot: [...n<Content>('sea', 2), ...LAND_P34, ...n<Content>('gold', 3)],
      goose: [...n<Content>('sea', 2), ...LAND_G34, ...n<Content>('gold', 3)] } },
  { key: 'fish', scenario: 'fish', name: 'Fish for Catan', big: false, width: 18,
    parrot: LAIRS_P, goose: mirror(LAIRS_P, 3), council: true,
    decks: { parrot: [...LAND_P34, ...n<Content>('gold', 3), ...shoals(1, 2, 3)], parrotShoalsUsed: 2,
      goose: [...LAND_G34, ...n<Content>('gold', 2), ...shoals(4, 5, 6)] } },
  { key: 'spices', scenario: 'spices', name: 'Spices for Catan', big: false, width: 20,
    parrot: SPICES_P, goose: mirror(SPICES_P, 3), council: true,
    decks: { parrot: ['sea', ...LAND_P34, ...shoals(1, 2, 3), ...farms(4)],
      goose: ['sea', ...LAND_G34, ...shoals(4, 5, 6), ...farms(5)] } },
  { key: 'full', scenario: 'full', name: 'Explorers & Pirates', big: false, width: 22,
    parrot: FULL_P, goose: mirror(FULL_P, 3), council: true,
    decks: { parrot: ['sea', ...LAND_P34, ...n<Content>('gold', 3), ...shoals(1, 2, 3), ...farms(4)],
      goose: ['sea', ...LAND_G34, ...n<Content>('gold', 3), ...shoals(4, 5, 6), ...farms(5)] } },
  { key: 'pirateLairs56', scenario: 'pirateLairs', name: 'Pirate Lairs (5-6)', big: true, width: 20,
    parrot: LAIRS56_P, goose: mirror(LAIRS56_P, 4), council: false,
    decks: { parrot: ['sea', ...LAND_P56, ...n<Content>('gold', 4)],
      goose: ['sea', ...LAND_G56, ...n<Content>('gold', 4)] } },
  { key: 'fish56', scenario: 'fish', name: 'Fish for Catan (5-6)', big: true, width: 22,
    parrot: FISH56_P, goose: mirror(FISH56_P, 4), council: true,
    decks: { parrot: [...LAND_P56, ...n<Content>('gold', 4), ...shoals(1, 2, 3)],
      goose: [...LAND_G56, ...n<Content>('gold', 4), ...shoals(4, 5, 6)] } },
  { key: 'spices56', scenario: 'spices', name: 'Spices for Catan (5-6)', big: true, width: 22,
    parrot: FISH56_P, goose: mirror(FISH56_P, 4), council: true,
    decks: { parrot: ['sea', ...LAND_P56, ...shoals(1, 2, 3), ...farms(4)],
      goose: ['sea', ...LAND_G56, ...shoals(4, 5, 6), ...farms(5)] } },
  { key: 'full56', scenario: 'full', name: 'Explorers & Pirates (5-6)', big: true, width: 24,
    parrot: FULL56_P, goose: mirror(FULL56_P, 4), council: true,
    decks: { parrot: ['sea', ...LAND_P56, ...n<Content>('gold', 4), ...shoals(1, 2, 3), ...farms(4)],
      goose: ['sea', ...LAND_G56, ...n<Content>('gold', 4), ...shoals(4, 5, 6), ...farms(5)] } },
];

/** Face-down number discs per region (§1.3, §8.3). */
export const DISCS = {
  small: { parrot: [3, 4, 5, 6, 9, 10], goose: [4, 5, 8, 9, 10, 11] },
  big: { parrot: [2, 3, 4, 5, 5, 6, 9, 9, 10], goose: [3, 4, 4, 5, 8, 9, 10, 10, 11] },
} as const;

/**
 * The numbers on the back of the lair tokens. No text we could read prints them (rules doc §10
 * Q1): our default is the doc's recommended spread, two more for 5-6 players. Data, not rules.
 */
export const LAIR_TOKENS = {
  small: [3, 4, 5, 9, 10, 11],
  big: [3, 4, 5, 9, 10, 11, 2, 12],
} as const;
export const FISH_HAULS = { small: 6, big: 8 } as const;

// ---------------------------------------------------------------------------------------------
// Prepared geometry
// ---------------------------------------------------------------------------------------------

/** Static board data of a game (board.ext.ep). */
export interface EpBoard {
  v: 1;
  /** The starting island's hexes. */
  island: HexId[];
  /** Region of each face-down hex. */
  region: Record<HexId, Region>;
  council: HexId | null;
  /** Vertices a setup harbor settlement may stand on (§2.3). */
  harborSpots: VertexId[];
  /** Every position of the board (board hexes and playable sea); the rest is the frame. */
  inside: HexId[];
}

interface Prepared {
  spec: Spec;
  p: 0 | 1;
  island: { hex: HexId; key: string; token: number; printed: boolean }[];
  parrot: HexId[];
  goose: HexId[];
  council: HexId | null;
  inside: HexId[];
  harborSpots: VertexId[];
  frame: HexListFrameDef;
}

const byRowMajor = (a: HexId, b: HexId) => {
  const pa = parseHexId(a);
  const pb = parseHexId(b);
  return pa.r - pb.r || pa.q - pb.q;
};

function prepare(spec: Spec): Prepared {
  const p: 0 | 1 = spec.big ? 0 : 1;
  const rows = spec.big ? 9 : 7;
  const mid = (rows - 1) / 2;
  const H = (c: number, r: number) => doubledToHexId(c, r, p);
  const inside: HexId[] = [];
  for (let r = 0; r < rows; r++) {
    const d = Math.abs(mid - r);
    for (let c = d; c <= spec.width - d; c += 2) inside.push(H(c, r));
  }
  const cells = spec.big ? ISLAND56 : ISLAND34;
  const island = cells.map(([c, r, token]) => ({
    hex: H(c, r),
    key: `${c},${r}`,
    token,
    printed: c === 0,
  }));
  const council = spec.council ? H(spec.big ? 8 : 6, mid) : null;
  const parrot = spec.parrot.map(([c, r]) => H(c, r));
  const goose = spec.goose.map(([c, r]) => H(c, r));
  const board = [...island.map((i) => i.hex), ...parrot, ...goose, ...(council ? [council] : [])];
  const insideSet = new Set(inside);
  for (const h of board) if (!insideSet.has(h)) throw new Error(`${spec.key}: ${h} off the board`);
  if (new Set(board).size !== board.length) throw new Error(`${spec.key}: a hex is listed twice`);
  // Harbor spots: the NE and SE corners of each row's easternmost island hex.
  const harborSpots: VertexId[] = [];
  for (let r = 0; r < rows; r++) {
    const east = cells.filter(([, rr]) => rr === r).sort((a, b) => b[0] - a[0])[0];
    if (!east) continue;
    const { q } = parseHexId(H(east[0], r));
    harborSpots.push(cornerVertex(q, r, 'NE'), cornerVertex(q, r, 'SE'));
  }
  return {
    spec,
    p,
    island,
    parrot,
    goose,
    council,
    inside,
    harborSpots,
    frame: {
      id: `${EP}/${spec.key}`,
      // Every position is a board hex (face-up sea = terrain 'sea'), so the camera frames the
      // whole playing area; the ring around them is the frame.
      hexes: [...inside].sort(byRowMajor),
      sea: [],
      harbors: [],
    },
  };
}

const PREPARED = new Map<MapKey, Prepared>();
export function prepared(key: MapKey): Prepared {
  let p = PREPARED.get(key);
  if (!p) {
    const spec = SPECS.find((s) => s.key === key);
    if (!spec) throw new Error(`unknown Explorers & Pirates map ${key}`);
    p = prepare(spec);
    PREPARED.set(key, p);
  }
  return p;
}

export const MAP_KEYS: readonly MapKey[] = SPECS.map((s) => s.key);
export const mapIdOf = (key: MapKey): MapId => `${EP}/${key}`;

export function mapKeyOf(mapId: string): MapKey | null {
  const key = mapId.startsWith(`${EP}/`) ? mapId.slice(EP.length + 1) : '';
  return SPECS.some((s) => s.key === key) ? (key as MapKey) : null;
}

export function specOf(key: MapKey): Spec {
  return prepared(key).spec;
}

/** The maps of a scenario: [3-4 players, 5-6 players] (Land Ho! has no 5-6 map). */
export function mapsOf(scenario: ScenarioKey): MapKey[] {
  return SPECS.filter((s) => s.scenario === scenario).map((s) => s.key);
}

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

function tile(hex: HexId, terrain: Terrain, token: number | null): HexTile {
  const { q, r } = parseHexId(hex);
  return { id: hex, q, r, terrain, token };
}

function generate(rng: Rng, key: MapKey): GeneratedBoard {
  const p = prepared(key);
  const hexes: Record<HexId, HexTile> = {};
  const pool: Resource[] = [];
  const counts = p.spec.big ? POOL56 : POOL34;
  for (const r of RESOURCES) for (let i = 0; i < counts[r]; i++) pool.push(r);
  const bag = p.spec.island ? [] : rng.shuffle(pool);
  for (const cell of p.island) {
    const terrain: Resource = cell.printed
      ? 'wool'
      : (p.spec.island?.[cell.key] ?? (bag.pop() as Resource));
    hexes[cell.hex] = tile(cell.hex, terrain, cell.token);
  }
  for (const h of p.parrot) hexes[h] = tile(h, T.parrot, null);
  for (const h of p.goose) hexes[h] = tile(h, T.goose, null);
  if (p.council) hexes[p.council] = tile(p.council, T.council, null);
  for (const h of p.inside) hexes[h] ??= tile(h, 'sea', null);
  const region: Record<HexId, Region> = {};
  for (const h of p.parrot) region[h] = 'parrot';
  for (const h of p.goose) region[h] = 'goose';
  const ext: EpBoard = {
    v: 1,
    island: p.island.map((i) => i.hex),
    region,
    council: p.council,
    harborSpots: p.harborSpots,
    inside: p.inside,
  };
  return { board: { hexes, ports: [], ext: { [EP]: ext } }, robber: NO_ROBBER };
}

/** No development cards in Explorers & Pirates (§1.1). */
const NO_DEV: Readonly<DevCardCounts> = {
  knight: 0,
  victoryPoint: 0,
  roadBuilding: 0,
  yearOfPlenty: 0,
  monopoly: 0,
};

function mapDefOf(spec: Spec): CustomMapDef {
  return {
    id: mapIdOf(spec.key),
    name: spec.name,
    get frame() {
      return prepared(spec.key).frame;
    },
    minPlayers: spec.big ? 5 : 3,
    maxPlayers: spec.big ? 6 : 4,
    layout: 'custom',
    // 19 cards of each resource; the 5-6 extension adds the 25 cards of CATAN 5-6 (24 each).
    bankPerResource: spec.big ? 24 : BANK_PER_RESOURCE,
    devDeck: NO_DEV,
    generate: (rng) => generate(rng, spec.key),
  };
}

export const EP_MAPS: readonly CustomMapDef[] = SPECS.map(mapDefOf);

/** The static E&P board data of a game. */
export function epBoard(state: { board: { ext?: Record<string, unknown> } }): EpBoard {
  const ext = state.board.ext?.[EP] as EpBoard | undefined;
  if (!ext) throw new Error('not an Explorers & Pirates board');
  return ext;
}

/** The region decks of a map (init deals them face down). */
export function decksOf(key: MapKey): Spec['decks'] {
  return prepared(key).spec.decks;
}
