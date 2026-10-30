// Module hand card info screenshots (#cardinfo): a C&K progress card (Spy) opened on another
// player's turn, and a T&B Swift Journey (also off-turn); desktop and phone, a light and a dark
// theme. Bots play the opening at speed, then the game is frozen with seat 0 as the viewer.
// Needs the Vite dev server. Usage: node scripts/shots-cardinfo.mjs <devUrl> <outDir>
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://localhost:5173', out = 'docs/design/cardinfo'] = process.argv.slice(2);
const CK = { mode: 'ck', scenario: 'ck/classic', card: 'ck/spy' };
const TB = { mode: 'tb', scenario: 'tb/traders', card: 'tb/swift' };
const CASES = [
  { name: 'ck-desktop-light', ...CK, theme: 'chartroom', width: 1440 },
  { name: 'ck-desktop-dark', ...CK, theme: 'githubdark', width: 1440 },
  { name: 'ck-phone-light', ...CK, theme: 'chartroom', width: 412 },
  { name: 'ck-phone-dark', ...CK, theme: 'githubdark', width: 412 },
  { name: 'tb-swift-desktop-dark', ...TB, theme: 'githubdark', width: 1440 },
  { name: 'tb-swift-phone-light', ...TB, theme: 'chartroom', width: 412 },
];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];

for (const c of CASES) {
  const phone = c.width < 600;
  const page = await browser.newPage({
    viewport: { width: c.width, height: phone ? 915 : 900 },
    hasTouch: phone,
  });
  page.on('pageerror', (e) => errors.push(`${c.name}: ${String(e)}`));
  await page.goto(
    `${base}/?mode=${c.mode}&scenario=${c.scenario}&seed=5&seats=bbbb&speed=10&debug=1&theme=${c.theme}`,
  );
  // Bots play the opening; stop on someone else's main phase a few turns in.
  await page.waitForFunction(
    () => {
      const s = window.__catanDebug?.state();
      return !!s && s.turn.number >= 7 && s.phase.kind === 'main' && s.turn.current !== 0;
    },
    null,
    { timeout: 120_000, polling: 20 },
  );
  await page.evaluate((mode) => {
    const ctl = window.catan.controller;
    ctl.setSpeed(600_000);
    const s = structuredClone(window.__catanDebug.state());
    // A bot may have passed the turn to seat 0 meanwhile: keep it someone else's main phase.
    if (s.turn.current === 0 || s.phase.kind !== 'main') {
      s.turn = { ...s.turn, current: 1, devCardPlayed: false };
      s.phase = { kind: 'main' };
    }
    if (mode === 'ck') {
      // Seat 0 holds Spy, Alchemist and Warlord (drawn from their stacks: the 54 cards stay).
      const ck = s.ext.ck;
      const me = ck.players[0];
      const deckOf = (c) => Object.values(ck.decks).find((d) => d.includes(c));
      for (const c of me.progress.splice(0)) deckOf(c)?.unshift(c);
      for (const c of ['spy', 'alchemist', 'warlord']) {
        const d = deckOf(c);
        if (d) me.progress.push(...d.splice(d.indexOf(c), 1));
      }
    } else {
      const swift = s.ext.tb.traders.swift;
      swift.held[0] = (swift.held[0] ?? 0) + 1;
      swift.deck = Math.max(0, swift.deck - 1);
    }
    ctl.start(
      s,
      s.players.map((_, i) => (i === 0 ? 'human' : 'bot')),
      { viewer: 0 },
    );
    ctl.setSpeed(600_000);
  }, c.mode);
  await page.waitForTimeout(400);
  const cover = page.locator('.cover button, .pass-cover button');
  if (await cover.count()) await cover.first().click();
  await page.waitForTimeout(300);

  const stateKey = () =>
    page.evaluate(() => {
      const s = window.__catanDebug.state();
      return JSON.stringify([s.phase, s.turn, s.ext, s.log.length]);
    });
  const before = await stateKey();
  const sel = `.hud-bottom .hcard[data-info="${c.card}"]`;
  // force: Playwright will not click an aria-disabled button; a browser does.
  if (phone) await page.tap(sel, { force: true });
  else {
    await page.click(sel, { force: true });
    await page.mouse.move(c.width / 2, 300); // no hover lift on the card in the shot
  }
  await page.waitForTimeout(350);

  const pop = page.locator('.hud-pop-layer .dev-info:not(.is-placing)');
  if ((await pop.count()) !== 1) errors.push(`${c.name}: info card not shown`);
  else {
    const b = await pop.boundingBox();
    if (b.x < 0 || b.y < 0 || b.x + b.width > c.width) {
      errors.push(`${c.name}: info card off-screen ${JSON.stringify(b)}`);
    }
    const text = await pop.textContent();
    if (!text.includes('Not your turn')) errors.push(`${c.name}: unexpected text: ${text}`);
  }
  if ((await stateKey()) !== before) errors.push(`${c.name}: the click changed the game`);
  await page.screenshot({ path: `${out}/${c.name}.png` });
  await page.close();
}
await browser.close();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
