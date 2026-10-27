/** Autosave: one session in localStorage. Every storage access is wrapped (private mode, quota...). */
import { upgradeState, type GameState, type PlayerId } from '../engine';
import { isBotLevel, type BotLevel } from '../bots/levels';
import type { Controller } from '../ui';

export const SAVE_KEY = 'catan:save:v1';
export const SPEED_KEY = 'catan:botSpeed';
/** #51: "Show longest road on the board" (1 = on; default off). */
export const LONGEST_ROAD_KEY = 'catan:showLongestRoad';

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
  /** Chess clock (settings.timer) only: each player's bank in ms. */
  banks?: number[];
  /**
   * UX2: wall-clock time played so far in ms (the whole game once it is over); absent in older
   * saves (the stats screen then shows no duration). Time between sessions does not count.
   */
  playedMs?: number;
  /** B1: each seat's bot level (indexed like `seats`); absent in older saves = all Normal. */
  botLevels?: BotLevel[];
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
    // Engine state of any schema version we ever saved, upgraded to the current one (v1 -> v2).
    const state = upgradeState(s.state);
    if (s.version !== 1 || !state) return null;
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
      // Checked again by restoreBanks when the game resumes.
      ...(Array.isArray(s.banks) ? { banks: s.banks } : {}),
      ...(typeof s.playedMs === 'number' && Number.isFinite(s.playedMs) && s.playedMs >= 0
        ? { playedMs: s.playedMs }
        : {}),
      ...(Array.isArray(s.botLevels) &&
      s.botLevels.length === s.seats.length &&
      s.botLevels.every(isBotLevel)
        ? { botLevels: s.botLevels }
        : {}),
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
