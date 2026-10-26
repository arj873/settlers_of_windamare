/**
 * Traders & Barbarians boards (docs/rules/traders-barbarians.md §2), 3-4 players (19 hexes; two
 * players too: Catan for Two) and the 5-6 extension (30 hexes; T&B itself 37). Static scenario
 * data (lakes, fishing grounds, rivers, bridge sites, caravan starts, castles, trade hexes) goes
 * to `board.ext.tb` (TbBoard).
 */
import { NUMBER_TOKENS, PORT_KINDS } from '../../../engine/constants';
import { assembleBoard, dealTokens, randomBoard } from '../../../engine/board';
import { NO_ROBBER } from '../../../engine/expansions/ext';
import {
  CORNERS,
  SIDES,
  cornerVertex,
  hexCenter,
  neighbor,
  parseHexId,
  sideEdge,
  type Corner,
  type Side,
} from '../../../engine/hex';
import {
  FRAME_STD19,
  FRAME_STD30,
  MAPS,
  type CustomMapDef,
  type GeneratedBoard,
  type PlazaDef,
  type RowsFrameDef,
} from '../../../engine/maps';
import type { Rng } from '../../../engine/rng';
import { topologyFor, type Topology } from '../../../engine/topology';
import type { Board, EdgeId, HexId, PortKind, Terrain, VertexId } from '../../../engine/types';
import {
  CASTLE,
  GLASSWORKS,
  LAKE,
  OASIS,
  QUARRY,
  SWAMP,
  TB,
  TRADE_CASTLE,
  type CaravanStart,
  type FishingGround,
  type TbBoard,
  type TradeHex,
  type TradeKind,
} from './state';

const isRes = (t: Terrain) =>
  t === 'brick' || t === 'lumber' || t === 'wool' || t === 'grain' || t === 'ore';
const fill = (t: Terrain, n: number): Terrain[] => Array<Terrain>(n).fill(t);
// prettier-ignore
const TOKENS_30: readonly number[] = [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12];
const PORTS_19: readonly PortKind[] = PORT_KINDS;
const PORTS_30: readonly PortKind[] = MAPS.base56.harbors;
const PORTS_37: readonly PortKind[] = MAPS.base78.harbors;

const withExt = (board: Board, ext: TbBoard): Board => ({ ...board, ext: { [TB]: ext } });

/** Hexes of `topo` with all 6 neighbours on land (not on the coast). */
const innerHexes = (topo: Topology): HexId[] =>
  topo.landHexes.filter((h) => (topo.hex[h]?.neighbors.length ?? 0) === 6);
const coastalHexes = (topo: Topology): HexId[] =>
  topo.landHexes.filter((h) => (topo.hex[h]?.neighbors.length ?? 0) < 6);

/** Coastal hexes clockwise around the board centre, starting with `first`. */
function clockwiseCoast(topo: Topology, first: HexId): HexId[] {
  const angle = (h: HexId) => {
    const c = topo.hex[h] as { x: number; y: number };
    return Math.atan2(c.y - topo.center.y, c.x - topo.center.x);
  };
  const ring = coastalHexes(topo).sort((a, b) => angle(a) - angle(b));
  const i = ring.indexOf(first);
  return [...ring.slice(i), ...ring.slice(0, i)];
}

/** Shuffle `pool` into the free positions of `fixed` (landHexes order; undefined = free). */
function placeTerrains(
  rng: Rng,
  topo: Topology,
  fixed: ReadonlyMap<HexId, Terrain>,
  pool: readonly Terrain[],
): Terrain[] {
  const bag = rng.shuffle(pool);
  const out = topo.landHexes.map((h) => fixed.get(h) ?? bag.pop());
  if (bag.length > 0 || out.some((t) => t === undefined)) throw new Error('terrain pool mismatch');
  return out as Terrain[];
}

// ---------------------------------------------------------------------------
// Variants only: the base board, 2-4 players (Catan for Two needs 2)
// ---------------------------------------------------------------------------

export const TB_BASE19: CustomMapDef = {
  id: 'tb/base19',
  name: 'Base board (19 hexes)',
  frame: FRAME_STD19,
  minPlayers: 2,
  maxPlayers: 4,
  layout: 'custom',
  bankPerResource: MAPS.baseRandom.bankPerResource,
  devDeck: MAPS.baseRandom.devDeck,
  generate: (rng) => randomBoard(rng, 'baseRandom'),
};

// ---------------------------------------------------------------------------
// Fishermen of Catan (§2.2)
// ---------------------------------------------------------------------------

/**
 * Fishing grounds: one per frame section, on a free coastal "notch" (a vertex between two
 * coastal hexes, not a harbour vertex); the ground touches the notch and its two coastal
 * neighbours. `numbers` are dealt at random.
 */
function fishingGrounds(
  rng: Rng,
  topo: Topology,
  board: Board,
  numbers: number[],
): FishingGround[] {
  const portVertices = new Set(board.ports.flatMap((p) => p.vertices));
  const angle = (v: VertexId) => {
    const p = topo.vertex[v] as { x: number; y: number };
    return Math.atan2(p.y - topo.center.y, p.x - topo.center.x);
  };
  const notches = topo.vertices
    .filter((v) => topo.vertex[v]?.coastal && topo.vertex[v]?.hexes.length === 2)
    .sort((a, b) => angle(a) - angle(b));
  const sections = numbers.length;
  const dealt = rng.shuffle(numbers);
  const out: FishingGround[] = [];
  const used = new Set<VertexId>();
  for (let s = 0; s < sections; s++) {
    const from = Math.floor((s * notches.length) / sections);
    const to = Math.floor(((s + 1) * notches.length) / sections);
    const arc = notches.slice(from, to);
    const free = arc.filter((v) => !portVertices.has(v) && !used.has(v));
    const pick = rng.pick(free.length > 0 ? free : arc);
    const around = (topo.vertex[pick]?.vertices ?? []).filter((n) => topo.vertex[n]?.coastal);
    const vertices = [pick, ...around].filter((v) => !used.has(v));
    for (const v of vertices) used.add(v);
    out.push({ number: dealt[s] as number, vertices });
  }
  return out;
}

function fishBoard(rng: Rng, map: CustomMapDef, big: boolean): GeneratedBoard {
  const topo = topologyFor(map.id);
  const inner = innerHexes(topo);
  const lakes = rng.shuffle(inner).slice(0, big ? 2 : 1);
  const base = big ? MAPS.base56.terrain : MAPS.baseRandom.terrain;
  const pool: Terrain[] = (['lumber', 'wool', 'grain', 'brick', 'ore'] as const).flatMap((r) =>
    fill(r, base[r]),
  );
  const terrains = placeTerrains(rng, topo, new Map(lakes.map((h) => [h, LAKE])), pool);
  const tokens = dealTokens(rng, topo, terrains, big ? TOKENS_30 : NUMBER_TOKENS, isRes);
  const ports = rng.shuffle(big ? PORTS_30 : PORTS_19);
  const { board } = assembleBoard(topo, terrains, tokens, ports);
  const lakeNumbers = [
    [2, 3, 11, 12],
    [4, 10],
  ];
  const grounds = fishingGrounds(
    rng,
    topo,
    board,
    big ? [4, 5, 6, 8, 9, 10, 5, 9] : [4, 5, 6, 8, 9, 10],
  );
  return {
    board: withExt(board, {
      lakes: lakes.map((hex, i) => ({ hex, numbers: lakeNumbers[i] ?? [] })),
      grounds,
    }),
    robber: NO_ROBBER,
  };
}

export const TB_FISH19: CustomMapDef = {
  id: 'tb/fish19',
  name: 'Fishermen of Catan (19 hexes)',
  frame: FRAME_STD19,
  minPlayers: 2,
  maxPlayers: 4,
  layout: 'custom',
  bankPerResource: MAPS.baseRandom.bankPerResource,
  devDeck: MAPS.baseRandom.devDeck,
  generate: (rng) => fishBoard(rng, TB_FISH19, false),
};

export const TB_FISH30: CustomMapDef = {
  id: 'tb/fish30',
  name: 'Fishermen of Catan, 5-6 players (30 hexes)',
  frame: FRAME_STD30,
  minPlayers: 5,
  maxPlayers: 6,
  layout: 'custom',
  bankPerResource: MAPS.base56.bankPerResource,
  devDeck: MAPS.base56.devDeck,
  generate: (rng) => fishBoard(rng, TB_FISH30, true),
};

// ---------------------------------------------------------------------------
// Rivers of Catan (§2.3)
// ---------------------------------------------------------------------------

interface RiverLayout {
  /** Each river as [hex, terrain] from source to mouth; the swamps are part of it. */
  rivers: readonly (readonly (readonly [HexId, Terrain])[])[];
  /** Coastal mouth edges (also bridge sites). */
  mouths: readonly EdgeId[];
  pool: readonly Terrain[];
  tokens: readonly number[];
  /** The "2" token shares the "12" hex (3-4 players only). */
  twoOnTwelve: boolean;
}

const RIVERS_19: RiverLayout = {
  rivers: [
    [
      ['h:-1,-1', SWAMP],
      ['h:0,-1', 'wool'],
      ['h:1,-1', 'brick'],
      ['h:2,-1', 'ore'],
    ],
    [
      ['h:-2,1', SWAMP],
      ['h:-1,1', 'brick'],
      ['h:0,1', 'ore'],
    ],
  ],
  mouths: ['e:-1,-2,SE', 'e:-3,2,NE'],
  pool: [...fill('lumber', 4), ...fill('wool', 2), ...fill('grain', 4), 'brick', 'ore'],
  tokens: NUMBER_TOKENS.filter((n, i) => n !== 2 || i !== 0),
  twoOnTwelve: true,
};

const RIVERS_30: RiverLayout = {
  rivers: [
    [
      ['h:2,-3', SWAMP],
      ['h:1,-2', 'brick'],
      ['h:0,-1', 'ore'],
      ['h:-1,0', 'ore'],
      ['h:-1,1', 'brick'],
      ['h:-1,2', 'wool'],
      ['h:-1,3', SWAMP],
    ],
    [
      ['h:1,0', 'ore'],
      ['h:2,0', 'wool'],
      ['h:3,0', 'wool'],
    ],
  ],
  mouths: ['e:2,-3,NE', 'e:-1,3,SE', 'e:3,0,E'],
  // base56 minus 3 mountains, 2 hills, 3 pasture, 2 deserts: 6 forest, 3 pasture, 6 fields, 3 hills, 2 mountains.
  pool: [
    ...fill('lumber', 6),
    ...fill('wool', 3),
    ...fill('grain', 6),
    ...fill('brick', 3),
    ...fill('ore', 2),
  ],
  tokens: TOKENS_30,
  twoOnTwelve: false,
};

/** The side of hex `a` facing hex `b` (they must be neighbours). */
function sharedEdge(a: HexId, b: HexId): EdgeId {
  const pa = parseHexId(a);
  const pb = parseHexId(b);
  const side = SIDES.find((s) => {
    const n = neighbor(pa.q, pa.r, s);
    return n.q === pb.q && n.r === pb.r;
  });
  if (!side) throw new Error(`${a} and ${b} are not neighbours`);
  return sideEdge(pa.q, pa.r, side);
}

function riversBoard(
  rng: Rng,
  map: CustomMapDef,
  layout: RiverLayout,
  big: boolean,
): GeneratedBoard {
  const topo = topologyFor(map.id);
  const fixed = new Map<HexId, Terrain>(layout.rivers.flat().map(([h, t]) => [h, t]));
  const terrains = placeTerrains(rng, topo, fixed, layout.pool);
  const tokens = dealTokens(rng, topo, terrains, layout.tokens, isRes);
  const ports = rng.shuffle(big ? PORTS_30 : PORTS_19);
  const { board } = assembleBoard(topo, terrains, tokens, ports);
  const sites: EdgeId[] = [];
  for (const river of layout.rivers) {
    for (let i = 0; i + 1 < river.length; i++) {
      sites.push(sharedEdge(river[i]?.[0] as HexId, river[i + 1]?.[0] as HexId));
    }
  }
  sites.push(...layout.mouths);
  const twelve = layout.twoOnTwelve
    ? ((Object.keys(board.hexes) as HexId[]).find((h) => board.hexes[h]?.token === 12) ?? null)
    : null;
  const swamps = layout.rivers
    .flat()
    .filter(([, t]) => t === SWAMP)
    .map(([h]) => h);
  return {
    board: withExt(board, {
      rivers: layout.rivers.flat().map(([h]) => h),
      bridgeSites: sites,
      twoOnTwelve: twelve,
    }),
    robber: rng.pick(swamps),
  };
}

export const TB_RIVERS19: CustomMapDef = {
  id: 'tb/rivers19',
  name: 'Rivers of Catan (19 hexes)',
  frame: FRAME_STD19,
  minPlayers: 2,
  maxPlayers: 4,
  layout: 'custom',
  bankPerResource: MAPS.baseRandom.bankPerResource,
  devDeck: MAPS.baseRandom.devDeck,
  generate: (rng) => riversBoard(rng, TB_RIVERS19, RIVERS_19, false),
};

export const TB_RIVERS30: CustomMapDef = {
  id: 'tb/rivers30',
  name: 'Rivers of Catan, 5-6 players (30 hexes)',
  frame: FRAME_STD30,
  minPlayers: 5,
  maxPlayers: 6,
  layout: 'custom',
  bankPerResource: MAPS.base56.bankPerResource,
  devDeck: MAPS.base56.devDeck,
  generate: (rng) => riversBoard(rng, TB_RIVERS30, RIVERS_30, true),
};

// ---------------------------------------------------------------------------
// The Caravans (§2.4)
// ---------------------------------------------------------------------------

/** The arrow corners of an oasis (alternating corners). */
const ARROWS: readonly Corner[] = ['NW', 'NE', 'S'];

/** The first camel of the arrow at `corner` of oasis `hex`: the corner's edge leaving the hex. */
export function caravanStart(topo: Topology, hex: HexId, corner: Corner): CaravanStart {
  const { q, r } = parseHexId(hex);
  const tail = cornerVertex(q, r, corner);
  const own = new Set(SIDES.map((s: Side) => sideEdge(q, r, s)));
  const edge = (topo.vertex[tail]?.edges ?? []).find((e) => !own.has(e));
  if (!edge) throw new Error(`oasis ${hex} corner ${corner} has no outward edge`);
  const head = (topo.edge[edge]?.vertices ?? []).find((v) => v !== tail) as VertexId;
  return { edge, head };
}

function caravansBoard(
  rng: Rng,
  map: CustomMapDef,
  oases: readonly HexId[],
  big: boolean,
): GeneratedBoard {
  const topo = topologyFor(map.id);
  const base = big ? MAPS.base56.terrain : MAPS.baseRandom.terrain;
  const pool: Terrain[] = (['lumber', 'wool', 'grain', 'brick', 'ore'] as const).flatMap((r) =>
    fill(r, base[r]),
  );
  const terrains = placeTerrains(rng, topo, new Map(oases.map((h) => [h, OASIS])), pool);
  const tokens = dealTokens(rng, topo, terrains, big ? TOKENS_30 : NUMBER_TOKENS, isRes);
  const ports = rng.shuffle(big ? PORTS_30 : PORTS_19);
  const { board } = assembleBoard(topo, terrains, tokens, ports);
  const starts = oases.flatMap((h) => ARROWS.map((c) => caravanStart(topo, h, c)));
  return { board: withExt(board, { caravanStarts: starts }), robber: NO_ROBBER };
}

export const TB_CARAVANS19: CustomMapDef = {
  id: 'tb/caravans19',
  name: 'The Caravans (19 hexes)',
  frame: FRAME_STD19,
  minPlayers: 2,
  maxPlayers: 4,
  layout: 'custom',
  bankPerResource: MAPS.baseRandom.bankPerResource,
  devDeck: MAPS.baseRandom.devDeck,
  generate: (rng) => caravansBoard(rng, TB_CARAVANS19, ['h:0,0'], false),
};

export const TB_CARAVANS30: CustomMapDef = {
  id: 'tb/caravans30',
  name: 'The Caravans, 5-6 players (30 hexes)',
  frame: FRAME_STD30,
  minPlayers: 5,
  maxPlayers: 6,
  layout: 'custom',
  bankPerResource: MAPS.base56.bankPerResource,
  devDeck: MAPS.base56.devDeck,
  generate: (rng) => caravansBoard(rng, TB_CARAVANS30, ['h:0,-1', 'h:1,1'], true),
};

// ---------------------------------------------------------------------------
// Barbarian Attack (§2.5)
// ---------------------------------------------------------------------------

interface BaLayout {
  castles: readonly HexId[];
  deserts: readonly HexId[];
  /** Fixed number tokens (castles and deserts have none). */
  numbers: Readonly<Record<HexId, number>>;
  coastPool: readonly Terrain[];
  innerPool: readonly Terrain[];
}

const BA_19: BaLayout = {
  castles: ['h:-2,2'],
  deserts: ['h:2,-2'],
  numbers: {
    'h:0,-2': 3,
    'h:1,-2': 8,
    'h:-1,-1': 9,
    'h:0,-1': 4,
    'h:1,-1': 5,
    'h:2,-1': 10,
    'h:-2,0': 12,
    'h:-1,0': 6,
    'h:0,0': 10,
    'h:1,0': 8,
    'h:2,0': 11,
    'h:-2,1': 4,
    'h:-1,1': 9,
    'h:0,1': 3,
    'h:1,1': 5,
    'h:-1,2': 6,
    'h:0,2': 2,
  },
  coastPool: [
    ...fill('lumber', 2),
    ...fill('brick', 2),
    ...fill('wool', 3),
    'ore',
    ...fill('grain', 2),
  ],
  innerPool: ['lumber', 'wool', 'brick', ...fill('ore', 2), ...fill('grain', 2)],
};

const BA_30: BaLayout = {
  castles: ['h:-2,0', 'h:3,0'],
  deserts: ['h:-2,1', 'h:3,-1'],
  numbers: {
    'h:1,-3': 12,
    'h:2,-3': 9,
    'h:3,-3': 3,
    'h:0,-2': 4,
    'h:1,-2': 5,
    'h:2,-2': 10,
    'h:3,-2': 8,
    'h:-1,-1': 5,
    'h:0,-1': 11,
    'h:1,-1': 6,
    'h:2,-1': 3,
    'h:-1,0': 8,
    'h:0,0': 10,
    'h:1,0': 4,
    'h:2,0': 6,
    'h:-1,1': 3,
    'h:0,1': 8,
    'h:1,1': 11,
    'h:2,1': 9,
    'h:-2,2': 6,
    'h:-1,2': 4,
    'h:0,2': 9,
    'h:1,2': 10,
    'h:-2,3': 2,
    'h:-1,3': 5,
    'h:0,3': 11,
  },
  coastPool: [
    ...fill('lumber', 3),
    ...fill('brick', 3),
    ...fill('wool', 2),
    ...fill('ore', 2),
    ...fill('grain', 2),
  ],
  innerPool: [
    ...fill('lumber', 2),
    ...fill('brick', 2),
    ...fill('wool', 3),
    ...fill('ore', 3),
    ...fill('grain', 4),
  ],
};

function baBoard(rng: Rng, map: CustomMapDef, layout: BaLayout, big: boolean): GeneratedBoard {
  const topo = topologyFor(map.id);
  const fixed = new Map<HexId, Terrain>([
    ...layout.castles.map((h): [HexId, Terrain] => [h, CASTLE]),
    ...layout.deserts.map((h): [HexId, Terrain] => [h, 'desert']),
  ]);
  const coastBag = rng.shuffle(layout.coastPool);
  const innerBag = rng.shuffle(layout.innerPool);
  const inner = new Set(innerHexes(topo));
  const terrains = topo.landHexes.map(
    (h) => fixed.get(h) ?? ((inner.has(h) ? innerBag.pop() : coastBag.pop()) as Terrain),
  );
  const tokens = topo.landHexes.map((h) => layout.numbers[h] ?? null);
  const ports = rng.shuffle(big ? PORTS_30 : PORTS_19);
  const { board } = assembleBoard(topo, terrains, tokens, ports);
  const first = layout.castles[0] as HexId;
  // Check order: clockwise from the hex after the first castle; castles and deserts are skipped.
  const ring = clockwiseCoast(topo, first);
  const coast = [...ring.slice(1), first].filter((h) => !fixed.has(h));
  return {
    board: withExt(board, { castles: [...layout.castles], coast }),
    robber: NO_ROBBER,
  };
}

export const TB_BA19: CustomMapDef = {
  id: 'tb/ba19',
  name: 'Barbarian Attack (19 hexes)',
  frame: FRAME_STD19,
  minPlayers: 3,
  maxPlayers: 4,
  layout: 'custom',
  bankPerResource: MAPS.baseRandom.bankPerResource,
  devDeck: MAPS.baseRandom.devDeck,
  generate: (rng) => baBoard(rng, TB_BA19, BA_19, false),
};

export const TB_BA30: CustomMapDef = {
  id: 'tb/ba30',
  name: 'Barbarian Attack, 5-6 players (30 hexes)',
  frame: FRAME_STD30,
  minPlayers: 5,
  maxPlayers: 6,
  layout: 'custom',
  bankPerResource: MAPS.base56.bankPerResource,
  devDeck: MAPS.base56.devDeck,
  generate: (rng) => baBoard(rng, TB_BA30, BA_30, true),
};

// ---------------------------------------------------------------------------
// Traders & Barbarians (§2.6)
// ---------------------------------------------------------------------------

interface TradeSpot {
  hex: HexId;
  kind: TradeKind;
  /** Settlement corners (spokes lead there); the others touch only this hex and the sea. */
  corners: readonly Corner[];
}

const TRADE_19: readonly TradeSpot[] = [
  { hex: 'h:-2,0', kind: 'castle', corners: ['N', 'NE', 'SE', 'S'] },
  { hex: 'h:2,-2', kind: 'quarry', corners: ['SE', 'S', 'SW', 'NW'] },
  { hex: 'h:0,2', kind: 'glassworks', corners: ['NW', 'N', 'NE', 'SW'] },
];

const TRADE_37: readonly TradeSpot[] = [
  { hex: 'h:0,0', kind: 'castle', corners: CORNERS },
  { hex: 'h:0,-3', kind: 'quarry', corners: CORNERS },
  { hex: 'h:3,0', kind: 'quarry', corners: CORNERS },
  { hex: 'h:-3,3', kind: 'quarry', corners: CORNERS },
  { hex: 'h:3,-3', kind: 'glassworks', corners: CORNERS },
  { hex: 'h:0,3', kind: 'glassworks', corners: CORNERS },
  { hex: 'h:-3,0', kind: 'glassworks', corners: CORNERS },
];

const TRADE_TERRAIN: Readonly<Record<TradeKind, Terrain>> = {
  castle: TRADE_CASTLE,
  quarry: QUARRY,
  glassworks: GLASSWORKS,
};

const plazas = (spots: readonly TradeSpot[]): PlazaDef[] =>
  spots.map((s) => ({ hex: s.hex, corners: s.corners }));

export const FRAME_TRADERS19: RowsFrameDef = {
  id: 'tb/traders19',
  rows: [3, 4, 5, 4, 3],
  harbors: 'alternate',
  plazas: plazas(TRADE_19),
};

export const FRAME_TRADERS37: RowsFrameDef = {
  id: 'tb/traders37',
  rows: [4, 5, 6, 7, 6, 5, 4],
  harbors: 'alternate',
  plazas: plazas(TRADE_37),
};

/** 5-6 numbers (T5-56 p.9); trade hexes and deserts have none. */
const TRADERS_37_NUMBERS: Readonly<Record<HexId, number>> = {
  'h:1,-3': 6,
  'h:2,-3': 10,
  'h:-1,-2': 4,
  'h:1,-2': 3,
  'h:2,-2': 12,
  'h:3,-2': 8,
  'h:-2,-1': 3,
  'h:-1,-1': 5,
  'h:0,-1': 10,
  'h:1,-1': 5,
  'h:2,-1': 9,
  'h:3,-1': 11,
  'h:-2,0': 8,
  'h:-1,0': 12,
  'h:1,0': 2,
  'h:2,0': 6,
  'h:-3,1': 11,
  'h:-2,1': 9,
  'h:-1,1': 4,
  'h:0,1': 9,
  'h:1,1': 5,
  'h:2,1': 3,
  'h:-3,2': 6,
  'h:-2,2': 2,
  'h:-1,2': 11,
  'h:1,2': 4,
  'h:-2,3': 10,
  'h:-1,3': 8,
};

/** Corners of a trade hex nobody may settle (sea-only) and its sides nobody may build roads on. */
function tradeBans(
  topo: Topology,
  spots: readonly TradeSpot[],
): { noBuild: VertexId[]; noRoad: EdgeId[] } {
  const noBuild: VertexId[] = [];
  const noRoad: EdgeId[] = [];
  for (const s of spots) {
    const { q, r } = parseHexId(s.hex);
    for (const c of CORNERS) {
      if (!s.corners.includes(c)) noBuild.push(cornerVertex(q, r, c));
    }
    for (const side of SIDES) {
      const e = sideEdge(q, r, side);
      // A side on the sea (only this hex on land): no road (3-4 trade hexes; T5-56 allows it).
      const ends = topo.edge[e]?.vertices ?? [];
      if (topo.edge[e]?.hexes.length === 1 && ends.some((v) => noBuild.includes(v))) noRoad.push(e);
    }
  }
  return { noBuild, noRoad };
}

function tradersBoard(rng: Rng, map: CustomMapDef, big: boolean): GeneratedBoard {
  const topo = topologyFor(map.id);
  const spots = big ? TRADE_37 : TRADE_19;
  const fixed = new Map<HexId, Terrain>(spots.map((s) => [s.hex, TRADE_TERRAIN[s.kind]]));
  let tokens: (number | null)[];
  let terrains: Terrain[];
  if (big) {
    for (const d of ['h:0,-2', 'h:0,2'] as const) fixed.set(d, 'desert');
    const base = MAPS.base56.terrain;
    const pool = (['lumber', 'wool', 'grain', 'brick', 'ore'] as const).flatMap((r) =>
      fill(r, base[r]),
    );
    terrains = placeTerrains(rng, topo, fixed, pool);
    tokens = topo.landHexes.map((h) => TRADERS_37_NUMBERS[h] ?? null);
  } else {
    // Desert, 1 pasture, 1 fields and the 2 and 12 tokens are out of the game.
    const pool = [
      ...fill('lumber', 4),
      ...fill('wool', 3),
      ...fill('grain', 3),
      ...fill('brick', 3),
      ...fill('ore', 3),
    ];
    terrains = placeTerrains(rng, topo, fixed, pool);
    tokens = dealTokens(
      rng,
      topo,
      terrains,
      NUMBER_TOKENS.filter((n) => n !== 2 && n !== 12),
      isRes,
    );
  }
  const ports = rng.shuffle(big ? PORTS_37 : PORTS_19);
  const { board } = assembleBoard(topo, terrains, tokens, ports);
  const tradeHexes: TradeHex[] = spots.map((s) => ({ hex: s.hex, kind: s.kind }));
  return {
    board: withExt(board, { tradeHexes, ...tradeBans(topo, spots) }),
    robber: NO_ROBBER,
  };
}

/** Where the 3 barbarians start (the X marks). */
export const TRADERS_BARBARIANS_19: readonly EdgeId[] = ['e:1,-2,SE', 'e:-2,1,NE', 'e:0,1,E'];
export const TRADERS_BARBARIANS_37: readonly EdgeId[] = ['e:2,-3,SE', 'e:-3,1,NE', 'e:0,2,E'];

export const TB_TRADERS19: CustomMapDef = {
  id: 'tb/traders19',
  name: 'Traders & Barbarians (19 hexes)',
  frame: FRAME_TRADERS19,
  minPlayers: 2,
  maxPlayers: 4,
  layout: 'custom',
  bankPerResource: MAPS.baseRandom.bankPerResource,
  devDeck: { knight: 16, roadBuilding: 3, victoryPoint: 3, yearOfPlenty: 0, monopoly: 0 },
  generate: (rng) => tradersBoard(rng, TB_TRADERS19, false),
};

export const TB_TRADERS37: CustomMapDef = {
  id: 'tb/traders37',
  name: 'Traders & Barbarians, 5-6 players (37 hexes)',
  frame: FRAME_TRADERS37,
  minPlayers: 5,
  maxPlayers: 6,
  layout: 'custom',
  bankPerResource: MAPS.base56.bankPerResource,
  devDeck: { knight: 22, roadBuilding: 6, victoryPoint: 3, yearOfPlenty: 0, monopoly: 0 },
  generate: (rng) => tradersBoard(rng, TB_TRADERS37, true),
};

export const TB_MAPS: readonly CustomMapDef[] = [
  TB_BASE19,
  TB_FISH19,
  TB_FISH30,
  TB_RIVERS19,
  TB_RIVERS30,
  TB_CARAVANS19,
  TB_CARAVANS30,
  TB_BA19,
  TB_BA30,
  TB_TRADERS19,
  TB_TRADERS37,
];

/** Hex centre (unit coordinates), for renderers. */
export const centreOf = (h: HexId) => {
  const { q, r } = parseHexId(h);
  return hexCenter(q, r);
};
