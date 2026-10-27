/**
 * T&B + Seafarers on the other Seafarers scenarios (card C3, docs/rules/combos.md §2d): the
 * Seafarers scenario's own board with the T&B scenario's pieces laid on it, as the 2025 sheets'
 * text set-ups say. A `Plan` names what changes on one map:
 *
 * - `lake` / `oasis`: the hex holding that terrain and number becomes T&B's lake / watering hole;
 * - `disc`: the replaced hex's number disc joins another hex, which then produces on either number
 *   (T&B's `alsoOn`, which T&B pays and draws);
 * - `grounds`: where the six fishing grounds go (the sheets: "according to your preference");
 * - `rivers`: T&B's two rivers on a variable set-up (Forgotten Tribe) or a random one (New World).
 *
 * Everything T&B reads (lakes, grounds, rivers and bridge sites, caravan starts) goes to
 * `board.ext.tb` in the shape its own boards use, so T&B's rules run unchanged.
 */
import { NO_ROBBER } from '../../../engine/expansions/ext';
import {
  CORNERS,
  SIDES,
  cornerVertex,
  edgeEndpoints,
  hexCenter,
  neighbor,
  parseHexId,
  sideEdge,
  hexId,
  type Corner,
} from '../../../engine/hex';
import type { GeneratedBoard, HexListFrameDef } from '../../../engine/maps';
import type { Rng } from '../../../engine/rng';
import { topologyFor, type Topology } from '../../../engine/topology';
import type { EdgeId, HexId, HexTile, MapId, Port, Terrain, VertexId } from '../../../engine/types';
import {
  cellEdge,
  cellHex,
  parseCell,
  type BookSide,
  type Cell,
} from '../../seafarers/engine/coords';
import {
  boardWith,
  components,
  dealTokens,
  newWorldCounts,
  parseHarbors,
  prepared,
  randomHarbors,
  SEA_MAPS,
  SEAFARERS,
  tokenRule,
  type MapKey,
  type SeaBoard,
} from '../../seafarers/engine/maps';
import { ARROWS, RIVERS_19, sharedEdge } from '../../tb/engine/maps';
import {
  CASTLE,
  GLASSWORKS,
  LAKE,
  OASIS,
  QUARRY,
  SWAMP,
  TRADE_CASTLE,
  TRADE_TERRAINS,
  type CaravanStart,
  type FishingGround,
  type TbBoard,
  type TradeHex,
  type TradeKind,
} from '../../tb/engine/state';

const TB = 'tb';

/** A number disc moved onto a hex that already has one (T&B's `TbBoard.alsoOn`). */
type AlsoOn = { hex: HexId; number: number };

/** A printed hex, found by its terrain and number. */
export interface Pick {
  terrain: Terrain;
  token: number;
}

export type GroundRule =
  /** Anywhere on the coast of land (face-up land on the Fog Islands). */
  | 'any'
  /** Around the main island (region M). */
  | 'main'
  /** Four Islands: 4 and 8 on one small island, 6 and 10 on the other, 5 and 9 on the big ones. */
  | 'fourIslands'
  /** Cloth for Catan: three grounds on each large island. */
  | 'cloth'
  /** New World: like the harbours, never sharing a corner with a harbour. */
  | 'newWorld';

/**
 * A sheet's set-up diagram as changes to our printed map (the 2025 diagrams are drawn on the same
 * cells, docs/rules/combos.md §2d), in the rules doc's book cells (seafarers.md §2.0).
 */
export interface Layout {
  /** "c,r terrain [n[/m]]": the cell's terrain and number (m: a second disc); 'sea' removes it. */
  cells?: string;
  /** "c,r SIDE kind; ...": replaces the map's harbours. */
  harbors?: string;
  /** Each river from its source to its swamp, then the mouth side: "3,1 2,2 1,3 0,4 NW". */
  rivers?: readonly string[];
  /** Barbarians' start paths "c,r SIDE; ..." (Traders & Barbarians). */
  barbarians?: string;
  /** The robber's and the pirate's start: a cell, 'off' (beside the board) or 'none'. */
  robber?: string;
  pirate?: string;
}

export interface Plan {
  lake?: Pick;
  /** The watering hole on a printed hex, or as central as possible (New World). */
  oasis?: Pick | 'centre';
  /** Where the replaced hex's number disc goes. */
  disc?: Pick;
  grounds?: GroundRule;
  rivers?: 'variableTribe' | 'newWorld';
  robber?: 'swamp' | 'oasis';
  /** The robber may go back onto the watering hole (Merchant Trains + Forgotten Tribe). */
  robberOnOasis?: boolean;
  layout?: Layout;
  /** Barbarian Attack: the castle, the coast and the knights on the main island (region M). */
  ba?: boolean;
}

const GROUND_NUMBERS: readonly number[] = [4, 5, 6, 8, 9, 10];
const LAKE_NUMBERS: readonly number[] = [2, 3, 11, 12];

const isLand = (t: Terrain | undefined): boolean => t !== undefined && t !== 'sea' && t !== 'fog';
const pips = (n: number): number => 6 - Math.abs(7 - n);
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function findHex(hexes: Record<HexId, HexTile>, pick: Pick): HexId {
  const hit = (Object.keys(hexes) as HexId[])
    .sort(byId)
    .find((h) => hexes[h]?.terrain === pick.terrain && hexes[h]?.token === pick.token);
  if (!hit) throw new Error(`no ${pick.terrain} ${pick.token} on the board`);
  return hit;
}

/** The pastures (or `kinds`) with the fewest pips, `exclude` aside; ties at random. */
function lowestRanking(
  rng: Rng,
  hexes: Record<HexId, HexTile>,
  kinds: readonly Terrain[],
  exclude: ReadonlySet<HexId>,
): HexId {
  const cands = (Object.keys(hexes) as HexId[])
    .sort(byId)
    .filter((h) => !exclude.has(h) && kinds.includes(hexes[h]?.terrain as Terrain))
    .filter((h) => hexes[h]?.token !== null && hexes[h]?.token !== undefined);
  const low = Math.min(...cands.map((h) => pips(hexes[h]?.token ?? 7)));
  return rng.pick(cands.filter((h) => pips(hexes[h]?.token ?? 7) === low));
}

// ---------------------------------------------------------------------------------------------
// Fishing grounds
// ---------------------------------------------------------------------------------------------

/** A coastal notch: a corner of two land hexes and one water hex, where a ground can lie. */
interface Notch {
  tip: VertexId;
  /** The tip and its two neighbours on the water hex. */
  vertices: VertexId[];
  /** The water hex the ground lies on. */
  hex: HexId;
  land: [HexId, HexId];
  x: number;
  y: number;
}

function cornersOf(h: HexId): VertexId[] {
  const { q, r } = parseHexId(h);
  return CORNERS.map((c) => cornerVertex(q, r, c));
}

function notchesOf(topo: Topology, hexes: Record<HexId, HexTile>): Notch[] {
  const out: Notch[] = [];
  for (const v of topo.vertices) {
    const info = topo.vertex[v];
    if (!info) continue;
    const around = [...info.hexes, ...info.seas];
    if (around.some((h) => hexes[h]?.terrain === 'fog')) continue;
    const land = around.filter((h) => isLand(hexes[h]?.terrain));
    const water = around.filter((h) => !isLand(hexes[h]?.terrain));
    if (land.length !== 2 || water.length !== 1) continue;
    const hex = water[0] as HexId;
    const ring = cornersOf(hex);
    const i = ring.indexOf(v);
    if (i < 0) continue;
    const prev = ring[(i + 5) % 6] as VertexId;
    const next = ring[(i + 1) % 6] as VertexId;
    out.push({
      tip: v,
      vertices: [v, prev, next],
      hex,
      land: [land[0] as HexId, land[1] as HexId],
      x: info.x,
      y: info.y,
    });
  }
  return out.sort((a, b) => byId(a.tip, b.tip));
}

/** One ground to place: its number and the notches it may use. */
interface Slot {
  number: number;
  allow: (n: Notch) => boolean;
}

/**
 * Place the grounds one by one at random notches: never sharing a corner with another ground,
 * and spread out (a notch far from the grounds already placed first); harbour corners only when
 * nothing else fits (never with `strict`, New World's "like the harbours").
 */
function placeGrounds(
  rng: Rng,
  notches: readonly Notch[],
  ports: readonly Port[],
  slots: readonly Slot[],
  strict: boolean,
): FishingGround[] {
  const harbour = new Set(ports.flatMap((p) => p.vertices));
  const used = new Set<VertexId>();
  const placed: Notch[] = [];
  const out: FishingGround[] = [];
  for (const slot of slots) {
    const free = notches.filter((n) => slot.allow(n) && n.vertices.every((v) => !used.has(v)));
    const clear = (n: Notch) => n.vertices.every((v) => !harbour.has(v));
    const alone = (n: Notch) => !placed.some((p) => p.hex === n.hex);
    // Away from harbours and other grounds' water hexes first, then relaxing (a crowded New
    // World coast: a shared water hex, a harbour corner only as the last resort).
    const tiers = strict
      ? [free.filter((n) => clear(n) && alone(n)), free.filter(clear), free]
      : [free.filter((n) => clear(n) && alone(n)), free.filter(alone), free];
    const pool = tiers.find((t) => t.length > 0) ?? [];
    if (pool.length === 0) throw new Error(`no place for the fishing ground ${slot.number}`);
    const dist = (n: Notch) =>
      Math.min(Infinity, ...placed.map((p) => Math.hypot(p.x - n.x, p.y - n.y)));
    let pick: Notch | undefined;
    for (const min of [4, 3, 2, 0]) {
      const far = pool.filter((n) => dist(n) >= min);
      if (far.length > 0) {
        pick = rng.pick(far);
        break;
      }
    }
    const n = pick as Notch;
    placed.push(n);
    for (const v of n.vertices) used.add(v);
    out.push({ number: slot.number, vertices: n.vertices, hex: n.hex });
  }
  return out;
}

function groundSlots(
  rng: Rng,
  rule: GroundRule,
  hexes: Record<HexId, HexTile>,
  sea: SeaBoard,
): Slot[] {
  const numbers = rng.shuffle(GROUND_NUMBERS);
  const any = () => true;
  const on = (island: ReadonlySet<HexId>) => (n: Notch) => n.land.every((h) => island.has(h));
  switch (rule) {
    case 'any':
    case 'newWorld':
      return numbers.map((number) => ({ number, allow: any }));
    case 'main':
      return numbers.map((number) => ({
        number,
        allow: (n: Notch) => n.land.every((h) => sea.region[h] === 'M'),
      }));
    case 'fourIslands': {
      const islands = components(
        (Object.keys(hexes) as HexId[]).filter((h) => isLand(hexes[h]?.terrain)),
      ).sort((a, b) => a.length - b.length);
      if (islands.length !== 4) throw new Error('Four Islands: expected four islands');
      const [s1, s2, b1, b2] = rng
        .shuffle([0, 1])
        .concat(rng.shuffle([2, 3]))
        .map((i) => new Set(islands[i]));
      return [
        { number: 4, allow: on(s1 as Set<HexId>) },
        { number: 8, allow: on(s1 as Set<HexId>) },
        { number: 6, allow: on(s2 as Set<HexId>) },
        { number: 10, allow: on(s2 as Set<HexId>) },
        { number: 5, allow: on(b1 as Set<HexId>) },
        { number: 9, allow: on(b2 as Set<HexId>) },
      ];
    }
    case 'cloth': {
      const main = (Object.keys(hexes) as HexId[]).filter(
        (h) => sea.region[h] === 'M' && isLand(hexes[h]?.terrain),
      );
      const islands = components(main).sort((a, b) => b.length - a.length);
      const [a, b] = rng.shuffle([0, 1]).map((i) => new Set(islands[i]));
      return numbers.map((number, i) => ({ number, allow: on((i < 3 ? a : b) as Set<HexId>) }));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Rivers
// ---------------------------------------------------------------------------------------------

interface River {
  hexes: HexId[];
  mouth: EdgeId;
}

const opposite = (i: number) => SIDES[(i + 3) % 6] as (typeof SIDES)[number];

/**
 * Every straight placement of a river of `length` hexes inside `area`, its swamp (first hex)
 * flowing into the water through a side `mouthOk` accepts (the side away from the river if it
 * can, as on T&B's own boards).
 */
function riverSpots(
  area: ReadonlySet<HexId>,
  length: number,
  mouthOk: (h: HexId) => boolean,
): River[] {
  const out: River[] = [];
  for (const start of [...area].sort(byId)) {
    const { q, r } = parseHexId(start);
    SIDES.forEach((side, i) => {
      const line: HexId[] = [start];
      let p = { q, r };
      for (let k = 1; k < length; k++) {
        p = neighbor(p.q, p.r, side);
        line.push(hexId(p.q, p.r));
      }
      if (!line.every((h) => area.has(h))) return;
      const order = [opposite(i), ...SIDES.filter((s) => s !== opposite(i) && s !== side)];
      const mouth = order.find((s) => {
        const n = neighbor(q, r, s);
        return mouthOk(hexId(n.q, n.r));
      });
      if (mouth) out.push({ hexes: line, mouth: sideEdge(q, r, mouth) });
    });
  }
  return out;
}

function touches(a: readonly HexId[], b: readonly HexId[]): boolean {
  const near = new Set<HexId>();
  for (const h of a) {
    near.add(h);
    const { q, r } = parseHexId(h);
    for (const s of SIDES) {
      const n = neighbor(q, r, s);
      near.add(hexId(n.q, n.r));
    }
  }
  return b.some((h) => near.has(h));
}

/**
 * T&B's two rivers (the 4-hex and the 3-hex river of `tb/rivers19`, swamp first) placed straight
 * and apart; `spread` = the swamps far from each other ("opposite sides of the board").
 */
function placeRivers(
  rng: Rng,
  area: ReadonlySet<HexId>,
  mouthOk: (h: HexId) => boolean,
  spread: boolean,
): { rivers: River[]; terrains: Map<HexId, Terrain> } {
  const layouts = RIVERS_19.rivers;
  const shorts = riverSpots(area, layouts[1]?.length ?? 3, mouthOk);
  // Only a first river that leaves room for the second (the Tribe's island is narrow).
  const firsts = riverSpots(area, layouts[0]?.length ?? 4, mouthOk).filter((a) =>
    shorts.some((b) => !touches(a.hexes, b.hexes)),
  );
  const r1 = rng.pick(firsts);
  const second = shorts.filter((r) => !touches(r1.hexes, r.hexes));
  const d = (r: River) => {
    const a = parseHexId(r1.hexes[0] as HexId);
    const b = parseHexId(r.hexes[0] as HexId);
    return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
  };
  const far = spread ? second.filter((r) => d(r) >= 4) : second;
  const r2 = rng.pick(far.length > 0 ? far : second);
  const terrains = new Map<HexId, Terrain>();
  [r1, r2].forEach((r, i) =>
    r.hexes.forEach((h, k) => terrains.set(h, layouts[i]?.[k]?.[1] as Terrain)),
  );
  return { rivers: [r1, r2], terrains };
}

function riverData(rivers: readonly River[]): TbBoard {
  const sites: EdgeId[] = [];
  for (const r of rivers) {
    for (let i = 0; i + 1 < r.hexes.length; i++) {
      sites.push(sharedEdge(r.hexes[i] as HexId, r.hexes[i + 1] as HexId));
    }
  }
  sites.push(...rivers.map((r) => r.mouth));
  return { rivers: rivers.flatMap((r) => r.hexes), bridgeSites: sites, twoOnTwelve: null };
}

const tileAt = (h: HexId, terrain: Terrain, token: number | null = null): HexTile => {
  const { q, r } = parseHexId(h);
  return { id: h, q, r, terrain, token };
};

/**
 * Rivers + Forgotten Tribe: the variable set-up, 2 hills, 2 pastures, 1 field and 2 mountains
 * replaced by the rivers (swamps flowing into the sea, rivers apart); numbers dealt without the 2
 * and the 12 (swamps skipped, reds apart), which then join the lowest-ranking pasture or field.
 */
function tribeRivers(
  rng: Rng,
  base: GeneratedBoard,
): { hexes: Record<HexId, HexTile>; tb: TbBoard } {
  const hexes = { ...base.board.hexes };
  const sea = base.board.ext?.[SEAFARERS] as SeaBoard;
  const main = (Object.keys(hexes) as HexId[]).sort(byId).filter((h) => sea.region[h] === 'M');
  const area = new Set(main);
  const { rivers, terrains } = placeRivers(rng, area, (h) => !isLand(hexes[h]?.terrain), false);
  const pool: Terrain[] = main.map((h) => hexes[h]?.terrain as Terrain);
  for (const t of ['brick', 'brick', 'wool', 'wool', 'grain', 'ore', 'ore'] as Terrain[]) {
    pool.splice(pool.indexOf(t), 1);
  }
  const tokens = main.map((h) => hexes[h]?.token).filter((n): n is number => typeof n === 'number');
  for (const n of [2, 12]) tokens.splice(tokens.indexOf(n), 1);
  const bag = rng.shuffle(pool);
  for (const h of main) hexes[h] = tileAt(h, terrains.get(h) ?? (bag.pop() as Terrain));
  const slots = main.filter((h) => hexes[h]?.terrain !== SWAMP);
  dealTokens(rng, slots, tokens, hexes, tokenRule(prepared('tribe'), hexes));
  const fields: readonly Terrain[] = ['wool', 'grain'];
  const two = lowestRanking(rng, hexes, fields, new Set());
  const twelve = lowestRanking(rng, hexes, fields, new Set([two]));
  return {
    hexes,
    tb: {
      ...riverData(rivers),
      alsoOn: [
        { hex: two, number: 2 },
        { hex: twelve, number: 12 },
      ],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// New World boards (random): rivers or the watering hole placed first
// ---------------------------------------------------------------------------------------------

/**
 * A New World board with `fixed` cells placed first and the rest of the hexes random: the
 * terrain counts minus `remove` (the hexes the fixed ones replace), numbers on the resource and
 * gold hexes, harbours on the coast (as Seafarers' own New World board).
 */
function newWorldWith(
  rng: Rng,
  fixed: ReadonlyMap<HexId, Terrain>,
  remove: Partial<Record<Terrain, number>>,
): GeneratedBoard {
  const p = prepared('newworld');
  const counts = newWorldCounts('newworld');
  const bag: Terrain[] = [];
  for (const [t, n] of Object.entries(counts.terrain) as [Terrain, number][]) {
    for (let i = 0; i < n - (remove[t] ?? 0); i++) bag.push(t);
  }
  const free = p.boardCells.filter((c) => !fixed.has(c.hex));
  if (bag.length !== free.length) throw new Error('New World: hex count');
  let last: GeneratedBoard | null = null;
  for (let attempt = 0; attempt <= 20; attempt++) {
    const terrains = rng.shuffle(bag);
    const hexes: Record<HexId, HexTile> = {};
    for (const [h, t] of fixed) hexes[h] = tileAt(h, t);
    free.forEach((c, i) => (hexes[c.hex] = tileAt(c.hex, terrains[i] as Terrain)));
    const noNumber: readonly (Terrain | undefined)[] = ['desert', SWAMP, OASIS];
    const slots = p.boardCells
      .map((c) => c.hex)
      .filter((h) => isLand(hexes[h]?.terrain) && !noNumber.includes(hexes[h]?.terrain));
    dealTokens(rng, slots, counts.tokens, hexes, tokenRule(p, hexes));
    const ports = randomHarbors(rng, p, hexes);
    last = boardWith(p, hexes, ports);
    if (ports.length === p.spec.harborKinds.length) break;
  }
  return last as GeneratedBoard;
}

/** The cells of `key`'s playing area nearest its centre, at random among equals. */
function centreCell(rng: Rng, key: MapKey): HexId {
  const inside = prepared(key).inside;
  const pts = inside.map((h) => {
    const { q, r } = parseHexId(h);
    return { h, ...hexCenter(q, r) };
  });
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const d = (p: { x: number; y: number }) => Math.round(Math.hypot(p.x - cx, p.y - cy) * 1000);
  const best = Math.min(...pts.map(d));
  return rng.pick(
    pts
      .filter((p) => d(p) === best)
      .map((p) => p.h)
      .sort(byId),
  );
}

// ---------------------------------------------------------------------------------------------
// Layouts: a sheet's diagram as changes to the printed map
// ---------------------------------------------------------------------------------------------

/** T&B terrains by the short names the layouts use. */
const TB_TERRAINS: Readonly<Record<string, Terrain>> = {
  swamp: SWAMP,
  lake: LAKE,
  oasis: OASIS,
  castle: CASTLE,
  tradeCastle: TRADE_CASTLE,
  quarry: QUARRY,
  glassworks: GLASSWORKS,
};

interface LaidCell {
  hex: HexId;
  terrain: Terrain;
  token: number | null;
  extra: number | null;
}

const entries = (s: string | undefined): string[] =>
  (s ?? '')
    .split(/[;\n]/)
    .map((x) => x.trim().replace(/\s+/g, ' '))
    .filter((x) => x.length > 0);

function laidCells(layout: Layout): LaidCell[] {
  return entries(layout.cells).map((e) => {
    const [pos = '', name = '', disc] = e.split(' ');
    const [a, b] = (disc ?? '').split('/');
    return {
      hex: cellHex(parseCell(pos)),
      terrain: TB_TERRAINS[name] ?? (name as Terrain),
      token: a ? Number(a) : null,
      extra: b ? Number(b) : null,
    };
  });
}

const bookEdge = (s: string): EdgeId => {
  const [pos = '', side = ''] = s.trim().split(/\s+/);
  return cellEdge(parseCell(pos), side as BookSide);
};

/** A start cell ('off' = beside the board, 'none' = not in the game). */
function startHex(s: string): HexId | null {
  if (s === 'none') return null;
  return s === 'off' ? NO_ROBBER : cellHex(parseCell(s));
}

/** The land of `key`'s printed map with the layout's changes (static: frames and plazas). */
function staticLand(key: MapKey, layout: Layout): Map<HexId, Terrain> {
  const land = new Map<HexId, Terrain>();
  for (const c of prepared(key).boardCells) land.set(c.hex, c.terrain);
  for (const c of laidCells(layout)) land.set(c.hex, c.terrain);
  return land;
}

/** The corners of trade hex `h` next to other land: the settlement corners (plaza spokes). */
function tradeCorners(h: HexId, isLandHex: (x: HexId) => boolean): Corner[] {
  const { q, r } = parseHexId(h);
  const around = SIDES.map((s) => {
    const n = neighbor(q, r, s);
    return hexId(n.q, n.r);
  }).filter(isLandHex);
  return CORNERS.filter((c) => {
    const v = cornerVertex(q, r, c);
    return around.some((n) => cornersOf(n).includes(v));
  });
}

/**
 * The frame of a combination map on `key`: the printed cells plus the layout's new land, its
 * harbours, and a plaza on each trade hex (spokes to its corners on other land).
 */
export function layoutFrame(
  key: MapKey,
  id: `${string}/${string}`,
  layout: Layout | undefined,
): HexListFrameDef {
  const base = prepared(key).frame;
  if (!layout) return { ...base, id };
  const land = staticLand(key, layout);
  const added = laidCells(layout)
    .map((c) => c.hex)
    .filter((h) => !base.hexes.includes(h));
  const harbors = layout.harbors
    ? parseHarbors(layout.harbors).map((s) => [s.water, s.land] as const)
    : base.harbors;
  const isLandHex = (h: HexId) => isLand(land.get(h));
  const plazas = [...land]
    .filter(([, t]) => TRADE_TERRAINS.includes(t))
    .map(([hex]) => ({ hex, corners: tradeCorners(hex, isLandHex) }));
  return {
    id,
    hexes: [...base.hexes, ...added],
    sea: (base.sea ?? []).filter((h) => !added.includes(h)),
    harbors,
    ...(plazas.length > 0 ? { plazas } : {}),
  };
}

/** Lay the diagram on `hexes` (in place): cells, rivers, harbours, the barbarians' paths. */
function applyLayout(
  layout: Layout,
  hexes: Record<HexId, HexTile>,
): { tb: TbBoard; ports: Port[] | null; alsoOn: AlsoOn[] } {
  const alsoOn: AlsoOn[] = [];
  for (const c of laidCells(layout)) {
    hexes[c.hex] = tileAt(c.hex, c.terrain, c.token);
    if (c.extra !== null) alsoOn.push({ hex: c.hex, number: c.extra });
  }
  let tb: TbBoard = {};
  if (layout.rivers) {
    const rivers = layout.rivers.map((s): River => {
      const parts = s.trim().split(/\s+/);
      const side = parts.pop() as BookSide;
      const cells = parts.map(parseCell);
      const swamp = cells[cells.length - 1] as Cell;
      return { hexes: cells.map(cellHex), mouth: cellEdge(swamp, side) };
    });
    tb = riverData(rivers);
  }
  if (layout.barbarians) tb = { ...tb, barbarians: entries(layout.barbarians).map(bookEdge) };
  const ports = layout.harbors
    ? parseHarbors(layout.harbors).map((s): Port => ({
        kind: s.kind ?? 'generic',
        edge: s.edge,
        vertices: edgeEndpoints(s.edge),
        waterHex: s.water,
      }))
    : null;
  return { tb, ports, alsoOn };
}

/** Traders & Barbarians: the trade hexes, the corners nobody settles and the sides nobody builds on. */
function tradeData(hexes: Record<HexId, HexTile>): TbBoard {
  const kinds: Readonly<Record<string, TradeKind>> = {
    [TRADE_CASTLE]: 'castle',
    [QUARRY]: 'quarry',
    [GLASSWORKS]: 'glassworks',
  };
  const isLandHex = (h: HexId) => isLand(hexes[h]?.terrain);
  const tradeHexes: TradeHex[] = [];
  const noBuild: VertexId[] = [];
  const noRoad: EdgeId[] = [];
  for (const t of Object.values(hexes).sort((a, b) => byId(a.id, b.id))) {
    const kind = kinds[t.terrain];
    if (!kind) continue;
    tradeHexes.push({ hex: t.id, kind });
    const open = tradeCorners(t.id, isLandHex);
    const closed = CORNERS.filter((c) => !open.includes(c)).map((c) => cornerVertex(t.q, t.r, c));
    noBuild.push(...closed);
    for (const side of SIDES) {
      const n = neighbor(t.q, t.r, side);
      const e = sideEdge(t.q, t.r, side);
      if (isLandHex(hexId(n.q, n.r))) continue;
      if (edgeEndpoints(e).some((v) => closed.includes(v))) noRoad.push(e);
    }
  }
  return { tradeHexes, noBuild, noRoad };
}

/**
 * Barbarian Attack on the main island (region M): its castle, its coastal hexes in check order
 * (clockwise from the hex after the castle; castle and deserts skipped, as on T&B's own boards),
 * and the knights' area.
 */
function baData(hexes: Record<HexId, HexTile>, sea: SeaBoard): TbBoard {
  const main = (Object.keys(hexes) as HexId[])
    .sort(byId)
    .filter((h) => sea.region[h] === 'M' && isLand(hexes[h]?.terrain));
  const castles = main.filter((h) => hexes[h]?.terrain === CASTLE);
  const coastal = main.filter((h) => {
    const { q, r } = parseHexId(h);
    return SIDES.some((s) => {
      const n = neighbor(q, r, s);
      return !isLand(hexes[hexId(n.q, n.r)]?.terrain);
    });
  });
  const pts = main.map((h) => hexCenter(parseHexId(h).q, parseHexId(h).r));
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const angle = (h: HexId) => {
    const p = hexCenter(parseHexId(h).q, parseHexId(h).r);
    return Math.atan2(p.y - cy, p.x - cx);
  };
  const ring = coastal.sort((a, b) => angle(a) - angle(b));
  const first = castles[0];
  const i = first === undefined ? -1 : ring.indexOf(first);
  const ordered = i < 0 ? ring : [...ring.slice(i + 1), ...ring.slice(0, i + 1)];
  const coast = ordered.filter(
    (h) => hexes[h]?.terrain !== CASTLE && hexes[h]?.terrain !== 'desert',
  );
  return { castles, coast, knightArea: main };
}

/**
 * The first camel of the arrow at `corner` of the watering hole: the path leaving that corner,
 * between the hole's two neighbours there (T&B's `caravanStart`, but also on open sea: Four Islands).
 */
function seaCaravanStart(oasis: HexId, corner: Corner): CaravanStart {
  const { q, r } = parseHexId(oasis);
  const tail = cornerVertex(q, r, corner);
  const [a, b] = SIDES.map((s) => {
    const n = neighbor(q, r, s);
    return hexId(n.q, n.r);
  }).filter((n) => cornersOf(n).includes(tail));
  const edge = sharedEdge(a as HexId, b as HexId);
  const head = edgeEndpoints(edge).find((v) => v !== tail) as VertexId;
  return { edge, head };
}

// ---------------------------------------------------------------------------------------------
// The board of a plan
// ---------------------------------------------------------------------------------------------

/** The Seafarers scenario's printed (or New World's random) board for `players`. */
function seaBase(rng: Rng, key: MapKey, players: number): GeneratedBoard {
  const def = SEA_MAPS.find((m) => m.id === `${SEAFARERS}/${key}`);
  if (!def) throw new Error(`unknown Seafarers map ${key}`);
  return def.generate(rng, players);
}

/** Generate the board of `plan` on Seafarers map `key`; `mapId` is the combination map's id. */
export function planBoard(
  rng: Rng,
  mapId: MapId,
  key: MapKey,
  players: number,
  plan: Plan,
): GeneratedBoard {
  let gb: GeneratedBoard;
  let tb: TbBoard = {};
  const alsoOn: AlsoOn[] = [];
  let oasisHex: HexId | null = null;
  if (key === 'newworld' && plan.rivers === 'newWorld') {
    const inside = new Set(prepared(key).inside);
    const placed = placeRivers(rng, inside, (h) => !inside.has(h), true);
    gb = newWorldWith(rng, placed.terrains, { brick: 2, wool: 1, ore: 2, sea: 2 });
    tb = riverData(placed.rivers);
  } else if (key === 'newworld' && plan.oasis === 'centre') {
    oasisHex = centreCell(rng, key);
    gb = newWorldWith(rng, new Map([[oasisHex, OASIS]]), { sea: 1 });
  } else {
    gb = seaBase(rng, key, players);
  }
  const hexes = { ...gb.board.hexes };
  if (plan.rivers === 'variableTribe') {
    const r = tribeRivers(rng, gb);
    Object.assign(hexes, r.hexes);
    const { alsoOn: also, ...rest } = r.tb;
    tb = rest;
    alsoOn.push(...(also ?? []));
  }
  const layout = plan.layout;
  const laid = layout ? applyLayout(layout, hexes) : null;
  if (laid) {
    tb = { ...tb, ...laid.tb };
    alsoOn.push(...laid.alsoOn);
  }
  // The lake or the watering hole replaces a printed hex; its number may join another hex.
  const replace = (pick: Pick, terrain: Terrain): HexId => {
    const h = findHex(hexes, pick);
    hexes[h] = tileAt(h, terrain);
    if (plan.disc) {
      alsoOn.push({ hex: findHex(hexes, plan.disc), number: pick.token });
    }
    return h;
  };
  if (plan.lake) {
    const h = replace(plan.lake, LAKE);
    tb = { ...tb, lakes: [{ hex: h, numbers: [...LAKE_NUMBERS] }] };
  }
  if (plan.oasis && plan.oasis !== 'centre') oasisHex = replace(plan.oasis, OASIS);
  const topo = topologyFor(mapId);
  if (layout && laid) {
    const ports = laid.ports ?? gb.board.ports;
    // Region tags and bonus areas from the changed board (a lone watering hole is no island).
    const fresh = boardWith(prepared(key), hexes, ports);
    const seaExt = fresh.board.ext?.[SEAFARERS] as SeaBoard;
    const area: Record<HexId, string> = Object.fromEntries(
      Object.entries(seaExt.area).filter(([h]) => hexes[h as HexId]?.terrain !== OASIS),
    );
    // Land the diagram adds beside an island belongs to that island's bonus area.
    for (const c of laidCells(layout)) {
      if (area[c.hex] !== undefined || !isLand(c.terrain) || c.terrain === OASIS) continue;
      const { q, r } = parseHexId(c.hex);
      for (const s of SIDES) {
        const n = neighbor(q, r, s);
        const a = area[hexId(n.q, n.r)];
        if (a !== undefined) {
          area[c.hex] = a;
          break;
        }
      }
    }
    const pirate = layout.pirate === undefined ? undefined : startHex(layout.pirate);
    gb = {
      board: {
        ...gb.board,
        ports,
        ext: {
          ...gb.board.ext,
          [SEAFARERS]: { ...seaExt, area, ...(pirate === undefined ? {} : { pirate }) },
        },
      },
      robber: layout.robber === undefined ? gb.robber : (startHex(layout.robber) ?? NO_ROBBER),
    };
    oasisHex ??= (Object.keys(hexes) as HexId[]).find((h) => hexes[h]?.terrain === OASIS) ?? null;
    if (Object.values(hexes).some((t) => TRADE_TERRAINS.includes(t.terrain))) {
      tb = { ...tb, ...tradeData(hexes) };
    }
    if (plan.ba) tb = { ...tb, ...baData(hexes, seaExt) };
  }
  if (alsoOn.length > 0) tb = { ...tb, alsoOn };
  if (oasisHex !== null) {
    const h = oasisHex;
    tb = { ...tb, caravanStarts: ARROWS.map((c) => seaCaravanStart(h, c)) };
    if (plan.robberOnOasis) tb = { ...tb, robberOnOasis: true };
  }
  const sea = gb.board.ext?.[SEAFARERS] as SeaBoard;
  if (plan.grounds) {
    const slots = groundSlots(rng, plan.grounds, hexes, sea);
    tb = {
      ...tb,
      grounds: placeGrounds(
        rng,
        notchesOf(topo, hexes),
        gb.board.ports,
        slots,
        plan.grounds === 'newWorld',
      ),
    };
  }
  let robber = gb.robber;
  if (plan.robber === 'swamp') {
    robber = rng.pick((tb.rivers ?? []).filter((h) => hexes[h]?.terrain === SWAMP).sort(byId));
  } else if (plan.robber === 'oasis' && oasisHex !== null) {
    robber = oasisHex;
  }
  return { board: { ...gb.board, hexes, ext: { ...gb.board.ext, [TB]: tb } }, robber };
}
