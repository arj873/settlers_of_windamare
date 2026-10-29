/**
 * The module catalog (s18, docs/EXPANSIONS.md §2b): what the app knows of every module before its
 * rules load. `catalogData.ts` is generated from the modules by `pnpm gen:catalog`
 * (scripts/gen-catalog.ts); `catalog.test.ts` fails when it is out of date.
 */
import type { MapId } from '../types';
import type { CatalogEntry, ExpansionInfo, ExpansionModule } from './types';

/** JSON copy without `undefined` fields (the generated file holds plain data). */
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** A module's catalog entry: its info as plain data, each scenario's map per player count. */
export function catalogEntry(m: ExpansionModule): CatalogEntry {
  return json({
    id: m.id,
    name: m.name,
    icon: m.icon,
    requires: m.requires,
    conflicts: m.conflicts,
    before: m.before,
    variant: m.variant,
    players: m.players,
    terrains: m.terrains,
    maps: m.maps?.map(({ id, name, minPlayers, maxPlayers }) => ({
      id,
      name,
      minPlayers,
      maxPlayers,
    })),
    scenarios: m.scenarios?.map(({ mapFor, ...s }) => {
      const table: Record<string, MapId> = {};
      for (let n = s.players.min; n <= s.players.max; n++) table[n] = mapFor(n);
      return { ...s, mapFor: table };
    }),
    modes: m.modes,
    options: m.options,
  });
}

/** The module info of a catalog entry (`mapFor` reads the table; out of range: the nearest end). */
export function infoOf(entry: CatalogEntry): ExpansionInfo {
  const { scenarios, ...rest } = entry;
  if (!scenarios) return rest;
  return {
    ...rest,
    scenarios: scenarios.map(({ mapFor: table, ...s }) => ({
      ...s,
      mapFor: (players: number) =>
        table[Math.min(s.players.max, Math.max(s.players.min, players))] as MapId,
    })),
  };
}
