/**
 * Map lookups over base AND expansion maps (maps.ts holds the base data and must not import the
 * expansion registry, see registry.ts).
 */
import { hookSupply } from './expansions/hooks';
import { activeModules, expansionMapInfo, mapDef, requireModule } from './expansions/registry';
import type { Supply } from './expansions/types';
import { MAPS, isBaseMapId, type MapDef } from './maps';
import { namespaceOf } from './expansions/ext';
import type { GameSettings, GameState, MapId } from './types';

/** A known map id (base map or any catalog module's map, loaded or not). */
export function isMapId(x: unknown): x is MapId {
  return (
    typeof x === 'string' &&
    (isBaseMapId(x) ||
      mapDef(x as MapId) !== undefined ||
      expansionMapInfo(x as MapId) !== undefined)
  );
}

/**
 * The map definition of an id; throws for unknown ids, and `ModuleNotLoadedError` for a map of a
 * module whose rules are not loaded (s18). Base maps never touch the registry.
 */
export function mapById(id: MapId): MapDef {
  const def = isBaseMapId(id) ? MAPS[id] : mapDef(id);
  if (def) return def;
  const ns = namespaceOf(id);
  if (ns !== null && expansionMapInfo(id)) requireModule(ns);
  throw new Error(`unknown map ${String(id)}`);
}

/** The map definition of a state (or of anything carrying `settings.map`). */
export function mapOf(state: { settings: { map: MapId } }): MapDef {
  return mapById(state.settings.map);
}

/**
 * Bank stock per resource and dev deck composition for this game: the map's, changed by the
 * active expansions' `supply` hooks.
 */
export function supplyOf(state: { settings: Pick<GameSettings, 'map' | 'expansions'> }): Supply {
  const m = mapOf(state);
  const base: Supply = { bankPerResource: m.bankPerResource, devDeck: m.devDeck };
  return hookSupply(state as Pick<GameState, 'settings'>, base);
}

/**
 * The development deck as the HUD counts it: `left` undrawn cards, `total` in the game (the
 * supply's dev deck plus every module's `extraDevCards` hook). Works on full states and views.
 */
export function devDeckCounts(state: GameState): { left: number; total: number } {
  const deck = supplyOf(state).devDeck;
  let left = state.devDeck.length;
  let total = Object.values(deck).reduce((n, k) => n + k, 0);
  for (const m of activeModules(state)) {
    const extra = m.hooks?.extraDevCards?.(state);
    if (!extra) continue;
    left += extra.deck;
    total += extra.total;
  }
  return { left, total };
}
