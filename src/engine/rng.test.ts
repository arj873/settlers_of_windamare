import { describe, expect, it } from 'vitest';
import { Rng, expandState, isRngState, nextU32, seedToState, type RngState } from './rng';

/** The seed hash before s15 (FNV-1a 32), kept here only to show what it could not tell apart. */
function oldFnv1a32(seed: string): number {
  const text = `s:${seed}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Reference sfc32 (Chris Doty-Humphrey's PractRand, common JS port). */
function referenceSfc32([a0, b0, c0, d0]: RngState): () => number {
  let a = a0 | 0,
    b = b0 | 0,
    c = c0 | 0,
    d = d0 | 0;
  return () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
}

const firstOutputs = (rng: Rng, n = 8) => Array.from({ length: n }, () => rng.nextU32());

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = Rng.fromSeed(42);
    const b = Rng.fromSeed(42);
    const xs = Array.from({ length: 100 }, () => a.nextU32());
    const ys = Array.from({ length: 100 }, () => b.nextU32());
    expect(xs).toEqual(ys);
    expect(a.state).toEqual(b.state);
  });

  it('pins the stream (a change here changes every seed: boards, decks, rolls)', () => {
    expect(seedToState('catan')).toEqual([13412008, 2441959903, 2175355947, 2934693422]);
    expect(firstOutputs(Rng.fromSeed('catan'), 4)).toEqual([
      1095098037, 3483708197, 973563219, 1383231719,
    ]);
  });

  it('steps exactly like reference sfc32', () => {
    const start = seedToState('reference');
    const ref = referenceSfc32(start);
    const rng = new Rng(start);
    for (let i = 0; i < 1000; i++) expect(rng.nextU32()).toBe(ref());
  });

  it('differs across seeds, and number vs string seeds', () => {
    expect(Rng.fromSeed(1).nextU32()).not.toBe(Rng.fromSeed(2).nextU32());
    expect(seedToState(7)).not.toEqual(seedToState('7'));
  });

  it('seeds that collided under the old 32-bit hash now give different streams', () => {
    expect(oldFnv1a32('room-663637')).toBe(oldFnv1a32('room-1014980'));
    expect(seedToState('room-663637')).not.toEqual(seedToState('room-1014980'));
    expect(firstOutputs(Rng.fromSeed('room-663637'))).not.toEqual(
      firstOutputs(Rng.fromSeed('room-1014980')),
    );
  });

  it('a seed differing only in its last character gives a different stream', () => {
    const seed = '6b8d381d2b90e1097f67d48aada97f88'; // 128-bit hex, like the server's
    const other = `${seed.slice(0, -1)}9`;
    expect(firstOutputs(Rng.fromSeed(seed))).not.toEqual(firstOutputs(Rng.fromSeed(other)));
    // Every word of the state depends on the last character.
    const [a, b] = [seedToState(seed), seedToState(other)];
    for (let i = 0; i < 4; i++) expect(a[i]).not.toBe(b[i]);
  });

  it('state is 128 bits: 4 uint32 words, JSON-safe, all of them moving', () => {
    const r = Rng.fromSeed('x');
    const words: Set<number>[] = [new Set(), new Set(), new Set(), new Set()];
    for (let i = 0; i < 1000; i++) {
      r.nextU32();
      const s = r.state;
      expect(isRngState(s)).toBe(true);
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
      s.forEach((w, k) => words[k]!.add(w));
    }
    for (const w of words) expect(w.size).toBe(1000);
  });

  it('two states equal in three words but not the fourth give different streams', () => {
    const base = seedToState('words');
    for (let k = 0; k < 4; k++) {
      const changed = [...base] as RngState;
      changed[k] = (changed[k]! ^ 1) >>> 0;
      expect(firstOutputs(new Rng(changed))).not.toEqual(firstOutputs(new Rng(base)));
    }
  });

  it('.state is a copy: storing it does not tie it to the generator', () => {
    const r = Rng.fromSeed('copy');
    const saved = r.state;
    const before = [...saved];
    r.nextU32();
    expect(saved).toEqual(before);
  });

  it('can resume from a saved state', () => {
    const a = Rng.fromSeed('resume');
    a.nextU32();
    const saved = JSON.parse(JSON.stringify(a.state)) as RngState;
    const next = a.nextU32();
    expect(new Rng(saved).nextU32()).toBe(next);
  });

  it('nextU32 is pure and matches the class', () => {
    const s = seedToState('pure');
    const copy = [...s];
    expect(nextU32(s)).toEqual(nextU32(s));
    expect(s).toEqual(copy);
    const r = new Rng(s);
    expect(nextU32(s)).toEqual([r.nextU32(), r.state]);
  });

  it('a number expands deterministically (splitmix32 x4), for old saves and small seeds', () => {
    expect(expandState(123)).toEqual(expandState(123));
    expect(expandState(123)).not.toEqual(expandState(124));
    expect(isRngState(expandState(0))).toBe(true);
    expect(isRngState(expandState(0xffffffff))).toBe(true);
    expect(firstOutputs(new Rng(123))).toEqual(firstOutputs(new Rng(expandState(123))));
  });

  it('isRngState accepts only four uint32 words', () => {
    expect(isRngState([0, 1, 2, 0xffffffff])).toBe(true);
    expect(isRngState(5)).toBe(false);
    expect(isRngState([1, 2, 3])).toBe(false);
    expect(isRngState([1, 2, 3, -1])).toBe(false);
    expect(isRngState([1, 2, 3, 2 ** 32])).toBe(false);
    expect(isRngState([1, 2, 3, 0.5])).toBe(false);
    expect(isRngState([1, 2, 3, '4'])).toBe(false);
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

  it('bits are balanced and consecutive outputs uncorrelated', () => {
    const r = Rng.fromSeed('bits');
    const n = 20_000;
    const ones = new Array<number>(32).fill(0);
    let same = 0;
    let prev = r.nextU32();
    for (let i = 0; i < n; i++) {
      const x = r.nextU32();
      for (let b = 0; b < 32; b++) ones[b]! += (x >>> b) & 1;
      if (x >>> 31 === prev >>> 31) same++;
      prev = x;
    }
    // 5 sigma for a fair coin: 5 * sqrt(n) / 2 ~ 354.
    for (const c of ones) expect(Math.abs(c - n / 2)).toBeLessThan(360);
    expect(Math.abs(same - n / 2)).toBeLessThan(360);
  });

  it('shuffle returns a permutation and leaves input alone', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = Rng.fromSeed(3).shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort()).toEqual(input);
  });
});
