/** Pure setup-screen logic: defaults, map/player coupling, colours, persistence. No DOM. */
import {
  BASE_MODE,
  defaultVpToWin,
  expansionById,
  listModes,
  modeById,
  optionVpBonus,
  scenarioById,
  type ExpansionModule,
  type ModeDef,
  type OptionDef,
  type OptionValue,
  type PlayerRange,
  type ScenarioDef,
} from '../../engine';
import type { Controller, MapId, NewGameConfig, SeatConfig } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const VP_MIN = 3;
export const VP_MAX = 20;
export const VP_DEFAULT = 10;
export const DISCARD_MIN = 5;
export const DISCARD_MAX = 20;
export const DISCARD_DEFAULT = 7;
export const NAME_MAX = 16;
export const SEED_MAX = 32;

/** Turn timer steps in order; null = off. */
export const TIMER_STEPS: readonly (number | null)[] = [null, 30, 45, 60, 90, 120, 180, 300];

export interface MapInfo {
  id: MapId;
  label: string;
  /** Seats the map is meant for. Picking the map clamps the player count into this range. */
  min: number;
  max: number;
  blurb: string;
}

const BASE_MAP: MapInfo = { id: 'base', label: 'Base', min: 3, max: 4, blurb: 'Beginner layout' };

export const MAPS: readonly MapInfo[] = [
  BASE_MAP,
  { id: 'baseRandom', label: 'Base Random', min: 3, max: 4, blurb: 'Shuffled every game' },
  { id: 'base56', label: 'Base 5-6P', min: 5, max: 6, blurb: 'Extended board' },
  { id: 'base78', label: 'Base 7-8P', min: 7, max: 8, blurb: 'Largest board' },
];

export function mapInfo(id: MapId): MapInfo {
  return MAPS.find((m) => m.id === id) ?? BASE_MAP;
}

export function rangeLabel(m: MapInfo): string {
  return `${m.min}–${m.max} players`;
}

const RED = { name: 'Red', color: '#d64541' };

export const SEAT_COLORS: readonly { name: string; color: string }[] = [
  RED,
  { name: 'Blue', color: '#3a7bd5' },
  { name: 'White', color: '#ecf0f1' },
  { name: 'Orange', color: '#f39c12' },
  { name: 'Green', color: '#3fae6a' },
  { name: 'Purple', color: '#9b59b6' },
  { name: 'Brown', color: '#9c6b43' },
  { name: 'Pink', color: '#ec7fb5' },
];

export function colorName(color: string): string | undefined {
  return SEAT_COLORS.find((c) => c.color === color)?.name;
}

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

export interface SeatDraft {
  name: string;
  color: string;
  controller: Controller;
}

export interface SetupDraft {
  /** 'base' or an expansion mode (docs/EXPANSIONS.md §8). */
  mode: string;
  /** Scenario of an expansion mode; null in the base mode. */
  scenario: string | null;
  /** Expansion options of the mode's modules (defaults filled in). */
  options: Record<string, Record<string, OptionValue>>;
  /** Base mode only: the board. */
  map: MapId;
  seats: SeatDraft[];
  balancedDice: boolean;
  hideBankCards: boolean;
  /** Index into TIMER_STEPS. */
  timerIdx: number;
  vpToWin: number;
  discardLimit: number;
  seed: string;
}

function newSeat(index: number, taken: Set<string>): SeatDraft {
  const c =
    SEAT_COLORS.find((x) => !taken.has(x.color)) ?? SEAT_COLORS[index % SEAT_COLORS.length] ?? RED;
  return {
    name: index === 0 ? 'You' : c.name,
    color: c.color,
    controller: index === 0 ? 'human' : 'bot',
  };
}

export function defaultSetup(playerCount = 4): SetupDraft {
  const seats: SeatDraft[] = [];
  for (let i = 0; i < playerCount; i++) {
    seats.push(newSeat(i, new Set(seats.map((s) => s.color))));
  }
  return {
    mode: 'base',
    scenario: null,
    options: {},
    map: 'base',
    seats,
    balancedDice: false,
    hideBankCards: false,
    timerIdx: 0,
    vpToWin: VP_DEFAULT,
    discardLimit: DISCARD_DEFAULT,
    seed: '',
  };
}

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

// ---------------------------------------------------------------------------
// Coupling: players <-> map
// ---------------------------------------------------------------------------

/** A map is disabled when it has fewer seats than the game needs. */
export function mapFits(id: MapId, players: number): boolean {
  return players <= mapInfo(id).max;
}

/** Why the map can't be picked right now (null = it can). */
export function mapDisabledReason(id: MapId, players: number): string | null {
  const m = mapInfo(id);
  return players <= m.max ? null : `Up to ${m.max} players (you have ${players})`;
}

/**
 * Change the player count. Seats are kept/grown/trimmed (new seats take unused colours). If the
 * current map is too small, the smallest map that fits is selected; a bigger map than needed stays.
 * Expansion modes clamp to their player range (playerRange).
 */
export function setPlayerCount(draft: SetupDraft, count: number): SetupDraft {
  const range = playerRange(draft);
  const n = clamp(Math.round(count), range.min, range.max);
  const seats = draft.seats.slice(0, n);
  while (seats.length < n) seats.push(newSeat(seats.length, new Set(seats.map((s) => s.color))));
  let map = draft.map;
  if (!mapFits(map, n)) map = MAPS.find((m) => m.max >= n)?.id ?? 'base78';
  return { ...draft, seats, map };
}

// ---------------------------------------------------------------------------
// Modes, scenarios, expansion options (from the engine registry)
// ---------------------------------------------------------------------------

/**
 * Modes offered on the setup screen: 'ready' ones, plus 'wip' / 'demo' ones when `showAll`
 * (URL ?modes=all). The base mode is always first.
 */
export function visibleModes(showAll = false): ModeDef[] {
  return listModes().filter((m) => m.status === 'ready' || showAll);
}

export function modeOf(draft: Pick<SetupDraft, 'mode'>): ModeDef {
  return modeById(draft.mode) ?? BASE_MODE;
}

export function scenarioOf(draft: Pick<SetupDraft, 'scenario'>): ScenarioDef | null {
  return draft.scenario === null ? null : (scenarioById(draft.scenario) ?? null);
}

/** The modules a mode activates (with their requires), in registry order of the mode list. */
export function modeModules(mode: ModeDef): ExpansionModule[] {
  const out: ExpansionModule[] = [];
  const add = (id: string) => {
    const m = expansionById(id);
    if (!m || out.includes(m)) return;
    out.push(m);
    for (const r of m.requires ?? []) add(r);
  };
  for (const id of mode.expansions) add(id);
  return out;
}

/** Seats the draft's mode + scenario allow (base: 3-8 with the map coupling). */
export function playerRange(draft: Pick<SetupDraft, 'mode' | 'scenario'>): PlayerRange {
  const mode = modeOf(draft);
  if (mode.id === 'base') return { min: MIN_PLAYERS, max: MAX_PLAYERS };
  const ranges = [
    mode.players,
    scenarioOf(draft)?.players,
    ...modeModules(mode).map((m) => m.players),
  ];
  let min = 2;
  let max = MAX_PLAYERS;
  for (const r of ranges) {
    if (!r) continue;
    min = Math.max(min, r.min);
    max = Math.min(max, r.max);
  }
  return { min, max: Math.max(min, max) };
}

/** Every option of the mode's modules, with its expansion id. */
export function modeOptions(mode: ModeDef): { ext: string; def: OptionDef }[] {
  return modeModules(mode).flatMap((m) => (m.options ?? []).map((def) => ({ ext: m.id, def })));
}

function defaultOptions(mode: ModeDef): Record<string, Record<string, OptionValue>> {
  const out: Record<string, Record<string, OptionValue>> = {};
  for (const { ext, def } of modeOptions(mode)) out[ext] = { ...out[ext], [def.key]: def.default };
  return out;
}

/** The VP target the screen starts from for the draft's mode, scenario and options. */
export function draftVpDefault(draft: SetupDraft): number {
  const mode = modeOf(draft);
  if (mode.id === 'base') return VP_DEFAULT;
  return defaultVpToWin(mode, scenarioOf(draft)) + optionVpBonus(modeModules(mode), draft.options);
}

/** Pick a mode: its first scenario, default options and VP target, seats clamped to its range. */
export function setMode(draft: SetupDraft, id: string): SetupDraft {
  const mode = modeById(id) ?? BASE_MODE;
  const next: SetupDraft = {
    ...draft,
    mode: mode.id,
    scenario: mode.scenarios[0] ?? null,
    options: defaultOptions(mode),
  };
  next.vpToWin = clamp(draftVpDefault(next), VP_MIN, VP_MAX);
  return setPlayerCount(next, next.seats.length);
}

export function setScenario(draft: SetupDraft, id: string): SetupDraft {
  if (!modeOf(draft).scenarios.includes(id)) return draft;
  const next = { ...draft, scenario: id };
  next.vpToWin = clamp(draftVpDefault(next), VP_MIN, VP_MAX);
  return setPlayerCount(next, next.seats.length);
}

/** Set one expansion option (unknown keys / bad values are ignored). VP follows a vpBonus option. */
export function setOption(
  draft: SetupDraft,
  ext: string,
  key: string,
  value: OptionValue,
): SetupDraft {
  const opt = modeOptions(modeOf(draft)).find((o) => o.ext === ext && o.def.key === key);
  if (!opt || typeof value !== typeof opt.def.default) return draft;
  const before = draftVpDefault(draft);
  const next = {
    ...draft,
    options: { ...draft.options, [ext]: { ...draft.options[ext], [key]: value } },
  };
  // Keep a VP target the user changed; follow the default otherwise.
  if (draft.vpToWin === before) next.vpToWin = clamp(draftVpDefault(next), VP_MIN, VP_MAX);
  return next;
}

/** Pick a map and clamp the player count into its range. */
export function setMap(draft: SetupDraft, id: MapId): SetupDraft {
  const m = mapInfo(id);
  const count = clamp(draft.seats.length, m.min, m.max);
  return setPlayerCount({ ...draft, map: id }, count);
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/** Give seat `index` the colour; whoever had it gets the seat's old colour (colours stay unique). */
export function pickSeatColor(draft: SetupDraft, index: number, color: string): SetupDraft {
  const seat = draft.seats[index];
  if (!seat || seat.color === color || !SEAT_COLORS.some((c) => c.color === color)) return draft;
  const seats = draft.seats.map((s, i) => {
    if (i === index) return { ...s, color };
    if (s.color === color) return { ...s, color: seat.color };
    return s;
  });
  return { ...draft, seats };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Trim names, fill blanks, make duplicates unique, drop an empty seed. */
export function buildConfig(draft: SetupDraft): NewGameConfig {
  const taken = new Set<string>();
  const players: SeatConfig[] = draft.seats.map((s, i) => {
    const base = s.name.trim().slice(0, NAME_MAX) || `Player ${i + 1}`;
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    taken.add(name.toLowerCase());
    return { name, color: s.color, controller: s.controller };
  });
  const cfg: NewGameConfig = {
    mode: draft.mode,
    ...(draft.mode === 'base'
      ? {}
      : {
          ...(draft.scenario === null ? {} : { scenario: draft.scenario }),
          options: draft.options,
        }),
    map: draft.map,
    players,
    rules: { balancedDice: draft.balancedDice, hideBankCards: draft.hideBankCards },
    turnTimerSec: TIMER_STEPS[draft.timerIdx] ?? null,
    vpToWin: draft.vpToWin,
    discardLimit: draft.discardLimit,
  };
  const seed = draft.seed.trim();
  if (seed) cfg.seed = seed;
  return cfg;
}

export function timerLabel(idx: number): string {
  const s = TIMER_STEPS[idx];
  if (s === null || s === undefined) return 'Off';
  return s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${s}s`;
}

// ---------------------------------------------------------------------------
// Persistence (last-used settings). Every storage access is guarded.
// ---------------------------------------------------------------------------

export const STORAGE_KEY = 'catan:setup:v1';

export type SetupStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function defaultStorage(): SetupStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveSetup(storage: SetupStorage | null, draft: SetupDraft): void {
  if (!storage) return;
  try {
    // The seed is deliberately not remembered: it would replay the same game every time.
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...draft, seed: '' }));
  } catch {
    /* quota / privacy mode: settings just aren't remembered */
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function int(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : fallback;
}

/** Rebuild a valid draft from untrusted JSON; anything off falls back to the default for that field. */
export function sanitizeSetup(raw: unknown): SetupDraft {
  const base = defaultSetup();
  if (!isRecord(raw)) return base;

  const rawSeats = Array.isArray(raw['seats']) ? raw['seats'].slice(0, MAX_PLAYERS) : [];
  const seats: SeatDraft[] = [];
  const used = new Set<string>();
  rawSeats.forEach((rs, i) => {
    const o = isRecord(rs) ? rs : {};
    const fresh = newSeat(i, used);
    let color = typeof o['color'] === 'string' ? o['color'] : '';
    if (!SEAT_COLORS.some((c) => c.color === color) || used.has(color)) color = fresh.color;
    used.add(color);
    seats.push({
      name: typeof o['name'] === 'string' ? o['name'].slice(0, NAME_MAX) : fresh.name,
      color,
      controller:
        i === 0
          ? o['controller'] === 'bot'
            ? 'bot'
            : 'human'
          : o['controller'] === 'human'
            ? 'human'
            : 'bot',
    });
  });
  while (seats.length < MIN_PLAYERS)
    seats.push(newSeat(seats.length, new Set(seats.map((s) => s.color))));

  const mapRaw = raw['map'];
  const map: MapId = MAPS.some((m) => m.id === mapRaw) ? (mapRaw as MapId) : 'base';
  const mode = modeById(typeof raw['mode'] === 'string' ? raw['mode'] : 'base') ?? BASE_MODE;
  const scenarioRaw = raw['scenario'];
  const scenario =
    typeof scenarioRaw === 'string' && mode.scenarios.includes(scenarioRaw)
      ? scenarioRaw
      : (mode.scenarios[0] ?? null);
  const options = defaultOptions(mode);
  const rawOpts = isRecord(raw['options']) ? raw['options'] : {};
  for (const { ext, def } of modeOptions(mode)) {
    const group = rawOpts[ext];
    const v = isRecord(group) ? group[def.key] : undefined;
    if (typeof v === typeof def.default)
      options[ext] = { ...options[ext], [def.key]: v as OptionValue };
  }
  // Re-run the coupling so a stored map that no longer fits is corrected.
  return setPlayerCount(
    {
      mode: mode.id,
      scenario,
      options,
      map,
      seats,
      balancedDice: raw['balancedDice'] === true,
      hideBankCards: raw['hideBankCards'] === true,
      timerIdx: int(raw['timerIdx'], 0, TIMER_STEPS.length - 1, 0),
      vpToWin: int(raw['vpToWin'], VP_MIN, VP_MAX, VP_DEFAULT),
      discardLimit: int(raw['discardLimit'], DISCARD_MIN, DISCARD_MAX, DISCARD_DEFAULT),
      seed: '',
    },
    seats.length,
  );
}

export function loadSetup(storage: SetupStorage | null): SetupDraft {
  if (!storage) return defaultSetup();
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (!text) return defaultSetup();
    return sanitizeSetup(JSON.parse(text));
  } catch {
    return defaultSetup();
  }
}
