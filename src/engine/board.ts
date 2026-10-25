/**
 * Board generation: the official beginner layout and a seeded random layout.
 * Port POSITIONS are fixed (TOPOLOGY.portSlots); only their kinds vary.
 */
import { NUMBER_TOKENS, PORT_KINDS, TERRAIN_COUNTS } from './constants';
import type { Rng } from './rng';
import { TOPOLOGY, hexNeighbors } from './topology';
import type { Board, HexId, HexTile, Layout, Port, PortKind, Terrain } from './types';

/**
 * Beginner layout from the base-game rulebook ("Starting Map for Beginners", Illustration A of the
 * 2020 5th-edition rules), in TOPOLOGY.landHexes order (rows of 3,4,5,4,3, top to bottom, left
 * to right). Verified by T8 against the rulebook image (see docs/RULES.md §12).
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
  /** Desert hex — where the robber starts. */
  robber: HexId;
}

export function generateBoard(layout: Layout, rng: Rng): GeneratedBoard {
  return layout === 'beginner' ? beginnerBoard() : randomBoard(rng);
}

function assemble(
  terrains: readonly Terrain[],
  tokens: readonly (number | null)[],
  portKinds: readonly PortKind[],
): GeneratedBoard {
  const hexes: Record<HexId, HexTile> = {};
  let robber: HexId | null = null;
  TOPOLOGY.landHexes.forEach((id, i) => {
    const info = TOPOLOGY.hex[id];
    const terrain = terrains[i];
    const token = tokens[i];
    if (!info || terrain === undefined || token === undefined) throw new Error('bad layout');
    hexes[id] = { id, q: info.q, r: info.r, terrain, token };
    if (terrain === 'desert') robber = id;
  });
  if (robber === null) throw new Error('layout has no desert');
  const ports: Port[] = TOPOLOGY.portSlots.map((slot, i) => ({
    kind: portKinds[i] ?? 'generic',
    edge: slot.edge,
    vertices: [...slot.vertices],
    waterHex: slot.waterHex,
  }));
  return { board: { hexes, ports }, robber };
}

export function beginnerBoard(): GeneratedBoard {
  return assemble(
    BEGINNER_HEXES.map(([t]) => t),
    BEGINNER_HEXES.map(([, n]) => n),
    BEGINNER_PORTS,
  );
}

const isRed = (n: number | null) => n === 6 || n === 8;

/** True if no two 6/8 tokens sit on adjacent hexes. */
export function redNumbersSeparated(hexes: Record<HexId, HexTile>): boolean {
  return Object.values(hexes).every(
    (h) => !isRed(h.token) || hexNeighbors(h.id).every((n) => !isRed(hexes[n]?.token ?? null)),
  );
}

const MAX_TOKEN_ATTEMPTS = 10_000;

/**
 * Shuffle terrains, then shuffle tokens onto non-desert hexes until no 6/8 are adjacent
 * (rejection sampling; deterministic for a given RNG state). Port kinds are shuffled too.
 */
export function randomBoard(rng: Rng): GeneratedBoard {
  const terrainBag: Terrain[] = [];
  for (const [t, n] of Object.entries(TERRAIN_COUNTS) as [Terrain, number][]) {
    for (let i = 0; i < n; i++) terrainBag.push(t);
  }
  const terrains = rng.shuffle(terrainBag);
  const portKinds = rng.shuffle(PORT_KINDS);

  for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt++) {
    const bag = rng.shuffle(NUMBER_TOKENS);
    const tokens = terrains.map((t) => (t === 'desert' ? null : (bag.pop() ?? null)));
    const result = assemble(terrains, tokens, portKinds);
    if (redNumbersSeparated(result.board.hexes)) return result;
  }
  throw new Error('could not place number tokens'); // practically unreachable
}
