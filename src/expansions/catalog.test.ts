/**
 * s18: the generated catalog (src/engine/expansions/catalogData.ts) and the module lists that
 * load on demand (load.ts PACKS) or statically (headless.ts) stay in step with the modules.
 */
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogEntry, infoOf } from '../engine/expansions/catalog';
import { CATALOG } from '../engine/expansions/catalogData';
import { HEADLESS } from './headless';
import { PACKS, loadPack } from './load';

const folders = readdirSync(__dirname, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

describe('expansion catalog', () => {
  it('is up to date with the modules (else: pnpm gen:catalog)', () => {
    expect(CATALOG).toEqual(HEADLESS.map(([m]) => catalogEntry(m)));
  });

  it('lists every folder once, in the same order as the headless list and the packs', () => {
    const ids = CATALOG.map((e) => e.id);
    expect([...ids].sort()).toEqual(folders);
    expect(HEADLESS.map(([m]) => m.id)).toEqual(ids);
    expect(Object.keys(PACKS)).toEqual(ids);
  });

  it("each pack holds its module's parts, the same objects the headless list uses", async () => {
    for (const [module, bots] of HEADLESS) {
      const pack = await loadPack(module.id);
      expect(pack.module, module.id).toBe(module);
      expect(pack.bots, module.id).toBe(bots);
      expect(pack.hud.id, module.id).toBe(module.id);
      if (pack.drawer) expect(pack.drawer.id, module.id).toBe(module.id);
    }
  });

  it("a scenario's catalog mapFor gives the module's map for every seat count", () => {
    for (const [module] of HEADLESS) {
      const info = infoOf(catalogEntry(module));
      for (const s of module.scenarios ?? []) {
        const mine = info.scenarios?.find((x) => x.id === s.id);
        for (let n = s.players.min; n <= s.players.max; n++) {
          expect(mine?.mapFor(n), `${s.id} ${n}`).toBe(s.mapFor(n));
        }
      }
    }
  });
});
