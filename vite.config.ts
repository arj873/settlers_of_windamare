import { execSync } from 'node:child_process';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

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
    plugins: [cspRoomServer(env.VITE_ROOM_SERVER)],
    define: { __APP_VERSION__: JSON.stringify(appVersion()) },
    // '/' for Cloudflare/Netlify/Vercel/custom domain; set VITE_BASE=/<repo>/ for GitHub Pages project sites.
    base: process.env.VITE_BASE ?? '/',
    // Online play against `wrangler dev` (M2): open the app with `?server=remote`. Without it,
    // `pnpm dev` runs the room server in the browser (src/game/online/devServer.ts).
    server: {
      proxy: { '/api': { target: 'http://localhost:8787', ws: true, changeOrigin: true } },
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
