/**
 * Seeded RNG (sfc32). The whole generator state is four uint32 words (128 bits), stored in
 * `GameState.rng`, so applyAction stays a pure function of (state, action).
 *
 * Usage inside a handler (draft is already a private copy):
 *   const rng = new Rng(draft.rng);
 *   const die = rng.die();
 *   draft.rng = rng.state;   // ALWAYS write the state back
 *
 * The state is 128 bits and seeded from the full seed (cyrb128), so an online player who sees
 * the board cannot brute-force the start state and predict the dev deck or the dice: a 32-bit
 * state could (security review, s15). Not a CSPRNG; the seed itself comes from one (server).
 */

/** sfc32 state `[a, b, c, counter]`, each a uint32. JSON-safe. */
export type RngState = [number, number, number, number];

/** Outputs discarded after seeding (the usual sfc32 warm-up). */
const WARM_UP = 12;

export function isRngState(x: unknown): x is RngState {
  return (
    Array.isArray(x) &&
    x.length === 4 &&
    x.every((w) => typeof w === 'number' && Number.isInteger(w) && w >= 0 && w <= 0xffffffff)
  );
}

/** Hash a seed (number or string) to an RNG state: cyrb128, 4 lanes over the whole text. */
export function seedToState(seed: number | string): RngState {
  const text = typeof seed === 'number' ? `n:${seed}` : `s:${seed}`;
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return warmUp([h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]);
}

/**
 * Expand a uint32 into a full state (splitmix32, four outputs). Used for the old one-word
 * `rng: number` of saves before v6 (migrate.ts) and for `new Rng(n)` with a small number
 * (bots, art, tests). Deterministic: the same number always gives the same state.
 */
export function expandState(n: number): RngState {
  let x = n >>> 0;
  const words: number[] = [];
  for (let i = 0; i < 4; i++) {
    x = (x + 0x9e3779b9) >>> 0;
    let t = x ^ (x >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    words.push(t >>> 0);
  }
  return warmUp(words as RngState);
}

function warmUp(state: RngState): RngState {
  const rng = new Rng(state);
  for (let i = 0; i < WARM_UP; i++) rng.nextU32();
  return rng.state;
}

/** Pure step: returns [uint32 output, next state]. */
export function nextU32(state: RngState): [number, RngState] {
  const rng = new Rng(state);
  const out = rng.nextU32();
  return [out, rng.state];
}

/** Small mutable wrapper around a copied state. Read `.state` back when done. */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  /** A state, or a uint32 expanded with `expandState` (old saves, bot and test seeds). */
  constructor(state: RngState | number) {
    const [a, b, c, d] = typeof state === 'number' ? expandState(state) : state;
    this.a = a >>> 0;
    this.b = b >>> 0;
    this.c = c >>> 0;
    this.d = d >>> 0;
  }

  static fromSeed(seed: number | string): Rng {
    return new Rng(seedToState(seed));
  }

  /** A fresh copy of the current state (safe to store in a GameState). */
  get state(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  /** One sfc32 step. */
  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    const c = this.c;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (c + (c << 3)) >>> 0;
    this.c = (((c << 21) | (c >>> 11)) + t) >>> 0;
    this.d = (this.d + 1) >>> 0;
    return t >>> 0;
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
