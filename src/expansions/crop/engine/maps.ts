/**
 * Crop Trust boards (docs/rules/crop-trust.md §2): the rulebook's first-game layout and the
 * variable setup (shuffled terrain on the printed number layout). The desert is replaced by a
 * fifth fields hex and there is a third "9"; the robber starts on the hex marked "2".
 */
import { assembleBoard } from '../../../engine/board';
import { PORT_KINDS } from '../../../engine/constants';
import { FRAME_STD19, MAPS, type CustomMapDef, type GeneratedBoard } from '../../../engine/maps';
import type { Rng } from '../../../engine/rng';
import { topologyFor } from '../../../engine/topology';
import type { HexId, PortKind, Terrain } from '../../../engine/types';

type Cell = readonly [Terrain, number];

/** First-game layout (rows 3,4,5,4,3). Fields hexes: 9, 3, 10, 6, 4. */
// prettier-ignore
const FIRST19: readonly Cell[] = [
  ['brick', 8], ['lumber', 10], ['wool', 2],
  ['lumber', 11], ['grain', 9], ['ore', 8], ['grain', 3],
  ['wool', 9], ['ore', 5], ['wool', 12], ['wool', 5], ['lumber', 6],
  ['grain', 10], ['brick', 3], ['grain', 6], ['brick', 11],
  ['ore', 4], ['lumber', 9], ['grain', 4],
];

/** Number tokens of the variable setup, in layout order (rulebook p7). */
// prettier-ignore
const VARIABLE_NUMBERS: readonly number[] = [
  8, 10, 2,
  11, 9, 8, 3,
  9, 5, 12, 9, 6,
  10, 3, 6, 11,
  4, 5, 4,
];

/** 5 fields, 4 forest, 4 pasture, 3 hills, 3 mountains. */
// prettier-ignore
const VARIABLE_TERRAINS: readonly Terrain[] = [
  'grain', 'grain', 'grain', 'grain', 'grain',
  'lumber', 'lumber', 'lumber', 'lumber',
  'wool', 'wool', 'wool', 'wool',
  'brick', 'brick', 'brick',
  'ore', 'ore', 'ore',
];

/** Harbour kinds in slot order, as on the beginner board. */
// prettier-ignore
const FIRST19_PORTS: readonly PortKind[] = [
  'generic', 'grain', 'ore', 'generic', 'wool', 'generic', 'generic', 'brick', 'lumber',
];

function robberOn2(tokens: readonly (number | null)[], ids: readonly HexId[]): HexId {
  const i = tokens.indexOf(2);
  const id = ids[i];
  if (i < 0 || id === undefined) throw new Error('crop: no hex with a 2');
  return id;
}

export const CROP_FIRST19: CustomMapDef = {
  id: 'crop/first19',
  name: 'Crop Trust (19 hexes)',
  frame: FRAME_STD19,
  minPlayers: 3,
  maxPlayers: 4,
  layout: 'custom',
  bankPerResource: MAPS.baseRandom.bankPerResource,
  devDeck: MAPS.baseRandom.devDeck,
  generate(): GeneratedBoard {
    const topo = topologyFor(CROP_FIRST19.id);
    const tokens = FIRST19.map(([, n]) => n);
    const { board } = assembleBoard(
      topo,
      FIRST19.map(([t]) => t),
      tokens,
      FIRST19_PORTS,
    );
    return { board, robber: robberOn2(tokens, topo.landHexes) };
  },
};

export const CROP_RANDOM19: CustomMapDef = {
  id: 'crop/random19',
  name: 'Crop Trust, variable (19 hexes)',
  frame: FRAME_STD19,
  minPlayers: 3,
  maxPlayers: 4,
  layout: 'custom',
  bankPerResource: MAPS.baseRandom.bankPerResource,
  devDeck: MAPS.baseRandom.devDeck,
  generate(rng: Rng): GeneratedBoard {
    const topo = topologyFor(CROP_RANDOM19.id);
    const terrains = rng.shuffle(VARIABLE_TERRAINS);
    const ports = rng.shuffle([...PORT_KINDS]);
    const { board } = assembleBoard(topo, terrains, VARIABLE_NUMBERS, ports);
    return { board, robber: robberOn2(VARIABLE_NUMBERS, topo.landHexes) };
  },
};
