/**
 * T&B + Seafarers on the other Seafarers scenarios (card C3, docs/rules/combos.md §2d): the
 * Seafarers scenario's own board with the T&B scenario's pieces laid on it, as the 2025 sheets'
 * text set-ups say. A `Plan` names what changes on one map:
 *
 * - `lake` / `oasis`: the hex holding that terrain and number becomes T&B's lake / watering hole;
 * - `disc`: the replaced hex's number disc joins another hex, which then produces on either number
 *   (`board.ext.tbsea.extraTokens`, paid by the `production` hook);
 * - `grounds`: where the six fishing grounds go (the sheets: "according to your preference");
 * - `rivers`: T&B's two rivers on a variable set-up (Forgotten Tribe) or a random one (New World).
 *
 * Everything T&B reads (lakes, grounds, rivers and bridge sites, caravan starts) goes to
 * `board.ext.tb` in the shape its own boards use, so T&B's rules run unchanged.
 */
import {
  CORNERS,
  SIDES,
  cornerVertex,
  hexCenter,
  neighbor,
  parseHexId,
  sideEdge,
  hexId,
} from '../../../engine/hex';
import type { GeneratedBoard } from '../../../engine/maps';
import type { Rng } from '../../../engine/rng';
import { topologyFor, type Topology } from '../../../engine/topology';
import type { EdgeId, HexId, HexTile, MapId, Port, Terrain, VertexId } from '../../../engine/types';
import {
  boardWith,
  components,
  dealTokens,
  newWorldCounts,
  prepared,
  randomHarbors,
  SEA_MAPS,
  SEAFARERS,
  tokenRule,
  type MapKey,
  type SeaBoard,
} from '../../seafarers/engine/maps';
import { ARROWS, caravanStart, RIVERS_19, sharedEdge } from '../../tb/engine/maps';
import { LAKE, OASIS, SWAMP, type FishingGround, type TbBoard } from '../../tb/engine/state';

const TB = 'tb';
export const TBSEA_EXT = 'tbsea';

/** Static data of a C3 board (`board.ext.tbsea`). */
export interface TbseaBoard {
  /** Number discs moved onto a hex that already has one: it produces on either number. */
  extraTokens?: { hex: HexId; number: number }[];
}

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

export interface Plan {
  lake?: Pick;
  /** The watering hole on a printed hex, or as central as possible (New World). */
  oasis?: Pick | 'centre';
  /** Where the replaced hex's number disc goes: a printed hex, or the lowest-ranking pasture. */
  disc?: Pick | 'lowestPasture';
  grounds?: GroundRule;
  rivers?: 'variableTribe' | 'newWorld';
  robber?: 'swamp' | 'oasis';
  /** The robber may go back onto the watering hole (Merchant Trains + Forgotten Tribe). */
  robberOnOasis?: boolean;
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
    const free = notches.filter(
      (n) =>
        slot.allow(n) &&
        n.vertices.every((v) => !used.has(v)) &&
        !placed.some((p) => p.hex === n.hex),
    );
    const clear = free.filter((n) => n.vertices.every((v) => !harbour.has(v)));
    const pool = clear.length > 0 || strict ? clear : free;
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
  const r1 = rng.pick(riverSpots(area, layouts[0]?.length ?? 4, mouthOk));
  const second = riverSpots(area, layouts[1]?.length ?? 3, mouthOk).filter(
    (r) => !touches(r1.hexes, r.hexes),
  );
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
): { hexes: Record<HexId, HexTile>; tb: TbBoard; extra: TbseaBoard } {
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
    tb: riverData(rivers),
    extra: {
      extraTokens: [
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
  let own: TbseaBoard = {};
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
    tb = r.tb;
    own = r.extra;
  }
  // The lake or the watering hole replaces a printed hex; its number may join another hex.
  const replace = (pick: Pick, terrain: Terrain): HexId => {
    const h = findHex(hexes, pick);
    hexes[h] = tileAt(h, terrain);
    if (plan.disc) {
      const to =
        plan.disc === 'lowestPasture'
          ? lowestRanking(rng, hexes, ['wool'], new Set())
          : findHex(hexes, plan.disc);
      own = { extraTokens: [...(own.extraTokens ?? []), { hex: to, number: pick.token }] };
    }
    return h;
  };
  if (plan.lake) {
    const h = replace(plan.lake, LAKE);
    tb = { ...tb, lakes: [{ hex: h, numbers: [...LAKE_NUMBERS] }] };
  }
  if (plan.oasis && plan.oasis !== 'centre') oasisHex = replace(plan.oasis, OASIS);
  const topo = topologyFor(mapId);
  if (oasisHex !== null) {
    const h = oasisHex;
    tb = { ...tb, caravanStarts: ARROWS.map((c) => caravanStart(topo, h, c)) };
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
  const ext: Record<string, unknown> = { ...gb.board.ext, [TB]: tb };
  if (own.extraTokens) ext[TBSEA_EXT] = own;
  return { board: { ...gb.board, hexes, ext }, robber };
}

/** The extra numbers of a board (`board.ext.tbsea`). */
export const tbseaBoard = (board: { ext?: Record<string, unknown> }): TbseaBoard =>
  (board.ext?.[TBSEA_EXT] as TbseaBoard | undefined) ?? {};
