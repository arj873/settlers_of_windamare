/**
 * The Seafarers state slice (state.ext.seafarers) and the scenario rule table.
 */
import { extSlice } from '../../../engine/expansions/ext';
import { scenariosAs } from '../../../engine/expansions/hooks';
import type {
  DevCardCounts,
  DevCardType,
  EdgeId,
  GameState,
  HexId,
  Phase,
  PlayerId,
  PortKind,
  ResumePhase,
  Terrain,
  VertexId,
} from '../../../engine/types';
import { SEAFARERS, type MapKey } from './maps';

export interface Ship {
  owner: PlayerId;
  /** On a closed route (joins two of the owner's buildings): never moves again (§3.4). */
  closed?: true;
  /** Pirate Islands: a warship (§4.10). */
  warship?: true;
}

/** Special victory points (Catan chits, §4.5): one entry per award. */
export interface Chit {
  player: PlayerId;
  vp: number;
  /** Bonus area / island id ('S0', 'T', 'I2'), or 'gift' (Forgotten Tribe chit). */
  area: string;
  /** The settlement it lies under (absent for gifts). */
  vertex?: VertexId;
}

/** A Forgotten Tribe gift lying on an edge (§4.8). */
export type Gift =
  { kind: 'chit' } | { kind: 'dev'; card: DevCardType } | { kind: 'harbor'; port: PortKind };

export interface Village {
  token: number;
  cloth: number;
}

export interface Fortress {
  owner: PlayerId;
  vertex: VertexId;
  beachhead: VertexId;
  /** Chits left under it (3 at the start; 0 = captured). */
  chits: number;
}

export interface SeaSlice {
  v: 1;
  ships: Record<EdgeId, Ship>;
  /** The pirate's hex, or null when the scenario has none. */
  pirate: HexId | null;
  /** Ships built this turn (may not move). */
  built: EdgeId[];
  /** A ship was moved this turn. */
  moved: boolean;
  chits: Chit[];
  /** Islands holding each player's starting settlements (Four Islands, New World). */
  home: string[][];
  /** Fog stacks (Fog Islands), top = end. */
  fog?: { terrains: Terrain[]; tokens: number[] };
  /** Forgotten Tribe gifts on edges, and harbours taken but not placed yet (per player). */
  gifts?: Record<EdgeId, Gift>;
  harbors?: PortKind[][];
  /** Cloth for Catan. */
  cloth?: {
    villages: Record<VertexId, Village>;
    supply: number;
    held: number[];
    /** Players connected to each village, in connection order. */
    links: Record<VertexId, PlayerId[]>;
  };
  /** The Pirate Islands. */
  fleet?: {
    /** Index on the fleet path. */
    at: number;
    fortresses: Fortress[];
    /** Development cards spent on warships (out of the game). */
    spent: DevCardCounts;
    /** All fortresses taken: the fleet left the board. */
    gone: boolean;
  };
  /** Wonders of Catan: who started each wonder card, and each player's level. */
  wonders?: { started: (PlayerId | null)[]; level: number[] };
}

export function seaSlice(state: Pick<GameState, 'ext'>): SeaSlice {
  return extSlice<SeaSlice>(state, SEAFARERS);
}

export type ScenarioKey =
  | 'newShores'
  | 'fourIslands'
  | 'fogIslands'
  | 'throughTheDesert'
  | 'forgottenTribe'
  | 'clothForCatan'
  | 'pirateIslands'
  | 'wondersOfCatan'
  | 'newWorld';

export interface ScenarioRules {
  key: ScenarioKey;
  name: string;
  blurb: string;
  vp: number;
  /** Map for 3, 4 and 5-6 players. */
  maps: readonly [MapKey, MapKey, MapKey];
  /** Region tags starting settlements may touch (null = any land). */
  setupRegions: readonly string[] | null;
  /** Special VP for the first settlement on a bonus area / foreign island (cap = per player). */
  bonus: { vp: number; cap?: number } | null;
  pirate: boolean;
  /** Regions the robber may not be moved to. */
  robberBans: readonly string[];
  longestRoute: boolean;
  largestArmy: boolean;
}

// prettier-ignore
export const SCENARIOS: readonly ScenarioRules[] = [
  { key: 'newShores', name: 'Heading for New Shores', blurb: 'Sail to the small islands: 2 VP for each first settlement', vp: 14, maps: ['hns3', 'hns4', 'hns56'], setupRegions: ['M'], bonus: { vp: 2 }, pirate: true, robberBans: [], longestRoute: true, largestArmy: true },
  { key: 'fourIslands', name: 'The Four Islands', blurb: 'Settle the other islands: 2 VP for each foreign island', vp: 13, maps: ['four3', 'four4', 'six56'], setupRegions: null, bonus: { vp: 2 }, pirate: true, robberBans: [], longestRoute: true, largestArmy: true },
  { key: 'fogIslands', name: 'The Fog Islands', blurb: 'Sail into the fog and discover new land', vp: 12, maps: ['fog3', 'fog4', 'fog56'], setupRegions: ['M'], bonus: null, pirate: true, robberBans: [], longestRoute: true, largestArmy: true },
  { key: 'throughTheDesert', name: 'Through the Desert', blurb: 'Cross the desert or sail: 2 VP per foreign area', vp: 14, maps: ['desert3', 'desert4', 'desert56'], setupRegions: ['M', 'X'], bonus: { vp: 2 }, pirate: true, robberBans: [], longestRoute: true, largestArmy: true },
  { key: 'forgottenTribe', name: 'The Forgotten Tribe', blurb: 'Gifts of the forgotten tribe wait on the coasts', vp: 13, maps: ['tribe', 'tribe', 'tribe56'], setupRegions: ['M'], bonus: null, pirate: true, robberBans: ['N'], longestRoute: true, largestArmy: true },
  { key: 'clothForCatan', name: 'Cloth for Catan', blurb: 'Trade with the villages: 2 cloth = 1 VP', vp: 14, maps: ['cloth', 'cloth', 'cloth56'], setupRegions: ['M'], bonus: null, pirate: true, robberBans: ['V'], longestRoute: false, largestArmy: true },
  { key: 'pirateIslands', name: 'The Pirate Islands', blurb: 'Build warships and win back your fortress', vp: 10, maps: ['pirates3', 'pirates4', 'pirates56'], setupRegions: ['M'], bonus: null, pirate: false, robberBans: [], longestRoute: false, largestArmy: false },
  { key: 'wondersOfCatan', name: 'The Wonders of Catan', blurb: 'Race to build a wonder of the world', vp: 10, maps: ['wonders', 'wonders', 'wonders56'], setupRegions: ['M'], bonus: { vp: 1 }, pirate: false, robberBans: [], longestRoute: true, largestArmy: true },
  { key: 'newWorld', name: 'New World', blurb: 'A new random archipelago every game', vp: 12, maps: ['newworld', 'newworld', 'newworld56'], setupRegions: null, bonus: { vp: 1, cap: 1 }, pirate: true, robberBans: [], longestRoute: true, largestArmy: true },
];

export const scenarioIdOf = (key: ScenarioKey) => `${SEAFARERS}/${key}` as const;

/**
 * The scenario rules of a Seafarers game (by settings.scenario; a combination scenario names
 * the Seafarers one it is built on in `playsAs`, C2).
 */
export function rulesOf(state: Pick<GameState, 'settings'>): ScenarioRules {
  const id = state.settings.scenario;
  const own = SCENARIOS.find((s) => scenarioIdOf(s.key) === id);
  if (own) return own;
  const as = scenariosAs(state.settings, SEAFARERS)[0];
  const r = SCENARIOS.find((s) => scenarioIdOf(s.key) === as);
  if (!r) throw new Error(`not a Seafarers scenario: ${String(id)}`);
  return r;
}

export function scenarioKey(state: Pick<GameState, 'settings'>): ScenarioKey {
  return rulesOf(state).key;
}

/** A pending choice of free resources (gold fields, discovered gold, fleet victory). */
export interface GoldPhase {
  kind: 'seafarers/gold';
  /** Resources each player still picks (by PlayerId). */
  pending: number[];
  /** Where to go afterwards: a stored phase, or the rest of the roll (Pirate Islands fleet). */
  then: { phase: Phase } | { roll: true };
  [key: string]: unknown;
}

/** Moving a ship: the one picked up (still on its edge until it is placed). */
export interface MoveShipPhase {
  kind: 'seafarers/moveShip';
  from: EdgeId;
  [key: string]: unknown;
}

/** Forgotten Tribe: place a harbour you took (on a coast edge next to your building). */
export interface HarborPhase {
  kind: 'seafarers/placeHarbor';
  player: PlayerId;
  resume: Phase;
  [key: string]: unknown;
}

/** Cloth for Catan: after moving the pirate, take a resource card or a cloth chit (§2.7). */
export interface ClothStealPhase {
  kind: 'seafarers/pirateSteal';
  candidates: PlayerId[];
  resume: ResumePhase;
  [key: string]: unknown;
}

export type SeaPhase = GoldPhase | MoveShipPhase | HarborPhase | ClothStealPhase;
