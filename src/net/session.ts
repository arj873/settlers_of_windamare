/**
 * GameSession: one online room, transport-agnostic (docs/MULTIPLAYER.md §4). It owns the full
 * GameState, the lobby (members, seats, host), the turn clock, the server-side bots and the chat
 * log. The Durable Object (M2) feeds it socket events and the current time and sends back what
 * it returns; tests and the in-memory client harness (M3) drive it directly.
 *
 *   open(conn, now)            a socket connected (nothing is sent until `hello`)
 *   receive(conn, raw, now)    one client frame (JSON string or parsed value)
 *   close(conn, now)           the socket closed
 *   tick(now)                  time passed: bot moves, turn timeouts, grace periods
 *   nextWakeAt()               when `tick` must run next (Durable Object alarm), or null
 *   snapshot() / restore()     JSON-safe persistence (Durable Object storage)
 *
 * Pure TS: no timers, no clocks, no ambient randomness. Time comes in as `now` (ms); secrets and
 * seeds come from `deps`. Every method returns the Outbound list to deliver, in order.
 */
import {
  applyAction,
  createGame,
  initialBanks,
  legalActions,
  restoreBanks,
  Rng,
  timerOf,
  upgradeState,
  viewFor,
  type Action,
  type GameState,
  type PlayerId,
  type RngState,
} from '../engine';
import type { Bot } from '../bots';
import { botForLevel } from '../bots/byLevel';
import type { BotLevel } from '../bots/levels';
import { BOT_OFFERS_PER_TURN, FAST_FACTOR } from '../game/controller';
import { gameConfigOf, nextBot, type Seats } from '../game/logic';
import {
  IDLE_CLOCK,
  bankAfterAction,
  isExpired,
  syncBankClock,
  syncClock,
  tickClock,
  timeoutMove,
  timerSlot,
  type TurnClock,
} from '../game/turnTimer';
import type { NewGameConfig, SeatConfig } from '../ui/types';
import { SEAT_COLORS } from '../ui/setup/model';
import { isImageAvatar, type AvatarRef, type PieceStyleId } from '../ui/profile/model';
import {
  CLOSE_CODES,
  cleanText,
  DEFAULT_ROOM_CONFIG,
  FATAL_ERRORS,
  LIMITS,
  parseClientMessage,
  PROTOCOL_VERSION,
  RATE_LIMITS,
  ROOM_COLORS,
  grownConfig,
  type ChatEntry,
  type ClientMessage,
  type ErrorCode,
  type MemberId,
  type RateKind,
  type RoomConfig,
  type RoomInfo,
  type RoomPhase,
  type SeatStatus,
  type ServerMessage,
  type TimerInfo,
} from './protocol';

/** Transport connection id (the Durable Object keeps it in the socket attachment). */
export type ConnId = string;

export type Outbound =
  | { kind: 'send'; conn: ConnId; msg: ServerMessage }
  | { kind: 'close'; conn: ConnId; code: number; reason: string };

export interface SessionDeps {
  /** A fresh unguessable secret, >= 128 bits, [A-Za-z0-9_-]{16,128} (crypto.randomUUID() fits). */
  token(): string;
  /** A fresh game seed (any string; never shown to players). */
  seed(): string;
}

export interface SessionOptions {
  /** A disconnected player keeps their seat (and their turn clock) this long; then a bot plays. */
  graceMs: number;
  /** Delay before a bot's move, so people can follow it. Reactions use FAST_FACTOR of it. */
  botDelayMs: number;
  /** After a timeout, one minimum move every this many ms until the slot is over. */
  timeoutStepMs: number;
  /** The room expires this long after its last member disconnected. */
  idleExpiryMs: number;
  /** One bot for every seat (tests); absent = each seat's level (SeatInfo.botLevel, B1). */
  bot?: Bot;
}

export const DEFAULT_SESSION_OPTIONS: SessionOptions = {
  graceMs: 60_000,
  botDelayMs: 900,
  timeoutStepMs: 400,
  idleExpiryMs: 24 * 3600_000,
};

/** Safety cap on moves per call (bots with zero delay, timeouts). */
const MAX_STEPS_PER_CALL = 5000;

interface Bucket {
  tokens: number;
  at: number;
}

interface MemberRec {
  id: MemberId;
  token: string;
  name: string;
  joinedAt: number;
  conn: ConnId | null;
  /** When the member's socket closed (set at creation too); null while connected. */
  leftAt: number | null;
  buckets: Partial<Record<RateKind, Bucket>>;
  /** PR1 profile (absent in older snapshots): picture (AvatarRef) and piece style. */
  avatar?: AvatarRef;
  /** Bumped on every uploaded picture, so its `img:` key never names two pictures. */
  avatarRev?: number;
  pieceStyle?: PieceStyleId;
}

interface SeatRec {
  color: string;
  occupant: MemberId | null;
  status: SeatStatus;
  /** Absent = DEFAULT_BOT_LEVEL (older snapshots too). */
  botLevel?: BotLevel;
}

interface GameRec {
  state: GameState;
  seq: number;
  /** Bot and timeout RNG states; a plain number in snapshots from before schema v6. */
  botRng: RngState | number;
  timeoutRng: RngState | number;
  clock: TurnClock;
  /** Time the clock was last advanced to. */
  clockAt: number;
  botDueAt: number | null;
  /** Next timeout move while the clock is expired (null = right away). */
  timeoutDueAt: number | null;
  timedOutKey: string | null;
  /** Player-trade offers per `${turn}:${player}` (bots get BOT_OFFERS_PER_TURN). */
  offers: Record<string, number>;
  /** Chess clock (settings.timer) only: each player's bank in ms (engine clock.ts). */
  banks?: number[];
  /** UX2: room clock at `start` and at game over (absent in older snapshots). */
  startedAt?: number;
  endedAt?: number;
}

/** Everything a room needs to survive a Durable Object restart. JSON-safe. */
export interface SessionSnapshot {
  version: 1;
  roomId: string;
  createdAt: number;
  phase: RoomPhase;
  host: MemberId | null;
  config: RoomConfig;
  seats: SeatRec[];
  members: MemberRec[];
  nextMember: number;
  chat: ChatEntry[];
  nextChat: number;
  game: GameRec | null;
  /** Open connections -> member (null before `hello`). */
  conns: Record<ConnId, MemberId | null>;
  /** Last time a member was connected (room expiry). */
  lastActiveAt: number;
}

export class GameSession {
  private readonly d: SessionSnapshot;
  private readonly deps: SessionDeps;
  private readonly opts: SessionOptions;

  // Per call (not persisted).
  private now = 0;
  private out: Outbound[] = [];
  private roomDirty = false;
  private gameDirty = false;
  private gameFor = new Set<ConnId>();
  private legalCache: Action[] | null = null;

  private constructor(d: SessionSnapshot, deps: SessionDeps, opts: Partial<SessionOptions>) {
    this.d = d;
    this.deps = deps;
    this.opts = { ...DEFAULT_SESSION_OPTIONS, ...opts };
  }

  /** A new room. The host token goes back to the creator (HTTP response), who sends it in hello. */
  static create(
    roomId: string,
    now: number,
    deps: SessionDeps,
    opts: Partial<SessionOptions> = {},
  ): { session: GameSession; hostToken: string } {
    const host: MemberRec = {
      id: 'm1',
      token: deps.token(),
      name: '',
      joinedAt: now,
      conn: null,
      leftAt: now,
      buckets: {},
    };
    const config = DEFAULT_ROOM_CONFIG;
    const session = new GameSession(
      {
        version: 1,
        roomId,
        createdAt: now,
        phase: 'lobby',
        host: host.id,
        config,
        seats: freshSeats(config.seatCount),
        members: [host],
        nextMember: 2,
        chat: [],
        nextChat: 1,
        game: null,
        conns: {},
        lastActiveAt: now,
      },
      deps,
      opts,
    );
    return { session, hostToken: host.token };
  }

  static restore(
    snapshot: SessionSnapshot,
    deps: SessionDeps,
    opts: Partial<SessionOptions> = {},
  ): GameSession {
    if (snapshot.version !== 1) throw new Error(`unknown session snapshot v${snapshot.version}`);
    const d = structuredClone(snapshot);
    // A game stored before schema v6 holds a v5 state (uint32 rng): upgrade it like a save.
    if (d.game) {
      const state = upgradeState(d.game.state);
      if (!state) throw new Error('session snapshot holds an unreadable game state');
      d.game.state = state;
    }
    return new GameSession(d, deps, opts);
  }

  snapshot(): SessionSnapshot {
    return structuredClone(this.d);
  }

  // -------------------------------------------------------------------------
  // Read-only accessors (server logs, tests)
  // -------------------------------------------------------------------------

  get roomId(): string {
    return this.d.roomId;
  }
  get phase(): RoomPhase {
    return this.d.phase;
  }
  /** The full, unmasked state. Never send it to a client. */
  get state(): GameState | null {
    return this.d.game?.state ?? null;
  }
  get seq(): number {
    return this.d.game?.seq ?? 0;
  }
  room(): RoomInfo {
    return {
      id: this.d.roomId,
      phase: this.d.phase,
      host: this.d.host,
      config: this.d.config,
      seats: this.d.seats.map((s, index) => ({
        index,
        color: s.color,
        occupant: s.occupant,
        status: s.status,
        ...(s.botLevel === undefined ? {} : { botLevel: s.botLevel }),
      })),
      members: this.d.members.map((m) => ({
        id: m.id,
        name: m.name,
        connected: m.conn !== null,
        seat: this.seatOf(m.id),
        ...(m.avatar === undefined ? {} : { avatar: avatarKey(m) }),
        ...(m.pieceStyle === undefined ? {} : { pieceStyle: m.pieceStyle }),
      })),
    };
  }

  /** No member connected for `idleExpiryMs`: the Durable Object may delete the room. */
  isExpired(now: number): boolean {
    return !this.anyoneConnected() && now - this.d.lastActiveAt >= this.opts.idleExpiryMs;
  }

  /**
   * When `tick` must be called next (absolute ms, never before the last `now`), or null if
   * nothing is pending. Every call already did all work due by its `now`; what is still past
   * due cannot happen until some other event (e.g. a host handover waiting for a named member),
   * so it is left out: an alarm in the past would fire in a loop.
   */
  nextWakeAt(): number | null {
    const times: number[] = [];
    const push = (t: number) => {
      if (t > this.now) times.push(t);
    };
    for (const m of this.d.members) {
      if (m.conn !== null || m.leftAt === null) continue;
      const seat = this.seatOf(m.id);
      const seatPending =
        seat !== null &&
        (this.d.phase === 'lobby' ||
          (this.d.phase === 'playing' && this.seatRec(seat).status === 'away'));
      const hostPending = this.d.host === m.id && this.anyoneConnected();
      if (seatPending || hostPending) push(m.leftAt + this.opts.graceMs);
    }
    const g = this.d.game;
    if (g && this.d.phase === 'playing' && this.anyoneConnected()) {
      if (g.clock.key !== null) {
        push(isExpired(g.clock) ? (g.timeoutDueAt ?? g.clockAt) : g.clockAt + g.clock.remainingMs);
      }
      // Kept even when due now: a zero-delay bot that hit MAX_STEPS_PER_CALL continues next tick.
      if (g.botDueAt !== null) times.push(Math.max(g.botDueAt, this.now));
    }
    if (!this.anyoneConnected()) push(this.d.lastActiveAt + this.opts.idleExpiryMs);
    return times.length > 0 ? Math.min(...times) : null;
  }

  // -------------------------------------------------------------------------
  // Transport events
  // -------------------------------------------------------------------------

  open(conn: ConnId, now: number): Outbound[] {
    this.begin(now);
    this.d.conns[conn] ??= null;
    return this.finish();
  }

  receive(conn: ConnId, raw: unknown, now: number): Outbound[] {
    this.begin(now);
    if (!(conn in this.d.conns)) this.d.conns[conn] = null;
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.error(conn, parsed.code, parsed.message);
    } else {
      this.handle(conn, parsed.msg);
    }
    return this.finish();
  }

  close(conn: ConnId, now: number): Outbound[] {
    this.begin(now);
    this.drop(conn);
    return this.finish();
  }

  tick(now: number): Outbound[] {
    this.begin(now);
    return this.finish();
  }

  /** After a restart: forget connections the transport no longer has. */
  reconcile(live: readonly ConnId[], now: number): Outbound[] {
    this.begin(now);
    for (const conn of Object.keys(this.d.conns)) if (!live.includes(conn)) this.drop(conn);
    return this.finish();
  }

  // -------------------------------------------------------------------------
  // Call frame
  // -------------------------------------------------------------------------

  private begin(now: number): void {
    this.now = Math.max(now, this.now);
    this.out = [];
    this.roomDirty = false;
    this.gameDirty = false;
    this.gameFor.clear();
    this.advanceClock();
    if (this.anyoneConnected()) this.d.lastActiveAt = this.now;
  }

  private finish(): Outbound[] {
    this.pump();
    if (this.anyoneConnected()) this.d.lastActiveAt = this.now;
    const joined = this.joinedConns();
    if (this.roomDirty) {
      const msg: ServerMessage = { v: PROTOCOL_VERSION, type: 'room', room: this.room() };
      for (const conn of joined) this.send(conn, msg);
    }
    if (this.d.game && (this.gameDirty || this.gameFor.size > 0)) {
      for (const conn of joined) {
        if (this.gameDirty || this.gameFor.has(conn)) this.send(conn, this.gameMessage(conn));
      }
    }
    const out = this.out;
    this.out = [];
    return out;
  }

  /** Time-driven work that is due: grace periods, turn timeouts, bot moves. */
  private pump(): void {
    for (let i = 0; i < MAX_STEPS_PER_CALL; i++) {
      this.processGrace();
      const g = this.d.game;
      if (!g || this.d.phase !== 'playing' || !this.anyoneConnected()) return;
      if (isExpired(g.clock) && (g.timeoutDueAt === null || g.timeoutDueAt <= this.now)) {
        this.timeUp();
        continue;
      }
      if (g.botDueAt !== null && g.botDueAt <= this.now) {
        this.botMove();
        continue;
      }
      return;
    }
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  private handle(conn: ConnId, msg: ClientMessage): void {
    if (msg.type === 'hello') {
      this.hello(conn, msg);
      return;
    }
    const m = this.memberOfConn(conn);
    if (!m) {
      this.error(conn, 'not_joined', 'send hello first', msg.type);
      return;
    }
    const kind: RateKind =
      msg.type === 'chat' || msg.type === 'react' || msg.type === 'intent'
        ? (msg.type as RateKind)
        : msg.type === 'setProfile'
          ? 'profile'
          : 'lobby';
    if (!this.take(m, kind)) {
      this.error(conn, 'rate_limited', `too many ${kind} messages, slow down`, msg.type);
      return;
    }
    const err = this.dispatch(m, msg);
    if (err) this.error(conn, err[0], err[1], msg.type);
  }

  private dispatch(m: MemberRec, msg: Exclude<ClientMessage, { type: 'hello' }>): Failure | null {
    switch (msg.type) {
      case 'setName':
        return this.setName(m, msg.name);
      case 'setProfile':
        return this.setProfile(m, msg.avatar, msg.pieceStyle);
      case 'takeSeat':
        return this.takeSeat(m, msg.seat);
      case 'leaveSeat':
        return this.leaveSeat(m);
      case 'setColor':
        return this.setColor(m, msg.color);
      case 'setBotLevel':
        return this.setBotLevel(m, msg.seat, msg.level);
      case 'configure':
        return this.configure(m, msg.config);
      case 'kick':
        return this.kick(m, msg.member);
      case 'start':
        return this.start(m);
      case 'rematch':
        return this.rematch(m);
      case 'intent':
        return this.intent(m, msg.action, msg.seq);
      case 'chat':
        return this.chat(m, msg.text);
      case 'react':
        this.broadcast({
          v: PROTOCOL_VERSION,
          type: 'reaction',
          member: m.id,
          seat: this.seatOf(m.id),
          reaction: msg.reaction,
        });
        return null;
      case 'sync':
        if (m.conn) {
          this.send(m.conn, { v: PROTOCOL_VERSION, type: 'room', room: this.room() });
          this.gameFor.add(m.conn);
        }
        return null;
    }
  }

  private hello(conn: ConnId, msg: Extract<ClientMessage, { type: 'hello' }>): void {
    if (this.d.conns[conn]) {
      this.error(conn, 'bad_message', 'already joined', 'hello');
      return;
    }
    if (this.isExpired(this.now)) {
      this.error(conn, 'room_expired', 'this room has expired', 'hello');
      return;
    }
    let m = msg.token === null ? undefined : this.d.members.find((x) => x.token === msg.token);
    if (!m) {
      if (this.d.members.length >= LIMITS.members && !this.pruneMember()) {
        this.error(conn, 'room_full', 'this room is full', 'hello');
        return;
      }
      m = {
        id: `m${this.d.nextMember++}`,
        token: this.deps.token(),
        name: '',
        joinedAt: this.now,
        conn: null,
        leftAt: null,
        buckets: {},
      };
      this.d.members.push(m);
    }
    if (m.conn !== null && m.conn !== conn) {
      // Same member in another tab / a stale socket: the new one wins.
      const old = m.conn;
      this.error(old, 'replaced', 'opened in another tab or window');
      this.forgetConn(old);
    }
    const firstVisit = m.name === '';
    m.conn = conn;
    m.leftAt = null;
    this.d.conns[conn] = m.id;
    if (msg.name !== undefined) this.setName(m, msg.name, { announce: false });
    if (firstVisit && m.name) this.system(`${m.name} joined the room`);
    this.reclaim(m);
    this.maybeTransferHost();
    this.send(conn, {
      v: PROTOCOL_VERSION,
      type: 'welcome',
      you: { member: m.id, token: m.token },
      room: this.room(),
      chat: this.d.chat,
    });
    const images = this.images(this.d.members);
    if (Object.keys(images).length > 0) {
      this.send(conn, { v: PROTOCOL_VERSION, type: 'avatars', images });
    }
    if (this.d.game) this.gameFor.add(conn);
    this.roomDirty = true;
  }

  private setName(m: MemberRec, raw: string, opts = { announce: true }): Failure | null {
    const base = cleanText(raw, LIMITS.name);
    if (!base) return ['name_required', 'enter a name'];
    const taken = new Set(
      this.d.members.filter((x) => x.id !== m.id).map((x) => x.name.toLowerCase()),
    );
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) {
      name = `${base.slice(0, LIMITS.name - String(n).length - 1)} ${n}`;
    }
    const before = m.name;
    m.name = name;
    if (opts.announce && before === '') this.system(`${name} joined the room`);
    if (before === '') this.autoSeat(m);
    this.roomDirty = true;
    return null;
  }

  /** PR1: the member's own picture and piece style (cosmetic; any phase). */
  private setProfile(
    m: MemberRec,
    avatar: AvatarRef | null,
    pieceStyle: PieceStyleId,
  ): Failure | null {
    const image = avatar !== null && isImageAvatar(avatar);
    const changed = avatar !== (m.avatar ?? null);
    if (image && changed) {
      const others = this.d.members.filter(
        (x) => x.id !== m.id && x.avatar !== undefined && isImageAvatar(x.avatar),
      );
      if (others.length >= LIMITS.avatarImages) {
        return [
          'bad_message',
          'too many uploaded pictures in this room; pick one from the gallery',
        ];
      }
    }
    if (avatar === null) delete m.avatar;
    else m.avatar = avatar;
    m.pieceStyle = pieceStyle;
    if (image && changed) {
      m.avatarRev = (m.avatarRev ?? 0) + 1;
      this.broadcast({ v: PROTOCOL_VERSION, type: 'avatars', images: this.images([m]) });
    }
    this.roomDirty = true;
    return null;
  }

  /** Uploaded pictures of `members` by `img:` key. */
  private images(members: readonly MemberRec[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of members) {
      if (m.avatar !== undefined && isImageAvatar(m.avatar)) out[avatarKey(m)] = m.avatar;
    }
    return out;
  }

  /**
   * L1: a member who just picked a nickname in the lobby sits down: in the first seat a bot
   * holds (the host lands in seat 1), else in a new seat (grownConfig: up to 8 in the base game,
   * the mode / scenario's maximum otherwise). Only at that cap (or once the game runs) do they
   * watch. Only on the first name: someone who stands up stays standing.
   */
  private autoSeat(m: MemberRec): void {
    if (this.d.phase !== 'lobby' || this.seatOf(m.id) !== null) return;
    const free = () => this.d.seats.find((s) => s.occupant === null);
    let open = free();
    if (!open) {
      const grown = grownConfig(this.d.config);
      if (!grown) return;
      this.setConfig(grown);
      open = free();
      if (!open) return;
      this.system(`Added seat ${this.d.seats.length} for ${m.name}`);
    }
    open.occupant = m.id;
    open.status = 'human';
  }

  private takeSeat(m: MemberRec, seat: PlayerId): Failure | null {
    if (this.d.phase !== 'lobby') return ['wrong_phase', 'seats are fixed once the game starts'];
    if (!m.name) return ['name_required', 'enter a name first'];
    const target = this.d.seats[seat];
    if (!target) return ['bad_seat', `no seat ${seat}`];
    if (target.occupant !== null && target.occupant !== m.id) return ['seat_taken', 'seat taken'];
    this.unseat(m.id);
    target.occupant = m.id;
    target.status = 'human';
    this.roomDirty = true;
    return null;
  }

  private leaveSeat(m: MemberRec): Failure | null {
    if (this.d.phase !== 'lobby') return ['wrong_phase', 'seats are fixed once the game starts'];
    if (this.seatOf(m.id) === null) return ['not_seated', 'you have no seat'];
    this.unseat(m.id);
    return null;
  }

  private setColor(m: MemberRec, color: string): Failure | null {
    if (this.d.phase !== 'lobby') return ['wrong_phase', 'colours are fixed once the game starts'];
    const seat = this.seatOf(m.id);
    if (seat === null) return ['not_seated', 'take a seat first'];
    if (this.d.seats.some((s, i) => i !== seat && s.color === color)) {
      return ['color_taken', 'another seat has that colour'];
    }
    this.seatRec(seat).color = color;
    this.roomDirty = true;
    return null;
  }

  private setBotLevel(m: MemberRec, seat: PlayerId, level: BotLevel): Failure | null {
    if (m.id !== this.d.host) return ['not_host', 'only the host can pick bot levels'];
    if (this.d.phase !== 'lobby') return ['wrong_phase', 'the game has started'];
    const s = this.d.seats[seat];
    if (!s) return ['bad_message', 'no such seat'];
    s.botLevel = level;
    this.roomDirty = true;
    return null;
  }

  private configure(m: MemberRec, config: RoomConfig): Failure | null {
    if (m.id !== this.d.host) return ['not_host', 'only the host can change the game'];
    if (this.d.phase !== 'lobby') return ['wrong_phase', 'the game has started'];
    this.setConfig(config);
    return null;
  }

  /** A (valid) config; seats are added or dropped from the end to match its seat count. */
  private setConfig(config: RoomConfig): void {
    this.d.config = config;
    const seats = this.d.seats;
    while (seats.length > config.seatCount) seats.pop();
    while (seats.length < config.seatCount) {
      const used = new Set(seats.map((s) => s.color));
      seats.push({
        color: ROOM_COLORS.find((c) => !used.has(c)) ?? '#888888',
        occupant: null,
        status: 'bot',
      });
    }
    this.roomDirty = true;
  }

  private kick(m: MemberRec, target: MemberId): Failure | null {
    if (m.id !== this.d.host) return ['not_host', 'only the host can remove people'];
    const t = this.d.members.find((x) => x.id === target);
    if (!t || t.id === m.id) return ['bad_message', 'no such member'];
    if (t.conn) {
      this.error(t.conn, 'kicked', 'the host removed you from the room');
      this.forgetConn(t.conn);
    }
    const seat = this.seatOf(t.id);
    if (seat !== null) {
      const s = this.seatRec(seat);
      s.occupant = null;
      s.status = 'bot';
      if (this.d.phase === 'playing') this.seatsChanged();
    }
    this.d.members = this.d.members.filter((x) => x.id !== t.id);
    if (t.name) this.system(`${t.name} was removed by the host`);
    this.roomDirty = true;
    return null;
  }

  private start(m: MemberRec): Failure | null {
    if (m.id !== this.d.host) return ['not_host', 'only the host can start'];
    if (this.d.phase !== 'lobby') return ['wrong_phase', 'the game has already started'];
    if (!this.d.seats.some((s) => s.occupant !== null)) {
      return ['not_seated', 'at least one person must take a seat'];
    }
    const taken = new Set<string>();
    const players: SeatConfig[] = this.d.seats.map((s, i) => {
      const member = s.occupant === null ? undefined : this.member(s.occupant);
      const base = member?.name || botName(s.color, i);
      let name = base;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
      taken.add(name.toLowerCase());
      return { name, color: s.color, controller: member ? 'human' : 'bot' };
    });
    const { seatCount: _seats, ...options } = this.d.config;
    const cfg: NewGameConfig = { ...options, players };
    const seed = this.deps.seed();
    let state: GameState;
    try {
      state = createGame(gameConfigOf(cfg, seed));
    } catch (e) {
      return ['bad_config', e instanceof Error ? e.message : String(e)];
    }
    // Randomize Turn Order shuffled the players: move the lobby seats along, so seat index =
    // PlayerId again (seat p holds config player seatOrder[p], with its occupant and colour).
    const order = state.settings.seatOrder;
    if (order) this.d.seats = order.map((i) => this.seatRec(i));
    for (const s of this.d.seats) {
      const member = s.occupant === null ? undefined : this.member(s.occupant);
      s.status = !member ? 'bot' : member.conn !== null ? 'human' : 'away';
    }
    this.d.game = {
      state,
      seq: 0,
      botRng: Rng.fromSeed(`bots:${seed}`).state,
      timeoutRng: Rng.fromSeed(`timer:${seed}`).state,
      clock: IDLE_CLOCK,
      clockAt: this.now,
      botDueAt: null,
      timeoutDueAt: null,
      timedOutKey: null,
      offers: {},
      startedAt: this.now,
      ...(timerOf(state.settings).kind === 'bank'
        ? { banks: initialBanks(state.settings, state.players.length) }
        : {}),
    };
    this.d.phase = 'playing';
    this.roomDirty = true;
    this.system('The game has started');
    this.gameChanged();
    return null;
  }

  private rematch(m: MemberRec): Failure | null {
    if (m.id !== this.d.host) return ['not_host', 'only the host can start a rematch'];
    if (this.d.phase !== 'over') return ['wrong_phase', 'the game is not over'];
    this.d.phase = 'lobby';
    this.d.game = null;
    this.legalCache = null;
    for (const s of this.d.seats) s.status = s.occupant === null ? 'bot' : 'human';
    this.system('Back to the lobby for a rematch');
    this.roomDirty = true;
    return null;
  }

  private intent(m: MemberRec, action: Action, seq: number | undefined): Failure | null {
    const g = this.d.game;
    if (!g || this.d.phase !== 'playing') return ['wrong_phase', 'no game running'];
    const seat = this.seatOf(m.id);
    if (seat === null) return ['not_seated', 'spectators cannot play'];
    if (action.player !== seat) return ['not_your_seat', `you play seat ${seat}`];
    if (seq !== undefined && seq !== g.seq) {
      if (m.conn) this.gameFor.add(m.conn);
      return ['stale_state', 'the game moved on; here is the current state'];
    }
    // Only a kind of move legalActions offers this seat now (base or expansion alike). Legal
    // lists are complete except open-ended payloads (trade offers, bundles spelled with zeros),
    // so the payload itself is applyAction's to judge.
    if (!this.legal().some((a) => a.player === seat && a.type === action.type)) {
      return ['illegal_action', `${action.type} is not a legal move for seat ${seat} now`];
    }
    const err = this.apply(action);
    return err === null ? null : ['illegal_action', err];
  }

  private chat(m: MemberRec, raw: string): Failure | null {
    if (!m.name) return ['name_required', 'enter a name first'];
    const text = cleanText(raw, LIMITS.chat);
    if (!text) return null;
    this.pushChat({ from: m.id, name: m.name, seat: this.seatOf(m.id), text });
    return null;
  }

  // -------------------------------------------------------------------------
  // Connections, grace, host
  // -------------------------------------------------------------------------

  private drop(conn: ConnId): void {
    const id = this.d.conns[conn];
    this.forgetConn(conn);
    if (!id) return;
    const m = this.member(id);
    if (!m || m.conn !== conn) return;
    m.conn = null;
    m.leftAt = this.now;
    const seat = this.seatOf(m.id);
    if (seat !== null && this.d.phase === 'playing' && this.seatRec(seat).status === 'human') {
      this.seatRec(seat).status = 'away';
    }
    if (!this.anyoneConnected()) this.d.lastActiveAt = this.now;
    this.roomDirty = true;
  }

  /** A returning player takes their seat back from the bot. */
  private reclaim(m: MemberRec): void {
    const seat = this.seatOf(m.id);
    if (seat === null || this.d.phase !== 'playing') return;
    const s = this.seatRec(seat);
    if (s.status === 'human') return;
    const fromBot = s.status === 'bot';
    s.status = 'human';
    if (fromBot) this.system(`${this.playerName(seat)} is back and took over from the bot`, seat);
    this.seatsChanged();
  }

  /** Grace periods that ran out: lobby seats are freed, game seats go to a bot. */
  private processGrace(): void {
    for (const m of this.d.members) {
      if (m.conn !== null || m.leftAt === null || this.now - m.leftAt < this.opts.graceMs) continue;
      const seat = this.seatOf(m.id);
      if (seat === null) continue;
      const s = this.seatRec(seat);
      if (this.d.phase === 'lobby') {
        s.occupant = null;
        s.status = 'bot';
        this.roomDirty = true;
      } else if (this.d.phase === 'playing' && s.status === 'away') {
        s.status = 'bot';
        this.system(`${this.playerName(seat)} is away; a bot plays until they return`, seat);
        this.roomDirty = true;
        this.seatsChanged();
      }
    }
    this.maybeTransferHost();
  }

  /** The host left more than graceMs ago (or was removed): the longest-present member takes over. */
  private maybeTransferHost(): void {
    const host = this.d.host === null ? undefined : this.member(this.d.host);
    const hostGone =
      !host ||
      (host.conn === null && host.leftAt !== null && this.now - host.leftAt >= this.opts.graceMs);
    if (!hostGone) return;
    const connected = this.d.members.filter((m) => m.conn !== null && m.name !== '');
    const next = connected.find((m) => this.seatOf(m.id) !== null) ?? connected[0];
    if (!next || next.id === this.d.host) return;
    this.d.host = next.id;
    this.system(`${next.name} is now the host`);
    this.roomDirty = true;
  }

  /** Room full: forget the longest-gone member without a seat (not the host). */
  private pruneMember(): boolean {
    const gone = this.d.members
      .filter((m) => m.conn === null && m.id !== this.d.host && this.seatOf(m.id) === null)
      .sort((a, b) => (a.leftAt ?? 0) - (b.leftAt ?? 0))[0];
    if (!gone) return false;
    this.d.members = this.d.members.filter((m) => m !== gone);
    return true;
  }

  // -------------------------------------------------------------------------
  // Game
  // -------------------------------------------------------------------------

  /** Seat controllers for the bot / timer logic: 'away' still counts as human. */
  private controllers(): Seats {
    return this.d.seats.map((s) => (s.status === 'bot' ? 'bot' : 'human'));
  }

  private legal(): Action[] {
    const g = this.d.game;
    if (!g) return [];
    this.legalCache ??= legalActions(g.state);
    return this.legalCache;
  }

  /** Apply an action; null on success, else the engine's error. */
  private apply(action: Action): string | null {
    const g = this.d.game;
    if (!g) return 'no game';
    const result = applyAction(g.state, action);
    if (!result.ok) return result.error;
    if (action.type === 'offerTrade') {
      const key = `${g.state.turn.number}:${action.player}`;
      g.offers[key] = (g.offers[key] ?? 0) + 1;
    }
    if (action.type === 'endTurn') g.offers = {};
    if (timerOf(g.state.settings).kind === 'bank') {
      // begin() advanced the clock to `now`, so the bank gets exactly the time used.
      const banked = bankAfterAction(g.clock, this.banks(g), g.state, result.state);
      g.clock = banked.clock;
      g.banks = banked.banks;
    }
    g.state = result.state;
    this.gameChanged();
    return null;
  }

  /** After every state change: seq, game over, clock, bot schedule, broadcast. */
  private gameChanged(): void {
    const g = this.d.game;
    if (!g) return;
    g.seq += 1;
    this.legalCache = null;
    this.gameDirty = true;
    if (g.state.phase.kind === 'gameOver') {
      g.endedAt ??= this.now;
      g.clock = IDLE_CLOCK;
      g.botDueAt = null;
      g.timeoutDueAt = null;
      this.d.phase = 'over';
      this.roomDirty = true;
      const w = g.state.winner;
      this.system(w === null ? 'Game over' : `${this.playerName(w)} won the game!`, w);
      return;
    }
    this.syncTimer();
    this.scheduleBot();
  }

  /** A seat changed hands (bot <-> human): the clock and the bots re-plan. */
  private seatsChanged(): void {
    if (!this.d.game || this.d.phase !== 'playing') return;
    this.gameDirty = true;
    this.roomDirty = true;
    this.syncTimer();
    this.scheduleBot();
  }

  private syncTimer(): void {
    const g = this.d.game;
    if (!g) return;
    const timer = timerOf(g.state.settings);
    const slot =
      timer.kind === 'off' ? null : timerSlot(g.state, this.controllers(), this.legal(), null);
    const before = g.clock.key;
    if (timer.kind === 'bank') {
      // Chess clock: the player on the clock spends their own bank (no fresh time per slot).
      const next = syncBankClock(g.clock, this.banks(g), slot, timer.bankSec * 1000);
      g.clock = next.clock;
      g.banks = next.banks;
    } else {
      g.clock = syncClock(g.clock, slot, timer.kind === 'perTurn' ? timer.sec * 1000 : 0);
    }
    g.clockAt = this.now;
    if (g.clock.key !== before) g.timeoutDueAt = null;
  }

  /** Chess-clock banks (fresh ones for a snapshot from before banks were saved). */
  private banks(g: GameRec): number[] {
    return restoreBanks(g.banks, g.state.settings, g.state.players.length);
  }

  private advanceClock(): void {
    const g = this.d.game;
    if (!g) return;
    if (this.d.phase === 'playing' && this.anyoneConnected()) {
      g.clock = tickClock(g.clock, this.now - g.clockAt);
    }
    g.clockAt = this.now;
  }

  private scheduleBot(): void {
    const g = this.d.game;
    if (!g) return;
    const next = nextBot(g.state, this.controllers(), this.legal());
    const delay = this.opts.botDelayMs * (next?.fast ? FAST_FACTOR : 1);
    g.botDueAt = next ? this.now + Math.round(delay) : null;
  }

  private botMove(): void {
    const g = this.d.game;
    if (!g) return;
    const next = nextBot(g.state, this.controllers(), this.legal());
    if (!next) {
      g.botDueAt = null;
      return;
    }
    const own = this.legal().filter((a) => a.player === next.player);
    const used = g.offers[`${g.state.turn.number}:${next.player}`] ?? 0;
    const noOffers = own.filter((a) => a.type !== 'offerTrade');
    const options = used < BOT_OFFERS_PER_TURN || noOffers.length === 0 ? own : noOffers;
    const rng = new Rng(g.botRng);
    const bot = this.opts.bot ?? botForLevel(this.seatRec(next.player).botLevel);
    const action = bot(g.state, next.player, rng, options);
    g.botRng = rng.state;
    // A bot without a move (or with a rejected one) would loop: stop until something changes.
    if (!action || this.apply(action) !== null) g.botDueAt = null;
  }

  /** The player on the clock ran out of time: one minimum move (turnTimer.timeoutMove). */
  private timeUp(): void {
    const g = this.d.game;
    if (!g) return;
    const player = g.clock.player;
    const rng = new Rng(g.timeoutRng);
    const action = player === null ? null : timeoutMove(g.state, this.legal(), player, rng);
    g.timeoutRng = rng.state;
    if (!action || player === null) {
      g.clock = IDLE_CLOCK;
      g.timeoutDueAt = null;
      this.gameDirty = true;
      return;
    }
    if (g.timedOutKey !== g.clock.key) {
      g.timedOutKey = g.clock.key;
      this.system(`${this.playerName(player)} ran out of time`, player);
    }
    g.timeoutDueAt = this.now + this.opts.timeoutStepMs;
    if (this.apply(action) !== null) {
      g.clock = IDLE_CLOCK;
      g.timeoutDueAt = null;
    }
  }

  private gameMessage(conn: ConnId): ServerMessage {
    const g = this.d.game;
    if (!g) throw new Error('no game');
    const id = this.d.conns[conn];
    const seat = id ? this.seatOf(id) : null;
    const clock = g.clock;
    const timer: TimerInfo | null =
      clock.key !== null && clock.kind !== null && clock.player !== null
        ? {
            player: clock.player,
            kind: clock.kind,
            remainingMs: clock.remainingMs,
            totalMs: clock.totalMs,
          }
        : null;
    return {
      v: PROTOCOL_VERSION,
      type: 'game',
      seq: g.seq,
      view: viewFor(g.state, seat ?? 'spectator'),
      legal: seat === null ? [] : this.legal().filter((a) => a.player === seat),
      timer,
      ...(g.startedAt !== undefined && g.endedAt !== undefined
        ? { durationMs: g.endedAt - g.startedAt }
        : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private member(id: MemberId): MemberRec | undefined {
    return this.d.members.find((m) => m.id === id);
  }

  private memberOfConn(conn: ConnId): MemberRec | undefined {
    const id = this.d.conns[conn];
    return id ? this.member(id) : undefined;
  }

  private seatOf(id: MemberId): PlayerId | null {
    const i = this.d.seats.findIndex((s) => s.occupant === id);
    return i < 0 ? null : i;
  }

  private seatRec(seat: PlayerId): SeatRec {
    const s = this.d.seats[seat];
    if (!s) throw new Error(`no seat ${seat}`);
    return s;
  }

  private unseat(id: MemberId): void {
    const seat = this.seatOf(id);
    if (seat === null) return;
    const s = this.seatRec(seat);
    s.occupant = null;
    s.status = 'bot';
    this.roomDirty = true;
  }

  private playerName(seat: PlayerId): string {
    return this.d.game?.state.players[seat]?.name ?? `Seat ${seat + 1}`;
  }

  private forgetConn(conn: ConnId): void {
    const { [conn]: _gone, ...rest } = this.d.conns;
    this.d.conns = rest;
  }

  private anyoneConnected(): boolean {
    return this.d.members.some((m) => m.conn !== null);
  }

  private joinedConns(): ConnId[] {
    return Object.keys(this.d.conns).filter((c) => this.d.conns[c] !== null);
  }

  private take(m: MemberRec, kind: RateKind): boolean {
    const { burst, perSec } = RATE_LIMITS[kind];
    const b = m.buckets[kind] ?? { tokens: burst, at: this.now };
    b.tokens = Math.min(burst, b.tokens + ((this.now - b.at) / 1000) * perSec);
    b.at = this.now;
    m.buckets[kind] = b;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private system(text: string, seat: PlayerId | null = null): void {
    this.pushChat({ from: null, name: '', seat, text });
  }

  private pushChat(e: Omit<ChatEntry, 'id' | 'at'>): void {
    const entry: ChatEntry = { id: this.d.nextChat++, at: this.now, ...e };
    this.d.chat.push(entry);
    if (this.d.chat.length > LIMITS.chatHistory)
      this.d.chat.splice(0, this.d.chat.length - LIMITS.chatHistory);
    this.broadcast({ v: PROTOCOL_VERSION, type: 'chat', entry });
  }

  private broadcast(msg: ServerMessage): void {
    for (const conn of this.joinedConns()) this.send(conn, msg);
  }

  private send(conn: ConnId, msg: ServerMessage): void {
    this.out.push({ kind: 'send', conn, msg });
  }

  private error(conn: ConnId, code: ErrorCode, message: string, ref?: ClientMessage['type']): void {
    this.send(conn, { v: PROTOCOL_VERSION, type: 'error', code, message, ...(ref ? { ref } : {}) });
    if (FATAL_ERRORS.includes(code)) {
      this.out.push({ kind: 'close', conn, code: CLOSE_CODES[code] ?? 4999, reason: code });
    }
  }
}

type Failure = [ErrorCode, string];

function freshSeats(n: number): SeatRec[] {
  return ROOM_COLORS.slice(0, n).map((color) => ({ color, occupant: null, status: 'bot' }));
}

/** MemberInfo.avatar: the gallery id, or the `img:` key of an uploaded picture. */
function avatarKey(m: MemberRec): string {
  const a = m.avatar ?? '';
  return isImageAvatar(a) ? `img:${m.id}.${m.avatarRev ?? 0}` : a;
}

function botName(color: string, seat: PlayerId): string {
  const name = SEAT_COLORS.find((c) => c.color === color)?.name;
  return name ? `${name} Bot` : `Bot ${seat + 1}`;
}
