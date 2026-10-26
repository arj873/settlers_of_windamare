import { generateBoard } from './board';
import {
  DEFAULT_DISCARD_LIMIT,
  DEFAULT_VP_TO_WIN,
  DEV_CARD_TYPES,
  DISCARD_LIMIT_RANGE,
  RESOURCES,
  VP_TO_WIN_RANGE,
} from './constants';
import { MAPS, defaultMapFor, isMapId } from './maps';
import { emptyDevCards, emptyProgressCards, emptyResources } from './resources';
import { Rng } from './rng';
import type {
  DevCardType,
  GameSettings,
  GameState,
  Layout,
  MapId,
  Player,
  PlayerId,
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
  const map = config.map ?? (config.layout ? layoutToMap(config.layout) : defaultMapFor(n));
  if (!isMapId(map)) throw new Error(`unknown map ${String(map)}`);
  const def = MAPS[map];
  if (n < def.minPlayers || n > def.maxPlayers) {
    throw new Error(`map ${map} needs ${def.minPlayers}-${def.maxPlayers} players, got ${n}`);
  }
  const timer = config.turnTimerSec ?? null;
  if (timer !== null && (!Number.isInteger(timer) || timer <= 0)) {
    throw new Error(`turnTimerSec must be a positive integer or null, got ${timer}`);
  }
  const start = config.startingPlayer ?? 'random';
  const startingPlayer =
    start === 'random'
      ? randomStartingPlayer(config.seed, n)
      : intInRange('startingPlayer', start, { min: 0, max: n - 1 });
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
    specialBuildPhase: config.specialBuildPhase ?? n >= 5,
    hideBankCards: config.hideBankCards ?? false,
    turnTimerSec: timer,
    startingPlayer,
  };
}

/** Build the initial state: board generated, deck shuffled, phase = setup (starting player, settlement). */
export function createGame(config: GameConfig): GameState {
  const settings = resolveSettings(config);
  const def = MAPS[settings.map];

  const rng = Rng.fromSeed(config.seed);
  const { board, robber } = generateBoard(settings.map, rng);

  const deck: DevCardType[] = [];
  for (const t of DEV_CARD_TYPES) {
    for (let i = 0; i < def.devDeck[t]; i++) deck.push(t);
  }
  const devDeck = rng.shuffle(deck);

  const players: Player[] = config.players.map((p, id) => ({
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
  return {
    schemaVersion: 4,
    settings,
    board,
    pieces: { buildings: {}, roads: {} },
    robber,
    players,
    bank,
    devDeck,
    turn: { number: 0, current: first, devCardPlayed: false, tradeOffers: 0 },
    phase: { kind: 'setup', index: 0, step: 'settlement', lastSettlement: null },
    dice: null,
    diceDeck: [],
    awards: { longestRoad: null, largestArmy: null },
    log: [
      {
        turn: 0,
        player: null,
        text: `Game created (${def.name} map, seed ${String(config.seed)})`,
      },
      { turn: 0, player: first, text: `${players[first]?.name ?? `Player ${first + 1}`} starts` },
    ],
    rng: rng.state,
    winner: null,
  };
}
