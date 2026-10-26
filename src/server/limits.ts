/**
 * Server-side abuse limits (on top of GameSession's per-member limits, docs/MULTIPLAYER.md §11).
 * Pure: time comes in as `now` (ms).
 */
import { LIMITS, RATE_LIMITS } from '../net/protocol';

export interface Rate {
  burst: number;
  perSec: number;
}

const sum = (key: keyof Rate) =>
  Object.values(RATE_LIMITS).reduce((n, r) => n + r[key], 0 as number);

export const SERVER_LIMITS = {
  /** Every frame of one socket, before parsing: all of a member's session buckets together. */
  frame: { burst: sum('burst'), perSec: sum('perSec') } satisfies Rate,
  /** Frames dropped in a row by `frame` before the socket is closed (1008). */
  frameStrikes: 20,
  /** Raw frame size; the session checks it too, this rejects before decoding. */
  messageChars: LIMITS.messageChars,
  /** Open sockets per room (members plus a few that have not said hello yet). */
  socketsPerRoom: LIMITS.members + 8,
  /** Open sockets per room from one IP (a household on one router, several tabs). */
  socketsPerIp: 12,
  /** A socket that has not sent hello this long may be dropped to make room. */
  helloTimeoutMs: 15_000,
  /** Per IP, per Worker isolate: rooms created. */
  create: { burst: 5, perSec: 1 / 60 } satisfies Rate,
  /** Per IP, per Worker isolate: room lookups and socket upgrades. */
  lookup: { burst: 30, perSec: 2 } satisfies Rate,
  /** Fresh codes tried when a generated one is taken. */
  createAttempts: 8,
} as const;

/** One token bucket. `take` refills by elapsed time, then spends one token if it can. */
export class TokenBucket {
  private tokens: number;
  private at: number;

  constructor(
    private readonly rate: Rate,
    now: number,
  ) {
    this.tokens = rate.burst;
    this.at = now;
  }

  take(now: number): boolean {
    this.refill(now);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** True once the bucket is back to its burst (the key can be forgotten). */
  full(now: number): boolean {
    this.refill(now);
    return this.tokens >= this.rate.burst;
  }

  private refill(now: number): void {
    if (now > this.at) {
      this.tokens = Math.min(
        this.rate.burst,
        this.tokens + ((now - this.at) / 1000) * this.rate.perSec,
      );
      this.at = now;
    }
  }
}

/** Token buckets by key (IP). Memory is bounded: full buckets are swept, then the oldest go. */
export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly rate: Rate,
    private readonly maxKeys = 10_000,
  ) {}

  take(key: string, now: number): boolean {
    let b = this.buckets.get(key);
    if (b) {
      this.buckets.delete(key); // re-insert: Map order = least recently used first
    } else {
      if (this.buckets.size >= this.maxKeys) this.sweep(now);
      b = new TokenBucket(this.rate, now);
    }
    this.buckets.set(key, b);
    return b.take(now);
  }

  get size(): number {
    return this.buckets.size;
  }

  private sweep(now: number): void {
    for (const [k, b] of this.buckets) if (b.full(now)) this.buckets.delete(k);
    for (const k of this.buckets.keys()) {
      if (this.buckets.size < this.maxKeys) break;
      this.buckets.delete(k);
    }
  }
}
