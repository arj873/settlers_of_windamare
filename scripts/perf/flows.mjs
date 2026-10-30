// Production-build smoke test of the flows that load expansion modules on demand (s18), with the
// page's Content-Security-Policy watched: base hotseat, C&K and Seafarers hotseat games picked on
// the setup screen, resume of the Seafarers save after a reload, an online Seafarers room on the
// in-browser server (host + a guest joining by the invite link), the tutorials (base from the
// picker, C&K from its chip link and resumed after a reload, Seafarers from the in-game menu,
// Traders & Barbarians and Oil Springs from their chip links, Crop Trust from the setup screen's
// picker), and a short bot game of every mode (`?mode=`).
//
//   pnpm build && pnpm preview --port 4173 &
//   node scripts/perf/flows.mjs [--base http://localhost:4173]
//     [--only base,ck,sea,online,tutorial,tutorial-ck,tutorial-sea,tutorial-tb,tutorial-oil,
//             tutorial-crop,modes]
//
// Exits non-zero when a flow fails, the page throws or logs an error, or a CSP violation fires.
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = flag('--base', 'http://localhost:4173').replace(/\/$/, '');
const ONLY = flag(
  '--only',
  'base,ck,sea,online,tutorial,tutorial-ck,tutorial-sea,tutorial-tb,tutorial-oil,tutorial-crop,modes',
).split(',');

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const problems = [];

/** A fresh profile; every page in it reports CSP violations, page errors and console errors. */
async function profile(name) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  const open = async (url) => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${name}: page error: ${e.message}`));
    page.on('console', (m) => {
      const t = m.text();
      if (m.type() === 'error' || /Content.Security.Policy/i.test(t)) {
        problems.push(`${name}: console ${m.type()}: ${t}`);
      }
    });
    await page.goto(url);
    return page;
  };
  return { ctx, open };
}

const ok = (what) => console.log(`ok  ${what}`);
function check(cond, what) {
  if (!cond) throw new Error(`FAILED: ${what}`);
  ok(what);
}

const hotseatMode = (page) => page.evaluate(() => window.catan?.controller?.state?.settings.mode);

/** Play the local seats' moves for a while (bots play theirs on their own timers). */
async function playHotseat(page, moves) {
  for (let i = 0; i < moves; i++) {
    await page.evaluate(() => {
      const c = window.catan?.controller;
      const legal = c?.legalActions ?? [];
      const pick = legal.find((a) => a.type !== 'offerTrade') ?? legal[0];
      if (pick) c.dispatch(pick);
    });
    await page.waitForTimeout(60);
  }
}

async function newHotseat(page, chip) {
  await page.click('[data-k="offline"]');
  await page.waitForSelector('.setup [data-k="start"]');
  if (chip) {
    await page.click(`.setup [data-k="chip-${chip}"]`);
    await page.waitForSelector('.setup [data-k="start"]:not([disabled])');
    check(!(await page.$('.setup .su-loading')), `${chip}: scenario previews drawn`);
  }
  await page.click('.setup [data-k="start"]');
  await page.waitForSelector('.hud-side .sec-players');
}

async function base() {
  const { ctx, open } = await profile('base');
  const page = await open(`${BASE}/`);
  await newHotseat(page, null);
  await playHotseat(page, 30);
  check((await hotseatMode(page)) === 'base', 'base hotseat game plays');
  const packs = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((r) => r.name)
      .filter((n) => /\/assets\/(ck|seafarers|tb|ep|oil|crop)-/.test(n)),
  );
  check(packs.length === 0, `base game fetched no expansion chunk (${packs.join(', ')})`);
  await ctx.close();
}

async function ck() {
  const { ctx, open } = await profile('ck');
  const page = await open(`${BASE}/`);
  await newHotseat(page, 'ck');
  await playHotseat(page, 40);
  check((await hotseatMode(page)) === 'ck', 'C&K hotseat game plays');
  check(await page.$('.sec-ext-ck'), 'C&K HUD panel shown');
  await ctx.close();
}

async function sea() {
  const { ctx, open } = await profile('sea');
  const page = await open(`${BASE}/`);
  await newHotseat(page, 'seafarers');
  await playHotseat(page, 40);
  check((await hotseatMode(page)) === 'seafarers', 'Seafarers hotseat game plays');
  const turn = await page.evaluate(() => window.catan.controller.state.turn.number);
  // Reload: "Play offline" offers to resume the autosave; its modules load before the game shows.
  await page.reload();
  await page.click('[data-k="offline"]');
  await page.waitForSelector('.game-resume .btn-primary');
  await page.click('.game-resume .btn-primary');
  await page.waitForSelector('.hud-side .sec-players');
  check((await hotseatMode(page)) === 'seafarers', 'resumed the Seafarers save after a reload');
  check(
    (await page.evaluate(() => window.catan.controller.state.turn.number)) === turn,
    'resumed at the saved turn',
  );
  await playHotseat(page, 20);
  await ctx.close();
}

const clientExpr = '(window.catan && window.catan.online && window.catan.online.roomClient)';

async function online() {
  // One profile: the tabs share the in-browser room server (a SharedWorker).
  const { ctx, open } = await profile('online');
  const ann = await open(`${BASE}/?server=local`);
  await ann.waitForSelector('[data-k="create"]');
  await ann.fill('[data-k="nickname"]', 'Ann');
  await ann.click('[data-k="create"]');
  await ann.waitForSelector('.ol-lobby');
  await ann.click('.ol-config [data-k="chip-seafarers"]');
  await ann.waitForSelector('.ol-config .su-map-art svg');
  check(!(await ann.$('.ol-config .su-loading')), 'host picked Seafarers in the lobby');
  const invite = await ann.inputValue('[data-k="invite"]');
  const bob = await open(invite);
  await bob.waitForSelector('[data-k="join"]');
  await bob.fill('[data-k="nickname"]', 'Bob');
  await bob.click('[data-k="join"]');
  await bob.waitForSelector('.ol-lobby');
  await bob.waitForSelector('.ol-config .su-map-art svg');
  check(true, 'guest joined the Seafarers room and sees its scenarios');
  await ann.waitForSelector('[data-k="lobby-start"]:not([disabled])');
  await ann.click('[data-k="lobby-start"]');
  for (const p of [ann, bob]) await p.waitForSelector('.hud-side .sec-chat');
  for (let i = 0; i < 40; i++) {
    for (const p of [ann, bob]) {
      await p.evaluate(
        `(() => { const c = ${clientExpr}; const l = c.game && c.game.legal; if (l && l.length) c.intent(l.find(a => a.type !== 'offerTrade') || l[0]); })()`,
      );
    }
    await ann.waitForTimeout(100);
  }
  const modes = await Promise.all(
    [ann, bob].map((p) => p.evaluate(`${clientExpr}.game.view.settings.mode`)),
  );
  check(
    modes.every((m) => m === 'seafarers'),
    'online Seafarers game plays in both tabs',
  );
  check(await bob.$('canvas'), 'guest board drawn');
  await ctx.close();
}

/** The coach's course and its first lesson title, once its panel shows. */
async function coachShows(page) {
  await page.waitForSelector('.hud-side .sec-players');
  // The head is always drawn; the title only while a lesson is up (not when idle).
  await page.waitForSelector('.tut-panel:not([hidden]) .tut-head');
  return page.evaluate(() => ({
    course: window.catan.tutorial.courseId,
    mode: window.catan.controller.state.settings.mode,
    title: document.querySelector('.tut-title')?.textContent,
  }));
}

/** "Learn to play" on the setup screen → the picker → the base game. */
async function tutorial() {
  const { ctx, open } = await profile('tutorial');
  const page = await open(`${BASE}/`);
  await page.click('[data-k="offline"]');
  await page.waitForSelector('.setup [data-k="learn"]');
  await page.click('.setup [data-k="learn"]');
  await page.waitForSelector('.tut-pick [data-k="tut-pick-base"]');
  check(await page.$('.setup [data-k="start"]'), 'the setup screen stays behind the picker');
  await page.click('.tut-pick [data-k="tut-pick-cancel"]');
  check(
    !(await page.$('.tut-pick')) && (await page.$('.setup [data-k="start"]')),
    'Cancel: back on the setup screen',
  );
  await page.click('.setup [data-k="learn"]');
  await page.click('.tut-pick [data-k="tut-pick-base"]');
  const s = await coachShows(page);
  check(s.mode === 'base' && s.course === 'base', 'base tutorial started from the picker');
  check(!(await page.$('.setup')), 'the setup screen closed');
  await ctx.close();
}

/** "New to Cities & Knights? Learn it" under the chip; its module loads; a reload resumes it. */
async function tutorialCk() {
  const { ctx, open } = await profile('tutorial-ck');
  const page = await open(`${BASE}/`);
  await page.click('[data-k="offline"]');
  await page.click('.setup [data-k="chip-ck"]');
  await page.click('.setup [data-k="learn-ck"]');
  const s = await coachShows(page);
  check(
    s.mode === 'ck' && s.course === 'ck' && s.title === 'Cities & Knights',
    'C&K tutorial started',
  );
  check(await page.$('[data-k="tut-base"]'), 'its intro offers the base tutorial');
  await page.click('[data-k="tut-next"]');
  await playHotseat(page, 12);
  await page.reload();
  await page.click('[data-k="offline"]');
  await page.waitForSelector('.game-resume .btn-primary');
  check(
    (await page.textContent('.game-resume p'))?.includes('tutorial'),
    'resume prompt names the tutorial',
  );
  await page.click('.game-resume .btn-primary');
  const again = await coachShows(page);
  check(again.course === 'ck' && again.mode === 'ck', 'C&K tutorial resumed after a reload');
  await ctx.close();
}

/** The menu's "Learn to play" in a running game → the picker → Seafarers. */
async function tutorialSea() {
  const { ctx, open } = await profile('tutorial-sea');
  const page = await open(`${BASE}/`);
  await newHotseat(page, null);
  const ask = async () => {
    await page.click('.menu-btn');
    await page.click('[data-k="learn-to-play"]');
    await page.click('[data-k="learn-ask"] .seg-btn.is-on');
    await page.waitForSelector('.tut-pick [data-k="tut-pick-seafarers"]');
  };
  await ask();
  await page.click('.tut-pick [data-k="tut-pick-cancel"]');
  check(
    (await page.$('.hud-side .sec-players')) && (await hotseatMode(page)) === 'base',
    'Cancel: the running game goes on',
  );
  await ask();
  await page.click('.tut-pick [data-k="tut-pick-seafarers"]');
  const s = await coachShows(page);
  check(
    s.mode === 'seafarers' && s.course === 'seafarers' && s.title === 'Seafarers',
    'Seafarers tutorial started from the menu picker',
  );
  await page.click('[data-k="tut-next"]');
  await playHotseat(page, 12);
  await ctx.close();
}

/** "New to Traders & Barbarians? Learn it" under the chip: the title scenario's course. */
async function tutorialTb() {
  const { ctx, open } = await profile('tutorial-tb');
  const page = await open(`${BASE}/`);
  await page.click('[data-k="offline"]');
  await page.click('.setup [data-k="chip-tb"]');
  await page.click('.setup [data-k="learn-tb"]');
  const s = await coachShows(page);
  const scenario = await page.evaluate(() => window.catan.controller.state.settings.scenario);
  check(
    s.mode === 'tb' &&
      s.course === 'tb' &&
      scenario === 'tb/traders' &&
      s.title === 'Traders & Barbarians',
    'T&B tutorial started (the Traders & Barbarians scenario)',
  );
  check(await page.$('[data-k="tut-base"]'), 'its intro offers the base tutorial');
  await page.click('[data-k="tut-next"]');
  await playHotseat(page, 12);
  check(
    await page.$('.tut-panel:not([hidden]) .tut-head'),
    'the coach follows the T&B tutorial game',
  );
  await ctx.close();
}

/** "New to Oil Springs? Learn it" under the chip: its course, then its HUD panel in play. */
async function tutorialOil() {
  const { ctx, open } = await profile('tutorial-oil');
  const page = await open(`${BASE}/`);
  await page.click('[data-k="offline"]');
  await page.click('.setup [data-k="chip-oil"]');
  await page.click('.setup [data-k="learn-oil"]');
  const s = await coachShows(page);
  check(
    s.mode === 'oil' && s.course === 'oil' && s.title === 'Oil Springs',
    'Oil Springs tutorial started',
  );
  check(await page.$('[data-k="tut-base"]'), 'its intro offers the base tutorial');
  await page.click('[data-k="tut-next"]');
  await playHotseat(page, 12);
  check(await page.$('.sec-ext-oil'), 'Oil Springs HUD panel shown');
  await ctx.close();
}

/** The setup screen's "Learn to play" → the picker → Crop Trust (its module not loaded yet). */
async function tutorialCrop() {
  const { ctx, open } = await profile('tutorial-crop');
  const page = await open(`${BASE}/`);
  await page.click('[data-k="offline"]');
  await page.click('.setup [data-k="learn"]');
  await page.click('.tut-pick [data-k="tut-pick-crop"]');
  const s = await coachShows(page);
  check(
    s.mode === 'crop' && s.course === 'crop' && s.title === 'Crop Trust',
    'Crop Trust tutorial started from the picker',
  );
  await page.click('[data-k="tut-next"]');
  await playHotseat(page, 12);
  check(await page.$('.sec-ext-crop'), 'Crop Trust HUD panel shown');
  await ctx.close();
}

/** Every mode (its modules load on demand): a dev all-bot game plays a few seconds. */
async function modes() {
  const list = JSON.parse(
    execSync(
      `npx tsx -e "import { listModes } from './src/engine'; console.log(JSON.stringify(listModes().map((m) => [m.id, m.players.min, m.players.max])))"`,
      { encoding: 'utf8' },
    ),
  );
  const { ctx, open } = await profile('modes');
  for (const [id, min, max] of list) {
    const n = Math.min(max, Math.max(min, 4));
    const page = await open(`${BASE}/?mode=${encodeURIComponent(id)}&autoplay=${n}bots&speed=0`);
    await page.waitForSelector('.hud-side .sec-players', { timeout: 60_000 });
    await page.waitForTimeout(2500);
    const s = await page.evaluate(() => {
      const st = window.catan?.controller?.state;
      return st ? { mode: st.settings.mode, turn: st.turn.number } : null;
    });
    check(s?.mode === id && s.turn > 0, `mode ${id}: ${n} bots played to turn ${s?.turn}`);
    await page.close();
  }
  await ctx.close();
}

const FLOWS = {
  base,
  ck,
  sea,
  online,
  tutorial,
  'tutorial-ck': tutorialCk,
  'tutorial-sea': tutorialSea,
  'tutorial-tb': tutorialTb,
  'tutorial-oil': tutorialOil,
  'tutorial-crop': tutorialCrop,
  modes,
};
let failed = false;
for (const name of ONLY) {
  try {
    await FLOWS[name]();
  } catch (e) {
    failed = true;
    console.log(`${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
await browser.close();
for (const p of problems) console.log(`problem  ${p}`);
if (failed || problems.length > 0) process.exit(1);
console.log('all flows ok, no CSP violations or page errors');
