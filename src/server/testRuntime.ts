/**
 * A fake Durable Object runtime for RoomCore tests: in-memory storage and alarm, fake sockets,
 * a manual clock. `hibernate()` rebuilds the core from storage with the same sockets (what the
 * runtime does after hibernation); `evict()` does it with every socket gone.
 */
import type { ConnId, SessionOptions } from '../net/session';
import type { ServerMessage, ServerMessageType } from '../net/protocol';
import { fakeDeps } from '../net/testHarness';
import { RoomCore, type RoomPlatform, type RoomSocket } from './room';

export class FakeSocket implements RoomSocket {
  readonly sent: string[] = [];
  closedWith: { code: number; reason: string } | null = null;
  joined = false;

  constructor(
    readonly conn: ConnId,
    readonly ip: string,
    readonly openedAt: number,
  ) {}

  markJoined(): void {
    this.joined = true;
  }
  send(text: string): void {
    if (this.closedWith) throw new Error(`send on closed socket ${this.conn}`);
    this.sent.push(text);
  }
  close(code: number, reason: string): void {
    this.closedWith ??= { code, reason };
  }

  messages(): ServerMessage[] {
    return this.sent.filter((t) => t !== 'pong').map((t) => JSON.parse(t) as ServerMessage);
  }
  of<T extends ServerMessageType>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.messages().filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
  last<T extends ServerMessageType>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.of(type).at(-1);
  }
}

export class FakeRuntime {
  now = 1_000_000;
  stored: string | undefined;
  alarmAt: number | null = null;
  saves = 0;
  alarmWrites = 0;
  readonly logs: string[] = [];
  /** Sockets the runtime holds (closed ones are removed, as after the close event). */
  readonly sockets = new Map<ConnId, FakeSocket>();
  core!: RoomCore;
  private nextConn = 1;
  private readonly deps = fakeDeps('k');

  constructor(readonly options: Partial<SessionOptions> = { botDelayMs: 0 }) {}

  platform(): RoomPlatform {
    return {
      storage: {
        load: async () => this.stored,
        save: async (text) => {
          this.stored = text;
          this.saves++;
        },
        clear: async () => {
          this.stored = undefined;
          this.alarmAt = null;
        },
        getAlarm: async () => this.alarmAt,
        setAlarm: async (at) => {
          this.alarmAt = at;
          this.alarmWrites++;
        },
      },
      sockets: () => [...this.sockets.values()].filter((s) => !s.closedWith),
      now: () => this.now,
      deps: this.deps,
      options: this.options,
      log: (m) => this.logs.push(m),
    };
  }

  async load(): Promise<RoomCore> {
    this.core = await RoomCore.load(this.platform());
    return this.core;
  }

  /** Admit + accept a socket like the Worker's upgrade path. Null if refused. */
  async connect(ip = '1.1.1.1'): Promise<FakeSocket | null> {
    const refused = await this.core.admit(ip);
    if (refused) return null;
    const s = new FakeSocket(`c${this.nextConn++}`, ip, this.now);
    this.sockets.set(s.conn, s);
    await this.core.opened(s);
    return s;
  }

  async send(s: FakeSocket, body: Record<string, unknown>): Promise<void> {
    await this.core.message(s, JSON.stringify({ v: 1, ...body }));
  }

  /** The client closed: the runtime fires webSocketClose. */
  async disconnect(s: FakeSocket): Promise<void> {
    s.close(1000, 'client');
    await this.core.closed(s.conn);
  }

  /** Advance the clock, firing the alarm whenever it is due. */
  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (let i = 0; i < 100_000; i++) {
      if (this.alarmAt === null || this.alarmAt > target) break;
      this.now = Math.max(this.now, this.alarmAt);
      this.alarmAt = null;
      await this.core.alarm();
    }
    this.now = target;
  }

  /** Hibernation: memory gone, sockets kept. */
  async hibernate(): Promise<RoomCore> {
    return this.load();
  }

  /** Eviction / restart: memory and sockets gone. */
  async evict(): Promise<RoomCore> {
    this.sockets.clear();
    return this.load();
  }
}
