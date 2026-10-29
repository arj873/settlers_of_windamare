// Vitest setup (every test file): every expansion module installed, as before s18 made them load on
// demand in the browser (docs/EXPANSIONS.md §2b). Registry tests that need a module unloaded use a
// fresh module graph (vi.resetModules).
import { installAllPacks } from './expansions/load';

// jsdom has no canvas: getContext() returns null and logs "Not implemented". Pixi (imported with
// the board drawers) probes it on import; same null, without the log.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext'];
}

await installAllPacks();
