// CPU of an idle game screen (headless Chromium, swiftshader): the whole browser process tree's
// CPU time over a quiet window, and how many animation frames the page ran in it.
// Usage: node scripts/cpu-idle.mjs <baseUrl> [seconds] [query] [--no-css-anim]
//   default query: a mid-game fixture, a human to act (rolled, nothing highlighted).
//   --no-css-anim: pause HUD CSS animations (the glowing End turn button), to see the board alone.
import { readFileSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const [
  base = 'http://localhost:4173',
  secs = '10',
  query = 'fixture=midGame&seats=hhhh&debug=1&theme=sunfired',
] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const noCssAnim = flags.includes('--no-css-anim');

const TICK = 100; // USER_HZ (clock ticks per second) on Linux
/** utime + stime (seconds) of `pid` and every descendant. */
function treeCpu(root) {
  const kids = new Map();
  const cpu = new Map();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const ppid = Number(f[1]);
      cpu.set(Number(name), (Number(f[11]) + Number(f[12])) / TICK);
      kids.set(ppid, [...(kids.get(ppid) ?? []), Number(name)]);
    } catch {
      // the process exited while we read
    }
  }
  let total = 0;
  const walk = (pid) => {
    total += cpu.get(pid) ?? 0;
    for (const k of kids.get(pid) ?? []) walk(k);
  };
  walk(root);
  return total;
}

const server = await chromium.launchServer({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const pid = server.process().pid;
if (!pid) throw new Error('no browser pid');
const browser = await chromium.connect(server.wsEndpoint());
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__frames = 0;
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      window.__frames++;
      cb(t);
    });
});
await page.goto(`${base}/?${query}`);
await page.waitForFunction(() => window.__catanDebug?.state()?.turn.number >= 1, null, {
  timeout: 60_000,
});
if (noCssAnim) {
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; }' });
}
await page.waitForTimeout(3000);
// Board draws: Pixi's renderer.render calls (the app's own frames, whatever schedules them).
await page.evaluate(() => {
  const r = window.catan.board.app.renderer;
  const render = r.render.bind(r);
  window.__draws = 0;
  r.render = (...a) => {
    window.__draws++;
    return render(...a);
  };
});
const f0 = await page.evaluate(() => window.__frames);
const c0 = treeCpu(pid);
await page.waitForTimeout(Number(secs) * 1000);
const c1 = treeCpu(pid);
const [f1, draws, phase] = await page.evaluate(() => [
  window.__frames,
  window.__draws,
  window.__catanDebug.state().phase.kind,
]);
const s = Number(secs);
console.log(
  `${query}${noCssAnim ? ' --no-css-anim' : ''} (${phase}): ${(((c1 - c0) / s) * 100).toFixed(1)}% CPU (one core = 100%), ` +
    `${((f1 - f0) / s).toFixed(1)} animation frames/s, ${(draws / s).toFixed(1)} board draws/s ` +
    `over ${s}s`,
);
await browser.close();
await server.close();
