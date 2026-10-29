// The glowing End turn button frozen at its glow phases, per theme (s18 item: the glow moved
// from an animated box-shadow to a fading pseudo-element):
//   node scripts/perf/glow-shots.mjs <baseUrl> <outDir>
// Writes <theme>-<phase>.png (the button panel, 3x zoom) for phases 0 %, 25 % and 50 % of the 2 s
// cycle (50 % = brightest).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [base = 'http://localhost:4173', out = 'playtest/shots/perf/glow'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const THEMES = ['sunfired', 'wood', 'parlour', 'chartroom', 'githubdark', 'materialdark'];
const PHASES = [0, 25, 50];

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  deviceScaleFactor: 3,
});
// "High quality": the glow is off in low power mode.
await ctx.addInitScript(() => localStorage.setItem('catan.performance', 'high'));
const page = await ctx.newPage();
for (const theme of THEMES) {
  await page.goto(`${base}/?fixture=midGame&seats=hhhh&debug=1&theme=${theme}`);
  await page.waitForFunction(() => window.__catanDebug?.state(), null, { timeout: 60_000 });
  const cover = await page.$('.cover .btn-primary');
  if (cover) await cover.click();
  await page.waitForSelector('.btn-end.is-ready, .btn-roll.is-ready');
  await page.waitForTimeout(800);
  for (const phase of PHASES) {
    // Every animation of the ready buttons frozen at `phase`. The button's own (box-shadow,
    // before s18) paused through the Web Animations API; its pseudo-elements' (opacity 0 → 1 → 0
    // ease-in-out, after) replaced by their opacity at that phase: paused compositor animations
    // show stale frames in headless screenshots.
    const OPACITY = { 0: 0, 25: 0.5, 50: 1 };
    const state = await page.evaluate(
      ([p, o]) => {
        for (const el of document.querySelectorAll('.is-ready')) {
          for (const a of el.getAnimations()) {
            a.pause();
            a.currentTime = (2000 * p) / 100;
          }
        }
        document.getElementById('glow-freeze')?.remove();
        const s = document.createElement('style');
        s.id = 'glow-freeze';
        s.textContent = `.is-ready::before, .is-ready::after {
          animation: none !important; opacity: ${o} !important; }`;
        document.head.append(s);
        const el = document.querySelector('.btn-end.is-ready, .btn-roll.is-ready');
        return `${getComputedStyle(el).boxShadow} | after ${getComputedStyle(el, '::after').opacity}`;
      },
      [phase, OPACITY[phase]],
    );
    console.log(`${theme} ${phase}%: ${state}`);
    await page.waitForTimeout(300);
    const box = await page.locator('.ctl-btns').boundingBox();
    if (!box) throw new Error('no .ctl-btns');
    const pad = 24;
    await page.screenshot({
      path: join(out, `${theme}-${phase}.png`),
      clip: {
        x: box.x - pad,
        y: box.y - pad,
        width: box.width + 2 * pad,
        height: box.height + 2 * pad,
      },
    });
  }
}
await browser.close();
console.log(`glow shots in ${out}`);
