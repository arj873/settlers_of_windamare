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
    plugins: [preloadGame(), cspRoomServer(env.VITE_ROOM_SERVER)],
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
      },
    },
    test: {
      include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
      environment: 'node',
      // Simulator tests take 1-7 s; parallel agents and CI runners can push them past vitest's
      // 5 s default. A hang still fails, just later.
      testTimeout: 30_000,
    },
  };
});
