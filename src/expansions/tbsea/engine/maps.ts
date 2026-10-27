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
import {
  prepared,
  SEA_MAPS,
  SEAFARERS,
  type MapKey,
  type SeaBoard,
} from '../../seafarers/engine/maps';
import { TB_MAPS, TRADERS_BARBARIANS_19 } from '../../tb/engine/maps';
import type { TbBoard } from '../../tb/engine/state';
import {
  BA_DESERT3,
  BA_DESERT4,
  CARAVANS_FOUR3,
  CARAVANS_FOUR4,
  DESERT3_2025,
  RIVERS_DESERT3_V1,
  RIVERS_DESERT3_V2,
  RIVERS_DESERT4_V1,
  RIVERS_DESERT4_V2,
  RIVERS_FOG3,
  RIVERS_FOG4,
  TRADERS_DESERT3,
  TRADERS_DESERT4,
} from './layouts';
import { layoutFrame, planBoard, type Plan } from './overlays';

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

// ---------------------------------------------------------------------------------------------
// C3: T&B scenarios on the other Seafarers scenarios (overlays.ts)
// ---------------------------------------------------------------------------------------------

export interface SeaPairMap {
  key: MapKey;
  players: readonly [number, number];
  plan: Plan;
}

export interface SeaPair {
  id: ScenarioId;
  /** The T&B scenario and the Seafarers scenario it is played on. */
  tb: ScenarioId;
  sea: ScenarioId;
  name: string;
  blurb: string;
  /** The Seafarers scenario's target plus the sheet's increment. */
  vp: number;
  maps: readonly SeaPairMap[];
}

const both = (key: MapKey, plan: Plan): SeaPairMap[] => [{ key, players: [3, 4], plan }];

// prettier-ignore
export const SEA_PAIRS: readonly SeaPair[] = [
  { id: 'tbsea/fishermenFour', tb: 'tb/fishermen', sea: 'seafarers/fourIslands', vp: 13,
    name: 'Fishermen on the Four Islands',
    blurb: '4 and 8, 6 and 10 fish by the small islands, 5 and 9 by the big ones',
    maps: [{ key: 'four3', players: [3, 3], plan: { grounds: 'fourIslands' } },
      { key: 'four4', players: [4, 4], plan: { grounds: 'fourIslands' } }] },
  { id: 'tbsea/fishermenFog', tb: 'tb/fishermen', sea: 'seafarers/fogIslands', vp: 12,
    name: 'Fishermen on the Fog Islands',
    blurb: 'Fishing grounds along the face-up islands; no lake',
    maps: [{ key: 'fog3', players: [3, 3], plan: { grounds: 'any' } },
      { key: 'fog4', players: [4, 4], plan: { grounds: 'any' } }] },
  { id: 'tbsea/fishermenDesert', tb: 'tb/fishermen', sea: 'seafarers/throughTheDesert', vp: 14,
    name: 'Fishermen Through the Desert',
    blurb: 'The lake replaces a field (3) or a hill (4): its number joins another hex',
    maps: [
      { key: 'desert3', players: [3, 3],
        plan: { layout: DESERT3_2025, lake: { terrain: 'grain', token: 2 }, disc: { terrain: 'wool', token: 12 }, grounds: 'any' } },
      { key: 'desert4', players: [4, 4],
        plan: { lake: { terrain: 'brick', token: 11 }, disc: { terrain: 'brick', token: 2 }, grounds: 'any' } }] },
  { id: 'tbsea/fishermenTribe', tb: 'tb/fishermen', sea: 'seafarers/forgottenTribe', vp: 13,
    name: 'Fishermen and the Forgotten Tribe',
    blurb: 'The lake replaces the 12 field; the robber stays on the large island',
    maps: both('tribe', { lake: { terrain: 'grain', token: 12 }, grounds: 'main' }) },
  { id: 'tbsea/fishermenCloth', tb: 'tb/fishermen', sea: 'seafarers/clothForCatan', vp: 14,
    name: 'Fishermen and Cloth for Catan',
    blurb: 'Three grounds by each large island; chase the pirate with a route to a village',
    maps: both('cloth', { grounds: 'cloth' }) },
  { id: 'tbsea/fishermenWonders', tb: 'tb/fishermen', sea: 'seafarers/wondersOfCatan', vp: 10,
    name: 'Fishermen and the Wonders of Catan',
    blurb: 'Fishing grounds along the large and small islands; no lake',
    maps: both('wonders', { grounds: 'any' }) },
  { id: 'tbsea/fishermenNewWorld', tb: 'tb/fishermen', sea: 'seafarers/newWorld', vp: 12,
    name: 'Fishermen in the New World',
    blurb: 'A random archipelago; the grounds placed like the harbours',
    maps: both('newworld', { grounds: 'newWorld' }) },
  { id: 'tbsea/caravansDesert', tb: 'tb/caravans', sea: 'seafarers/throughTheDesert', vp: 16,
    name: 'Caravans Through the Desert',
    blurb: 'The watering hole replaces a field (3) or a hill (4); camels may cross the sea',
    maps: [
      { key: 'desert3', players: [3, 3], plan: { layout: DESERT3_2025, oasis: { terrain: 'grain', token: 2 }, disc: { terrain: 'wool', token: 12 } } },
      { key: 'desert4', players: [4, 4], plan: { oasis: { terrain: 'brick', token: 11 }, disc: { terrain: 'brick', token: 2 } } }] },
  { id: 'tbsea/caravansTribe', tb: 'tb/caravans', sea: 'seafarers/forgottenTribe', vp: 15,
    name: 'Caravans and the Forgotten Tribe',
    blurb: 'The robber starts on the watering hole and may go back there',
    maps: both('tribe', { oasis: { terrain: 'grain', token: 12 }, disc: { terrain: 'wool', token: 2 },
      robber: 'oasis', robberOnOasis: true }) },
  { id: 'tbsea/caravansNewWorld', tb: 'tb/caravans', sea: 'seafarers/newWorld', vp: 14,
    name: 'Caravans in the New World',
    blurb: 'The watering hole in the middle of a random archipelago',
    maps: both('newworld', { oasis: 'centre' }) },
  { id: 'tbsea/riversTribe', tb: 'tb/rivers', sea: 'seafarers/forgottenTribe', vp: 13,
    name: 'Rivers and the Forgotten Tribe',
    blurb: 'Two rivers on a variable large island; the 2 and the 12 join weak hexes',
    maps: both('tribe', { rivers: 'variableTribe', robber: 'swamp' }) },
  { id: 'tbsea/riversNewWorld', tb: 'tb/rivers', sea: 'seafarers/newWorld', vp: 12,
    name: 'Rivers in the New World',
    blurb: 'Two rivers flow into the frame of a random archipelago',
    maps: both('newworld', { rivers: 'newWorld' }) },
  // --- The sheets' set-up diagrams (decoded in docs/rules/combos.md §2d) -----------------------
  { id: 'tbsea/riversFog', tb: 'tb/rivers', sea: 'seafarers/fogIslands', vp: 12,
    name: 'Rivers on the Fog Islands',
    blurb: 'Rivers on both home islands; gold fields in the fog give resource cards',
    maps: [
      { key: 'fog3', players: [3, 3], plan: { robber: 'swamp', layout: RIVERS_FOG3 } },
      { key: 'fog4', players: [4, 4], plan: { robber: 'swamp', layout: RIVERS_FOG4 } }] },
  { id: 'tbsea/riversDesert', tb: 'tb/rivers', sea: 'seafarers/throughTheDesert', vp: 14,
    name: 'Rivers Through the Desert (1)',
    blurb: 'Swamps in the desert belt: the rivers flow into the desert and a gold field',
    maps: [
      { key: 'desert3', players: [3, 3], plan: { layout: RIVERS_DESERT3_V1 } },
      { key: 'desert4', players: [4, 4], plan: { layout: RIVERS_DESERT4_V1 } }] },
  { id: 'tbsea/riversDesert2', tb: 'tb/rivers', sea: 'seafarers/throughTheDesert', vp: 14,
    name: 'Rivers Through the Desert (2)',
    blurb: 'A river beyond the desert instead of the strip’s gold field',
    maps: [
      { key: 'desert3', players: [3, 3], plan: { layout: RIVERS_DESERT3_V2 } },
      { key: 'desert4', players: [4, 4], plan: { layout: RIVERS_DESERT4_V2 } }] },
  { id: 'tbsea/caravansFour', tb: 'tb/caravans', sea: 'seafarers/fourIslands', vp: 15,
    name: 'Caravans on the Four Islands',
    blurb: 'The watering hole alone in the middle; the pirate starts beside the board',
    maps: [
      { key: 'four3', players: [3, 3], plan: { layout: CARAVANS_FOUR3 } },
      { key: 'four4', players: [4, 4], plan: { layout: CARAVANS_FOUR4 } }] },
  { id: 'tbsea/tradersDesert', tb: 'tb/traders', sea: 'seafarers/throughTheDesert', vp: 17,
    name: 'Traders & Barbarians Through the Desert',
    blurb: 'Castle, quarry beyond the desert and glassworks; wagons cross sea and sand',
    maps: [
      { key: 'desert3', players: [3, 3], plan: { layout: TRADERS_DESERT3 } },
      { key: 'desert4', players: [4, 4], plan: { layout: TRADERS_DESERT4 } }] },
  { id: 'tbsea/barbarianAttackDesert', tb: 'tb/barbarianAttack', sea: 'seafarers/throughTheDesert', vp: 14,
    name: 'Barbarian Attack Through the Desert',
    blurb: 'The barbarians land on the main island only; knights guard it',
    maps: [
      { key: 'desert3', players: [3, 3], plan: { layout: BA_DESERT3, ba: true } },
      { key: 'desert4', players: [4, 4], plan: { layout: BA_DESERT4, ba: true } }] },
];

export const seaMapIdOf = (pair: SeaPair, m: SeaPairMap): `${string}/${string}` =>
  `${TBSEA}/${pair.id.slice(TBSEA.length + 1)}-${m.key}`;

export const seaPairOf = (scenario: ScenarioId | null): SeaPair | undefined =>
  SEA_PAIRS.find((p) => p.id === scenario);

function seaMapDefOf(pair: SeaPair, m: SeaPairMap): CustomMapDef {
  const id = seaMapIdOf(pair, m);
  const base = SEA_MAPS.find((x) => x.id === `${SEAFARERS}/${m.key}`) as CustomMapDef;
  let frame: HexListFrameDef | null = null;
  return {
    id,
    name: `${pair.name} (${m.players[0] === m.players[1] ? m.players[0] : m.players.join('-')})`,
    get frame() {
      frame ??= layoutFrame(m.key, id, m.plan.layout);
      return frame;
    },
    minPlayers: m.players[0],
    maxPlayers: m.players[1],
    layout: 'custom',
    basedOn: base.id,
    bankPerResource: base.bankPerResource,
    devDeck: base.devDeck,
    generate: (rng, players) => planBoard(rng, id, m.key, players, m.plan),
  };
}

export const TBSEA_MAPS: readonly CustomMapDef[] = [
  ...PAIRS.map(mapDefOf),
  ...SEA_PAIRS.flatMap((p) => p.maps.map((m) => seaMapDefOf(p, m))),
];
