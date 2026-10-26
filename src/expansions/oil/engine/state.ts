/**
 * Oil Springs state slice, ids and read-only selectors (docs/rules/oil-springs.md).
 * Nothing here runs at module top level except constants, so the registry import cycle stays safe.
 */
import { extSlice } from '../../../engine/expansions/ext';
import type {
  Action,
  GameState,
  HexId,
  PlayerId,
  Resource,
  ResourceBundle,
  ResourceCounts,
  VertexId,
} from '../../../engine/types';

export const OIL = 'oil';
export const METROPOLIS = 'oil/metropolis';
/** Springs keep the look of the hex they sit on: desert (numbered tile), forest, pasture. */
export const SPRING_DESERT = 'oil/desertSpring';
export const SPRING_FOREST = 'oil/forestSpring';
export const SPRING_PASTURE = 'oil/pastureSpring';
export const SPRING_TERRAINS: readonly string[] = [SPRING_DESERT, SPRING_FOREST, SPRING_PASTURE];

export const METROPOLIS_COST: ResourceCounts = { brick: 1, lumber: 0, wool: 0, grain: 1, ore: 1 };
export const METROPOLIS_OIL = 2;
/** The Disaster Track marker runs 0..5; at 5 a disaster is resolved at the end of the turn. */
export const DISASTER_AT = 5;
export const DISASTER_FLOOD = 7;
/** Oil poured out of the general supply when a disaster hits a spring. */
export const SPRING_LOSS = 3;
/** Sequestered oil per VP token. */
export const SEQUESTER_PER_VP = 3;

/** Components per table size (rulebook: 3-4 players use 15 oil / 4 metropolises, 5-6 use all). */
export interface OilScale {
  cap: number;
  oil: number;
  metropolises: number;
  /** Destroyed number tokens that end the game. */
  ruin: number;
}
const SMALL: OilScale = { cap: 4, oil: 15, metropolises: 4, ruin: 5 };
const LARGE: OilScale = { cap: 6, oil: 21, metropolises: 6, ruin: 8 };
export const oilScale = (state: Pick<GameState, 'players'>): OilScale =>
  state.players.length > 4 ? LARGE : SMALL;

/** state.ext.oil (v = slice version). Oil is not a resource card: it lives here, visible to all. */
export interface OilSlice {
  v: 1;
  /** Oil held, per player. */
  oil: number[];
  /** Sequestered oil (flipped upside down, out of the game), per player. */
  sequestered: number[];
  /** Oil in the general supply. supply + held + sequestered + lost = scale.oil. */
  supply: number;
  /** Oil removed from the game by disasters. */
  lost: number;
  /** City vertex -> owner of the metropolis token under it. */
  metropolis: Record<VertexId, PlayerId>;
  /** Disaster Track marker 0..5, shared. */
  marker: number;
  /** Hexes whose number token was destroyed (their tokens sit on the Disaster Track). */
  destroyed: HexId[];
  /** Holder of the Champion of the Environment token. */
  champion: PlayerId | null;
  /** The current player used oil this turn (no sequestering then). */
  usedOil: boolean;
  /** The current player sequestered oil this turn (no using oil then). */
  sequesteredNow: boolean;
}

export type OilAction =
  | { type: 'oil/convert'; player: PlayerId; resource: Resource }
  | { type: 'oil/metropolis'; player: PlayerId; vertex: VertexId }
  | { type: 'oil/sequester'; player: PlayerId }
  | { type: 'oil/discard'; player: PlayerId; resources: ResourceBundle; oil: number }
  | { type: 'oil/steal'; player: PlayerId; victim: PlayerId; oil: boolean }
  | { type: 'oil/yearOfPlenty'; player: PlayerId; picks: [OilPick, OilPick] }
  | { type: 'oil/monopoly'; player: PlayerId }
  | {
      type: 'oil/offerTrade';
      player: PlayerId;
      to: PlayerId;
      giveOil: number;
      wantOil: number;
      give: ResourceBundle;
      want: ResourceBundle;
    }
  | { type: 'oil/acceptTrade'; player: PlayerId }
  | { type: 'oil/rejectTrade'; player: PlayerId }
  | { type: 'oil/cancelTrade'; player: PlayerId };

/** A Year of Plenty pick: a resource, or 'oil'. */
export type OilPick = Resource | 'oil';

/** A pending domestic trade involving oil (phase 'oil/trade'): one offerer, one partner. */
export interface OilTradePhase {
  kind: 'oil/trade';
  [key: string]: unknown;
  from: PlayerId;
  to: PlayerId;
  giveOil: number;
  wantOil: number;
  give: ResourceBundle;
  want: ResourceBundle;
}

export function oilSlice(state: Pick<GameState, 'ext'>): OilSlice {
  return extSlice<OilSlice>(state, OIL);
}

export const oilOf = (state: GameState, p: PlayerId): number => oilSlice(state).oil[p] ?? 0;
export const sequesteredOf = (state: GameState, p: PlayerId): number =>
  oilSlice(state).sequestered[p] ?? 0;

export function metropolisCount(state: GameState, p?: PlayerId): number {
  const m = oilSlice(state).metropolis;
  const owners = Object.values(m);
  return p === undefined ? owners.length : owners.filter((o) => o === p).length;
}

export const isSpringTerrain = (t: string): boolean => SPRING_TERRAINS.includes(t);

/** Spring hexes of the board (destroyed hexes are never springs). */
export function springHexes(state: GameState): HexId[] {
  return (Object.keys(state.board.hexes) as HexId[]).filter((h) =>
    isSpringTerrain(state.board.hexes[h]?.terrain ?? ''),
  );
}

export const isDestroyed = (state: GameState, h: HexId): boolean =>
  oilSlice(state).destroyed.includes(h);

/** Sequestered-oil VP tokens + the Champion token + metropolises (above the city's 2 VP). */
export function oilVictoryPoints(state: GameState, p: PlayerId): number {
  const s = oilSlice(state);
  return (
    Math.floor((s.sequestered[p] ?? 0) / SEQUESTER_PER_VP) +
    (s.champion === p ? 1 : 0) +
    metropolisCount(state, p)
  );
}

export const isOilAction = (a: Action): a is Action & OilAction => a.type.startsWith('oil/');
