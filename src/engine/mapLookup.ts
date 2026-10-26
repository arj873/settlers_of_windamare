/**
 * Map lookups over base AND expansion maps (maps.ts holds the base data and must not import the
 * expansion registry, see registry.ts).
 */
import { hookSupply } from './expansions/hooks';
import { mapDef } from './expansions/registry';
import type { Supply } from './expansions/types';
import { MAPS, isBaseMapId, type MapDef } from './maps';
import type { GameSettings, GameState, MapId } from './types';

/** A known map id (base map or a registered module's map). */
export function isMapId(x: unknown): x is MapId {
  return typeof x === 'string' && (isBaseMapId(x) || mapDef(x as MapId) !== undefined);
}

/**
 * The map definition of an id; throws for unknown ids. Base maps never touch the registry, so
 * module-load-time code (the deprecated TOPOLOGY) works inside the registry's import cycle.
 */
export function mapById(id: MapId): MapDef {
  const def = isBaseMapId(id) ? MAPS[id] : mapDef(id);
  if (!def) throw new Error(`unknown map ${String(id)}`);
  return def;
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
