/**
 * Traders & Barbarians state slice, ids, board data and read-only selectors
 * (docs/rules/traders-barbarians.md). Nothing here runs at module top level except constants, so
 * the registry import cycle stays safe.
 *
 * One module (`tb`) plays every scenario of the box. A scenario switches on one or more
 * *features* (fish, rivers, caravans, ba, traders); two players switch on Catan for Two.
 */
import { extSlice } from '../../../engine/expansions/ext';
import { scenariosAs } from '../../../engine/expansions/hooks';
import type {
  EdgeId,
  ExpansionAction,
  GameState,
  HexId,
  Phase,
  PlayerId,
  Resource,
  ResourceBundle,
  ResourceCounts,
  ScenarioId,
  VertexId,
} from '../../../engine/types';

export const TB = 'tb';

// ---------------------------------------------------------------------------
// Scenarios and features
// ---------------------------------------------------------------------------

export const SC_BASE = 'tb/variants';
export const SC_FISH = 'tb/fishermen';
export const SC_RIVERS = 'tb/rivers';
export const SC_CARAVANS = 'tb/caravans';
export const SC_BA = 'tb/barbarianAttack';
export const SC_TRADERS = 'tb/traders';

export type Feature = 'fish' | 'rivers' | 'caravans' | 'ba' | 'traders';

const FEATURES: Readonly<Record<string, readonly Feature[]>> = {
  [SC_BASE]: [],
  [SC_FISH]: ['fish'],
  [SC_RIVERS]: ['rivers'],
  [SC_CARAVANS]: ['caravans'],
  [SC_BA]: ['ba'],
  [SC_TRADERS]: ['traders'],
};

const COMBINED = new Map<ScenarioId, readonly Feature[]>();

/**
 * The features a scenario switches on. A combination scenario (C2, `ScenarioDef.playsAs`) plays
 * as one or more T&B scenarios: the union of theirs (T&B + Seafarers: one; T&B × T&B: two).
 */
export function featuresOf(scenario: ScenarioId | null): readonly Feature[] {
  if (scenario === null) return [];
  const own = FEATURES[scenario];
  if (own) return own;
  let out = COMBINED.get(scenario);
  if (!out) {
    const as = scenariosAs({ scenario }, TB).filter((s) => s !== scenario);
    out = [...new Set(as.flatMap((s) => FEATURES[s] ?? []))];
    COMBINED.set(scenario, out);
  }
  return out;
}

/**
 * Combination modes that switch T&B features on for another expansion's scenarios:
 * Explorers & Pirates + T&B (module `eptb`) plays the Fishermen on every E&P scenario.
 */
const MODE_FEATURES: Readonly<Record<string, readonly Feature[]>> = {
  'ep+tb': ['fish'],
};

type S = Pick<GameState, 'settings'>;
export const has = (state: S, f: Feature): boolean =>
  featuresOf(state.settings.scenario).includes(f) ||
  (MODE_FEATURES[state.settings.mode]?.includes(f) ?? false);
/** Catan for Two: two real players (and two neutral players in the slice). */
export const isTwo = (state: Pick<GameState, 'players'>): boolean => state.players.length === 2;
/** Gold coins are in play (Rivers, Barbarian Attack, Traders & Barbarians). */
export const usesGold = (state: S): boolean =>
  has(state, 'rivers') || has(state, 'ba') || has(state, 'traders');
/** No robber in the game (Barbarian Attack, Traders & Barbarians). */
export const robberless = (state: S): boolean => has(state, 'ba') || has(state, 'traders');
export const harbormasterOn = (state: S): boolean =>
  state.settings.options[TB]?.['harbormaster'] === true;

// ---------------------------------------------------------------------------
// Terrains
// ---------------------------------------------------------------------------

export const LAKE = 'tb/lake';
export const SWAMP = 'tb/swamp';
export const OASIS = 'tb/oasis';
/** Barbarian Attack's castle hex. */
export const CASTLE = 'tb/castle';
/** T&B trade hexes. */
export const TRADE_CASTLE = 'tb/tradeCastle';
export const QUARRY = 'tb/quarry';
export const GLASSWORKS = 'tb/glassworks';
export const TRADE_TERRAINS: readonly string[] = [TRADE_CASTLE, QUARRY, GLASSWORKS];

// ---------------------------------------------------------------------------
// Static board data (board.ext.tb, generated with the board)
// ---------------------------------------------------------------------------

export interface FishingGround {
  number: number;
  /** The tip vertex (between two coastal hexes) and its two coastal neighbours. */
  vertices: VertexId[];
  /** The water hex it lies on (a pirate there blocks it: T&B + Seafarers). */
  hex?: HexId;
}

export type TradeKind = 'castle' | 'quarry' | 'glassworks';

export interface TradeHex {
  hex: HexId;
  kind: TradeKind;
}

export interface CaravanStart {
  /** The first camel's edge (leaving an oasis corner). */
  edge: EdgeId;
  /** The camel's head vertex (away from the oasis). */
  head: VertexId;
}

export interface TbBoard {
  /** Fishermen: lake hexes and the numbers each lake carries. */
  lakes?: { hex: HexId; numbers: number[] }[];
  grounds?: FishingGround[];
  /** Rivers: river hexes, bridge sites (no roads), the hex producing on a 2 as well. */
  rivers?: HexId[];
  bridgeSites?: EdgeId[];
  twoOnTwelve?: HexId | null;
  /** Caravans: start edges, one per oasis arrow. */
  caravanStarts?: CaravanStart[];
  /** Caravans: the robber may stand on the oasis (Merchant Trains + Forgotten Tribe, C3). */
  robberOnOasis?: boolean;
  /** Barbarian Attack: castle hexes, coastal hexes in check order (clockwise). */
  castles?: HexId[];
  coast?: HexId[];
  /** T&B: trade hexes; vertices / edges nobody may build on (sea-only corners and sides). */
  tradeHexes?: TradeHex[];
  noBuild?: VertexId[];
  noRoad?: EdgeId[];
  /** T&B: the barbarians' start paths when the map moves them (absent = the X marks of §2.6). */
  barbarians?: EdgeId[];
  /** T&B: the board prints a 2 and a 12, so they are not re-rolled (as on the 5-6 board; C3). */
  keep212?: boolean;
  /** Barbarian Attack: knights only on paths touching these hexes (the main island; C3). */
  knightArea?: HexId[];
}

export const tbBoard = (state: Pick<GameState, 'board'>): TbBoard =>
  (state.board.ext?.[TB] as TbBoard | undefined) ?? {};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Gold for one resource from the bank, at most twice per turn (Rivers, BA, T&B). */
export const GOLD_PER_RESOURCE = 2;
export const GOLD_BUYS_PER_TURN = 2;
/** Maritime trade to gold: 4 identical resources (3 with a 3:1 harbour). */
export const GOLD_SALE_RATIO = 4;

export const HARBORMASTER_MIN = 3;
export const HARBORMASTER_VP = 2;

/** Fishermen. 0 = the old boot. */
export const OLD_BOOT = 0;
export const FISH_CAP = 7;
export const FISH_TOKENS_34: readonly number[] = [
  ...Array<number>(11).fill(1),
  ...Array<number>(10).fill(2),
  ...Array<number>(8).fill(3),
];
export const FISH_TOKENS_56: readonly number[] = [
  ...Array<number>(4).fill(1),
  ...Array<number>(5).fill(2),
  ...Array<number>(5).fill(3),
];
export type FishUse = 'robber' | 'steal' | 'resource' | 'road' | 'devCard';
export const FISH_COST: Readonly<Record<FishUse, number>> = {
  robber: 2,
  steal: 3,
  resource: 4,
  road: 5,
  devCard: 7,
};
export const FISH_USES: readonly FishUse[] = ['robber', 'steal', 'resource', 'road', 'devCard'];

/** Rivers. */
export const BRIDGE_ITEM = 'tb/bridge';
export const BRIDGE_COST: ResourceCounts = { brick: 2, lumber: 1, wool: 0, grain: 0, ore: 0 };
export const BRIDGES_PER_PLAYER = 3;
export const BRIDGE_GOLD = 3;
export const POOR_VP = -2;
export const WEALTHY_VP = 1;

/** Caravans. */
export const CAMELS_34 = 22;
export const CAMELS_56 = 33;

/** Barbarian Attack. */
export const BA_CARD_ITEM = 'tb/baCard';
export const KNIGHTS_PER_PLAYER = 6;
export const BA_BARBARIANS_34 = 30;
export const BA_BARBARIANS_56 = 42;
export const KNIGHT_STEPS = 3;
export const KNIGHT_STEPS_GRAIN = 5;
export const PRISONER_CONSOLATION_GOLD = 3;
export const KNIGHT_LOSS_GOLD = 3;
export const TREASON_GOLD = 2;
export type BaCard = 'knighthood' | 'swiftKnight' | 'treason' | 'intrigue';
export const BA_DECK: readonly (readonly [BaCard, number])[] = [
  ['knighthood', 14],
  ['swiftKnight', 4],
  ['treason', 4],
  ['intrigue', 4],
];

/** Traders & Barbarians. */
export type Commodity = 'glass' | 'marble' | 'tools' | 'sand';
export const COMMODITIES: readonly Commodity[] = ['glass', 'marble', 'tools', 'sand'];
/** Which trade hex wants each commodity. */
export const DELIVER_TO: Readonly<Record<Commodity, TradeKind>> = {
  glass: 'castle',
  marble: 'castle',
  tools: 'quarry',
  sand: 'glassworks',
};
/** The two commodities in each trade hex's stack. */
export const STACK_OF: Readonly<Record<TradeKind, readonly [Commodity, Commodity]>> = {
  castle: ['tools', 'sand'],
  quarry: ['marble', 'sand'],
  glassworks: ['glass', 'tools'],
};
export const START_GOLD = 5;
export const WAGON_ITEM = 'tb/wagon';
/** Baggage train cards 1-5: movement points, gold per delivery, lowest drive-off die. */
export const BAGGAGE: readonly { mp: number; gold: number; driveOff: number | null }[] = [
  { mp: 4, gold: 1, driveOff: null },
  { mp: 5, gold: 2, driveOff: 6 },
  { mp: 6, gold: 3, driveOff: 5 },
  { mp: 7, gold: 4, driveOff: 4 },
  { mp: 7, gold: 5, driveOff: 3 },
];
export const MAX_LEVEL = 5;
/** Cost of upgrading to level 2..5 (index = target level). */
export function upgradeCost(target: number): ResourceCounts {
  return { brick: 0, lumber: target >= 4 ? 2 : 1, wool: 1, grain: 0, ore: 1 };
}
export const WAGON_GRAIN_MP = 2;
export const SWIFT_JOURNEYS = 3;
export const ROAD_MP = 1;
export const NO_ROAD_MP = 2;
export const BARBARIAN_MP = 2;

/** Catan for Two. */
export const TOKENS_START = 5;
export const TOKENS_SUPPLY = 10;
export const KNIGHT_TOKENS = 2;
export const NEUTRAL_ROADS = 15;
export const NEUTRAL_SETTLEMENTS = 5;
export const NEUTRAL_COLORS: readonly [string, string] = ['#e8e4d8', '#3c3c44'];
export const NEUTRAL_NAMES: readonly [string, string] = ['Neutral 1', 'Neutral 2'];

// ---------------------------------------------------------------------------
// The slice
// ---------------------------------------------------------------------------

export interface FishSlice {
  /** Face-down pool (0 = the old boot); draw with pop(). */
  pool: number[];
  /** Spent tokens, face up; reshuffled into the pool when it runs dry. */
  spent: number[];
  /** Tokens held per player (values 1-3). Secret in a real game; counts are public. */
  hands: number[][];
  boot: PlayerId | null;
}

export interface Camel {
  edge: EdgeId;
  head: VertexId;
  caravan: number;
}

export interface CaravanSlice {
  camels: Camel[];
  left: number;
  /** Per caravan (one per oasis arrow): its head vertex, or null before its first camel. */
  heads: (VertexId | null)[];
  /** The current player built a settlement / city this turn: a camel follows the turn. */
  built: boolean;
  /** Someone built one in the special build phase (5-6): another camel after it. */
  sbpBuilt: boolean;
}

export interface BaSlice {
  /** Barbarians per coastal hex (absent = 0); 3 = conquered. */
  onHex: Record<HexId, number>;
  supply: number;
  prisoners: number[];
  /** Knights on edges. */
  knights: Record<EdgeId, PlayerId>;
  deck: BaCard[];
  discard: BaCard[];
  /** Edges of knights that moved this turn (where they stopped). */
  moved: EdgeId[];
}

export interface TradersSlice {
  wagons: (VertexId | null)[];
  /** Baggage train card per player, 1..5. */
  level: number[];
  commodity: (Commodity | null)[];
  stacks: Record<HexId, Commodity[]>;
  delivered: number[];
  barbarians: EdgeId[];
  /** Swift Journey cards: undrawn, held (playable), bought this turn. */
  swift: { deck: number; held: number[]; fresh: number[] };
  /** The current turn's wagon move. */
  move: {
    mp: number;
    /** Steps taken in this move (0 = not started). */
    steps: number;
    grain: boolean;
    /** The move is over (plaza reached, or a new one needs Swift Journey). */
    over: boolean;
    /** Regular moves done this turn (Swift Journey needs one). */
    moves: number;
    /** Barbarian edges a drive-off was tried on this turn. */
    tried: EdgeId[];
  };
}

export interface Neutral {
  roads: EdgeId[];
  settlements: VertexId[];
}

export interface TwoSlice {
  tokens: number[];
  supply: number;
  neutrals: [Neutral, Neutral];
  /** Rolls this turn (Catan for Two rolls twice); the first roll's total. */
  rolls: number;
  firstRoll: number | null;
  /** Once per turn: a token action / a knight turned in. */
  tokenUsed: boolean;
  knightTraded: boolean;
  /** Knight cards turned in for tokens (out of the game: dev card conservation). */
  knightsDiscarded: number;
  /** The same per player (statistics: they were played). */
  knightsTurnedIn: number[];
}

/** state.ext.tb (v = slice version). */
export interface TbSlice {
  v: 1;
  /** Gold coins per player (public; not resource cards). Rivers, BA, T&B. */
  gold: number[];
  /** Gold-for-resource purchases this turn. */
  goldBuys: number;
  harbormaster: PlayerId | null;
  fish?: FishSlice;
  rivers?: { bridges: Record<EdgeId, PlayerId> };
  caravans?: CaravanSlice;
  ba?: BaSlice;
  traders?: TradersSlice;
  two?: TwoSlice;
}

export const tbSlice = (state: Pick<GameState, 'ext'>): TbSlice => extSlice<TbSlice>(state, TB);

/** The slice of a feature, or throw (call only when the feature is on). */
export function fishOf(state: Pick<GameState, 'ext'>): FishSlice {
  const s = tbSlice(state).fish;
  if (!s) throw new Error('no fish in this game');
  return s;
}
export function caravansOf(state: Pick<GameState, 'ext'>): CaravanSlice {
  const s = tbSlice(state).caravans;
  if (!s) throw new Error('no caravans in this game');
  return s;
}
export function baOf(state: Pick<GameState, 'ext'>): BaSlice {
  const s = tbSlice(state).ba;
  if (!s) throw new Error('no barbarian attack in this game');
  return s;
}
export function tradersOf(state: Pick<GameState, 'ext'>): TradersSlice {
  const s = tbSlice(state).traders;
  if (!s) throw new Error('no wagons in this game');
  return s;
}
export function twoOf(state: Pick<GameState, 'ext'>): TwoSlice {
  const s = tbSlice(state).two;
  if (!s) throw new Error('not a game for two');
  return s;
}
export const bridgesOf = (state: Pick<GameState, 'ext'>): Record<EdgeId, PlayerId> =>
  tbSlice(state).rivers?.bridges ?? {};

export const fishTotal = (hand: readonly number[]): number => hand.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
// Phases and actions
// ---------------------------------------------------------------------------

export type ResumeTo = 'preRoll' | 'main' | 'specialBuild';

export type TbPhase =
  /** Caravans: the voting round after `ender`'s turn. `order` = bidders still to bid. */
  | {
      kind: 'tb/vote';
      ender: PlayerId;
      order: PlayerId[];
      bids: number[];
      camels: number;
      /** Set once bidding is over: who places the camel(s). */
      placer: PlayerId | null;
      /** After the vote: end `ender`'s turn, or (after a special build phase) start the turn. */
      then: 'endTurn' | 'preRoll';
    }
  /** BA: Knighthood / Swift Knight: place a knight. */
  | { kind: 'tb/placeKnight'; card: 'knighthood' | 'swiftKnight'; resume: ResumeTo }
  /** BA Treason: move barbarians; `from` = chosen source this step (null = pick one). */
  | {
      kind: 'tb/treason';
      left: number;
      from: HexId | 'supply' | null;
      sources: HexId[];
      dests: HexId[];
      resume: ResumeTo;
    }
  /** BA Intrigue: take a barbarian prisoner. */
  | { kind: 'tb/intrigue'; resume: ResumeTo }
  /** BA end of turn: moving knights (no more trade / build); `from` = the knight being moved. */
  | { kind: 'tb/knights'; from: EdgeId | null }
  /** T&B: the wagon move (no more trade / build). */
  | { kind: 'tb/wagon' }
  /** T&B: put a barbarian on a new path (7, Knight, drive-off, token action). */
  | {
      kind: 'tb/barbarian';
      /** The barbarian being moved (null = pick one first). */
      from: EdgeId | null;
      steal: boolean;
      /** Catan for Two's token action: only onto a path without a road. */
      noRoad?: true;
      resume: ResumeTo | 'wagon';
    }
  /** Catan for Two: build the neutral piece that follows a road / settlement. */
  | { kind: 'tb/neutral'; piece: 'road' | 'settlement'; resume: Phase; bridge?: true }
  /** Catan for Two forced trade: give 2 cards back. */
  | { kind: 'tb/forcedGive'; count: number; resume: ResumeTo };

export const phaseOf = (state: GameState): TbPhase | Phase => state.phase as TbPhase | Phase;
export const asPhase = (p: TbPhase): Phase => p as unknown as Phase;

export type TbAction =
  | { type: 'tb/buyResource'; player: PlayerId; resource: Resource }
  | { type: 'tb/sellForGold'; player: PlayerId; resource: Resource }
  | { type: 'tb/fish'; player: PlayerId; use: FishUse; victim?: PlayerId; resource?: Resource }
  | { type: 'tb/giveBoot'; player: PlayerId; to: PlayerId }
  | { type: 'tb/buildBridge'; player: PlayerId; edge: EdgeId }
  | { type: 'tb/bid'; player: PlayerId; wool: number; grain: number }
  | { type: 'tb/placeCamel'; player: PlayerId; edge: EdgeId }
  | { type: 'tb/buyCard'; player: PlayerId }
  | { type: 'tb/placeKnight'; player: PlayerId; edge: EdgeId }
  | { type: 'tb/treasonHex'; player: PlayerId; hex: HexId }
  | { type: 'tb/intrigueHex'; player: PlayerId; hex: HexId }
  | { type: 'tb/startKnights'; player: PlayerId; edge: EdgeId }
  | { type: 'tb/selectKnight'; player: PlayerId; edge: EdgeId }
  | { type: 'tb/moveKnight'; player: PlayerId; edge: EdgeId }
  | { type: 'tb/startWagon'; player: PlayerId; vertex: VertexId }
  | { type: 'tb/wagonStep'; player: PlayerId; vertex: VertexId }
  | { type: 'tb/wagonGrain'; player: PlayerId }
  | { type: 'tb/driveOff'; player: PlayerId; edge: EdgeId }
  | { type: 'tb/swiftJourney'; player: PlayerId }
  | { type: 'tb/upgradeWagon'; player: PlayerId }
  | { type: 'tb/placeBarbarian'; player: PlayerId; edge: EdgeId }
  | { type: 'tb/neutralRoad'; player: PlayerId; edge: EdgeId; neutral: 0 | 1 }
  | { type: 'tb/neutralSettlement'; player: PlayerId; vertex: VertexId; neutral: 0 | 1 }
  | { type: 'tb/forcedTrade'; player: PlayerId }
  | { type: 'tb/forcedGive'; player: PlayerId; resources: ResourceBundle }
  | { type: 'tb/tokenRobber'; player: PlayerId }
  | { type: 'tb/knightForTokens'; player: PlayerId };

export type TbActionType = TbAction['type'];
export const asTb = (a: ExpansionAction | { type: string }): TbAction => a as unknown as TbAction;
