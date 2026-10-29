import { execSync } from 'node:child_process';
import { loadEnv, type Plugin } from 'vite';
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
        // The game, and the Pixi renderer `Application.init` imports in turn (WebGL is preferred).
        // s18: found by a module they hold (a chunk group has no facade module); no browserAll
        // (`skipExtensionImports`).
        const lazy = ['/src/app.ts', '/gl/WebGLRenderer.mjs'];
        const game = chunks.filter((c) =>
          c.moduleIds.some((id) => lazy.some((f) => id.endsWith(f))),
        );
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

/**
 * s18: Pixi's browser extras (`browserAll`: its event system, accessibility, DOM containers,
 * filter system) are never loaded: the app inits Pixi with `skipExtensionImports` (the board
 * reads pointer input itself, render/viewport.ts; no filters). Pixi still reaches them through
 * one dynamic import in `browserExt`, which kept ~43 kB raw of them in the game chunk. That import
 * gets a stub (its own chunk, see NOT_IN_GAME) that fails loudly if anything ever loads it.
 */
const PIXI_EXTRAS_STUB = '\0pixi-browser-extras-skipped';
function pixiWithoutBrowserExtras(): Plugin {
  return {
    name: 'windamere:pixi-without-browser-extras',
    apply: 'build',
    enforce: 'pre',
    resolveId(source, importer) {
      const fromPixi = /[\\/]pixi\.js[\\/].*browserExt\.mjs$/.test(importer ?? '');
      return source === './browserAll.mjs' && fromPixi ? PIXI_EXTRAS_STUB : null;
    },
    load(id) {
      if (id !== PIXI_EXTRAS_STUB) return null;
      return 'throw new Error("Pixi\'s browser extensions are not bundled: init Pixi with skipExtensionImports (vite.config.ts)");';
    },
  };
}

/** An expansion module's folder (src/expansions/<id>/...) → its id. */
const EXPANSION_FILE = /[\\/]src[\\/]expansions[\\/]([^\\/]+)[\\/]/;
/**
 * Not in the game chunk, loaded on demand: the online client and the in-browser room server
 * (which imports every expansion); the Pixi extras stub (in the game chunk its `throw` would make
 * the bundler drop the code after it). Pixi's WebGPU and Canvas renderers stay in: the core
 * imports most of their modules statically (adaptors, programs, bind groups); apart they made
 * five more preloaded files for the same bytes.
 */
const NOT_IN_GAME =
  /[\\/]src[\\/](game[\\/]online[\\/]|ui[\\/]online[\\/]|net[\\/](client|session|loopback)\.ts|server[\\/]|expansions[\\/]headless\.ts)|pixi-browser-extras-skipped/;

/**
 * s18 chunks: left alone, the bundler splits every module the game core shares with an expansion
 * pack into its own small chunk (27 files for a base game, 6 for C&K). Instead: the home screen,
 * the game core (engine, HUD, board, controller, Pixi), and one chunk per expansion module; the
 * rest (the online client) keeps automatic chunking.
 */
const CHUNK_GROUPS = [
  // The home screen: main.ts and everything it imports statically.
  { name: 'index', tags: ['$initial' as const], priority: 3 },
  {
    name: 'game',
    test: (id: string) => !EXPANSION_FILE.test(id) && !NOT_IN_GAME.test(id),
    priority: 2,
  },
  {
    name: (id: string) => EXPANSION_FILE.exec(id)?.[1] ?? null,
    priority: 1,
    // Only the module's own files: the core it imports stays in the game chunk.
    includeDependenciesRecursively: false,
  },
];

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

/** The CSP marker in index.html that names where the page may open sockets and fetch. */
const CSP_CONNECT = "connect-src 'self'";

/**
 * `https://host` → `https://host wss://host` (loopback `http:` → `ws:`); unset → nothing. The
 * client (src/game/online/backend.ts) only talks to this origin, so nothing else is needed.
 */
function roomServerSources(roomServer: string | undefined): string[] {
  if (!roomServer) return [];
  const u = new URL(roomServer);
  const ws = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return [u.origin, `${ws}//${u.host}`];
}

/**
 * Content-Security-Policy (index.html, docs/MULTIPLAYER.md §12): the page's own origin covers the
 * Worker when both are deployed together (Cloudflare). Hosting the game elsewhere (GitHub Pages)
 * means building with VITE_ROOM_SERVER=https://…workers.dev, which this adds to the policy.
 */
function cspRoomServer(roomServer: string | undefined): Plugin {
  const sources = roomServerSources(roomServer);
  return {
    name: 'csp-room-server',
    transformIndexHtml(html) {
      if (sources.length === 0) return html;
      if (!html.includes(CSP_CONNECT)) {
        throw new Error(`index.html: the CSP meta tag has no "${CSP_CONNECT}"`);
      }
      return html.replace(CSP_CONNECT, `${CSP_CONNECT} ${sources.join(' ')}`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [preloadGame(), pixiWithoutBrowserExtras(), cspRoomServer(env.VITE_ROOM_SERVER)],
    define: { __APP_VERSION__: JSON.stringify(appVersion()) },
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
        output: { codeSplitting: { groups: CHUNK_GROUPS } },
      },
    },
    test: {
      include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
      environment: 'node',
      setupFiles: ['src/testSetup.ts'],
      // Simulator tests take 1-7 s; parallel agents and CI runners can push them past vitest's
      // 5 s default. A hang still fails, just later.
      testTimeout: 30_000,
    },
  };
});
