/**
 * GameController: owns the current GameState and wires engine <-> board view <-> HUD <-> bots.
 * State only changes through `applyAction`; after every change it recomputes the legal actions,
 * picks the viewer, re-renders board + HUD, autosaves and schedules the next bot move.
 *
 * Board and HUD are injected as narrow interfaces so the whole loop runs headless in tests.
 */
import {
  applyAction,
  createGame,
  legalActions,
  Rng,
  type Action,
  type GameState,
  type PlayerId,
} from '../engine';
import { createRandomBot, type Bot } from '../bots';
import type { BoardView } from '../render';
import type { Hud, NewGameConfig, PlaceMode } from '../ui';
import {
  actionForClick,
  boardActions,
  highlightsFor,
  isStalled,
  nextBot,
  pickViewer,
  type BoardClick,
  type Seats,
} from './logic';
import { saveSession, type KeyValueStore, type SavedSession } from './persist';

export type BoardLike = Pick<BoardView, 'render' | 'setHighlights' | 'on'>;
export type HudLike = Pick<Hud, 'render' | 'on'>;
export type ToastKind = 'error' | 'info';

export interface ControllerOptions {
  board: BoardLike;
  hud: HudLike;
  /** Where autosaves go; null disables persistence (dev fixtures, autoplay). */
  storage?: KeyValueStore | null;
  toast?: (message: string, kind: ToastKind) => void;
  /** Milliseconds per bot move (0 = instant). Quick reactions use `speed * FAST_FACTOR`. */
  speed?: number;
  bot?: Bot;
  /** Called after every render (main.ts re-measures the HUD to keep the board clear of it). */
  onRender?: () => void;
}

export const DEFAULT_SPEED = 500;
/** Discards and trade replies are reactions, not turns: show them faster. */
export const FAST_FACTOR = 0.4;
/** Instant mode applies bot moves in batches, yielding to the browser between batches. */
const INSTANT_BATCH_MS = 12;
/** A bot may make this many player-trade offers per turn (the random bot would spam them). */
export const BOT_OFFERS_PER_TURN = 1;

/** The default bot: random, nudged to make progress instead of ending the turn at once. */
export const defaultBot: Bot = createRandomBot({ progressBias: 0.5 });

export class GameController {
  private readonly board: BoardLike;
  private readonly hud: HudLike;
  private readonly storage: KeyValueStore | null;
  private readonly toast: (message: string, kind: ToastKind) => void;
  private readonly bot: Bot;
  private readonly onRender: () => void;
  private speedMs: number;

  private current: GameState | null = null;
  private seatList: Seats = [];
  private legal: Action[] = [];
  private viewerId: PlayerId | null = null;
  private placeMode: PlaceMode | null = null;
  private botRng = new Rng(1);
  /** Offers made per player this turn (key `${turn}:${player}`), for BOT_OFFERS_PER_TURN. */
  private offers = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stallReported = false;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(opts: ControllerOptions) {
    this.board = opts.board;
    this.hud = opts.hud;
    this.storage = opts.storage ?? null;
    this.toast = opts.toast ?? ((m, k) => (k === 'error' ? console.error(m) : console.info(m)));
    this.bot = opts.bot ?? defaultBot;
    this.onRender = opts.onRender ?? (() => undefined);
    this.speedMs = Math.max(0, opts.speed ?? DEFAULT_SPEED);

    this.hud.on('action', (a) => this.dispatch(a));
    this.hud.on('newGame', (cfg) => this.newGame(cfg));
    this.hud.on('placeMode', (m) => {
      this.placeMode = m;
      this.updateHighlights();
    });
    this.unsubscribe.push(
      this.board.on('vertexClick', (id) => this.click({ kind: 'vertex', id })),
      this.board.on('edgeClick', (id) => this.click({ kind: 'edge', id })),
      this.board.on('hexClick', (id) => this.click({ kind: 'hex', id })),
    );
  }

  // -------------------------------------------------------------------------
  // Read-only accessors
  // -------------------------------------------------------------------------

  get state(): GameState | null {
    return this.current;
  }
  get seats(): Seats {
    return this.seatList;
  }
  get viewer(): PlayerId | null {
    return this.viewerId;
  }
  get speed(): number {
    return this.speedMs;
  }
  /** Legal actions for everyone in the current state. */
  get legalActions(): readonly Action[] {
    return this.legal;
  }
  /** Board actions a click may submit right now (what the board highlights). */
  get boardActions(): Action[] {
    return this.viewerId === null ? [] : boardActions(this.legal, this.viewerId, this.placeMode);
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /** Start playing `state` with the given seat controllers (index = PlayerId). */
  start(state: GameState, seats: Seats, opts: { viewer?: PlayerId | null; botRng?: number } = {}) {
    if (seats.length !== state.players.length) {
      throw new Error(`seats (${seats.length}) must match players (${state.players.length})`);
    }
    this.cancelTimer();
    this.current = state;
    this.seatList = [...seats];
    this.viewerId = opts.viewer ?? null;
    this.placeMode = null;
    this.offers.clear();
    this.stallReported = false;
    this.botRng = new Rng(opts.botRng ?? Rng.fromSeed(`bots:${String(state.settings.seed)}`).state);
    this.refresh();
  }

  /** New game from the HUD's new-game screen. */
  newGame(cfg: NewGameConfig, extra: { vpToWin?: number } = {}): void {
    const seed = cfg.seed?.trim() || randomSeed();
    const state = createGame({
      seed,
      players: cfg.players.map((p) => ({ name: p.name, color: p.color })),
      // T14 wires the rest of the setup config (maps, rules, timer); until then only the
      // base map pair exists in the engine.
      layout: cfg.map === 'base' ? 'beginner' : 'random',
      ...(extra.vpToWin === undefined ? {} : { vpToWin: extra.vpToWin }),
    });
    console.info(`New game: map=${cfg.map} seed=${seed}`);
    this.start(
      state,
      cfg.players.map((p) => p.controller),
    );
  }

  resume(saved: SavedSession): void {
    this.start(saved.state, saved.seats, { viewer: saved.viewer, botRng: saved.botRng });
  }

  /** The current session in save format (null before the first game). */
  snapshot(): SavedSession | null {
    if (!this.current) return null;
    return {
      version: 1,
      state: this.current,
      seats: [...this.seatList],
      viewer: this.viewerId,
      botRng: this.botRng.state,
    };
  }

  setSpeed(ms: number): void {
    this.speedMs = Math.max(0, ms);
    this.cancelTimer();
    this.scheduleBot();
  }

  destroy(): void {
    this.cancelTimer();
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
    this.current = null;
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /** Apply an action from the UI, the board or a bot. Rejections show a toast (and change nothing). */
  dispatch(action: Action): boolean {
    if (!this.apply(action)) return false;
    this.refresh();
    return true;
  }

  private apply(action: Action): boolean {
    const state = this.current;
    if (!state) return false;
    const result = applyAction(state, action);
    if (!result.ok) {
      this.toast(`Action rejected (${action.type}): ${result.error}`, 'error');
      console.error('rejected action', action, result.error);
      return false;
    }
    if (action.type === 'offerTrade') {
      const key = `${state.turn.number}:${action.player}`;
      this.offers.set(key, (this.offers.get(key) ?? 0) + 1);
    }
    if (action.type === 'endTurn') this.offers.clear();
    this.current = result.state;
    return true;
  }

  private click(click: BoardClick): void {
    const action = actionForClick(this.boardActions, click);
    if (action) this.dispatch(action);
  }

  // -------------------------------------------------------------------------
  // Render loop
  // -------------------------------------------------------------------------

  /** Recompute everything derived from the state, render, autosave, schedule bots. */
  private refresh(): void {
    const state = this.current;
    if (!state) return;
    this.legal = legalActions(state);
    this.viewerId = pickViewer(state, this.seatList, this.legal, this.viewerId);
    const turn = this.seatList[state.turn.current];
    this.board.render(state);
    this.hud.render(state, {
      viewer: this.viewerId,
      legal: this.legal,
      isBotTurn: turn === 'bot',
      bots: this.seatList.map((s) => s === 'bot'),
    });
    this.updateHighlights();
    this.persist();
    this.onRender();

    if (isStalled(state, this.legal)) {
      if (!this.stallReported) {
        this.stallReported = true;
        this.toast(`Game stalled: nobody can act in phase "${state.phase.kind}"`, 'error');
        console.error('stalled state', JSON.parse(JSON.stringify(state)));
      }
      return;
    }
    this.scheduleBot();
  }

  private updateHighlights(): void {
    const state = this.current;
    if (!state || this.viewerId === null) {
      this.board.setHighlights({});
      return;
    }
    const color = state.players[this.viewerId]?.color;
    this.board.setHighlights(highlightsFor(this.boardActions, color));
  }

  private persist(): void {
    const snap = this.snapshot();
    if (snap && this.storage) saveSession(this.storage, snap);
  }

  // -------------------------------------------------------------------------
  // Bots
  // -------------------------------------------------------------------------

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleBot(): void {
    const state = this.current;
    if (!state || this.timer !== null) return;
    const next = nextBot(state, this.seatList, this.legal);
    if (!next) return;
    const delay = this.speedMs === 0 ? 0 : Math.round(this.speedMs * (next.fast ? FAST_FACTOR : 1));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.botTick();
    }, delay);
  }

  /** One bot move (or, at speed 0, as many as fit in a short time slice), then one render. */
  private botTick(): void {
    const deadline = this.speedMs === 0 ? now() + INSTANT_BATCH_MS : -Infinity;
    let moved = false;
    for (;;) {
      if (!this.botMove()) break;
      moved = true;
      if (now() >= deadline) break;
      // Recompute for the next move in this batch without rendering.
      const state = this.current;
      if (!state) break;
      this.legal = legalActions(state);
      if (!nextBot(state, this.seatList, this.legal)) break;
    }
    if (moved) this.refresh();
  }

  /** Let the next bot pick and apply one action. False if no bot may move. */
  private botMove(): boolean {
    const state = this.current;
    if (!state) return false;
    const next = nextBot(state, this.seatList, this.legal);
    if (!next) return false;
    const action = this.bot(state, next.player, this.botRng, this.botOptions(state, next.player));
    if (!action) {
      this.toast(`Bot ${state.players[next.player]?.name ?? next.player} found no move`, 'error');
      return false;
    }
    return this.apply(action);
  }

  /** Legal actions offered to a bot: its own, minus player trades once it used its offers. */
  private botOptions(state: GameState, player: PlayerId): Action[] {
    const own = this.legal.filter((a) => a.player === player);
    const used = this.offers.get(`${state.turn.number}:${player}`) ?? 0;
    if (used < BOT_OFFERS_PER_TURN) return own;
    const rest = own.filter((a) => a.type !== 'offerTrade');
    return rest.length > 0 ? rest : own;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function randomSeed(): string {
  return Math.floor(Math.random() * 1e9).toString(36);
}
