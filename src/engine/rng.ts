/**
 * Seeded RNG (mulberry32). The whole generator state is one uint32, stored in `GameState.rng`,
 * so applyAction stays a pure function of (state, action).
 *
 * Usage inside a handler (draft is already a private copy):
 *   const rng = new Rng(draft.rng);
 *   const die = rng.int(6) + 1;
 *   draft.rng = rng.state;   // ALWAYS write the state back
 */

/** Hash a seed (number or string) to a uint32 RNG state. */
export function seedToState(seed: number | string): number {
  const text = typeof seed === 'number' ? `n:${seed}` : `s:${seed}`;
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Pure step: returns [uint32 output, next state]. */
export function nextU32(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [(t ^ (t >>> 14)) >>> 0, s];
}

/** Small mutable wrapper around a copied state. Read `.state` back when done. */
export class Rng {
  state: number;

  constructor(state: number) {
    this.state = state >>> 0;
  }

  static fromSeed(seed: number | string): Rng {
    return new Rng(seedToState(seed));
  }

  nextU32(): number {
    const [out, next] = nextU32(this.state);
    this.state = next;
    return out;
  }

  /** Float in [0, 1). */
  float(): number {
    return this.nextU32() / 0x100000000;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  /** One fair six-sided die, 1..6. */
  die(): number {
    return this.int(6) + 1;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on empty array');
    return items[this.int(items.length)] as T;
  }

  /** Returns a new shuffled array (Fisher–Yates). Input is not modified. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }
}
