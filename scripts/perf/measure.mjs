// Low-end device performance numbers for a production build (s17). Headless Chrome with CPU
// throttling (Chrome DevTools Protocol), swiftshader for WebGL (so GPU work is CPU work, like a
// weak integrated GPU).
//
//   pnpm build && pnpm preview --port 4173 &
//   node scripts/perf/measure.mjs [--base http://localhost:4173] [--cpu 6] [--only load,game,online]
//                                 [--viewport 1366x768@1] [--perf auto|high|low] [--json out.json]
//
// load:   cold load on "slow 4G" (Lighthouse's DevTools numbers: 562.5 ms RTT, 1.47 Mbit/s down):
//         transferred bytes by type, first paint, home screen, setup screen, Start game -> board.
// game:   seat 0 human (scripted real clicks) vs 3 Normal bots at 300 ms: interaction latency
//         (Event Timing: input -> next paint), long tasks / long animation frames during bot turns,
//         pan / zoom frame times, JS heap, GPU textures and canvas size.
// online: in-browser room server (?server=local, a SharedWorker): home -> lobby, Start -> board,
//         then per `game` message: handler time (parse + render) and time to the next frame.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = flag('--base', 'http://localhost:4173').replace(/\/$/, '');
const CPU = Number(flag('--cpu', '6'));
const ONLY = flag('--only', 'load,game,online').split(',');
const [vw, vh, dpr] = flag('--viewport', '1366x768@1').split(/[x@]/).map(Number);
const PERF = flag('--perf', null);
const JSON_OUT = flag('--json', null);
const TURNS = Number(flag('--turns', '4'));

const SLOW_4G = {
  offline: false,
  latency: 562.5,
  downloadThroughput: (1474.56 * 1024) / 8,
  uploadThroughput: (675 * 0.9 * 1024) / 8,
};

const stats = (xs) => {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const r = (x) => Math.round(x * 10) / 10;
  return {
    n: s.length,
    median: r(q(0.5)),
    p95: r(q(0.95)),
    max: r(s[s.length - 1]),
    mean: r(s.reduce((a, b) => a + b, 0) / s.length),
  };
};

/** In-page probes: event timing, long animation frames, long tasks, rAF intervals, labels. */
function probes() {
  const w = window;
  w.__perf = { label: 'boot', events: [], loafs: [], longtasks: [], frames: null, msgs: [] };
  const P = w.__perf;
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (!e.interactionId) continue;
        P.events.push({
          label: P.label,
          name: e.name,
          id: e.interactionId,
          duration: e.duration,
          input: e.processingStart - e.startTime,
          processing: e.processingEnd - e.processingStart,
          present: e.startTime + e.duration - e.processingEnd,
        });
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  } catch {
    /* no Event Timing */
  }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const end = e.startTime + e.duration;
        P.loafs.push({
          label: P.label,
          duration: e.duration,
          blocking: e.blockingDuration,
          start: e.startTime,
          // Phases: tasks before the frame, rAF callbacks (the board), style/layout/paint.
          tasks: (e.renderStart || end) - e.startTime,
          raf: e.renderStart ? (e.styleAndLayoutStart || end) - e.renderStart : 0,
          render: e.styleAndLayoutStart ? end - e.styleAndLayoutStart : 0,
          scripts: (e.scripts || []).map((s) => ({
            d: s.duration,
            inv: s.invoker,
            fn: s.sourceFunctionName,
            pos: s.sourceCharPosition,
            url: (s.sourceURL || '').split('/').pop(),
          })),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch {
    /* no LoAF */
  }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) P.longtasks.push({ label: P.label, duration: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* no long tasks */
  }
  // Frame intervals on demand (pan / zoom), without keeping a rAF loop running otherwise.
  P.startFrames = () => {
    P.frames = [];
    let last = performance.now();
    const loop = (t) => {
      if (!P.frames) return;
      P.frames.push(t - last);
      last = t;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };
  P.stopFrames = () => {
    const f = P.frames;
    P.frames = null;
    return f;
  };
  P.nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  // Online: time every dev-server port message (the tab's whole handler: JSON parse, client,
  // render), and from its arrival to the next frame.
  const desc = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
  if (desc?.set) {
    Object.defineProperty(MessagePort.prototype, 'onmessage', {
      ...desc,
      set(fn) {
        desc.set.call(this, (e) => {
          const t0 = performance.now();
          fn.call(this, e);
          const t1 = performance.now();
          const text = e.data && e.data.t === 'msg' ? e.data.text : '';
          if (/^\{"v":\d+,"type":"game"/.test(text)) {
            const rec = { bytes: text.length, handler: t1 - t0, toFrame: null };
            P.msgs.push(rec);
            requestAnimationFrame(() => (rec.toFrame = performance.now() - t0));
          }
        });
      },
    });
  }
}

async function newPage(browser, { throttleNet = false, cpu = CPU } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: vw, height: vh },
    deviceScaleFactor: dpr,
  });
  if (PERF) {
    await ctx.addInitScript((v) => {
      try {
        localStorage.setItem('catan.performance', v);
      } catch {
        /* ignore */
      }
    }, PERF);
  }
  await ctx.addInitScript(probes);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await cdp.send('Network.enable');
  if (throttleNet) {
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', SLOW_4G);
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, cdp, errors };
}

const label = (page, l) => page.evaluate((x) => (window.__perf.label = x), l);

async function heap(cdp) {
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return {
    jsHeapUsedMB: Math.round((m.JSHeapUsedSize / 1048576) * 10) / 10,
    jsHeapTotalMB: Math.round((m.JSHeapTotalSize / 1048576) * 10) / 10,
    nodes: m.Nodes,
  };
}

async function gpu(page) {
  return page.evaluate(() => {
    const board = window.catan?.board;
    const app = board?.app;
    if (!app) return null;
    const r = app.renderer;
    const list = r.texture?.managedTextures ?? [];
    let bytes = 0;
    let biggest = 0;
    for (const t of list) {
      const b = (t.pixelWidth || 0) * (t.pixelHeight || 0) * 4;
      bytes += b;
      biggest = Math.max(biggest, b);
    }
    const gl = r.gl;
    return {
      textures: list.length,
      textureMB: Math.round((bytes / 1048576) * 10) / 10,
      biggestTextureMB: Math.round((biggest / 1048576) * 10) / 10,
      canvas: `${app.canvas.width}x${app.canvas.height}`,
      resolution: r.resolution,
      antialias: gl ? gl.getContextAttributes().antialias : null,
    };
  });
}

// ---------------------------------------------------------------------------

async function loadTest(browser) {
  const { page, cdp, errors, ctx } = await newPage(browser, { throttleNet: true });
  const bytes = {};
  const types = new Map();
  cdp.on('Network.responseReceived', (e) => types.set(e.requestId, e.type));
  cdp.on('Network.loadingFinished', (e) => {
    const t = types.get(e.requestId) ?? 'Other';
    bytes[t] = (bytes[t] ?? 0) + e.encodedDataLength;
  });
  await page.goto(`${BASE}/`, { waitUntil: 'commit' });
  await page.waitForSelector('[data-k="offline"]', { timeout: 120_000 });
  const home = await page.evaluate(() => performance.now());
  // Paint entries are reported a little after the paint: wait for them (at most 2 s).
  const paint = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const read = () =>
          Object.fromEntries(
            performance.getEntriesByType('paint').map((p) => [p.name, p.startTime]),
          );
        const t0 = performance.now();
        const poll = () => {
          const p = read();
          if (p['first-contentful-paint'] || performance.now() - t0 > 2000) resolve(p);
          else setTimeout(poll, 50);
        };
        poll();
      }),
  );
  const tClick = await page.evaluate(() => performance.now());
  await page.click('[data-k="offline"]');
  await page.waitForSelector('.setup [data-k="start"]', { timeout: 60_000 });
  await page.evaluate(() => window.__perf.nextFrame());
  const setup = (await page.evaluate(() => performance.now())) - tClick;
  const tStart = await page.evaluate(() => performance.now());
  await page.click('.setup [data-k="start"]');
  await page.waitForFunction(() => document.querySelector('.hud-side .sec-players'), null, {
    timeout: 60_000,
  });
  await page.evaluate(() => window.__perf.nextFrame());
  const board = (await page.evaluate(() => performance.now())) - tStart;
  await page.waitForTimeout(3000); // lazy chunks after the start
  const kb = Object.fromEntries(
    Object.entries(bytes).map(([k, v]) => [k, Math.round(v / 102.4) / 10]),
  );
  kb.total = Math.round(Object.values(bytes).reduce((a, b) => a + b, 0) / 102.4) / 10;
  const out = {
    transferKB: kb,
    firstPaint: Math.round(paint['first-paint'] ?? NaN),
    firstContentfulPaint: Math.round(paint['first-contentful-paint'] ?? NaN),
    homeReady: Math.round(home),
    offlineToSetup: Math.round(setup),
    startToBoard: Math.round(board),
    longTasks: stats(await page.evaluate(() => window.__perf.longtasks.map((t) => t.duration))),
    errors,
  };
  await ctx.close();
  return out;
}

// ---------------------------------------------------------------------------

/** Click a board id where the board draws it. */
async function clickId(page, id) {
  const p = await page.evaluate((i) => window.__catanDebug.screenPos(i), id);
  if (!p) throw new Error(`no screen position for ${id}`);
  await page.mouse.click(p.x, p.y);
}

const target = (a) => a.vertex ?? a.edge ?? a.hex ?? null;

async function dismissCover(page) {
  const btn = await page.$('.cover .btn-primary');
  if (btn) {
    await label(page, 'cover');
    await btn.click();
  }
}

/** Wait until seat 0 may act (or the game ended). */
async function waitHuman(page, ms = 60_000) {
  await page.waitForFunction(
    () => {
      const s = window.__catanDebug.state();
      return s && (s.phase.kind === 'gameOver' || window.__catanDebug.legal(0).length > 0);
    },
    null,
    { timeout: ms, polling: 100 },
  );
}

async function settle(page) {
  await page.evaluate(() => window.__perf.nextFrame());
  await page.waitForTimeout(150);
}

/** `--profile-clicks` (use an unminified build): JS inclusive time per function, per click label. */
const PROFILE = args.includes('--profile-clicks');
const clickProfiles = {};
async function profiled(cdp, page, what, fn) {
  if (!PROFILE) return fn();
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  await fn();
  const { profile } = await cdp.send('Profiler.stop');
  const dir = flag('--profile-dir', null);
  if (dir) writeFileSync(`${dir}/${what}-${Date.now()}.cpuprofile`, JSON.stringify(profile));
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const acc = (clickProfiles[what] ??= new Map());
  profile.samples.forEach((s, i) => {
    const seen = new Set();
    for (let id = s; id !== undefined; id = parent.get(id)) {
      const cf = byId.get(id).callFrame;
      if (!cf.url && !cf.functionName.startsWith('get ')) continue;
      const k = `${cf.functionName || '(anon)'}:${cf.lineNumber + 1}`;
      if (seen.has(k)) continue;
      seen.add(k);
      acc.set(k, (acc.get(k) ?? 0) + (profile.timeDeltas[i + 1] ?? 0) / 1000);
    }
  });
}

/** One human decision through real clicks; returns false at game over. */
async function humanStep(page, turns, cdp) {
  const run = (what, fn) => profiled(cdp, page, what, fn);
  await dismissCover(page);
  const legal = await page.evaluate(() => window.__catanDebug.legal(0));
  const state = await page.evaluate(() => {
    const s = window.__catanDebug.state();
    return { phase: s.phase.kind, turn: s.turn.number };
  });
  if (state.phase === 'gameOver' || legal.length === 0) return false;
  const of = (t) => legal.filter((a) => a.type === t);
  if (of('placeSetupSettlement').length || of('placeSetupRoad').length) {
    const a = of('placeSetupSettlement')[0] ?? of('placeSetupRoad')[0];
    await label(page, 'setup-place');
    await run('setup-place', () => clickId(page, target(a)).then(() => settle(page)));
  } else if (of('rollDice').length) {
    await label(page, 'roll');
    await run('roll', () => page.click('button.btn-roll').then(() => settle(page)));
  } else if (of('moveRobber').length) {
    await label(page, 'robber');
    await run('robber', () => clickId(page, of('moveRobber')[0].hex).then(() => settle(page)));
  } else if (state.phase === 'main' && (of('buildSettlement')[0] || of('buildRoad')[0])) {
    const a = of('buildCity')[0] ?? of('buildSettlement')[0] ?? of('buildRoad')[0];
    await label(page, 'build-spot');
    await run('build-spot', () => clickId(page, target(a)).then(() => settle(page)));
    const confirm = await page.$('[data-k="spot-build"]');
    if (confirm) {
      await label(page, 'build-confirm');
      await run('build-confirm', () => confirm.click().then(() => settle(page)));
    }
  } else if (state.phase === 'main' && of('endTurn').length) {
    await label(page, 'end-turn');
    await run('end-turn', () => page.click('button.btn-end').then(() => settle(page)));
    turns.n++;
  } else {
    // Anything else (discard, steal, trade replies): straight to the controller, not timed.
    await label(page, 'other');
    await page.evaluate((a) => window.catan.controller.dispatch(a), legal[0]);
  }
  await settle(page);
  await label(page, 'bots');
  return true;
}

async function panZoom(page) {
  await label(page, 'pan');
  const cx = vw * 0.45;
  const cy = vh * 0.45;
  await page.evaluate(() => window.__perf.startFrames());
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(cx + Math.sin(i / 6) * 120, cy + Math.cos(i / 9) * 60);
  }
  await page.mouse.up();
  const pan = await page.evaluate(() => window.__perf.stopFrames());
  await label(page, 'zoom');
  await page.evaluate(() => window.__perf.startFrames());
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, i < 15 ? -60 : 60);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  const zoom = await page.evaluate(() => window.__perf.stopFrames());
  await page.mouse.dblclick(cx, cy); // refit
  await settle(page);
  // The first interval waits for the gesture to start; drop it.
  const ft = (f) => {
    const s = stats(f.slice(1));
    s.over33 = f.slice(1).filter((x) => x > 33.4).length;
    return s;
  };
  return { pan: ft(pan), zoom: ft(zoom) };
}

async function gameTest(browser) {
  const { page, cdp, errors, ctx } = await newPage(browser);
  const t0 = Date.now();
  await page.goto(`${BASE}/?seed=perf-17&seats=hbbb&first=0&speed=300&debug=1&levels=nnnn`);
  await page.waitForFunction(() => window.__catanDebug?.state(), null, { timeout: 60_000 });
  await settle(page);
  const turns = { n: 0 };
  let panzoom = null;
  let memStart = null;
  while (turns.n < TURNS && Date.now() - t0 < 600_000) {
    await waitHuman(page);
    if (!memStart && (await page.evaluate(() => window.__catanDebug.state().turn.number)) >= 1) {
      memStart = await heap(cdp);
      panzoom = await panZoom(page);
    }
    if (!(await humanStep(page, turns, cdp))) break;
  }
  if (PROFILE) {
    for (const [what, acc] of Object.entries(clickProfiles)) {
      const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 30);
      console.error(`--- ${what}: JS inclusive ms (all clicks summed)`);
      for (const [k, v] of top) console.error(`${v.toFixed(1).padStart(8)}  ${k}`);
    }
  }
  const P = await page.evaluate(() => {
    const p = window.__perf;
    return { events: p.events, loafs: p.loafs, longtasks: p.longtasks };
  });
  // Interaction latency: the slowest event of each interaction, by label.
  const byInteraction = new Map();
  for (const e of P.events) {
    const cur = byInteraction.get(e.id);
    if (!cur || e.duration > cur.duration) byInteraction.set(e.id, e);
  }
  const inter = {};
  for (const e of byInteraction.values()) (inter[e.label] ??= []).push(e);
  const interactions = Object.fromEntries(
    Object.entries(inter).map(([k, v]) => [
      k,
      {
        ...stats(v.map((e) => e.duration)),
        processing: stats(v.map((e) => e.processing)).median,
        present: stats(v.map((e) => e.present)).median,
      },
    ]),
  );
  const botLoafs = P.loafs.filter((l) => l.label === 'bots');
  const botTasks = P.longtasks.filter((l) => l.label === 'bots');
  const scripts = {};
  for (const l of botLoafs)
    for (const s of l.scripts) {
      const k = `${s.inv} ${s.fn}@${s.url}:${s.pos}`;
      scripts[k] = (scripts[k] ?? 0) + s.d;
    }
  const topScripts = Object.entries(scripts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `${Math.round(v)} ms ${k}`);
  const out = {
    interactions,
    botTurns: {
      longAnimationFrames: stats(botLoafs.map((l) => l.duration)),
      framePhases: {
        tasks: stats(botLoafs.map((l) => l.tasks)).median,
        raf: stats(botLoafs.map((l) => l.raf)).median,
        render: stats(botLoafs.map((l) => l.render)).median,
      },
      interactionFramePhases: Object.fromEntries(
        Object.entries(
          Object.groupBy(
            P.loafs.filter((l) => !['bots', 'boot', 'pan', 'zoom'].includes(l.label)),
            (l) => l.label,
          ),
        ).map(([k, v]) => [
          k,
          {
            tasks: stats(v.map((l) => l.tasks)).max,
            raf: stats(v.map((l) => l.raf)).max,
            render: stats(v.map((l) => l.render)).max,
          },
        ]),
      ),
      longTasks: stats(botTasks.map((l) => l.duration)),
      over100: botTasks.filter((l) => l.duration > 100).length,
      topScripts,
    },
    panzoom,
    heapStart: memStart,
    heapEnd: await heap(cdp),
    gpu: await gpu(page),
    turnsPlayed: await page.evaluate(() => window.__catanDebug.state().turn.number),
    errors,
  };
  if (args.includes('--shot')) await page.screenshot({ path: flag('--shot') });
  await ctx.close();
  return out;
}

// ---------------------------------------------------------------------------

async function onlineTest(browser) {
  const { page, cdp, errors, ctx } = await newPage(browser);
  await page.goto(`${BASE}/?server=local`);
  await page.waitForSelector('[data-k="create"]', { timeout: 60_000 });
  await page.fill('[data-k="nickname"]', 'Ann');
  const t0 = await page.evaluate(() => performance.now());
  await page.click('[data-k="create"]');
  await page.waitForSelector('.ol-lobby', { timeout: 60_000 });
  await page.evaluate(() => window.__perf.nextFrame());
  const lobby = (await page.evaluate(() => performance.now())) - t0;
  // Start with the lobby's default seats (the host and bots).
  await page.waitForSelector('[data-k="lobby-start"]:not([disabled])', { timeout: 30_000 });
  const t1 = await page.evaluate(() => performance.now());
  await page.click('[data-k="lobby-start"]');
  await page.waitForSelector('.hud-side .sec-players', { timeout: 60_000 });
  await page.evaluate(() => window.__perf.nextFrame());
  const start = (await page.evaluate(() => performance.now())) - t1;
  await label(page, 'online');
  // Play our own turns through the client while the server's bots play theirs.
  const tEnd = Date.now() + 45_000;
  while (Date.now() < tEnd) {
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const c = window.catan?.online?.roomClient;
      const g = c?.game;
      const me = g?.view?.view?.viewer;
      if (!g || me === null || me === undefined) return;
      const mine = g.legal.filter((a) => a.player === me);
      const pick =
        mine.find((a) => a.type === 'placeSetupSettlement' || a.type === 'placeSetupRoad') ??
        mine.find((a) => a.type === 'rollDice') ??
        mine.find((a) => a.type === 'buildRoad' || a.type === 'buildSettlement') ??
        mine.find((a) => a.type === 'endTurn') ??
        mine[0];
      if (pick) c.intent(pick);
    });
  }
  const msgs = await page.evaluate(() => window.__perf.msgs);
  const loafs = await page.evaluate(() =>
    window.__perf.loafs.filter((l) => l.label === 'online').map((l) => l.duration),
  );
  const out = {
    createToLobby: Math.round(lobby),
    startToBoard: Math.round(start),
    gameMessages: {
      handler: stats(msgs.map((m) => m.handler)),
      toFrame: stats(msgs.filter((m) => m.toFrame !== null).map((m) => m.toFrame)),
      kB: stats(msgs.map((m) => m.bytes / 1024)),
    },
    longAnimationFrames: stats(loafs),
    heap: await heap(cdp),
    errors,
  };
  await ctx.close();
  return out;
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const result = { base: BASE, cpu: CPU, viewport: `${vw}x${vh}@${dpr}`, perf: PERF ?? 'default' };
try {
  if (ONLY.includes('load')) result.load = await loadTest(browser);
  if (ONLY.includes('game')) result.game = await gameTest(browser);
  if (ONLY.includes('online')) result.online = await onlineTest(browser);
} finally {
  await browser.close();
}
const text = JSON.stringify(result, null, 2);
console.log(text);
if (JSON_OUT) writeFileSync(JSON_OUT, text);
