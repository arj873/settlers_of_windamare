// Screenshots for issues #32–#36 (steal reveal, build marks, auto-rob, cost tooltips, award
// banner) in two themes. Usage: node scripts/shots-issues.mjs <baseUrl> <outDir>
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://localhost:5173', out = 'playtest/shots/issues-32-36'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const THEMES = ['sunfired', 'chartroom'];

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];

async function open(theme, fixture) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/?fixture=${fixture}&debug=1&theme=${theme}`);
  await page.waitForFunction(() => window.__catanDebug?.state());
  await page.waitForTimeout(400);
  return page;
}

const clickId = async (page, id) => {
  const p = await page.evaluate((i) => window.__catanDebug.screenPos(i), id);
  if (!p) throw new Error(`no screen position for ${id}`);
  await page.mouse.click(p.x, p.y);
};
const slot = (page, label) =>
  page
    .locator('.build-bar .bslot')
    .filter({ has: page.locator(`.bcard-label:text-is("${label}")`) });

for (const theme of THEMES) {
  // #35: cost tooltips (a blocked card and an enabled one).
  let page = await open(theme, 'midGame');
  await slot(page, 'Road').hover();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/35-${theme}-road-missing.png` });
  await slot(page, 'City').hover();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/35-${theme}-city-ok.png` });

  // #33: build a city, shoot while the marks fade.
  await page.locator('.bcard', { hasText: 'City' }).first().click();
  const [target] = await page.evaluate(() => window.__catanDebug.boardTargets());
  await page.mouse.move(5, 450);
  await clickId(page, target.vertex);
  await page.waitForTimeout(380);
  await page.screenshot({ path: `${out}/33-${theme}-city-mark.png` });
  await page.close();

  // #34 + #32: the knight's robber on a hex with one victim: robbed at once, card named.
  const hexes = await (async () => {
    const p = await open(theme, 'moveRobberGame');
    const h = await p.evaluate(() => window.__catanDebug.boardTargets().map((a) => a.hex));
    await p.close();
    return h;
  })();
  let shotSingle = false;
  let shotMulti = false;
  for (const hex of hexes) {
    if (shotSingle && shotMulti) break;
    page = await open(theme, 'moveRobberGame');
    await clickId(page, hex);
    await page.waitForTimeout(450);
    const phase = await page.evaluate(() => window.__catanDebug.state().phase.kind);
    const stole = await page.evaluate(() =>
      Boolean(window.__catanDebug.state().log.at(-1)?.secret),
    );
    if (phase === 'steal' && !shotMulti) {
      shotMulti = true;
      await page.screenshot({ path: `${out}/34-${theme}-choice-dialog.png` });
    } else if (phase !== 'steal' && stole && !shotSingle) {
      shotSingle = true;
      await page.screenshot({ path: `${out}/32-34-${theme}-auto-steal.png` });
      await page.locator('.log-list').screenshot({ path: `${out}/32-${theme}-log.png` });
    }
    await page.close();
  }
  if (!shotSingle) errors.push(`${theme}: no single-victim hex found`);

  // #36: Longest Road changes hands when Blue builds a road (nobody held it yet).
  page = await open(theme, 'midGame');
  await page.evaluate(() => {
    const { controller } = window.catan;
    const s = JSON.parse(JSON.stringify(controller.state));
    s.awards.longestRoad = null;
    s.players[1].resources = { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 };
    controller.start(s, ['human', 'human', 'human', 'human']);
  });
  await page.waitForTimeout(300);
  await page.locator('.bcard', { hasText: 'Road' }).first().click();
  const [road] = await page.evaluate(() => window.__catanDebug.boardTargets());
  await page.mouse.move(5, 450);
  await clickId(page, road.edge);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/36-33-${theme}-award-banner.png` });
  await page.close();
}

await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
