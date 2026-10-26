/** Pure setup-screen logic: defaults, map/player coupling, colours, persistence. No DOM. */
import {
  OFFICIAL_SETUP,
  TIMER_PRESET_VALUES,
  timerSettings,
  type MapSelection,
  type RobberMode,
  type SetupBuilding,
  type SetupPlacement,
  type SetupRestriction,
  type TimerPreset,
} from '../../engine';
import type { Controller, MapId, NewGameConfig, NewGameVariants, SeatConfig } from '../types';

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
  map: MapId;
  seats: SeatDraft[];
  balancedDice: boolean;
  hideBankCards: boolean;
  /** Index into TIMER_STEPS (legacy per-turn timer; 0 while a chess clock is picked). */
  timerIdx: number;
  vpToWin: number;
  discardLimit: number;
  seed: string;
  // --- V1 variants (defaults = official rules) ---------------------------------------------
  robberMode: RobberMode;
  eventCards: boolean;
  rushMode: boolean;
  turboMode: boolean;
  secondSettler: boolean;
  randomTurnOrder: boolean;
  mapSelection: MapSelection;
  setupPlacement: SetupPlacement;
  /** Chess clock preset ('off' = none; the per-turn timer may be used instead). */
  clockPreset: TimerPreset;
  /** Custom clock: bank in minutes and increment in seconds. */
  customBankMin: number;
  customIncrementSec: number;
}

/** The variant fields of a draft with their defaults. */
export const VARIANT_DEFAULTS: Pick<
  SetupDraft,
  | 'robberMode'
  | 'eventCards'
  | 'rushMode'
  | 'turboMode'
  | 'secondSettler'
  | 'randomTurnOrder'
  | 'mapSelection'
  | 'setupPlacement'
  | 'clockPreset'
  | 'customBankMin'
  | 'customIncrementSec'
> = {
  robberMode: 'normal',
  eventCards: false,
  rushMode: false,
  turboMode: false,
  secondSettler: false,
  randomTurnOrder: false,
  mapSelection: 'fixed',
  setupPlacement: OFFICIAL_SETUP,
  clockPreset: 'off',
  customBankMin: 15,
  customIncrementSec: 20,
};

export const CUSTOM_BANK_MIN = { min: 1, max: 180 } as const;
export const CUSTOM_INCREMENT_SEC = { min: 0, max: 600 } as const;
/** Second Settler: Catanian 2 sits third to the left, so it needs 4+ players. */
export const SECOND_SETTLER_MIN_PLAYERS = 4;
/** Colonist Rush defaults: discard limit 9 and the friendly robber (colonist.io/catan-rules/colonist-rush). */
export const RUSH_DISCARD_LIMIT = 9;

export const ROBBER_OPTIONS: readonly { id: RobberMode; label: string; desc: string }[] = [
  { id: 'normal', label: 'Normal', desc: 'Official rules' },
  {
    id: 'friendly',
    label: 'Friendly robber',
    desc: "Can't block or rob players with 2 or fewer points",
  },
  { id: 'none', label: 'No robber', desc: 'A 7 only makes players discard' },
];

export const MAP_SELECTION_OPTIONS: readonly { id: MapSelection; label: string; desc: string }[] = [
  { id: 'fixed', label: 'Fixed', desc: 'The map picked above' },
  { id: 'random', label: 'Random', desc: 'Any map that fits the players' },
  { id: 'veto', label: 'Veto', desc: '3 boards; players veto until one is left' },
];

export const CLOCK_OPTIONS: readonly { id: TimerPreset; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'bullet', label: 'Bullet' },
  { id: 'blitz', label: 'Blitz' },
  { id: 'rapid', label: 'Rapid' },
  { id: 'classic', label: 'Classic' },
  { id: 'custom', label: 'Custom' },
];

/** "20m + 30s" for a preset (custom: the draft's values). */
export function clockLabel(d: SetupDraft): string {
  const p = d.clockPreset;
  if (p === 'off') return 'Off';
  const v =
    p === 'custom'
      ? { bankSec: d.customBankMin * 60, incrementSec: d.customIncrementSec }
      : TIMER_PRESET_VALUES[p];
  const bank = v.bankSec % 60 === 0 ? `${v.bankSec / 60}m` : `${v.bankSec}s`;
  return `${bank} + ${v.incrementSec}s`;
}

export const SETUP_BUILDING_OPTIONS: readonly { id: SetupBuilding; label: string }[] = [
  { id: 'settlement', label: 'Settlement' },
  { id: 'city', label: 'City' },
];
export const SETUP_RESTRICTION_OPTIONS: readonly { id: SetupRestriction; label: string }[] = [
  { id: 'normal', label: 'Distance rule' },
  { id: 'anyVertex', label: 'None (any vertex)' },
];

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
    map: 'base',
    seats,
    balancedDice: false,
    hideBankCards: false,
    timerIdx: 0,
    vpToWin: VP_DEFAULT,
    discardLimit: DISCARD_DEFAULT,
    seed: '',
    ...VARIANT_DEFAULTS,
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
 */
export function setPlayerCount(draft: SetupDraft, count: number): SetupDraft {
  const n = clamp(Math.round(count), MIN_PLAYERS, MAX_PLAYERS);
  const seats = draft.seats.slice(0, n);
  while (seats.length < n) seats.push(newSeat(seats.length, new Set(seats.map((s) => s.color))));
  let map = draft.map;
  if (!mapFits(map, n)) map = MAPS.find((m) => m.max >= n)?.id ?? 'base78';
  const secondSettler = draft.secondSettler && n >= SECOND_SETTLER_MIN_PLAYERS;
  return { ...draft, seats, map, secondSettler };
}

// ---------------------------------------------------------------------------
// Variant coupling
// ---------------------------------------------------------------------------

export type ToggleKey =
  | 'balancedDice'
  | 'hideBankCards'
  | 'eventCards'
  | 'rushMode'
  | 'turboMode'
  | 'secondSettler'
  | 'randomTurnOrder';

/**
 * Flip a switch. Event Cards and Balanced Dice exclude each other (both replace the dice);
 * turning Rush on applies the Colonist Rush defaults (discard limit 9, friendly robber);
 * Second Settler needs 4+ players.
 */
export function toggle(draft: SetupDraft, key: ToggleKey): SetupDraft {
  const on = !draft[key];
  if (key === 'secondSettler' && on && draft.seats.length < SECOND_SETTLER_MIN_PLAYERS)
    return draft;
  const next: SetupDraft = { ...draft, [key]: on };
  if (on && key === 'eventCards') next.balancedDice = false;
  if (on && key === 'balancedDice') next.eventCards = false;
  if (on && key === 'rushMode') {
    next.discardLimit = RUSH_DISCARD_LIMIT;
    if (next.robberMode === 'normal') next.robberMode = 'friendly';
  }
  return next;
}

/** Pick a chess-clock preset; any preset turns the per-turn timer off. */
export function setClockPreset(draft: SetupDraft, preset: TimerPreset): SetupDraft {
  return { ...draft, clockPreset: preset, timerIdx: preset === 'off' ? draft.timerIdx : 0 };
}

/** Step the per-turn timer; turning it on turns the chess clock off. */
export function setTimerIdx(draft: SetupDraft, idx: number): SetupDraft {
  const timerIdx = clamp(idx, 0, TIMER_STEPS.length - 1);
  return { ...draft, timerIdx, clockPreset: timerIdx > 0 ? 'off' : draft.clockPreset };
}

export function setSetupRound(
  draft: SetupDraft,
  round: 'first' | 'second',
  change: Partial<SetupPlacement['first']>,
): SetupDraft {
  const setupPlacement = {
    ...draft.setupPlacement,
    [round]: { ...draft.setupPlacement[round], ...change },
  };
  return { ...draft, setupPlacement };
}

/** The variants of a draft that differ from the official rules (undefined when none do). */
export function buildVariants(draft: SetupDraft): NewGameVariants | undefined {
  const v: NewGameVariants = {};
  if (draft.robberMode !== 'normal') v.robberMode = draft.robberMode;
  if (draft.eventCards) v.eventCards = true;
  if (draft.rushMode) v.rushMode = true;
  if (draft.turboMode) v.turboMode = true;
  if (draft.secondSettler && draft.seats.length >= SECOND_SETTLER_MIN_PLAYERS) {
    v.secondSettler = true;
  }
  if (draft.randomTurnOrder) v.randomTurnOrder = true;
  if (draft.mapSelection !== 'fixed') v.mapSelection = draft.mapSelection;
  const p = draft.setupPlacement;
  const o = OFFICIAL_SETUP;
  if (
    p.first.building !== o.first.building ||
    p.first.restriction !== o.first.restriction ||
    p.second.building !== o.second.building ||
    p.second.restriction !== o.second.restriction
  ) {
    v.setupPlacement = { first: { ...p.first }, second: { ...p.second } };
  }
  const timer = timerSettings(draft.clockPreset, {
    bankSec: draft.customBankMin * 60,
    incrementSec: draft.customIncrementSec,
  });
  if (timer) v.timer = timer;
  return Object.keys(v).length > 0 ? v : undefined;
}

/** Append one seat (human by default, first unused colour). No-op at MAX_PLAYERS; the map auto-switches. */
export function addSeat(draft: SetupDraft, controller: Controller = 'human'): SetupDraft {
  if (draft.seats.length >= MAX_PLAYERS) return draft;
  const grown = setPlayerCount(draft, draft.seats.length + 1);
  const last = grown.seats.length - 1;
  return { ...grown, seats: grown.seats.map((s, i) => (i === last ? { ...s, controller } : s)) };
}

/**
 * Remove exactly seat `index` (not the last one). No-op at MIN_PLAYERS or for a bad index. Remaining
 * seats keep their names, colours and controllers, so colours stay unique; the map is kept (it still fits).
 */
export function removeSeat(draft: SetupDraft, index: number): SetupDraft {
  if (draft.seats.length <= MIN_PLAYERS || !Number.isInteger(index)) return draft;
  if (index < 0 || index >= draft.seats.length) return draft;
  return { ...draft, seats: draft.seats.filter((_, i) => i !== index) };
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
    mode: 'base',
    map: draft.map,
    players,
    rules: { balancedDice: draft.balancedDice, hideBankCards: draft.hideBankCards },
    turnTimerSec: TIMER_STEPS[draft.timerIdx] ?? null,
    vpToWin: draft.vpToWin,
    discardLimit: draft.discardLimit,
  };
  const seed = draft.seed.trim();
  if (seed) cfg.seed = seed;
  const variants = buildVariants(draft);
  if (variants) {
    cfg.variants = variants;
    if (variants.timer) cfg.turnTimerSec = null;
  }
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
  // Re-run the coupling so a stored map that no longer fits is corrected.
  return setPlayerCount(
    {
      map,
      seats,
      balancedDice: raw['balancedDice'] === true,
      hideBankCards: raw['hideBankCards'] === true,
      timerIdx: int(raw['timerIdx'], 0, TIMER_STEPS.length - 1, 0),
      vpToWin: int(raw['vpToWin'], VP_MIN, VP_MAX, VP_DEFAULT),
      discardLimit: int(raw['discardLimit'], DISCARD_MIN, DISCARD_MAX, DISCARD_DEFAULT),
      seed: '',
      ...sanitizeVariants(raw),
    },
    seats.length,
  );
}

const oneOf = <T extends string>(v: unknown, options: readonly { id: T }[], fallback: T): T =>
  options.some((o) => o.id === v) ? (v as T) : fallback;

function sanitizeRound(raw: unknown, fallback: SetupPlacement['first']): SetupPlacement['first'] {
  const o = isRecord(raw) ? raw : {};
  return {
    building: oneOf(o['building'], SETUP_BUILDING_OPTIONS, fallback.building),
    restriction: oneOf(o['restriction'], SETUP_RESTRICTION_OPTIONS, fallback.restriction),
  };
}

/** Variant fields of a stored draft (older drafts have none: defaults). */
function sanitizeVariants(raw: Record<string, unknown>): typeof VARIANT_DEFAULTS {
  const d = VARIANT_DEFAULTS;
  const sp = isRecord(raw['setupPlacement']) ? raw['setupPlacement'] : {};
  const eventCards = raw['eventCards'] === true && raw['balancedDice'] !== true;
  const clockPreset = oneOf(raw['clockPreset'], CLOCK_OPTIONS, d.clockPreset);
  return {
    robberMode: oneOf(raw['robberMode'], ROBBER_OPTIONS, d.robberMode),
    eventCards,
    rushMode: raw['rushMode'] === true,
    turboMode: raw['turboMode'] === true,
    secondSettler: raw['secondSettler'] === true,
    randomTurnOrder: raw['randomTurnOrder'] === true,
    mapSelection: oneOf(raw['mapSelection'], MAP_SELECTION_OPTIONS, d.mapSelection),
    setupPlacement: {
      first: sanitizeRound(sp['first'], d.setupPlacement.first),
      second: sanitizeRound(sp['second'], d.setupPlacement.second),
    },
    clockPreset,
    customBankMin: int(
      raw['customBankMin'],
      CUSTOM_BANK_MIN.min,
      CUSTOM_BANK_MIN.max,
      d.customBankMin,
    ),
    customIncrementSec: int(
      raw['customIncrementSec'],
      CUSTOM_INCREMENT_SEC.min,
      CUSTOM_INCREMENT_SEC.max,
      d.customIncrementSec,
    ),
  };
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
