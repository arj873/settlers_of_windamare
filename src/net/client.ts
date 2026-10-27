/**
 * RoomClient: the browser side of the room protocol (docs/MULTIPLAYER.md), without any DOM.
 * Opens the transport, says hello with the stored token, keeps the latest room / game / chat,
 * reconnects with exponential backoff, pings to keep the socket alive, and stops for good on the
 * fatal close codes (4000-4004). The UI subscribes to its events and sends through it.
 */
import type { Action, GameView, PlayerId } from '../engine';
import {
  CLOSE_CODES,
  FATAL_ERRORS,
  LIMITS,
  PING,
  PONG,
  PROTOCOL_VERSION,
  parseServerMessage,
  type ChatEntry,
  type ClientMessage,
  type ErrorCode,
  type MemberId,
  type MemberInfo,
  type Reaction,
  type RoomConfig,
  type RoomInfo,
  type ServerMessage,
  type TimerInfo,
} from './protocol';
import type { AvatarRef, PieceStyleId } from '../ui/profile/model';
import {
  tokenKey,
  type Clock,
  type Connect,
  type KeyStore,
  type TimerHandle,
  type Transport,
} from './transport';

/**
 * connecting: first attempt, nothing received yet. open: welcomed. reconnecting: lost the
 * connection, retrying. closed: stopped (we left, or a fatal error; see `fatal`).
 */
export type ClientStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface GameSnapshot {
  seq: number;
  view: GameView;
  legal: Action[];
  timer: TimerInfo | null;
  /** UX2: game over only — how long the game lasted (room clock). */
  durationMs?: number;
  /** clock.now() when the message arrived (the timer counts down from here). */
  receivedAt: number;
}

export type ClientEvent =
  | { type: 'status'; status: ClientStatus }
  | { type: 'room'; room: RoomInfo }
  | { type: 'game'; game: GameSnapshot }
  | { type: 'chat'; entry: ChatEntry }
  | { type: 'reaction'; member: MemberId; seat: PlayerId | null; reaction: Reaction }
  /** PR1: new uploaded pictures arrived (`avatarOf` resolves them now). */
  | { type: 'avatars' }
  | { type: 'error'; code: ErrorCode; message: string; ref?: string };

/** PR1: the cosmetic profile sent after the first welcome (and by `setProfile`). */
export interface ClientProfile {
  avatar: AvatarRef | null;
  pieceStyle: PieceStyleId;
}

export interface Backoff {
  baseMs: number;
  maxMs: number;
  factor: number;
}

export interface RoomClientOptions {
  roomId: string;
  connect: Connect;
  clock: Clock;
  /** Reconnect tokens (`catan.mp.token.<roomId>`). null = remember nothing. */
  store?: KeyStore | null;
  /** Nickname sent in hello. */
  name?: string;
  /** PR1: picture and piece style, sent once welcomed. */
  profile?: ClientProfile;
  backoff?: Partial<Backoff>;
  /** 0..1, spreads reconnects of many clients (default: no jitter). */
  random?: () => number;
  /** Keep-alive ping interval (0 = off). */
  pingMs?: number;
  /** Nothing received for this long while open: assume the socket is dead and reconnect. */
  deadMs?: number;
}

export const DEFAULT_BACKOFF: Backoff = { baseMs: 500, maxMs: 15_000, factor: 2 };
export const PING_MS = 25_000;
export const DEAD_MS = 60_000;

/** Close codes after which we never reconnect (docs/MULTIPLAYER.md §14). */
const FATAL_BY_CLOSE = new Map<number, ErrorCode>(
  Object.entries(CLOSE_CODES).map(([code, n]) => [n, code as ErrorCode]),
);

/** Delay before reconnect attempt `attempt` (1-based), without jitter. */
export function backoffDelay(attempt: number, b: Backoff = DEFAULT_BACKOFF): number {
  return Math.min(b.maxMs, b.baseMs * b.factor ** Math.max(0, attempt - 1));
}

type Body = ClientMessage extends infer M
  ? M extends ClientMessage
    ? Omit<M, 'v'>
    : never
  : never;

export class RoomClient {
  readonly roomId: string;
  private readonly opts: RoomClientOptions;
  private readonly backoff: Backoff;
  private readonly listeners = new Set<(e: ClientEvent) => void>();

  private transport: Transport | null = null;
  /** Bumped per transport so callbacks of an old socket are ignored. */
  private generation = 0;
  private statusValue: ClientStatus = 'connecting';
  private started = false;
  private attempt = 0;
  private retryTimer: TimerHandle | null = null;
  private pingTimer: TimerHandle | null = null;
  private lastFrameAt = 0;
  private name: string | undefined;
  private profile: ClientProfile | undefined;
  /** The server has our profile (sent after a welcome; it keeps it across reconnects). */
  private profileSent = false;
  /** Uploaded pictures by `img:` key (MemberInfo.avatar). */
  private readonly images = new Map<string, string>();

  private youValue: { member: MemberId; token: string } | null = null;
  private roomValue: RoomInfo | null = null;
  private gameValue: GameSnapshot | null = null;
  private chatValue: ChatEntry[] = [];
  private fatalValue: { code: ErrorCode; message: string } | null = null;
  /** Reconnect attempts since the last welcome (0 while connected). */
  get attempts(): number {
    return this.attempt;
  }

  constructor(opts: RoomClientOptions) {
    this.opts = opts;
    this.roomId = opts.roomId;
    this.backoff = { ...DEFAULT_BACKOFF, ...opts.backoff };
    this.name = opts.name;
    this.profile = opts.profile;
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  get status(): ClientStatus {
    return this.statusValue;
  }
  get you(): { member: MemberId; token: string } | null {
    return this.youValue;
  }
  get room(): RoomInfo | null {
    return this.roomValue;
  }
  get game(): GameSnapshot | null {
    return this.gameValue;
  }
  get chat(): readonly ChatEntry[] {
    return this.chatValue;
  }
  /** Why the client stopped for good (kicked, replaced, room gone, version mismatch...). */
  get fatal(): { code: ErrorCode; message: string } | null {
    return this.fatalValue;
  }
  get me(): MemberInfo | null {
    const id = this.youValue?.member;
    return this.roomValue?.members.find((m) => m.id === id) ?? null;
  }
  get isHost(): boolean {
    return this.youValue !== null && this.roomValue?.host === this.youValue.member;
  }
  get mySeat(): PlayerId | null {
    return this.me?.seat ?? null;
  }

  /**
   * PR1: a member's picture as an AvatarRef (gallery id or data URL), or null (none, or an
   * upload that has not arrived yet).
   */
  avatarOf(member: MemberId | null | undefined): AvatarRef | null {
    const key = this.roomValue?.members.find((m) => m.id === member)?.avatar;
    if (key === undefined) return null;
    if (key.startsWith('img:')) return this.images.get(key) ?? null;
    return key;
  }

  /** Turn clock left at `now` (clock.now() by default), or null without a timer. */
  timerLeftMs(now = this.opts.clock.now()): number | null {
    const g = this.gameValue;
    if (!g?.timer) return null;
    return Math.max(0, g.timer.remainingMs - (now - g.receivedAt));
  }

  on(cb: (e: ClientEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (this.started) return;
    this.started = true;
    this.open();
  }

  /** Leave for good (no reconnect). */
  close(): void {
    this.cancelRetry();
    this.stopPing();
    const t = this.transport;
    this.transport = null;
    this.generation++;
    t?.close();
    this.setStatus('closed');
  }

  /** Skip the backoff wait (the banner's "Retry now", the browser coming back online). */
  retryNow(): void {
    if (this.statusValue !== 'reconnecting' || this.transport) return;
    this.cancelRetry();
    this.open();
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  /** Send a message; false when not connected (the UI says so). */
  send(body: Body): boolean {
    if (this.statusValue !== 'open' || !this.transport) return false;
    this.transport.send(JSON.stringify({ v: PROTOCOL_VERSION, ...body }));
    return true;
  }

  /** A game action, stamped with the seq of the state it was made on. */
  intent(action: Action): boolean {
    const seq = this.gameValue?.seq;
    return this.send(
      seq === undefined ? { type: 'intent', action } : { type: 'intent', action, seq },
    );
  }

  setName(name: string): boolean {
    this.name = name;
    return this.send({ type: 'setName', name });
  }

  /** PR1: change our picture / piece style (kept and re-sent if not connected yet). */
  setProfile(profile: ClientProfile): boolean {
    this.profile = profile;
    const sent = this.send({ type: 'setProfile', ...profile });
    this.profileSent ||= sent;
    return sent;
  }

  chatSend(text: string): boolean {
    const t = text.trim();
    if (t === '') return false;
    return this.send({ type: 'chat', text: t.slice(0, LIMITS.chat * 2) });
  }

  react(reaction: Reaction): boolean {
    return this.send({ type: 'react', reaction });
  }

  configure(config: RoomConfig): boolean {
    return this.send({ type: 'configure', config });
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  private open(): void {
    const gen = ++this.generation;
    const live = () => gen === this.generation;
    this.transport = this.opts.connect({
      onOpen: () => {
        if (!live()) return;
        this.lastFrameAt = this.opts.clock.now();
        const token = this.loadToken();
        const hello: Body = { type: 'hello', token };
        if (this.name) hello.name = this.name;
        this.transport?.send(JSON.stringify({ v: PROTOCOL_VERSION, ...hello }));
        this.startPing();
      },
      onMessage: (text) => {
        if (!live()) return;
        this.lastFrameAt = this.opts.clock.now();
        if (text === PONG) return;
        const parsed = parseServerMessage(text);
        if (!parsed.ok) {
          if (parsed.code === 'version_mismatch') this.fail('version_mismatch', parsed.message);
          return;
        }
        this.handle(parsed.msg);
      },
      onClose: (code, reason) => {
        if (!live()) return;
        this.transport = null;
        this.stopPing();
        const fatal = FATAL_BY_CLOSE.get(code);
        if (fatal) {
          this.fail(fatal, this.fatalValue?.message ?? reason);
          return;
        }
        if (this.fatalValue || this.statusValue === 'closed') return;
        this.scheduleRetry();
      },
    });
  }

  private scheduleRetry(): void {
    this.attempt++;
    const base = backoffDelay(this.attempt, this.backoff);
    const jitter = this.opts.random ? 0.5 + this.opts.random() * 0.5 : 1;
    this.setStatus('reconnecting');
    this.cancelRetry();
    this.retryTimer = this.opts.clock.setTimeout(
      () => {
        this.retryTimer = null;
        this.open();
      },
      Math.round(base * jitter),
    );
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) this.opts.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private startPing(): void {
    this.stopPing();
    const every = this.opts.pingMs ?? PING_MS;
    if (every <= 0) return;
    const dead = this.opts.deadMs ?? DEAD_MS;
    const beat = () => {
      this.pingTimer = this.opts.clock.setTimeout(beat, every);
      if (this.opts.clock.now() - this.lastFrameAt >= dead) {
        // Half-open socket: the browser has not noticed yet. Drop it and reconnect.
        const t = this.transport;
        this.transport = null;
        this.generation++;
        this.stopPing();
        t?.close();
        this.scheduleRetry();
        return;
      }
      this.transport?.send(PING);
    };
    this.pingTimer = this.opts.clock.setTimeout(beat, every);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) this.opts.clock.clearTimeout(this.pingTimer);
    this.pingTimer = null;
  }

  private fail(code: ErrorCode, message: string): void {
    this.fatalValue ??= { code, message };
    this.cancelRetry();
    this.stopPing();
    const t = this.transport;
    this.transport = null;
    this.generation++;
    t?.close();
    this.setStatus('closed');
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome':
        this.youValue = msg.you;
        this.saveToken(msg.you.token);
        this.chatValue = msg.chat.slice(-LIMITS.chatHistory);
        this.attempt = 0;
        this.setRoom(msg.room);
        this.setStatus('open');
        if (this.profile && !this.profileSent) this.setProfile(this.profile);
        return;
      case 'room':
        this.setRoom(msg.room);
        return;
      case 'avatars':
        for (const [key, url] of Object.entries(msg.images)) this.images.set(key, url);
        this.emit({ type: 'avatars' });
        return;
      case 'game': {
        const game: GameSnapshot = {
          seq: msg.seq,
          view: msg.view,
          legal: msg.legal,
          timer: msg.timer,
          ...(typeof msg.durationMs === 'number' ? { durationMs: msg.durationMs } : {}),
          receivedAt: this.opts.clock.now(),
        };
        this.gameValue = game;
        this.emit({ type: 'game', game });
        return;
      }
      case 'chat':
        this.chatValue = [...this.chatValue, msg.entry].slice(-LIMITS.chatHistory);
        this.emit({ type: 'chat', entry: msg.entry });
        return;
      case 'reaction':
        this.emit({
          type: 'reaction',
          member: msg.member,
          seat: msg.seat,
          reaction: msg.reaction,
        });
        return;
      case 'error':
        if (FATAL_ERRORS.includes(msg.code))
          this.fatalValue ??= { code: msg.code, message: msg.message };
        this.emit({
          type: 'error',
          code: msg.code,
          message: msg.message,
          ...(msg.ref ? { ref: msg.ref } : {}),
        });
        return;
    }
  }

  private setRoom(room: RoomInfo): void {
    this.roomValue = room;
    // Back in the lobby (rematch): the old game is gone.
    if (room.phase === 'lobby') this.gameValue = null;
    this.emit({ type: 'room', room });
  }

  private setStatus(s: ClientStatus): void {
    if (s === this.statusValue) return;
    this.statusValue = s;
    this.emit({ type: 'status', status: s });
  }

  private emit(e: ClientEvent): void {
    for (const cb of [...this.listeners]) cb(e);
  }

  private loadToken(): string | null {
    try {
      return this.opts.store?.get(tokenKey(this.roomId)) ?? null;
    } catch {
      return null;
    }
  }

  private saveToken(token: string): void {
    try {
      this.opts.store?.set(tokenKey(this.roomId), token);
    } catch {
      /* private mode: no reconnect after a reload, the session still works */
    }
  }
}
