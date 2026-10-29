// Which JS / CSS / font files a production build downloads (s18): home screen, then the setup
// screen, then (optionally) an expansion picked on it and the started game.
//
//   node scripts/perf/requests.mjs [--base http://localhost:4173] [--mode ck]
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = flag('--base', 'http://localhost:4173').replace(/\/$/, '');
const MODE = flag('--mode', null);

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
let step = 'home';
const rows = [];
const urls = new Map();
cdp.on('Network.responseReceived', (e) => urls.set(e.requestId, [e.response.url, e.type]));
cdp.on('Network.loadingFinished', (e) => {
  const [url, type] = urls.get(e.requestId) ?? ['?', '?'];
  if (!['Script', 'Stylesheet', 'Font'].includes(type)) return;
  rows.push({ step, type, file: url.replace(/^.*\//, ''), kB: e.encodedDataLength / 1024 });
});
await page.goto(`${BASE}/`);
await page.waitForSelector('[data-k="offline"]');
await page.waitForTimeout(1500);
step = 'setup';
await page.click('[data-k="offline"]');
await page.waitForSelector('.setup [data-k="start"]');
await page.waitForTimeout(500);
if (MODE) {
  step = `chip ${MODE}`;
  await page.click(`.setup [data-k="chip-${MODE}"]`);
  await page.waitForSelector('.setup [data-k="start"]:not([disabled])');
  await page.waitForTimeout(500);
}
step = 'start';
await page.click('.setup [data-k="start"]');
await page.waitForSelector('.hud-side .sec-players');
await page.waitForTimeout(1500);
await browser.close();

const sum = {};
for (const r of rows) {
  const k = `${r.step} ${r.type}`;
  sum[k] ??= { files: 0, kB: 0 };
  sum[k].files++;
  sum[k].kB += r.kB;
}
for (const r of rows)
  console.log(
    `${r.step.padEnd(9)} ${r.type.padEnd(10)} ${r.kB.toFixed(1).padStart(7)} kB  ${r.file}`,
  );
console.log('');
for (const [k, v] of Object.entries(sum)) {
  console.log(
    `${k.padEnd(22)} ${String(v.files).padStart(3)} files ${v.kB.toFixed(1).padStart(8)} kB`,
  );
}
