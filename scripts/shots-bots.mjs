// B1 smart-bot screenshots: the setup screen's per-seat difficulty pickers (desktop + phone),
// the online lobby's picker (in-browser dev server), and mid-game boards of Hard / Normal bots in
// the base game, Cities & Knights and Seafarers.
// Usage: node scripts/shots-bots.mjs <baseUrl> <outDir> [theme,...]   (baseUrl: `pnpm dev`)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://localhost:5173', out = 'playtest/shots/bots', themesArg] =
  process.argv.slice(2);
const THEMES = themesArg ? themesArg.split(',') : ['sunfired', 'githubdark'];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const watch = (page, theme) => {
  page.on('pageerror', (e) => errors.push(`${theme}: ${String(e)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${theme}: ${m.text()}`));
};

async function setupScreen(page, theme) {
  await page.goto(`${base}/?theme=${theme}`);
  await page.waitForTimeout(800);
  await page.click('[data-k="offline"]');
  await page.waitForTimeout(400);
  const newGame = page.getByRole('button', { name: /new game/i });
  if (await newGame.count()) await newGame.first().click();
  await page.waitForSelector('[data-k="level-1"]', { timeout: 10_000 });
  await page.selectOption('[data-k="level-2"]', 'hard');
  await page.selectOption('[data-k="level-3"]', 'easy');
  await page.locator('.su-seats').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
}

/** An all-bot game watched until `turns`: Hard / Normal seats per `levels`. */
async function midGame(page, theme, query, turns, name) {
  await page.goto(`${base}/?${query}&autoplay=4bots&speed=25&debug=1&theme=${theme}`);
  await page.waitForFunction(
    (t) => {
      const s = window.__catanDebug?.state();
      return s && (s.turn.number >= t || s.phase.kind === 'gameOver');
    },
    turns,
    { timeout: 120_000 },
  );
  await page.screenshot({ path: `${out}/${name}-${theme}.png` });
}

for (const theme of THEMES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page, theme);

  await setupScreen(page, theme);
  await page.locator('.su-seats').screenshot({ path: `${out}/setup-seats-${theme}.png` });
  await page.screenshot({ path: `${out}/setup-${theme}.png` });

  await midGame(page, theme, 'seed=b1&levels=hnhn', 28, 'base-midgame');
  await midGame(page, theme, 'mode=ck&seed=b1&levels=hnhn', 36, 'ck-midgame');
  await midGame(
    page,
    theme,
    'mode=seafarers&scenario=seafarers/fourIslands&seed=b1&levels=hnhn',
    32,
    'seafarers-midgame',
  );

  // Online lobby (dev server in the browser): the host's picker on every open seat.
  await page.goto(`${base}/?server=local&theme=${theme}`);
  await page.waitForTimeout(800);
  await page.fill('[data-k="nickname"]', 'Ann');
  await page.click('[data-k="create"]');
  await page.waitForSelector('[data-k="seat-level-1"]', { timeout: 15_000 });
  await page.selectOption('[data-k="seat-level-3"]', 'hard');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/lobby-${theme}.png` });
  await page.close();

  // Phone width: the seat rows wrap.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  watch(phone, `${theme} phone`);
  await setupScreen(phone, theme);
  await phone.locator('.su-seats').screenshot({ path: `${out}/setup-seats-phone-${theme}.png` });
  await phone.close();
}

await browser.close();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`shots in ${out}`);
