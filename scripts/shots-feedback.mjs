// FB1 screenshots: the open HUD menu (Report a bug / Suggest a feature) and the home footer.
// Usage: pnpm dev --port 5199 &  node scripts/shots-feedback.mjs [baseUrl] [outDir] [themes,comma]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [
  base = 'http://localhost:5199',
  out = 'playtest/shots/feedback',
  themes = 'wood,githubdark',
] = process.argv.slice(2);
const SIZES = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, scale: 1 },
  { name: 'phone', viewport: { width: 390, height: 844 }, scale: 2 },
];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
for (const theme of themes.split(',')) {
  for (const size of SIZES) {
    const ctx = await browser.newContext({
      viewport: size.viewport,
      deviceScaleFactor: size.scale,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}/?server=local&theme=${theme}`);
    await page.waitForSelector('.fb-link', { timeout: 30_000 });
    await page.screenshot({ path: `${out}/home-${theme}-${size.name}.png` });
    await page.goto(`${base}/?fixture=midGame&theme=${theme}`);
    await page.locator('.menu-btn').click();
    await page.waitForSelector('.menu-panel a.menu-item');
    await page.waitForTimeout(800); // let the open animation finish
    await page.screenshot({ path: `${out}/menu-${theme}-${size.name}.png` });
    await ctx.close();
  }
}
await browser.close();
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors');
