import type {
  DevCardCounts,
  DevCardType,
  ProgressCardType,
  Resource,
  ResourceCounts,
  Terrain,
} from './types';

export const RESOURCES: readonly Resource[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
export const DEV_CARD_TYPES: readonly DevCardType[] = [
  'knight',
  'victoryPoint',
  'roadBuilding',
  'yearOfPlenty',
  'monopoly',
];
export const PROGRESS_CARD_TYPES: readonly ProgressCardType[] = [
  'roadBuilding',
  'yearOfPlenty',
  'monopoly',
];

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 4;
export const DEFAULT_VP_TO_WIN = 10;

/** Bank starts with 19 of each resource. */
export const BANK_PER_RESOURCE = 19;

/** Pieces per player. */
export const PIECE_LIMITS = { road: 15, settlement: 5, city: 4 } as const;

export const COSTS = {
  road: { brick: 1, lumber: 1, wool: 0, grain: 0, ore: 0 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 0 },
  city: { brick: 0, lumber: 0, wool: 0, grain: 2, ore: 3 },
  devCard: { brick: 0, lumber: 0, wool: 1, grain: 1, ore: 1 },
} as const satisfies Record<string, ResourceCounts>;

/** 25 cards in the base game. */
export const DEV_DECK_COMPOSITION: DevCardCounts = {
  knight: 14,
  victoryPoint: 5,
  roadBuilding: 2,
  yearOfPlenty: 2,
  monopoly: 2,
};

/**
 * Player trade offers (offerTrade) the current player may make per turn. Not an official rule:
 * it bounds the offer -> reject -> offer loop so turns always end (house rule, see ARCHITECTURE).
 */
export const MAX_TRADE_OFFERS_PER_TURN = 3;

/** GameState.log keeps only the newest LOG_LIMIT entries (older ones are dropped). */
export const LOG_LIMIT = 200;

/** On a 7, players holding MORE than this many cards discard half (rounded down). */
export const DISCARD_THRESHOLD = 7;
export const LONGEST_ROAD_MIN = 5;
export const LARGEST_ARMY_MIN = 3;
export const AWARD_VP = 2;

/** 19 land hexes: 4 forest, 4 pasture, 4 fields, 3 hills, 3 mountains, 1 desert. */
export const TERRAIN_COUNTS: Record<Terrain, number> = {
  lumber: 4,
  wool: 4,
  grain: 4,
  brick: 3,
  ore: 3,
  desert: 1,
};

/** The 18 number tokens. */
export const NUMBER_TOKENS: readonly number[] = [
  2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12,
];

/** 4 generic 3:1 ports + one 2:1 port per resource. */
export const PORT_KINDS = ['generic', 'generic', 'generic', 'generic', ...RESOURCES] as const;

/** Number of dots under a token = ways to roll it with 2d6. */
export function tokenPips(token: number): number {
  return 6 - Math.abs(7 - token);
}
