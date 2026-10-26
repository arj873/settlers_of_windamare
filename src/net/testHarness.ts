/**
 * In-memory transport for GameSession: fake clock, one inbox per connection. Used by the session
 * tests and meant for the client (M3) to test its network controller without a server.
 */
import type { ClientMessage, ServerMessage, ServerMessageType } from './protocol';
import { PROTOCOL_VERSION } from './protocol';
import type { ConnId, GameSession, Outbound, SessionDeps } from './session';

type Body = ClientMessage extends infer M
  ? M extends ClientMessage
    ? Omit<M, 'v'>
    : never
  : never;

/** Deterministic tokens and seeds. */
export function fakeDeps(prefix = 't'): SessionDeps {
  let tokens = 0;
  let seeds = 0;
  return {
    token: () => `${prefix}${String(++tokens).padStart(20, '0')}`,
    seed: () => `seed-${++seeds}`,
  };
}

export class LocalNet {
  now: number;
  readonly inbox = new Map<ConnId, ServerMessage[]>();
  readonly closed = new Map<ConnId, number>();

  constructor(
    public session: GameSession,
    start = 0,
  ) {
    this.now = start;
  }

  deliver(out: readonly Outbound[]): void {
    for (const o of out) {
      if (o.kind === 'close') {
        this.closed.set(o.conn, o.code);
        continue;
      }
      // Round-trip through JSON like a real socket.
      const msg = JSON.parse(JSON.stringify(o.msg)) as ServerMessage;
      const box = this.inbox.get(o.conn) ?? [];
      box.push(msg);
      this.inbox.set(o.conn, box);
    }
  }

  connect(conn: ConnId): void {
    this.inbox.set(conn, []);
    this.closed.delete(conn);
    this.deliver(this.session.open(conn, this.now));
  }

  send(conn: ConnId, body: Body): void {
    this.deliver(
      this.session.receive(conn, JSON.stringify({ v: PROTOCOL_VERSION, ...body }), this.now),
    );
  }

  sendRaw(conn: ConnId, raw: unknown): void {
    this.deliver(this.session.receive(conn, raw, this.now));
  }

  disconnect(conn: ConnId): void {
    this.deliver(this.session.close(conn, this.now));
  }

  /** Advance the clock by `ms`, running every tick the session asks for on the way. */
  advance(ms: number): void {
    const target = this.now + ms;
    for (let i = 0; i < 100_000; i++) {
      const wake = this.session.nextWakeAt();
      if (wake === null || wake > target) break;
      this.now = Math.max(this.now, wake);
      this.deliver(this.session.tick(this.now));
    }
    this.now = target;
    this.deliver(this.session.tick(this.now));
  }

  messages<T extends ServerMessageType>(
    conn: ConnId,
    type: T,
  ): Extract<ServerMessage, { type: T }>[] {
    return (this.inbox.get(conn) ?? []).filter(
      (m): m is Extract<ServerMessage, { type: T }> => m.type === type,
    );
  }

  last<T extends ServerMessageType>(
    conn: ConnId,
    type: T,
  ): Extract<ServerMessage, { type: T }> | undefined {
    const all = this.messages(conn, type);
    return all[all.length - 1];
  }

  clear(conn: ConnId): void {
    this.inbox.set(conn, []);
  }
}
