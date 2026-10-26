/**
 * Crop Trust state slice, ids and read-only selectors (docs/rules/crop-trust.md).
 * Nothing here runs at module top level except constants (registry import-cycle rule).
 */
import { extSlice } from '../../../engine/expansions/ext';
import type { GameState, HexId, PlayerId, ResourceCounts } from '../../../engine/types';

export const CROP = 'crop';
export const DEPOSIT = 'crop/deposit';

export const SPECIES = ['beans', 'maize', 'quinoa', 'rice', 'wheat'] as const;
export type Species = (typeof SPECIES)[number];
export const SPECIES_NAME: Record<Species, string> = {
  beans: 'Beans',
  maize: 'Maize',
  quinoa: 'Quinoa',
  rice: 'Rice',
  wheat: 'Wheat',
};
/** Token colours (0xRRGGBB) for the board and the HUD. */
export const SPECIES_COLOR: Record<Species, number> = {
  beans: 0x9c3b2e,
  maize: 0xf2a516,
  quinoa: 0x8a4fb8,
  rice: 0xf4efe0,
  wheat: 0xc99a43,
};
export const isSpecies = (x: unknown): x is Species =>
  typeof x === 'string' && (SPECIES as readonly string[]).includes(x);

/** 90 crop tokens, 18 per species. */
export const TOKENS_PER_SPECIES = 18;
/** A fields hex holds at most this many crop tokens. */
export const HEX_LIMIT = 7;
/** Tokens in a seed vault space (and so replanted per deposit). */
export const VAULT_SIZE = 4;
/** Spaces in one row of the Crop Storage Record. */
export const ROW_SIZE = 5;
/** Fields hexes without crops / extinct species that end the game. */
export const EMPTY_FIELDS_END = 3;
export const EXTINCT_END = 2;
/** Deposit price: 1 lumber + 1 ore. */
export const DEPOSIT_COST: ResourceCounts = { brick: 0, lumber: 1, wool: 0, grain: 0, ore: 1 };

/** The "Effects of Growth" event tokens. Counts per category are our assumption (docs). */
export type CropEvent =
  | { k: 'regional'; s: Species; n: number[] }
  | { k: 'small'; s: Species }
  | { k: 'large'; s: Species }
  | { k: 'mono' };

export type CropCounts = Record<Species, number>;
export type Row = 'top' | 'bottom';

export interface CropSlice {
  v: 1;
  /** Fields hex -> crop tokens per species. */
  crops: Record<HexId, CropCounts>;
  /** Tokens beside the board, per species. */
  supply: CropCounts;
  /** Tokens of extinct species returned to the box (per species). */
  box: CropCounts;
  /** Species with no token on the board or in a vault. */
  extinct: Species[];
  /** The occupied seed vault space of each player (the other space is empty between deposits). */
  vault: { species: Species; count: number }[];
  /** Crop Storage Record per player: species in the order placed. */
  record: Record<Row, Species[]>[];
  /** Face-down event tokens: the supply stack (draw with pop) and the used ones. */
  stack: CropEvent[];
  used: CropEvent[];
  /** Event tokens returned to the box (extinct species). */
  boxed: number;
  /** Tokens under each player's unbuilt settlement and city pieces. */
  pieces: { settlement: CropEvent[]; city: CropEvent[] }[];
  /** The tokens on the Longest Road / Largest Army cards. */
  cards: { longestRoad: CropEvent | null; largestArmy: CropEvent | null };
  /** The current player stored seeds this turn. */
  deposited: boolean;
}

export type CropAction =
  | { type: 'crop/harvest'; player: PlayerId; species: Species }
  | { type: 'crop/skipHarvest'; player: PlayerId }
  | { type: 'crop/deposit'; player: PlayerId; hex: HexId; species: Species; row: Row }
  | { type: 'crop/plant'; player: PlayerId; hex: HexId };

/** Harvest: `queue[0]` decides next; each entry = one harvest of `hex` by `player`. */
export interface HarvestPhase {
  kind: 'crop/harvest';
  [key: string]: unknown;
  roll: number;
  queue: { hex: HexId; player: PlayerId }[];
}

/** Replant: the current player puts `left` tokens of `species` on different fields hexes. */
export interface ReplantPhase {
  kind: 'crop/replant';
  [key: string]: unknown;
  species: Species;
  left: number;
  used: HexId[];
}

export function cropSlice(state: Pick<GameState, 'ext'>): CropSlice {
  return extSlice<CropSlice>(state, CROP);
}

export function emptyCounts(): CropCounts {
  return { beans: 0, maize: 0, quinoa: 0, rice: 0, wheat: 0 };
}

export const totalOf = (c: CropCounts): number => SPECIES.reduce((n, s) => n + c[s], 0);

/** The fields hexes (every grain hex, including the extra one that replaces the desert). */
export function fieldsHexes(state: GameState): HexId[] {
  return Object.keys(cropSlice(state).crops).sort() as HexId[];
}

/** Crop tokens a player has stored on the Crop Storage Record. */
export function storedCount(state: GameState, p: PlayerId): number {
  const r = cropSlice(state).record[p];
  return r ? r.top.length + r.bottom.length : 0;
}

/** VP from the record: the 3rd, 4th and 5th token of each row are worth 1 each. */
export function recordVp(state: GameState, p: PlayerId): number {
  const r = cropSlice(state).record[p];
  return r ? Math.max(0, r.top.length - 2) + Math.max(0, r.bottom.length - 2) : 0;
}

/** Fields hexes with no crop token left. */
export function emptyFields(state: GameState): HexId[] {
  const s = cropSlice(state);
  return fieldsHexes(state).filter((h) => totalOf(s.crops[h] as CropCounts) === 0);
}

export function eventLabel(e: CropEvent): string {
  switch (e.k) {
    case 'regional':
      return `Regional loss: all ${e.s} on ${e.n.join(', ')}`;
    case 'small':
      return `Small-scale loss: 2 ${e.s}`;
    case 'large':
      return `Large-scale loss: 3 ${e.s}`;
    default:
      return 'Monoculture: single-crop fields are wiped out';
  }
}
