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
  allExpansions,
  expansionById,
  modeById,
  requireModule,
  scenarioById,
} from './expansions/registry';
import type {
  ExpansionInfo,
  ExpansionModule,
  ModeDef,
  PlayerRange,
  ScenarioDef,
} from './expansions/types';
import { isMapId, mapById, supplyOf } from './mapLookup';
import { MAPS, MAP_IDS, defaultMapFor, isBaseMapId } from './maps';
import { MAP_VETO_CANDIDATES, vetoOrder } from './actions/veto';
import { isTimerPreset, timerSettings } from './clock';
import {
  MAP_RULE_KEYS,
  MAP_SELECTIONS,
  OFFICIAL_SETUP,
  RULES56_MIN_PLAYERS,
  ROBBER_MODES,
  SETUP_BUILDINGS,
  SETUP_RESTRICTIONS,
  mapRulesOf,
  rules56On,
} from './variants';
import { emptyDevCards, emptyProgressCards, emptyResources } from './resources';
import { Rng } from './rng';
import { emptyStats } from './stats';
import type {
  DevCardType,
  ExpansionId,
  GameSettings,
  GameState,
  Layout,
  MapCandidate,
  MapId,
  MapRules,
  MapSelection,
  ModeId,
  OptionValue,
  Player,
  PlayerId,
  RobberMode,
  ScenarioId,
  SetupPlacement,
  TimerSettings,
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
  // --- V1 variants (variants.ts, RULES.md §18). Absent = official rule. -------------------
  robberMode?: RobberMode;
  /** Default false. Event Cards replace the dice. Not combinable with balancedDice. */
  eventCards?: boolean;
  setupPlacement?: SetupPlacement;
  /**
   * Default false. Shuffle `players` into seats (own seeded stream, so board and rolls of a seed
   * do not change); seat 0 of the shuffled order starts unless `startingPlayer` is a number.
   */
  randomTurnOrder?: boolean;
  /**
   * Default 'fixed'. 'random' ignores `map` (with a scenario: a pick among its maps that fit);
   * 'veto' starts with a map vote (on `map`'s frame; base game only).
   */
  mapSelection?: MapSelection;
  /** Default false. Rush: the dice roll automatically at the start of each turn. */
  rushMode?: boolean;
  /** Default false. Turbo (ours): both setup rounds pay starting resources. */
  turboMode?: boolean;
  /** Default false. Paired players' turn (4+ players); replaces the special building phase. */
  secondSettler?: boolean;
  /** Default none. Chess-clock timer (clock.ts); not together with turnTimerSec. */
  timer?: TimerSettings | null;
  /**
   * Which adjacencies random maps may have (RULES.md §19). Default: none allowed (no touching
   * 6/8, no touching 2/12, no equal numbers or equal resources side by side). The fixed
   * beginner map and scenario maps (their own generators) ignore it.
   */
  mapRules?: MapRules;
  /** Default false. The 5+ player rule set (RULES.md §20); needs 5+ players and the special building phase. */
  rules56?: boolean;
}

/** The mode, scenario and expansions of a config, validated (throws on bad values). */
export interface ResolvedMode {
  mode: ModeDef;
  scenario: ScenarioDef | null;
  modules: readonly ExpansionModule[];
}

/**
 * Registry order, except that a module with `before` moves in front of the first module it
 * names (a combination module runs its hooks before the modules it composes).
 */
export function composeOrder(modules: readonly ExpansionModule[]): ExpansionModule[] {
  const out = modules.filter((m) => !m.before?.some((id) => modules.some((x) => x.id === id)));
  for (const m of modules) {
    if (out.includes(m)) continue;
    const at = out.findIndex((x) => m.before?.includes(x.id));
    out.splice(at < 0 ? out.length : at, 0, m);
  }
  return out;
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
  // s18: the rules must be loaded (ensureModules) — ModuleNotLoadedError otherwise.
  const modules = composeOrder(
    allExpansions()
      .filter((m) => ids.has(m.id))
      .map((m) => requireModule(m.id)),
  );
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

/** Seat order for Randomize Turn Order: `order[seat]` = config index. Own stream per seed. */
export function randomSeatOrder(seed: number | string, playerCount: number): number[] {
  const rng = Rng.fromSeed(`order:${typeof seed === 'number' ? `n${seed}` : seed}`);
  return rng.shuffle(Array.from({ length: playerCount }, (_, i) => i));
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
  const mapSelection = config.mapSelection ?? 'fixed';
  if (!MAP_SELECTIONS.includes(mapSelection)) {
    throw new Error(`unknown mapSelection ${String(mapSelection)}`);
  }
  // Expansion slices are created from the board (module init), so the board cannot change
  // after createGame: no map veto with expansions.
  if (mapSelection === 'veto' && modules.length > 0) {
    throw new Error('map veto is only available in the base game');
  }
  let map: MapId;
  if (scenario) {
    map =
      mapSelection === 'random'
        ? randomScenarioMap(config.seed, scenario, n)
        : (config.map ?? scenario.mapFor(n));
    if (!scenario.maps.includes(map)) {
      throw new Error(`scenario ${scenario.id} cannot be played on map ${map}`);
    }
  } else {
    map = config.map ?? (config.layout ? layoutToMap(config.layout) : defaultMapFor(n));
    if (mapSelection === 'random') map = randomMapFor(config.seed, n);
    // A veto between copies of the fixed beginner board means nothing: vote on random layouts.
    if (mapSelection === 'veto' && map === 'base') map = 'baseRandom';
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
  const clock = config.timer ?? null;
  if (clock !== null) {
    if (timer !== null) throw new Error('use either timer or turnTimerSec, not both');
    if (!isTimerPreset(clock.preset) || (clock.preset as string) === 'off') {
      throw new Error(`unknown timer preset ${String(clock.preset)}`);
    }
    timerSettings(clock.preset, clock); // validates the ranges (throws)
  }
  // A scenario may default 5+ player games to the paired players' turn (E&P 5-6).
  const secondSettler = config.secondSettler ?? (n >= 5 && scenario?.pairedTurns56 === true);
  if (secondSettler && n < 4) {
    throw new Error('second settler needs 4+ players (Catanian 2 sits third to the left)');
  }
  if (secondSettler && config.specialBuildPhase) {
    throw new Error('second settler replaces the special building phase; turn one off');
  }
  const start = config.startingPlayer ?? 'random';
  const shuffled = config.randomTurnOrder === true;
  const startingPlayer =
    start !== 'random'
      ? intInRange('startingPlayer', start, { min: 0, max: n - 1 })
      : shuffled
        ? 0
        : randomStartingPlayer(config.seed, n);
  const robberMode = config.robberMode ?? 'normal';
  if (!ROBBER_MODES.includes(robberMode)) throw new Error(`unknown robberMode ${robberMode}`);
  const eventCards = config.eventCards ?? false;
  if (eventCards && config.balancedDice) {
    throw new Error(
      'eventCards and balancedDice cannot both be on (the event deck replaces the dice)',
    );
  }
  const placement = config.setupPlacement;
  if (placement !== undefined) validateSetupPlacement(placement);
  const allowed = config.mapRules === undefined ? {} : validateMapRules(config.mapRules);
  if (config.rules56) {
    if (n < RULES56_MIN_PLAYERS) throw new Error(`rules56 needs ${RULES56_MIN_PLAYERS}+ players`);
    if (secondSettler)
      throw new Error('rules56 uses the special building phase, not second settler');
    if (config.specialBuildPhase === false) {
      throw new Error('rules56 needs the special building phase');
    }
  }
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
    specialBuildPhase: config.specialBuildPhase ?? (n >= 5 && !secondSettler),
    hideBankCards: config.hideBankCards ?? false,
    turnTimerSec: timer,
    startingPlayer,
    mode: mode.id,
    expansions: modules.map((m) => m.id),
    scenario: scenario?.id ?? null,
    options,
    // Variants are written only when they differ from the official rule, so default settings
    // (and every existing save) look exactly as before.
    ...(robberMode === 'normal' ? {} : { robberMode }),
    ...(eventCards ? { eventCards } : {}),
    ...(placement === undefined || isOfficialSetup(placement)
      ? {}
      : { setupPlacement: structuredCopy(placement) }),
    ...(shuffled ? { seatOrder: randomSeatOrder(config.seed, n) } : {}),
    ...(mapSelection === 'fixed' ? {} : { mapSelection }),
    ...(config.rushMode ? { rushMode: true } : {}),
    ...(config.turboMode ? { turboMode: true } : {}),
    ...(secondSettler ? { secondSettler: true } : {}),
    ...(clock ? { timer: { ...clock } } : {}),
    ...(Object.keys(allowed).length > 0 ? { mapRules: allowed } : {}),
    ...(config.rules56 ? { rules56: true } : {}),
  };
  for (const m of modules) {
    const err = m.validate?.(settings);
    if (err) throw new Error(`${m.id}: ${err}`);
  }
  return settings;
}

/** VP target bonus of the boolean options that are on (OptionDef.vpBonus). */
export function optionVpBonus(
  modules: readonly ExpansionInfo[],
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

/** Only the `true` flags are kept, so default settings stay free of the field. */
function validateMapRules(rules: MapRules): MapRules {
  const out: MapRules = {};
  for (const [k, v] of Object.entries(rules)) {
    if (!(MAP_RULE_KEYS as readonly string[]).includes(k)) throw new Error(`unknown map rule ${k}`);
    if (typeof v !== 'boolean') throw new Error(`map rule ${k} must be true or false`);
    if (v) out[k as keyof MapRules] = true;
  }
  return out;
}

/** Map selection 'random': a seeded pick (own stream) among the maps that fit `playerCount`. */
export function randomMapFor(seed: number | string, playerCount: number): MapId {
  const fits = MAP_IDS.filter(
    (id) => playerCount >= MAPS[id].minPlayers && playerCount <= MAPS[id].maxPlayers,
  );
  return Rng.fromSeed(`map:${typeof seed === 'number' ? `n${seed}` : seed}`).pick(fits);
}

/** Map selection 'random' in a scenario: a seeded pick among its maps that fit `playerCount`. */
function randomScenarioMap(
  seed: number | string,
  scenario: ScenarioDef,
  playerCount: number,
): MapId {
  const fits = scenario.maps.filter((id) => {
    const def = isMapId(id) ? mapById(id) : undefined;
    return def !== undefined && playerCount >= def.minPlayers && playerCount <= def.maxPlayers;
  });
  const rng = Rng.fromSeed(`map:${typeof seed === 'number' ? `n${seed}` : seed}`);
  return fits.length > 0 ? rng.pick(fits) : scenario.mapFor(playerCount);
}

function validateSetupPlacement(p: SetupPlacement): void {
  for (const round of [p.first, p.second]) {
    if (!SETUP_BUILDINGS.includes(round.building)) {
      throw new Error(`unknown setup building ${String(round.building)}`);
    }
    if (!SETUP_RESTRICTIONS.includes(round.restriction)) {
      throw new Error(`unknown setup restriction ${String(round.restriction)}`);
    }
  }
}

function isOfficialSetup(p: SetupPlacement): boolean {
  const o = OFFICIAL_SETUP;
  return (
    p.first.building === o.first.building &&
    p.first.restriction === o.first.restriction &&
    p.second.building === o.second.building &&
    p.second.restriction === o.second.restriction
  );
}

function structuredCopy(p: SetupPlacement): SetupPlacement {
  return { first: { ...p.first }, second: { ...p.second } };
}

/** Build the initial state: board generated, deck shuffled, phase = setup (starting player, settlement). */
export function createGame(config: GameConfig): GameState {
  const settings = resolveSettings(config);
  const def = mapById(settings.map);
  const supply = supplyOf({ settings });

  const rng = Rng.fromSeed(config.seed);
  const n = config.players.length;
  const mapRules = mapRulesOf(settings);
  const firstDesertOnly = rules56On(settings);
  const { board, robber } = generateBoard(settings.map, rng, n, mapRules, firstDesertOnly);
  // Map veto: more candidate boards from the same stream (only then, so other games keep
  // their boards, decks and rolls per seed).
  const candidates: MapCandidate[] =
    settings.mapSelection === 'veto'
      ? [
          { board, robber },
          ...Array.from({ length: MAP_VETO_CANDIDATES - 1 }, () =>
            generateBoard(settings.map, rng, n, mapRules, firstDesertOnly),
          ),
        ]
      : [];

  const deck: DevCardType[] = [];
  for (const t of DEV_CARD_TYPES) {
    for (let i = 0; i < supply.devDeck[t]; i++) deck.push(t);
  }
  const devDeck = rng.shuffle(deck);

  const order = settings.seatOrder ?? config.players.map((_, i) => i);
  const seated = order.map((i) => config.players[i] as PlayerConfig);
  const players: Player[] = seated.map((p, id) => ({
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
  const veto = candidates.length > 0;
  const vetoers = vetoOrder(players.length, first, candidates.length);
  const state: GameState = {
    schemaVersion: 6,
    settings,
    board,
    pieces: { buildings: {}, roads: {} },
    robber,
    players,
    bank,
    devDeck,
    turn: {
      number: 0,
      current: veto ? (vetoers[0] as PlayerId) : first,
      devCardPlayed: false,
      tradeOffers: 0,
    },
    phase: veto
      ? {
          kind: 'mapVeto',
          candidates,
          vetoed: candidates.map((): null => null),
          order: vetoers,
          next: 0,
        }
      : { kind: 'setup', index: 0, step: 'settlement', lastSettlement: null },
    dice: null,
    diceDeck: [],
    awards: { longestRoad: null, largestArmy: null },
    log: [
      {
        turn: 0,
        player: null,
        text: `Game created (${title}, seed ${String(config.seed)})`,
      },
      ...(settings.seatOrder
        ? [{ turn: 0, player: null, text: `Turn order: ${players.map((p) => p.name).join(', ')}` }]
        : []),
      { turn: 0, player: first, text: `${players[first]?.name ?? `Player ${first + 1}`} starts` },
    ],
    rng: rng.state,
    winner: null,
    ext: {},
    stats: emptyStats(players.length),
    ...(settings.eventCards
      ? { eventDeck: [], lastEvent: null, damagedRoads: players.map((): null => null) }
      : {}),
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
