/**
 * Sound effects (A1): which sounds one state change makes, for one screen. `soundCues` is a pure
 * mapping from (prev, next, seats) to cues, read from public state only (pieces, robber,
 * awards, phase, the log), so hotseat states and online views sound the same. `GameSounds` is
 * the one place both controllers feed: it keeps the previous state, rate-limits and plays.
 */
import type { GameState, LogEntry, PlayerId } from '../engine';
import {
  LEVEL_GAIN,
  SoundLimiter,
  coalesce,
  type CueContext,
  type CueLevel,
  type ExtensionSounds,
  type SoundCue,
} from '../audio';

/** Who sits where, as seen from this screen. */
export interface SoundSeats {
  /** The seat this screen shows (null = spectator). */
  viewer: PlayerId | null;
  /** Seats played on this screen: hotseat humans, or the own seat online. */
  local: readonly boolean[];
  /** Seats a bot plays. */
  bots: readonly boolean[];
}

/** What the controllers call (GameController, NetGameController, OnlineApp). */
export interface SoundObserver {
  /** After every render of a state / view. */
  observe(state: GameState, seats: SoundSeats): void;
  /** Turn timer between renders: seconds left (null = none), and whether it is this screen's clock. */
  timer(remainingSec: number | null, mine: boolean): void;
  /** A one-off cue outside the game state (chat). */
  cue(id: string, level?: CueLevel): void;
}

export type ExtSounds = ExtensionSounds<GameState>;

/** The timer ticks for the last TIMER_WARN_SEC seconds, urgent for the last TIMER_URGENT_SEC. */
export const TIMER_WARN_SEC = 10;
export const TIMER_URGENT_SEC = 3;

export function cueContext(seats: SoundSeats): CueContext {
  const isLocal = (p: number) => seats.local[p] === true;
  return {
    viewer: seats.viewer,
    isLocal,
    levelOf: (actor) => {
      if (actor === null) return 'normal';
      if (isLocal(actor)) return 'high';
      return seats.bots[actor] === true ? 'low' : 'normal';
    },
  };
}

/**
 * Log entries `next` appended after `prev`. Untrimmed logs extend in place (the newest line may
 * have been extended, e.g. a C&K commodity trade); once the engine trims old entries, anchor on
 * the newest unchanged line. No anchor = [] (never a burst of old entries).
 */
export function newLogEntries(prev: readonly LogEntry[], next: readonly LogEntry[]): LogEntry[] {
  const n = prev.length;
  if (n === 0) return [...next];
  const eq = (a: LogEntry | undefined, b: LogEntry | undefined) =>
    !!a && !!b && a.turn === b.turn && a.player === b.player && a.text === b.text;
  const head = next[n - 1];
  const tail = prev[n - 1];
  if (
    next.length >= n &&
    eq(next[0], prev[0]) &&
    head?.turn === tail?.turn &&
    head?.player === tail?.player
  ) {
    return next.slice(n);
  }
  for (const k of [1, 2]) {
    const anchor = prev[n - k];
    for (let i = next.length - 1; i >= 0; i--) {
      if (eq(next[i], anchor)) return next.slice(i + k);
    }
  }
  return [];
}

/** Same game, moved forward (a new game or a reload starts without sounds). */
function sameGame(prev: GameState, next: GameState): boolean {
  return (
    prev.settings.seed === next.settings.seed &&
    prev.settings.mode === next.settings.mode &&
    prev.players.length === next.players.length &&
    next.turn.number >= prev.turn.number
  );
}

/** The player named right after `marker` in `text` (longest name first: "Ann" vs "Anna"). */
function namedAfter(state: GameState, text: string, marker: string): PlayerId | null {
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const rest = text.slice(at + marker.length);
  const byLength = [...state.players].sort((a, b) => b.name.length - a.name.length);
  return byLength.find((p) => rest.startsWith(p.name))?.id ?? null;
}

const loudest = (...levels: CueLevel[]): CueLevel =>
  levels.includes('high') ? 'high' : levels.includes('normal') ? 'normal' : 'low';

/**
 * The cues of one state change as seen from `seats`, most important first, one per id. Empty
 * for the first state, an unchanged state or a different game. Module hooks (`ext`) add theirs.
 */
export function soundCues(
  prev: GameState | null,
  next: GameState,
  seats: SoundSeats,
  ext: readonly ExtSounds[] = [],
): SoundCue[] {
  if (!prev || prev === next || !sameGame(prev, next)) return [];
  const ctx = cueContext(seats);
  const { isLocal, levelOf } = ctx;
  const anyLocal = seats.local.some(Boolean);
  const cues: SoundCue[] = [];
  const add = (id: string, level: CueLevel) => cues.push({ id, level });
  const fresh = newLogEntries(prev.log, next.log);

  // Game over.
  if (next.winner !== null && prev.winner === null) {
    if (isLocal(next.winner)) add('victory', 'high');
    else add(anyLocal ? 'defeat' : 'victory', anyLocal ? 'high' : 'normal');
  }

  // Your turn (incl. setup placements and special build steps).
  const cur = next.turn.current;
  const turnMoved = cur !== prev.turn.current || next.turn.number !== prev.turn.number;
  if (turnMoved && isLocal(cur) && next.phase.kind !== 'gameOver') add('yourTurn', 'high');

  // A trade offer addressed to someone on this screen.
  if (next.phase.kind === 'trade') {
    const offer = next.phase.offer;
    const isNew =
      prev.phase.kind !== 'trade' ||
      prev.turn.tradeOffers !== next.turn.tradeOffers ||
      prev.turn.number !== next.turn.number;
    const toLocal = offer.responses.some(
      (r, p) => r === 'pending' && p !== offer.from && isLocal(p),
    );
    if (isNew && toLocal) add('tradeOffer', 'high');
  }

  // Replies to an offer made on this screen.
  const offerer =
    prev.phase.kind === 'trade'
      ? prev.phase.offer.from
      : next.phase.kind === 'trade'
        ? next.phase.offer.from
        : null;
  if (offerer !== null && isLocal(offerer)) {
    for (const e of fresh) {
      if (e.player === offerer) continue;
      if (e.text.endsWith(' accepted the offer')) add('tradeAccept', 'high');
      else if (e.text.endsWith(' rejected the offer') || e.text === 'Everyone rejected the offer') {
        add('tradeReject', 'high');
      }
    }
  }

  // Rolls: a 7 is prominent when you rolled it or must discard.
  for (const e of fresh) {
    const m = / rolled (\d+)(?: \(|$)/.exec(e.text);
    if (!m) continue;
    add('dice', levelOf(e.player));
    if (m[1] === '7') {
      const pending = next.phase.kind === 'discard' ? next.phase.pending : [];
      const mustDiscard = pending.some((n, p) => n > 0 && isLocal(p));
      add('seven', mustDiscard || (e.player !== null && isLocal(e.player)) ? 'high' : 'normal');
    }
  }

  for (const e of fresh) {
    const actor = levelOf(e.player);
    if (e.text.includes(' stole from ')) {
      const victim = namedAfter(next, e.text, ' stole from ');
      add('steal', victim !== null && isLocal(victim) ? 'high' : actor);
    }
  }
  if (next.robber !== prev.robber) add('robber', levelOf(cur));

  // Awards: prominent when you gain or lose one.
  for (const award of ['longestRoad', 'largestArmy'] as const) {
    const to = next.awards[award];
    const from = prev.awards[award];
    if (to === null || to === from) continue;
    add(award, isLocal(to) || (from !== null && isLocal(from)) ? 'high' : 'normal');
  }

  // Pieces.
  for (const [edge, owner] of Object.entries(next.pieces.roads)) {
    if (prev.pieces.roads[edge as keyof typeof prev.pieces.roads] === undefined) {
      add('road', levelOf(owner));
    }
  }
  for (const [vertex, b] of Object.entries(next.pieces.buildings)) {
    const was = prev.pieces.buildings[vertex as keyof typeof prev.pieces.buildings];
    if (!was) add(b.kind, levelOf(b.owner));
    else if (was.kind === 'settlement' && b.kind === 'city') add('city', levelOf(b.owner));
  }

  // Cards, trades, discards.
  for (const e of fresh) {
    const actor = levelOf(e.player);
    const t = e.text;
    if (t.endsWith(' bought a development card')) add('devBuy', actor);
    else if (/ played /.test(t)) add('devPlay', actor);
    else if (t.endsWith(' with the bank')) add('trade', actor);
    else if (/ traded .* to .* for /.test(t)) {
      const partner = namedAfter(next, t, ' to ');
      add('trade', loudest(actor, partner !== null && isLocal(partner) ? 'high' : 'low'));
    } else if (/ discarded /.test(t)) add('discard', actor);
  }

  for (const x of ext) {
    try {
      cues.push(...(x.cues?.(prev, next, ctx) ?? []));
    } catch (err) {
      console.error('expansion sound hook failed', err);
    }
  }
  return coalesce(cues);
}

export interface GameSoundsOptions {
  /** Plays a recipe at a gain (SoundEngine.play). */
  play: (id: string, gain: number) => void;
  /** The active modules' sound hooks for a state (default none). */
  extensions?: (state: GameState) => readonly ExtSounds[];
  /** Milliseconds clock for the limiter (default performance.now). */
  now?: () => number;
  limiter?: SoundLimiter;
}

/** Feeds states through `soundCues` and the limiter into the player. */
export class GameSounds implements SoundObserver {
  private readonly playFn: (id: string, gain: number) => void;
  private readonly extensions: (state: GameState) => readonly ExtSounds[];
  private readonly now: () => number;
  private readonly limiter: SoundLimiter;
  private prev: GameState | null = null;
  /** Last whole second the timer ticked for (one tick per second). */
  private tickedSec = -1;

  constructor(opts: GameSoundsOptions) {
    this.playFn = opts.play;
    this.extensions = opts.extensions ?? (() => []);
    this.now = opts.now ?? (() => performance.now());
    this.limiter = opts.limiter ?? new SoundLimiter();
  }

  observe(state: GameState, seats: SoundSeats): void {
    const prev = this.prev;
    this.prev = state;
    if (prev === state) return;
    this.emit(soundCues(prev, state, seats, this.extensions(state)));
  }

  timer(remainingSec: number | null, mine: boolean): void {
    const sec = remainingSec === null ? -1 : Math.ceil(remainingSec);
    if (!mine || sec < 1 || sec > TIMER_WARN_SEC) {
      this.tickedSec = -1;
      return;
    }
    if (sec === this.tickedSec) return;
    this.tickedSec = sec;
    this.emit([{ id: sec <= TIMER_URGENT_SEC ? 'timerUrgent' : 'timerWarn', level: 'high' }]);
  }

  cue(id: string, level: CueLevel = 'normal'): void {
    this.emit([{ id, level }]);
  }

  /** Forget the previous state (the next one starts silently). */
  reset(): void {
    this.prev = null;
    this.tickedSec = -1;
    this.limiter.reset();
  }

  private emit(cues: readonly SoundCue[]): void {
    if (cues.length === 0) return;
    for (const c of this.limiter.admit(cues, this.now())) this.playFn(c.id, LEVEL_GAIN[c.level]);
  }
}
