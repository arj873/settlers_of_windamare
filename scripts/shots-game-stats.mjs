// UX2 screenshots: plays an all-bot game to the end in vite preview, then shoots every stats tab.
// Usage: node scripts/shots-game-stats.mjs <baseUrl> <outDir>
import { chromium } from 'playwright';

const [base = 'http://localhost:4173', out = 'playtest/shots/game-stats'] = process.argv.slice(2);
const TABS = ['overview', 'dice', 'resources', 'activity', 'dev'];
const ALL_THEMES = ['sunfired', 'chartroom', 'parlour', 'wood', 'githubdark', 'materialdark'];
const SIZES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
for (const size of SIZES) {
  for (const theme of size.name === 'desktop' ? ['sunfired', 'chartroom'] : ['sunfired']) {
    const page = await browser.newPage({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${base}/?autoplay=4bots&speed=5&seed=11&debug=1&theme=${theme}`);
    await page.waitForFunction(() => window.__catanDebug?.state().phase.kind === 'gameOver', null, {
      timeout: 180_000,
      polling: 500,
    });
    await page.waitForTimeout(400);
    const tag = `${size.name}${theme === 'sunfired' ? '' : `-${theme}`}`;
    await page.screenshot({ path: `${out}/${tag}-0-winner.png` });
    await page.getByRole('button', { name: 'Game stats' }).click();
    for (const [i, tab] of TABS.entries()) {
      if (theme !== 'sunfired' && tab !== 'overview' && tab !== 'activity') continue;
      await page.click(`.gs-tab[data-tab="${tab}"]`);
      await page.waitForTimeout(150);
      if (tab === 'activity') {
        const box = await page.locator('.gs-line').boundingBox();
        if (box) await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
        await page.waitForTimeout(100);
      }
      await page.screenshot({ path: `${out}/${tag}-${i + 1}-${tab}.png` });
      if (tab === 'resources' || tab === 'activity' || tab === 'dev') {
        // The whole tab (the panel body scrolls).
        await page.locator('.gs-body').evaluate((el) => (el.scrollTop = el.scrollHeight));
        await page.waitForTimeout(100);
        await page.screenshot({ path: `${out}/${tag}-${i + 1}-${tab}-end.png` });
      }
    }
    if (theme === 'sunfired') {
      // #49: in every theme (fonts differ) and tab, the header and tab strip keep their full
      // height: nothing in them is clipped, so the active tab's underline never crosses a label.
      for (const t of ALL_THEMES) {
        for (const tab of TABS) {
          await page.evaluate((t) => (document.documentElement.dataset.theme = t), t);
          await page.click(`.gs-tab[data-tab="${tab}"]`);
          await page.waitForTimeout(50);
          // A shrunk strip stretches its buttons to the smaller height: their text overflows them.
          const clipped = await page.evaluate(() =>
            [...document.querySelectorAll('.gs-head, .gs-tabs, .gs-tab, .gs-foot')]
              .filter((el) => el.scrollHeight > el.clientHeight + 1)
              .map((el) => el.textContent || el.className),
          );
          if (clipped.length) errors.push(`${tag} ${t} ${tab}: clipped ${clipped.join(', ')}`);
        }
      }
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
      await page.click('.gs-collapse');
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${out}/${tag}-6-collapsed.png` });
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    if (overflow) errors.push(`${tag}: horizontal page scroll`);
    await page.close();
  }
}
await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
