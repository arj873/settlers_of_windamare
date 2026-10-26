/**
 * The fixed C&K starter board (docs/rules/cities-knights.md §2.2): the only official fixed C&K
 * map, 3-4 players, standard 19-hex frame. Normal games use the base random maps (§2.3).
 */
import { assembleBoard } from '../../../engine/board';
import { FRAME_STD19, MAPS, type CustomMapDef } from '../../../engine/maps';
import { topologyFor } from '../../../engine/topology';
import type { PortKind, Terrain } from '../../../engine/types';

type Cell = readonly [Terrain, number | null];

/** Rows 3,4,5,4,3, row-major (our landHexes order). Robber on the desert (h:1,-1). */
// prettier-ignore
export const STARTER19: readonly Cell[] = [
  ['brick', 6], ['ore', 2], ['brick', 5],
  ['lumber', 3], ['ore', 9], ['desert', null], ['lumber', 10],
  ['lumber', 8], ['grain', 4], ['brick', 11], ['wool', 3], ['grain', 8],
  ['wool', 10], ['grain', 5], ['ore', 6], ['wool', 4],
  ['grain', 9], ['wool', 12], ['lumber', 11],
];

/** Harbour kinds clockwise from the top-left slot (§2.2, read from the 6th-ed picture). */
// prettier-ignore
export const STARTER19_PORTS: readonly PortKind[] = [
  'brick', 'ore', 'lumber', 'generic', 'generic', 'grain', 'generic', 'wool', 'generic',
];

export const CK_STARTER19: CustomMapDef = {
  id: 'ck/starter19',
  name: 'Cities & Knights starter board',
  frame: FRAME_STD19,
  minPlayers: 3,
  maxPlayers: 4,
  layout: 'custom',
  bankPerResource: MAPS.baseRandom.bankPerResource,
  devDeck: MAPS.baseRandom.devDeck,
  generate() {
    const { board, deserts } = assembleBoard(
      topologyFor(CK_STARTER19.id),
      STARTER19.map(([t]) => t),
      STARTER19.map(([, n]) => n),
      STARTER19_PORTS,
    );
    return { board, robber: deserts[0] ?? 'h:1,-1' };
  },
};
