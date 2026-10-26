// Seafarers screenshots: an all-bot game per scenario in vite preview (start, mid-game, end).
// Usage: node scripts/shots-seafarers.mjs <baseUrl> <outDir> [scenario,...] [theme,...]
import { chromium } from 'playwright';

const [base = 'http://localhost:4173', out = 'playtest/shots/seafarers', only, themesArg] =
  process.argv.slice(2);
const ALL = [
  'newShores',
  'fourIslands',
  'fogIslands',
  'throughTheDesert',
  'forgottenTribe',
  'clothForCatan',
  'pirateIslands',
  'wondersOfCatan',
  'newWorld',
];
const scenarios = only ? only.split(',') : ALL;
const themes = themesArg ? themesArg.split(',') : ['sunfired'];

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
    const players = sc === 'pirateIslands' ? 4 : 4;
    await page.goto(
      `${base}/?mode=seafarers&scenario=seafarers/${sc}&autoplay=${players}bots&speed=1&seed=7&debug=1&theme=${theme}`,
    );
    await page.waitForFunction(() => window.__catanDebug?.state().turn.number >= 1, null, {
      timeout: 60_000,
      polling: 200,
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${theme}-${sc}-1-start.png` });
    await page.waitForFunction(
      () =>
        window.__catanDebug?.state().turn.number >= 40 ||
        window.__catanDebug?.state().phase.kind === 'gameOver',
      null,
      {
        timeout: 120_000,
        polling: 200,
      },
    );
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${theme}-${sc}-2-mid.png` });
    await page.waitForFunction(() => window.__catanDebug?.state().phase.kind === 'gameOver', null, {
      timeout: 300_000,
      polling: 500,
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${theme}-${sc}-3-end.png` });
    await page.close();
  }
}
await browser.close();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
