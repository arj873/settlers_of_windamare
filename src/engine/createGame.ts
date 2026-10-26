import { generateBoard } from './board';
import {
  DEFAULT_DISCARD_LIMIT,
  DEFAULT_VP_TO_WIN,
  DEV_CARD_TYPES,
  DISCARD_LIMIT_RANGE,
  RESOURCES,
  VP_TO_WIN_RANGE,
} from './constants';
import { MAP_VETO_CANDIDATES, vetoOrder } from './actions/veto';
import { isTimerPreset, timerSettings } from './clock';
import { MAPS, MAP_IDS, defaultMapFor, isMapId } from './maps';
import {
  MAP_SELECTIONS,
  OFFICIAL_SETUP,
  ROBBER_MODES,
  SETUP_BUILDINGS,
  SETUP_RESTRICTIONS,
} from './variants';
import { emptyDevCards, emptyProgressCards, emptyResources } from './resources';
import { Rng } from './rng';
import { emptyStats } from './stats';
import type {
  DevCardType,
  GameSettings,
  GameState,
  Layout,
  MapCandidate,
  MapId,
  MapSelection,
  Player,
  PlayerId,
  RobberMode,
  SetupPlacement,
  TimerSettings,
} from './types';

export interface PlayerConfig {
  name: string;
  color: string;
}

export interface GameConfig {
  seed: number | string;
  /** In seat (turn) order; `startingPlayer` places first. Count must fit the map (3..8 overall). */
  players: PlayerConfig[];
  /**
   * Board. Default: `layout` if given (compat), else the smallest random map designed for the
   * player count (`defaultMapFor`).
   */
  map?: MapId;
  /** @deprecated v1 compat: 'beginner' = map 'base', 'random' = map 'baseRandom'. Ignored if `map` is set. */
  layout?: Layout;
  /** 3..20, default 10. */
  vpToWin?: number;
  /** 5..20, default 7. */
  discardLimit?: number;
  /** Default false. Rolls come from a 36-card dice deck. */
  balancedDice?: boolean;
  /** Default: true with 5+ players. Special build steps between turns. */
  specialBuildPhase?: boolean;
  /** Default false. Client-side only. */
  hideBankCards?: boolean;
  /** Default null (no timer). Client-side only. */
  turnTimerSec?: number | null;
  /**
   * Who starts (places first, takes the first turn). Default 'random': a seat drawn from the
   * seed, as the official rules have the players roll for it (RULES.md 2.7).
   */
  startingPlayer?: PlayerId | 'random';
  // --- V1 variants (variants.ts, RULES.md §18). Absent = official rule. -------------------
  robberMode?: RobberMode;
  /** Default false. Event Cards replace the dice. Not combinable with balancedDice. */
  eventCards?: boolean;
  setupPlacement?: SetupPlacement;
  /**
   * Default false. Shuffle `players` into seats (own seeded stream, so board and rolls of a seed
   * do not change); seat 0 of the shuffled order starts unless `startingPlayer` is a number.
   */
  randomTurnOrder?: boolean;
  /** Default 'fixed'. 'random' ignores `map`; 'veto' starts with a map vote (on `map`'s frame). */
  mapSelection?: MapSelection;
  /** Default false. Rush: the dice roll automatically at the start of each turn. */
  rushMode?: boolean;
  /** Default false. Turbo (ours): both setup rounds pay starting resources. */
  turboMode?: boolean;
  /** Default false. Paired players' turn (4+ players); replaces the special building phase. */
  secondSettler?: boolean;
  /** Default none. Chess-clock timer (clock.ts); not together with turnTimerSec. */
  timer?: TimerSettings | null;
}

/** Seat order for Randomize Turn Order: `order[seat]` = config index. Own stream per seed. */
export function randomSeatOrder(seed: number | string, playerCount: number): number[] {
  const rng = Rng.fromSeed(`order:${typeof seed === 'number' ? `n${seed}` : seed}`);
  return rng.shuffle(Array.from({ length: playerCount }, (_, i) => i));
}

/**
 * The seat a seed starts with. Drawn from its own stream (not the game RNG), so the board, the
 * deck and every roll of a seed stay the same as before starting players were random.
 */
export function randomStartingPlayer(seed: number | string, playerCount: number): PlayerId {
  return Rng.fromSeed(`start:${typeof seed === 'number' ? `n${seed}` : seed}`).int(playerCount);
}

export function layoutToMap(layout: Layout): MapId {
  return layout === 'beginner' ? 'base' : 'baseRandom';
}

function intInRange(name: string, v: number, range: { min: number; max: number }): number {
  if (!Number.isInteger(v) || v < range.min || v > range.max) {
    throw new Error(`${name} must be an integer ${range.min}-${range.max}, got ${v}`);
  }
  return v;
}

/** Resolve and validate the settings for `config` (throws on invalid values). */
export function resolveSettings(config: GameConfig): GameSettings {
  const n = config.players.length;
  const mapSelection = config.mapSelection ?? 'fixed';
  if (!MAP_SELECTIONS.includes(mapSelection)) {
    throw new Error(`unknown mapSelection ${String(mapSelection)}`);
  }
  let map = config.map ?? (config.layout ? layoutToMap(config.layout) : defaultMapFor(n));
  if (mapSelection === 'random') map = randomMapFor(config.seed, n);
  // A veto between copies of the fixed beginner board means nothing: vote on random layouts.
  if (mapSelection === 'veto' && map === 'base') map = 'baseRandom';
  if (!isMapId(map)) throw new Error(`unknown map ${String(map)}`);
  const def = MAPS[map];
  if (n < def.minPlayers || n > def.maxPlayers) {
    throw new Error(`map ${map} needs ${def.minPlayers}-${def.maxPlayers} players, got ${n}`);
  }
  const timer = config.turnTimerSec ?? null;
  if (timer !== null && (!Number.isInteger(timer) || timer <= 0)) {
    throw new Error(`turnTimerSec must be a positive integer or null, got ${timer}`);
  }
  const clock = config.timer ?? null;
  if (clock !== null) {
    if (timer !== null) throw new Error('use either timer or turnTimerSec, not both');
    if (!isTimerPreset(clock.preset) || (clock.preset as string) === 'off') {
      throw new Error(`unknown timer preset ${String(clock.preset)}`);
    }
    timerSettings(clock.preset, clock); // validates the ranges (throws)
  }
  const secondSettler = config.secondSettler ?? false;
  if (secondSettler && n < 4) {
    throw new Error('second settler needs 4+ players (Catanian 2 sits third to the left)');
  }
  if (secondSettler && config.specialBuildPhase) {
    throw new Error('second settler replaces the special building phase; turn one off');
  }
  const start = config.startingPlayer ?? 'random';
  const shuffled = config.randomTurnOrder === true;
  const startingPlayer =
    start !== 'random'
      ? intInRange('startingPlayer', start, { min: 0, max: n - 1 })
      : shuffled
        ? 0
        : randomStartingPlayer(config.seed, n);
  const robberMode = config.robberMode ?? 'normal';
  if (!ROBBER_MODES.includes(robberMode)) throw new Error(`unknown robberMode ${robberMode}`);
  const eventCards = config.eventCards ?? false;
  if (eventCards && config.balancedDice) {
    throw new Error(
      'eventCards and balancedDice cannot both be on (the event deck replaces the dice)',
    );
  }
  const placement = config.setupPlacement;
  if (placement !== undefined) validateSetupPlacement(placement);
  return {
    seed: config.seed,
    map,
    vpToWin: intInRange('vpToWin', config.vpToWin ?? DEFAULT_VP_TO_WIN, VP_TO_WIN_RANGE),
    discardLimit: intInRange(
      'discardLimit',
      config.discardLimit ?? DEFAULT_DISCARD_LIMIT,
      DISCARD_LIMIT_RANGE,
    ),
    balancedDice: config.balancedDice ?? false,
    specialBuildPhase: config.specialBuildPhase ?? (n >= 5 && !secondSettler),
    hideBankCards: config.hideBankCards ?? false,
    turnTimerSec: timer,
    startingPlayer,
    // Variants are written only when they differ from the official rule, so default settings
    // (and every existing save) look exactly as before.
    ...(robberMode === 'normal' ? {} : { robberMode }),
    ...(eventCards ? { eventCards } : {}),
    ...(placement === undefined || isOfficialSetup(placement)
      ? {}
      : { setupPlacement: structuredCopy(placement) }),
    ...(shuffled ? { seatOrder: randomSeatOrder(config.seed, n) } : {}),
    ...(mapSelection === 'fixed' ? {} : { mapSelection }),
    ...(config.rushMode ? { rushMode: true } : {}),
    ...(config.turboMode ? { turboMode: true } : {}),
    ...(secondSettler ? { secondSettler: true } : {}),
    ...(clock ? { timer: { ...clock } } : {}),
  };
}

/** Map selection 'random': a seeded pick (own stream) among the maps that fit `playerCount`. */
export function randomMapFor(seed: number | string, playerCount: number): MapId {
  const fits = MAP_IDS.filter(
    (id) => playerCount >= MAPS[id].minPlayers && playerCount <= MAPS[id].maxPlayers,
  );
  return Rng.fromSeed(`map:${typeof seed === 'number' ? `n${seed}` : seed}`).pick(fits);
}

function validateSetupPlacement(p: SetupPlacement): void {
  for (const round of [p.first, p.second]) {
    if (!SETUP_BUILDINGS.includes(round.building)) {
      throw new Error(`unknown setup building ${String(round.building)}`);
    }
    if (!SETUP_RESTRICTIONS.includes(round.restriction)) {
      throw new Error(`unknown setup restriction ${String(round.restriction)}`);
    }
  }
}

function isOfficialSetup(p: SetupPlacement): boolean {
  const o = OFFICIAL_SETUP;
  return (
    p.first.building === o.first.building &&
    p.first.restriction === o.first.restriction &&
    p.second.building === o.second.building &&
    p.second.restriction === o.second.restriction
  );
}

function structuredCopy(p: SetupPlacement): SetupPlacement {
  return { first: { ...p.first }, second: { ...p.second } };
}

/** Build the initial state: board generated, deck shuffled, phase = setup (starting player, settlement). */
export function createGame(config: GameConfig): GameState {
  const settings = resolveSettings(config);
  const def = MAPS[settings.map];

  const rng = Rng.fromSeed(config.seed);
  const { board, robber } = generateBoard(settings.map, rng);
  // Map veto: more candidate boards from the same stream (only then, so other games keep
  // their boards, decks and rolls per seed).
  const candidates: MapCandidate[] =
    settings.mapSelection === 'veto'
      ? [
          { board, robber },
          ...Array.from({ length: MAP_VETO_CANDIDATES - 1 }, () =>
            generateBoard(settings.map, rng),
          ),
        ]
      : [];

  const deck: DevCardType[] = [];
  for (const t of DEV_CARD_TYPES) {
    for (let i = 0; i < def.devDeck[t]; i++) deck.push(t);
  }
  const devDeck = rng.shuffle(deck);

  const order = settings.seatOrder ?? config.players.map((_, i) => i);
  const seated = order.map((i) => config.players[i] as PlayerConfig);
  const players: Player[] = seated.map((p, id) => ({
    id,
    name: p.name,
    color: p.color,
    resources: emptyResources(),
    devCards: emptyDevCards(),
    newDevCards: emptyDevCards(),
    knightsPlayed: 0,
    progressCardsPlayed: emptyProgressCards(),
  }));

  const bank = emptyResources();
  for (const r of RESOURCES) bank[r] = def.bankPerResource;

  const first = settings.startingPlayer;
  const veto = candidates.length > 0;
  const vetoers = vetoOrder(players.length, first, candidates.length);
  return {
    schemaVersion: 4,
    settings,
    board,
    pieces: { buildings: {}, roads: {} },
    robber,
    players,
    bank,
    devDeck,
    turn: {
      number: 0,
      current: veto ? (vetoers[0] as PlayerId) : first,
      devCardPlayed: false,
      tradeOffers: 0,
    },
    phase: veto
      ? {
          kind: 'mapVeto',
          candidates,
          vetoed: candidates.map((): null => null),
          order: vetoers,
          next: 0,
        }
      : { kind: 'setup', index: 0, step: 'settlement', lastSettlement: null },
    dice: null,
    diceDeck: [],
    awards: { longestRoad: null, largestArmy: null },
    log: [
      {
        turn: 0,
        player: null,
        text: `Game created (${def.name} map, seed ${String(config.seed)})`,
      },
      ...(settings.seatOrder
        ? [{ turn: 0, player: null, text: `Turn order: ${players.map((p) => p.name).join(', ')}` }]
        : []),
      { turn: 0, player: first, text: `${players[first]?.name ?? `Player ${first + 1}`} starts` },
    ],
    rng: rng.state,
    winner: null,
    stats: emptyStats(players.length),
    ...(settings.eventCards
      ? { eventDeck: [], lastEvent: null, damagedRoads: players.map((): null => null) }
      : {}),
  };
}
