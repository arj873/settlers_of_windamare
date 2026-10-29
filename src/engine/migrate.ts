/**
 * Saved-state upgrades. `upgradeState(raw)` accepts any schema version we ever wrote and returns a
 * current (v6) GameState, or null when `raw` is not a state we understand.
 *
 *   v1 -> v2: settings.layout ('beginner'|'random') becomes settings.map ('base'|'baseRandom');
 *             new settings get their defaults (discardLimit 7, specialBuildPhase false — v1 games
 *             have at most 4 players — balancedDice/hideBankCards false, turnTimerSec null).
 *   v2 -> v3: new `diceDeck` (balanced dice), empty: the next balanced roll shuffles a fresh deck.
 *             v2 states never contain the specialBuild phase (it did not exist), so a v2 game
 *             with specialBuildPhase on simply starts using it at its next endTurn.
 *   v3 -> v4: new settings.startingPlayer (T14). Every earlier game started with seat 0.
 *   v4 -> v5: expansion framework (F1): settings.mode 'base', expansions [], scenario null,
 *             options {}, and state.ext {}. A v5 save naming an expansion, mode or scenario this
 *             build does not know is rejected (null). Expansions version their own slices.
 *   v5 -> v6: rng becomes the 128-bit sfc32 state (security review s15): the old uint32 is
 *             expanded with splitmix32 (`expandState`), so an old game keeps a deterministic,
 *             though different, stream from there on.
 * Log texts are not migrated: older logs say "Blue rolled 8" without the dice faces.
 * V1/V2 variant fields (settings.robberMode, mapRules, rules56, eventDeck, ...) and UX2 stats are
 * optional and absent in older saves, where absent means the official rule (stats: recording
 * starts at the next action), so they need no step: every upgrade above keeps them as they are.
 */
import { DEFAULT_DISCARD_LIMIT } from './constants';
import { isExpansionId, modeById, scenarioById } from './expansions/registry';
import { isMapId } from './mapLookup';
import { isBaseMapId } from './maps';
import { expandState, isRngState } from './rng';
import type { GameSettings, GameState } from './types';

export const SCHEMA_VERSION = 6;

interface SettingsV1 {
  seed: number | string;
  layout: 'beginner' | 'random';
  vpToWin: number;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function upgradeSettingsV1(
  s: SettingsV1,
): Omit<GameSettings, 'startingPlayer' | 'mode' | 'expansions' | 'scenario' | 'options'> {
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

/** v5 -> v6 on an already validated v5 state: the uint32 rng becomes a 128-bit state. */
function upgradeV5(raw: Record<string, unknown>): GameState | null {
  if (typeof raw.rng !== 'number' || !Number.isInteger(raw.rng)) return null;
  const rng = expandState(raw.rng);
  return { ...(raw as unknown as GameState), schemaVersion: 6, rng };
}

/** v4 -> v5 (-> v6) on an already validated v4 state: base-game expansion fields (F1). */
function upgradeV4(raw: Record<string, unknown>): GameState | null {
  const settings: GameSettings = {
    ...(raw.settings as GameSettings),
    mode: 'base',
    expansions: [],
    scenario: null,
    options: {},
  };
  return upgradeV5({ ...raw, schemaVersion: 5, settings, ext: {} });
}

/** v3 -> v4 (-> v5) on an already validated v3 state. */
function upgradeV3(raw: Record<string, unknown>): GameState | null {
  const settings = { ...(raw.settings as GameSettings), startingPlayer: 0 };
  return upgradeV4({ ...raw, schemaVersion: 4, settings });
}

/** v5 and v6: every expansion, mode and scenario must be known to this build. */
function validV5(raw: Record<string, unknown>): boolean {
  const s = raw.settings as Record<string, unknown>;
  if (!Array.isArray(s.expansions) || !s.expansions.every(isExpansionId)) return false;
  if (typeof s.mode !== 'string' || !modeById(s.mode)) return false;
  if (s.scenario !== null && (typeof s.scenario !== 'string' || !scenarioById(s.scenario))) {
    return false;
  }
  return isObject(s.options) && isObject(raw.ext);
}

/** v2 -> v3 (-> v4) on an already validated v2 state. */
function upgradeV2(raw: Record<string, unknown>): GameState | null {
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
  if (raw.schemaVersion === 4 || raw.schemaVersion === 5 || raw.schemaVersion === 6) {
    const s = raw.settings;
    if (!isMapId(s.map) || !Array.isArray(raw.diceDeck)) return null;
    const first = s.startingPlayer;
    if (typeof first !== 'number' || !Number.isInteger(first)) return null;
    if (first < 0 || first >= raw.players.length) return null;
    if (raw.schemaVersion === 4) return isBaseMapId(s.map) ? upgradeV4(raw) : null;
    if (!validV5(raw)) return null;
    if (raw.schemaVersion === 5) return upgradeV5(raw);
    return isRngState(raw.rng) ? (raw as unknown as GameState) : null;
  }
  return null;
}
