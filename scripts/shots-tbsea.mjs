// T&B + Seafarers and the T&B scenario pairs (C2) in vite preview: the setup screen with the
// mode's scenario tiles, then an all-bot game per scenario (start, and mid-game in two or more
// themes). No page errors allowed.
// --epck: the E&P + C&K sidebar check (a tall C&K panel next to the E&P one).
// --sheets: the six T&B × T&B sheets without Fishing (C4).
// Usage: node scripts/shots-tbsea.mjs <baseUrl> <outDir> [--pairs | --sheets | --epck] [--setup-only]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [base = 'http://localhost:4173', out = 'playtest/shots/tbsea'] = args;
mkdirSync(out, { recursive: true });
const SHEETS = process.argv.includes('--sheets');
const PAIRS = SHEETS || process.argv.includes('--pairs');
const EPCK = process.argv.includes('--epck');
// --c3: the T&B scenarios on the other Seafarers scenarios (card C3), two themes each.
const C3 = process.argv.includes('--c3');
const C3_SCENARIOS = [
  'fishermenFour',
  'fishermenFog',
  'fishermenDesert',
  'fishermenTribe',
  'fishermenCloth',
  'fishermenWonders',
  'fishermenNewWorld',
  'caravansDesert',
  'caravansTribe',
  'caravansNewWorld',
  'riversTribe',
  'riversNewWorld',
  'riversFog',
  'riversDesert',
  'riversDesert2',
  'caravansFour',
  'tradersDesert',
  'barbarianAttackDesert',
];
const C3_THEMES = [
  ['sunfired', 'githubdark'],
  ['chartroom', 'materialdark'],
  ['parlour', 'githubdark'],
  ['wood', 'materialdark'],
];
const MODE = EPCK ? 'ep+ck' : PAIRS ? 'tb+tb' : 'tb+seafarers';
const GAMES = EPCK
  ? [{ scenario: 'ep/full', themes: ['sunfired', 'githubdark'], turn: 30 }]
  : C3
    ? C3_SCENARIOS.map((s, i) => ({ scenario: `tbsea/${s}`, themes: C3_THEMES[i % 4], turn: 25 }))
    : SHEETS
      ? [
          { scenario: 'tbpair/baTraders', themes: ['sunfired', 'githubdark'], turn: 45 },
          { scenario: 'tbpair/caravansBa', themes: ['chartroom', 'materialdark'], turn: 40 },
          { scenario: 'tbpair/caravansTraders', themes: ['parlour', 'githubdark'], turn: 40 },
          { scenario: 'tbpair/riversBa', themes: ['wood', 'materialdark'], turn: 40 },
          { scenario: 'tbpair/riversCaravans', themes: ['sunfired', 'githubdark'], turn: 40 },
          { scenario: 'tbpair/riversTraders', themes: ['chartroom', 'materialdark'], turn: 40 },
        ]
      : PAIRS
        ? [
            { scenario: 'tbpair/fishRivers', themes: ['sunfired', 'githubdark'], turn: 40 },
            { scenario: 'tbpair/fishTraders', themes: ['chartroom', 'materialdark'], turn: 40 },
            { scenario: 'tbpair/fishBa', themes: ['parlour', 'githubdark'], turn: 40 },
            { scenario: 'tbpair/fishCaravans', themes: ['wood', 'materialdark'], turn: 40 },
          ]
        : [
            {
              scenario: 'tbsea/traders',
              themes: ['sunfired', 'chartroom', 'githubdark'],
              turn: 45,
            },
            { scenario: 'tbsea/fishermen', themes: ['parlour', 'materialdark'], turn: 40 },
            { scenario: 'tbsea/rivers', themes: ['wood', 'githubdark'], turn: 40 },
            { scenario: 'tbsea/caravans', themes: ['sunfired', 'materialdark'], turn: 50 },
            { scenario: 'tbsea/barbarianAttack', themes: ['chartroom', 'githubdark'], turn: 40 },
          ];

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const watch = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag}: ${String(e)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${tag}: ${m.text()}`));
};
const setTheme = (page, t) =>
  page.evaluate((theme) => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('catan.theme', theme);
  }, t);

// The setup screen: the combined mode and its scenario tiles.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page, 'setup');
  await page.goto(`${base}/?theme=sunfired`);
  await page.getByText('Play offline').click();
  await page.waitForSelector(`[data-k="mode-${MODE}"]`, { timeout: 30_000 });
  await page.click(`[data-k="mode-${MODE}"]`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/setup-${MODE.replace('+', '_')}.png` });
  await page.locator(`[data-k="scenario-${GAMES[0].scenario}"]`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/setup-${MODE.replace('+', '_')}-scenarios.png` });
  await page.close();
}

// --only=a,b: just those scenarios (ids without the module prefix).
const ONLY = process.argv
  .find((a) => a.startsWith('--only='))
  ?.slice(7)
  .split(',');
const games = ONLY ? GAMES.filter((g) => ONLY.includes(g.scenario.split('/')[1])) : GAMES;
for (const g of process.argv.includes('--setup-only') ? [] : games) {
  const tag = g.scenario.split('/')[1];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page, tag);
  await page.goto(
    `${base}/?mode=${encodeURIComponent(MODE)}&scenario=${g.scenario}&autoplay=4bots&speed=1&seed=7&debug=1&theme=${g.themes[0]}`,
  );
  await page.waitForFunction(() => window.__catanDebug?.state().turn.number >= 1, null, {
    timeout: 60_000,
    polling: 200,
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${tag}-1-start.png` });
  await page.waitForFunction(
    (turn) =>
      window.__catanDebug?.state().turn.number >= turn ||
      window.__catanDebug?.state().phase.kind === 'gameOver',
    g.turn,
    { timeout: 400_000, polling: 200 },
  );
  for (const theme of g.themes) {
    await setTheme(page, theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${tag}-2-mid-${theme}.png` });
  }
  const s = await page.evaluate(() => window.__catanDebug?.state());
  console.log(`${tag}: turn ${s.turn.number}, phase ${s.phase.kind}`);
  await page.close();
}
await browser.close();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
