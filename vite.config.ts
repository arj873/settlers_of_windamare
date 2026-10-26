import { defineConfig } from 'vitest/config';

export default defineConfig({
  // '/' for Cloudflare/Netlify/Vercel/custom domain; set VITE_BASE=/<repo>/ for GitHub Pages project sites.
  base: process.env.VITE_BASE ?? '/',
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
