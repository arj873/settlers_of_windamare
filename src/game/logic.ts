/**
 * Pure controller decisions (no DOM, no timers): who views the screen, what the board
 * highlights, which legal action a board click means, and which bot moves next.
 */
import { actingPlayers } from '../engine';
import type { Action, EdgeId, GameConfig, GameState, HexId, PlayerId, VertexId } from '../engine';
import type { Highlights } from '../render';
import type { Controller, NewGameConfig, PlaceMode } from '../ui';

/** `createGame` config for a setup-screen config (shared with the online room, src/net). */
export function gameConfigOf(cfg: NewGameConfig, seed: string, vpToWin = cfg.vpToWin): GameConfig {
  const base = (cfg.mode ?? 'base') === 'base';
  return {
    seed,
    players: cfg.players.map((p) => ({ name: p.name, color: p.color })),
    // Expansion modes take the map from their scenario (docs/EXPANSIONS.md §3).
    ...(base
      ? { map: cfg.map }
      : {
          mode: cfg.mode,
          ...(cfg.scenario === undefined ? {} : { scenario: cfg.scenario }),
          ...(cfg.options === undefined ? {} : { options: cfg.options }),
        }),
    vpToWin,
    discardLimit: cfg.discardLimit,
    balancedDice: cfg.rules.balancedDice,
    hideBankCards: cfg.rules.hideBankCards,
    turnTimerSec: cfg.variants?.timer ? null : cfg.turnTimerSec,
    ...cfg.variants,
  };
}

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
 * trade responders still 'pending', or players with an open event-card task. In table order.
 */
export function obligated(state: GameState): PlayerId[] {
  const phase = state.phase;
  if (phase.kind === 'discard') return tableOrder(state).filter((p) => (phase.pending[p] ?? 0) > 0);
  if (phase.kind === 'trade') {
    return tableOrder(state).filter((p) => phase.offer.responses[p] === 'pending');
  }
  if (phase.kind === 'event') {
    return tableOrder(state).filter((p) => phase.tasks.some((t) => t.player === p));
  }
  // Expansion phases that several players act in (the module's `actors`): everyone but the
  // current player owes a response (the current player is handled as usual).
  if (phase.kind.includes('/')) {
    return tableOrder(state).filter(
      (p) => p !== state.turn.current && actingPlayers(state).includes(p),
    );
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

/**
 * What boardActions needs from the expansions' HUD extensions: their implied (button-less) board
 * action types, and the action type of a namespaced place mode. Registered by ui/expansions.ts
 * when the UI loads; this file must not import UI code, because the room server (src/net) runs
 * it in a worker / Node, where expansion stylesheets cannot load.
 */
export interface BoardExtensions {
  implied: ReadonlySet<string>;
  placeModeAction(mode: string): string | null;
}
let boardExtensions: BoardExtensions = { implied: new Set(), placeModeAction: () => null };
export function setBoardExtensions(x: BoardExtensions): void {
  boardExtensions = x;
}

/** Legal actions a board click may submit right now for `viewer` (implied prompts or build mode). */
export function boardActions(
  legal: readonly Action[],
  viewer: PlayerId,
  placeMode: PlaceMode | null,
): Action[] {
  const mine = legal.filter((a) => a.player === viewer);
  const extImplied = boardExtensions.implied;
  const implied = mine.filter(
    (a) =>
      a.type === 'placeSetupSettlement' ||
      a.type === 'placeSetupRoad' ||
      a.type === 'moveRobber' ||
      a.type === 'placeFreeRoad' ||
      a.type === 'eventDamageRoad' ||
      extImplied.has(a.type),
  );
  if (implied.length > 0) return implied;
  const buildType =
    placeMode === 'road'
      ? 'buildRoad'
      : placeMode === 'settlement'
        ? 'buildSettlement'
        : placeMode === 'city'
          ? 'buildCity'
          : placeMode
            ? boardExtensions.placeModeAction(placeMode) // expansion build card (ui/expansions.ts)
            : null;
  return buildType ? mine.filter((a) => a.type === buildType) : [];
}

/** Board highlights for a set of board actions (`{}` when there are none). */
export function highlightsFor(actions: readonly Action[], color?: string): Highlights {
  const vertices: VertexId[] = [];
  const edges: EdgeId[] = [];
  const hexes: HexId[] = [];
  for (const a of actions) {
    const at = locationOf(a);
    if (at?.kind === 'vertex') vertices.push(at.id);
    else if (at?.kind === 'edge') edges.push(at.id);
    else if (at?.kind === 'hex') hexes.push(at.id);
  }
  if (vertices.length + edges.length + hexes.length === 0) return {};
  return { vertices, edges, hexes, ...(color ? { color } : {}) };
}

export type BoardClick =
  { kind: 'vertex'; id: VertexId } | { kind: 'edge'; id: EdgeId } | { kind: 'hex'; id: HexId };

/** The board location an action targets (its `vertex`, `edge` or `hex` field), or null. */
export function locationOf(a: Action): BoardClick | null {
  if ('vertex' in a && typeof a.vertex === 'string') return { kind: 'vertex', id: a.vertex };
  if ('edge' in a && typeof a.edge === 'string') return { kind: 'edge', id: a.edge };
  if ('hex' in a && typeof a.hex === 'string') return { kind: 'hex', id: a.hex };
  return null;
}

/** The board action matching a click, or undefined when the click means nothing right now. */
export function actionForClick(actions: readonly Action[], click: BoardClick): Action | undefined {
  return actions.find((a) => {
    const at = locationOf(a);
    return at !== null && at.kind === click.kind && at.id === click.id;
  });
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

/** Log entries `next` appended after `prev`'s newest one (the engine trims old entries). */
function appendedLog(prev: GameState, next: GameState): GameState['log'] {
  const last = prev.log[prev.log.length - 1];
  if (!last) return next.log;
  for (let i = next.log.length - 1; i >= 0; i--) {
    const e = next.log[i];
    if (e && e.turn === last.turn && e.player === last.player && e.text === last.text) {
      return next.log.slice(i + 1);
    }
  }
  return next.log;
}

/**
 * What `viewer` should be told when a trade offer they took part in ended between two states:
 * withdrawn (by the offerer or their timeout), rejected by everyone, or done with someone. Null
 * when no offer ended, `viewer` was not part of it, or `viewer` closed it themselves (`ownClose`:
 * their last move was the cancel / confirm / reject that ended it).
 */
export function tradeEndNotice(
  prev: GameState,
  next: GameState,
  viewer: PlayerId,
  ownClose = false,
): string | null {
  if (prev.phase.kind !== 'trade') return null;
  const offer = prev.phase.offer;
  const sameOffer =
    next.phase.kind === 'trade' &&
    next.turn.number === prev.turn.number &&
    next.turn.tradeOffers === prev.turn.tradeOffers;
  if (sameOffer) return null;
  const mine = offer.from === viewer;
  const answer = offer.responses[viewer] ?? null;
  if (!mine && answer === null) return null;
  const offerer = prev.players[offer.from]?.name ?? 'The offerer';
  const end = appendedLog(prev, next).find(
    (e) =>
      /withdrew the offer$/.test(e.text) ||
      e.text === 'Everyone rejected the offer' ||
      / traded .* to .* for /.test(e.text),
  );
  if (ownClose) return null;
  if (!end) return mine ? 'Your trade offer closed' : `${offerer}'s trade offer closed`;
  if (end.text.endsWith('withdrew the offer')) {
    if (mine) return 'Your trade offer was withdrawn';
    return answer === 'accepted'
      ? `${offerer} withdrew the offer you accepted`
      : `${offerer} withdrew the offer`;
  }
  if (end.text === 'Everyone rejected the offer')
    return mine ? 'Everyone rejected your offer' : null;
  // A completed trade: tell the partner, and an accepter who was not picked.
  if (mine || end.player === viewer) return null;
  const partner = prev.players.find((p) => end.text.includes(` to ${p.name} for `));
  if (partner?.id === viewer) return `Trade done: ${end.text}`;
  return answer === 'accepted' ? `${offerer} traded with ${partner?.name ?? 'someone else'}` : null;
}

/** Nobody can move but the game is not over: the controller reports this instead of hanging. */
export function isStalled(state: GameState, legal: readonly Action[]): boolean {
  return state.phase.kind !== 'gameOver' && legal.length === 0;
}
