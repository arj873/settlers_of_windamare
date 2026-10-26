/**
 * Core engine types — THE CONTRACT. See docs/ARCHITECTURE.md.
 * Everything in GameState is plain JSON-safe data (no classes, Maps, Sets, undefined-valued keys).
 * If you change a public type here, update docs/ARCHITECTURE.md in the same commit.
 */

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

/** Hex at axial (q, r). Example: `h:0,-2`. */
export type HexId = `h:${number},${number}`;
/** Vertex = the N or S corner of the hex at (q, r). Example: `v:1,-2,S`. */
export type VertexId = `v:${number},${number},${'N' | 'S'}`;
/** Edge = the NE, E or SE side of the hex at (q, r). Example: `e:0,0,NE`. */
export type EdgeId = `e:${number},${number},${'NE' | 'E' | 'SE'}`;

/** Index into `GameState.players` (0-based, also turn order). */
export type PlayerId = number;

// ---------------------------------------------------------------------------
// Resources, terrain, dev cards
// ---------------------------------------------------------------------------

export type Resource = 'brick' | 'lumber' | 'wool' | 'grain' | 'ore';
/** Full count of every resource. Used for hands and the bank. */
export type ResourceCounts = Record<Resource, number>;
/** Partial counts, used in action payloads. Missing key = 0. */
export type ResourceBundle = Partial<ResourceCounts>;

/** Terrain is named by what it produces. hills=brick, forest=lumber, pasture=wool, fields=grain, mountains=ore. */
export type Terrain = Resource | 'desert';

export type DevCardType = 'knight' | 'victoryPoint' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly';
export type DevCardCounts = Record<DevCardType, number>;
/** Dev cards other than knights and VP cards (the rulebook's "progress cards"). */
export type ProgressCardType = 'roadBuilding' | 'yearOfPlenty' | 'monopoly';
export type ProgressCardCounts = Record<ProgressCardType, number>;

// ---------------------------------------------------------------------------
// Board (fixed after createGame) and pieces (change during play)
// ---------------------------------------------------------------------------

export interface HexTile {
  id: HexId;
  q: number;
  r: number;
  terrain: Terrain;
  /** Number token 2..12 (never 7). null on the desert. */
  token: number | null;
}

/** 'generic' = 3:1 any resource, otherwise 2:1 for that resource. */
export type PortKind = 'generic' | Resource;

export interface Port {
  kind: PortKind;
  /** Coastal edge the port faces. */
  edge: EdgeId;
  /** The two vertices that grant the port to a building owner. */
  vertices: [VertexId, VertexId];
  /** Water hex the port token sits on (for rendering). */
  waterHex: HexId;
}

/**
 * Board chosen at createGame (definitions in maps.ts):
 * 'base' = 19-hex beginner layout, 'baseRandom' = 19-hex random, 'base56' = 30-hex 5-6 player
 * extension board (random), 'base78' = 37-hex 7-8 player board (random).
 */
export type MapId = 'base' | 'baseRandom' | 'base56' | 'base78';

/** @deprecated v1 board choice; 'beginner' = map 'base', 'random' = map 'baseRandom'. */
export type Layout = 'beginner' | 'random';

export interface Board {
  /** The land hexes (19 / 30 / 37 depending on the map). */
  hexes: Record<HexId, HexTile>;
  /** The harbors (9 / 11 / 12). */
  ports: Port[];
}

export type BuildingKind = 'settlement' | 'city';
export interface Building {
  owner: PlayerId;
  kind: BuildingKind;
}

export interface Pieces {
  /** Absent key = empty vertex. */
  buildings: Record<VertexId, Building>;
  /** Absent key = empty edge. Value = owner. */
  roads: Record<EdgeId, PlayerId>;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export interface Player {
  id: PlayerId;
  name: string;
  /** CSS color string, e.g. '#d33' or 'red'. */
  color: string;
  resources: ResourceCounts;
  /** Dev cards that can be played (bought on an earlier turn). VP cards live here too. */
  devCards: DevCardCounts;
  /** Dev cards bought this turn; not playable until next turn. Merged into devCards on endTurn. */
  newDevCards: DevCardCounts;
  /** Knights played so far (for Largest Army). */
  knightsPlayed: number;
  /** Progress cards played so far (face up, out of the game). Deck + hands + played = map's deck. */
  progressCardsPlayed: ProgressCardCounts;
}

// ---------------------------------------------------------------------------
// Turn + phase state machine (see docs/ARCHITECTURE.md for the diagram)
// ---------------------------------------------------------------------------

/** Where to go after an interrupt (robber / road building) finishes. */
export type ResumePhase = 'preRoll' | 'main';

export type TradeResponse = 'pending' | 'accepted' | 'rejected';

export interface TradeOffer {
  from: PlayerId;
  /** What the offerer gives. */
  give: ResourceCounts;
  /** What the offerer wants in return. */
  want: ResourceCounts;
  /** Indexed by PlayerId. null = not addressed (incl. the offerer). */
  responses: (TradeResponse | null)[];
}

export type Phase =
  /**
   * Initial placement. `index` walks the snake order 0..2n-1 (player = setupPlayerAt(index, n)).
   * Each index places one settlement, then one road touching `lastSettlement`.
   * index >= n is round 2: the settlement produces starting resources.
   */
  | { kind: 'setup'; index: number; step: 'settlement' | 'road'; lastSettlement: VertexId | null }
  /** Current player must roll. May play one dev card first (e.g. a knight). */
  | { kind: 'preRoll' }
  /** After rolling: build, trade, buy/play dev cards, end turn. */
  | { kind: 'main' }
  /** A 7 was rolled. `pending[p]` = cards player p must still discard (0 = done). Then -> moveRobber(main). */
  | { kind: 'discard'; pending: number[] }
  /** Current player must move the robber (after a 7 or a knight). */
  | { kind: 'moveRobber'; resume: ResumePhase }
  /** Current player picks a victim among `candidates` (non-empty). */
  | { kind: 'steal'; candidates: PlayerId[]; resume: ResumePhase }
  /** Road Building card: place up to `remaining` free roads. */
  | { kind: 'roadBuilding'; remaining: number; resume: ResumePhase }
  /** Current player has an open trade offer to other players. Always resumes to main. */
  | { kind: 'trade'; offer: TradeOffer }
  /**
   * Special Building Phase (settings.specialBuildPhase, RULES.md §16.10) after `owner` ended
   * their turn. `builder` (= turn.current) may build and buy dev cards, then passSpecialBuild.
   * Builders run clockwise from owner+1 to owner-1; players with nothing they could do are
   * skipped. After the last one, owner+1 starts their turn (preRoll). Nobody wins in this phase.
   */
  | { kind: 'specialBuild'; builder: PlayerId; owner: PlayerId }
  | { kind: 'gameOver' };

export type PhaseKind = Phase['kind'];

export interface TurnState {
  /** 0 during setup, 1 for the first regular turn, +1 per endTurn. */
  number: number;
  /**
   * Whose turn it is (in setup: the player placing; in specialBuild: the builder, while
   * `number` still counts the turn that just ended).
   */
  current: PlayerId;
  /** A dev card (other than revealing VP) was played this turn. Max one per turn. */
  devCardPlayed: boolean;
  /** Player trade offers made this turn (max MAX_TRADE_OFFERS_PER_TURN). Reset on endTurn. */
  tradeOffers: number;
}

export interface LogEntry {
  turn: number;
  player: PlayerId | null;
  text: string;
}

/** Settings (schema v2+). Fixed after createGame. */
export interface GameSettings {
  seed: number | string;
  map: MapId;
  /** 3..20, default 10. */
  vpToWin: number;
  /** 5..20, default 7. On a 7, players holding MORE than this many cards discard half. */
  discardLimit: number;
  /** Rolls are drawn from a 36-card deck of all two-dice outcomes (`GameState.diceDeck`). */
  balancedDice: boolean;
  /** After each turn, the other players get a special build step. Default true with 5+ players. */
  specialBuildPhase: boolean;
  /** Client-side only (UI hides the bank's card counts); the engine ignores it. */
  hideBankCards: boolean;
  /** Client-side only (seconds per turn, null = no timer); the engine ignores it. */
  turnTimerSec: number | null;
}

export interface GameState {
  schemaVersion: 3;
  settings: GameSettings;
  board: Board;
  pieces: Pieces;
  robber: HexId;
  players: Player[];
  bank: ResourceCounts;
  /** Face-down deck; draw with `devDeck.pop()`. Already shuffled. */
  devDeck: DevCardType[];
  turn: TurnState;
  phase: Phase;
  /** Last roll, null before the first roll of the game. */
  dice: [number, number] | null;
  /**
   * Balanced dice only: the undrawn cards of the dice deck, drawn with pop(). A card is
   * `(d1 - 1) * 6 + (d2 - 1)` (0..35). Empty until the first roll, and always empty without
   * balancedDice. Reshuffled to all 36 when DICE_DECK_RESHUFFLE_AT or fewer remain.
   */
  diceDeck: number[];
  awards: { longestRoad: PlayerId | null; largestArmy: PlayerId | null };
  log: LogEntry[];
  /** Seeded RNG state (uint32). Only touch through `Rng` in rng.ts. */
  rng: number;
  winner: PlayerId | null;
}

// ---------------------------------------------------------------------------
// Actions. Every action names the acting `player`; applyAction rejects actors who may not act.
// ---------------------------------------------------------------------------

export type Action =
  // setup.ts
  | { type: 'placeSetupSettlement'; player: PlayerId; vertex: VertexId }
  | { type: 'placeSetupRoad'; player: PlayerId; edge: EdgeId }
  // turn.ts
  | { type: 'rollDice'; player: PlayerId }
  | { type: 'endTurn'; player: PlayerId }
  | { type: 'passSpecialBuild'; player: PlayerId }
  // build.ts
  | { type: 'buildRoad'; player: PlayerId; edge: EdgeId }
  | { type: 'buildSettlement'; player: PlayerId; vertex: VertexId }
  | { type: 'buildCity'; player: PlayerId; vertex: VertexId }
  // robber.ts
  | { type: 'discard'; player: PlayerId; resources: ResourceBundle }
  | { type: 'moveRobber'; player: PlayerId; hex: HexId }
  | { type: 'steal'; player: PlayerId; victim: PlayerId }
  // dev.ts
  | { type: 'buyDevCard'; player: PlayerId }
  | { type: 'playKnight'; player: PlayerId }
  | { type: 'playRoadBuilding'; player: PlayerId }
  | { type: 'placeFreeRoad'; player: PlayerId; edge: EdgeId }
  | { type: 'playYearOfPlenty'; player: PlayerId; resources: [Resource, Resource] }
  | { type: 'playMonopoly'; player: PlayerId; resource: Resource }
  // trade.ts
  | { type: 'bankTrade'; player: PlayerId; give: Resource; receive: Resource }
  | {
      type: 'offerTrade';
      player: PlayerId;
      give: ResourceBundle;
      want: ResourceBundle;
      /** Players the offer is addressed to. */
      to: PlayerId[];
    }
  | { type: 'acceptTrade'; player: PlayerId }
  | { type: 'rejectTrade'; player: PlayerId }
  | { type: 'cancelTrade'; player: PlayerId }
  | { type: 'confirmTrade'; player: PlayerId; partner: PlayerId };

export type ActionType = Action['type'];
export type ActionOf<T extends ActionType> = Extract<Action, { type: T }>;

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: string };
