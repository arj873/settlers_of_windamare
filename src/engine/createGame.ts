import { generateBoard } from './board';
import {
  DEFAULT_DISCARD_LIMIT,
  DEFAULT_VP_TO_WIN,
  DEV_CARD_TYPES,
  DISCARD_LIMIT_RANGE,
  RESOURCES,
  VP_TO_WIN_RANGE,
} from './constants';
import {
  activeModules,
  allModules,
  expansionById,
  modeById,
  scenarioById,
} from './expansions/registry';
import type { ExpansionModule, ModeDef, PlayerRange, ScenarioDef } from './expansions/types';
import { isMapId, mapById, supplyOf } from './mapLookup';
import { defaultMapFor, isBaseMapId } from './maps';
import { emptyDevCards, emptyProgressCards, emptyResources } from './resources';
import { Rng } from './rng';
import type {
  DevCardType,
  ExpansionId,
  GameSettings,
  GameState,
  Layout,
  MapId,
  ModeId,
  OptionValue,
  Player,
  PlayerId,
  ScenarioId,
} from './types';

export interface PlayerConfig {
  name: string;
  color: string;
}

export interface GameConfig {
  seed: number | string;
  /** In seat (turn) order; `startingPlayer` places first. Count must fit the map (3..8 overall). */
  players: PlayerConfig[];
  /**
   * Board. Default: `layout` if given (compat), else the smallest random map designed for the
   * player count (`defaultMapFor`).
   */
  map?: MapId;
  /** @deprecated v1 compat: 'beginner' = map 'base', 'random' = map 'baseRandom'. Ignored if `map` is set. */
  layout?: Layout;
  /** 3..20, default 10. */
  vpToWin?: number;
  /** 5..20, default 7. */
  discardLimit?: number;
  /** Default false. Rolls come from a 36-card dice deck. */
  balancedDice?: boolean;
  /** Default: true with 5+ players. Special build steps between turns. */
  specialBuildPhase?: boolean;
  /** Default false. Client-side only. */
  hideBankCards?: boolean;
  /** Default null (no timer). Client-side only. */
  turnTimerSec?: number | null;
  /**
   * Who starts (places first, takes the first turn). Default 'random': a seat drawn from the
   * seed, as the official rules have the players roll for it (RULES.md 2.7).
   */
  startingPlayer?: PlayerId | 'random';
  /** Setup mode (docs/EXPANSIONS.md). Default 'base'. */
  mode?: ModeId;
  /** Variant modules (`variant: true`) on top of the mode. */
  expansions?: ExpansionId[];
  /** One of the mode's scenarios. Default: the mode's first (none for the base mode). */
  scenario?: ScenarioId;
  /** Per-expansion options; missing ones get their defaults. */
  options?: Record<ExpansionId, Record<string, OptionValue>>;
}

/** The mode, scenario and expansions of a config, validated (throws on bad values). */
export interface ResolvedMode {
  mode: ModeDef;
  scenario: ScenarioDef | null;
  modules: readonly ExpansionModule[];
}

export function resolveMode(config: GameConfig): ResolvedMode {
  const mode = modeById(config.mode ?? 'base');
  if (!mode) throw new Error(`unknown mode ${String(config.mode)}`);
  const ids = new Set<ExpansionId>();
  const add = (id: ExpansionId, via: string) => {
    if (ids.has(id)) return;
    const m = expansionById(id);
    if (!m) throw new Error(`unknown expansion ${id} (${via})`);
    ids.add(id);
    for (const r of m.requires ?? []) add(r, `required by ${id}`);
  };
  for (const id of mode.expansions) add(id, `mode ${mode.id}`);
  for (const id of config.expansions ?? []) {
    const m = expansionById(id);
    if (m && !m.variant && !ids.has(id)) {
      throw new Error(`${id} is not a variant; pick a mode that includes it`);
    }
    add(id, 'config');
  }
  const modules = allModules().filter((m) => ids.has(m.id));
  for (const a of modules) {
    for (const b of modules) {
      if (a.conflicts?.includes(b.id)) throw new Error(`${a.id} cannot be combined with ${b.id}`);
    }
  }
  const scenarioId = config.scenario ?? mode.scenarios[0] ?? null;
  let scenario: ScenarioDef | null = null;
  if (scenarioId !== null) {
    if (!mode.scenarios.includes(scenarioId)) {
      throw new Error(`mode ${mode.id} has no scenario ${scenarioId}`);
    }
    scenario = scenarioById(scenarioId) ?? null;
    if (!scenario) throw new Error(`unknown scenario ${scenarioId}`);
  }
  return { mode, scenario, modules };
}

function resolveOptions(
  modules: readonly ExpansionModule[],
  given: Record<ExpansionId, Record<string, OptionValue>> = {},
): Record<ExpansionId, Record<string, OptionValue>> {
  for (const id of Object.keys(given)) {
    if (!modules.some((m) => m.id === id)) throw new Error(`options for inactive expansion ${id}`);
  }
  const out: Record<ExpansionId, Record<string, OptionValue>> = {};
  for (const m of modules) {
    const defs = m.options ?? [];
    if (defs.length === 0) continue;
    const mine = given[m.id] ?? {};
    for (const k of Object.keys(mine)) {
      if (!defs.some((d) => d.key === k)) throw new Error(`unknown option ${m.id}.${k}`);
    }
    const opts: Record<string, OptionValue> = {};
    for (const d of defs) {
      const v = mine[d.key] ?? d.default;
      const bad = `option ${m.id}.${d.key}: invalid value ${String(v)}`;
      if (d.type === 'boolean' && typeof v !== 'boolean') throw new Error(bad);
      if (d.type === 'int' && !(Number.isInteger(v) && Number(v) >= d.min && Number(v) <= d.max)) {
        throw new Error(bad);
      }
      if (d.type === 'choice' && !d.choices.some((c) => c.value === v)) throw new Error(bad);
      opts[d.key] = v;
    }
    out[m.id] = opts;
  }
  return out;
}

/** The default VP target of a mode + scenario (the setup screen starts from it). */
export function defaultVpToWin(mode: ModeDef, scenario: ScenarioDef | null): number {
  if (scenario && mode.scenarioVp?.[scenario.id] !== undefined) {
    return mode.scenarioVp[scenario.id] as number;
  }
  if (scenario) return (scenario.vpToWin ?? DEFAULT_VP_TO_WIN) + (mode.vpBonus ?? 0);
  return mode.vpToWin ?? DEFAULT_VP_TO_WIN;
}

/**
 * The seat a seed starts with. Drawn from its own stream (not the game RNG), so the board, the
 * deck and every roll of a seed stay the same as before starting players were random.
 */
export function randomStartingPlayer(seed: number | string, playerCount: number): PlayerId {
  return Rng.fromSeed(`start:${typeof seed === 'number' ? `n${seed}` : seed}`).int(playerCount);
}

export function layoutToMap(layout: Layout): MapId {
  return layout === 'beginner' ? 'base' : 'baseRandom';
}

function intInRange(name: string, v: number, range: { min: number; max: number }): number {
  if (!Number.isInteger(v) || v < range.min || v > range.max) {
    throw new Error(`${name} must be an integer ${range.min}-${range.max}, got ${v}`);
  }
  return v;
}

/** Resolve and validate the settings for `config` (throws on invalid values). */
export function resolveSettings(config: GameConfig): GameSettings {
  const n = config.players.length;
  const { mode, scenario, modules } = resolveMode(config);
  const ranges: [string, PlayerRange | undefined][] = [
    [`mode ${mode.id}`, mode.players],
    [`scenario ${scenario?.id ?? ''}`, scenario?.players],
    ...modules.map((m): [string, PlayerRange | undefined] => [`expansion ${m.id}`, m.players]),
  ];
  for (const [what, r] of ranges) {
    if (r && (n < r.min || n > r.max)) {
      throw new Error(`${what} needs ${r.min}-${r.max} players, got ${n}`);
    }
  }
  let map: MapId;
  if (scenario) {
    map = config.map ?? scenario.mapFor(n);
    if (!scenario.maps.includes(map)) {
      throw new Error(`scenario ${scenario.id} cannot be played on map ${map}`);
    }
  } else {
    map = config.map ?? (config.layout ? layoutToMap(config.layout) : defaultMapFor(n));
    if (!isBaseMapId(map)) throw new Error(`unknown map ${String(map)}`);
  }
  if (!isMapId(map)) throw new Error(`unknown map ${String(map)}`);
  const def = mapById(map);
  if (n < def.minPlayers || n > def.maxPlayers) {
    throw new Error(`map ${map} needs ${def.minPlayers}-${def.maxPlayers} players, got ${n}`);
  }
  const timer = config.turnTimerSec ?? null;
  if (timer !== null && (!Number.isInteger(timer) || timer <= 0)) {
    throw new Error(`turnTimerSec must be a positive integer or null, got ${timer}`);
  }
  const start = config.startingPlayer ?? 'random';
  const startingPlayer =
    start === 'random'
      ? randomStartingPlayer(config.seed, n)
      : intInRange('startingPlayer', start, { min: 0, max: n - 1 });
  const options = resolveOptions(modules, config.options);
  const vpDefault = defaultVpToWin(mode, scenario) + optionVpBonus(modules, options);
  const settings: GameSettings = {
    seed: config.seed,
    map,
    vpToWin: intInRange('vpToWin', config.vpToWin ?? vpDefault, VP_TO_WIN_RANGE),
    discardLimit: intInRange(
      'discardLimit',
      config.discardLimit ?? DEFAULT_DISCARD_LIMIT,
      DISCARD_LIMIT_RANGE,
    ),
    balancedDice: config.balancedDice ?? false,
    specialBuildPhase: config.specialBuildPhase ?? n >= 5,
    hideBankCards: config.hideBankCards ?? false,
    turnTimerSec: timer,
    startingPlayer,
    mode: mode.id,
    expansions: modules.map((m) => m.id),
    scenario: scenario?.id ?? null,
    options,
  };
  for (const m of modules) {
    const err = m.validate?.(settings);
    if (err) throw new Error(`${m.id}: ${err}`);
  }
  return settings;
}

/** VP target bonus of the boolean options that are on (OptionDef.vpBonus). */
export function optionVpBonus(
  modules: readonly ExpansionModule[],
  options: Record<ExpansionId, Record<string, OptionValue>>,
): number {
  let bonus = 0;
  for (const m of modules) {
    for (const d of m.options ?? []) {
      if (d.type === 'boolean' && d.vpBonus && options[m.id]?.[d.key] === true) bonus += d.vpBonus;
    }
  }
  return bonus;
}

/** Build the initial state: board generated, deck shuffled, phase = setup (starting player, settlement). */
export function createGame(config: GameConfig): GameState {
  const settings = resolveSettings(config);
  const def = mapById(settings.map);
  const supply = supplyOf({ settings });

  const rng = Rng.fromSeed(config.seed);
  const { board, robber } = generateBoard(settings.map, rng, config.players.length);

  const deck: DevCardType[] = [];
  for (const t of DEV_CARD_TYPES) {
    for (let i = 0; i < supply.devDeck[t]; i++) deck.push(t);
  }
  const devDeck = rng.shuffle(deck);

  const players: Player[] = config.players.map((p, id) => ({
    id,
    name: p.name,
    color: p.color,
    resources: emptyResources(),
    devCards: emptyDevCards(),
    newDevCards: emptyDevCards(),
    knightsPlayed: 0,
    progressCardsPlayed: emptyProgressCards(),
  }));

  const bank = emptyResources();
  for (const r of RESOURCES) bank[r] = supply.bankPerResource;

  const first = settings.startingPlayer;
  const mode = modeById(settings.mode);
  const title =
    settings.mode === 'base'
      ? `${def.name} map`
      : `${mode?.name ?? settings.mode}: ${settings.scenario ? (scenarioById(settings.scenario)?.name ?? settings.scenario) : def.name}`;
  const state: GameState = {
    schemaVersion: 5,
    settings,
    board,
    pieces: { buildings: {}, roads: {} },
    robber,
    players,
    bank,
    devDeck,
    turn: { number: 0, current: first, devCardPlayed: false, tradeOffers: 0 },
    phase: { kind: 'setup', index: 0, step: 'settlement', lastSettlement: null },
    dice: null,
    diceDeck: [],
    awards: { longestRoad: null, largestArmy: null },
    log: [
      {
        turn: 0,
        player: null,
        text: `Game created (${title}, seed ${String(config.seed)})`,
      },
      { turn: 0, player: first, text: `${players[first]?.name ?? `Player ${first + 1}`} starts` },
    ],
    rng: rng.state,
    winner: null,
    ext: {},
  };
  // Expansions set up their slices last, drawing from the continuing game RNG (none in base games).
  const modules = activeModules(state);
  if (modules.length > 0) {
    const r = new Rng(state.rng);
    for (const m of modules) m.init?.(state, r);
    state.rng = r.state;
  }
  return state;
}
