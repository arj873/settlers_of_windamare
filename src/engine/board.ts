/**
 * Board generation per map (maps.ts): the official beginner layout ('base') and seeded random
 * layouts for every other map. Harbor POSITIONS are fixed by the frame (topology.portSlots); only
 * their kinds vary.
 */
import { MAPS } from './maps';
import type { Rng } from './rng';
import { hexNeighbors, topologyFor, type Topology } from './topology';
import type { Board, HexId, HexTile, MapId, Port, PortKind, Terrain } from './types';

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
  /** Desert hex where the robber starts (a random one of them on maps with several deserts). */
  robber: HexId;
}

export function generateBoard(map: MapId, rng: Rng): GeneratedBoard {
  return MAPS[map].layout === 'beginner' ? beginnerBoard() : randomBoard(rng, map);
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

/** True if no two 6/8 tokens sit on adjacent hexes (adjacency of `map`'s board). */
export function redNumbersSeparated(
  hexes: Record<HexId, HexTile>,
  map: MapId = 'baseRandom',
): boolean {
  const topo = topologyFor(map);
  return Object.values(hexes).every(
    (h) =>
      !isRed(h.token) || hexNeighbors(topo, h.id).every((n) => !isRed(hexes[n]?.token ?? null)),
  );
}

const MAX_TOKEN_ATTEMPTS = 100_000;

/**
 * Shuffle terrains, then shuffle tokens onto non-desert hexes until no 6/8 are adjacent
 * (rejection sampling; deterministic for a given RNG state). Port kinds are shuffled too.
 * With several deserts the robber starts on a random one.
 */
export function randomBoard(rng: Rng, map: MapId = 'baseRandom'): GeneratedBoard {
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

  const terrains = rng.shuffle(terrainBag);
  const portKinds = rng.shuffle(def.harbors);

  for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt++) {
    const bag = rng.shuffle(def.tokens);
    const tokens = terrains.map((t) => (t === 'desert' ? null : (bag.pop() ?? null)));
    const { board, deserts } = assemble(topo, terrains, tokens, portKinds);
    if (redNumbersSeparated(board.hexes, map)) {
      const robber = deserts.length === 1 ? deserts[0] : rng.pick(deserts);
      return { board, robber: robber as HexId };
    }
  }
  throw new Error('could not place number tokens'); // practically unreachable
}
