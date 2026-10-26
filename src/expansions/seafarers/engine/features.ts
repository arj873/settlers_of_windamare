/**
 * Scenario pieces that sit on the board's edges and corners (docs/rules/seafarers.md §2): the
 * Forgotten Tribe's gifts, Cloth for Catan's villages, the Wonders' special corners, and the Fog
 * Islands' face-down stacks.
 */
import type { EdgeId, Terrain, VertexId } from '../../../engine/types';
import { cellEdge, cellVertex, parseCell, type BookCorner, type BookSide } from './coords';
import type { MapKey } from './maps';

const list = (s: string) =>
  s
    .split(/[;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

function edges(s: string): EdgeId[] {
  return list(s).map((e) => {
    const [pos = '', side = ''] = e.split(/\s+/);
    return cellEdge(parseCell(pos), side as BookSide);
  });
}

function vertices(s: string): VertexId[] {
  return list(s).map((e) => {
    const [pos = '', corner = ''] = e.split(/\s+/);
    return cellVertex(parseCell(pos), corner as BookCorner);
  });
}

// --- The Forgotten Tribe (§2.6, §4.8) --------------------------------------------------------

export interface TribeGifts {
  dev: EdgeId[];
  chit: EdgeId[];
  harbor: EdgeId[];
}

export function tribeGifts(key: MapKey): TribeGifts | null {
  if (key === 'tribe') {
    return {
      dev: edges('0,2 N; 6,2 N; 0,12 S; 6,12 S'),
      chit: edges('0,2 SW; 0,8 NW; 0,12 SW; 6,2 SE; 6,8 SE; 6,12 SE; 2,14 S; 4,14 S'),
      // 5 sites read from the diagram + our 6th, (6,8) NE (Q1).
      harbor: edges('0,2 NW; 0,8 SW; 6,2 NE; 2,14 SW; 4,14 SE; 6,8 NE'),
    };
  }
  if (key === 'tribe56') {
    return {
      dev: edges('0,2 N; 6,2 N; 0,16 S; 6,16 S; 0,8 NW; 6,10 SE'),
      chit: edges(`0,4 NW; 6,2 NE; 6,4 NE; 0,8 SW; 0,10 NW; 6,8 SE; 6,10 NE; 6,14 NE; 0,14 SW;
                   0,16 SW`),
      harbor: edges('0,2 NW; 0,4 SW; 6,4 SE; 6,8 NE; 0,10 SW; 0,14 NW; 6,14 SE; 6,16 SE'),
    };
  }
  return null;
}

// --- Cloth for Catan (§2.7, §4.9) ------------------------------------------------------------

export interface VillageSpot {
  vertex: VertexId;
  token: number;
}

function villages(s: string): VillageSpot[] {
  // "c,r W w E e": the hex's west and east corners carry the village tokens w and e.
  return list(s).flatMap((e) => {
    const [pos = '', , w = '', , east = ''] = e.split(/\s+/);
    const cell = parseCell(pos);
    return [
      { vertex: cellVertex(cell, 'W'), token: Number(w) },
      { vertex: cellVertex(cell, 'E'), token: Number(east) },
    ];
  });
}

export function clothVillages(key: MapKey): VillageSpot[] | null {
  if (key === 'cloth') return villages('3,3 W 9 E 10; 2,6 W 3 E 6; 4,6 W 8 E 11; 3,9 W 5 E 4');
  if (key === 'cloth56') {
    return villages(`3,3 W 9 E 4; 2,6 W 12 E 6; 4,6 W 5 E 2; 2,10 W 10 E 9; 4,10 W 8 E 10;
                     3,13 W 5 E 4`);
  }
  return null;
}

/** Cloth chits per village, and the general supply. */
export const CLOTH_PER_VILLAGE = 5;
export const CLOTH_SUPPLY = 10;

// --- The Wonders of Catan (§2.9, §4.11) ------------------------------------------------------

export interface WonderMarks {
  /** Purple squares: the strait (Great Bridge). */
  strait: VertexId[];
  /** Brown squares: the wasteland (Great Wall). */
  wasteland: VertexId[];
  /** Red "!": no starting settlement. */
  bang: VertexId[];
}

export function wonderMarks(key: MapKey): WonderMarks | null {
  if (key === 'wonders') {
    return {
      strait: vertices('1,3 SW; 0,6 NE'),
      wasteland: vertices('3,9 SW; 4,10 W; 4,10 E; 4,10 SW; 4,10 SE'),
      bang: vertices('1,3 W; 1,3 SE; 0,6 NW; 0,6 E'),
    };
  }
  if (key === 'wonders56') {
    return {
      strait: vertices('1,7 SW; 0,10 NE; 6,6 SW; 5,9 NE'),
      wasteland: vertices('3,17 W; 3,17 NW; 3,17 NE; 4,16 NW; 4,16 NE; 5,15 NW'),
      bang: vertices(`1,7 W; 1,7 SE; 0,10 NW; 0,10 E; 6,6 W; 6,6 SE; 5,9 NW; 5,9 E`),
    };
  }
  return null;
}

export type WonderId = 'cathedral' | 'greatBridge' | 'greatWall' | 'monument' | 'theater';

export interface WonderCard {
  id: WonderId;
  name: string;
  /** What starting it needs (shown on the card). */
  needs: string;
  /** Cost of each of the 4 levels. */
  cost: { brick: number; lumber: number; wool: number; grain: number; ore: number };
}

export const WONDER_LEVELS = 4;

// prettier-ignore
const CARDS: Record<WonderId, WonderCard> = {
  cathedral: { id: 'cathedral', name: 'Cathedral', needs: '1 city and 6 VP', cost: { brick: 1, lumber: 0, wool: 0, grain: 1, ore: 3 } },
  greatBridge: { id: 'greatBridge', name: 'Great Bridge', needs: 'A building at the strait', cost: { brick: 0, lumber: 3, wool: 1, grain: 1, ore: 0 } },
  greatWall: { id: 'greatWall', name: 'Great Wall', needs: 'A building at the wasteland', cost: { brick: 3, lumber: 1, wool: 0, grain: 1, ore: 0 } },
  monument: { id: 'monument', name: 'Monument', needs: 'A city at a harbor and a 5-long trade route', cost: { brick: 0, lumber: 0, wool: 0, grain: 3, ore: 2 } },
  theater: { id: 'theater', name: 'Theater', needs: '2 cities', cost: { brick: 1, lumber: 1, wool: 3, grain: 0, ore: 0 } },
};

/** The wonder cards of a map: 5, or 7 for 5-6 players (2020 printing: + Great Bridge, Cathedral). */
export function wonderCards(key: MapKey): WonderCard[] {
  const five = [CARDS.cathedral, CARDS.greatBridge, CARDS.greatWall, CARDS.monument, CARDS.theater];
  return key === 'wonders56' ? [...five, CARDS.greatBridge, CARDS.cathedral] : five;
}

// --- The Fog Islands (§2.4, §4.7) ------------------------------------------------------------

export interface FogStack {
  terrains: Terrain[];
  tokens: number[];
}

const repeat = <T>(x: T, n: number): T[] => Array<T>(n).fill(x);

export function fogStack(key: MapKey): FogStack | null {
  const stack12: Terrain[] = [
    ...repeat<Terrain>('sea', 2),
    ...repeat<Terrain>('gold', 2),
    ...repeat<Terrain>('grain', 2),
    ...repeat<Terrain>('brick', 2),
    ...repeat<Terrain>('ore', 2),
    'wool',
    'lumber',
  ];
  if (key === 'fog3') return { terrains: stack12, tokens: [3, 3, 4, 5, 6, 8, 9, 10, 11, 12] };
  if (key === 'fog4') return { terrains: stack12, tokens: [3, 4, 5, 6, 8, 9, 10, 11, 11, 12] };
  if (key === 'fog56') {
    return {
      terrains: [
        ...repeat<Terrain>('sea', 12),
        'gold',
        ...repeat<Terrain>('grain', 2),
        ...repeat<Terrain>('brick', 2),
        ...repeat<Terrain>('ore', 2),
        ...repeat<Terrain>('wool', 3),
        ...repeat<Terrain>('lumber', 3),
      ],
      tokens: [2, 2, 3, 4, 5, 5, 6, 8, 9, 9, 10, 11, 12],
    };
  }
  return null;
}
