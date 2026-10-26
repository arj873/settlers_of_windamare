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

/** Player range over all maps; each map narrows it (MapDef.minPlayers/maxPlayers in maps.ts). */
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const DEFAULT_VP_TO_WIN = 10;
export const VP_TO_WIN_RANGE = { min: 3, max: 20 } as const;
/** Default `settings.discardLimit`: on a 7, players holding MORE than this discard half. */
export const DEFAULT_DISCARD_LIMIT = 7;
export const DISCARD_LIMIT_RANGE = { min: 5, max: 20 } as const;

/** Balanced dice: cards in the dice deck (every ordered outcome of two dice once). */
export const DICE_DECK_SIZE = 36;
/**
 * Balanced dice: before a roll, the deck is reshuffled when this many cards or fewer remain, so
 * the last rolls of a cycle stay unpredictable (like the Catan dice deck's reshuffle card).
 */
export const DICE_DECK_RESHUFFLE_AT = 5;

/**
 * Default seat colours, one per player (up to 8), in seat order. Chosen to stay distinct for
 * common colour-vision deficiencies where possible (white, orange, brown and teal differ in
 * lightness from red/green/blue/purple). The first six match the original new-game screen.
 */
export const PLAYER_COLORS: readonly { name: string; color: string }[] = [
  { name: 'Red', color: '#d64541' },
  { name: 'Blue', color: '#3a7bd5' },
  { name: 'White', color: '#ecf0f1' },
  { name: 'Orange', color: '#f39c12' },
  { name: 'Green', color: '#3fae6a' },
  { name: 'Purple', color: '#9b59b6' },
  { name: 'Brown', color: '#8d5a3b' },
  { name: 'Teal', color: '#2ec4c4' },
];

/** Bank stock per resource on the 19-hex maps (bigger maps: MapDef.bankPerResource). */
export const BANK_PER_RESOURCE = 19;

/** Pieces per player. */
export const PIECE_LIMITS = { road: 15, settlement: 5, city: 4 } as const;

export const COSTS = {
  road: { brick: 1, lumber: 1, wool: 0, grain: 0, ore: 0 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 0 },
  city: { brick: 0, lumber: 0, wool: 0, grain: 2, ore: 3 },
  devCard: { brick: 0, lumber: 0, wool: 1, grain: 1, ore: 1 },
} as const satisfies Record<string, ResourceCounts>;

/** 25 cards on the 19-hex maps (bigger maps: MapDef.devDeck; use `supplyOf(state)`). */
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
