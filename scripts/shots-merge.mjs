// Merge check screenshots: the setup screen's mode list, then one autoplay each of Seafarers and
// Cities & Knights (mid-game and the end). Usage: node scripts/shots-merge.mjs <baseUrl> <outDir>
import { chromium } from 'playwright';

const [base = 'http://localhost:4173', out = 'playtest/shots/merge'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(`${base}/`);
await page.click('[data-k="offline"]');
await page.waitForSelector('[data-k="mode-seafarers"]', { timeout: 10_000 });
const modes = await page.evaluate(() =>
  [...document.querySelectorAll('[data-k^="mode-"]')].map((e) => e.getAttribute('data-k')),
);
for (const m of ['base', 'oil', 'crop', 'ck', 'seafarers']) {
  if (!modes.includes(`mode-${m}`)) errors.push(`setup screen: no mode ${m} (${modes.join(' ')})`);
}
await page.screenshot({ path: `${out}/setup-modes.png` });

for (const [mode, scenario] of [
  ['seafarers', 'seafarers/newShores'],
  ['ck', 'ck/classic'],
]) {
  await page.goto(
    `${base}/?mode=${mode}&scenario=${scenario}&autoplay=4bots&speed=1&seed=9&debug=1`,
  );
  await page.waitForFunction(
    () =>
      window.__catanDebug?.state()?.turn.number >= 30 ||
      window.__catanDebug?.state()?.phase.kind === 'gameOver',
    null,
    { timeout: 180_000, polling: 300 },
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${mode}-mid.png` });
  await page.waitForFunction(() => window.__catanDebug?.state()?.phase.kind === 'gameOver', null, {
    timeout: 600_000,
    polling: 500,
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${mode}-end.png` });
  const s = await page.evaluate(() => ({
    mode: window.__catanDebug.state().settings.mode,
    winner: window.__catanDebug.state().winner,
  }));
  if (s.mode !== mode || s.winner === null) errors.push(`${mode}: ${JSON.stringify(s)}`);
}
await browser.close();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
