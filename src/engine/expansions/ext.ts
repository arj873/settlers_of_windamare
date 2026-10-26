/** Helpers for expansion state slices (state.ext[id]) and namespaced ids. */
import type { ExpansionId, GameState, HexId } from '../types';

/** Deep copy of plain JSON data (objects, arrays, primitives). */
export function cloneJson<T>(x: T): T {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map(cloneJson) as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(x)) out[k] = cloneJson((x as Record<string, unknown>)[k]);
  return out as T;
}

/** The slice of expansion `id`. Throws if the game has none (module not active or not initialised). */
export function extSlice<T>(state: Pick<GameState, 'ext'>, id: ExpansionId): T {
  const s = state.ext[id];
  if (s === undefined) throw new Error(`no state for expansion ${id}`);
  return s as T;
}

/** The expansion id of a namespaced id ('demo/buildWell' -> 'demo'), or null for a base id. */
export function namespaceOf(id: string): ExpansionId | null {
  const i = id.indexOf('/');
  return i > 0 ? id.slice(0, i) : null;
}

/**
 * `state.robber` for modes without a robber (E&P): an off-board hex, so the board view draws no
 * robber and no rule finds buildings around it. Relax the 'robber-position' invariant with it.
 */
export const NO_ROBBER: HexId = 'h:999,999';

/**
 * Doubled-column board tables (docs/rules/explorers-pirates.md §2.0) to an axial hex id:
 * q = (c - r - p) / 2. `p` = parity of row 0 (1 for 3-4 player maps, 0 for 5-6).
 */
export function doubledToHexId(c: number, r: number, p: 0 | 1): HexId {
  const q = (c - r - p) / 2;
  if (!Number.isInteger(q)) throw new Error(`(${c}, ${r}) is not a position with parity ${p}`);
  return `h:${q + 0},${r + 0}`;
}

/** True for a namespaced (expansion) id. */
export function isNamespaced(id: string): id is `${string}/${string}` {
  return namespaceOf(id) !== null;
}
