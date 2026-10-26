/**
 * The room Durable Object's logic (docs/MULTIPLAYER.md §4, §18), behind a small platform port so
 * tests run it without workerd. `worker.ts` adapts the real DurableObjectState to `RoomPlatform`.
 *
 * Every event: GameSession call -> deliver Outbound in order -> persist the snapshot if it
 * changed -> move the alarm to session.nextWakeAt(). Storage is the source of truth: after
 * hibernation or eviction the object is rebuilt with `RoomCore.load`.
 */
import type { CreateRoomResponse, RoomSummary } from '../net/api';
import {
  GameSession,
  type ConnId,
  type Outbound,
  type SessionDeps,
  type SessionOptions,
  type SessionSnapshot,
} from '../net/session';
import { CLOSE_CODES, PROTOCOL_VERSION, type ErrorCode, type ServerMessage } from '../net/protocol';
import { SERVER_LIMITS, TokenBucket } from './limits';
import { apiError, IP_HEADER, json } from './router';

/** One accepted (hibernatable) socket. `joined` and `openedAt` survive hibernation. */
export interface RoomSocket {
  readonly conn: ConnId;
  readonly ip: string;
  readonly openedAt: number;
  readonly joined: boolean;
  markJoined(): void;
  send(text: string): void;
  close(code: number, reason: string): void;
}

export interface RoomStorage {
  /** The saved snapshot (JSON text), if the room exists. */
  load(): Promise<string | undefined>;
  save(snapshot: string): Promise<void>;
  /** Delete the room: all keys and the alarm. */
  clear(): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(at: number | null): Promise<void>;
}

export interface RoomPlatform {
  storage: RoomStorage;
  /** Sockets the runtime holds for this object right now. */
  sockets(): RoomSocket[];
  now(): number;
  deps: SessionDeps;
  options: Partial<SessionOptions>;
  /** Server log (console.error in the Worker). */
  log(message: string, error?: unknown): void;
}

/** Close code for policy violations (flooding). */
export const CLOSE_POLICY = 1008;

/** After a session error, due work is retried no sooner than this. */
export const RETRY_AFTER_ERROR_MS = 5_000;

interface FrameGuard {
  bucket: TokenBucket;
  strikes: number;
}

export class RoomCore {
  private session: GameSession | null = null;
  /** Last snapshot written (JSON), to skip identical writes. */
  private saved: string | null = null;
  private alarmAt: number | null = null;
  private readonly frames = new Map<ConnId, FrameGuard>();

  private constructor(private readonly p: RoomPlatform) {}

  /** Rebuild from storage (constructor of the Durable Object, inside blockConcurrencyWhile). */
  static async load(p: RoomPlatform): Promise<RoomCore> {
    const core = new RoomCore(p);
    core.alarmAt = await p.storage.getAlarm();
    const saved = await p.storage.load();
    if (saved === undefined) {
      for (const s of p.sockets()) s.close(CLOSE_CODES.room_expired ?? 4004, 'room_expired');
      return core;
    }
    core.session = GameSession.restore(JSON.parse(saved) as SessionSnapshot, p.deps, p.options);
    core.saved = saved;
    const live = p.sockets().map((s) => s.conn);
    await core.run((s) => s.reconcile(live, p.now()));
    return core;
  }

  get exists(): boolean {
    return this.session !== null;
  }

  /** Read-only, for tests and logs. `.state` of it is SECRET. */
  get current(): GameSession | null {
    return this.session;
  }

  /** A new room under `roomId`, or null if this object already holds a live one. */
  async create(roomId: string): Promise<CreateRoomResponse | null> {
    await this.expireIfDue();
    if (this.session) return null;
    const { session, hostToken } = GameSession.create(
      roomId,
      this.p.now(),
      this.p.deps,
      this.p.options,
    );
    this.session = session;
    await this.run(() => []);
    return { roomId, hostToken };
  }

  async info(): Promise<RoomSummary | null> {
    await this.expireIfDue();
    if (!this.session) return null;
    const room = this.session.room();
    return {
      roomId: room.id,
      phase: room.phase,
      seats: room.seats.length,
      taken: room.seats.filter((s) => s.occupant !== null).length,
      connected: room.members.filter((m) => m.connected).length,
    };
  }

  /** May a socket from `ip` connect? null = yes, else [HTTP status, reason]. */
  async admit(ip: string): Promise<[number, string] | null> {
    await this.expireIfDue();
    if (!this.session) return [404, 'no such room'];
    const sockets = this.p.sockets();
    if (sockets.filter((s) => s.ip === ip).length >= SERVER_LIMITS.socketsPerIp) {
      return [429, 'too many connections from your network'];
    }
    if (sockets.length >= SERVER_LIMITS.socketsPerRoom) {
      const now = this.p.now();
      const stale = sockets
        .filter((s) => !s.joined && now - s.openedAt >= SERVER_LIMITS.helloTimeoutMs)
        .sort((a, b) => a.openedAt - b.openedAt)[0];
      if (!stale) return [503, 'room is full'];
      stale.close(CLOSE_POLICY, 'no hello');
      await this.closed(stale.conn);
    }
    return null;
  }

  async opened(socket: RoomSocket): Promise<void> {
    this.frames.set(socket.conn, {
      bucket: new TokenBucket(SERVER_LIMITS.frame, this.p.now()),
      strikes: 0,
    });
    await this.run((s) => s.open(socket.conn, this.p.now()));
  }

  async message(socket: RoomSocket, data: string | ArrayBuffer): Promise<void> {
    if (!this.session) {
      socket.close(CLOSE_CODES.room_expired ?? 4004, 'room_expired');
      return;
    }
    const now = this.p.now();
    let guard = this.frames.get(socket.conn);
    if (!guard) {
      guard = { bucket: new TokenBucket(SERVER_LIMITS.frame, now), strikes: 0 };
      this.frames.set(socket.conn, guard);
    }
    if (!guard.bucket.take(now)) {
      if (++guard.strikes >= SERVER_LIMITS.frameStrikes) {
        socket.close(CLOSE_POLICY, 'rate_limited');
        await this.closed(socket.conn);
      } else {
        sendError(socket, 'rate_limited', 'too many messages, slow down');
      }
      return;
    }
    guard.strikes = 0;
    if (typeof data !== 'string') {
      sendError(socket, 'bad_message', 'binary frames are not supported');
      return;
    }
    if (data.length > SERVER_LIMITS.messageChars) {
      sendError(socket, 'bad_message', `message longer than ${SERVER_LIMITS.messageChars}`);
      return;
    }
    await this.run((s) => s.receive(socket.conn, data, now));
  }

  async closed(conn: ConnId): Promise<void> {
    this.frames.delete(conn);
    await this.run((s) => s.close(conn, this.p.now()));
  }

  async alarm(): Promise<void> {
    this.alarmAt = null; // the runtime cleared it by firing
    await this.run((s) => s.tick(this.p.now()));
    await this.expireIfDue();
  }

  private async expireIfDue(): Promise<void> {
    if (!this.session?.isExpired(this.p.now())) return;
    for (const s of this.p.sockets()) s.close(CLOSE_CODES.room_expired ?? 4004, 'room_expired');
    this.session = null;
    this.saved = null;
    this.alarmAt = null;
    this.frames.clear();
    await this.p.storage.clear();
  }

  /**
   * One session call, then deliver, persist and reschedule. If the session throws, the in-memory
   * copy may be half-updated: it is rebuilt from the last saved snapshot and the event is dropped.
   */
  private async run(call: (s: GameSession) => Outbound[]): Promise<void> {
    const session = this.session;
    if (!session) return;
    let out: Outbound[];
    try {
      out = call(session);
    } catch (e) {
      this.p.log(`room ${session.roomId}: session error, rolling back`, e);
      this.session =
        this.saved === null
          ? null
          : GameSession.restore(
              JSON.parse(this.saved) as SessionSnapshot,
              this.p.deps,
              this.p.options,
            );
      // Retry due work later rather than never (a bot bug would otherwise stall the table).
      const next = this.session?.nextWakeAt() ?? null;
      const retry = next === null ? null : Math.max(next, this.p.now() + RETRY_AFTER_ERROR_MS);
      await this.p.storage.setAlarm(retry);
      this.alarmAt = retry;
      return;
    }
    this.deliver(out);
    const text = JSON.stringify(session.snapshot());
    if (text !== this.saved) {
      await this.p.storage.save(text);
      this.saved = text;
    }
    const next = session.nextWakeAt();
    if (next !== this.alarmAt) {
      await this.p.storage.setAlarm(next);
      this.alarmAt = next;
    }
  }

  private deliver(out: readonly Outbound[]): void {
    const byConn = new Map(this.p.sockets().map((s) => [s.conn, s]));
    for (const o of out) {
      const socket = byConn.get(o.conn);
      if (!socket) continue;
      if (o.kind === 'close') {
        socket.close(o.code, o.reason);
        continue;
      }
      if (o.msg.type === 'welcome' && !socket.joined) socket.markJoined();
      socket.send(JSON.stringify(o.msg));
    }
  }
}

function sendError(socket: RoomSocket, code: ErrorCode, message: string): void {
  const msg: ServerMessage = { v: PROTOCOL_VERSION, type: 'error', code, message };
  socket.send(JSON.stringify(msg));
}

/**
 * The object's HTTP side (requests come from the Worker only, see router.ts):
 * `POST /create {roomId}`, `GET /info`, `GET /ws` (upgrade; `upgrade(ip)` builds the 101).
 */
export async function roomFetch(
  core: RoomCore,
  request: Request,
  upgrade: (ip: string) => Promise<Response>,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/create' && request.method === 'POST') {
    const body = (await request.json().catch(() => null)) as { roomId?: unknown } | null;
    if (typeof body?.roomId !== 'string') return apiError(400, 'roomId required');
    const created = await core.create(body.roomId);
    return created ? json(created, 201) : apiError(409, 'room code taken');
  }
  if (path === '/info') {
    const info = await core.info();
    return info ? json(info) : apiError(404, 'no such room');
  }
  if (path === '/ws') {
    const ip = request.headers.get(IP_HEADER) ?? 'unknown';
    const refused = await core.admit(ip);
    if (refused) return apiError(refused[0], refused[1]);
    return upgrade(ip);
  }
  return apiError(404, 'no such endpoint');
}

// ---------------------------------------------------------------------------
// Platform helpers (pure given a byte source)
// ---------------------------------------------------------------------------

const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Session secrets from a CSPRNG: tokens of 32 symbols x 6 bits = 192 bits; 128-bit hex seeds. */
export function sessionDeps(randomBytes: (n: number) => Uint8Array): SessionDeps {
  return {
    token: () => Array.from(randomBytes(32), (b) => TOKEN_ALPHABET[b & 63]).join(''),
    seed: () => Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join(''),
  };
}

/** Optional `vars` overrides (local dev and the end-to-end test speed bots up). */
export function sessionOptionsFrom(vars: Record<string, unknown>): Partial<SessionOptions> {
  const out: Partial<SessionOptions> = {};
  const num = (key: string, min: number, max: number): number | undefined => {
    const raw = vars[key];
    if (raw === undefined || raw === '') return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
  };
  const bot = num('BOT_DELAY_MS', 0, 60_000);
  if (bot !== undefined) out.botDelayMs = bot;
  const grace = num('GRACE_MS', 1_000, 3_600_000);
  if (grace !== undefined) out.graceMs = grace;
  return out;
}
