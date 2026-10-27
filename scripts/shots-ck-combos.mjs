// C&K combinations (C5) in vite preview: the setup screen with Barbarian Attack + C&K and Catan
// for Two + C&K, then an all-bot game per combo (start, mid-game in several themes).
// Usage: node scripts/shots-ck-combos.mjs <baseUrl> <outDir>
import { chromium } from 'playwright';

const [base = 'http://localhost:4173', out = 'playtest/shots/ck-combos'] = process.argv.slice(2);
const THEMES = ['sunfired', 'githubdark', 'parlour'];
const GAMES = [
  { mode: 'ba+ck', scenario: 'tb/barbarianAttack', bots: 4, mid: 40 },
  { mode: 'two+ck', scenario: 'tb/variants', bots: 2, mid: 20 },
];

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const watch = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag}: ${String(e)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${tag}: ${m.text()}`));
};
const state = (page) => page.evaluate(() => window.__catanDebug?.state());

{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page, 'setup');
  await page.goto(`${base}/?theme=sunfired`);
  await page.getByText('Play offline').click();
  await page.waitForSelector('[data-k="mode-ba+ck"]', { timeout: 30_000 });
  for (const g of GAMES) {
    await page.click(`[data-k="mode-${g.mode}"]`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/setup-${g.mode.replace('+', '_')}.png` });
  }
  await page.close();
}

for (const g of GAMES) {
  const tag = g.mode.replace('+', '_');
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page, tag);
  await page.goto(
    `${base}/?mode=${encodeURIComponent(g.mode)}&scenario=${g.scenario}&autoplay=${g.bots}bots&speed=1&seed=7&debug=1&theme=sunfired`,
  );
  await page.waitForFunction(() => window.__catanDebug?.state().turn.number >= 1, null, {
    timeout: 60_000,
    polling: 200,
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${tag}-1-start.png` });
  await page.waitForFunction(
    (mid) =>
      window.__catanDebug?.state().turn.number >= mid ||
      window.__catanDebug?.state().phase.kind === 'gameOver',
    g.mid,
    { timeout: 300_000, polling: 200 },
  );
  for (const theme of THEMES) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
      localStorage.setItem('catan.theme', t);
    }, theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${tag}-2-mid-${theme}.png` });
  }
  const s = await state(page);
  console.log(`${tag}: turn ${s.turn.number}, phase ${s.phase.kind}`);
  await page.close();
}
await browser.close();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
