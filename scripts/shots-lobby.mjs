// L1 lobby screenshots (in-browser dev server, two tabs of one profile share it): the host's view
// with 8 seats (Copy link just clicked), the guest seated on joining, and the guest after standing
// up ("You're watching. Pick a seat"), at desktop and phone width.
// Usage: node scripts/shots-lobby.mjs <baseUrl> <outDir> [theme,...]   (baseUrl: `pnpm dev`)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://localhost:5173', out = 'playtest/shots/lobby', themesArg] =
  process.argv.slice(2);
const THEMES = themesArg ? themesArg.split(',') : ['sunfired', 'githubdark'];
const SIZES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];

async function shot(page, name, full = false) {
  await page.evaluate(() => document.querySelector('.ol-lobby .su-scroll')?.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
}

for (const theme of THEMES) {
  for (const size of SIZES) {
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const open = async (url) => {
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(`${theme} ${size.name}: ${String(e)}`));
      p.on(
        'console',
        (m) => m.type() === 'error' && errors.push(`${theme} ${size.name}: ${m.text()}`),
      );
      await p.goto(url);
      return p;
    };
    const tag = `${theme}-${size.name}`;

    const ann = await open(`${base}/?server=local&theme=${theme}`);
    await ann.fill('[data-k="nickname"]', 'Ann');
    await ann.click('[data-k="create"]');
    await ann.waitForSelector('.ol-seat[data-seat="0"].is-mine');
    const invite = await ann.inputValue('[data-k="invite"]');

    const bob = await open(`${invite}&theme=${theme}`);
    await bob.fill('[data-k="nickname"]', 'Bob');
    await bob.click('[data-k="join"]');
    await bob.waitForSelector('.ol-seat.is-mine');
    await shot(bob, `guest-seated-${tag}`);

    // Host grows the table to 8 seats (bots), then copies the link.
    for (let n = 5; n <= 8; n++) {
      await ann.click('[data-k="add-bot"]');
      await ann.waitForFunction(
        (k) => document.querySelectorAll('.ol-seat[data-seat]').length === k,
        n,
      );
    }
    await ann.selectOption('[data-k="seat-level-3"]', 'hard');
    await ann.click('[data-k="copy"]');
    await ann.waitForSelector('[data-k="copy"] .ol-copy-label:not(.is-off):has-text("Copied!")');
    await shot(ann, `host-${tag}`);
    await ann.locator('.ol-seats').screenshot({ path: `${out}/host-seats-${tag}.png` });
    await ann.locator('[data-k="copy"]').screenshot({ path: `${out}/copied-${tag}.png` });

    // Bob stands up: the watching prompt at the top.
    await bob.waitForSelector('[data-k="stand"]');
    await bob.click('[data-k="stand"]');
    await bob.waitForSelector('[data-k="watching"]:not([hidden])');
    await shot(bob, `spectator-${tag}`);
    await ctx.close();
  }
}

await browser.close();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`shots in ${out}`);
