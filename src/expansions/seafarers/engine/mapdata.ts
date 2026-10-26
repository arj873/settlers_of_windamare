/**
 * Scenario map data, transcribed from docs/rules/seafarers.md §2 (book coordinates, §2.0). Pure
 * data: maps.ts turns it into frames and generators.
 *
 * `cells` lists every land and fog cell (and sea cells of a shuffle group) per region tag:
 *   M  main / home land (starting settlements go here)
 *   S  small islands: each connected group is a bonus area (special VP)
 *   T  the strip beyond the desert belt (Through the Desert): one bonus area
 *   V  village islands (Cloth for Catan): never settled
 *   N  small islands without number tokens (Forgotten Tribe): never settled
 *   P  pirate islands (Pirate Islands): only the beachhead may be settled
 *   C  the desert islands in the middle (Pirate Islands)
 *   F  fog cells (Fog Islands)
 *   X  fixed cells of a variable set-up (Through the Desert deserts)
 * Entry: "c,r terrain [token]". Every other footprint cell is sea.
 * `harbors`: "c,r SIDE [kind]" = land cell and the side of it the harbour touches (kind omitted:
 * drawn at random from the scenario's harbour supply).
 */
import type { FrameKind } from './coords';

export interface MapData {
  frame: FrameKind;
  cells: Readonly<Record<string, string>>;
  harbors: string;
  /** "c,r" or 'off' (beside the board until the first 7 / Knight). */
  robber: string;
  /** "c,r", or null when the scenario has no pirate. */
  pirate: string | null;
}

// --- 1. Heading for New Shores (S5 pp. 8-10) -------------------------------------------------

export const HNS3: MapData = {
  frame: 'SHORT',
  cells: {
    M: `0,2 grain 6; 0,4 lumber 5; 1,1 grain 11; 1,3 ore 3; 1,5 brick 11;
        2,0 brick 8; 2,2 wool 10; 2,4 wool 9; 2,6 lumber 8; 3,1 wool 2; 3,3 ore 5; 3,5 lumber 10;
        4,2 grain 4; 4,4 wool 6`,
    S: `0,8 brick 10; 1,9 ore 8; 3,9 gold 4; 4,8 grain 3; 5,7 wool 4; 5,9 ore 9; 6,2 brick 12;
        6,4 gold 5`,
  },
  harbors: `2,0 NW generic; 2,0 NE ore; 0,2 N brick; 4,2 N grain; 0,4 NW lumber; 0,4 S generic;
            4,4 S generic; 2,6 SE wool`,
  robber: '6,2',
  pirate: '3,11',
};

export const HNS4: MapData = {
  frame: 'TALL',
  cells: {
    M: `0,2 grain 8; 0,4 lumber 2; 0,6 ore 10; 1,1 ore 3; 1,3 wool 4; 1,5 brick 9; 1,7 wool 8;
        2,0 brick 6; 2,2 lumber 10; 2,4 desert; 2,6 grain 11; 2,8 lumber 5; 3,1 grain 12;
        3,3 brick 11; 3,5 grain 3; 3,7 wool 9; 4,2 wool 5; 4,4 lumber 6; 4,6 ore 4`,
    S: `0,10 grain 6; 1,11 brick 3; 3,11 gold 10; 4,10 lumber 9; 5,9 brick 5; 5,11 ore 2;
        6,2 ore 8; 6,4 wool 11; 6,8 gold 4`,
  },
  harbors: '1,1 N; 3,1 N; 0,2 NW; 0,4 SW; 4,2 NE; 4,4 SE; 1,7 SW; 3,7 SE; 2,8 S',
  robber: '2,4',
  pirate: '3,13',
};

/**
 * 5-6 players: the rules doc has no layout (the main island is "the base 5-6 island, built per
 * the 5-6 rules"). Our design: the 30-hex base 5-6 island (random, base56 counts) at the top of
 * frame A and three small islands below it (10 hexes, one token each of 2..12).
 */
export const HNS56_MAIN_CELLS = `0,4; 0,6; 0,8; 1,3; 1,5; 1,7; 1,9; 2,2; 2,4; 2,6; 2,8; 2,10; 3,1;
  3,3; 3,5; 3,7; 3,9; 3,11; 4,2; 4,4; 4,6; 4,8; 4,10; 5,3; 5,5; 5,7; 5,9; 6,4; 6,6; 6,8`;
export const HNS56: MapData = {
  frame: 'A',
  cells: {
    S: `0,12 brick 10; 1,13 gold 4; 0,14 ore 9; 2,16 wool 3; 4,14 lumber 5; 4,16 grain 8;
        5,13 ore 11; 5,15 gold 2; 6,12 brick 12; 6,14 lumber 6`,
  },
  harbors: `0,4 NW; 0,8 SW; 1,3 N; 2,10 SW; 3,1 N; 3,11 S; 4,2 NE; 4,10 SE; 6,4 NE; 6,8 SE;
            5,9 SE`,
  robber: 'desert',
  pirate: '3,17',
};

// --- 2. The Four Islands / The Six Islands (S5 pp. 11-13, S56 pp. 8-9) -----------------------

export const FOUR3: MapData = {
  frame: 'SHORT',
  cells: {
    M: `0,2 wool 12; 1,1 lumber 5; 1,3 wool 9; 2,0 grain 11; 2,2 ore 8; 2,4 lumber 3;
        4,0 wool 6; 4,2 ore 10; 5,1 ore 4; 5,3 lumber 9;
        4,6 lumber 8; 4,8 brick 11; 5,7 grain 9; 5,9 brick 5; 6,6 grain 4; 6,8 wool 3;
        1,7 ore 2; 1,9 grain 5; 2,8 brick 10; 2,10 brick 6`,
  },
  harbors: `2,0 NW generic; 2,0 SE lumber; 4,0 NE generic; 1,3 SW wool; 5,3 SW ore;
            1,7 NE generic; 4,8 NW brick; 5,9 SE generic; 2,10 SW grain`,
  robber: '0,2',
  pirate: '3,5',
};

export const FOUR4: MapData = {
  frame: 'SHORT',
  cells: {
    M: `0,2 wool 10; 0,4 grain 11; 1,1 grain 6; 1,3 ore 4; 1,5 brick 2; 2,0 brick 4; 2,2 wool 9;
        4,0 grain 5; 4,2 lumber 3; 5,1 brick 10; 6,2 wool 8;
        3,5 lumber 6; 4,6 brick 5; 4,8 ore 10; 5,5 ore 3; 5,7 grain 12; 5,9 wool 5; 6,6 lumber 9;
        6,8 lumber 11;
        0,8 grain 4; 1,9 ore 8; 2,8 lumber 9; 2,10 wool 11`,
  },
  harbors: `2,0 NW brick; 0,2 N wool; 4,0 SW generic; 5,1 N grain; 1,3 SE generic; 3,5 NE generic;
            2,10 NE ore; 5,9 SW lumber; 2,10 SW generic`,
  robber: '5,7',
  pirate: '3,11',
};

export const SIX56: MapData = {
  frame: 'A',
  cells: {
    M: `0,2 wool 5; 0,4 ore 6; 1,1 lumber 9; 1,3 grain 12; 2,2 brick 4;
        4,0 brick 11; 4,2 grain 9; 5,1 lumber 8; 5,3 ore 10; 6,2 wool 12; 6,4 ore 4;
        0,8 wool 2; 1,7 grain 5; 1,9 ore 3; 2,8 wool 8; 2,10 lumber 10;
        4,6 wool 3; 4,8 lumber 4; 5,7 ore 11; 5,9 brick 10; 6,8 lumber 6;
        0,12 brick 5; 0,14 grain 2; 1,13 brick 8; 1,15 wool 9; 2,14 lumber 5; 2,16 grain 6;
        4,14 lumber 4; 5,13 grain 3; 5,15 brick 10; 6,12 ore 9; 6,14 wool 6`,
  },
  harbors: `1,1 N; 4,2 NW; 6,4 NE; 5,3 SW; 0,4 SE; 1,7 NW; 6,8 SE; 0,12 NW; 5,13 NW; 6,14 SE;
            1,15 S`,
  robber: 'off',
  pirate: '3,-1',
};

// --- 3. The Fog Islands / The Fog Island (S5 pp. 14-16, S56 pp. 10-11) -----------------------

export const FOG3: MapData = {
  frame: 'TALL',
  cells: {
    M: `0,4 wool 12; 1,3 ore 8; 1,5 grain 10; 2,2 brick 11; 2,4 lumber 9; 3,1 lumber 6; 3,3 wool 5;
        3,11 ore 4; 4,10 wool 8; 4,12 wool 9; 5,9 lumber 5; 5,11 grain 3; 6,8 brick 6;
        6,10 lumber 11`,
    F: `5,1 fog; 6,2 fog; 5,3 fog; 6,4 fog; 5,5 fog; 4,6 fog; 3,7 fog; 0,8 fog; 2,8 fog; 1,9 fog;
        0,10 fog; 1,11 fog`,
  },
  harbors: `3,1 NW ore; 2,2 NW lumber; 0,4 N generic; 1,5 SW brick; 6,8 SE generic; 6,10 S wool;
            3,11 S generic; 4,12 SE grain`,
  robber: '0,4',
  pirate: '3,-1',
};

export const FOG4: MapData = {
  frame: 'TALL',
  cells: {
    M: `0,2 wool 2; 0,4 lumber 5; 1,1 brick 9; 1,3 wool 6; 2,0 grain 6; 2,2 lumber 4; 3,1 ore 3;
        3,11 grain 11; 4,10 wool 10; 4,12 brick 12; 2,12 lumber 5; 5,7 wool 9; 5,9 lumber 8;
        5,11 ore 8; 6,6 brick 4; 6,8 grain 6; 6,10 ore 11`,
    F: `5,1 fog; 6,2 fog; 5,3 fog; 4,4 fog; 3,5 fog; 2,6 fog; 1,7 fog; 3,7 fog; 0,8 fog; 2,8 fog;
        1,9 fog; 0,10 fog`,
  },
  harbors: `2,0 NW ore; 3,1 N lumber; 0,2 N generic; 0,4 NW generic; 6,6 SE wool; 6,8 SE grain;
            6,10 S generic; 4,12 SE brick; 2,12 SE generic`,
  robber: '4,12',
  pirate: '3,-1',
};

export const FOG56: MapData = {
  frame: 'B',
  cells: {
    M: `0,2 gold 4; 0,16 gold 10;
        3,7 lumber 5; 3,9 grain 11; 3,11 wool 8;
        4,4 lumber 8; 4,6 grain 9; 4,8 brick 3; 4,10 ore 12; 4,12 grain 10; 4,14 lumber 3;
        5,3 grain 2; 5,5 wool 4; 5,7 ore 6; 5,9 ore 10; 5,11 wool 9; 5,13 brick 12; 5,15 lumber 4;
        6,2 brick 5; 6,4 wool 6; 6,6 ore 3; 6,8 desert; 6,10 brick 11; 6,12 brick 8; 6,14 ore 11;
        6,16 grain 6`,
    F: `0,4 fog; 0,6 fog; 0,8 fog; 0,10 fog; 0,12 fog; 0,14 fog;
        1,1 fog; 1,3 fog; 1,5 fog; 1,7 fog; 1,9 fog; 1,11 fog; 1,13 fog; 1,15 fog; 1,17 fog;
        2,0 fog; 2,2 fog; 2,4 fog; 2,14 fog; 2,16 fog; 2,18 fog; 3,1 fog; 3,17 fog; 4,0 fog;
        4,18 fog`,
  },
  harbors: '5,3 N; 6,2 SE; 4,6 NW; 6,6 NE; 6,10 SE; 3,9 SW; 4,12 SW; 6,16 NE; 5,15 S',
  robber: '6,8',
  pirate: '3,15',
};

// --- 4. Through the Desert (S5 pp. 17-19, S56 pp. 12-13) -------------------------------------

export const DESERT3: MapData = {
  frame: 'SHORT',
  cells: {
    M: `0,2 wool 8; 0,4 wool 4; 1,1 ore 10; 1,3 grain 9; 1,5 lumber 8; 2,0 lumber 11; 2,2 brick 6;
        2,4 grain 2; 2,6 brick 9; 3,3 ore 3; 3,5 lumber 10; 4,4 brick 5; 4,6 wool 6; 5,5 lumber 4`,
    X: '4,2 desert; 5,3 desert; 6,4 desert',
    T: '4,0 grain 6; 5,1 lumber 3; 6,2 gold 4',
    S: '0,8 ore 5; 1,9 grain 9; 3,9 gold 5; 5,9 wool 11; 6,8 ore 8; 2,10 sea; 4,10 sea',
  },
  harbors: `2,0 NW wool; 0,2 N ore; 2,2 NE grain; 0,2 SW brick; 0,4 S generic; 2,6 SW generic;
            2,6 SE generic; 5,5 SE lumber`,
  robber: '5,3',
  pirate: '3,11',
};

export const DESERT4: MapData = {
  frame: 'TALL',
  cells: {
    M: `0,4 lumber 9; 1,1 wool 3; 1,3 wool 11; 1,5 ore 4; 2,0 brick 12; 2,2 brick 6; 2,4 grain 5;
        2,6 lumber 8; 3,3 lumber 10; 3,5 brick 11; 3,7 wool 9; 4,4 ore 8; 4,6 grain 10;
        4,8 lumber 4; 5,5 brick 3; 5,7 wool 6; 6,6 lumber 5`,
    X: '4,2 desert; 5,3 desert; 6,4 desert',
    T: '4,0 grain 8; 5,1 ore 11; 6,2 gold 10',
    S: `0,8 ore 6; 0,10 grain 12; 2,10 gold 5; 2,12 wool 3; 4,12 brick 2; 5,11 grain 4;
        6,10 ore 9; 1,9 sea; 1,11 sea`,
  },
  harbors: `2,0 NW grain; 1,1 SW ore; 3,3 N wool; 0,4 NW generic; 0,4 S lumber; 2,6 SW generic;
            4,8 SW generic; 4,8 SE generic; 6,6 S brick`,
  robber: '5,3',
  pirate: '3,13',
};

/** 5-6: the east strip/coast beyond the desert belt is one foreign area (Q2); the 11th harbour site
 * could not be read (Q1), ours is (6,16) SE. */
export const DESERT56: MapData = {
  frame: 'B',
  cells: {
    M: `0,2 wool 6; 1,1 brick 9; 1,3 ore 11;
        2,0 wool 12; 2,2 grain 3; 2,4 brick 12; 2,6 ore 6; 2,8 brick 11; 2,10 ore 3; 2,12 grain 9;
        3,1 ore 4; 3,3 lumber 5; 3,5 grain 10; 3,7 brick 5; 3,9 wool 10; 3,11 lumber 4;
        3,13 brick 8; 4,6 grain 2; 4,8 lumber 8; 4,10 wool 9; 4,12 lumber 10`,
    X: '5,5 desert; 5,7 desert; 5,9 desert; 5,11 desert; 5,13 desert',
    T: `5,1 lumber 5; 5,3 wool 2; 6,2 gold 4; 6,4 ore 6; 6,6 brick 11; 6,10 lumber 12;
        6,12 grain 5; 6,14 ore 3; 6,16 brick 6`,
    S: `0,6 wool 8; 0,8 grain 2; 0,12 gold 4; 0,16 grain 9; 1,15 wool 11; 1,17 lumber 3;
        2,18 ore 8; 4,18 gold 10`,
  },
  harbors: `2,0 NW; 3,1 NE; 0,2 NW; 1,3 SW; 2,4 SW; 3,5 NE; 2,8 NW; 2,12 NW; 3,13 SW; 3,13 SE;
            6,16 SE`,
  robber: '5,9',
  pirate: '0,14',
};

// --- 5. The Forgotten Tribe (S5 pp. 20-21, S56 pp. 14-15) ------------------------------------

export const TRIBE: MapData = {
  frame: 'XTALL',
  cells: {
    M: `2,0 lumber 11; 2,2 grain 9; 2,4 ore 3; 2,6 wool 8; 2,8 brick 10; 2,10 grain 3;
        3,1 wool 10; 3,3 brick 8; 3,5 wool 4; 3,7 grain 12; 3,9 lumber 5; 3,11 wool 2;
        4,0 grain 6; 4,2 lumber 9; 4,4 ore 11; 4,6 brick 5; 4,8 lumber 6; 4,10 ore 4`,
    N: `0,2 desert; 0,4 brick; 0,8 brick; 0,10 desert; 0,12 gold;
        6,2 gold; 6,4 ore; 6,8 desert; 6,10 ore; 6,12 grain; 2,14 lumber; 4,14 wool`,
  },
  harbors: '',
  robber: '0,10',
  pirate: '6,6',
};

export const TRIBE56: MapData = {
  frame: 'B',
  cells: {
    M: `2,0 lumber 6; 2,2 ore 4; 2,4 grain 9; 2,6 brick 8; 2,8 lumber 11; 2,10 ore 3; 2,12 wool 4;
        2,14 grain 6; 2,16 lumber 3; 2,18 ore 6;
        3,1 lumber 11; 3,3 wool 12; 3,5 lumber 5; 3,7 grain 10; 3,9 wool 5; 3,11 brick 9;
        3,13 grain 2; 3,15 wool 9; 3,17 brick 10;
        4,0 grain 3; 4,2 brick 5; 4,4 ore 11; 4,6 wool 8; 4,8 brick 4; 4,10 lumber 10;
        4,12 grain 4; 4,14 brick 3; 4,16 lumber 8; 4,18 ore 5`,
    N: `0,2 desert; 0,4 desert; 0,8 ore; 0,10 brick; 0,14 grain; 0,16 gold;
        6,2 desert; 6,4 desert; 6,8 gold; 6,10 gold; 6,14 wool; 6,16 wool`,
  },
  harbors: '',
  robber: '0,4',
  pirate: '0,6',
};

// --- 6. Cloth for Catan (S5 pp. 22-23, S56 pp. 16-17) ----------------------------------------

/** Only 8 of the 9 harbour sites could be read (Q1); ours is (6,6) SE. */
export const CLOTH: MapData = {
  frame: 'TALL',
  cells: {
    M: `0,2 wool 10; 0,4 lumber 6; 0,6 ore 5; 0,8 grain 10; 0,10 brick 8; 1,1 brick 9; 1,3 grain 2;
        1,9 wool 11; 1,11 ore 4; 2,12 ore 2;
        4,0 grain 12; 5,1 grain 3; 5,3 lumber 12; 5,9 lumber 3; 5,11 ore 9; 6,2 lumber 4;
        6,4 wool 6; 6,6 brick 5; 6,8 wool 11; 6,10 grain 8`,
    V: '3,3 desert; 2,6 gold; 4,6 gold; 3,9 desert',
  },
  harbors: '1,1 N; 5,1 N; 6,2 SE; 0,2 SW; 0,8 SW; 1,11 SW; 2,12 S; 5,11 S; 6,6 SE',
  robber: '4,0',
  pirate: '3,13',
};

/** The 11 harbour sites are not listed in the doc (Q1); ours are spread over both main islands. */
export const CLOTH56: MapData = {
  frame: 'A',
  cells: {
    M: `0,2 wool 10; 0,4 lumber 6; 0,6 ore 5; 0,8 lumber 11; 0,10 lumber 8; 0,12 grain 10;
        0,14 brick 6; 1,1 brick 9; 1,3 grain 2; 1,13 wool 11; 1,15 ore 4; 2,0 ore 8; 2,16 ore 2;
        4,0 grain 11; 4,16 wool 3; 5,1 grain 3; 5,3 lumber 12; 5,13 lumber 3; 5,15 ore 9;
        6,2 lumber 4; 6,4 wool 6; 6,6 brick 5; 6,8 grain 12; 6,10 brick 3; 6,12 wool 11;
        6,14 grain 8`,
    V: '3,3 gold; 2,6 desert; 4,6 desert; 2,10 desert; 4,10 desert; 3,13 gold',
  },
  harbors: `0,2 NW; 0,6 SW; 0,10 SW; 0,14 SW; 1,15 S; 2,0 N; 4,0 N; 6,2 NE; 6,6 SE; 6,10 SE;
            6,14 SE`,
  robber: '4,0',
  pirate: '3,17',
};

// --- 7. The Pirate Islands (S5 pp. 24-26, S56 pp. 18-19) -------------------------------------

export const PIRATES: MapData = {
  frame: 'XTALL',
  cells: {
    P: `1,1 brick; 2,0 grain 10; 4,0 grain 4; 5,1 brick; 0,2 gold 3; 0,4 ore 6; 6,2 gold 11;
        6,4 ore 6; 3,3 ore 8`,
    C: '1,7 wool; 2,6 desert; 4,6 desert; 5,7 desert',
    M: `0,10 grain 10; 0,12 brick 4; 1,11 ore 5; 1,13 lumber 2; 2,10 wool 11; 2,12 lumber 8;
        2,14 wool 9; 3,9 grain 6; 3,11 brick 9; 3,13 wool 12; 4,10 lumber 3; 4,12 wool 8;
        4,14 lumber 5; 5,11 ore 9; 5,13 lumber 10; 6,10 grain 4; 6,12 brick 5`,
  },
  harbors: '6,10 NE; 6,12 NE; 6,12 S; 5,13 S; 3,13 S; 2,14 SW; 1,13 SW; 0,10 SW',
  robber: 'off',
  pirate: null,
};

export const PIRATES56: MapData = {
  frame: 'B',
  cells: {
    P: `2,0 gold 11; 4,0 gold 11; 0,2 gold 3; 6,2 gold 3; 2,2 desert; 4,2 desert; 2,4 ore 6;
        4,4 ore 8; 0,6 ore 8; 6,6 ore 6`,
    C: '3,7 desert; 1,9 desert; 5,9 desert',
    M: `0,12 lumber 9; 0,14 grain 5; 0,16 lumber 4; 1,13 grain 11; 1,15 ore 9; 1,17 brick 8;
        2,12 wool 2; 2,14 wool 10; 2,16 brick 3; 2,18 wool 5; 3,11 grain 6; 3,13 grain 4;
        3,15 ore 5; 3,17 wool 8; 4,12 lumber 12; 4,14 lumber 6; 4,16 wool 4; 4,18 lumber 10;
        5,13 ore 3; 5,15 brick 10; 5,17 lumber 11; 6,12 wool 5; 6,14 grain 4; 6,16 brick 9`,
  },
  // The doc reads "(1,17) SW · (1,17) S", two sites sharing a corner (Q1); ours: (2,18) S.
  harbors: '0,14 NW; 0,16 NW; 1,17 SW; 2,18 S; 3,17 S; 5,17 S; 6,16 S; 6,16 NE; 6,14 NE',
  robber: 'off',
  pirate: null,
};

// --- 8. The Wonders of Catan (S5 pp. 27-29, S56 pp. 20-21) -----------------------------------

export const WONDERS: MapData = {
  frame: 'XTALL',
  cells: {
    M: `0,2 ore 5; 0,6 wool 11; 0,8 wool 2; 1,3 lumber 3; 1,7 lumber 8; 1,9 grain 9; 2,0 brick 8;
        2,2 wool 9; 2,8 brick 10; 3,1 ore 3; 3,3 grain 4; 3,5 ore 6; 3,7 wool 5; 3,9 brick 4;
        3,11 desert; 4,0 ore 12; 4,2 grain 6; 4,4 brick 11; 4,6 grain 10; 4,8 wool 3;
        4,10 lumber 9; 4,12 desert; 5,7 lumber 11; 5,11 desert; 6,8 ore 10`,
    S: '6,2 gold 8; 6,4 brick 2; 0,12 grain 5; 1,13 lumber 4; 2,14 gold 6',
  },
  harbors: '3,1 N; 1,3 N; 4,2 NE; 3,3 SW; 4,6 NE; 0,6 SW; 1,9 SW; 1,9 SE; 4,8 SE',
  robber: '4,12',
  pirate: null,
};

/** Main island = the largest island; the others are the small islands (1 VP each). */
export const WONDERS56: MapData = {
  frame: 'B',
  cells: {
    A: `0,4 ore 5; 0,6 lumber 9; 0,10 wool 2; 0,12 wool 11; 0,16 gold 6;
        1,1 gold 6; 1,5 lumber 10; 1,7 ore 3; 1,11 ore 9; 1,13 grain 4; 1,17 lumber 4;
        2,4 brick 8; 2,6 wool 5; 2,10 brick 4; 2,12 lumber 8; 2,14 ore 12;
        3,3 grain 9; 3,5 ore 3; 3,7 lumber 4; 3,9 ore 6; 3,11 grain 10; 3,13 wool 9; 3,15 brick 10;
        3,17 desert; 4,2 brick 2; 4,4 wool 5; 4,6 grain 6; 4,8 brick 5; 4,10 grain 3; 4,12 wool 8;
        4,14 lumber 11; 4,16 desert; 5,5 brick 11; 5,9 lumber 11; 5,15 desert; 5,17 desert;
        6,2 gold 8; 6,6 wool 10; 6,10 grain 12`,
  },
  harbors: `4,2 N; 3,3 NW; 0,4 SW; 2,4 NW; 4,4 NE; 4,6 SE; 3,7 SW; 0,10 SW; 4,10 SE; 1,13 SW;
            2,14 SW`,
  robber: '4,16',
  pirate: null,
};
