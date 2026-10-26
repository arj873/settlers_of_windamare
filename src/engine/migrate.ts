/**
 * Saved-state upgrades. `upgradeState(raw)` accepts any schema version we ever wrote and returns a
 * current (v3) GameState, or null when `raw` is not a state we understand.
 *
 *   v1 -> v2: settings.layout ('beginner'|'random') becomes settings.map ('base'|'baseRandom');
 *             new settings get their defaults (discardLimit 7, specialBuildPhase false — v1 games
 *             have at most 4 players — balancedDice/hideBankCards false, turnTimerSec null).
 *   v2 -> v3: new `diceDeck` (balanced dice), empty: the next balanced roll shuffles a fresh deck.
 *             v2 states never contain the specialBuild phase (it did not exist), so a v2 game
 *             with specialBuildPhase on simply starts using it at its next endTurn.
 */
import { DEFAULT_DISCARD_LIMIT } from './constants';
import { isMapId } from './maps';
import type { GameSettings, GameState } from './types';

export const SCHEMA_VERSION = 3;

interface SettingsV1 {
  seed: number | string;
  layout: 'beginner' | 'random';
  vpToWin: number;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function upgradeSettingsV1(s: SettingsV1): GameSettings {
  return {
    seed: s.seed,
    map: s.layout === 'beginner' ? 'base' : 'baseRandom',
    vpToWin: s.vpToWin,
    discardLimit: DEFAULT_DISCARD_LIMIT,
    balancedDice: false,
    specialBuildPhase: false,
    hideBankCards: false,
    turnTimerSec: null,
  };
}

/** v2 -> v3 on an already validated v2 state. */
function upgradeV2(raw: Record<string, unknown>): GameState {
  return { ...(raw as unknown as GameState), schemaVersion: 3, diceDeck: [] };
}

export function upgradeState(raw: unknown): GameState | null {
  if (!isObject(raw) || !isObject(raw.settings) || !Array.isArray(raw.players)) return null;
  if (raw.schemaVersion === 1) {
    const s = raw.settings;
    if (s.layout !== 'beginner' && s.layout !== 'random') return null;
    if (typeof s.vpToWin !== 'number') return null;
    if (typeof s.seed !== 'number' && typeof s.seed !== 'string') return null;
    const settings = upgradeSettingsV1({ seed: s.seed, layout: s.layout, vpToWin: s.vpToWin });
    return upgradeV2({ ...raw, schemaVersion: 2, settings });
  }
  if (raw.schemaVersion === 2) return isMapId(raw.settings.map) ? upgradeV2(raw) : null;
  if (raw.schemaVersion === 3) {
    if (!isMapId(raw.settings.map) || !Array.isArray(raw.diceDeck)) return null;
    return raw as unknown as GameState;
  }
  return null;
}
