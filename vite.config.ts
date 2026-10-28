import { execSync } from 'node:child_process';
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

export default defineConfig({
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
});
