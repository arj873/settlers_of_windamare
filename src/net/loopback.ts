/**
 * A room server without a network: a GameSession on LocalNet whose messages are pushed to
 * attached sinks, with its tick alarm on an injected clock. The client tests run it on a
 * FakeClock; the in-browser dev server (src/game/online/devServer.ts) runs it on real timers.
 */
import { PING, PONG } from './protocol';
import type { ConnId, GameSession, Outbound } from './session';
import { LocalNet } from './testHarness';
import type { Clock, Connect, TimerHandle, Transport } from './transport';

/** Where a connection's frames go (a client transport, a MessagePort...). */
export interface Sink {
  message(text: string): void;
  close(code: number, reason: string): void;
}

/** Deterministic clock with a timer queue (tests). */
export class FakeClock implements Clock {
  private t: number;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();

  constructor(start = 0) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as number);
  }

  /** Move time forward by `ms`, running due timers in order (timers they set included). */
  advance(ms: number): void {
    const target = this.t + ms;
    for (let i = 0; i < 1_000_000; i++) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.timers) {
        if (e[1].at <= target && (!next || e[1].at < next[1].at)) next = e;
      }
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = Math.max(this.t, next[1].at);
      next[1].fn();
    }
    this.t = target;
  }

  /** Run everything due now (deferred deliveries). */
  flush(): void {
    this.advance(0);
  }

  get pending(): number {
    return this.timers.size;
  }
}

/**
 * One room: the session, its connections and its alarm. Every event stamps `now` from the clock,
 * delivers the session's output (deferred by 0 ms, like a socket), then re-arms the alarm at
 * `nextWakeAt()`.
 */
export class RoomHost {
  readonly net: LocalNet;
  private readonly sinks = new Map<ConnId, Sink>();
  private alarm: TimerHandle | null = null;
  private alarmAt: number | null = null;

  constructor(
    readonly session: GameSession,
    private readonly clock: Clock,
  ) {
    const route = (out: readonly Outbound[]) => this.route(out);
    this.net = new (class extends LocalNet {
      override deliver(out: readonly Outbound[]): void {
        route(out);
      }
    })(session, clock.now());
  }

  get connections(): number {
    return this.sinks.size;
  }

  /** A socket was accepted. */
  attach(conn: ConnId, sink: Sink): void {
    this.sinks.set(conn, sink);
    this.stamp();
    this.net.connect(conn);
    this.rearm();
  }

  /** A frame from the client. The keep-alive ping is answered without the session. */
  frame(conn: ConnId, text: string): void {
    if (!this.sinks.has(conn)) return;
    if (text === PING) {
      const sink = this.sinks.get(conn);
      this.later(() => sink?.message(PONG));
      return;
    }
    this.stamp();
    this.net.sendRaw(conn, text);
    this.rearm();
  }

  /** The socket closed (either side). */
  detach(conn: ConnId): void {
    if (!this.sinks.delete(conn)) return;
    this.stamp();
    this.net.disconnect(conn);
    this.rearm();
  }

  /** Test aid: the network drops the connection (the client sees 1006). */
  cut(conn: ConnId): void {
    const sink = this.sinks.get(conn);
    if (!sink) return;
    this.detach(conn);
    this.later(() => sink.close(1006, 'connection lost'));
  }

  /** Every connection id currently attached. */
  conns(): ConnId[] {
    return [...this.sinks.keys()];
  }

  dispose(): void {
    if (this.alarm !== null) this.clock.clearTimeout(this.alarm);
    this.alarm = null;
  }

  private stamp(): void {
    this.net.now = Math.max(this.net.now, this.clock.now());
  }

  private route(out: readonly Outbound[]): void {
    for (const o of out) {
      const sink = this.sinks.get(o.conn);
      if (!sink) continue;
      if (o.kind === 'close') {
        this.sinks.delete(o.conn);
        this.later(() => {
          sink.close(o.code, o.reason);
          // Like a socket runtime: the server-side close event follows.
          this.stamp();
          this.net.disconnect(o.conn);
          this.rearm();
        });
      } else {
        const text = JSON.stringify(o.msg);
        this.later(() => sink.message(text));
      }
    }
  }

  private later(fn: () => void): void {
    this.clock.setTimeout(fn, 0);
  }

  private rearm(): void {
    const at = this.session.nextWakeAt();
    if (at === this.alarmAt) return;
    if (this.alarm !== null) this.clock.clearTimeout(this.alarm);
    this.alarm = null;
    this.alarmAt = at;
    if (at === null) return;
    this.alarm = this.clock.setTimeout(
      () => {
        this.alarm = null;
        this.alarmAt = null;
        this.stamp();
        this.net.deliver(this.session.tick(this.net.now));
        this.rearm();
      },
      Math.max(0, at - this.clock.now()),
    );
  }
}

/**
 * `Connect` for RoomClient straight into a RoomHost (tests, single-tab dev server). `offline()`
 * makes new connections fail like an unreachable server.
 */
export function hostConnect(
  host: RoomHost,
  clock: Clock,
  opts: { offline?: () => boolean; prefix?: string } = {},
): Connect {
  let n = 0;
  return (handlers) => {
    const conn = `${opts.prefix ?? 'c'}${++n}`;
    let closed = false;
    const sink: Sink = {
      message: (text) => {
        if (!closed) handlers.onMessage(text);
      },
      close: (code, reason) => {
        if (closed) return;
        closed = true;
        handlers.onClose(code, reason);
      },
    };
    const down = opts.offline?.() ?? false;
    clock.setTimeout(() => {
      if (closed) return;
      if (down) {
        sink.close(1006, 'unreachable');
        return;
      }
      host.attach(conn, sink);
      handlers.onOpen();
    }, 0);
    const transport: Transport = {
      send: (text) => {
        if (!closed && !down) host.frame(conn, text);
      },
      close: () => {
        if (closed) return;
        host.detach(conn);
        clock.setTimeout(() => sink.close(1000, 'closed'), 0);
      },
    };
    return transport;
  };
}
