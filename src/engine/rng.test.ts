import { describe, expect, it } from 'vitest';
import { Rng, nextU32, seedToState } from './rng';

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = Rng.fromSeed(42);
    const b = Rng.fromSeed(42);
    const xs = Array.from({ length: 100 }, () => a.nextU32());
    const ys = Array.from({ length: 100 }, () => b.nextU32());
    expect(xs).toEqual(ys);
    expect(a.state).toBe(b.state);
  });

  it('differs across seeds, and number vs string seeds', () => {
    expect(Rng.fromSeed(1).nextU32()).not.toBe(Rng.fromSeed(2).nextU32());
    expect(seedToState(7)).not.toBe(seedToState('7'));
  });

  it('can resume from a saved state', () => {
    const a = Rng.fromSeed('resume');
    a.nextU32();
    const saved = a.state;
    const next = a.nextU32();
    expect(new Rng(saved).nextU32()).toBe(next);
  });

  it('nextU32 is pure', () => {
    expect(nextU32(123)).toEqual(nextU32(123));
  });

  it('state stays a JSON-safe uint32', () => {
    const r = Rng.fromSeed('x');
    for (let i = 0; i < 1000; i++) {
      r.nextU32();
      expect(Number.isInteger(r.state)).toBe(true);
      expect(r.state).toBeGreaterThanOrEqual(0);
      expect(r.state).toBeLessThan(2 ** 32);
    }
  });

  it('int and die stay in range and cover all values', () => {
    const r = Rng.fromSeed(9);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const d = r.die();
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(6);
      seen.add(d);
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
    expect(seen.size).toBe(6);
  });

  it('dice are roughly uniform', () => {
    const r = Rng.fromSeed('uniform');
    const counts = [0, 0, 0, 0, 0, 0];
    const n = 60_000;
    for (let i = 0; i < n; i++) counts[r.die() - 1]! += 1;
    for (const c of counts) expect(Math.abs(c - n / 6)).toBeLessThan(n * 0.01);
  });

  it('shuffle returns a permutation and leaves input alone', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = Rng.fromSeed(3).shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort()).toEqual(input);
  });
});
