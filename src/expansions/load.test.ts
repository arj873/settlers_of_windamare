/**
 * s18 (docs/EXPANSIONS.md §2b): expansion rules load on demand. Each test imports a fresh module
 * graph (vi.resetModules), where no module is installed yet, unlike the rest of the suite.
 */
import { describe, expect, it, vi } from 'vitest';
import { PLAYER_COLORS, createGame } from '../engine';
import { legalActions } from '../engine/engine';
import type * as EngineApi from '../engine';
import type * as EngineCoreApi from '../engine/engine';
import type * as LoadApi from './load';

type Engine = typeof EngineApi;
type EngineCore = typeof EngineCoreApi;
type Load = typeof LoadApi;

async function fresh(): Promise<{ engine: Engine; core: EngineCore; load: Load }> {
  vi.resetModules();
  const engine = await import('../engine');
  const core = await import('../engine/engine');
  const load = await import('./load');
  return { engine, core, load };
}

const players = PLAYER_COLORS.slice(0, 4);

describe('expansions on demand', () => {
  it('knows every mode, scenario and map before any rules load', async () => {
    const { engine } = await fresh();
    expect(engine.allModules()).toEqual([]);
    expect(engine.modeById('seafarers+ck')?.expansions).toEqual(['seack']);
    expect(engine.scenarioById('seafarers/newShores')?.mapFor(4)).toBe('seafarers/hns4');
    expect(engine.expansionById('ck')?.name).toBe('Cities & Knights');
    expect(engine.isMapId('seafarers/hns4')).toBe(true);
    expect(engine.modulesOf('seafarers+ck').sort()).toEqual(['ck', 'seack', 'seafarers']);
    expect(engine.modulesReady('base')).toBe(true);
    expect(engine.modulesReady('ck')).toBe(false);
  });

  it('plays base games with nothing loaded', async () => {
    const { engine, core } = await fresh();
    const s = engine.createGame({ seed: 1, players });
    expect(core.legalActions(s).length).toBeGreaterThan(0);
  });

  it('refuses an expansion game until its modules are loaded, with a clear error', async () => {
    const loaded = createGame({ seed: 2, players, mode: 'ck' });
    expect(legalActions(loaded).length).toBeGreaterThan(0);
    const { engine, core } = await fresh();
    expect(() => engine.createGame({ seed: 2, players, mode: 'ck' })).toThrow(
      engine.ModuleNotLoadedError,
    );
    expect(() => engine.createGame({ seed: 2, players, mode: 'ck' })).toThrow(/ensureModules/);
    expect(() => core.legalActions(loaded)).toThrow(engine.ModuleNotLoadedError);
    expect(() => engine.mapById('seafarers/hns4')).toThrow(engine.ModuleNotLoadedError);
    // Without a loader (headless code installs everything up front) ensureModules rejects.
    await expect(engine.ensureModules('ck')).rejects.toThrow(engine.ModuleNotLoadedError);
  });

  it('keeps old expansion saves readable before the rules load (migration uses the catalog)', async () => {
    const saved = JSON.parse(
      JSON.stringify(createGame({ seed: 3, players, mode: 'seafarers' })),
    ) as unknown;
    const { engine } = await fresh();
    expect(engine.upgradeState(saved)?.settings.mode).toBe('seafarers');
  });

  it('ensureModules loads a mode with its requires, then the same game plays', async () => {
    const { engine, core, load } = await fresh();
    const seen: string[] = [];
    load.useBrowserLoader((pack) => seen.push(pack.module.id));
    await Promise.all([engine.ensureModules('seafarers+ck'), engine.ensureModules('ck')]);
    expect(seen.sort()).toEqual(['ck', 'seack', 'seafarers']);
    expect(engine.modulesReady('seafarers+ck')).toBe(true);
    expect(engine.modulesReady('ep')).toBe(false);
    const s = engine.createGame({ seed: 4, players, mode: 'seafarers+ck' });
    expect(s).toEqual(createGame({ seed: 4, players, mode: 'seafarers+ck' }));
    expect(core.legalActions(s)).toEqual(legalActions(s));
    // Loaded modules resolve at once and load nothing again.
    await engine.ensureModules(s.settings.expansions);
    expect(seen).toHaveLength(3);
  });

  it('a failed download rejects, and the next call tries again', async () => {
    const { engine, load } = await fresh();
    let fail = true;
    engine.setModuleLoader(async (id) => {
      if (fail) throw new Error('offline');
      load.installPack(await load.loadPack(id));
    });
    await expect(engine.ensureModules('oil')).rejects.toThrow('offline');
    fail = false;
    await engine.ensureModules('oil');
    expect(engine.modulesReady('oil')).toBe(true);
  });
});
