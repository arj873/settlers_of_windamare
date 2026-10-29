// Layouts per roll (s18): a DevTools trace around clicking "Roll dice" in a fixture where the
// roll pays someone; counts Layout events and the forced (synchronous, script-triggered) ones.
//   node scripts/perf/roll-layouts.mjs [--base http://localhost:4173] [--rolls 5] [--perf high|low]
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = flag('--base', 'http://localhost:4173').replace(/\/$/, '');
const ROLLS = Number(flag('--rolls', '5'));
const PERF = flag('--perf', 'high');

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const totals = { layouts: 0, forced: 0, rolls: 0 };
for (let seed = 1; totals.rolls < ROLLS && seed < 40; seed++) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript((p) => localStorage.setItem('catan.performance', p), PERF);
  const page = await ctx.newPage();
  // Two humans after setup: seat 0 to roll.
  await page.goto(`${BASE}/?fixture=midGame&seats=hhhh&debug=1&seed=${seed}`);
  await page.waitForFunction(() => window.__catanDebug?.state());
  const cover = await page.$('.cover .btn-primary');
  if (cover) await cover.click();
  const ready = await page.$('.btn-roll.is-ready');
  if (!ready) {
    // Not seat's turn to roll in this fixture: end the turn first.
    await page.click('.btn-end.is-ready').catch(() => undefined);
    const c2 = await page.$('.cover .btn-primary');
    if (c2) await c2.click();
  }
  if (!(await page.$('.btn-roll.is-ready'))) {
    await ctx.close();
    continue;
  }
  await page.waitForTimeout(500);
  const before = await page.evaluate(() =>
    JSON.stringify(window.__catanDebug.state().players.map((p) => p.resources)),
  );
  const cdp = await ctx.newCDPSession(page);
  const events = [];
  cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline.stack',
    transferMode: 'ReportEvents',
  });
  await page.click('.btn-roll.is-ready');
  await page.waitForTimeout(800);
  await cdp.send('Tracing.end');
  await done;
  const after = await page.evaluate(() =>
    JSON.stringify(window.__catanDebug.state().players.map((p) => p.resources)),
  );
  await ctx.close();
  if (before === after) continue; // the roll paid nobody: no production animation
  const layouts = events.filter(
    (e) => (e.name === 'Layout' && e.ph === 'X') || (e.name === 'Layout' && e.ph === 'B'),
  );
  const forced = layouts.filter((e) => e.args?.beginData?.stackTrace?.length);
  totals.layouts += layouts.length;
  totals.forced += forced.length;
  totals.rolls++;
  console.log(
    `seed ${seed}: ${layouts.length} layouts, ${forced.length} forced` +
      forced.map((e) => ` [${e.args.beginData.stackTrace[0].functionName || '?'}]`).join(''),
  );
  if (args.includes('--stacks')) {
    for (const e of forced) {
      const st = e.args.beginData.stackTrace.slice(0, 8);
      console.log(`  ${st.map((s) => `${s.functionName || '?'}:${s.lineNumber}`).join(' < ')}`);
    }
  }
}
await browser.close();
console.log(
  `${totals.rolls} paying rolls: ${(totals.layouts / totals.rolls).toFixed(1)} layouts, ` +
    `${(totals.forced / totals.rolls).toFixed(1)} forced per roll`,
);
