// Production-build smoke test of the flows that load expansion modules on demand (s18), with the
// page's Content-Security-Policy watched: base hotseat, C&K and Seafarers hotseat games picked on
// the setup screen, resume of the Seafarers save after a reload, an online Seafarers room on the
// in-browser server (host + a guest joining by the invite link), the tutorial, and a short bot
// game of every mode (`?mode=`).
//
//   pnpm build && pnpm preview --port 4173 &
//   node scripts/perf/flows.mjs [--base http://localhost:4173] [--only base,ck,sea,online,tutorial,modes]
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
const ONLY = flag('--only', 'base,ck,sea,online,tutorial,modes').split(',');

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

async function tutorial() {
  const { ctx, open } = await profile('tutorial');
  const page = await open(`${BASE}/`);
  await page.click('[data-k="offline"]');
  await page.waitForSelector('.setup [data-k="learn"]');
  await page.click('.setup [data-k="learn"]');
  await page.waitForSelector('.hud-side .sec-players');
  await page.waitForSelector('.tut-head');
  check((await hotseatMode(page)) === 'base', 'tutorial game started');
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

const FLOWS = { base, ck, sea, online, tutorial, modes };
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
