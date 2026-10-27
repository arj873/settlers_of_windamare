// #54 screenshots: the game sidebar with Chat (an online game) at the issue's window size, a short
// window and a phone, scrolled to the top and to the bottom; plus player rows with pictures.
// Usage: pnpm build && pnpm preview --port 4173 &  node scripts/shots-sidebar.mjs [baseUrl] [outDir] [theme]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://localhost:4173', out = 'playtest/shots/sidebar', theme = 'wood'] =
  process.argv.slice(2);
const SIZES = [
  { name: '1503x785', viewport: { width: 1503, height: 785 }, scale: 1 },
  { name: '1366x640', viewport: { width: 1366, height: 640 }, scale: 1 },
  { name: '390', viewport: { width: 390, height: 844 }, scale: 2 },
];
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

for (const size of SIZES) {
  const tag = `${theme}-${size.name}`;
  const ctx = await browser.newContext({ viewport: size.viewport, deviceScaleFactor: size.scale });
  const page = await ctx.newPage();
  watch(page, tag);
  await page.addInitScript(() => {
    localStorage.setItem(
      'catan.profile.v1',
      JSON.stringify({ name: 'Ann', avatar: 'fox', pieceStyle: 'keep' }),
    );
    localStorage.setItem('catan.mp.name', 'Ann');
  });
  await page.goto(`${base}/?server=local&theme=${theme}`);
  await page.locator('[data-k="create"]').click();
  await page.waitForSelector('.ol-seat.is-mine', { timeout: 30_000 });
  await page.locator('.chat input').fill('hello table');
  await page.keyboard.press('Enter');
  await page.locator('[data-k="lobby-start"]').click();
  await page.waitForSelector('.hud-side .sec-chat', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const phone = size.viewport.width < 720;
  if (phone) {
    await page.locator('.drawer-btn').first().click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: `${out}/${tag}-top.png` });
  const fits = await page.evaluate(() => {
    const side = document.querySelector('.hud-side');
    side.scrollTop = side.scrollHeight;
    const chat = document.querySelector('.hud-side .sec-chat .chat-compose');
    const r = chat.getBoundingClientRect();
    return { scrolls: side.scrollHeight > side.clientHeight, bottom: r.bottom, h: innerHeight };
  });
  console.log(tag, JSON.stringify(fits));
  if (fits.bottom > fits.h + 1) errors.push(`${tag}: chat input below the window`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${tag}-bottom.png` });
  await ctx.close();
}

// Player rows with pictures (hotseat fixture, all humans).
const page = await browser.newPage({ viewport: { width: 1503, height: 785 } });
watch(page, 'rows');
await page.goto(
  `${base}/?fixture=midGame&looks=fox:classic,owl:keep,bear:adobe,-:pagoda&theme=${theme}`,
);
await page.waitForTimeout(1500);
const side = page.locator('.hud-players');
await side.screenshot({ path: `${out}/${theme}-rows.png` });

await browser.close();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
