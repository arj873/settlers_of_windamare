// Combination modes (C1) in vite preview: the setup screen with the combined modes, then an
// all-bot game per combo (start, mid-game in every theme, end).
// Usage: node scripts/shots-combos.mjs <baseUrl> <outDir>
import { chromium } from 'playwright';

const [base = 'http://localhost:4173', out = 'playtest/shots/combos'] = process.argv.slice(2);
const THEMES = ['sunfired', 'chartroom', 'parlour', 'wood', 'githubdark', 'materialdark'];
const GAMES = [
  { mode: 'seafarers+ck', scenario: 'seafarers/newShores' },
  { mode: 'tb+ck', scenario: 'tb/traders' },
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

// The setup screen: both combined modes, then their scenario tiles.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page, 'setup');
  await page.goto(`${base}/?theme=sunfired`);
  // The landing screen first: "Play offline" opens the setup screen.
  await page.getByText('Play offline').click();
  await page.waitForSelector('[data-k="mode-seafarers+ck"]', { timeout: 30_000 });
  await page.screenshot({ path: `${out}/setup-1-modes.png` });
  for (const g of GAMES) {
    await page.click(`[data-k="mode-${g.mode}"]`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/setup-2-${g.mode.replace('+', '_')}.png` });
  }
  await page.close();
}

for (const g of GAMES) {
  const tag = g.mode.replace('+', '_');
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page, tag);
  await page.goto(
    `${base}/?mode=${encodeURIComponent(g.mode)}&scenario=${g.scenario}&autoplay=4bots&speed=1&seed=7&debug=1&theme=sunfired`,
  );
  await page.waitForFunction(() => window.__catanDebug?.state().turn.number >= 1, null, {
    timeout: 60_000,
    polling: 200,
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${tag}-1-start.png` });
  await page.waitForFunction(
    () =>
      window.__catanDebug?.state().turn.number >= 60 ||
      window.__catanDebug?.state().phase.kind === 'gameOver',
    null,
    { timeout: 240_000, polling: 200 },
  );
  // Mid-game in every theme (the theme switch keeps the game).
  for (const theme of THEMES) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
      localStorage.setItem('catan.theme', t);
    }, theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${tag}-2-mid-${theme}.png` });
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = 'sunfired'));
  await page.waitForFunction(() => window.__catanDebug?.state().phase.kind === 'gameOver', null, {
    timeout: 600_000,
    polling: 500,
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${tag}-3-end.png` });
  const s = await state(page);
  console.log(`${tag}: game over at turn ${s.turn.number}, winner ${s.winner}`);
  await page.close();
}
await browser.close();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
