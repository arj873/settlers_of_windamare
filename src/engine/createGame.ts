import { generateBoard } from './board';
import {
  BANK_PER_RESOURCE,
  DEFAULT_VP_TO_WIN,
  DEV_CARD_TYPES,
  DEV_DECK_COMPOSITION,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RESOURCES,
} from './constants';
import { emptyDevCards, emptyResources } from './resources';
import { Rng } from './rng';
import type { DevCardType, GameState, Layout, Player } from './types';

export interface PlayerConfig {
  name: string;
  color: string;
}

export interface GameConfig {
  seed: number | string;
  /** 3–4 players, in turn order. Player 0 places first in setup. */
  players: PlayerConfig[];
  layout: Layout;
  /** Default 10. */
  vpToWin?: number;
}

/** Build the initial state: board generated, deck shuffled, phase = setup (player 0, settlement). */
export function createGame(config: GameConfig): GameState {
  const n = config.players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new Error(`need ${MIN_PLAYERS}-${MAX_PLAYERS} players, got ${n}`);
  }

  const rng = Rng.fromSeed(config.seed);
  const { board, robber } = generateBoard(config.layout, rng);

  const deck: DevCardType[] = [];
  for (const t of DEV_CARD_TYPES) {
    for (let i = 0; i < DEV_DECK_COMPOSITION[t]; i++) deck.push(t);
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
  }));

  const bank = emptyResources();
  for (const r of RESOURCES) bank[r] = BANK_PER_RESOURCE;

  return {
    schemaVersion: 1,
    settings: {
      seed: config.seed,
      layout: config.layout,
      vpToWin: config.vpToWin ?? DEFAULT_VP_TO_WIN,
    },
    board,
    pieces: { buildings: {}, roads: {} },
    robber,
    players,
    bank,
    devDeck,
    turn: { number: 0, current: 0, devCardPlayed: false },
    phase: { kind: 'setup', index: 0, step: 'settlement', lastSettlement: null },
    dice: null,
    awards: { longestRoad: null, largestArmy: null },
    log: [
      {
        turn: 0,
        player: null,
        text: `Game created (${config.layout} board, seed ${String(config.seed)})`,
      },
    ],
    rng: rng.state,
    winner: null,
  };
}
