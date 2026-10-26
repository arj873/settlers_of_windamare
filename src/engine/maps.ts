/**
 * Map definitions: board shape (frame), terrain/token/harbor counts, supply and player range per
 * map id. Chosen at createGame (`settings.map`); topology is derived from the frame
 * (`topologyFor(map)` in topology.ts). Sources and decisions: docs/RULES.md §16.
 */
import {
  BANK_PER_RESOURCE,
  DEV_DECK_COMPOSITION,
  NUMBER_TOKENS,
  PORT_KINDS,
  TERRAIN_COUNTS,
} from './constants';
import type { Corner } from './hex';
import type { Rng } from './rng';
import type { BaseMapId, BaseTerrain, Board, DevCardCounts, HexId, MapId, PortKind } from './types';

/** Base frames, or an expansion frame namespaced by its module ('demo/oasis'). */
export type FrameId = 'std19' | 'std30' | 'hex37' | `${string}/${string}`;

/** An explicit list of harbor spots: [water hex, land hex it faces], clockwise. */
export type HarborSpots = readonly (readonly [water: HexId, land: HexId])[];

/**
 * A plaza (F2, T&B trade hexes): the centre of land hex `hex` becomes a vertex (`v:q,r,C`) joined
 * by spoke edges (`e:q,r,C<corner>`) to the listed corners of the hex. Plazas and spokes are
 * ordinary topology vertices / edges (roads, pieces, clicks); the hex's own 6 corners and 6
 * sides are unchanged (production, the robber and harbours ignore plazas).
 */
export interface PlazaDef {
  hex: HexId;
  corners: readonly Corner[];
}

/**
 * Base board shape. `rows` = land hexes per row, top to bottom (odd count, rows centered;
 * pointy-top). `harbors`: 'alternate' = every other hex of the clockwise water ring, starting at
 * its top-left hex; a harbor hex touching two land hexes faces the non-corner one (ties: the
 * clockwise one). Or an explicit clockwise list.
 */
export interface RowsFrameDef {
  id: FrameId;
  rows: readonly number[];
  harbors: 'alternate' | HarborSpots;
  /** F2: hex-centre plazas with spokes (T&B trade hexes). */
  plazas?: readonly PlazaDef[];
}

/**
 * Scenario board shape (docs/EXPANSIONS.md §6): any set of board hexes (land or fog; islands
 * allowed), in the order layouts fill them. `sea`: extra water hexes (interior seas, open ocean
 * for ships) on top of the ring of every non-board hex touching the board.
 */
export interface HexListFrameDef {
  id: FrameId;
  hexes: readonly HexId[];
  sea?: readonly HexId[];
  harbors: HarborSpots;
  /** F2: hex-centre plazas with spokes (T&B trade hexes). */
  plazas?: readonly PlazaDef[];
}

export type FrameDef = RowsFrameDef | HexListFrameDef;

/** A generated board plus the hex the robber starts on. */
export interface GeneratedBoard {
  board: Board;
  robber: HexId;
}

interface MapDefCommon {
  id: MapId;
  name: string;
  frame: FrameDef;
  minPlayers: number;
  maxPlayers: number;
  bankPerResource: number;
  devDeck: Readonly<DevCardCounts>;
}

/** A base map: the beginner layout or random terrain/tokens/harbors from the counts. */
export interface StdMapDef extends MapDefCommon {
  /** 'beginner' = the fixed rulebook layout (base only); 'random' = shuffled each game. */
  layout: 'beginner' | 'random';
  terrain: Readonly<Record<BaseTerrain, number>>;
  /** One token per non-desert hex. */
  tokens: readonly number[];
  /** One kind per harbor slot (shuffled for random layouts). */
  harbors: readonly PortKind[];
}

/** A scenario map: its own generator (fixed or random, using the board.ts helpers). */
export interface CustomMapDef extends MapDefCommon {
  layout: 'custom';
  /**
   * A combination map built on another module's map (C2, T&B + Seafarers): that module reads
   * its own per-map data (frame cells, pirate, bonus areas) through this id.
   */
  basedOn?: MapId;
  /** Deterministic: draw only from `rng`. Must fill every frame hex and return the robber hex. */
  generate(rng: Rng, players: number): GeneratedBoard;
}

export type MapDef = StdMapDef | CustomMapDef;

/** Standard 5th-edition frame: 19 hexes (3-4-5-4-3), 9 harbors. */
export const FRAME_STD19: RowsFrameDef = {
  id: 'std19',
  rows: [3, 4, 5, 4, 3],
  harbors: 'alternate',
};

/**
 * 5-6 player extension frame: 30 hexes (3-4-5-6-5-4-3), 11 harbors. Harbor hexes read from the
 * extension rulebook's Illustration A (2020 printing); see RULES.md §16.B.
 */
export const FRAME_STD30: RowsFrameDef = {
  id: 'std30',
  rows: [3, 4, 5, 6, 5, 4, 3],
  harbors: [
    ['h:1,-4', 'h:1,-3'],
    ['h:3,-4', 'h:2,-3'],
    ['h:4,-3', 'h:3,-3'],
    ['h:4,0', 'h:3,0'],
    ['h:2,2', 'h:1,2'],
    ['h:1,3', 'h:0,3'],
    ['h:-1,4', 'h:-1,3'],
    ['h:-3,4', 'h:-2,3'],
    ['h:-3,2', 'h:-2,2'],
    ['h:-3,1', 'h:-2,1'],
    ['h:-2,-1', 'h:-1,-1'],
  ],
};

/** 7-8 player board (our design, RULES.md §16.C): 37 hexes (4-5-6-7-6-5-4), 12 harbors. */
export const FRAME_HEX37: RowsFrameDef = {
  id: 'hex37',
  rows: [4, 5, 6, 7, 6, 5, 4],
  harbors: 'alternate',
};

const BASE_SUPPLY = { bankPerResource: BANK_PER_RESOURCE, devDeck: DEV_DECK_COMPOSITION };

export const MAPS: Readonly<Record<BaseMapId, StdMapDef>> = {
  base: {
    id: 'base',
    name: 'Beginner (19 hexes)',
    frame: FRAME_STD19,
    minPlayers: 3,
    maxPlayers: 4,
    layout: 'beginner',
    terrain: TERRAIN_COUNTS,
    tokens: NUMBER_TOKENS,
    harbors: PORT_KINDS,
    ...BASE_SUPPLY,
  },
  baseRandom: {
    id: 'baseRandom',
    name: 'Random (19 hexes)',
    frame: FRAME_STD19,
    minPlayers: 3,
    maxPlayers: 4,
    layout: 'random',
    terrain: TERRAIN_COUNTS,
    tokens: NUMBER_TOKENS,
    harbors: PORT_KINDS,
    ...BASE_SUPPLY,
  },
  base56: {
    id: 'base56',
    name: '5-6 players (30 hexes)',
    frame: FRAME_STD30,
    minPlayers: 3,
    maxPlayers: 6,
    layout: 'random',
    terrain: { lumber: 6, wool: 6, grain: 6, brick: 5, ore: 5, desert: 2 },
    // prettier-ignore
    tokens: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12],
    harbors: [...PORT_KINDS, 'generic', 'wool'],
    bankPerResource: 24,
    devDeck: { knight: 20, victoryPoint: 5, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3 },
  },
  base78: {
    id: 'base78',
    name: '7-8 players (37 hexes)',
    frame: FRAME_HEX37,
    minPlayers: 3,
    maxPlayers: 8,
    layout: 'random',
    terrain: { lumber: 7, wool: 8, grain: 7, brick: 6, ore: 6, desert: 3 },
    // prettier-ignore
    tokens: [2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 12, 12],
    harbors: [...PORT_KINDS, 'generic', 'wool', 'generic'],
    bankPerResource: 29,
    devDeck: { knight: 26, victoryPoint: 5, roadBuilding: 4, yearOfPlenty: 4, monopoly: 4 },
  },
};

/** The base maps. Expansion maps: `MapDef`s of modules (`mapDef(id)` in mapLookup.ts). */
export const MAP_IDS: readonly BaseMapId[] = ['base', 'baseRandom', 'base56', 'base78'];

export function isBaseMapId(x: unknown): x is BaseMapId {
  return typeof x === 'string' && (MAP_IDS as readonly string[]).includes(x);
}

/** Smallest random map designed for `players` (3-4 baseRandom, 5-6 base56, 7-8 base78). */
export function defaultMapFor(players: number): BaseMapId {
  if (players <= 4) return 'baseRandom';
  return players <= 6 ? 'base56' : 'base78';
}

// isMapId / mapOf / supplyOf live in mapLookup.ts: they need the expansion registry, which this
// file must not import (expansion modules read the frames above at their top level).
