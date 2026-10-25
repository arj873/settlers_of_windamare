/**
 * Pure controller decisions (no DOM, no timers): who views the screen, what the board
 * highlights, which legal action a board click means, and which bot moves next.
 */
import type { Action, EdgeId, GameState, HexId, PlayerId, VertexId } from '../engine';
import type { Highlights } from '../render';
import type { Controller, PlaceMode } from '../ui';

/** Seat controllers, indexed by PlayerId. */
export type Seats = readonly Controller[];

const canAct = (legal: readonly Action[], p: PlayerId) => legal.some((a) => a.player === p);

/** Seat order starting at the current player (so ties go to whoever is "next" at the table). */
function tableOrder(state: GameState): PlayerId[] {
  const n = state.players.length;
  return state.players.map((_, i) => (state.turn.current + i) % n);
}

/**
 * Players who owe a response before the current player can continue: everyone still discarding,
 * or trade responders still 'pending'. In table order.
 */
export function obligated(state: GameState): PlayerId[] {
  const phase = state.phase;
  if (phase.kind === 'discard') return tableOrder(state).filter((p) => (phase.pending[p] ?? 0) > 0);
  if (phase.kind === 'trade') {
    return tableOrder(state).filter((p) => phase.offer.responses[p] === 'pending');
  }
  return [];
}

export function humanSeats(seats: Seats): PlayerId[] {
  return seats.flatMap((c, i) => (c === 'human' ? [i] : []));
}

/**
 * The human who must look at the screen now. Owed responses (discard, trade replies) come
 * before the current player; the previous viewer is kept while they still have something to do
 * and during bot turns. All-bot games: spectator, fixed viewer 0.
 */
export function pickViewer(
  state: GameState,
  seats: Seats,
  legal: readonly Action[],
  prev: PlayerId | null,
): PlayerId {
  const humans = humanSeats(seats);
  const fallback = prev !== null && humans.includes(prev) ? prev : (humans[0] ?? 0);
  if (humans.length === 0 || state.phase.kind === 'gameOver') return fallback;

  const owed = obligated(state).filter((p) => seats[p] === 'human' && canAct(legal, p));
  if (owed.length > 0) return prev !== null && owed.includes(prev) ? prev : (owed[0] as PlayerId);

  const cur = state.turn.current;
  if (seats[cur] === 'human' && canAct(legal, cur)) return cur;
  return fallback;
}

/** Legal actions a board click may submit right now for `viewer` (implied prompts or build mode). */
export function boardActions(
  legal: readonly Action[],
  viewer: PlayerId,
  placeMode: PlaceMode | null,
): Action[] {
  const mine = legal.filter((a) => a.player === viewer);
  const implied = mine.filter(
    (a) =>
      a.type === 'placeSetupSettlement' ||
      a.type === 'placeSetupRoad' ||
      a.type === 'moveRobber' ||
      a.type === 'placeFreeRoad',
  );
  if (implied.length > 0) return implied;
  const buildType =
    placeMode === 'road'
      ? 'buildRoad'
      : placeMode === 'settlement'
        ? 'buildSettlement'
        : placeMode === 'city'
          ? 'buildCity'
          : null;
  return buildType ? mine.filter((a) => a.type === buildType) : [];
}

/** Board highlights for a set of board actions (`{}` when there are none). */
export function highlightsFor(actions: readonly Action[], color?: string): Highlights {
  const vertices: VertexId[] = [];
  const edges: EdgeId[] = [];
  const hexes: HexId[] = [];
  for (const a of actions) {
    if ('vertex' in a) vertices.push(a.vertex);
    else if ('edge' in a) edges.push(a.edge);
    else if ('hex' in a) hexes.push(a.hex);
  }
  if (vertices.length + edges.length + hexes.length === 0) return {};
  return { vertices, edges, hexes, ...(color ? { color } : {}) };
}

export type BoardClick =
  { kind: 'vertex'; id: VertexId } | { kind: 'edge'; id: EdgeId } | { kind: 'hex'; id: HexId };

/** The board action matching a click, or undefined when the click means nothing right now. */
export function actionForClick(actions: readonly Action[], click: BoardClick): Action | undefined {
  return actions.find((a) =>
    click.kind === 'vertex'
      ? 'vertex' in a && a.vertex === click.id
      : click.kind === 'edge'
        ? 'edge' in a && a.edge === click.id
        : 'hex' in a && a.hex === click.id,
  );
}

export interface BotTurn {
  player: PlayerId;
  /** A quick reaction (discard, trade reply): use the short delay. */
  fast: boolean;
}

/**
 * Which bot acts next, or null if it is a human's move (or nobody's). Bots owing a response go
 * first; a bot that offered a trade waits until every human addressee has answered.
 */
export function nextBot(state: GameState, seats: Seats, legal: readonly Action[]): BotTurn | null {
  if (state.phase.kind === 'gameOver') return null;
  const owed = obligated(state);
  const bot = owed.find((p) => seats[p] === 'bot' && canAct(legal, p));
  if (bot !== undefined) return { player: bot, fast: true };
  if (state.phase.kind === 'trade' && owed.some((p) => seats[p] === 'human')) return null;
  const cur = state.turn.current;
  return seats[cur] === 'bot' && canAct(legal, cur) ? { player: cur, fast: false } : null;
}

/** Nobody can move but the game is not over: the controller reports this instead of hanging. */
export function isStalled(state: GameState, legal: readonly Action[]): boolean {
  return state.phase.kind !== 'gameOver' && legal.length === 0;
}
