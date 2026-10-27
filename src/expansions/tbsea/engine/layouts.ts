/**
 * The 2025 T&B + Seafarers sheets' set-up diagrams (catan.com, read 2026-10-26; docs/rules/combos.md
 * §2d) as changes to our printed Seafarers maps, in the rules doc's book cells (seafarers.md §2.0).
 * The diagrams are drawn on the same cells as our maps (turned 90°, like the engine's view): only the
 * cells, harbours and pieces that differ are listed. Rivers run from their source to the swamp;
 * the last word is the side the swamp's mouth opens on.
 */
import type { Layout } from './overlays';

/** Through the Desert, 3 players: every 2025 diagram prints 12 on the 5,9 pasture (ours: 11). */
export const DESERT3_2025: Layout = { cells: '5,9 wool 12' };

// --- Rivers of Catan -------------------------------------------------------------------------

export const RIVERS_FOG3: Layout = {
  cells: `0,4 swamp; 1,3 wool 8; 2,2 brick 2/11; 3,1 ore 6; 3,3 grain 5; 3,11 lumber 4;
          4,10 wool 6; 4,12 swamp; 5,11 brick 3/12; 6,8 grain 8; 6,10 ore 11`,
  rivers: ['3,1 2,2 1,3 0,4 NW', '6,10 5,11 4,12 S'],
  pirate: '-1,9',
};

export const RIVERS_FOG4: Layout = {
  cells: `0,2 wool 5; 0,4 swamp; 1,1 lumber 9; 1,3 brick 6; 2,0 grain 8; 2,2 ore 4; 3,1 lumber 3;
          3,11 swamp; 4,12 grain 6; 5,9 brick 8; 5,11 lumber 2/12; 6,8 ore 10`,
  // Eight harbours: no 6,10 S; the grain one on 6,10 NE, a 3:1 on 0,2 SW.
  harbors: `3,1 N lumber; 2,0 NW ore; 0,2 N generic; 0,2 SW generic; 6,6 SE wool; 6,10 NE grain;
            4,12 SE brick; 2,12 SE generic`,
  rivers: ['6,8 5,9 4,10 3,11 NW', '2,2 1,3 0,4 S'],
  pirate: '-1,9',
};

/** Version 1: the desert belt's outer deserts become swamps; the mouths open on land. */
export const RIVERS_DESERT3_V1: Layout = {
  cells: `1,1 lumber 10; 1,5 ore 8; 2,4 brick 2; 3,3 wool 3; 4,2 swamp; 4,4 lumber 5; 4,6 ore 6;
          5,5 brick 4; 6,4 swamp; 5,9 wool 12`,
  rivers: ['1,5 2,4 3,3 4,2 SE', '4,6 5,5 6,4 N'],
  pirate: '7,3',
};

/** Version 2: the deserts stay; the 3-hex river replaces the strip beyond the desert. */
export const RIVERS_DESERT3_V2: Layout = {
  cells: `1,5 brick 8; 2,2 ore 6; 2,4 lumber 2/12; 3,3 brick 3; 4,0 swamp; 4,4 wool 5; 4,6 grain 6;
          5,1 brick 3; 5,5 swamp; 6,2 ore 4; 5,9 wool 12`,
  rivers: ['6,2 5,1 4,0 SW', '2,2 3,3 4,4 5,5 S'],
  pirate: '7,3',
};

/** The 4-player Desert harbours of the 2025 diagrams: the grain one on 1,1 N (ours: 2,0 NW). */
const DESERT4_HARBORS = `6,6 S brick; 4,8 SE generic; 4,8 SW generic; 3,3 N wool; 2,6 SW generic;
                         1,1 N grain; 1,1 SW ore; 0,4 S lumber; 0,4 NW generic`;

export const RIVERS_DESERT4_V1: Layout = {
  cells: `1,1 lumber 3; 2,0 grain 12; 2,4 brick 5; 3,3 wool 10; 3,5 grain 11; 4,2 swamp;
          4,4 brick 8; 4,6 ore 10; 6,4 swamp`,
  harbors: DESERT4_HARBORS,
  rivers: ['1,5 2,4 3,3 4,2 SE', '4,6 5,5 6,4 N'],
  pirate: '7,3',
};

export const RIVERS_DESERT4_V2: Layout = {
  cells: `1,5 grain 4; 2,0 ore 2/12; 2,4 ore 5; 3,7 grain 9; 4,0 swamp; 4,6 wool 10; 5,1 brick 11;
          5,7 swamp; 6,2 ore 10`,
  harbors: DESERT4_HARBORS,
  rivers: ['6,2 5,1 4,0 SW', '2,4 3,5 4,6 5,7 S'],
  pirate: '7,3',
};

// --- Merchant Trains (our Caravans) --------------------------------------------------------------

/** The watering hole alone in the middle; the pirate beside the board until the first 7. */
export const CARAVANS_FOUR3: Layout = {
  cells: '3,5 oasis; 0,4 lumber 3; 2,4 sea; 4,10 lumber 8; 4,6 sea',
  harbors: `2,0 NW generic; 2,0 SE lumber; 4,0 NE generic; 5,3 SW ore; 0,2 SW wool; 1,7 NE generic;
            4,8 NW brick; 5,9 SE generic; 2,10 SW grain`,
  pirate: 'off',
};

export const CARAVANS_FOUR4: Layout = {
  cells: '3,5 oasis; 4,6 sea; 4,8 brick 10; 6,8 brick 3; 4,10 lumber 6',
  harbors: `5,1 N grain; 4,0 SW generic; 2,0 NW brick; 0,2 N wool; 1,3 SE generic; 1,5 SW lumber;
            2,8 NE generic; 2,10 NE ore; 2,10 SW generic`,
  pirate: 'off',
};

// --- Traders & Barbarians ----------------------------------------------------------------------

/** No robber, no pirate; the barbarians start on three desert-side paths. */
const TRADERS_PIECES = { barbarians: '5,3 NW; 3,5 SW; 2,2 SW', robber: 'none', pirate: 'none' };

export const TRADERS_DESERT3: Layout = {
  cells: `1,1 tradeCastle; 5,1 quarry; 3,7 glassworks;
          1,9 sea; 3,9 sea; 2,10 grain 9; 4,10 gold 5; 5,9 wool 12`,
  // Seven harbours: the 2,6 SE one lies under the glassworks.
  harbors: `2,0 NW wool; 0,2 N ore; 2,2 NE grain; 0,2 SW brick; 0,4 S generic; 2,6 SW generic;
            5,5 SE lumber`,
  ...TRADERS_PIECES,
};

export const TRADERS_DESERT4: Layout = {
  cells: '1,1 tradeCastle; 5,1 quarry; 3,7 glassworks',
  harbors: DESERT4_HARBORS,
  ...TRADERS_PIECES,
};

// --- Barbarian Attack --------------------------------------------------------------------------

export const BA_DESERT3: Layout = {
  cells: `0,2 wool 5; 0,4 wool 11; 1,1 ore 2; 1,3 grain 9; 1,5 lumber 10; 2,0 castle; 2,2 brick 6;
          2,4 grain 11; 2,6 brick 8; 3,3 ore 4; 3,5 lumber 3; 4,4 brick 8; 4,6 wool 9; 5,5 lumber 12;
          5,9 wool 12`,
  robber: 'none',
  pirate: 'none',
};

export const BA_DESERT4: Layout = {
  cells: `0,4 lumber 10; 1,1 wool 5; 1,3 wool 11; 1,5 ore 8; 2,0 brick 2; 2,2 brick 6; 2,4 grain 4;
          2,6 lumber 3; 3,3 castle; 3,5 brick 5; 3,7 wool 9; 4,4 ore 11; 4,6 grain 10; 4,8 lumber 12;
          5,5 brick 6; 5,7 wool 4; 6,6 lumber 9`,
  harbors: DESERT4_HARBORS,
  robber: 'none',
  pirate: 'none',
};
