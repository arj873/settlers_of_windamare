/** Autosave: one session in localStorage. Every storage access is wrapped (private mode, quota...). */
import type { GameState, PlayerId } from '../engine';
import type { Controller } from '../ui';

export const SAVE_KEY = 'catan:save:v1';
export const SPEED_KEY = 'catan:botSpeed';

/** The subset of `Storage` we use (tests pass a Map-backed fake). */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SavedSession {
  version: 1;
  state: GameState;
  seats: Controller[];
  /** Last human viewer (restores the hotseat screen without a pass-device cover). */
  viewer: PlayerId | null;
  /** The bots' private RNG state, so a resumed game keeps the same bot choices. */
  botRng: number;
}

/** `window.localStorage`, or null when it is unavailable or throws on access. */
export function browserStorage(): KeyValueStore | null {
  try {
    const s = globalThis.localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

export function saveSession(store: KeyValueStore | null, session: SavedSession): boolean {
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, JSON.stringify(session));
    return true;
  } catch (e) {
    console.warn('autosave failed', e);
    return false;
  }
}

export function clearSession(store: KeyValueStore | null): void {
  try {
    store?.removeItem(SAVE_KEY);
  } catch {
    /* nothing to clean up */
  }
}

/** The saved session, or null when there is none or it does not look like one of ours. */
export function loadSession(store: KeyValueStore | null): SavedSession | null {
  let raw: string | null;
  try {
    raw = store?.getItem(SAVE_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<SavedSession>;
    const state = s.state;
    if (s.version !== 1 || !state || state.schemaVersion !== 1) return null;
    if (!Array.isArray(state.players) || !Array.isArray(s.seats)) return null;
    if (s.seats.length !== state.players.length) return null;
    if (!s.seats.every((c) => c === 'human' || c === 'bot')) return null;
    const viewer =
      typeof s.viewer === 'number' && s.viewer >= 0 && s.viewer < s.seats.length ? s.viewer : null;
    return {
      version: 1,
      state,
      seats: s.seats,
      viewer,
      botRng: typeof s.botRng === 'number' ? s.botRng >>> 0 : 1,
    };
  } catch {
    return null;
  }
}

export function loadNumber(store: KeyValueStore | null, key: string): number | null {
  try {
    const v = store?.getItem(key);
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function saveNumber(store: KeyValueStore | null, key: string, n: number): void {
  try {
    store?.setItem(key, String(n));
  } catch {
    /* preference only */
  }
}
