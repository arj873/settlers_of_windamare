import { describe, expect, it } from 'vitest';
import { RATE_LIMITS } from '../net/protocol';
import { RateLimiter, SERVER_LIMITS, TokenBucket } from './limits';
import { originAllowed, parseOrigins } from './origin';

describe('TokenBucket / RateLimiter', () => {
  it('allows a burst, then refills at perSec', () => {
    const b = new TokenBucket({ burst: 2, perSec: 1 }, 0);
    expect([b.take(0), b.take(0), b.take(0)]).toEqual([true, true, false]);
    expect(b.take(500)).toBe(false);
    expect(b.take(1000)).toBe(true);
    expect(b.full(10_000)).toBe(true);
  });

  it('keys are independent and memory is bounded', () => {
    const r = new RateLimiter({ burst: 1, perSec: 0.001 }, 3);
    expect(r.take('a', 0)).toBe(true);
    expect(r.take('a', 0)).toBe(false);
    expect(r.take('b', 0)).toBe(true);
    for (const k of ['c', 'd', 'e']) r.take(k, 0);
    expect(r.size).toBeLessThanOrEqual(3);
  });

  it('per-socket frame limit is every session bucket together', () => {
    const kinds = Object.values(RATE_LIMITS);
    expect(SERVER_LIMITS.frame.burst).toBe(kinds.reduce((n, k) => n + k.burst, 0));
    expect(SERVER_LIMITS.frame.perSec).toBe(kinds.reduce((n, k) => n + k.perSec, 0));
  });
});

describe('originAllowed', () => {
  const prod = new URL('https://game.example/api/rooms');
  const dev = new URL('http://127.0.0.1:8787/api/rooms');

  it('no Origin (not a browser) and the same host pass', () => {
    expect(originAllowed(null, prod, [])).toBe(true);
    expect(originAllowed('https://game.example', prod, [])).toBe(true);
  });

  it('other sites, opaque and non-http origins fail', () => {
    expect(originAllowed('https://evil.example', prod, [])).toBe(false);
    expect(originAllowed('https://game.example.evil.example', prod, [])).toBe(false);
    expect(originAllowed('null', prod, [])).toBe(false);
    expect(originAllowed('file://', prod, [])).toBe(false);
    expect(originAllowed('http://localhost:5173', prod, [])).toBe(false);
  });

  it('loopback to loopback (wrangler dev + Vite), and listed extras', () => {
    expect(originAllowed('http://localhost:5173', dev, [])).toBe(true);
    expect(originAllowed('https://friend.example', prod, ['https://friend.example'])).toBe(true);
  });

  it('parseOrigins normalizes and drops junk', () => {
    expect(parseOrigins(undefined)).toEqual([]);
    expect(parseOrigins('https://a.example/, nope  http://b.example:8080')).toEqual([
      'https://a.example',
      'http://b.example:8080',
    ]);
  });
});
