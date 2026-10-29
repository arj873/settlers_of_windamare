// Spot prompt screenshots (issue #28): hover and click a board spot with no build mode on, in the
// base game (settlement), Seafarers (coast edge: road or ship) and C&K (settlement or knight).
// Needs the Vite dev server (it imports src modules in the page to set up a rich main-phase turn).
// Usage: node scripts/shots-spot-prompt.mjs <devUrl> <outDir> [theme,...] [width,...]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://localhost:5173', out = 'playtest/shots/spot', themesArg, widthsArg] =
  process.argv.slice(2);
const THEMES = themesArg ? themesArg.split(',') : ['sunfired', 'githubdark'];
const WIDTHS = widthsArg ? widthsArg.split(',').map(Number) : [1440, 390];
const CASES = [
  { name: 'base', mode: 'base', scenario: null, types: ['buildSettlement'] },
  {
    name: 'seafarers',
    mode: 'seafarers',
    scenario: 'seafarers/newShores',
    types: ['buildRoad', 'seafarers/buildShip'],
  },
  { name: 'ck', mode: 'ck', scenario: null, types: ['buildSettlement', 'ck/buildKnight'] },
];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];

/** In the page: bot-play `mode` until the (rich) current player has a spot taking all `types`. */
async function setUp(page, c) {
  return page.evaluate(async ({ mode, scenario, types }) => {
    const { createRandomBot } = await import('/src/bots/index.ts');
    const { newGame, randomSource, runGame } = await import('/src/bots/runner.ts');
    const { ensureModules, legalActions } = await import('/src/engine/index.ts');
    const { spotBuildActions, locationOf } = await import('/src/game/logic.ts');
    // s18: expansion rules load on demand (the app set the loader at boot).
    await ensureModules(mode);
    const RICH = { brick: 9, lumber: 9, wool: 9, grain: 9, ore: 9 };
    let found = null;
    let spot = null;
    const bot = randomSource(createRandomBot({ progressBias: 0.5 }), 'spot-tests');
    runGame({
      initial: newGame({ seed: 1, players: 3, mode, ...(scenario ? { scenario } : {}) }),
      maxSteps: 4000,
      source: (ctx) => (found ? null : bot(ctx)),
      onStep: ({ state }) => {
        if (found || state.phase.kind !== 'main') return;
        const p = state.turn.current;
        const s = {
          ...state,
          players: state.players.map((x) => (x.id === p ? { ...x, resources: RICH } : x)),
        };
        const by = new Map();
        for (const a of spotBuildActions(legalActions(s), p)) {
          const at = locationOf(a);
          by.set(at.id, [...(by.get(at.id) ?? []), a.type]);
        }
        const hit = [...by].find(([, t]) => types.every((x) => t.includes(x)));
        if (hit) {
          found = s;
          spot = hit[0];
        }
      },
    });
    if (!found) return null;
    window.catan.controller.start(
      found,
      found.players.map(() => 'human'),
      { viewer: found.turn.current },
    );
    return spot;
  }, c);
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    const height = width < 600 ? 844 : 900;
    for (const c of CASES) {
      const tag = `${c.name}-${theme}-${width}`;
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 600 });
      page.on('pageerror', (e) => errors.push(`${tag}: ${String(e)}`));
      page.on('console', (m) => m.type() === 'error' && errors.push(`${tag}: ${m.text()}`));
      await page.goto(`${base}/?fixture=midGame&debug=1&theme=${theme}`);
      await page.waitForFunction(() => window.__catanDebug?.state() && window.catan?.controller);
      const spot = await setUp(page, c);
      if (!spot) {
        errors.push(`${tag}: no state with ${c.types.join(' + ')}`);
        await page.close();
        continue;
      }
      await page.waitForTimeout(500);
      const cover = page.locator('.cover button, .pass-cover button');
      if (await cover.count()) await cover.first().click();
      await page.waitForTimeout(300);
      const p = await page.evaluate((id) => window.__catanDebug.screenPos(id), spot);
      if (width >= 600) {
        await page.mouse.move(p.x, p.y);
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${out}/${tag}-hover.png` });
        await page.mouse.click(p.x, p.y);
      } else {
        await page.touchscreen.tap(p.x, p.y);
      }
      await page.waitForTimeout(350);
      const shown = await page.locator('.spot-prompt').count();
      if (shown !== 1) errors.push(`${tag}: prompt not shown`);
      await page.screenshot({ path: `${out}/${tag}-prompt.png` });
      // Build the first choice: the piece appears and the prompt closes.
      const before = await page.evaluate(() => JSON.stringify(window.__catanDebug.state().pieces));
      await page.locator('.spot-prompt [data-k="spot-build"]').first().click();
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => JSON.stringify(window.__catanDebug.state().pieces));
      const ext = await page.evaluate(() => JSON.stringify(window.__catanDebug.state().ext));
      if (before === after && c.name === 'base') errors.push(`${tag}: nothing built`);
      if (await page.locator('.spot-prompt').count()) errors.push(`${tag}: prompt still open`);
      void ext;
      await page.close();
    }
  }
}
await browser.close();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
