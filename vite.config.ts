import { defineConfig } from 'vitest/config';

export default defineConfig({
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
  },
});
