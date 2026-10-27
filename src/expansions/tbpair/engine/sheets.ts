/**
 * The six T&B × T&B sheets without Fishing (the 2025 sheets, docs/rules/traders-barbarians.md
 * §8.1, docs/rules/combos.md §2d): their boards. Where a sheet shows its board (Barbarian Attack
 * + T&B, Rivers + BA) the numbers and fixed hexes are the diagram's, on the same 19 positions as
 * T&B's Barbarian Attack board; the others follow the sheet's text on T&B's boards. Static rule
 * changes T&B's features read go to `board.ext.tb.rules` (TbSheetRules).
 */
import { NUMBER_TOKENS } from '../../../engine/constants';
import { assembleBoard, dealTokens } from '../../../engine/board';
import { NO_ROBBER } from '../../../engine/expansions/ext';
import { cornerVertex, parseHexId, sideEdge } from '../../../engine/hex';
import { FRAME_STD19, MAPS, type CustomMapDef, type GeneratedBoard } from '../../../engine/maps';
import type { Rng } from '../../../engine/rng';
import { topologyFor, type Topology } from '../../../engine/topology';
import type { Board, EdgeId, HexId, ScenarioId, Terrain } from '../../../engine/types';
import {
  ARROWS,
  BA_19,
  FRAME_TRADERS19,
  PORTS_19,
  RIVERS_19,
  TB_TRADERS19,
  TRADE_19,
  TRADE_TERRAIN,
  caravanStart,
  clockwiseCoast,
  fill,
  innerHexes,
  isRes,
  placeTerrains,
  sharedEdge,
  tradeBans,
} from '../../tb/engine/maps';
import {
  CASTLE,
  OASIS,
  SWAMP,
  TB,
  TRADE_TERRAINS,
  type CaravanStart,
  type TbBoard,
} from '../../tb/engine/state';
import { TBPAIR } from './maps';

export interface Sheet {
  id: ScenarioId;
  /** The two T&B scenarios it plays as. */
  pair: readonly [ScenarioId, ScenarioId];
  name: string;
  blurb: string;
  vp: number;
  /** The trade hexes carry numbers and produce: quarry brick, glassworks lumber, castle wool. */
  tradeYield: boolean;
}

// prettier-ignore
export const SHEETS: readonly Sheet[] = [
  { id: 'tbpair/baTraders', pair: ['tb/barbarianAttack', 'tb/traders'], vp: 14, tradeYield: true,
    name: 'Barbarian Attack + Traders & Barbarians',
    blurb: 'Barbarians stand by a path and block wagons; a 2 or 12 lands one; trade hexes produce' },
  { id: 'tbpair/caravansBa', pair: ['tb/caravans', 'tb/barbarianAttack'], vp: 12, tradeYield: false,
    name: 'Caravans + Barbarian Attack',
    blurb: 'The oasis on the coast: two caravans; barbarians never stop a camel' },
  { id: 'tbpair/caravansTraders', pair: ['tb/caravans', 'tb/traders'], vp: 15, tradeYield: true,
    name: 'Caravans + Traders & Barbarians',
    blurb: 'The oasis in the middle; the trade hexes produce brick, lumber and wool' },
  { id: 'tbpair/riversBa', pair: ['tb/rivers', 'tb/barbarianAttack'], vp: 12, tradeYield: false,
    name: 'Rivers + Barbarian Attack',
    blurb: 'The 2 and 12 share a hex and both land barbarians; no Poor Settler penalty' },
  { id: 'tbpair/riversCaravans', pair: ['tb/rivers', 'tb/caravans'], vp: 12, tradeYield: false,
    name: 'Rivers + Caravans',
    blurb: 'The 2 and the 12 join the two 3s; camels may cross the rivers' },
  { id: 'tbpair/riversTraders', pair: ['tb/rivers', 'tb/traders'], vp: 13, tradeYield: true,
    name: 'Rivers + Traders & Barbarians',
    blurb: '3 gold to start; bridges pay 2; a river costs a wagon 3 MP, a rival bridge 2 gold' },
];

export const sheetMapId = (sheet: Sheet): `${string}/${string}` =>
  `${TBPAIR}/${sheet.id.slice(TBPAIR.length + 1)}19`;

const withTb = (board: Board, ext: TbBoard): Board => ({ ...board, ext: { [TB]: ext } });
const tradeTerrains = (): [HexId, Terrain][] =>
  TRADE_19.map((s): [HexId, Terrain] => [s.hex, TRADE_TERRAIN[s.kind]]);
const tradeHexes = () => TRADE_19.map((s) => ({ hex: s.hex, kind: s.kind }));
/** Numbered hexes: resources, and the trade hexes where they produce. */
const numbered = (t: Terrain) => isRes(t) || TRADE_TERRAINS.includes(t);

/** Barbarian Attack's castle (T&B's BA board and both diagrams). */
const BA_CASTLE: HexId = 'h:-2,2';

/** Fill the coastal and the inner hexes from their own pools (Barbarian Attack's set-up). */
function coastAndInner(
  rng: Rng,
  topo: Topology,
  fixed: ReadonlyMap<HexId, Terrain>,
  coastPool: readonly Terrain[],
  innerPool: readonly Terrain[],
): Terrain[] {
  const coastBag = rng.shuffle(coastPool);
  const innerBag = rng.shuffle(innerPool);
  const inner = new Set(innerHexes(topo));
  const out = topo.landHexes.map(
    (h) => fixed.get(h) ?? (inner.has(h) ? innerBag.pop() : coastBag.pop()),
  );
  if (coastBag.length + innerBag.length > 0 || out.some((t) => t === undefined)) {
    throw new Error('terrain pool mismatch');
  }
  return out as Terrain[];
}

/** BA's check order: clockwise from the hex after the castle, without the hexes in `skip`. */
function baCoast(topo: Topology, skip: ReadonlySet<HexId>): HexId[] {
  const ring = clockwiseCoast(topo, BA_CASTLE);
  return [...ring.slice(1), BA_CASTLE].filter((h) => !skip.has(h));
}

/** Bridge sites: between the hexes of each river, and its mouth. */
function bridgeSites(rivers: readonly (readonly HexId[])[], mouths: readonly EdgeId[]): EdgeId[] {
  const out: EdgeId[] = [];
  for (const river of rivers) {
    for (let i = 0; i + 1 < river.length; i++) {
      out.push(sharedEdge(river[i] as HexId, river[i + 1] as HexId));
    }
  }
  return [...out, ...mouths];
}

/** Caravan starts of an oasis: its arrows that lead onto the land (a coastal oasis has two). */
function oasisStarts(topo: Topology, oasis: HexId): CaravanStart[] {
  const { q, r } = parseHexId(oasis);
  const own = new Set(topo.hex[oasis]?.edges ?? []);
  return ARROWS.filter((c) =>
    (topo.vertex[cornerVertex(q, r, c)]?.edges ?? []).some((e) => !own.has(e)),
  ).map((c) => caravanStart(topo, oasis, c));
}

// ---------------------------------------------------------------------------------------------
// Barbarian Attack + T&B: the BA board, the trade hexes on the desert (quarry), the 12 (castle)
// and the 2 (glassworks); a barbarian at the centre of the castle and the glassworks.
// ---------------------------------------------------------------------------------------------

function baTraders(rng: Rng, topo: Topology): GeneratedBoard {
  const fixed = new Map<HexId, Terrain>([...tradeTerrains(), [BA_CASTLE, CASTLE]]);
  const terrains = coastAndInner(
    rng,
    topo,
    fixed,
    [...fill('brick', 2), 'lumber', ...fill('wool', 2), ...fill('grain', 2), 'ore'],
    ['brick', 'lumber', 'wool', ...fill('grain', 2), ...fill('ore', 2)],
  );
  const tokens = topo.landHexes.map((h) => BA_19.numbers[h] ?? null);
  const { board } = assembleBoard(topo, terrains, tokens, rng.shuffle(PORTS_19));
  const castle = TRADE_19.find((s) => s.kind === 'castle')?.hex as HexId;
  const glass = TRADE_19.find((s) => s.kind === 'glassworks')?.hex as HexId;
  return {
    board: withTb(board, {
      tradeHexes: tradeHexes(),
      ...tradeBans(topo, TRADE_19),
      castles: [BA_CASTLE],
      coast: baCoast(topo, new Set([BA_CASTLE])),
      rules: { barbarianPaths: true, baStart: [castle, glass] },
    }),
    robber: NO_ROBBER,
  };
}

// ---------------------------------------------------------------------------------------------
// Merchant Trains (our Caravans) + Barbarian Attack: the BA board, the oasis on the desert.
// ---------------------------------------------------------------------------------------------

function caravansBa(rng: Rng, topo: Topology): GeneratedBoard {
  const oasis = BA_19.deserts[0] as HexId;
  const fixed = new Map<HexId, Terrain>([
    [BA_CASTLE, CASTLE],
    [oasis, OASIS],
  ]);
  const terrains = coastAndInner(rng, topo, fixed, BA_19.coastPool, BA_19.innerPool);
  const tokens = topo.landHexes.map((h) => BA_19.numbers[h] ?? null);
  const { board } = assembleBoard(topo, terrains, tokens, rng.shuffle(PORTS_19));
  return {
    board: withTb(board, {
      castles: [BA_CASTLE],
      coast: baCoast(topo, new Set([BA_CASTLE, oasis])),
      caravanStarts: oasisStarts(topo, oasis),
    }),
    robber: NO_ROBBER,
  };
}

// ---------------------------------------------------------------------------------------------
// Rivers + Barbarian Attack (the sheet's diagram): castle and two rivers fixed, BA's numbers;
// the 2 joins the 12; start barbarians on the 2/12 and the 11.
// ---------------------------------------------------------------------------------------------

const RIBA_RIVERS: readonly (readonly (readonly [HexId, Terrain])[])[] = [
  [
    ['h:2,-2', SWAMP],
    ['h:1,-1', 'wool'],
    ['h:0,0', 'brick'],
    ['h:-1,1', 'ore'],
  ],
  [
    ['h:2,0', 'ore'],
    ['h:1,1', 'brick'],
    ['h:0,2', SWAMP],
  ],
];
const RIBA_MOUTHS: readonly EdgeId[] = [sideEdge(2, -2, 'NE'), sideEdge(0, 2, 'SW')];

function riversBa(rng: Rng, topo: Topology): GeneratedBoard {
  const fixed = new Map<HexId, Terrain>([[BA_CASTLE, CASTLE], ...RIBA_RIVERS.flat()]);
  const terrains = coastAndInner(
    rng,
    topo,
    fixed,
    ['brick', ...fill('lumber', 2), ...fill('wool', 2), ...fill('grain', 2)],
    ['lumber', ...fill('grain', 2), 'ore'],
  );
  const numbers: Record<HexId, number> = { ...BA_19.numbers };
  Reflect.deleteProperty(numbers, 'h:0,2');
  const tokens = topo.landHexes.map((h) => (fixed.get(h) === SWAMP ? null : (numbers[h] ?? null)));
  const { board } = assembleBoard(topo, terrains, tokens, rng.shuffle(PORTS_19));
  const rivers = RIBA_RIVERS.map((r) => r.map(([h]) => h));
  const swamps = RIBA_RIVERS.flat().flatMap(([h, t]) => (t === SWAMP ? [h] : []));
  return {
    board: withTb(board, {
      rivers: rivers.flat(),
      bridgeSites: bridgeSites(rivers, RIBA_MOUTHS),
      twoOnTwelve: 'h:-2,0',
      castles: [BA_CASTLE],
      coast: baCoast(topo, new Set([BA_CASTLE, ...swamps])),
      rules: { noPoorVp: true, baStart: ['h:-2,0', 'h:2,0'] },
    }),
    robber: NO_ROBBER,
  };
}

// ---------------------------------------------------------------------------------------------
// Rivers + Merchant Trains: T&B's rivers, the oasis in the middle, the 2 and the 12 on the 3s.
// ---------------------------------------------------------------------------------------------

const riversOf = () => RIVERS_19.rivers.map((r) => r.map(([h]) => h));

function riversCaravans(rng: Rng, topo: Topology): GeneratedBoard {
  const oasis: HexId = 'h:0,0';
  const fixed = new Map<HexId, Terrain>([...RIVERS_19.rivers.flat(), [oasis, OASIS]]);
  const pool: Terrain[] = [
    ...fill('lumber', 4),
    ...fill('wool', 2),
    ...fill('grain', 3),
    'brick',
    'ore',
  ];
  const terrains = placeTerrains(rng, topo, fixed, pool);
  const tokens = dealTokens(
    rng,
    topo,
    terrains,
    NUMBER_TOKENS.filter((n) => n !== 2 && n !== 12),
    isRes,
  );
  const { board } = assembleBoard(topo, terrains, tokens, rng.shuffle(PORTS_19));
  const threes = rng.shuffle(topo.landHexes.filter((h) => board.hexes[h]?.token === 3));
  const swamps = RIVERS_19.rivers.flat().flatMap(([h, t]) => (t === SWAMP ? [h] : []));
  return {
    board: withTb(board, {
      rivers: riversOf().flat(),
      bridgeSites: bridgeSites(riversOf(), RIVERS_19.mouths),
      alsoOn: [
        { hex: threes[0] as HexId, number: 2 },
        { hex: threes[1] as HexId, number: 12 },
      ],
      caravanStarts: ARROWS.map((c) => caravanStart(topo, oasis, c)),
    }),
    robber: rng.pick(swamps),
  };
}

// ---------------------------------------------------------------------------------------------
// Merchant Trains + T&B: the trade hexes, the oasis in the middle, every number disc.
// ---------------------------------------------------------------------------------------------

function caravansTraders(rng: Rng, topo: Topology): GeneratedBoard {
  const oasis: HexId = 'h:0,0';
  const fixed = new Map<HexId, Terrain>([...tradeTerrains(), [oasis, OASIS]]);
  const pool = [
    ...fill('lumber', 3),
    ...fill('wool', 3),
    ...fill('grain', 4),
    ...fill('brick', 2),
    ...fill('ore', 3),
  ];
  const terrains = placeTerrains(rng, topo, fixed, pool);
  const tokens = dealTokens(rng, topo, terrains, NUMBER_TOKENS, numbered);
  const { board } = assembleBoard(topo, terrains, tokens, rng.shuffle(PORTS_19));
  return {
    board: withTb(board, {
      tradeHexes: tradeHexes(),
      ...tradeBans(topo, TRADE_19),
      caravanStarts: ARROWS.map((c) => caravanStart(topo, oasis, c)),
    }),
    robber: NO_ROBBER,
  };
}

// ---------------------------------------------------------------------------------------------
// Rivers + T&B: the trade hexes, T&B's rivers (apart), the 2 on the 12.
// ---------------------------------------------------------------------------------------------

function riversTraders(rng: Rng, topo: Topology): GeneratedBoard {
  const fixed = new Map<HexId, Terrain>([...tradeTerrains(), ...RIVERS_19.rivers.flat()]);
  const pool: Terrain[] = [...fill('lumber', 3), 'wool', ...fill('grain', 3), 'brick', 'ore'];
  const terrains = placeTerrains(rng, topo, fixed, pool);
  const tokens = dealTokens(
    rng,
    topo,
    terrains,
    NUMBER_TOKENS.filter((n, i) => n !== 2 || i !== NUMBER_TOKENS.indexOf(2)),
    numbered,
  );
  const { board } = assembleBoard(topo, terrains, tokens, rng.shuffle(PORTS_19));
  const twelve = topo.landHexes.find((h) => board.hexes[h]?.token === 12) ?? null;
  return {
    board: withTb(board, {
      tradeHexes: tradeHexes(),
      ...tradeBans(topo, TRADE_19),
      rivers: riversOf().flat(),
      bridgeSites: bridgeSites(riversOf(), RIVERS_19.mouths),
      twoOnTwelve: twelve,
      rules: {
        startGold: 3,
        bridgeGold: 2,
        riverGoldSetupOnly: true,
        noPoorVp: true,
        riverCrossing: { mp: 3, toll: 2 },
      },
    }),
    robber: NO_ROBBER,
  };
}

// ---------------------------------------------------------------------------------------------
// Map definitions
// ---------------------------------------------------------------------------------------------

type Generate = (rng: Rng, topo: Topology) => GeneratedBoard;
const BOARDS: Readonly<Record<string, { traders: boolean; generate: Generate }>> = {
  'tbpair/baTraders': { traders: true, generate: baTraders },
  'tbpair/caravansBa': { traders: false, generate: caravansBa },
  'tbpair/caravansTraders': { traders: true, generate: caravansTraders },
  'tbpair/riversBa': { traders: false, generate: riversBa },
  'tbpair/riversCaravans': { traders: false, generate: riversCaravans },
  'tbpair/riversTraders': { traders: true, generate: riversTraders },
};

function sheetMap(sheet: Sheet): CustomMapDef {
  const b = BOARDS[sheet.id];
  if (!b) throw new Error(`no board for ${sheet.id}`);
  const id = sheetMapId(sheet);
  return {
    id,
    name: `${sheet.name} (19 hexes)`,
    // Getters: T&B's maps are read only once the registry is loaded (import cycle, §2).
    get frame() {
      return b.traders ? FRAME_TRADERS19 : FRAME_STD19;
    },
    minPlayers: 3,
    maxPlayers: 4,
    layout: 'custom',
    get bankPerResource(): number {
      return MAPS.baseRandom.bankPerResource;
    },
    // With T&B the T&B deck (Barbarian Attack replaces any deck with its own: the supply hook).
    get devDeck() {
      return b.traders ? TB_TRADERS19.devDeck : MAPS.baseRandom.devDeck;
    },
    generate: (rng) => b.generate(rng, topologyFor(id)),
  };
}

export const SHEET_MAPS: readonly CustomMapDef[] = SHEETS.map(sheetMap);
