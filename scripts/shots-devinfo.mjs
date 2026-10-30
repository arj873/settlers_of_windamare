// Dev card info card screenshots (#devinfo): Orange's hand on Blue's turn, the Road Building info
// card open after a click / tap; desktop and phone, a light and a dark theme. Plus Low power on a
// phone: a long-press on a card Orange can play opens the info card without playing it.
// Needs the Vite dev server. Usage: node scripts/shots-devinfo.mjs <devUrl> <outDir>
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://localhost:5173', out = 'docs/design/devinfo'] = process.argv.slice(2);
const CASES = [
  { name: 'desktop-light', theme: 'chartroom', width: 1440 },
  { name: 'desktop-dark', theme: 'githubdark', width: 1440 },
  { name: 'phone-light', theme: 'chartroom', width: 412 },
  { name: 'phone-dark', theme: 'githubdark', width: 412 },
  { name: 'desktop-sunfired', theme: 'sunfired', width: 1440 },
  { name: 'phone-lowpower-longpress', theme: 'sunfired', width: 412, low: true, ownTurn: true },
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
  page.on('console', (m) => m.type() === 'error' && errors.push(`${c.name}: ${m.text()}`));
  if (c.low) await page.addInitScript(() => localStorage.setItem('catan.performance', 'low'));
  await page.goto(`${base}/?fixture=midGame&debug=1&theme=${c.theme}`);
  await page.waitForFunction(() => window.__catanDebug?.state() && window.catan?.controller);
  // Orange (seat 3) gets a fuller hand; Blue's turn, or Orange's own turn before the roll.
  await page.evaluate((ownTurn) => {
    const s = structuredClone(window.__catanDebug.state());
    const orange = s.players[3];
    orange.devCards = { ...orange.devCards, knight: 2, roadBuilding: 1, victoryPoint: 1 };
    orange.newDevCards = { ...orange.newDevCards, yearOfPlenty: 1 };
    if (ownTurn) {
      s.turn = { ...s.turn, number: 13, current: 3, devCardPlayed: false };
      s.phase = { kind: 'preRoll' };
      s.dice = null;
    }
    // Orange is the only human (the viewer); the bots wait until a check lets them move.
    const ctl = window.catan.controller;
    ctl.start(
      s,
      s.players.map((_, i) => (i === 3 ? 'human' : 'bot')),
      { viewer: 3 },
    );
    ctl.setSpeed(600_000);
  }, !!c.ownTurn);
  await page.waitForTimeout(400);
  const cover = page.locator('.cover button, .pass-cover button');
  if (await cover.count()) await cover.first().click();
  await page.waitForTimeout(300);

  const stateKey = () =>
    page.evaluate(() => {
      const s = window.__catanDebug.state();
      return JSON.stringify([s.phase, s.turn, s.players[3].devCards, s.log.length]);
    });
  const before = await stateKey();
  const type = c.ownTurn ? 'knight' : 'roadBuilding';
  const sel = `.hud-bottom .dcard[data-dev="${type}"]`;
  if (c.ownTurn) {
    // A real touch long-press (Playwright has no API for one).
    const box = await page.locator(sel).boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const at = [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at });
    await page.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else if (phone) {
    // force: Playwright will not click an aria-disabled button; a browser does.
    await page.tap(sel, { force: true });
  } else {
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
  }
  if ((await stateKey()) !== before) errors.push(`${c.name}: the click changed the game`);
  if (
    c.low &&
    !(await page.evaluate(() => document.documentElement.classList.contains('is-low-power')))
  ) {
    errors.push(`${c.name}: Low power is off`);
  }
  await page.screenshot({ path: `${out}/${c.name}.png` });

  if (c.name === 'desktop-light') {
    // A bot moves under the open info card: the same node stays, still placed (no flicker).
    await page.evaluate(() => {
      document.querySelector('.dev-info').dataset.mark = '1';
      window.catan.controller.setSpeed(30);
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => window.catan.controller.setSpeed(600_000));
    await page.waitForTimeout(100);
    if ((await stateKey()) === before) errors.push(`${c.name}: no bot moved`);
    const kept = await page.evaluate(() => {
      const el = document.querySelector('.hud-pop-layer .dev-info');
      return !!el && el.dataset.mark === '1' && !el.classList.contains('is-placing');
    });
    if (!kept) errors.push(`${c.name}: info card lost on a bot move`);
  }
  await page.close();
}
await browser.close();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
