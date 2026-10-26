// Seafarers UI screenshots in every theme: the setup screen with the mode chosen, and a human
// setup turn with the Ship card (ship spots highlighted), played through real clicks.
// Usage: node scripts/shots-seafarers-ui.mjs <baseUrl> <outDir> [theme,...]
import { chromium } from 'playwright';

const [base = 'http://localhost:4173', out = 'playtest/shots/seafarers', themesArg] =
  process.argv.slice(2);
const THEMES = themesArg
  ? themesArg.split(',')
  : ['sunfired', 'chartroom', 'parlour', 'wood', 'githubdark', 'materialdark'];

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const click = async (page, id) => {
  const p = await page.evaluate((x) => window.__catanDebug.screenPos(x), id);
  if (!p) throw new Error(`no screen position for ${id}`);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(150);
};
const targets = (page) => page.evaluate(() => window.__catanDebug.boardTargets());

for (const theme of THEMES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(`${theme}: ${String(e)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${theme}: ${m.text()}`));

  // The setup screen.
  await page.goto(`${base}/?theme=${theme}`);
  await page.waitForTimeout(800);
  await page.click('[data-k="offline"]');
  await page.waitForTimeout(400);
  const newGame = page.getByRole('button', { name: /new game/i });
  if (await newGame.count()) await newGame.first().click();
  await page.waitForSelector('[data-k="mode-seafarers"]', { timeout: 10_000 });
  await page.click('[data-k="mode-seafarers"]');
  await page.click('[data-k="scenario-seafarers/fogIslands"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/ui-${theme}-setup.png` });

  // A human setup turn: settlement, then the Ship card.
  await page.goto(
    `${base}/?mode=seafarers&scenario=seafarers/newShores&seats=hhhh&seed=5&first=0&debug=1&theme=${theme}`,
  );
  await page.waitForFunction(() => window.__catanDebug?.state()?.phase.kind === 'setup');
  await page.waitForTimeout(400);
  // Cover "Pass to ..." if shown.
  const cover = page.locator('.cover button, .pass-cover button');
  if (await cover.count()) await cover.first().click();
  const coast = (await targets(page)).find((a) => a.type === 'placeSetupSettlement');
  // Prefer a settlement on the south tip of the main island (a coast with open sea).
  const tip = (await targets(page)).find((a) => a.vertex === 'v:2,4,N') ?? coast;
  await click(page, tip.vertex);
  await page.getByRole('button', { name: /^Ship/ }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/ui-${theme}-setup-ship.png` });
  const ship = (await targets(page)).find((a) => a.type === 'seafarers/placeSetupShip');
  if (!ship) errors.push(`${theme}: no ship spot in Ship mode`);
  else await click(page, ship.edge);
  const after = await page.evaluate(
    () => Object.keys(window.__catanDebug.state().ext.seafarers.ships).length,
  );
  if (after !== 1) errors.push(`${theme}: setup ship not placed (${after})`);
  await page.screenshot({ path: `${out}/ui-${theme}-setup-shipped.png` });
  await page.close();
}
await browser.close();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
