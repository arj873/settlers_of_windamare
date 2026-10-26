/**
 * The expansion registry: every built-in module, plus lookups for modes, scenarios and maps.
 *
 * ADDING A MODULE: one import below and one entry at the END of builtinModules(). That is the
 * only shared engine edit an expansion makes (docs/EXPANSIONS.md §10-11).
 *
 * Expansion modules import core engine files and the core imports this file, so there is an
 * import cycle. It is harmless because the list is built lazily (on first lookup, never at module
 * top level) and modules only read constants / maps / hex data at their own top level.
 */
import { demoModule } from '../../expansions/demo/engine';
import { cropModule } from '../../expansions/crop/engine';
import { oilModule } from '../../expansions/oil/engine';
import { ckModule } from '../../expansions/ck/engine';
import { seafarersModule } from '../../expansions/seafarers/engine';
import { tbModule } from '../../expansions/tb/engine';
import { epModule } from '../../expansions/ep/engine';
import { seackModule } from '../../expansions/seack/engine';
import { tbckModule } from '../../expansions/tbck/engine';
import { MAPS, type MapDef } from '../maps';
import type { ExpansionId, GameSettings, MapId, ModeId, ScenarioId } from '../types';
import type { ExpansionModule, ModeDef, ScenarioDef } from './types';

function builtinModules(): ExpansionModule[] {
  return [
    demoModule,
    oilModule,
    cropModule,
    ckModule,
    seafarersModule,
    tbModule,
    epModule,
    seackModule,
    tbckModule,
    // new modules go here, one per line
  ];
}

/** The base game as a mode: no expansions, the base maps. Always first, always the default. */
export const BASE_MODE: ModeDef = {
  id: 'base',
  name: 'Base',
  blurb: 'Settle, build, trade',
  status: 'ready',
  expansions: [],
  scenarios: [],
  players: { min: 3, max: 8 },
};

let modules: ExpansionModule[] | null = null;
const extra: ExpansionModule[] = [];

function all(): ExpansionModule[] {
  modules ??= builtinModules();
  return extra.length === 0 ? modules : [...modules, ...extra];
}

/** Every known module, in registry order (= the order hooks run in). */
export function allModules(): readonly ExpansionModule[] {
  return all();
}

/**
 * Tests only: add a module after the built-in ones (ids must be unique). Returns an undo
 * function. Games created while it is registered keep working only while it stays registered.
 */
export function registerExpansion(m: ExpansionModule): () => void {
  if (expansionById(m.id)) throw new Error(`expansion ${m.id} already registered`);
  extra.push(m);
  activeCache = new WeakMap();
  return () => {
    const i = extra.indexOf(m);
    if (i >= 0) extra.splice(i, 1);
    activeCache = new WeakMap();
  };
}

export function expansionById(id: ExpansionId): ExpansionModule | undefined {
  return all().find((m) => m.id === id);
}

export function isExpansionId(x: unknown): x is ExpansionId {
  return typeof x === 'string' && expansionById(x) !== undefined;
}

let activeCache = new WeakMap<object, readonly ExpansionModule[]>();
const NONE: readonly ExpansionModule[] = [];

/**
 * Modules active in a game, in settings order. Cached per settings object (settings are shared
 * between the states of a game), so hooks cost nothing in base games.
 */
export function activeModules(state: {
  settings: Pick<GameSettings, 'expansions'>;
}): readonly ExpansionModule[] {
  const s = state.settings;
  const ids = s.expansions as readonly ExpansionId[] | undefined;
  if (!ids || ids.length === 0) return NONE;
  let list = activeCache.get(s);
  if (!list) {
    list = ids.map((id) => {
      const m = expansionById(id);
      if (!m) throw new Error(`unknown expansion ${id}`);
      return m;
    });
    activeCache.set(s, list);
  }
  return list;
}

/** Is `id` active in this game? */
export function isActive(state: { settings: Pick<GameSettings, 'expansions'> }, id: ExpansionId) {
  return state.settings.expansions.includes(id);
}

/** The base mode first, then every module's modes in registry order. */
export function listModes(): readonly ModeDef[] {
  return [BASE_MODE, ...all().flatMap((m) => m.modes ?? [])];
}

export function modeById(id: ModeId): ModeDef | undefined {
  return listModes().find((m) => m.id === id);
}

export function allScenarios(): readonly ScenarioDef[] {
  return all().flatMap((m) => m.scenarios ?? []);
}

export function scenarioById(id: ScenarioId): ScenarioDef | undefined {
  return allScenarios().find((s) => s.id === id);
}

/** A base map or a module map, or undefined. */
export function mapDef(id: MapId): MapDef | undefined {
  if (Object.hasOwn(MAPS, id)) return MAPS[id as keyof typeof MAPS];
  for (const m of all()) {
    const def = m.maps?.find((d) => d.id === id);
    if (def) return def;
  }
  return undefined;
}
