// @vitest-environment jsdom
/**
 * s18: picking an expansion fetches its modules; until they arrive the scenario previews are
 * placeholders and Start is off. A fresh module graph (vi.resetModules): nothing is installed.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SetupStorage } from './model';

const memory = (): SetupStorage => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('setup screen with expansions on demand', () => {
  it('waits for the mode’s modules before previews and Start', async () => {
    vi.resetModules();
    const engine = await import('../../engine');
    const load = await import('../../expansions/load');
    const { SetupScreen } = await import('./screen');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    engine.setModuleLoader(async (id) => {
      await gate;
      load.installPack(await load.loadPack(id));
    });
    const screen = new SetupScreen({ onStart: () => undefined, storage: memory() });
    document.body.append(screen.element);
    const start = () => screen.element.querySelector<HTMLButtonElement>('[data-k="start"]');
    expect(start()?.disabled).toBe(false);

    screen.element.querySelector<HTMLButtonElement>('[data-k="chip-seafarers"]')?.click();
    expect(screen.state.mode).toBe('seafarers');
    expect(start()?.disabled).toBe(true);
    expect(screen.element.querySelector('.su-load-note')?.textContent).toBe('Loading Seafarers…');
    expect(screen.element.querySelectorAll('.su-map-loading').length).toBeGreaterThan(0);

    release();
    await vi.waitFor(() => expect(engine.modulesReady('seafarers')).toBe(true));
    await vi.waitFor(() => expect(screen.element.querySelector('.su-loading')).toBeNull());
    expect(start()?.disabled).toBe(false);
    expect(screen.element.querySelectorAll('.su-map-art svg').length).toBeGreaterThan(0);
    screen.element.remove();
  });
});
