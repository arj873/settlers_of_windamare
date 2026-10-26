/**
 * Oil Springs boards (docs/rules/oil-springs.md §2): the rulebook's fixed layout for 3-4 players,
 * a fixed-number layout for 5-6 (terrain is not printed in the rulebook text we could read, so
 * it is shuffled around the forced oil hexes), and the "variable setup" for both sizes.
 * The robber starts off the board.
 */
import { tokenPips } from '../../../engine/constants';
import { assembleBoard, randomBoard } from '../../../engine/board';
import { NO_ROBBER } from '../../../engine/expansions/ext';
import {
  FRAME_STD19,
  FRAME_STD30,
  MAPS,
  type CustomMapDef,
  type GeneratedBoard,
} from '../../../engine/maps';
import type { Rng } from '../../../engine/rng';
import { hexNeighbors, topologyFor } from '../../../engine/topology';
import type { Board, HexId, PortKind, Terrain } from '../../../engine/types';
import { SPRING_DESERT, SPRING_FOREST, SPRING_PASTURE } from './state';

type Cell = readonly [Terrain, number];

/** Rulebook p1 layout (docs/rules/oil-springs.md §2.1): rows 3,4,5,4,3; `*` marks oil springs. */
// prettier-ignore
const FIXED19: readonly Cell[] = [
  ['wool', 11], ['wool', 12], ['grain', 9],
  ['brick', 4], ['ore', 6], ['brick', 5], [SPRING_PASTURE, 10],
  [SPRING_DESERT, 5], ['lumber', 3], ['grain', 11], ['lumber', 4], ['grain', 8],
  ['brick', 8], ['wool', 10], [SPRING_FOREST, 9], ['ore', 3],
  ['ore', 5], ['grain', 2], ['lumber', 6],
];

/** Harbour kinds in slot order, as on the beginner board. */
// prettier-ignore
const FIXED19_PORTS: readonly PortKind[] = [
  'generic', 'grain', 'ore', 'generic', 'wool', 'generic', 'generic', 'brick', 'lumber',
];

/** 5-6 player number layout (rows 3,4,5,6,5,4,3), rulebook p3. */
// prettier-ignore
const NUMBERS30: readonly number[] = [
  4, 5, 2,
  6, 11, 10, 8,
  3, 12, 9, 12, 4,
  9, 10, 3, 6, 9, 8,
  8, 5, 2, 5, 3,
  11, 4, 9, 6,
  11, 5, 10,
];
/** Forced spring positions (index into NUMBERS30): [position, terrain]. */
const SPRINGS30: readonly (readonly [number, Terrain])[] = [
  [9, SPRING_DESERT],
  [11, SPRING_PASTURE],
  [13, SPRING_FOREST],
  [28, SPRING_DESERT],
];
/** The non-spring terrains of the 30-hex board: 6 lumber... minus one forest and one pasture. */
// prettier-ignore
const REST30: readonly Terrain[] = [
  ...Array<Terrain>(5).fill('lumber'),
  ...Array<Terrain>(5).fill('wool'),
  ...Array<Terrain>(6).fill('grain'),
  ...Array<Terrain>(5).fill('brick'),
  ...Array<Terrain>(5).fill('ore'),
];

const pips = (b: Board, h: HexId): number => tokenPips(b.hexes[h]?.token ?? 7);

/**
 * Variable setup (rulebook p3): a random base board, then a numbered spring on each desert (a
 * number not found next to it), an unnumbered one on the 2nd most probable pasture and one on
 * the 2nd least probable forest (ties: not next to another spring).
 */
function variableBoard(rng: Rng, base: 'baseRandom' | 'base56'): GeneratedBoard {
  const topo = topologyFor(base);
  const { board } = randomBoard(rng, base);
  const hexes = { ...board.hexes };
  const springs: HexId[] = [];
  const nextToSpring = (h: HexId) => hexNeighbors(topo, h).some((n) => springs.includes(n));
  const ids = (t: Terrain) =>
    (Object.keys(hexes) as HexId[]).filter((h) => hexes[h]?.terrain === t).sort();

  for (const d of ids('desert')) {
    const near = new Set(hexNeighbors(topo, d).map((n) => hexes[n]?.token));
    const free = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12].filter((n) => !near.has(n));
    const token = rng.pick(free.length > 0 ? free : [5]);
    const tile = hexes[d];
    if (tile) hexes[d] = { ...tile, terrain: SPRING_DESERT, token };
    springs.push(d);
  }
  const place = (terrain: Terrain, spring: Terrain, highest: boolean) => {
    const list = ids(terrain).sort((a, b) => {
      const diff = pips({ ...board, hexes }, b) - pips({ ...board, hexes }, a);
      return (highest ? diff : -diff) || (a < b ? -1 : 1);
    });
    const rank = list[Math.min(1, list.length - 1)];
    if (rank === undefined) return;
    const target = pips({ ...board, hexes }, rank);
    const tied = list.filter((h) => pips({ ...board, hexes }, h) === target);
    const apart = tied.filter((h) => !nextToSpring(h));
    const pick = rng.pick(apart.length > 0 ? apart : tied);
    const tile = hexes[pick];
    if (tile) hexes[pick] = { ...tile, terrain: spring };
    springs.push(pick);
  };
  place('wool', SPRING_PASTURE, true);
  place('lumber', SPRING_FOREST, false);
  return { board: { ...board, hexes }, robber: NO_ROBBER };
}

function fixed30(rng: Rng): GeneratedBoard {
  const topo = topologyFor(OIL_FIXED30.id);
  const rest = rng.shuffle(REST30);
  const forced = new Map(SPRINGS30);
  const terrains: Terrain[] = NUMBERS30.map((_, i) => forced.get(i) ?? (rest.pop() as Terrain));
  const ports = rng.shuffle([...MAPS.base56.harbors]);
  const { board } = assembleBoard(topo, terrains, NUMBERS30, ports);
  return { board, robber: NO_ROBBER };
}

export const OIL_FIXED19: CustomMapDef = {
  id: 'oil/fixed19',
  name: 'Oil Springs (19 hexes)',
  frame: FRAME_STD19,
  minPlayers: 3,
  maxPlayers: 4,
  layout: 'custom',
  bankPerResource: MAPS.baseRandom.bankPerResource,
  devDeck: MAPS.baseRandom.devDeck,
  generate() {
    const { board } = assembleBoard(
      topologyFor(OIL_FIXED19.id),
      FIXED19.map(([t]) => t),
      FIXED19.map(([, n]) => n),
      FIXED19_PORTS,
    );
    return { board, robber: NO_ROBBER };
  },
};

export const OIL_RANDOM19: CustomMapDef = {
  id: 'oil/random19',
  name: 'Oil Springs, variable (19 hexes)',
  frame: FRAME_STD19,
  minPlayers: 3,
  maxPlayers: 4,
  layout: 'custom',
  bankPerResource: MAPS.baseRandom.bankPerResource,
  devDeck: MAPS.baseRandom.devDeck,
  generate: (rng) => variableBoard(rng, 'baseRandom'),
};

export const OIL_FIXED30: CustomMapDef = {
  id: 'oil/fixed30',
  name: 'Oil Springs, 5-6 players (30 hexes)',
  frame: FRAME_STD30,
  minPlayers: 5,
  maxPlayers: 6,
  layout: 'custom',
  bankPerResource: MAPS.base56.bankPerResource,
  devDeck: MAPS.base56.devDeck,
  generate: (rng) => fixed30(rng),
};

export const OIL_RANDOM30: CustomMapDef = {
  id: 'oil/random30',
  name: 'Oil Springs, 5-6 players, variable (30 hexes)',
  frame: FRAME_STD30,
  minPlayers: 5,
  maxPlayers: 6,
  layout: 'custom',
  bankPerResource: MAPS.base56.bankPerResource,
  devDeck: MAPS.base56.devDeck,
  generate: (rng) => variableBoard(rng, 'base56'),
};
