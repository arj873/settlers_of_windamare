// "Learn to play" screenshots: the first-visit hint, the setup screen's entry button, and the
// coach panel through setup, the first roll, building and the learner's own 7 (desktop + phone).
// The learner's moves go through the controller (the bot picks a sensible spot); bots play on.
// Needs the Vite dev server. Usage: node scripts/shots-tutorial.mjs <devUrl> <outDir> [width,...]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://localhost:5173', out = 'playtest/shots/tutorial', widthsArg] =
  process.argv.slice(2);
const WIDTHS = widthsArg ? widthsArg.split(',').map(Number) : [1440, 390];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];

/** In the page: wait until `fn(state, coach run)` holds (polls). */
async function until(page, fn, what, ms = 60000) {
  try {
    await page.waitForFunction(fn, null, { timeout: ms, polling: 100 });
  } catch {
    throw new Error(`timed out waiting for ${what}`);
  }
}

/** The learner (seat 0) makes the Normal bot's move for the current step. */
async function learnerMove(page) {
  await page.evaluate(async () => {
    const { botForLevel } = await import('/src/bots/byLevel.ts');
    const { Rng } = await import('/src/engine/index.ts');
    const c = window.catan.controller;
    const legal = c.legalActions.filter((a) => a.player === 0);
    const a = botForLevel('normal')(c.state, 0, new Rng(7), legal);
    if (a) c.dispatch(a);
  });
}

const run = (page) => page.evaluate(() => window.catan.tutorial.record?.run ?? null);

for (const width of WIDTHS) {
  const height = width < 600 ? 844 : 900;
  const tag = width < 600 ? 'phone' : 'desktop';
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 600 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${tag}: ${String(e)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${tag}: ${m.text()}`));
  const shot = async (name) => {
    await page.waitForTimeout(450);
    const path = `${out}/${tag}-${name}.png`;
    await page.screenshot({ path });
    console.log(path);
  };

  // 1. First visit: the home screen offers the tutorial once.
  await page.goto(`${base}/?mute=1`);
  await page.waitForSelector('.tut-hint');
  await shot('01-first-visit-hint');
  await page.click('[data-k="tut-hint-close"]');

  // 2. Play offline -> setup screen with the "Learn to play" button.
  await page.getByText('Play offline', { exact: true }).click();
  await page.waitForSelector('.su-learn');
  await shot('02-setup-entry-button');

  // 3. Learn to play -> the picker (s19) -> base: goal, board, first settlement (board highlights
  // the legal corners).
  await page.click('.su-learn');
  await page.click('[data-k="tut-pick-base"]');
  await page.waitForSelector('.tut-panel:not([hidden]) .tut-title');
  await shot('03-goal');
  await page.click('[data-k="tut-next"]');
  await shot('04-board');
  await page.click('[data-k="tut-next"]');
  await until(page, () => window.catan.tutorial.record.run?.current === 'place1', 'place1');
  await shot('05-setup-settlement');
  await learnerMove(page);
  await until(page, () => window.catan.tutorial.record.run?.current === 'road1', 'road1');
  await shot('06-setup-road');
  await learnerMove(page);
  // Bots place (tutorial pace), then the snake comes back to the learner.
  await page.evaluate(() => window.catan.controller.setSpeed(60));
  await until(page, () => window.catan.tutorial.record.run?.current === 'place2', 'place2');
  await learnerMove(page);
  await until(page, () => window.catan.tutorial.record.run?.current === 'road2', 'road2');
  await shot('07-second-road-hand');
  await learnerMove(page);

  // 4. First turn: roll, production ("You rolled 8"), building.
  await until(page, () => window.catan.tutorial.record.run?.current === 'roll', 'roll');
  await shot('08-roll');
  await page.click('.btn-roll');
  await until(page, () => window.catan.tutorial.record.run?.current === 'production', 'production');
  await page.waitForTimeout(1200); // the production cards land
  await shot('09-production');
  await page.click('[data-k="tut-next"]');
  await shot('10-build');
  await page.click('[data-k="tut-next"]');
  await shot('11-end-turn');
  await page.click('.btn-end');

  // 5. The learner's second turn: their own 7 -> robber lesson with the hexes highlighted.
  // An Easy bot may offer the learner a trade on the way (the trading lesson): decline it.
  let offers = 0;
  for (;;) {
    await until(
      page,
      () => {
        const s = window.catan.controller.state;
        const offer = s.phase.kind === 'trade' && s.phase.offer.responses[0] === 'pending';
        return offer || (s.turn.current === 0 && s.phase.kind === 'preRoll');
      },
      'second turn',
    );
    const offered = await page.evaluate(() => window.catan.controller.state.phase.kind === 'trade');
    if (!offered) break;
    if (offers++ === 0) await shot('11b-trade-offer');
    await page.evaluate(() => window.catan.controller.dispatch({ type: 'rejectTrade', player: 0 }));
  }
  await page.click('.btn-roll');
  await until(page, () => window.catan.tutorial.record.run?.current === 'seven', 'seven');
  await shot('12-seven-robber');

  // 6. Collapsed panel, Back.
  await page.click('[data-k="tut-min"]');
  await shot('13-collapsed');
  await page.click('[data-k="tut-expand"]');
  await page.click('[data-k="tut-back"]');
  await shot('14-back');
  console.log(tag, JSON.stringify((await run(page))?.shown));
  await ctx.close();
}

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
