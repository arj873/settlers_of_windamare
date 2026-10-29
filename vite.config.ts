import { execSync } from 'node:child_process';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * s17: the entry (src/main.ts) paints the home screen and imports the game (src/app.ts) at once.
 * Without help the game's chunks start downloading only after the entry ran, one round trip
 * late; these low-priority preload links fetch them beside the entry instead.
 */
function preloadGame(): Plugin {
  let base = '/';
  return {
    name: 'windamere:preload-game',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const chunks = Object.values(ctx.bundle ?? {}).flatMap((c) =>
          c.type === 'chunk' ? [c] : [],
        );
        // The game, and the Pixi parts `Application.init` imports in turn (WebGL is preferred).
        const lazy = [
          '/src/app.ts',
          '/environment-browser/browserAll.mjs',
          '/gl/WebGLRenderer.mjs',
        ];
        const game = chunks.filter((c) => lazy.some((f) => c.facadeModuleId?.endsWith(f)));
        const entry = chunks.find((c) => c.isEntry);
        if (game.length === 0 || !entry) return;
        const have = new Set([entry.fileName, ...entry.imports]);
        const js = new Set(game.flatMap((c) => [c.fileName, ...c.imports]));
        const css = new Set(game.flatMap((c) => [...(c.viteMetadata?.importedCss ?? [])]));
        return [
          ...[...js]
            .filter((f) => !have.has(f))
            .map((f) => ({ rel: 'modulepreload', href: base + f, crossorigin: '' })),
          ...[...css].map((f) => ({
            rel: 'preload',
            as: 'style',
            href: base + f,
            crossorigin: '',
          })),
        ].map((attrs) => ({
          tag: 'link',
          attrs: { ...attrs, fetchpriority: 'low' },
          injectTo: 'head' as const,
        }));
      },
    },
  };
}

/** Git short SHA for the bug-report prefill (FB1); "dev" outside a git checkout. */
function appVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [preloadGame()],
  // '/' for Cloudflare/Netlify/Vercel/custom domain; set VITE_BASE=/<repo>/ for GitHub Pages project sites.
  base: process.env.VITE_BASE ?? '/',
  // Online play against `wrangler dev` (M2): open the app with `?server=remote`. Without it,
  // `pnpm dev` runs the room server in the browser (src/game/online/devServer.ts).
  server: {
    proxy: { '/api': { target: 'http://localhost:8787', ws: true, changeOrigin: true } },
  },
  build: {
    rolldownOptions: {
      // Our modules only declare things (s17): one whose exports nobody uses is left out, so the
      // home screen's chunk does not drag in the engine through a shared helper. Stylesheets and
      // the dev worker do run on import.
      treeshake: {
        moduleSideEffects: [
          { test: /\.css$/, sideEffects: true },
          { test: /\/src\/game\/online\/devWorker\.ts$/, sideEffects: true },
          { test: /\/src\/.*\.ts$/, sideEffects: false },
        ],
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // Simulator tests take 1-7 s; parallel agents and CI runners can push them past vitest's
    // 5 s default. A hang still fails, just later.
    testTimeout: 30_000,
  },
});
