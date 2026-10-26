/**
 * Explorers & Pirates state (docs/rules/explorers-pirates.md §9.3): the slice `state.ext.ep`,
 * the scenarios and what each one switches on, piece counts and the mission tracks.
 */
import { extSlice } from '../../../engine/expansions/ext';
import type {
  EdgeId,
  GameState,
  HexId,
  PlayerId,
  ResourceCounts,
  ResumePhase,
  ScenarioId,
  Terrain,
  VertexId,
} from '../../../engine/types';

export const EP = 'ep';

// ---------------------------------------------------------------------------------------------
// Scenarios (§1.1, §5)
// ---------------------------------------------------------------------------------------------

export type ScenarioKey = 'landHo' | 'pirateLairs' | 'fish' | 'spices' | 'full';

/** What a scenario uses. Each scenario uses the rules of the previous one, minus what it drops. */
export interface Rules {
  /** Pirate ships, tribute and chasing (scenarios 2-5); Land Ho!: a 7 only discards. */
  pirate: boolean;
  /** Crews (scenarios 2-5). */
  crews: boolean;
  lairs: boolean;
  fish: boolean;
  spice: boolean;
  /** Fixed starting pieces (Land Ho!) instead of the variable setup (§2.9). */
  fixedStart: boolean;
}

export interface ScenarioRow {
  key: ScenarioKey;
  name: string;
  blurb: string;
  vp: number;
  rules: Rules;
}

// prettier-ignore
export const SCENARIOS: readonly ScenarioRow[] = [
  { key: 'landHo', name: 'Land Ho!', blurb: 'Harbors, ships and settlers: explore the unknown', vp: 8,
    rules: { pirate: false, crews: false, lairs: false, fish: false, spice: false, fixedStart: true } },
  { key: 'pirateLairs', name: 'Pirate Lairs', blurb: 'Crews, pirate ships and the lairs on the gold fields', vp: 12,
    rules: { pirate: true, crews: true, lairs: true, fish: false, spice: false, fixedStart: false } },
  { key: 'fish', name: 'Fish for Catan', blurb: 'Catch fish for the Council of Catan', vp: 15,
    rules: { pirate: true, crews: true, lairs: true, fish: true, spice: false, fixedStart: false } },
  { key: 'spices', name: 'Spices for Catan', blurb: 'Befriend the spice farms, ship spice and fish', vp: 15,
    rules: { pirate: true, crews: true, lairs: false, fish: true, spice: true, fixedStart: false } },
  { key: 'full', name: 'Explorers & Pirates', blurb: 'The full game: all three missions', vp: 17,
    rules: { pirate: true, crews: true, lairs: true, fish: true, spice: true, fixedStart: false } },
];

export const scenarioIdOf = (k: ScenarioKey): ScenarioId => `${EP}/${k}`;

export function scenarioKey(state: Pick<GameState, 'settings'>): ScenarioKey {
  const id = state.settings.scenario ?? '';
  const row = SCENARIOS.find((s) => scenarioIdOf(s.key) === id);
  return row ? row.key : 'full';
}

export function rulesOf(state: Pick<GameState, 'settings'>): Rules {
  const key = scenarioKey(state);
  return (SCENARIOS.find((s) => s.key === key) as ScenarioRow).rules;
}

/**
 * Cities & Knights is in the game (the E&P + C&K combination, module `epck`): settlements may
 * become cities, and the setup places a city first and the harbor settlement second.
 */
export const citiesInPlay = (state: Pick<GameState, 'settings'>): boolean =>
  state.settings.expansions.includes('ck');

/** Setup placement `index` places the harbor settlement (round 1; with C&K round 2). */
export function isHarborStep(state: Pick<GameState, 'settings' | 'players'>, index: number) {
  const first = index < state.players.length;
  return citiesInPlay(state) ? !first : first;
}

// ---------------------------------------------------------------------------------------------
// Pieces, costs, cargo (§1.2, §4.1)
// ---------------------------------------------------------------------------------------------

/** Cost / piece items ('<id>/<item>', costOf and pieceLimit). */
export const ITEM = {
  harbor: 'ep/harbor',
  ship: 'ep/ship',
  settler: 'ep/settler',
  crew: 'ep/crew',
  extraMove: 'ep/extraMove',
} as const;

const R = (b: Partial<ResourceCounts>): ResourceCounts => ({
  brick: 0,
  lumber: 0,
  wool: 0,
  grain: 0,
  ore: 0,
  ...b,
});

export const COST: Readonly<Record<string, ResourceCounts>> = {
  [ITEM.harbor]: R({ grain: 2, ore: 2 }),
  [ITEM.ship]: R({ lumber: 1, wool: 1 }),
  [ITEM.settler]: R({ brick: 1, lumber: 1, wool: 1, grain: 1 }),
  [ITEM.crew]: R({ ore: 1, wool: 1 }),
  [ITEM.extraMove]: R({ wool: 1 }),
};

export const LIMIT = { harbor: 4, ship: 3, settler: 2, crew: 9 } as const;

/** Cargo pieces. Large pieces (settler, fish haul) fill a hold; small ones (crew, spice) half. */
export type Cargo = 'settler' | 'crew' | 'fish' | 'spice';
export const CARGO: readonly Cargo[] = ['settler', 'crew', 'fish', 'spice'];
export const HOLD = 2;
export const cargoSize = (c: Cargo): number => (c === 'settler' || c === 'fish' ? 2 : 1);
export const load = (cargo: readonly Cargo[]): number =>
  cargo.reduce((n, c) => n + cargoSize(c), 0);
export const isCargo = (x: unknown): x is Cargo => CARGO.includes(x as Cargo);

/** Ship movement points (§4.4): 4, +2 bought with wool, +1 per Swift Voyage farm. */
export const BASE_MP = 4;
export const EXTRA_MP = 2;
/** At most twice per turn: 2 gold for 1 resource (§3.3). */
export const GOLD_BUYS = 2;
export const GOLD_PER_BUY = 2;
/** Gold every player starts with (§2.2). */
export const START_GOLD = 2;
/** Crews that capture a lair (§4.8). */
export const LAIR_CREWS = 3;

// ---------------------------------------------------------------------------------------------
// Mission tracks (§4.13)
// ---------------------------------------------------------------------------------------------

export type Mission = 'lairs' | 'fish' | 'spice';
export const MISSIONS: readonly Mission[] = ['lairs', 'fish', 'spice'];
/** VP of each space after the start space. */
export const TRACK_VP: Readonly<Record<Mission, readonly number[]>> = {
  lairs: [1, 1, 2, 2, 2, 3, 3],
  fish: [1, 1, 2, 2, 2, 3, 3],
  spice: [1, 1, 2, 2, 3, 3],
};
export const MISSION_NAME: Readonly<Record<Mission, string>> = {
  lairs: 'Pirate Lairs',
  fish: 'Fish for Catan',
  spice: 'Spices for Catan',
};
export const TILE_NAME: Readonly<Record<Mission, string>> = {
  lairs: 'Greatest Pirate Scourge',
  fish: 'Best Fisher',
  spice: 'Greatest Spice Merchant',
};

export interface Track {
  /** Space per player (0 = start). */
  pos: number[];
  /** When each player's marker reached its space (lower = earlier = lower in the stack). */
  arrived: number[];
}

// ---------------------------------------------------------------------------------------------
// The slice
// ---------------------------------------------------------------------------------------------

export interface Ship {
  id: number;
  owner: PlayerId;
  edge: EdgeId;
  cargo: Cargo[];
}

/** This turn's movement of one ship. */
export interface ShipTurn {
  /** Movement points spent. */
  used: number;
  /** Bought +2 MP with wool. */
  extra: boolean;
  /** Its movement is over (explored, or another ship moved after it). */
  done: boolean;
  /** Paid tribute to the pirate this turn. */
  tribute: boolean;
  /** Rolled to chase the pirate this turn. */
  chased: boolean;
}

export type SpiceKind = 'swift' | 'bonus' | 'fast';

export interface SpiceFarm {
  kind: SpiceKind;
  /** Pirate Bonus: the number printed on the farm (4 or 5), also chases the pirate. */
  number?: number;
  /** Players whose spice sack still lies on the farm. */
  sacks: PlayerId[];
  /** Players with a crew on the farm (befriended, for the rest of the game). */
  crews: PlayerId[];
}

export interface Lair {
  /** The face-down number of the lair token (flipped onto the gold field once captured). */
  token: number;
  /** Crews on the hex, in the order they arrived. */
  crews: PlayerId[];
  captured: boolean;
}

/** What a face-down hex really is. */
export interface Hidden {
  terrain: Terrain;
  /** Fish shoal: the die face. */
  shoal?: number;
  spice?: SpiceKind;
  /** Pirate Bonus number of a spice farm. */
  number?: number;
}

export interface EpTurn {
  /** The Movement phase has begun (no more trading or building, §3.4). */
  movement: boolean;
  /** The ship that moved last (another ship moving finishes it). */
  active: number | null;
  /** The selected ship (moves and the fleet panel act on it). */
  selected: number | null;
  ships: Record<number, ShipTurn>;
  fishRolled: boolean;
  /** 2-gold purchases this turn. */
  goldBuys: number;
  /** Fast Gold sales this turn. */
  fastGold: number;
  /** Lairs captured this turn, resolved after the Movement phase (§4.8), in capture order. */
  captured: HexId[];
}

export interface EpSlice {
  v: 1;
  gold: number[];
  /** Harbor settlements (the settlement piece on the vertex is flagged) and their basins. */
  harbors: Record<VertexId, Cargo[]>;
  ships: Ship[];
  nextShip: number;
  /** Face-down hexes and what they hide. */
  hidden: Record<HexId, Hidden>;
  /** Face-down number discs per region. */
  discs: { parrot: number[]; goose: number[] };
  /** Face-down lair tokens. */
  lairTokens: number[];
  lairs: Record<HexId, Lair>;
  /** Explored fish shoals and their die faces. */
  shoals: Record<HexId, number>;
  /** Shoals with a fish haul on them. */
  hauls: HexId[];
  haulSupply: number;
  spice: Record<HexId, SpiceFarm>;
  pirate: { owner: PlayerId; hex: HexId } | null;
  tracks: Partial<Record<Mission, Track>>;
  /** Counter for track arrival order. */
  clock: number;
  turn: EpTurn;
  /** The gold in the open player trade offer (`ep/offerTrade`, §3.3); absent = none. */
  trade?: GoldOffer | null;
}

/** Gold the offering player gives and wants in an open trade offer. */
export interface GoldOffer {
  give: number;
  want: number;
}

export const epSlice = (s: Pick<GameState, 'ext'>): EpSlice => extSlice<EpSlice>(s, EP);

export function freshTurn(): EpTurn {
  return {
    movement: false,
    active: null,
    selected: null,
    ships: {},
    fishRolled: false,
    goldBuys: 0,
    fastGold: 0,
    captured: [],
  };
}

export function shipTurn(s: EpSlice, id: number): ShipTurn {
  return s.turn.ships[id] ?? { used: 0, extra: false, done: false, tribute: false, chased: false };
}

/** The mutable ShipTurn of ship `id` in a draft (created on first use). */
export function shipTurnDraft(s: EpSlice, id: number): ShipTurn {
  const t = shipTurn(s, id);
  s.turn.ships[id] = t;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------------------------

/** The setup's last step: each player places a road and a ship with a settler (§2.9 step 4). */
export interface SetupFleetPhase {
  kind: 'ep/setupFleet';
  /** Index into the order (first player, then clockwise). */
  index: number;
  step: 'road' | 'ship';
  [key: string]: unknown;
}

/** The current player activates their pirate ship: place it (§4.7). */
export interface PiratePhase {
  kind: 'ep/pirate';
  resume: ResumePhase;
  [key: string]: unknown;
}

/** ... and steals from one of the players with a ship next to it. */
export interface PirateStealPhase {
  kind: 'ep/pirateSteal';
  candidates: PlayerId[];
  resume: ResumePhase;
  [key: string]: unknown;
}

export type EpPhase = SetupFleetPhase | PiratePhase | PirateStealPhase;
