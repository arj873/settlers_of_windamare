// Expansion tutorial screenshots (s19, docs/TUTORIAL.md): the "Learn to play" picker (desktop,
// phone, every theme at phone width), the setup screen's "New to …? Learn it" link, and lesson
// moments of the Cities & Knights, Seafarers and Explorers & Pirates courses. The learner's moves
// are the Normal bot's (through the controller); bots play on at 60 ms a move.
// Needs the Vite dev server. Usage: node scripts/shots-tutorials.mjs <devUrl> <outDir>
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://localhost:5173', out = 'docs/design/tutorials'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const THEMES = ['sunfired', 'wood', 'parlour', 'chartroom', 'materialdark', 'githubdark'];

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];

async function newPage(width, tag, query = '') {
  const height = width < 600 ? 915 : 900;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 600 });
  // No first-visit hint over the home screen.
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('catan:tutorial:v1')) {
      localStorage.setItem(
        'catan:tutorial:v1',
        JSON.stringify({ completed: false, offered: true, run: null }),
      );
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${tag}: ${String(e)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${tag}: ${m.text()}`));
  await page.goto(`${base}/?mute=1${query}`);
  return { ctx, page };
}

const shot = async (page, name) => {
  // In a game: bots hold still and the toasts clear first.
  const inGame = await page.evaluate(() => Boolean(window.catan?.controller?.state));
  if (inGame) {
    await page.evaluate(() => window.catan.controller.setSpeed(1e7));
    await page
      .waitForFunction(() => !document.querySelector('.game-toast'), null, { timeout: 6000 })
      .catch(() => undefined);
  }
  await page.waitForTimeout(450);
  const path = `${out}/${name}.png`;
  await page.screenshot({ path });
  console.log(path);
  if (inGame) await page.evaluate(() => window.catan.controller.setSpeed(60));
};

async function openSetup(page) {
  await page.getByText('Play offline', { exact: true }).click();
  await page.waitForSelector('.su-learn');
}

/** The learner (seat 0) makes the Normal bot's move. */
async function learnerMove(page) {
  await page.evaluate(async () => {
    const { botForLevel } = await import('/src/bots/byLevel.ts');
    const { Rng } = await import('/src/engine/index.ts');
    const c = window.catan.controller;
    const legal = c.legalActions.filter((a) => a.player === 0);
    const a = botForLevel('normal')(c.state, 0, new Rng(c.state.turn.number + 7), legal);
    if (a) c.dispatch(a);
  });
}

const current = (page) => page.evaluate(() => window.catan.tutorial.record?.run?.current ?? null);

/**
 * E&P: on turn 1 the learner does what the coach says (start moving, sail to the fog, land the
 * settler on what turned up); otherwise the Normal bot's move.
 */
async function epLearnerMove(page) {
  await page.evaluate(async () => {
    const { botForLevel } = await import('/src/bots/byLevel.ts');
    const { Rng } = await import('/src/engine/index.ts');
    const { graph, touchesFog } = await import('/src/expansions/ep/engine/geometry.ts');
    const { epBoard } = await import('/src/expansions/ep/engine/maps.ts');
    const c = window.catan.controller;
    const s = c.state;
    const legal = c.legalActions.filter((a) => a.player === 0);
    const region = epBoard(s).region;
    const newLand = (v) => (graph(s).hexesAt.get(v) ?? []).some((h) => region[h] !== undefined);
    const coached =
      s.turn.number === 1 &&
      (legal.find((a) => a.type === 'ep/land' && newLand(a.vertex)) ??
        legal.find((a) => a.type === 'ep/startMovement') ??
        legal.find((a) => a.type === 'ep/moveShip' && touchesFog(s, a.edge)));
    const a = coached || botForLevel('normal')(s, 0, new Rng(s.turn.number + 7), legal);
    if (a) c.dispatch(a);
  });
}

/**
 * Play on until the panel shows `id`: Next on every other lesson, the learner's moves when they
 * have one, bots on their timers.
 */
async function playTo(page, id, ms = 240_000, move = learnerMove) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const now = await current(page);
    if (now === id) return;
    if (now !== null && (await page.$('[data-k="tut-next"]:not([disabled])'))) {
      await page.click('[data-k="tut-next"]');
      continue;
    }
    const mine = await page.evaluate(
      () => window.catan.controller.legalActions.filter((a) => a.player === 0).length,
    );
    if (mine > 0) await move(page);
    else await page.waitForTimeout(80);
  }
  throw new Error(`timed out waiting for lesson ${id}`);
}

const fast = (page) => page.evaluate(() => window.catan.controller.setSpeed(60));

// 1. The picker: desktop (base done: a tick), phone (fresh: the "start with base" hint), and
// every theme at phone width.
{
  const { ctx, page } = await newPage(1440, 'picker');
  await page.evaluate(() =>
    localStorage.setItem(
      'catan:tutorial:v1',
      JSON.stringify({ completed: true, offered: true, run: null }),
    ),
  );
  await openSetup(page);
  await page.click('.su-learn');
  await page.waitForSelector('.tut-pick');
  await shot(page, 'picker-desktop');
  await page.click('[data-k="tut-pick-cancel"]');
  await page.click('.setup [data-k="chip-ck"]');
  await page.waitForSelector('[data-k="learn-ck"]');
  await page.$eval('[data-k="learn-ck"]', (el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, 'setup-learn-link-desktop');
  await ctx.close();
}
for (const theme of THEMES) {
  const { ctx, page } = await newPage(412, `picker-${theme}`, `&theme=${theme}`);
  await openSetup(page);
  if (theme === 'sunfired') {
    await page.click('.setup [data-k="chip-seafarers"]');
    await page.waitForSelector('[data-k="learn-seafarers"]');
    await page.$eval('[data-k="learn-seafarers"]', (el) => el.scrollIntoView({ block: 'center' }));
    await shot(page, 'setup-learn-link-phone');
  }
  await page.click('.su-learn');
  await page.waitForSelector('.tut-pick');
  await shot(page, theme === 'sunfired' ? 'picker-phone' : `picker-phone-${theme}`);
  await ctx.close();
}

// 2. Cities & Knights: intro (base link), the first roll's event die, improvements (tracks),
// the barbarians' attack (turn 15).
for (const width of [1440, 412]) {
  const tag = width < 600 ? 'phone' : 'desktop';
  const { ctx, page } = await newPage(width, `ck-${tag}`);
  await openSetup(page);
  await page.click('.setup [data-k="chip-ck"]');
  await page.click('.setup [data-k="learn-ck"]');
  await page.waitForSelector('.tut-panel:not([hidden]) .tut-title');
  await fast(page);
  await shot(page, `ck-${tag}-1-intro`);
  if (width < 600) {
    await playTo(page, 'attack', 600_000);
    await shot(page, `ck-${tag}-4-attack`);
  } else {
    await playTo(page, 'dice');
    await fast(page);
    await shot(page, `ck-${tag}-2-dice`);
    await playTo(page, 'improve');
    await shot(page, `ck-${tag}-3-improve`);
    await playTo(page, 'warning', 600_000);
    await shot(page, `ck-${tag}-4-warning`);
    await playTo(page, 'attack', 600_000);
    await shot(page, `ck-${tag}-5-attack`);
  }
  console.log(
    tag,
    JSON.stringify((await page.evaluate(() => window.catan.tutorial.record.run))?.shown),
  );
  await ctx.close();
}

// 3. Seafarers: intro, ships on the first turn, the learner's own 7 (robber or pirate).
for (const width of [1440, 412]) {
  const tag = width < 600 ? 'phone' : 'desktop';
  const { ctx, page } = await newPage(width, `sea-${tag}`);
  await openSetup(page);
  await page.click('.setup [data-k="chip-seafarers"]');
  await page.click('.setup [data-k="learn-seafarers"]');
  await page.waitForSelector('.tut-panel:not([hidden]) .tut-title');
  await fast(page);
  await shot(page, `sea-${tag}-1-intro`);
  await playTo(page, 'ships');
  await fast(page);
  await shot(page, `sea-${tag}-2-ships`);
  await playTo(page, 'pirate');
  await shot(page, `sea-${tag}-3-pirate`);
  console.log(
    tag,
    JSON.stringify((await page.evaluate(() => window.catan.tutorial.record.run))?.shown),
  );
  await ctx.close();
}

// 4. Explorers & Pirates (Land Ho!): intro, landing the settler on the land the learner just
// discovered (turn 1), the later scenarios (their picture) while the bots play.
for (const width of [1440, 412]) {
  const tag = width < 600 ? 'phone' : 'desktop';
  const { ctx, page } = await newPage(width, `ep-${tag}`);
  await openSetup(page);
  await page.click('.setup [data-k="chip-ep"]');
  await page.click('.setup [data-k="learn-ep"]');
  await page.waitForSelector('.tut-panel:not([hidden]) .tut-title');
  await fast(page);
  if (width >= 600) await shot(page, `ep-${tag}-1-intro`);
  await playTo(page, 'land', 240_000, epLearnerMove);
  await shot(page, `ep-${tag}-2-land`);
  await playTo(page, 'next', 240_000, epLearnerMove);
  await shot(page, `ep-${tag}-3-next`);
  console.log(
    tag,
    JSON.stringify((await page.evaluate(() => window.catan.tutorial.record.run))?.shown),
  );
  await ctx.close();
}

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
