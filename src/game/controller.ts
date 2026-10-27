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
  restoreBanks,
  Rng,
  timerOf,
  type Action,
  type Banks,
  type GameState,
  type PlayerId,
} from '../engine';
import { createRandomBot, DEFAULT_BOT_LEVEL, type Bot, type BotLevel } from '../bots';
import { botForLevel } from '../bots/byLevel';
import type { BoardView } from '../render';
import type { Hud, NewGameConfig, PlaceMode } from '../ui';
import {
  autoSteal,
  gameConfigOf,
  isStalled,
  nextBot,
  pickViewer,
  type BoardClick,
  type Seats,
} from './logic';
import { emitGameNotice, gameNotices, type NoticeSink } from './notices';
import { SpotPicker, type SpotPromptLike } from './spotPicker';
import { saveSession, type KeyValueStore, type SavedSession } from './persist';
import { TurnRecap } from './recap';
import type { SoundObserver } from './sounds';
import {
  IDLE_CLOCK,
  bankAfterAction,
  clockView,
  flushBank,
  isExpired,
  syncBankClock,
  syncClock,
  tickClock,
  timeoutMove,
  timerSlot,
  type TurnClock,
} from './turnTimer';

export type BoardLike = Pick<BoardView, 'render' | 'setHighlights' | 'on'> &
  Partial<Pick<BoardView, 'markSince' | 'screenPos'>>;
export type HudLike = Pick<Hud, 'render' | 'on' | 'isCovered' | 'setTurnTimer'>;
export type ToastKind = 'error' | 'info';

export interface ControllerOptions {
  board: BoardLike;
  hud: HudLike;
  /** Where autosaves go; null disables persistence (dev fixtures, autoplay). */
  storage?: KeyValueStore | null;
  toast?: (message: string, kind: ToastKind) => void;
  /** Milliseconds per bot move (0 = instant). Quick reactions use `speed * FAST_FACTOR`. */
  speed?: number;
  /** One bot for every bot seat (tests); absent = each seat's level (B1, `start` opts). */
  bot?: Bot;
  /** Called after every render (main.ts re-measures the HUD to keep the board clear of it). */
  onRender?: () => void;
  /** Wall clock in ms for the game duration (UX2 stats); default Date.now. */
  wallClock?: () => number;
  /** Shows a game notice (steal, award; `notices.ts`); default: an info toast. */
  notice?: NoticeSink;
  /** The popover a click on a board spot opens (issue #28); absent = a click acts at once. */
  prompt?: SpotPromptLike | null;
  /** The "Confirm before building" setting; default on. */
  confirmBuild?: () => boolean;
  /** Sound effects (A1): told about every rendered state and the turn timer. */
  sounds?: SoundObserver;
}

export const DEFAULT_SPEED = 500;
/** Discards and trade replies are reactions, not turns: show them faster. */
export const FAST_FACTOR = 0.4;
/** Instant mode applies bot moves in batches, yielding to the browser between batches. */
const INSTANT_BATCH_MS = 12;
/** A bot may make this many player-trade offers per turn (the random bot would spam them). */
export const BOT_OFFERS_PER_TURN = 1;
/** Turn timer tick. A long gap (background tab) counts as at most MAX_TICK_MS. */
export const TIMER_TICK_MS = 250;
const MAX_TICK_MS = 1000;

/**
 * The random bot nudged to make progress instead of ending the turn at once: the Easy level,
 * and the bot of every test that drives games. Seats play their own level (B1).
 */
export const defaultBot: Bot = createRandomBot({ progressBias: 0.5 });

export class GameController {
  private readonly board: BoardLike;
  private readonly hud: HudLike;
  private readonly storage: KeyValueStore | null;
  private readonly toast: (message: string, kind: ToastKind) => void;
  private readonly bot: Bot | null;
  private readonly onRender: () => void;
  private readonly wallClock: () => number;
  private readonly notice: NoticeSink;
  private readonly sounds: SoundObserver | null;
  private speedMs: number;

  private current: GameState | null = null;
  /** The state last rendered: notices describe what changed since (null after `start`). */
  private shown: GameState | null = null;
  private readonly recap = new TurnRecap();
  private seatList: Seats = [];
  /** Bot level per seat (B1); absent entries play DEFAULT_BOT_LEVEL. */
  private levels: BotLevel[] = [];
  private legal: Action[] = [];
  private viewerId: PlayerId | null = null;
  private placeMode: PlaceMode | null = null;
  private readonly spots: SpotPicker;
  private botRng = new Rng(1);
  /** Offers made per player this turn (key `${turn}:${player}`), for BOT_OFFERS_PER_TURN. */
  private offers = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stallReported = false;
  private readonly unsubscribe: (() => void)[] = [];

  // Turn timer (settings.turnTimerSec): pure clock in turnTimer.ts, ticked here.
  private clock: TurnClock = IDLE_CLOCK;
  /** Chess clock (settings.timer): each player's bank in ms; the running one is in `clock`. */
  private banks: Banks = [];
  private clockInterval: ReturnType<typeof setInterval> | null = null;
  private clockLast = 0;
  /** Whole seconds last sent to the HUD (re-render the pill only when they change). */
  private clockShown = -1;
  /** Slot key whose timeout was announced (one toast per timeout). */
  private timedOutKey: string | null = null;
  private timeoutRng = new Rng(1);
  /** Game duration (UX2): wall-clock start, shifted on resume so time between sessions does not count; null = unknown. */
  private startedAt: number | null = null;
  /** Set once the game is over. */
  private durationMs: number | null = null;

  constructor(opts: ControllerOptions) {
    this.board = opts.board;
    this.hud = opts.hud;
    this.storage = opts.storage ?? null;
    this.toast = opts.toast ?? ((m, k) => (k === 'error' ? console.error(m) : console.info(m)));
    this.bot = opts.bot ?? null;
    this.onRender = opts.onRender ?? (() => undefined);
    this.wallClock = opts.wallClock ?? (() => Date.now());
    this.notice = opts.notice ?? ((n) => this.toast(n.text, 'info'));
    this.sounds = opts.sounds ?? null;
    this.speedMs = Math.max(0, opts.speed ?? DEFAULT_SPEED);
    const board = this.board;
    this.spots = new SpotPicker({
      prompt: opts.prompt ?? null,
      screenPos: (id) => board.screenPos?.(id) ?? null,
      confirm: opts.confirmBuild ?? (() => true),
      submit: (a) => this.dispatch(a),
      rehighlight: () => this.updateHighlights(),
    });

    this.hud.on('action', (a) => this.dispatch(a));
    this.hud.on('newGame', (cfg) => this.newGame(cfg));
    this.hud.on('placeMode', (m) => {
      this.placeMode = m;
      this.spots.close();
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
  /** Each seat's bot level (B1). */
  get botLevels(): readonly BotLevel[] {
    return this.seatList.map((_, i) => this.levels[i] ?? DEFAULT_BOT_LEVEL);
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
  /**
   * Board actions a click may lead to right now (what the board highlights): a prompt's or build
   * mode's spots, else every build-anywhere spot (a click opens the spot prompt, issue #28).
   */
  get boardActions(): Action[] {
    return this.viewerId === null
      ? []
      : this.spots.targets({ legal: this.legal, viewer: this.viewerId, placeMode: this.placeMode });
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /** Start playing `state` with the given seat controllers (index = PlayerId). */
  start(
    state: GameState,
    seats: Seats,
    opts: {
      viewer?: PlayerId | null;
      botRng?: number;
      banks?: unknown;
      /** Time already played (a resumed save); null = unknown; absent = a game starting now. */
      playedMs?: number | null;
      /** Bot level per seat (B1); absent = all DEFAULT_BOT_LEVEL. */
      botLevels?: readonly BotLevel[];
    } = {},
  ) {
    if (seats.length !== state.players.length) {
      throw new Error(`seats (${seats.length}) must match players (${state.players.length})`);
    }
    this.cancelTimer();
    this.stopClock();
    this.current = state;
    this.shown = null;
    this.recap.clear();
    this.seatList = [...seats];
    this.levels = seats.map((_, i) => opts.botLevels?.[i] ?? DEFAULT_BOT_LEVEL);
    this.viewerId = opts.viewer ?? null;
    this.placeMode = null;
    this.spots.close();
    this.offers.clear();
    this.stallReported = false;
    this.botRng = new Rng(opts.botRng ?? Rng.fromSeed(`bots:${String(state.settings.seed)}`).state);
    this.clock = IDLE_CLOCK;
    this.banks = restoreBanks(opts.banks, state.settings, state.players.length);
    this.timedOutKey = null;
    this.timeoutRng = Rng.fromSeed(`timer:${String(state.settings.seed)}`);
    const played = opts.playedMs === undefined ? 0 : opts.playedMs;
    this.startedAt = played === null ? null : this.wallClock() - played;
    this.durationMs = state.phase.kind === 'gameOver' ? played : null;
    this.refresh();
  }

  /** New game from the HUD's new-game screen. */
  newGame(cfg: NewGameConfig, extra: { vpToWin?: number } = {}): void {
    const seed = cfg.seed?.trim() || randomSeed();
    const state = createGame(gameConfigOf(cfg, seed, extra.vpToWin));
    console.info(`New game: mode=${state.settings.mode} map=${state.settings.map} seed=${seed}`);
    // Randomize Turn Order moved the players: seat p holds config player seatOrder[p].
    const order = state.settings.seatOrder ?? cfg.players.map((_, i) => i);
    this.start(
      state,
      order.map((i) => cfg.players[i]?.controller ?? 'bot'),
      { botLevels: order.map((i) => cfg.players[i]?.botLevel ?? DEFAULT_BOT_LEVEL) },
    );
  }

  resume(saved: SavedSession): void {
    this.start(saved.state, saved.seats, {
      viewer: saved.viewer,
      botRng: saved.botRng,
      banks: saved.banks,
      playedMs: saved.playedMs ?? null,
      ...(saved.botLevels ? { botLevels: saved.botLevels } : {}),
    });
  }

  /** The current session in save format (null before the first game). */
  snapshot(): SavedSession | null {
    if (!this.current) return null;
    const played =
      this.durationMs ?? (this.startedAt === null ? null : this.wallClock() - this.startedAt);
    return {
      version: 1,
      state: this.current,
      seats: [...this.seatList],
      viewer: this.viewerId,
      botRng: this.botRng.state,
      botLevels: [...this.botLevels],
      ...(timerOf(this.current.settings).kind === 'bank'
        ? { banks: flushBank(this.clock, this.banks) }
        : {}),
      ...(played === null ? {} : { playedMs: played }),
    };
  }

  setSpeed(ms: number): void {
    this.speedMs = Math.max(0, ms);
    this.cancelTimer();
    this.scheduleBot();
  }

  destroy(): void {
    this.cancelTimer();
    this.stopClock();
    this.spots.close();
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
    if (timerOf(state.settings).kind === 'bank') {
      // Chess clock: bank the running time, credit the increment of a finished turn; the next
      // refresh puts whoever is on the clock now back on it from their bank.
      ({ clock: this.clock, banks: this.banks } = bankAfterAction(
        this.clock,
        this.banks,
        state,
        result.state,
      ));
    }
    this.current = result.state;
    return true;
  }

  private click(click: BoardClick): void {
    const state = this.current;
    if (!state || this.viewerId === null) return;
    const ctx = { state, legal: this.legal, viewer: this.viewerId, placeMode: this.placeMode };
    this.spots.click(ctx, click);
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
    // #34: robbing the only player who can be robbed needs no "Steal from whom?" dialog.
    const steal =
      this.viewerId !== null && this.seatList[this.viewerId] === 'human'
        ? autoSteal(this.legal, this.viewerId)
        : null;
    if (steal && this.apply(steal)) {
      this.refresh();
      return;
    }
    this.spots.sync({ legal: this.legal, viewer: this.viewerId, placeMode: this.placeMode });
    const prev = this.shown;
    this.shown = state;
    // A bot "viewer" (all-bot game) is a spectator: no private texts.
    const reader =
      this.viewerId !== null && this.seatList[this.viewerId] === 'human' ? this.viewerId : null;
    const notices = prev ? gameNotices(prev, state, reader) : [];
    if (state.phase.kind === 'gameOver' && this.durationMs === null && this.startedAt !== null) {
      this.durationMs = this.wallClock() - this.startedAt;
    }
    this.syncClock(state);
    const turn = this.seatList[state.turn.current];
    const turnTimer = clockView(this.clock);
    this.clockShown = turnTimer ? Math.ceil(turnTimer.remainingSec) : -1;
    this.board.render(state);
    this.hud.render(state, {
      viewer: this.viewerId,
      legal: this.legal,
      isBotTurn: turn === 'bot',
      bots: this.seatList.map((s) => s === 'bot'),
      turnTimer,
      gameDurationMs: this.durationMs,
    });
    this.sounds?.observe(state, {
      viewer: this.viewerId,
      local: this.seatList.map((s) => s === 'human'),
      bots: this.seatList.map((s) => s === 'bot'),
    });
    this.updateHighlights();
    this.persist();
    this.onRender();
    for (const n of notices) {
      this.notice(n, state, reader);
      emitGameNotice(n);
    }
    // #33: your turn again: briefly mark what the others built since your last one.
    const since = this.recap.update(prev, state, reader);
    if (since) this.board.markSince?.(since);

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
    this.board.setHighlights(
      this.spots.highlights({
        state,
        legal: this.legal,
        viewer: this.viewerId,
        placeMode: this.placeMode,
      }),
    );
  }

  private persist(): void {
    const snap = this.snapshot();
    if (snap && this.storage) saveSession(this.storage, snap);
  }

  // -------------------------------------------------------------------------
  // Turn timer
  // -------------------------------------------------------------------------

  /** Who is on the clock after a state change; runs the tick only while someone is. */
  private syncClock(state: GameState): void {
    const timer = timerOf(state.settings);
    const slot =
      timer.kind === 'off' ? null : timerSlot(state, this.seatList, this.legal, this.viewerId);
    if (timer.kind === 'bank') {
      const next = syncBankClock(this.clock, this.banks, slot, timer.bankSec * 1000);
      this.clock = next.clock;
      this.banks = next.banks;
    } else {
      this.clock = syncClock(this.clock, slot, timer.kind === 'perTurn' ? timer.sec * 1000 : 0);
    }
    if (this.clock.key === null) {
      this.stopClock();
    } else if (this.clockInterval === null) {
      this.clockLast = now();
      this.clockInterval = setInterval(() => this.clockTick(), TIMER_TICK_MS);
    }
  }

  private stopClock(): void {
    if (this.clockInterval !== null) clearInterval(this.clockInterval);
    this.clockInterval = null;
  }

  /** Count down unless the hotseat cover (or the new-game screen) hides the game. */
  private clockTick(): void {
    const t = now();
    const dt = Math.min(t - this.clockLast, MAX_TICK_MS);
    this.clockLast = t;
    if (!this.current || this.clock.key === null || this.hud.isCovered()) return;
    this.clock = tickClock(this.clock, dt);
    if (isExpired(this.clock)) {
      this.timeUp();
      return;
    }
    const view = clockView(this.clock);
    const shown = view ? Math.ceil(view.remainingSec) : -1;
    if (shown !== this.clockShown) {
      this.clockShown = shown;
      this.hud.setTurnTimer(view);
      // Bots are never timed: the clock is always a human's on this screen.
      this.sounds?.timer(view ? view.remainingSec : null, true);
    }
  }

  /**
   * Time is up: make one minimum move for the player on the clock. The slot usually stays
   * expired (e.g. after rolling), so the next ticks keep going until the turn has passed.
   */
  private timeUp(): void {
    const state = this.current;
    const player = this.clock.player;
    if (!state || player === null) return;
    const action = timeoutMove(state, this.legal, player, this.timeoutRng);
    if (!action) {
      // Nothing to do after all: forget the slot (it restarts if it comes back).
      this.clock = IDLE_CLOCK;
      return;
    }
    if (this.timedOutKey !== this.clock.key) {
      this.timedOutKey = this.clock.key;
      this.toast(`${state.players[player]?.name ?? 'Player'} ran out of time`, 'info');
    }
    this.dispatch(action);
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
    const bot = this.bot ?? botForLevel(this.levels[next.player]);
    const action = bot(state, next.player, this.botRng, this.botOptions(state, next.player));
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
