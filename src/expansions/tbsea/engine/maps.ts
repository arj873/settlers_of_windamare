/**
 * T&B + Seafarers boards (docs/rules/combos.md §3): Heading for New Shores with the T&B
 * scenario's island as its main island. The 2025 sheets build each pair this way ("set up the
 * main island according to the T&B scenario"; their 3-player diagrams also show the full 19-hex
 * T&B island), and the 4-player New Shores main island is the 19-hex hexagon, so a board is the
 * T&B module's own 19-hex board shifted onto it, with the New Shores small islands around.
 *
 * Everything T&B placed (trade hexes and plazas, lake and fishing grounds, rivers and bridge
 * sites, the oasis and caravan starts, the castle and the coast's check order, the barbarians'
 * X marks) moves with it: ids are shifted, and the static data goes to `board.ext.tb`.
 */
import { NO_ROBBER } from '../../../engine/expansions/ext';
import type { CustomMapDef, HexListFrameDef } from '../../../engine/maps';
import type { Rng } from '../../../engine/rng';
import { topologyFor } from '../../../engine/topology';
import type {
  Board,
  DevCardCounts,
  HexId,
  HexTile,
  MapId,
  Port,
  ScenarioId,
} from '../../../engine/types';
import { prepared, SEA_MAPS, SEAFARERS, type SeaBoard } from '../../seafarers/engine/maps';
import { TB_MAPS, TRADERS_BARBARIANS_19 } from '../../tb/engine/maps';
import type { TbBoard } from '../../tb/engine/state';

export const TBSEA = 'tbsea';
const TB = 'tb';

/** The New Shores map the boards are built on. */
export const BASE_MAP = 'seafarers/hns4' as const;
const BASE_KEY = 'hns4' as const;
/** h:0,0 of the T&B board goes to h:0,4, the centre of the New Shores main island. */
export const SHIFT = { dq: 0, dr: 4 } as const;

/** Shift a hex / vertex / edge id (spokes and plaza centres included) by `SHIFT`. */
export function shiftId<T extends string>(id: T): T {
  const m = /^([hve]):(-?\d+),(-?\d+)(.*)$/.exec(id);
  if (!m) return id;
  const q = Number(m[2]) + SHIFT.dq;
  const r = Number(m[3]) + SHIFT.dr;
  return `${m[1]}:${q + 0},${r + 0}${m[4] ?? ''}` as T;
}

/** Shift every id inside plain JSON data. */
export function shiftAll<T>(x: T): T {
  if (typeof x === 'string') return shiftId(x) as T;
  if (Array.isArray(x)) return x.map(shiftAll) as T;
  if (x !== null && typeof x === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) out[k] = shiftAll(v);
    return out as T;
  }
  return x;
}

export interface Pair {
  /** The combination's scenario id. */
  id: ScenarioId;
  /** The T&B scenario played on New Shores, and its 19-hex map. */
  tb: ScenarioId;
  tbMap: MapId;
  name: string;
  blurb: string;
  /** New Shores' 14 VP plus the sheet's increment. */
  vp: number;
  /** The robber and the pirate are not used (T&B, Barbarian Attack). */
  noPirate: boolean;
}

// prettier-ignore
export const PAIRS: readonly Pair[] = [
  { id: 'tbsea/traders', tb: 'tb/traders', tbMap: 'tb/traders19', vp: 17, noPirate: true,
    name: 'Traders & Barbarians on New Shores',
    blurb: 'Wagons cross the sea: 1 MP on your ships, 2 on open water. No robber, no pirate' },
  { id: 'tbsea/fishermen', tb: 'tb/fishermen', tbMap: 'tb/fish19', vp: 14, noPirate: false,
    name: 'Fishermen on New Shores',
    blurb: '2 fish chase the pirate away, 5 fish build a free ship; the pirate blocks a ground' },
  { id: 'tbsea/rivers', tb: 'tb/rivers', tbMap: 'tb/rivers19', vp: 14, noPirate: false,
    name: 'Rivers on New Shores',
    blurb: 'A ship built on a river hex’s edge earns 1 gold; no ship on a bridge site' },
  { id: 'tbsea/caravans', tb: 'tb/caravans', tbMap: 'tb/caravans19', vp: 16, noPirate: false,
    name: 'Caravans on New Shores',
    blurb: 'Camels may cross the sea; a camel on your ship counts it twice for the trade route' },
  { id: 'tbsea/barbarianAttack', tb: 'tb/barbarianAttack', tbMap: 'tb/ba19', vp: 14, noPirate: true,
    name: 'Barbarian Attack on New Shores',
    blurb: 'Ships may sail past conquered hexes; routes grow only from unconquered buildings' },
];

export const pairOf = (scenario: ScenarioId | null): Pair | undefined =>
  PAIRS.find((p) => p.id === scenario);

export const mapIdOf = (pair: Pair): `${string}/${string}` =>
  `${TBSEA}/${pair.id.slice(TBSEA.length + 1)}Hns`;

function tbMapOf(pair: Pair): CustomMapDef {
  const m = TB_MAPS.find((x) => x.id === pair.tbMap);
  if (!m) throw new Error(`unknown T&B map ${pair.tbMap}`);
  return m;
}

/** The frame: New Shores' cells; the T&B island's harbours and plazas (shifted). */
function frameOf(pair: Pair): HexListFrameDef {
  const base = prepared(BASE_KEY).frame;
  const tbMap = tbMapOf(pair);
  const t = topologyFor(tbMap.id);
  const harbors = t.portSlots.map((s) => {
    const land = t.edge[s.edge]?.hexes[0] as HexId;
    return [shiftId(s.waterHex), shiftId(land)] as const;
  });
  const plazas = tbMap.frame.plazas ?? [];
  return {
    id: mapIdOf(pair),
    hexes: base.hexes,
    sea: base.sea ?? [],
    harbors,
    plazas: plazas.map((p) => ({ hex: shiftId(p.hex), corners: p.corners })),
  };
}

/** Fishing grounds lie on the water hex at their tip (the pirate may block them there). */
function withGroundHexes(tbMap: CustomMapDef, ext: TbBoard): TbBoard {
  if (!ext.grounds) return ext;
  const t = topologyFor(tbMap.id);
  return {
    ...ext,
    grounds: ext.grounds.map((g) => {
      const tip = g.vertices[0];
      const hex = tip === undefined ? undefined : t.vertex[tip]?.seas[0];
      return hex === undefined ? g : { ...g, hex };
    }),
  };
}

function generate(pair: Pair, rng: Rng, players: number): { board: Board; robber: HexId } {
  const seaMap = SEA_MAPS.find((m) => m.id === BASE_MAP) as CustomMapDef;
  const tbMap = tbMapOf(pair);
  const sea = seaMap.generate(rng, players);
  const tb = tbMap.generate(rng, players);
  const hexes: Record<HexId, HexTile> = { ...sea.board.hexes };
  for (const tile of Object.values(tb.board.hexes)) {
    const id = shiftId(tile.id);
    if (hexes[id] === undefined) throw new Error(`${pair.id}: ${id} is not on the main island`);
    hexes[id] = { ...tile, id, q: tile.q + SHIFT.dq, r: tile.r + SHIFT.dr };
  }
  const ports: Port[] = tb.board.ports.map((p) => shiftAll(p));
  let ext = withGroundHexes(tbMap, (tb.board.ext?.[TB] ?? {}) as TbBoard);
  if (pair.tb === 'tb/traders') ext = { ...ext, barbarians: [...TRADERS_BARBARIANS_19] };
  const seaExt = sea.board.ext?.[SEAFARERS] as SeaBoard;
  const board: Board = {
    hexes,
    ports,
    ext: {
      [SEAFARERS]: pair.noPirate ? { ...seaExt, pirate: null } : seaExt,
      [TB]: shiftAll(ext),
    },
  };
  const robber = tb.robber === NO_ROBBER ? NO_ROBBER : shiftId(tb.robber);
  return { board, robber };
}

function mapDefOf(pair: Pair): CustomMapDef {
  let frame: HexListFrameDef | null = null;
  return {
    id: mapIdOf(pair),
    name: `${pair.name} (3-4)`,
    get frame() {
      frame ??= frameOf(pair);
      return frame;
    },
    minPlayers: 3,
    maxPlayers: 4,
    layout: 'custom',
    basedOn: BASE_MAP,
    get bankPerResource(): number {
      return tbMapOf(pair).bankPerResource;
    },
    get devDeck(): Readonly<DevCardCounts> {
      return tbMapOf(pair).devDeck;
    },
    generate: (rng, players) => generate(pair, rng, players),
  };
}

export const TBSEA_MAPS: readonly CustomMapDef[] = PAIRS.map(mapDefOf);
