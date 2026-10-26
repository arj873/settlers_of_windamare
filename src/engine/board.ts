/**
 * Board generation per map (maps.ts): the official beginner layout ('base') and seeded random
 * layouts for every other map. Harbor POSITIONS are fixed by the frame (topology.portSlots); only
 * their kinds vary.
 */
import { MAPS } from './maps';
import type { Rng } from './rng';
import { hexNeighbors, topologyFor, type Topology } from './topology';
import type { Board, HexId, HexTile, MapId, MapRules, Port, PortKind, Terrain } from './types';

/**
 * Beginner layout from the base-game rulebook ("Starting Map for Beginners", Illustration A of the
 * 2020 5th-edition rules), in landHexes order (rows of 3,4,5,4,3, top to bottom, left to right).
 * Verified by T8 against the rulebook image (see docs/RULES.md §12).
 */
// prettier-ignore
const BEGINNER_HEXES: readonly [Terrain, number | null][] = [
  ['ore', 10], ['wool', 2], ['lumber', 9],
  ['grain', 12], ['brick', 6], ['wool', 4], ['brick', 10],
  ['grain', 9], ['lumber', 11], ['desert', null], ['lumber', 3], ['ore', 8],
  ['lumber', 8], ['ore', 3], ['grain', 4], ['wool', 5],
  ['brick', 5], ['grain', 6], ['wool', 11],
];

/** Port kinds for slots 0..8 in the beginner layout (verified against Illustration A). */
// prettier-ignore
const BEGINNER_PORTS: readonly PortKind[] = [
  'generic', 'grain', 'ore', 'generic', 'wool', 'generic', 'generic', 'brick', 'lumber',
];

export interface GeneratedBoard {
  board: Board;
  /**
   * Desert hex where the robber starts: a random one on maps with several deserts, or the first
   * one (landHexes order) when generated with `firstDesertOnly` (the 5+ player rule set).
   */
  robber: HexId;
}

export function generateBoard(
  map: MapId,
  rng: Rng,
  mapRules: MapRules = {},
  firstDesertOnly = false,
): GeneratedBoard {
  return MAPS[map].layout === 'beginner'
    ? beginnerBoard()
    : randomBoard(rng, map, mapRules, firstDesertOnly);
}

function assemble(
  topo: Topology,
  terrains: readonly Terrain[],
  tokens: readonly (number | null)[],
  portKinds: readonly PortKind[],
): { board: Board; deserts: HexId[] } {
  const hexes: Record<HexId, HexTile> = {};
  const deserts: HexId[] = [];
  topo.landHexes.forEach((id, i) => {
    const info = topo.hex[id];
    const terrain = terrains[i];
    const token = tokens[i];
    if (!info || terrain === undefined || token === undefined) throw new Error('bad layout');
    hexes[id] = { id, q: info.q, r: info.r, terrain, token };
    if (terrain === 'desert') deserts.push(id);
  });
  if (deserts.length === 0) throw new Error('layout has no desert');
  const ports: Port[] = topo.portSlots.map((slot, i) => ({
    kind: portKinds[i] ?? 'generic',
    edge: slot.edge,
    vertices: [...slot.vertices],
    waterHex: slot.waterHex,
  }));
  return { board: { hexes, ports }, deserts };
}

export function beginnerBoard(): GeneratedBoard {
  const { board, deserts } = assemble(
    topologyFor('base'),
    BEGINNER_HEXES.map(([t]) => t),
    BEGINNER_HEXES.map(([, n]) => n),
    BEGINNER_PORTS,
  );
  return { board, robber: deserts[0] as HexId };
}

const isRed = (n: number | null) => n === 6 || n === 8;
const isExtreme = (n: number | null) => n === 2 || n === 12;

/** Which map rules a board breaks (counts of touching pairs; 0 = the rule holds). */
export interface MapRuleViolations {
  red: number;
  extreme: number;
  sameNumber: number;
  sameResource: number;
}

/** Count adjacent land-hex pairs breaking each map rule (ignores which rules are allowed). */
export function mapRuleViolations(
  hexes: Record<HexId, HexTile>,
  map: MapId = 'baseRandom',
): MapRuleViolations {
  const topo = topologyFor(map);
  const out: MapRuleViolations = { red: 0, extreme: 0, sameNumber: 0, sameResource: 0 };
  for (const h of Object.values(hexes)) {
    for (const nId of hexNeighbors(topo, h.id)) {
      const n = hexes[nId];
      if (!n || n.id <= h.id) continue; // each pair once
      if (isRed(h.token) && isRed(n.token)) out.red++;
      if (isExtreme(h.token) && isExtreme(n.token)) out.extreme++;
      if (h.token !== null && h.token === n.token) out.sameNumber++;
      if (h.terrain !== 'desert' && h.terrain === n.terrain) out.sameResource++;
    }
  }
  return out;
}

/** True if no two 6/8 tokens sit on adjacent hexes (adjacency of `map`'s board). */
export function redNumbersSeparated(
  hexes: Record<HexId, HexTile>,
  map: MapId = 'baseRandom',
): boolean {
  return mapRuleViolations(hexes, map).red === 0;
}

/** Search budget: DFS nodes per restart, restarts per relaxation level. */
const NODE_BUDGET = 4000;
const RESTARTS = 60;

/**
 * Fill `slots` (indices into `adj`) with items from `bag` so that no two adjacent slots hold a
 * `conflict`ing pair. Randomized depth-first search (random slot order, random candidate order),
 * restarted when a restart's node budget is spent. Returns null when every restart failed.
 * Deterministic for a given RNG state.
 */
function fill<T>(
  count: number,
  adj: readonly (readonly number[])[],
  bag: readonly T[],
  conflict: ((a: T, b: T) => boolean) | null,
  rng: Rng,
): T[] | null {
  for (let restart = 0; restart < RESTARTS; restart++) {
    const order = rng.shuffle(Array.from({ length: count }, (_, i) => i));
    const left = new Map<T, number>();
    for (const x of rng.shuffle(bag)) left.set(x, (left.get(x) ?? 0) + 1);
    const placed: (T | undefined)[] = new Array<T | undefined>(count).fill(undefined);
    let nodes = 0;
    const dfs = (k: number): boolean => {
      if (k === count) return true;
      if (++nodes > NODE_BUDGET) return false;
      const slot = order[k] as number;
      const kinds = rng.shuffle([...left.keys()].filter((x) => (left.get(x) ?? 0) > 0));
      for (const x of kinds) {
        if (
          conflict &&
          adj[slot]?.some((n) => placed[n] !== undefined && conflict(x, placed[n] as T))
        ) {
          continue;
        }
        placed[slot] = x;
        left.set(x, (left.get(x) ?? 0) - 1);
        if (dfs(k + 1)) return true;
        left.set(x, (left.get(x) ?? 0) + 1);
        placed[slot] = undefined;
        if (nodes > NODE_BUDGET) return false;
      }
      return false;
    };
    if (dfs(0)) return placed as T[];
  }
  return null;
}

/** Neighbour indices among a subset of land hexes (`ids[i]` = hex of slot i). */
function adjacency(topo: Topology, ids: readonly HexId[]): number[][] {
  const index = new Map(ids.map((id, i) => [id, i]));
  return ids.map((id) =>
    hexNeighbors(topo, id).flatMap((n) => {
      const i = index.get(n);
      return i === undefined ? [] : [i];
    }),
  );
}

/**
 * The token pair rules still in force, strongest first when relaxing: a level drops the last
 * rule(s). Relaxation order when no layout is found (RULES.md §19): same numbers, then 2 & 12,
 * then 6 & 8, then none (any shuffle). Terrain: same resources, then none.
 */
function tokenConflicts(rules: MapRules): ((a: number, b: number) => boolean)[] {
  const levels: ((a: number, b: number) => boolean)[] = [];
  const build = (red: boolean, extreme: boolean, same: boolean) => (a: number, b: number) =>
    (red && isRed(a) && isRed(b)) || (extreme && isExtreme(a) && isExtreme(b)) || (same && a === b);
  const red = !rules.allowRedTouch;
  const extreme = !rules.allowExtremeTouch;
  const same = !rules.allowSameNumberTouch;
  levels.push(build(red, extreme, same));
  if (same) levels.push(build(red, extreme, false));
  if (extreme) levels.push(build(red, false, false));
  return levels; // randomBoard falls back to an unconstrained shuffle after the last level
}

/**
 * Shuffle terrains, then tokens onto the non-desert hexes, so that the active map rules hold
 * (`mapRules`: all constrained by default; see MapRules). Bounded randomized backtracking; when
 * a rule set cannot be met within the budget the rules are relaxed in a fixed order
 * (token: same numbers, 2 & 12; terrain: same resources) and finally the red rule, so
 * generation always terminates. Port kinds are shuffled too. With several deserts the robber
 * starts on a random one, or on the first (`firstDesertOnly`, the 5+ player rule set).
 */
export function randomBoard(
  rng: Rng,
  map: MapId = 'baseRandom',
  mapRules: MapRules = {},
  firstDesertOnly = false,
): GeneratedBoard {
  const def = MAPS[map];
  const topo = topologyFor(map);
  const terrainBag: Terrain[] = [];
  for (const [t, n] of Object.entries(def.terrain) as [Terrain, number][]) {
    for (let i = 0; i < n; i++) terrainBag.push(t);
  }
  if (terrainBag.length !== topo.landHexes.length) throw new Error(`${map}: terrain count`);
  if (def.tokens.length !== terrainBag.length - def.terrain.desert) {
    throw new Error(`${map}: token count`);
  }
  if (def.harbors.length !== topo.portSlots.length) throw new Error(`${map}: harbor count`);

  const landAdj = adjacency(topo, topo.landHexes);
  const sameTerrain = (a: Terrain, b: Terrain) => a === b && a !== 'desert';
  const terrains =
    (mapRules.allowSameResourceTouch
      ? null
      : fill(terrainBag.length, landAdj, terrainBag, sameTerrain, rng)) ?? rng.shuffle(terrainBag);
  const portKinds = rng.shuffle(def.harbors);

  const landIds = topo.landHexes.filter((_, i) => terrains[i] !== 'desert');
  const tokenAdj = adjacency(topo, landIds);
  let placed: number[] | null = null;
  for (const conflict of tokenConflicts(mapRules)) {
    placed = fill(landIds.length, tokenAdj, def.tokens, conflict, rng);
    if (placed) break;
  }
  placed ??= rng.shuffle(def.tokens);
  const byHex = new Map(landIds.map((id, i) => [id, placed[i] as number]));
  const tokens = topo.landHexes.map((id) => byHex.get(id) ?? null);

  const { board, deserts } = assemble(topo, terrains, tokens, portKinds);
  const robber = deserts.length === 1 || firstDesertOnly ? deserts[0] : rng.pick(deserts);
  return { board, robber: robber as HexId };
}
