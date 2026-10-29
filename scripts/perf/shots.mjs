// Screenshots of fixed screens for before/after comparisons (s17):
//   node scripts/perf/shots.mjs <baseUrl> <outDir> [--perf auto|high|low] [--reduced-motion]
// Fixtures with every seat human (the cover is dismissed), a setup screen and the home screen,
// at a desktop and a phone size. Animations are left to finish before each shot.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [base = 'http://localhost:4173', out = 'playtest/shots/perf/shots'] = process.argv
  .slice(2)
  .filter((a) => !a.startsWith('--'));
const args = process.argv.slice(2);
const perf = args.includes('--perf') ? args[args.indexOf('--perf') + 1] : null;
const reduced = args.includes('--reduced-motion');
mkdirSync(out, { recursive: true });

const SIZES = {
  desktop: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 },
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
};
const SCREENS = [
  ['home', ''],
  ['midGame', '?fixture=midGame&seats=hhhh&debug=1'],
  ['discard', '?fixture=discardGame&seats=hhhh&debug=1'],
  ['trade', '?fixture=tradeOfferGame&seats=hhhh&debug=1'],
  ['gameOver', '?fixture=gameOverGame&seats=hhhh&debug=1'],
  ['setup', '?fixture=setupInProgressGame&seats=hhhh&debug=1'],
];

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
for (const [size, opts] of Object.entries(SIZES)) {
  for (const [name, q] of SCREENS) {
    const ctx = await browser.newContext({
      ...opts,
      reducedMotion: reduced ? 'reduce' : 'no-preference',
    });
    await ctx.addInitScript((p) => {
      try {
        // A first visit offers the tutorial over the home screen; keep the shots comparable.
        localStorage.setItem('catan:tutorial:v1', JSON.stringify({ offered: true }));
        if (p) localStorage.setItem('catan.performance', p);
      } catch {
        /* ignore */
      }
    }, perf);
    const page = await ctx.newPage();
    await page.goto(`${base}/${q}`);
    if (q) {
      await page.waitForFunction(() => window.__catanDebug?.state(), null, { timeout: 60_000 });
      const cover = await page.$('.cover .btn-primary');
      if (cover) await cover.click();
    } else {
      await page.waitForSelector('[data-k="offline"]');
    }
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(out, `${size}-${name}.png`) });
    await ctx.close();
  }
}
await browser.close();
console.log(`shots in ${out}`);
