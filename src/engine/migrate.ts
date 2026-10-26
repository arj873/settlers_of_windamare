/**
 * Saved-state upgrades. `upgradeState(raw)` accepts any schema version we ever wrote and returns a
 * current (v4) GameState, or null when `raw` is not a state we understand.
 *
 *   v1 -> v2: settings.layout ('beginner'|'random') becomes settings.map ('base'|'baseRandom');
 *             new settings get their defaults (discardLimit 7, specialBuildPhase false — v1 games
 *             have at most 4 players — balancedDice/hideBankCards false, turnTimerSec null).
 *   v2 -> v3: new `diceDeck` (balanced dice), empty: the next balanced roll shuffles a fresh deck.
 *             v2 states never contain the specialBuild phase (it did not exist), so a v2 game
 *             with specialBuildPhase on simply starts using it at its next endTurn.
 *   v3 -> v4: new settings.startingPlayer (T14). Every earlier game started with seat 0.
 * Log texts are not migrated: older logs say "Blue rolled 8" without the dice faces.
 */
import { DEFAULT_DISCARD_LIMIT } from './constants';
import { isMapId } from './maps';
import type { GameSettings, GameState } from './types';

export const SCHEMA_VERSION = 4;

interface SettingsV1 {
  seed: number | string;
  layout: 'beginner' | 'random';
  vpToWin: number;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function upgradeSettingsV1(s: SettingsV1): Omit<GameSettings, 'startingPlayer'> {
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

/** v3 -> v4 on an already validated v3 state. */
function upgradeV3(raw: Record<string, unknown>): GameState {
  const settings = { ...(raw.settings as GameSettings), startingPlayer: 0 };
  return { ...(raw as unknown as GameState), schemaVersion: 4, settings };
}

/** v2 -> v3 (-> v4) on an already validated v2 state. */
function upgradeV2(raw: Record<string, unknown>): GameState {
  return upgradeV3({ ...raw, schemaVersion: 3, diceDeck: [] });
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
    return upgradeV3(raw);
  }
  if (raw.schemaVersion === 4) {
    const s = raw.settings;
    if (!isMapId(s.map) || !Array.isArray(raw.diceDeck)) return null;
    const first = s.startingPlayer;
    if (typeof first !== 'number' || !Number.isInteger(first)) return null;
    if (first < 0 || first >= raw.players.length) return null;
    return raw as unknown as GameState;
  }
  return null;
}
