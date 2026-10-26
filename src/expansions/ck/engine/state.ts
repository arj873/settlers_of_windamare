/**
 * Cities & Knights: the state slice, constants and read-only selectors. Rules reference:
 * docs/rules/cities-knights.md (rule numbers CK-n). Everything here is plain JSON.
 */
import { RESOURCES } from '../../../engine/constants';
import type {
  EdgeId,
  ExpansionPhase,
  GameState,
  Phase,
  HexId,
  PlayerId,
  Resource,
  ResourceCounts,
  VertexId,
} from '../../../engine/types';

export const CK = 'ck';

// ---------------------------------------------------------------------------
// Goods
// ---------------------------------------------------------------------------

export type Commodity = 'paper' | 'cloth' | 'coin';
export const COMMODITIES: readonly Commodity[] = ['paper', 'cloth', 'coin'];
export type CommodityCounts = Record<Commodity, number>;
export type CommodityBundle = Partial<CommodityCounts>;
/** A resource or a commodity card. */
export type Good = Resource | Commodity;
export const GOODS: readonly Good[] = [...RESOURCES, ...COMMODITIES];

export const isCommodity = (x: unknown): x is Commodity =>
  x === 'paper' || x === 'cloth' || x === 'coin';
export const isGood = (x: unknown): x is Good =>
  isCommodity(x) || (RESOURCES as readonly unknown[]).includes(x);

export const emptyCommodities = (): CommodityCounts => ({ paper: 0, cloth: 0, coin: 0 });

/** The commodity a city on this terrain adds (forest, pasture, mountains), §1.5. */
export const COMMODITY_OF: Partial<Record<Resource, Commodity>> = {
  lumber: 'paper',
  wool: 'cloth',
  ore: 'coin',
};

/** Commodity cards per type in the supply: 12, 18 with the 5-6 extension (§1.2). */
export const commoditySupply = (players: number): number => (players >= 5 ? 18 : 12);

// ---------------------------------------------------------------------------
// City improvements (§1.3)
// ---------------------------------------------------------------------------

export type Track = 'trade' | 'politics' | 'science';
export const TRACKS: readonly Track[] = ['trade', 'politics', 'science'];
export const isTrack = (x: unknown): x is Track =>
  x === 'trade' || x === 'politics' || x === 'science';
/** trade -> cloth (yellow), politics -> coin (blue), science -> paper (green). */
export const TRACK_COMMODITY: Readonly<Record<Track, Commodity>> = {
  trade: 'cloth',
  politics: 'coin',
  science: 'paper',
};
export const MAX_LEVEL = 5;
/** Level 3 unlocks the track's ability; level 4 the metropolis; level 5 secures it. */
export const ABILITY_LEVEL = 3;
export const METROPOLIS_LEVEL = 4;
/** Red die values that draw a progress card at `level` (level n shows n + 1 dice, §1.3, Q1). */
export const redDieDraws = (level: number): number => (level <= 0 ? 0 : level + 1);
/** 6th-edition names (the UI shows them, §0.3 D3, Q9). Index = level - 1. */
export const IMPROVEMENT_NAMES: Readonly<Record<Track, readonly string[]>> = {
  trade: ['Market', 'Trading House', 'Merchant Guild', 'Bank', 'Great Exchange'],
  politics: ['Town Hall', 'Embassy', 'Fortress', 'Courthouse', 'High Assembly'],
  science: ['School', 'Library', 'Aqueduct', 'Theater', 'University'],
};

// ---------------------------------------------------------------------------
// Knights, walls, barbarians
// ---------------------------------------------------------------------------

export type KnightLevel = 1 | 2 | 3;
export const KNIGHT_LEVELS: readonly KnightLevel[] = [1, 2, 3];
export const KNIGHT_NAMES: Readonly<Record<KnightLevel, string>> = {
  1: 'basic',
  2: 'strong',
  3: 'mighty',
};
/** Knights of each level per player (§1.2). */
export const KNIGHTS_PER_LEVEL = 2;
export const WALLS_PER_PLAYER = 3;
/** Each wall raises the safe hand size on a 7 by this (§4.1). */
export const WALL_BONUS = 2;
/** Ship faces until the barbarians land (§3.3, Q2). */
export const BARBARIAN_STEPS = 7;
/** Progress cards a hand may hold (VP cards are laid out, §3.2). */
export const PROGRESS_HAND_MAX = 4;
export const METROPOLIS_VP = 2;
/** Knight-action cancels per turn (a selected knight may be put down this often). */
export const MAX_KNIGHT_CANCELS = 3;

export interface Knight {
  owner: PlayerId;
  level: KnightLevel;
  active: boolean;
  /** turn.number it was activated (it cannot act on that turn), or null. */
  activatedOn: number | null;
  /** turn.number it was promoted (once per turn), or null. */
  promotedOn: number | null;
}

/** Event die: 3 ship faces and one city gate per track (§1.2). */
export type EventFace = 'ship' | Track;
export const EVENT_DIE: readonly EventFace[] = [
  'ship',
  'ship',
  'ship',
  'trade',
  'politics',
  'science',
];

// ---------------------------------------------------------------------------
// Progress cards (§4.6)
// ---------------------------------------------------------------------------

export type ProgressCard =
  // science
  | 'alchemist'
  | 'crane'
  | 'engineer'
  | 'inventor'
  | 'irrigation'
  | 'medicine'
  | 'mining'
  | 'printer'
  | 'roadBuilding'
  | 'smith'
  // politics
  | 'bishop'
  | 'constitution'
  | 'deserter'
  | 'diplomat'
  | 'intrigue'
  | 'saboteur'
  | 'spy'
  | 'warlord'
  | 'wedding'
  // trade
  | 'commercialHarbor'
  | 'masterMerchant'
  | 'merchant'
  | 'merchantFleet'
  | 'resourceMonopoly'
  | 'tradeMonopoly';

/** Card counts per deck (§4.6 deck check: 18 each). */
export const DECKS: Readonly<Record<Track, readonly (readonly [ProgressCard, number])[]>> = {
  science: [
    ['alchemist', 2],
    ['crane', 2],
    ['engineer', 1],
    ['inventor', 2],
    ['irrigation', 2],
    ['medicine', 2],
    ['mining', 2],
    ['printer', 1],
    ['roadBuilding', 2],
    ['smith', 2],
  ],
  politics: [
    ['bishop', 2],
    ['constitution', 1],
    ['deserter', 2],
    ['diplomat', 2],
    ['intrigue', 2],
    ['saboteur', 2],
    ['spy', 3],
    ['warlord', 2],
    ['wedding', 2],
  ],
  trade: [
    ['commercialHarbor', 2],
    ['masterMerchant', 2],
    ['merchant', 6],
    ['merchantFleet', 2],
    ['resourceMonopoly', 4],
    ['tradeMonopoly', 2],
  ],
};

export const PROGRESS_CARDS: readonly ProgressCard[] = TRACKS.flatMap((t) =>
  DECKS[t].map(([c]) => c),
);
export const isProgressCard = (x: unknown): x is ProgressCard =>
  (PROGRESS_CARDS as readonly unknown[]).includes(x);

/** The deck (track colour) of each card. */
export const CARD_TRACK: Readonly<Record<ProgressCard, Track>> = Object.fromEntries(
  TRACKS.flatMap((t) => DECKS[t].map(([c]) => [c, t] as const)),
) as Record<ProgressCard, Track>;

/** Printer and Constitution: 1 VP each, revealed when drawn (§3.2). */
export const VP_CARDS: readonly ProgressCard[] = ['printer', 'constitution'];
export const isVpCard = (c: ProgressCard): boolean => VP_CARDS.includes(c);

/** 5th-edition names (6th in brackets, Appendix A). */
export const CARD_NAMES: Readonly<Record<ProgressCard, string>> = {
  alchemist: 'Alchemist',
  crane: 'Crane',
  engineer: 'Engineer',
  inventor: 'Inventor',
  irrigation: 'Irrigation',
  medicine: 'Medicine',
  mining: 'Mining',
  printer: 'Printer',
  roadBuilding: 'Road Building',
  smith: 'Smith',
  bishop: 'Bishop',
  constitution: 'Constitution',
  deserter: 'Deserter',
  diplomat: 'Diplomat',
  intrigue: 'Intrigue',
  saboteur: 'Saboteur',
  spy: 'Spy',
  warlord: 'Warlord',
  wedding: 'Wedding',
  commercialHarbor: 'Commercial Harbor',
  masterMerchant: 'Master Merchant',
  merchant: 'Merchant',
  merchantFleet: 'Merchant Fleet',
  resourceMonopoly: 'Resource Monopoly',
  tradeMonopoly: 'Trade Monopoly',
};

/** One-line card texts (HUD). */
export const CARD_TEXT: Readonly<Record<ProgressCard, string>> = {
  alchemist: 'Before rolling: choose the yellow and red dice.',
  crane: 'Your next city improvement this turn costs 1 commodity less.',
  engineer: 'Build a city wall for free.',
  inventor: 'Swap two number tokens (not 2, 6, 8 or 12).',
  irrigation: 'Take 2 grain for each fields hex next to your buildings.',
  medicine: 'Upgrade a settlement to a city for 2 ore and 1 grain.',
  mining: 'Take 2 ore for each mountains hex next to your buildings.',
  printer: '1 victory point.',
  roadBuilding: 'Build 2 roads for free.',
  smith: 'Promote up to 2 of your knights for free.',
  bishop: 'Move the robber and take 1 card from each player next to it.',
  constitution: '1 victory point.',
  deserter: 'An opponent removes a knight; you may place one of the same strength.',
  diplomat: 'Remove an open road. Your own may be placed again.',
  intrigue: 'Displace an opponent’s knight on one of your roads.',
  saboteur: 'Players with as many VP as you or more discard half their cards.',
  spy: 'Look at a player’s progress cards and take one.',
  warlord: 'Activate all your knights for free.',
  wedding: 'Players with more VP than you give you 2 cards each.',
  commercialHarbor: 'Offer each opponent a resource for a commodity of their choice.',
  masterMerchant: 'Take 2 cards from a player with more VP than you.',
  merchant: 'Place the merchant: 1 VP and 2:1 trades for that hex’s resource.',
  merchantFleet: 'This turn, trade one kind of card 2:1 with the bank.',
  resourceMonopoly: 'Each opponent gives you 2 of a resource you name.',
  tradeMonopoly: 'Each opponent gives you 1 of a commodity you name.',
};

// ---------------------------------------------------------------------------
// The slice
// ---------------------------------------------------------------------------

export interface CkPlayer {
  commodities: CommodityCounts;
  improvements: Record<Track, number>;
  /** Progress cards in hand (secret). */
  progress: ProgressCard[];
  /** Revealed VP cards (Printer, Constitution). */
  vpCards: ProgressCard[];
  /** Defender of Catan cards (1 VP each, §3.3). */
  defender: number;
}

export interface Metropolis {
  owner: PlayerId;
  vertex: VertexId;
}

export interface CkSlice {
  v: 1;
  players: CkPlayer[];
  /** Commodity cards in the supply. */
  bank: CommodityCounts;
  knights: Record<VertexId, Knight>;
  /** City walls: vertex -> owner. */
  walls: Record<VertexId, PlayerId>;
  metropolis: Record<Track, Metropolis | null>;
  /** Barbarian ship position, 0 (start) .. BARBARIAN_STEPS - 1. */
  barbarian: number;
  /** Barbarian attacks so far (the robber is inert until the first, CK-30). */
  attacks: number;
  merchant: { hex: HexId; owner: PlayerId } | null;
  /** Face-down stacks: draw with pop(), played cards go under (unshift). */
  decks: Record<Track, ProgressCard[]>;
  /** The last event die face (null before the first roll). */
  event: EventFace | null;
  /** Per-turn flags, reset at every turn start. */
  turn: {
    /** Cranes played and not used yet (each saves 1 commodity on one improvement). */
    cranes: number;
    /** Merchant Fleet: kinds of cards tradeable 2:1 with the bank this turn. */
    fleet: Good[];
    /** Knight selections put down this turn (MAX_KNIGHT_CANCELS). */
    cancels: number;
  };
  /** Commodity parts of the open player trade offer (base `trade` phase), or null. */
  trade: { give: CommodityCounts; want: CommodityCounts } | null;
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/** What to do when an interrupt is over: go on with the roll (production), or back to main. */
export type Then = 'roll' | 'main';

export type CkPhase =
  /** Barbarians won: each player in `queue` chooses a city to lose (queue[0] acts). */
  | { kind: 'ck/pillage'; queue: PlayerId[] }
  /** Defenders tied: each player in `queue` draws a progress card of a chosen deck. */
  | { kind: 'ck/defender'; queue: PlayerId[] }
  /** Players in `queue` hold too many progress cards out of their turn: discard one each. */
  | { kind: 'ck/progressDiscard'; queue: PlayerId[]; then: Then }
  /** Aqueduct: players in `queue` take a resource of their choice. */
  | { kind: 'ck/aqueduct'; queue: PlayerId[] }
  /** `player` places the metropolis of `track` on one of their cities. */
  | { kind: 'ck/metropolis'; track: Track; player: PlayerId; resume: 'main' | 'specialBuild' }
  /**
   * The current player selected the knight on `vertex` (command dialog): activate, promote,
   * or (main phase only) move / displace / chase the robber. Back to `resume` afterwards.
   */
  | { kind: 'ck/knight'; vertex: VertexId; resume: 'main' | 'specialBuild' }
  /** `player`'s displaced knight (`knight`, from `from`) goes to a new spot. */
  | {
      kind: 'ck/relocate';
      player: PlayerId;
      from: VertexId;
      knight: Knight;
    }
  /** Saboteur: `pending[p]` cards to discard. */
  | { kind: 'ck/sabotage'; pending: number[] }
  /** Wedding: `pending[p]` cards to give to `to`. */
  | { kind: 'ck/wedding'; pending: number[]; to: PlayerId }
  /** A progress card being resolved by its player (and maybe a victim). */
  | CardPhase;

/** A base phase or a C&K phase (narrows on `kind`, unlike the open ExpansionPhase). */
export type AnyPhase = CkPhase | Exclude<Phase, ExpansionPhase>;
export const phaseOf = (state: { phase: Phase }): AnyPhase => state.phase as unknown as AnyPhase;
/** A C&K phase as a core Phase (to assign `draft.phase`). */
export const asPhase = (p: CkPhase): Phase => p as unknown as Phase;

export type CardPhase =
  | { kind: 'ck/card'; card: 'inventor'; first: HexId | null }
  | { kind: 'ck/card'; card: 'engineer' | 'medicine' | 'bishop' | 'intrigue' | 'merchant' }
  | { kind: 'ck/card'; card: 'smith'; left: number; done: VertexId[] }
  | {
      kind: 'ck/card';
      card: 'deserter';
      victim: PlayerId | null;
      /** The removed knight (after the victim chose), to place a copy. */
      removed: Knight | null;
    }
  | { kind: 'ck/card'; card: 'diplomat'; removed: EdgeId | null }
  | { kind: 'ck/card'; card: 'spy'; victim: PlayerId | null }
  | { kind: 'ck/card'; card: 'masterMerchant'; victim: PlayerId | null; left: number }
  | { kind: 'ck/card'; card: 'merchantFleet' | 'resourceMonopoly' | 'tradeMonopoly' }
  | {
      kind: 'ck/card';
      card: 'commercialHarbor';
      /** Opponents still to be offered a resource, next first. */
      queue: PlayerId[];
      /** The resource offered to queue[0] (they answer with a commodity), or null. */
      offered: Resource | null;
    };

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** The module's actions. Board locations are `vertex` / `edge` / `hex` (implied board clicks). */
export type CkAction =
  | { type: 'ck/buildKnight'; player: PlayerId; vertex: VertexId }
  | { type: 'ck/activateKnight'; player: PlayerId; vertex: VertexId }
  | { type: 'ck/promoteKnight'; player: PlayerId; vertex: VertexId }
  | { type: 'ck/selectKnight'; player: PlayerId; vertex: VertexId }
  | { type: 'ck/chaseRobber'; player: PlayerId }
  | { type: 'ck/cancel'; player: PlayerId }
  | { type: 'ck/buildWall'; player: PlayerId; vertex: VertexId }
  | { type: 'ck/improve'; player: PlayerId; track: Track }
  | { type: 'ck/play'; player: PlayerId; card: ProgressCard }
  | { type: 'ck/alchemist'; player: PlayerId; yellow: number; red: number }
  | { type: 'ck/discardProgress'; player: PlayerId; card: ProgressCard }
  | { type: 'ck/bankTrade'; player: PlayerId; give: Good; receive: Good }
  | {
      type: 'ck/offerTrade';
      player: PlayerId;
      give: Partial<Record<Good, number>>;
      want: Partial<Record<Good, number>>;
      to: PlayerId[];
    }
  /** Discard (7, Saboteur) or give (Wedding) exactly the owed cards. */
  | {
      type: 'ck/discard';
      player: PlayerId;
      resources: Partial<ResourceCounts>;
      commodities: CommodityBundle;
    }
  // Prompt answers (meaning depends on the phase)
  | { type: 'ck/pickVertex'; player: PlayerId; vertex: VertexId }
  | { type: 'ck/pickEdge'; player: PlayerId; edge: EdgeId }
  | { type: 'ck/pickHex'; player: PlayerId; hex: HexId }
  | { type: 'ck/pickPlayer'; player: PlayerId; target: PlayerId }
  | { type: 'ck/pickGood'; player: PlayerId; good: Good }
  | { type: 'ck/pickTrack'; player: PlayerId; track: Track }
  | { type: 'ck/pickCard'; player: PlayerId; card: ProgressCard }
  | { type: 'ck/done'; player: PlayerId };

export type CkActionType = CkAction['type'];

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function ckSlice(state: Pick<GameState, 'ext'>): CkSlice {
  const s = state.ext[CK];
  if (s === undefined) throw new Error('no Cities & Knights state');
  return s as CkSlice;
}

export function ckPlayer(state: Pick<GameState, 'ext'>, p: PlayerId): CkPlayer {
  const pl = ckSlice(state).players[p];
  if (!pl) throw new Error(`no player ${p}`);
  return pl;
}

export const commodityTotal = (c: CommodityBundle): number =>
  COMMODITIES.reduce((n, k) => n + (c[k] ?? 0), 0);

/** Knights of `player` (vertex + knight), any order. */
export function knightsOf(state: Pick<GameState, 'ext'>, player: PlayerId): [VertexId, Knight][] {
  return (Object.entries(ckSlice(state).knights) as [VertexId, Knight][]).filter(
    ([, k]) => k.owner === player,
  );
}

/** Sum of the levels of `player`'s active knights (their barbarian contribution). */
export function activeStrength(state: Pick<GameState, 'ext'>, player: PlayerId): number {
  return knightsOf(state, player).reduce((s, [, k]) => s + (k.active ? k.level : 0), 0);
}

/** Barbarian strength: every city on the board (a metropolis city counts once), CK-14. */
export function barbarianStrength(state: GameState): number {
  return Object.values(state.pieces.buildings).filter((b) => b.kind === 'city').length;
}

/** Defender strength: all active knights of all players (CK-10). */
export function defenderStrength(state: GameState): number {
  return state.players.reduce((s, p) => s + activeStrength(state, p.id), 0);
}

export const isRobberActive = (state: Pick<GameState, 'ext'>): boolean =>
  ckSlice(state).attacks > 0;

/** Vertices of `player`'s cities that carry a metropolis. */
export function metropolisVertices(state: Pick<GameState, 'ext'>): Set<VertexId> {
  const out = new Set<VertexId>();
  for (const t of TRACKS) {
    const m = ckSlice(state).metropolis[t];
    if (m) out.add(m.vertex);
  }
  return out;
}

/** Tracks whose metropolis `player` holds. */
export function metropolisesOf(state: Pick<GameState, 'ext'>, player: PlayerId): Track[] {
  return TRACKS.filter((t) => ckSlice(state).metropolis[t]?.owner === player);
}

/** C&K victory points (public): metropolises, Defender cards, VP cards, the merchant (§5). */
export function ckVictoryParts(
  state: Pick<GameState, 'ext'>,
  player: PlayerId,
): { label: string; vp: number }[] {
  const s = ckSlice(state);
  const pl = s.players[player];
  if (!pl) return [];
  const metros = metropolisesOf(state, player).length;
  return [
    { label: metros === 1 ? 'Metropolis' : 'Metropolises', vp: METROPOLIS_VP * metros },
    { label: 'Defender of Catan', vp: pl.defender },
    { label: 'Progress VP cards', vp: pl.vpCards.length },
    { label: 'Merchant', vp: s.merchant?.owner === player ? 1 : 0 },
  ];
}

export const ckVictoryPoints = (state: Pick<GameState, 'ext'>, player: PlayerId): number =>
  ckVictoryParts(state, player).reduce((n, x) => n + x.vp, 0);
