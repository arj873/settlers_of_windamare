// Production-build smoke test of the flows that load expansion modules on demand (s18), with the
// page's Content-Security-Policy watched: base hotseat, C&K and Seafarers hotseat games picked on
// the setup screen, resume of the Seafarers save after a reload, an online Seafarers room on the
// in-browser server (host + a guest joining by the invite link), the tutorials (base from the
// picker, C&K from its chip link and resumed after a reload, Seafarers from the in-game menu,
// Traders & Barbarians, Explorers & Pirates and Oil Springs from their chip links, Crop Trust from
// the setup screen's picker), a short bot game of every mode (`?mode=`), and the piece-style
// previews (PR1) on every screen that shows them, also with the board's WebGL context lost.
//
//   pnpm build && pnpm preview --port 4173 &
//   node scripts/perf/flows.mjs [--base http://localhost:4173]
//     [--only base,ck,sea,online,tutorial,tutorial-ck,tutorial-sea,tutorial-tb,tutorial-ep,
//             tutorial-oil,tutorial-crop,modes,previews]
//
// Exits non-zero when a flow fails, the page throws or logs an error, a CSP violation fires, or
// a piece-style preview fails (its one console warning).
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
  'base,ck,sea,online,tutorial,tutorial-ck,tutorial-sea,tutorial-tb,tutorial-ep,tutorial-oil,tutorial-crop,modes,previews',
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
      if (
        m.type() === 'error' ||
        /Content.Security.Policy/i.test(t) ||
        t.startsWith('Piece style previews failed')
      ) {
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

/** "New to Explorers & Pirates? Learn it": Land Ho!, its course's pulse styled from the ep chunk. */
async function tutorialEp() {
  const { ctx, open } = await profile('tutorial-ep');
  const page = await open(`${BASE}/`);
  await page.click('[data-k="offline"]');
  await page.click('.setup [data-k="chip-ep"]');
  await page.click('.setup [data-k="learn-ep"]');
  const s = await coachShows(page);
  check(
    s.mode === 'ep' && s.course === 'ep' && s.title === 'Explorers & Pirates',
    'E&P tutorial started',
  );
  check(
    (await page.evaluate(() => window.catan.controller.state.settings.scenario)) === 'ep/landHo',
    'it is Land Ho!',
  );
  check(await page.$('[data-k="tut-base"]'), 'its intro offers the base tutorial');
  await page.click('[data-k="tut-next"]');
  await page.waitForSelector('.catan-hud[data-tut-focus="ep-fleet"] .ep-fleet');
  check(
    (await page.$eval('.ep-fleet', (el) => getComputedStyle(el).animationName)) === 'tut-pulse',
    'the next lesson pulses the fleet (course CSS from the ep chunk)',
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

/** Opaque pixels of each piece-style preview canvas under a selector (0: blank or not yet). */
const OPAQUE = `(sel) => [...document.querySelectorAll(sel)].map((box) => {
  const c = box.querySelector('canvas');
  if (!c || c.width === 0) return 0;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
})`;

/** All `count` previews under `sel` show a picture (they fill in one per frame). */
async function previewsDrawn(page, sel, count, what) {
  let seen = [];
  for (let i = 0; i < 60; i++) {
    seen = await page.evaluate(`(${OPAQUE})(${JSON.stringify(sel)})`);
    if (seen.length === count && seen.every((n) => n > 0)) break;
    await page.waitForTimeout(250);
  }
  check(
    seen.length === count && seen.every((n) => n > 0),
    `${what}: ${count} piece previews drawn (opaque px: ${seen.join(' ')})`,
  );
}

/**
 * Piece-style previews (PR1) on every screen that shows them. s18 drew them with the board's
 * renderer; with its WebGL context lost (phones drop it for background tabs; the board is unseen
 * behind these screens) they came out blank and stayed blank: names only.
 */
async function previews() {
  const { ctx, open } = await profile('previews');
  const DIALOG = '.pf-scrim .pf-style-art';
  const cancel = (page) => page.click('.pf-scrim .btn-ghost');

  const home = await open(`${BASE}/?server=local`);
  await home.click('[data-k="profile"]');
  await previewsDrawn(home, DIALOG, 6, 'home screen Profile');
  await cancel(home);
  await home.fill('[data-k="nickname"]', 'Ann');
  await home.click('[data-k="create"]');
  await home.waitForSelector('.ol-seat.is-mine');
  await previewsDrawn(home, '.ol-seats .pf-style-art', 1, 'online lobby seat');
  await home.click('.ol-lobby [data-k="profile"]');
  await previewsDrawn(home, DIALOG, 6, 'online lobby Profile');
  const guest = await open(await home.inputValue('[data-k="invite"]'));
  await guest.waitForSelector('[data-k="join"]');
  await guest.click('[data-k="profile"]');
  await previewsDrawn(guest, DIALOG, 6, '"Join the game" screen (?room=) Profile');
  await guest.close();
  await home.close();

  const lost = await open(`${BASE}/`);
  await lost.waitForSelector('#app canvas');
  const gone = await lost.evaluate(() => {
    const c = document.querySelector('#app canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl?.isContextLost() ?? false;
  });
  check(gone, "the board's WebGL context is lost");
  await lost.click('[data-k="profile"]');
  await previewsDrawn(lost, DIALOG, 6, "home screen Profile, board's WebGL context lost");
  await lost.close();

  // First asked for after the board drew a game: the menu's New game → the setup screen.
  const game = await open(`${BASE}/?fixture=midGame`);
  await game.waitForSelector('.hud-side .sec-players');
  await game.click('.menu-btn');
  await game.click('.menu-item:has-text("New game")');
  await game.waitForSelector('.setup [data-k="look-0"]');
  await previewsDrawn(game, '.pf-seat-look .pf-style-art', 4, 'setup screen seat looks');
  await game.click('.setup [data-k="look-1"]');
  await previewsDrawn(game, DIALOG, 6, 'seat look dialog');
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
  'tutorial-ep': tutorialEp,
  'tutorial-oil': tutorialOil,
  'tutorial-crop': tutorialCrop,
  modes,
  previews,
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
