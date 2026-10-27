// PR1 screenshots: the Profile dialog, the online lobby with pictures (a gallery one and an
// uploaded one), a mid-game board with 4 piece styles and a hotseat HUD with pictures.
// Usage: pnpm build && pnpm preview --port 4173 &  node scripts/shots-profile.mjs [baseUrl] [outDir] [themes]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://localhost:4173', out = 'playtest/shots/profile', themesArg] =
  process.argv.slice(2);
const themes = (themesArg ?? 'sunfired,githubdark').split(',');
const SIZES = [
  { name: '1440', viewport: { width: 1440, height: 900 }, scale: 1 },
  { name: '390', viewport: { width: 390, height: 844 }, scale: 2 },
];
const LOOKS = 'fox:classic,owl:keep,bear:adobe,knight:pagoda';
const STYLE_LOOKS = 'fox:timber,owl:keep,bear:longhouse,knight:pagoda';

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const watch = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag}: ${String(e)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${tag}: ${m.text()}`));
};
const profile = (name, avatar, pieceStyle) => JSON.stringify({ name, avatar, pieceStyle });

/** A 96 px WebP drawn in the page (stands in for an uploaded photo). */
const makeUpload = () => {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 96, 96);
  grad.addColorStop(0, '#ffb347');
  grad.addColorStop(1, '#5b3bb3');
  g.fillStyle = grad;
  g.fillRect(0, 0, 96, 96);
  g.fillStyle = '#f2c9a0';
  g.beginPath();
  g.arc(48, 44, 22, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3b2a20';
  g.beginPath();
  g.arc(48, 30, 20, Math.PI, 0);
  g.fill();
  g.fillStyle = '#2b5fae';
  g.fillRect(18, 72, 60, 30);
  g.fillStyle = '#222';
  g.fillRect(39, 42, 4, 4);
  g.fillRect(53, 42, 4, 4);
  return c.toDataURL('image/webp', 0.8);
};

for (const theme of themes) {
  for (const size of SIZES) {
    const tag = `${theme}-${size.name}`;
    const ctx = await browser.newContext({
      viewport: size.viewport,
      deviceScaleFactor: size.scale,
    });

    // 1. Mid-game board with 4 piece styles (all bots, frozen at turn 30).
    {
      const page = await ctx.newPage();
      watch(page, `${tag} board`);
      await page.goto(
        `${base}/?autoplay=4bots&speed=1&seed=7&looks=${STYLE_LOOKS}&theme=${theme}&debug=1`,
      );
      await page.waitForFunction(() => window.__catanDebug?.state().turn.number >= 30, null, {
        timeout: 120_000,
        polling: 200,
      });
      await page.evaluate(() => window.catan.controller.setSpeed(10_000_000));
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${out}/${tag}-board-styles.png` });
      await page.close();
    }

    // 2. Hotseat HUD with pictures (all human seats).
    {
      const page = await ctx.newPage();
      watch(page, `${tag} hud`);
      await page.goto(`${base}/?fixture=midGame&looks=${LOOKS}&theme=${theme}`);
      await page.waitForTimeout(1200);
      // Dismiss a pass-device cover if any.
      await page
        .locator('.cover button, [data-k="cover-ok"]')
        .first()
        .click({ timeout: 1500 })
        .catch(() => undefined);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/${tag}-hud-avatars.png` });
      await page.close();
    }

    // 3. Home + Profile dialog, then the online lobby with two people.
    {
      const ann = await ctx.newPage();
      watch(ann, `${tag} ann`);
      await ann.addInitScript(
        ([p]) => {
          if (!sessionStorage.getItem('pf-set')) {
            localStorage.setItem('catan.profile.v1', p);
            localStorage.setItem('catan.mp.name', 'Ann');
            sessionStorage.setItem('pf-set', '1');
          }
        },
        [profile('Ann', 'fox', 'keep')],
      );
      await ann.goto(`${base}/?server=local&theme=${theme}`);
      await ann.locator('[data-k="profile"]').click();
      await ann.waitForTimeout(1500); // style previews
      await ann.screenshot({ path: `${out}/${tag}-profile-dialog.png` });
      await ann.locator('[data-k="profile-save"]').click();
      await ann.locator('[data-k="create"]').click();
      await ann.waitForSelector('[data-k="invite"]', { timeout: 30_000 });
      // L1: naming yourself seats you (the host in seat 1).
      await ann.waitForSelector('.ol-seat.is-mine', { timeout: 30_000 });
      const invite = await ann.locator('[data-k="invite"]').inputValue();

      const upload = await ann.evaluate(makeUpload);
      const bob = await ctx.newPage();
      watch(bob, `${tag} bob`);
      await bob.addInitScript(
        ([p]) => {
          if (!sessionStorage.getItem('pf-set')) {
            localStorage.setItem('catan.profile.v1', p);
            localStorage.setItem('catan.mp.name', 'Bob');
            sessionStorage.setItem('pf-set', '1');
          }
        },
        [profile('Bob', upload, 'pagoda')],
      );
      await bob.goto(invite);
      await bob.locator('[data-k="join"]').click();
      await bob.waitForSelector('.ol-seat.is-mine', { timeout: 30_000 });
      await ann.bringToFront();
      await ann.waitForTimeout(1800);
      await ann.evaluate(() => document.querySelector('.ol-lobby .su-scroll')?.scrollTo(0, 0));
      await ann.screenshot({ path: `${out}/${tag}-lobby.png` });
      await ann
        .locator('.ol-seats')
        .scrollIntoViewIfNeeded()
        .catch(() => undefined);
      await ann.waitForTimeout(300);
      await ann.screenshot({ path: `${out}/${tag}-lobby-seats.png` });
      await bob.close();
      await ann.close();
    }

    // 4. Hotseat setup: seat 1 wears the saved profile, each seat has a look button.
    {
      const page = await ctx.newPage();
      watch(page, `${tag} setup`);
      await page.goto(`${base}/?theme=${theme}`);
      await page.locator('[data-k="offline"]').click();
      await page.waitForSelector('[data-k="look-0"]');
      await page.locator('[data-k="look-0"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}/${tag}-setup-seats.png` });
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
