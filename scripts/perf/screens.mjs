// Click -> next paint on the screens around the game (s18 item 6), on an emulated low-end device
// (2 cores, 2 GB, CPU throttled): setup screen (open, expansion chip, scenario tile, map tile,
// add seat), profile dialog (open, piece style), stats screen (open, tabs), online lobby (create,
// a chip in the host's config).
//   node scripts/perf/screens.mjs [--base http://localhost:4173] [--cpu 6] [--json out.json]
//                                 [--only profile,setup,stats,online]
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = flag('--base', 'http://localhost:4173').replace(/\/$/, '');
const CPU = Number(flag('--cpu', '6'));
const JSON_OUT = flag('--json', null);
const ONLY = flag('--only', 'profile,setup,stats,online').split(',');

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function page(url, { throttleAfter = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 2 });
    localStorage.setItem('catan:tutorial:v1', JSON.stringify({ offered: true }));
    window.__ev = [];
    window.__lt = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.interactionId) window.__ev.push({ name: e.name, d: e.duration, id: e.interactionId });
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lt.push(e.duration);
    }).observe({ type: 'longtask', buffered: true });
  });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: 2 });
  await p.goto(url);
  // `throttleAfter`: a selector to reach at full speed first (a bot game played to the end).
  if (throttleAfter) await p.waitForSelector(throttleAfter, { timeout: 180_000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  return { p, ctx };
}

const out = {};
/** Click `sel`, wait for `ready`, record the slowest event of that interaction and the wall time. */
async function timed(p, label, sel, ready) {
  await p.waitForTimeout(400);
  const n0 = await p.evaluate(() => window.__ev.length);
  const lt0 = await p.evaluate(() => window.__lt.length);
  const t0 = await p.evaluate(() => performance.now());
  await p.click(sel);
  if (ready) await p.waitForSelector(ready, { timeout: 60_000 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r))));
  const wall = (await p.evaluate(() => performance.now())) - t0;
  await p.waitForTimeout(300);
  const ev = await p.evaluate((n) => window.__ev.slice(n), n0);
  const lt = await p.evaluate((n) => window.__lt.slice(n), lt0);
  const paint = Math.max(0, ...ev.map((e) => e.d));
  out[label] = {
    clickToPaint: Math.round(paint),
    toReady: Math.round(wall),
    longTasks: lt.map(Math.round),
  };
  console.log(label.padEnd(26), JSON.stringify(out[label]));
}

if (ONLY.includes('profile')) {
  const { p, ctx } = await page(`${BASE}/`);
  await p.waitForSelector('[data-k="offline"]');
  await p.waitForTimeout(4000); // the game chunk
  const t0 = await p.evaluate(() => performance.now());
  await timed(p, 'profile dialog open', '[data-k="profile"]', '.pf-scrim');
  await p.waitForFunction(
    () =>
      document.querySelectorAll('.pf-styles .pf-style-art > *').length ===
      document.querySelectorAll('.pf-styles .pf-style-art').length,
    null,
    { timeout: 30_000 },
  );
  out['profile dialog open'].previewsDone = Math.round(
    (await p.evaluate(() => performance.now())) - t0,
  );
  console.log('  previews done', out['profile dialog open'].previewsDone);
  await ctx.close();
}
if (ONLY.includes('setup')) {
  const { p, ctx } = await page(`${BASE}/`);
  await p.waitForSelector('[data-k="offline"]');
  await p.waitForTimeout(4000); // the game chunk
  await timed(p, 'setup screen open', '[data-k="offline"]', '.setup [data-k="start"]');
  await timed(p, 'setup: map tile', '.setup [data-k="map-base56"]', null);
  await timed(p, 'setup: add seat', '.setup [data-k="add-seat"]', null);
  await timed(p, 'setup: chip C&K (load)', '.setup [data-k="chip-ck"]', '.setup .su-map-art svg');
  await p.waitForFunction(() => !document.querySelector('.setup .su-loading'));
  await timed(p, 'setup: chip Seafarers', '.setup [data-k="chip-seafarers"]', null);
  await p.waitForFunction(() => !document.querySelector('.setup .su-loading'));
  await timed(p, 'setup: chip Seafarers again', '.setup [data-k="chip-seafarers"]', null);
  await timed(p, 'setup: scenario tile', '.setup .su-map:not(.is-on)', null);
  await ctx.close();
}
if (ONLY.includes('stats')) {
  // A finished all-bot game (fixtures record no statistics).
  const { p, ctx } = await page(`${BASE}/?autoplay=4bots&speed=0&seed=7&vp=6`, {
    throttleAfter: '.winner-stats',
  });
  await timed(p, 'stats screen open', '.winner-stats', '.gs-tabs');
  for (const tab of ['dice', 'resources', 'activity', 'dev']) {
    if (await p.$(`.gs-tab[data-tab="${tab}"]`)) {
      await timed(p, `stats tab ${tab}`, `.gs-tab[data-tab="${tab}"]`, null);
    }
  }
  await ctx.close();
}
if (ONLY.includes('online')) {
  const { p, ctx } = await page(`${BASE}/?server=local`);
  await p.waitForSelector('[data-k="create"]');
  await p.waitForTimeout(4000);
  await p.fill('[data-k="nickname"]', 'Ann');
  await timed(p, 'online create -> lobby', '[data-k="create"]', '.ol-lobby');
  await timed(
    p,
    'lobby: host chip C&K',
    '.ol-config [data-k="chip-ck"]',
    '.ol-config .su-map-art svg',
  );
  await ctx.close();
}
await browser.close();
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 2));
