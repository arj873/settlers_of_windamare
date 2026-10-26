/**
 * Playtest session server:
 *   `pnpm pt:serve [--seats 3..8] [--map base|baseRandom|base56|base78] [--seed S] [--vp N]
 *    [--timer SEC] [--headed]`
 *
 * Builds the app, serves it with `vite preview`, opens ONE Chromium page with an all-human
 * hotseat game (Seat1..SeatN, `?debug=1`) and keeps running. Headless by default (CI);
 * `--headed` opens a visible 1600x1000 window so a human can watch the agents play live. Short-lived `pnpm pt <seat> <cmd>` calls
 * talk to it over HTTP on 127.0.0.1 (port in playtest/session.json). Commands run one at a time.
 * Acting commands click the real UI (mouse on the canvas, buttons by locator); state is only read.
 */
import { createServer, type IncomingMessage } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { chromium, type Page } from 'playwright';
import { build, preview } from 'vite';
import type { GameState, PlayerId } from '../../src/engine';
import { formatLogEntry, formatStatus } from './format';
import { actingVerdict, newLogEntries, wakeReason, waitingOn } from './guard';
import {
  BUGS_DIR,
  PLAYTEST_DIR,
  REPO_ROOT,
  SESSION_FILE,
  SHOTS_DIR,
  type CommandRequest,
  type CommandResponse,
  type SessionInfo,
  type Snapshot,
} from './protocol';
import { serveOptions } from './options';
import { describeId, listSpots, SPOT_VERB } from './spots';
import { matchChoice, parseFlags, slugify } from './text';

const SEVERITIES = ['blocker', 'major', 'minor', 'visual'] as const;
const OUT_DIR = join(PLAYTEST_DIR, 'dist');
const SETTLE_MS = 350;
const VIEWPORT = { width: 1600, height: 1000 };

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const parsed = serveOptions(
  parseFlags(process.argv.slice(2)).flags,
  `pt-${Date.now().toString(36)}`,
);
if ('error' in parsed) {
  console.error(parsed.error);
  process.exit(1);
}
const opts = parsed;
const { seed, vp } = opts;
if (existsSync(SESSION_FILE)) {
  const old = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as SessionInfo;
  if (alive(old.pid)) {
    console.error(`A session is already running (pid ${old.pid}). Stop it with: pnpm pt stop`);
    process.exit(1);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Console capture (server side, so uncaught page errors are seen too)
// ---------------------------------------------------------------------------

interface ConsoleRecord {
  n: number;
  level: string;
  text: string;
  at: string;
}
const consoleLog: ConsoleRecord[] = [];
/** Per seat: how many console records that seat has already seen via `console`. */
const consoleCursor = new Map<PlayerId, number>();

/** Headless-GPU chatter, not app bugs: hidden so player agents do not report it. */
const CONSOLE_NOISE = [/GL Driver Message/, /GPU stall due to ReadPixels/];

function recordConsole(level: string, text: string) {
  if (CONSOLE_NOISE.some((re) => re.test(text))) return;
  consoleLog.push({ n: consoleLog.length + 1, level, text, at: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

let page: Page;

async function snapshot(): Promise<Snapshot> {
  const snap = (await page.evaluate('window.__pt.snapshot()')) as Snapshot;
  snap.consoleCount = consoleLog.length;
  return snap;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const seatName = (seat: PlayerId) => `Seat${seat + 1}`;

/** One-line view of where the game is, from `seat`'s point of view. */
function nowLine(snap: Snapshot, seat: PlayerId): string {
  const why = wakeReason(snap, seat);
  return why ?? `Not your moment any more (${waitingOn(snap)}). Run \`wait\`.`;
}

/** Wait for the UI to settle after a click, then describe what changed. */
async function afterAction(before: Snapshot, seat: PlayerId, did: string): Promise<string> {
  await sleep(SETTLE_MS);
  const after = await snapshot();
  const lines = [`OK: ${did}`];
  const prev = before.state;
  const next = after.state;
  if (prev && next) {
    const fresh = newLogEntries(prev.log, next.log);
    if (fresh.length > 0) {
      lines.push('New log:');
      for (const e of fresh) lines.push(formatLogEntry(next, e));
    } else if (JSON.stringify(prev) === JSON.stringify(next)) {
      lines.push('(no game action happened; screen-only change)');
    }
  }
  const toasts = after.ui.toasts.filter((t) => !before.ui.toasts.includes(t));
  if (toasts.length > 0) lines.push(`Toasts: ${toasts.map((t) => `"${t}"`).join(' ')}`);
  if (after.consoleCount > before.consoleCount) {
    lines.push(
      `Console: ${after.consoleCount - before.consoleCount} new error(s) — run \`console\`.`,
    );
  }
  if (after.viewer === seat && !after.ui.cover && after.ui.hint) {
    lines.push(`Prompt: "${after.ui.hint}"`);
  }
  if (after.ui.dialogTitle && after.viewer === seat) {
    lines.push(`Dialog open: "${after.ui.dialogTitle}" (see \`status\`)`);
  }
  lines.push(`Now: ${nowLine(after, seat)}`);
  return lines.join('\n');
}

function refuse(reason: string): CommandResponse {
  return { out: `REFUSED: ${reason}` };
}

async function guarded(seat: PlayerId, cmd: 'act' | 'pass'): Promise<Snapshot | string> {
  const snap = await snapshot();
  const v = actingVerdict(snap, seat, cmd);
  return v.ok ? snap : v.reason;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

type Handler = (
  seat: PlayerId,
  args: string[],
  flags: Record<string, string>,
) => Promise<CommandResponse>;

/** Spot ids last listed per seat; click-spot refuses if the list changed since. */
const lastSpots = new Map<PlayerId, string[]>();

async function clickBoardId(before: Snapshot, seat: PlayerId, id: string, what: string) {
  const pos = (await page.evaluate(`window.__catanDebug.screenPos(${JSON.stringify(id)})`)) as {
    x: number;
    y: number;
  } | null;
  if (!pos) return refuse(`${id} is not a board id.`);
  const vpSize = page.viewportSize() ?? { width: 0, height: 0 };
  if (pos.x < 0 || pos.y < 0 || pos.x > vpSize.width || pos.y > vpSize.height) {
    return refuse(`${id} is off-screen at (${Math.round(pos.x)}, ${Math.round(pos.y)}).`);
  }
  const top = (await page.evaluate(`window.__pt.topAt(${pos.x}, ${pos.y})`)) as string;
  if (top !== 'canvas') {
    return refuse(
      `${id} is hidden under a HUD element (${top}), so a player could not click it. ` +
        'If a dialog is open, close it; otherwise this may be a bug worth reporting (take a `shot`).',
    );
  }
  await page.mouse.click(pos.x, pos.y);
  return {
    out: await afterAction(
      before,
      seat,
      `clicked ${what} at (${Math.round(pos.x)}, ${Math.round(pos.y)})`,
    ),
  };
}

const commands: Record<string, Handler> = {
  async probe(seat) {
    const snap = await snapshot();
    const why = wakeReason(snap, seat);
    return { out: why ?? waitingOn(snap), ready: why !== null };
  },

  async status(seat) {
    const snap = await snapshot();
    const fresh = consoleLog.length - (consoleCursor.get(seat) ?? 0);
    return { out: formatStatus(snap, seat, fresh) };
  },

  async spots(seat) {
    const snap = await snapshot();
    const state = snap.state;
    if (!state) return refuse('The game has not loaded yet.');
    if (snap.viewer !== seat) return refuse(`Not your moment: ${waitingOn(snap)}.`);
    const spots = listSpots(state, snap.targets, seat);
    lastSpots.set(
      seat,
      spots.map((s) => s.id),
    );
    if (spots.length === 0) {
      return {
        out:
          'No board spots to click right now. To build, first click a build button ' +
          '(`click Road`, `click Settlement`, `click City`), then run `spots` again.',
      };
    }
    const verb = SPOT_VERB[snap.targets[0]?.type ?? 'endTurn'] ?? 'click';
    const lines = [`${spots.length} spot(s) to ${verb}. Use \`click-spot N\`:`];
    for (const s of spots) lines.push(`  ${s.n}. ${s.id}  ${s.text}`);
    return { out: lines.join('\n') };
  },

  async 'click-spot'(seat, args) {
    const n = Number(args[0]);
    const snap = await guarded(seat, 'act');
    if (typeof snap === 'string') return refuse(snap);
    const state = snap.state as GameState;
    const spots = listSpots(state, snap.targets, seat);
    const listed = lastSpots.get(seat);
    if (!listed || listed.join() !== spots.map((s) => s.id).join()) {
      return refuse('The spot list changed (or you have not run `spots` yet). Run `spots` again.');
    }
    const spot = spots[n - 1];
    if (!Number.isInteger(n) || !spot) return refuse(`Pick a number from 1 to ${spots.length}.`);
    return clickBoardId(snap, seat, spot.id, `spot ${n} (${spot.id}: ${spot.text})`);
  },

  async 'click-board'(seat, args) {
    const id = args[0] ?? '';
    const snap = await guarded(seat, 'act');
    if (typeof snap === 'string') return refuse(snap);
    const desc = describeId(snap.state as GameState, id, seat);
    if (desc === null)
      return refuse(`"${id}" is not a vertex (v:..), edge (e:..) or hex (h:..) id.`);
    const isTarget = snap.targets.some(
      (a) =>
        ('vertex' in a && a.vertex === id) ||
        ('edge' in a && a.edge === id) ||
        ('hex' in a && a.hex === id),
    );
    const res = await clickBoardId(snap, seat, id, `${id} (${desc})`);
    if (!isTarget)
      res.out += '\n(note: that id was not a highlighted target, so nothing should happen)';
    return res;
  },

  async click(seat, args) {
    const query = args.join(' ').trim();
    if (!query) return refuse('Say which button, e.g. `click Roll dice`.');
    const snap = await guarded(seat, 'act');
    if (typeof snap === 'string') return refuse(snap);
    const controls = snap.ui.controls;
    const enabled = controls.filter((c) => c.enabled);
    const m = matchChoice(
      query,
      enabled.map((c) => c.label),
      (i) => enabled[i]?.inDialog === true,
    );
    if (m.kind === 'many') {
      const list = m.indices.map((i) => `[${enabled[i]?.label}]`).join(' ');
      return refuse(`"${query}" matches several buttons: ${list}. Use the full label.`);
    }
    if (m.kind === 'none') {
      const off = matchChoice(
        query,
        controls.filter((c) => !c.enabled).map((c) => c.label),
      );
      if (off.kind !== 'none')
        return refuse(`That button is disabled right now. ${listButtons(snap)}`);
      return refuse(`No button matches "${query}". ${listButtons(snap)}`);
    }
    const c = enabled[m.index];
    if (!c) return refuse('internal: match out of range');
    try {
      await page.locator(`[data-pt="${c.id}"]`).click({ timeout: 3000 });
    } catch (e) {
      return refuse(
        `Could not click [${c.label}]: ${String(e).split('\n')[0]}. It may be covered by something — take a \`shot\`; this may be a bug.`,
      );
    }
    return { out: await afterAction(snap, seat, `clicked [${c.label}]`) };
  },

  async set(seat, args) {
    const target = Number(args.at(-1));
    const query = args.slice(0, -1).join(' ').trim();
    if (!query || !Number.isInteger(target) || target < 0) {
      return refuse('Usage: `set <label> <count>`, e.g. `set brick 2` or `set give wool 1`.');
    }
    let snap = await guarded(seat, 'act');
    if (typeof snap === 'string') return refuse(snap);
    const first = snap;
    const labels = snap.ui.steppers.map((s) => s.label);
    if (labels.length === 0)
      return refuse('No steppers are showing. Open the dialog first (e.g. `click Trade`).');
    const m = matchChoice(query, labels);
    if (m.kind === 'many') {
      return refuse(`"${query}" matches several: ${m.indices.map((i) => labels[i]).join(', ')}.`);
    }
    if (m.kind === 'none') return refuse(`No stepper "${query}". Steppers: ${labels.join(', ')}.`);
    const label = labels[m.index] as string;
    for (let i = 0; i < 40; i++) {
      const s = snap.ui.steppers.find((x) => x.label === label);
      if (!s) return refuse(`The "${label}" stepper disappeared.`);
      if (s.value === target) break;
      const up = s.value < target;
      const id = up ? s.incId : s.decId;
      if (!id || !(up ? s.canInc : s.canDec)) {
        const res = await afterAction(first, seat, `${label} stopped at ${s.value}`);
        return {
          out: `${res}\nNOTE: the ${up ? '+' : '−'} button is disabled at ${s.value}, so ${target} is not allowed here.`,
        };
      }
      await page.locator(`[data-pt="${id}"]`).click({ timeout: 3000 });
      snap = await snapshot();
    }
    const after = snap.ui.steppers.find((x) => x.label === label);
    return { out: await afterAction(first, seat, `${label} = ${after?.value ?? '?'}`) };
  },

  async pass(seat) {
    const snap = await guarded(seat, 'pass');
    if (typeof snap === 'string') return refuse(snap);
    const btn = snap.ui.controls.find((c) => c.enabled && /show my cards/i.test(c.label));
    if (!btn)
      return refuse('The cover is up but its button was not found. Take a `shot` and report this.');
    await page.locator(`[data-pt="${btn.id}"]`).click({ timeout: 3000 });
    return { out: await afterAction(snap, seat, `dismissed the cover ("${snap.ui.cover}")`) };
  },

  async shot(seat, args) {
    const mode = args[0] ?? 'full';
    if (!['board', 'hud', 'full'].includes(mode)) return refuse('Usage: `shot [board|hud|full]`.');
    const file = await screenshot(SHOTS_DIR, `seat${seat + 1}-${nextShotNumber(seat)}`, mode);
    return { out: `Saved ${relative(REPO_ROOT, file)} (${mode}). Open it to look.` };
  },

  async console(seat) {
    const fresh = consoleLog.slice(consoleCursor.get(seat) ?? 0);
    consoleCursor.set(seat, consoleLog.length);
    if (fresh.length === 0) return { out: 'No new console errors or warnings.' };
    return {
      out: fresh.map((c) => `#${c.n} [${c.level}] ${c.text.slice(0, 600)}`).join('\n'),
    };
  },

  async report(seat, _args, f) {
    const severity = (f.severity ?? '').toLowerCase();
    if (!f.title) return refuse('A report needs --title "...".');
    if (!(SEVERITIES as readonly string[]).includes(severity)) {
      return refuse(`--severity must be one of: ${SEVERITIES.join(', ')}.`);
    }
    const snap = await snapshot();
    const state = snap.state;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const base = `${stamp}-seat${seat + 1}-${slugify(f.title)}`;
    mkdirSync(BUGS_DIR, { recursive: true });
    const shotFile = await screenshot(BUGS_DIR, base, 'full');
    const stateFile = join(BUGS_DIR, `${base}.state.json`);
    writeFileSync(stateFile, JSON.stringify(snap, null, 2));
    const log = state ? state.log.slice(-20).map((e) => formatLogEntry(state, e)) : [];
    const errs = consoleLog.slice(-20).map((c) => `#${c.n} [${c.level}] ${c.text.slice(0, 800)}`);
    const where = state
      ? `turn ${state.turn.number}, phase ${state.phase.kind}, current player ${state.players[state.turn.current]?.name}`
      : 'game not loaded';
    const md = [
      `# ${f.title}`,
      '',
      `- Severity: **${severity}**`,
      `- Reporter: ${seatName(seat)} (seat ${seat + 1})`,
      `- When: ${new Date().toISOString()} — ${where}`,
      `- Session: ${opts.seats} seats, seed \`${seed}\`, map ${opts.map ?? 'default'}, vp ${vp ?? 'default'}`,
      '',
      '## Steps to reproduce',
      '',
      f.steps || '_(not given)_',
      '',
      '## Expected',
      '',
      f.expected || '_(not given)_',
      '',
      '## Actual',
      '',
      f.actual || '_(not given)_',
      '',
      '## Evidence',
      '',
      `- Screenshot: \`${relative(REPO_ROOT, shotFile)}\``,
      `- Snapshot (state, legal actions, UI scan): \`${relative(REPO_ROOT, stateFile)}\``,
      '',
      '### Reporter status at report time',
      '',
      '```',
      formatStatus(snap, seat, 0),
      '```',
      '',
      '### Last 20 log lines',
      '',
      '```',
      ...(log.length > 0 ? log : ['(empty)']),
      '```',
      '',
      '### Console errors / warnings (last 20)',
      '',
      '```',
      ...(errs.length > 0 ? errs : ['(none)']),
      '```',
      '',
    ].join('\n');
    const mdFile = join(BUGS_DIR, `${base}.md`);
    writeFileSync(mdFile, md);
    return {
      out: `Report saved: ${relative(REPO_ROOT, mdFile)}\nScreenshot: ${relative(REPO_ROOT, shotFile)}`,
    };
  },
};

function listButtons(snap: Snapshot): string {
  const on = snap.ui.controls.filter((c) => c.enabled).map((c) => `[${c.label}]`);
  return `Enabled buttons: ${on.join(' ') || 'none'}.`;
}

function nextShotNumber(seat: PlayerId): string {
  mkdirSync(SHOTS_DIR, { recursive: true });
  const prefix = `seat${seat + 1}-`;
  const nums = readdirSync(SHOTS_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.png'))
    .map((f) => Number(f.slice(prefix.length, -4)) || 0);
  return String(Math.max(0, ...nums) + 1).padStart(3, '0');
}

async function screenshot(dir: string, base: string, mode: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${base}.png`);
  if (mode === 'board') {
    await page.evaluate(`document.getElementById('ui').style.visibility = 'hidden'`);
    try {
      await page.screenshot({ path: file });
    } finally {
      await page.evaluate(`document.getElementById('ui').style.visibility = ''`);
    }
  } else if (mode === 'hud') {
    const dialog = page.locator('.hud-dialog-layer .dialog');
    const target = (await dialog.count()) > 0 ? dialog.first() : page.locator('.hud-bottom');
    if ((await target.count()) > 0 && (await target.isVisible()))
      await target.screenshot({ path: file });
    else await page.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file });
  }
  return file;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  mkdirSync(PLAYTEST_DIR, { recursive: true });
  console.log('Building the app…');
  await build({
    root: REPO_ROOT,
    logLevel: 'warn',
    build: { outDir: OUT_DIR, emptyOutDir: true },
  });
  const server = await preview({
    root: REPO_ROOT,
    logLevel: 'warn',
    build: { outDir: OUT_DIR },
    preview: { host: '127.0.0.1', port: 4319, strictPort: false, open: false },
  });
  const appUrl = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:4319/';

  // Same page size headed or not, so screenshots and click positions match what a watcher sees.
  const browser = await chromium.launch({
    headless: !opts.headed,
    ...(opts.headed ? { args: [`--window-size=${VIEWPORT.width},${VIEWPORT.height + 100}`] } : {}),
  });
  const context = await browser.newContext({ viewport: VIEWPORT });
  page = await context.newPage();
  await page.addInitScript({ path: join(REPO_ROOT, 'scripts', 'playtest', 'inpage.js') });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') recordConsole(m.type(), m.text());
  });
  page.on('pageerror', (e) => recordConsole('pageerror', e.stack ?? e.message));
  page.on('crash', () => recordConsole('crash', 'The page crashed.'));

  const gameUrl = `${appUrl}?${new URLSearchParams(opts.query).toString()}`;
  await page.goto(gameUrl);
  await page.waitForFunction('window.__catanDebug && window.__catanDebug.state() !== null', null, {
    timeout: 20000,
  });
  // Builds without 5-8 player support ignore `?seats=` longer than they know: fail loudly.
  const loaded = (await snapshot()).state;
  const got = loaded?.players.length ?? 0;
  if (got !== opts.seats || loaded?.players.some((p, i) => p.name !== `Seat${i + 1}`)) {
    await browser.close();
    await server.close();
    throw new Error(
      `Asked for ${opts.seats} seats but the app started ${got} (${loaded?.players.map((p) => p.name).join(', ')}). ` +
        'This build probably does not support that many players yet; try --seats 3 or 4.',
    );
  }
  if (opts.map && !['base', 'baseRandom'].includes(opts.map)) {
    console.log(
      `Note: passed ?map=${opts.map}; builds that do not know it fall back to a random board.`,
    );
  }

  // One command at a time: every request is chained onto this promise.
  let queue: Promise<unknown> = Promise.resolve();
  const http = createServer((req, res) => {
    const reply = (status: number, body: CommandResponse) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || req.url !== '/cmd') return reply(404, { out: 'not found' });
    void readBody(req).then((raw) => {
      let body: CommandRequest;
      try {
        body = JSON.parse(raw) as CommandRequest;
      } catch {
        return reply(400, { out: 'bad JSON' });
      }
      if (body.cmd === 'stop') {
        reply(200, { out: 'Stopping the playtest session.' });
        void shutdown();
        return;
      }
      const handler = commands[body.cmd];
      if (!handler) return reply(400, { out: `Unknown command "${body.cmd}".` });
      if (!Number.isInteger(body.seat) || body.seat < 0 || body.seat >= opts.seats) {
        return reply(400, { out: `This game has seats 1 to ${opts.seats}.` });
      }
      const job = queue.then(async () => {
        try {
          reply(200, await handler(body.seat, body.args, body.flags));
        } catch (e) {
          reply(500, { out: `HARNESS ERROR: ${e instanceof Error ? e.message : String(e)}` });
        }
      });
      queue = job;
    });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const addr = http.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  const info: SessionInfo = {
    port,
    pid: process.pid,
    appUrl: gameUrl,
    seats: opts.seats,
    map: opts.map,
    seed,
    vp,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(SESSION_FILE, JSON.stringify(info, null, 2));

  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    try {
      rmSync(SESSION_FILE, { force: true });
      http.close();
      await browser.close();
      await server.close();
    } finally {
      process.exit(0);
    }
  }
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  console.log(
    `Playtest session ready (${opts.seats} seats).\n  game: ${gameUrl}\n  command port: ${port}\n  seed: ${seed}`,
  );
  console.log(
    `Players: \`pnpm -s pt <1..${opts.seats}> help\`. Stop: \`pnpm -s pt stop\` or Ctrl+C.`,
  );
}

main().catch((e: unknown) => {
  console.error(e);
  rmSync(SESSION_FILE, { force: true });
  process.exit(1);
});
