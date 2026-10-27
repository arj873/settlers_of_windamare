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
/**
 * Vertex = the N or S corner of the hex at (q, r). Example: `v:1,-2,S`. F2: `v:q,r,C` = the
 * centre of hex (q, r), a T&B trade-hex plaza (only on frames with `plazas`, maps.ts).
 */
export type VertexId = `v:${number},${number},${'N' | 'S' | 'C'}`;
/**
 * Edge = the NE, E or SE side of the hex at (q, r). Example: `e:0,0,NE`. F2: `e:q,r,C<corner>`
 * = the spoke from the centre of hex (q, r) to its corner (`e:2,-2,CSW`), on plaza frames only.
 */
export type EdgeId =
  `e:${number},${number},${'NE' | 'E' | 'SE' | `C${'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW'}`}`;

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
export type BaseTerrain = Resource | 'desert';
/**
 * Terrains the core knows (docs/EXPANSIONS.md §6): the base ones plus 'gold' (gold field; produces
 * only through an expansion hook), 'sea' (a board hex revealed as sea) and 'fog' (undiscovered).
 */
export type CoreTerrain = BaseTerrain | 'gold' | 'sea' | 'fog';
/** Any terrain: core, or namespaced by an expansion ('demo/oasis'). Only Resource terrains produce in the core. */
export type Terrain = CoreTerrain | `${string}/${string}`;

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
  /** Number token 2..12 (never 7). null on the desert (and on non-producing terrains). */
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
export type BaseMapId = 'base' | 'baseRandom' | 'base56' | 'base78';
/** A base map, or an expansion map namespaced by its module ('demo/oasis19'). */
export type MapId = BaseMapId | `${string}/${string}`;

/** @deprecated v1 board choice; 'beginner' = map 'base', 'random' = map 'baseRandom'. */
export type Layout = 'beginner' | 'random';

export interface Board {
  /** The land hexes (19 / 30 / 37 depending on the map). */
  hexes: Record<HexId, HexTile>;
  /** The harbors (9 / 11 / 12). */
  ports: Port[];
  /**
   * Optional per-game static board data of expansions (rivers, island ids ...), keyed by
   * expansion id. JSON. Shared like the rest of the board (docs/EXPANSIONS.md §6).
   */
  ext?: Record<ExpansionId, unknown>;
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
export type ResumePhase = 'preRoll' | 'main' | 'specialBuild';

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
   * Initial placement. `index` walks the snake order 0..2n-1
   * (player = setupPlayerAt(index, n, settings.startingPlayer)).
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
  /**
   * Map veto (settings.mapSelection 'veto', before setup). `order` lists the vetoers;
   * turn.current = order[next]. Each vetoes one candidate not vetoed yet (`vetoed[i]` = who
   * vetoed candidate i). When one candidate is left it becomes the board and setup starts.
   */
  | {
      kind: 'mapVeto';
      candidates: MapCandidate[];
      vetoed: (PlayerId | null)[];
      order: PlayerId[];
      next: number;
    }
  /**
   * Event Cards: the event drawn this turn needs decisions. Every player with a task acts, in
   * any order. Then the card's number produces (state.dice) and play goes on in `main`.
   */
  | { kind: 'event'; event: EventKind; tasks: EventTask[] }
  | { kind: 'gameOver' }
  | ExpansionPhase;

/**
 * A phase added by an expansion: kind '<expansionId>/<name>', any JSON payload. Deep-copied for
 * action drafts. Who may act: the module's `actors(state)` (default: turn.current).
 */
export interface ExpansionPhase {
  kind: `${string}/${string}`;
  [key: string]: unknown;
}

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
  /**
   * Second Settler (paired players' turn): set while `current` takes the Catanian 2 step of
   * this player's turn (bank trade, build, buy, one dev card; no roll, no player trade).
   * Absent otherwise.
   */
  secondSettlerOf?: PlayerId;
  /**
   * Special building phase: the player whose turn just ended, set for the whole phase so an
   * interrupt (a Knight or Road Building played by the builder, `settings.rules56`) can resume
   * into `specialBuild{builder, owner}`. Absent outside the phase; startTurn drops it.
   */
  specialOwner?: PlayerId;
}

export interface LogEntry {
  turn: number;
  player: PlayerId | null;
  text: string;
}

/** Expansion module id = its folder in src/expansions (no '/'). See docs/EXPANSIONS.md. */
export type ExpansionId = string;
/** Setup-screen mode ('base', 'demo', 'seafarers', 'seafarers+ck' ...). */
export type ModeId = string;
/** Scenario id, namespaced by the expansion that defines it ('demo/oasis'). */
export type ScenarioId = string;
export type OptionValue = boolean | number | string;
// ---------------------------------------------------------------------------
// Variant settings (V1). All optional in GameSettings; absent = the official rule.
// Read through the accessors in variants.ts. docs/RULES.md §18.
// ---------------------------------------------------------------------------

/**
 * 'normal' = official. 'friendly' = the robber may not be placed next to, and cannot rob,
 * players with ≤ 2 public VP. 'none' = no robber: a 7 still makes players discard, but nobody
 * moves the robber or steals; knights still count for Largest Army.
 */
export type RobberMode = 'normal' | 'friendly' | 'none';

export type SetupBuilding = 'settlement' | 'city';
/** 'normal' = the distance rule. 'anyVertex' = any empty vertex (no distance rule). */
export type SetupRestriction = 'normal' | 'anyVertex';
export interface SetupRound {
  building: SetupBuilding;
  restriction: SetupRestriction;
}
/** Setup placement per round (first / second building). */
export interface SetupPlacement {
  first: SetupRound;
  second: SetupRound;
}

/**
 * Map rules (random maps only): which neighbouring hexes may touch. Every flag is "allow", so
 * absent/false = constrained. Only true flags are stored in settings (default = all constrained).
 *  - allowRedTouch: 6 and 8 tokens on adjacent hexes (official rule: never)
 *  - allowExtremeTouch: 2 and 12 tokens (any of them) on adjacent hexes
 *  - allowSameNumberTouch: two identical tokens on adjacent hexes
 *  - allowSameResourceTouch: two land hexes of the same resource side by side (deserts exempt)
 */
export interface MapRules {
  allowRedTouch?: boolean;
  allowExtremeTouch?: boolean;
  allowSameNumberTouch?: boolean;
  allowSameResourceTouch?: boolean;
}

/** 'fixed' = the chosen map; 'random' = a seeded pick among the maps that fit; 'veto' = vote. */
export type MapSelection = 'fixed' | 'random' | 'veto';

/** Turn timer presets (chess clock: a bank per player + an increment per turn). */
export type TimerPreset = 'off' | 'bullet' | 'blitz' | 'rapid' | 'classic' | 'custom';
export interface TimerSettings {
  preset: Exclude<TimerPreset, 'off'>;
  /** Starting bank per player, seconds. */
  bankSec: number;
  /** Added to a player's bank after each of their turns, seconds. */
  incrementSec: number;
}

/** Catan Event Cards (T&B 2020 rulebook pp. 4–5). 'none' = "Catan prospers" (no event). */
export type EventKind =
  | 'none'
  | 'robberAttacks'
  | 'epidemic'
  | 'earthquake'
  | 'goodNeighbors'
  | 'tournament'
  | 'tradeAdvantage'
  | 'calmSea'
  | 'robberFlees'
  | 'neighborlyAssistance'
  | 'conflict'
  | 'plentifulYear';

/**
 * One player's open decision in an `event` phase:
 *  - gain: take 1 resource of their choice from the bank (eventGain)
 *  - give: give 1 resource of their choice to one of `targets` (eventGive)
 *  - steal: take 1 random card from one of `targets` (eventSteal); `optional` allows passing
 *  - damageRoad: turn one of their roads sideways (eventDamageRoad)
 */
export interface EventTask {
  player: PlayerId;
  kind: 'gain' | 'give' | 'steal' | 'damageRoad';
  targets: PlayerId[];
  optional: boolean;
}

/** A candidate board of a map veto. */
export interface MapCandidate {
  board: Board;
  robber: HexId;
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
  /**
   * Seat that places first in setup and takes the first turn (schema v4; earlier saves: 0).
   * createGame draws it from the seed unless the config fixes it (RULES.md 2.7).
   */
  startingPlayer: PlayerId;
  /** Setup-screen mode (schema v5). 'base' for the base game. */
  mode: ModeId;
  /** Active expansion modules in registry order (schema v5). [] = base game. */
  expansions: ExpansionId[];
  /** Scenario of the mode, or null (base maps) (schema v5). */
  scenario: ScenarioId | null;
  /** Every option of every active expansion, defaults filled in (schema v5). */
  options: Record<ExpansionId, Record<string, OptionValue>>;
  // --- V1 variants: optional, absent = official rule (no schema bump; variants.ts) ---------
  /** Robber mode (default 'normal'). */
  robberMode?: RobberMode;
  /** The Catan Event Cards deck replaces the dice (`GameState.eventDeck`, RULES.md §18). */
  eventCards?: boolean;
  /** Setup buildings and placement restrictions (default: two settlements, distance rule). */
  setupPlacement?: SetupPlacement;
  /**
   * Randomize Turn Order: the config's players were shuffled into seats. `seatOrder[p]` = the
   * config index that sits in seat p (so a client can map its seat controllers). Absent = config
   * order. Seat 0 of the shuffled order starts.
   */
  seatOrder?: number[];
  /** How the board was chosen (default 'fixed'). With 'veto' the game starts in `mapVeto`. */
  mapSelection?: MapSelection;
  /** Rush (Colonist-inspired, turn-based): the dice roll automatically when a turn starts. */
  rushMode?: boolean;
  /** Turbo (our definition): both setup rounds pay starting resources. */
  turboMode?: boolean;
  /** Second Settler = catan.com's paired players' turn (2021): see TurnState.secondSettlerOf. */
  secondSettler?: boolean;
  /** Chess-clock turn timer; wins over turnTimerSec (clock.ts). Client/server enforced. */
  timer?: TimerSettings;
  /** Allowed adjacencies on random maps (only the `true` flags are present). RULES.md §19. */
  mapRules?: MapRules;
  /**
   * Optional 5+ player rule set (RULES.md §20): the special build step may also play one
   * development card, and the robber may never go to the second desert. 5+ players only.
   */
  rules56?: boolean;
}

export interface GameState {
  schemaVersion: 5;
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
  /**
   * Expansion state, one JSON slice per active expansion, keyed by its id (schema v5). Created by
   * the module's `init`; read with `extSlice(state, id)`. `{}` in base games.
   */
  ext: Record<ExpansionId, unknown>;
  // --- V1 variants: optional, present only in games that use them (no schema bump) -------
  /** Event Cards: undrawn cards (indices into EVENT_CARDS), drawn with pop(). */
  eventDeck?: number[];
  /** Event Cards: the event of the last card drawn (null before the first). */
  lastEvent?: EventKind | null;
  /** Event Cards (Earthquake): each player's damaged road, or null. Indexed by PlayerId. */
  damagedRoads?: (EdgeId | null)[];
  // --- UX2 game statistics: optional (older saves start recording on their next action) ----
  /**
   * End-of-game statistics, kept up to date by applyAction (stats.ts). Immutable: a new object
   * replaces it whenever it changes, so states share it (clone.ts). Secret until game over
   * (viewFor drops it from mid-game views). Read it through `statsOf`.
   */
  stats?: GameStats;
}

// ---------------------------------------------------------------------------
// Game statistics (UX2, stats.ts)
// ---------------------------------------------------------------------------

/** Where resource cards came from. 'other' must stay empty (an unclassified change; tested). */
export type GainSource =
  'production' | 'setup' | 'trade' | 'bank' | 'steal' | 'devCard' | 'event' | 'other';
/**
 * Where resource cards went: spent on pieces ('build') or dev cards ('buyDev'), given in player
 * ('trade') or bank/port trades ('bank'), taken by a steal ('stolen'), discarded on a 7,
 * taken by a Monopoly, given away in an event.
 */
export type LossSink =
  'build' | 'buyDev' | 'trade' | 'bank' | 'stolen' | 'discard' | 'monopoly' | 'event' | 'other';

export interface PlayerStats {
  /** Resource cards gained, by source and type. */
  gained: Record<GainSource, ResourceCounts>;
  /** Resource cards lost, by sink and type. Σgained − Σlost = hand (when `complete`). */
  lost: Record<LossSink, ResourceCounts>;
  /** Production the robber blocked (what its hex would have paid; bank shortage ignored). */
  blocked: ResourceCounts;
  /**
   * Expected production × 36 over this player's rolls-so-far (each roll adds Σ pips × yield of
   * their buildings' unblocked hexes). Luck = production − expected36 / 36.
   */
  expected36: number;
  /** Totals this player rolled: index = total − 2 (2..12). Event cards count their number. */
  rolls: number[];
  /** Pieces placed (setup and free roads included). */
  built: { road: number; settlement: number; city: number };
  /** Of `built.road`: roads from Road Building. */
  freeRoads: number;
  devBought: DevCardCounts;
  /** Cards played; `victoryPoint` stays 0 (VP cards are revealed, never played). */
  devPlayed: DevCardCounts;
  /** Player trade offers made. */
  offersMade: number;
  /** Own offers that went through (confirmTrade). */
  tradesAsOfferer: number;
  /** Others' offers this player completed as the partner. */
  tradesAsPartner: number;
  /** 4:1 trades with the bank. */
  bankTrades: number;
  /** 3:1 and 2:1 harbor trades (any ratio below 4). */
  portTrades: number;
  /**
   * Bank / harbor trades by ratio, keyed "4:1", "3:1", "2:1". Absent in saves from before it
   * existed: read it with `tradesByRatio(p)` (stats.ts), which also folds in the old counters.
   */
  tradesByRatio?: Record<string, number>;
  robberMoves: number;
  /** Cards stolen (robber and event steals). */
  steals: number;
  /** Times a card was stolen from this player. */
  robbed: number;
  /** Times this player had to discard on a 7. */
  discards: number;
}

export interface GameStats {
  /** True when recording began at createGame (false: an older save; counts start at fromTurn). */
  complete: boolean;
  /** turn.number when recording began. */
  fromTurn: number;
  players: PlayerStats[];
  /** Event Cards drawn, by event (V1 eventCards games). */
  events: Partial<Record<EventKind, number>>;
  /** Everyone's VP (hidden VP cards included) at the end of each turn; turn 0 = after setup. */
  vpHistory: { turn: number; vp: number[] }[];
  /** Award holder changes, oldest first (player null = nobody holds it any more). */
  awardHistory: { turn: number; award: 'longestRoad' | 'largestArmy'; player: PlayerId | null }[];
}

// ---------------------------------------------------------------------------
// Actions. Every action names the acting `player`; applyAction rejects actors who may not act.
// ---------------------------------------------------------------------------

export type BaseAction =
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
  | { type: 'confirmTrade'; player: PlayerId; partner: PlayerId }
  // veto.ts
  | { type: 'vetoMap'; player: PlayerId; candidate: number }
  // events.ts
  | { type: 'eventGain'; player: PlayerId; resource: Resource }
  | { type: 'eventGive'; player: PlayerId; to: PlayerId; resource: Resource }
  /** victim null = pass (only when the task is optional). */
  | { type: 'eventSteal'; player: PlayerId; victim: PlayerId | null }
  | { type: 'eventDamageRoad'; player: PlayerId; edge: EdgeId }
  | { type: 'repairRoad'; player: PlayerId };

/**
 * An action added by an expansion: type '<expansionId>/<name>', any JSON payload. Each module
 * declares its precise union in its own folder. Board locations use the field names vertex /
 * edge / hex (the controller highlights and clicks them).
 */
export interface ExpansionAction {
  type: ExpansionActionType;
  player: PlayerId;
  vertex?: VertexId;
  edge?: EdgeId;
  hex?: HexId;
  [key: string]: unknown;
}
export type ExpansionActionType = `${string}/${string}`;

export type Action = BaseAction | ExpansionAction;
export type BaseActionType = BaseAction['type'];
export type ActionType = Action['type'];
export type ActionOf<T extends ActionType> = Extract<Action, { type: T }>;

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: string };
