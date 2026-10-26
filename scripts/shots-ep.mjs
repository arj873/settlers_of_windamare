// Explorers & Pirates screenshots: an all-bot game per scenario in vite preview (start, mid-game,
// end, the Game Statistics screen).
// Usage: node scripts/shots-ep.mjs <baseUrl> <outDir> [scenario,...] [theme,...] [players]
import { chromium } from 'playwright';

const [base = 'http://localhost:4173', out = 'playtest/shots/ep', only, themesArg, nArg] =
  process.argv.slice(2);
const ALL = ['landHo', 'pirateLairs', 'fish', 'spices', 'full'];
const scenarios = only ? only.split(',') : ALL;
const themes = themesArg ? themesArg.split(',') : ['sunfired'];
const players = Number(nArg ?? 4);

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
for (const theme of themes) {
  for (const sc of scenarios) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    page.on('pageerror', (e) => errors.push(`${sc}: ${String(e)}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${sc}: ${m.text()}`));
    const name = `${out}/${theme}-${sc}-${players}`;
    await page.goto(
      `${base}/?mode=ep&scenario=ep/${sc}&autoplay=${players}bots&speed=1&seed=7&debug=1&theme=${theme}`,
    );
    const when = (fn, timeout) => page.waitForFunction(fn, null, { timeout, polling: 200 });
    await when(() => window.__catanDebug?.state().turn.number >= 1, 60_000);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${name}-1-start.png` });
    await when(
      () =>
        window.__catanDebug?.state().turn.number >= 60 ||
        window.__catanDebug?.state().phase.kind === 'gameOver',
      180_000,
    );
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${name}-2-mid.png` });
    await when(() => window.__catanDebug?.state().phase.kind === 'gameOver', 600_000);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${name}-3-end.png` });
    await page.getByRole('button', { name: 'Game stats' }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${name}-4-stats.png` });
    await page.close();
  }
}
await browser.close();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
