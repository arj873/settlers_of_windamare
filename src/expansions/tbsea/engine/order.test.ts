/**
 * Import order (regression): with a Seafarers or T&B file as the first import (src/audio's tests
 * import `seafarers/sounds`), the registry loads tbsea while those modules are half-evaluated.
 * tbsea must read nothing of theirs at its top level: it loads, and its module data is whole.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const root = join(__dirname, '..', '..');
/** Every module's entry points the app and the tests import first: engine/index.ts, sounds.ts. */
const entries = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => {
    const own = readdirSync(join(root, d.name));
    return [
      join(root, d.name, 'engine', 'index.ts'),
      ...(own.includes('sounds.ts') ? [join(root, d.name, 'sounds.ts')] : []),
    ];
  });

describe('tbsea and the import cycle', () => {
  it('any module entry may be the first import', { timeout: 120_000 }, async () => {
    for (const file of entries) {
      vi.resetModules();
      await import(file);
      const { tbseaModule, FISH_PIRATE, FISH_SHIP } = await import('.');
      const { FISH_COST } = await import('../../tb/engine/state');
      const { SEA_ACTIONS } = await import('../../seafarers/engine/actions');
      const at = file.slice(root.length);
      expect(tbseaModule.requires, at).toEqual(['tb', 'seafarers']);
      expect(tbseaModule.modes?.[0]?.hideOptions, at).toEqual(['seafarers.layout']);
      for (const sc of tbseaModule.scenarios ?? []) {
        expect(Object.keys(sc.playsAs ?? {}).sort(), `${at} ${sc.id}`).toEqual(['seafarers', 'tb']);
      }
      for (const m of tbseaModule.maps ?? []) {
        expect(typeof m.bankPerResource, `${at} ${m.id}`).toBe('number');
        expect(m.devDeck, `${at} ${m.id}`).toBeDefined();
      }
      expect(Object.keys(tbseaModule.wraps ?? {}).sort(), at).toEqual(
        [
          SEA_ACTIONS.buildShip,
          SEA_ACTIONS.freeShip,
          SEA_ACTIONS.setupShip,
          SEA_ACTIONS.pickShip,
          SEA_ACTIONS.moveShip,
        ].sort(),
      );
      // The fish costs are T&B's (kept as literals so nothing is read at load time).
      expect([FISH_PIRATE, FISH_SHIP], at).toEqual([FISH_COST.robber, FISH_COST.road]);
    }
  });
});
