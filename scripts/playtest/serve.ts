/**
 * Playtest session server:
 *   `pnpm pt:serve [--seats 3..8] [--map base|baseRandom|base56|base78] [--seed S] [--vp N]
 *    [--timer SEC] [--headed]`                       hotseat: ONE page, all seats
 *   `pnpm pt:serve --online --seats N [--bots B] [--map M] [--timer SEC] [--vp N] [--headed]
 *    [--remote URL] [--mode ck|seafarers|tb|ep|... [--scenario fogIslands]]`
 *                                                    online: one browser context per human seat
 *
 * Hotseat: builds the app, serves it with `vite preview`, opens ONE Chromium page with an
 * all-human game (Seat1..SeatN, `?debug=1`). Online: starts or reuses `pnpm dev:server` (wrangler
 * dev on :8787; `--remote URL` uses that room server instead), creates a room, joins Seat1..SeatN
 * each from its own browser context, adds B bots and starts. Headless by default (CI); `--headed`
 * opens visible 1600x1000 windows so a human can watch the agents play live. Short-lived
 * `pnpm pt <seat> <cmd>` calls talk to it over HTTP on 127.0.0.1 (port in playtest/session.json),
 * routed to that seat's page. Commands run one at a time. Acting commands click the real UI
 * (mouse on the canvas, buttons by locator); state is only read.
 */
import { createServer, type IncomingMessage } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { build, preview } from 'vite';
import type { Action, GameState, PlayerId } from '../../src/engine';
import { formatLogEntry, formatStatus } from './format';
import { actingVerdict, newLogEntries, staleTradeHint, wakeReason, waitingOn } from './guard';
import {
  BUGS_DIR,
  PLAYTEST_DIR,
  REPO_ROOT,
  SESSION_FILE,
  SHOTS_DIR,
  type CommandRequest,
  type CommandResponse,
  type Control,
  type SessionInfo,
  type Snapshot,
} from './protocol';
import { onlineOptions, serveOptions } from './options';
import { onlineOutcome, outcomeHeadline, type Outcome } from './outcome';
import { createAndStart, dropNetwork, restoreNetwork, roomServer, type RoomServer } from './online';
import { actionForClick, type BoardClick } from '../../src/game/logic';
import {
  actionName,
  describeId,
  formatSpots,
  listSpots,
  movesBehindButtons,
  spotKey,
  type Spot,
} from './spots';
import { matchChoice, matchControl, parseFlags, slugify } from './text';

const SEVERITIES = ['blocker', 'major', 'minor', 'visual'] as const;
const OUT_DIR = join(PLAYTEST_DIR, 'dist');
const SETTLE_MS = 350;
/** Online: longest wait for the server to answer a move (a busy machine can take seconds). */
const ONLINE_ANSWER_MS = 15_000;
const VIEWPORT = { width: 1600, height: 1000 };

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const flags = parseFlags(process.argv.slice(2)).flags;
const isOnline = 'online' in flags;
if (isOnline && 'seed' in flags) {
  console.error('--seed is not supported with --online (the room server picks the seed).');
  process.exit(1);
}
const hotOpts = isOnline ? null : serveOptions(flags, `pt-${Date.now().toString(36)}`);
const onlineOpts = isOnline ? onlineOptions(flags) : null;
const parsed = hotOpts ?? onlineOpts;
if (!parsed || 'error' in parsed) {
  console.error(parsed?.error ?? 'bad options');
  process.exit(1);
}
const hot = hotOpts && !('error' in hotOpts) ? hotOpts : null;
const onl = onlineOpts && !('error' in onlineOpts) ? onlineOpts : null;
/** Seats an agent can play (hotseat: all; online: the human seats). */
const humanSeats = onl ? onl.humans : (hot?.seats ?? 0);
const headed = parsed.headed;
const vp = parsed.vp;
const seed = hot?.seed ?? 'server';
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
// Per-seat page + console capture (server side, so uncaught page errors are seen too)
// ---------------------------------------------------------------------------

interface ConsoleRecord {
  n: number;
  level: string;
  text: string;
  at: string;
}

/** One browser page. Hotseat: every seat shares one; online: one per human seat. */
interface SeatCtx {
  page: Page;
  context: BrowserContext;
  consoleLog: ConsoleRecord[];
  /** Online: the network is cut by `drop` (connection errors are expected, not bugs). */
  dropped: boolean;
}
const ctxs: SeatCtx[] = [];
const ctxOf = (seat: PlayerId): SeatCtx => {
  const c = ctxs[seat];
  if (!c) throw new Error(`no browser page for seat ${seat + 1}`);
  return c;
};

/** Per seat: how many console records that seat has already seen via `console`. */
const consoleCursor = new Map<PlayerId, number>();

/** Headless-GPU chatter, not app bugs: hidden so player agents do not report it. */
const CONSOLE_NOISE = [/GL Driver Message/, /GPU stall due to ReadPixels/];
/** What a deliberately dropped connection logs. */
const DROP_NOISE = [
  /ERR_INTERNET_DISCONNECTED/,
  /WebSocket connection to .* failed/,
  /Failed to load resource/,
];

function recordConsole(ctx: SeatCtx, level: string, text: string) {
  if (CONSOLE_NOISE.some((re) => re.test(text))) return;
  if (ctx.dropped && DROP_NOISE.some((re) => re.test(text))) return;
  ctx.consoleLog.push({
    n: ctx.consoleLog.length + 1,
    level,
    text,
    at: new Date().toISOString(),
  });
}

function watchConsole(ctx: SeatCtx) {
  const { page } = ctx;
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') recordConsole(ctx, m.type(), m.text());
  });
  page.on('pageerror', (e) => recordConsole(ctx, 'pageerror', e.stack ?? e.message));
  page.on('crash', () => recordConsole(ctx, 'crash', 'The page crashed.'));
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

async function snapshot(seat: PlayerId): Promise<Snapshot> {
  const ctx = ctxOf(seat);
  const snap = (await ctx.page.evaluate('window.__pt.snapshot()')) as Snapshot;
  snap.consoleCount = ctx.consoleLog.length;
  return snap;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const seatName = (seat: PlayerId) => `Seat${seat + 1}`;

/** One-line view of where the game is, from `seat`'s point of view. */
function nowLine(snap: Snapshot, seat: PlayerId): string {
  const why = wakeReason(snap, seat);
  return why ?? `Not your moment any more (${waitingOn(snap)}). Run \`wait\`.`;
}

/**
 * Let the UI settle after a click. Online, a click that sent a move (the page counts what its
 * RoomClient sent) waits for the server's answer — a new game state or an error — for up to
 * ONLINE_ANSWER_MS; a click that sent nothing only settles. Null for hotseat.
 */
async function settle(seat: PlayerId, before: Snapshot): Promise<Outcome | null> {
  if (!isOnline || !before.online) {
    await sleep(SETTLE_MS);
    return null;
  }
  const until = Date.now() + ONLINE_ANSWER_MS;
  let outcome: Outcome = { kind: 'local' };
  for (;;) {
    const now = await snapshot(seat);
    outcome = now.online ? onlineOutcome(before.online, now.online) : outcome;
    if (outcome.kind !== 'pending' || Date.now() >= until) break;
    await sleep(150);
  }
  // A refusal can trail a state change by a moment; screen-only clicks need a re-render.
  await sleep(outcome.kind === 'pending' ? 0 : 250);
  const last = await snapshot(seat);
  return last.online ? onlineOutcome(before.online, last.online) : outcome;
}

/** Wait for the UI to settle after a click, then describe what changed. */
async function afterAction(before: Snapshot, seat: PlayerId, did: string): Promise<string> {
  const outcome = await settle(seat, before);
  const after = await snapshot(seat);
  if (after.state) seenLog.set(seat, after.state.log);
  const lines = [outcomeHeadline(outcome, did, ONLINE_ANSWER_MS / 1000)];
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
  if (after.online && after.online.status !== 'open') {
    lines.push(`Connection: ${after.online.status} — the click may not have reached the server.`);
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
  const snap = await snapshot(seat);
  const v = actingVerdict(snap, seat, cmd);
  return v.ok ? snap : v.reason;
}

interface ClickPoint {
  x: number;
  y: number;
  ok: boolean;
  cover: string | null;
}

/**
 * Click a tagged HUD element the way a player does: the real mouse at its centre, after
 * checking nothing covers that point. One page round trip plus the click, so it also works on a
 * slow, busy machine (Playwright's `locator.click` makes several round trips and timed out
 * there, sometimes after the click had already gone through). If the HUD re-rendered since the
 * scan (tags gone), `refind` rescans and returns the same element's new tag, or null if it is
 * gone. Returns an error text, or null once the click went out.
 */
async function press(
  seat: PlayerId,
  id: string,
  what: string,
  refind: () => Promise<string | null>,
): Promise<string | null> {
  const { page } = ctxOf(seat);
  let tag: string | null = id;
  for (let attempt = 0; attempt < 3 && tag; attempt++) {
    const p = (await page.evaluate(
      `window.__pt.pointFor(${JSON.stringify(tag)})`,
    )) as ClickPoint | null;
    if (p && !p.ok) {
      return `${what} is covered by ${p.cover}, so a player could not click it. Take a \`shot\`; this may be a bug.`;
    }
    if (p) return mouseClick(seat, p.x, p.y, what);
    tag = await refind();
  }
  return `${what} is gone: the screen changed before the click. Run \`status\`.`;
}

/** Longest wait for one mouse click to be delivered (a starved page can take seconds). */
const CLICK_MS = 30_000;

/**
 * The real mouse at (x, y). Resolves once the page has handled the click. On a page so busy
 * that even that times out, look before retrying: if a move went out or the game moved on, the
 * click landed; only an unchanged page gets one more click. Returns an error text or null.
 */
async function mouseClick(
  seat: PlayerId,
  x: number,
  y: number,
  what: string,
): Promise<string | null> {
  const { page } = ctxOf(seat);
  const before = await snapshot(seat);
  for (let attempt = 0; attempt < 2; attempt++) {
    const done = page.mouse.click(x, y).then(() => true);
    const late = sleep(CLICK_MS).then(() => false);
    if (await Promise.race([done, late])) return null;
    const now = await snapshot(seat);
    const changed =
      now.online?.sent !== before.online?.sent ||
      now.online?.seq !== before.online?.seq ||
      JSON.stringify(now.state) !== JSON.stringify(before.state);
    if (changed) return null;
  }
  return `the page did not take the click on ${what} within ${(2 * CLICK_MS) / 1000} s (it is very busy). Run \`status\`, then try again.`;
}

/** `press` a button from a scan; on a re-render finds it again by label (and position among equal labels). */
function pressControl(seat: PlayerId, snap: Snapshot, c: Control): Promise<string | null> {
  const same = (x: Control) => x.label === c.label && x.inDialog === c.inDialog;
  const nth = snap.ui.controls.filter(same).indexOf(c);
  return press(seat, c.id, `[${c.label}]`, async () => {
    const again = (await snapshot(seat)).ui.controls.filter(same)[nth];
    return again?.enabled ? again.id : null;
  });
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

/** Per seat: the log as of its last command, so `wait` can tell what happened meanwhile. */
const seenLog = new Map<PlayerId, GameState['log']>();
const MAX_WAKE_LOG = 30;

async function clickBoardId(before: Snapshot, seat: PlayerId, id: string, what: string) {
  const { page } = ctxOf(seat);
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
  const err = await mouseClick(seat, pos.x, pos.y, id);
  if (err) return refuse(err);
  return {
    out: await afterAction(
      before,
      seat,
      `clicked ${what} at (${Math.round(pos.x)}, ${Math.round(pos.y)})`,
    ),
  };
}

/** " (spot N)" for the listed spot of an action, if any. */
function spotOf(spots: readonly Spot[], a: Action): string {
  const s = spots.find((x) => JSON.stringify(x.action) === JSON.stringify(a));
  return s ? ` (spot ${s.n})` : '';
}

/** The page URL with the playtest hook on (`?debug=1`), as a reload target. */
function withDebug(url: string): string {
  const u = new URL(url);
  u.searchParams.set('debug', '1');
  return u.toString();
}

const onlineOnly = (what: string) => refuse(`\`${what}\` only exists in online games.`);

const commands: Record<string, Handler> = {
  async probe(seat) {
    const snap = await snapshot(seat);
    const why = wakeReason(snap, seat);
    if (why === null || !snap.state) return { out: waitingOn(snap), ready: false };
    // What happened while waiting (a barbarian attack, a robbery...): `status` shows only 8 lines.
    const state = snap.state;
    const seen = seenLog.get(seat);
    const fresh = seen ? newLogEntries(seen, state.log) : [];
    seenLog.set(seat, state.log);
    const lines = [why];
    if (fresh.length > 0) {
      const shown = fresh.slice(-MAX_WAKE_LOG);
      lines.push(
        `Since your last command${fresh.length > shown.length ? ` (last ${shown.length} of ${fresh.length})` : ''}:`,
      );
      for (const e of shown) lines.push(formatLogEntry(state, e));
    }
    return { out: lines.join('\n'), ready: true };
  },

  async status(seat) {
    const snap = await snapshot(seat);
    const fresh = ctxOf(seat).consoleLog.length - (consoleCursor.get(seat) ?? 0);
    return { out: formatStatus(snap, seat, fresh) };
  },

  async spots(seat) {
    const snap = await snapshot(seat);
    const state = snap.state;
    if (!state) return refuse('The game has not loaded yet.');
    if (snap.viewer !== seat) return refuse(`Not your moment: ${waitingOn(snap)}.`);
    const spots = listSpots(state, snap.targets, seat);
    lastSpots.set(seat, spots.map(spotKey));
    const behind = movesBehindButtons(state, snap.legal, snap.targets, snap.ui.controls, seat);
    return { out: formatSpots(state, spots, behind) };
  },

  async 'click-spot'(seat, args) {
    const n = Number(args[0]);
    const snap = await guarded(seat, 'act');
    if (typeof snap === 'string') return refuse(snap);
    const state = snap.state as GameState;
    const spots = listSpots(state, snap.targets, seat);
    const listed = lastSpots.get(seat);
    if (!listed || listed.join() !== spots.map(spotKey).join()) {
      return refuse('The spot list changed (or you have not run `spots` yet). Run `spots` again.');
    }
    const spot = spots[n - 1];
    if (!Number.isInteger(n) || !spot) return refuse(`Pick a number from 1 to ${spots.length}.`);
    const what = `spot ${n} (${spot.id}: ${spot.does})`;
    const at = { kind: spot.kind, id: spot.id } as BoardClick;
    const now = actionForClick(snap.targets, at);
    if (now && JSON.stringify(now) === JSON.stringify(spot.action)) {
      return clickBoardId(snap, seat, spot.id, what);
    }
    if (now?.type === spot.type) {
      // Same move, other piece (two ships on one edge): the board click takes the first.
      return refuse(
        `A click on ${spot.id} makes "${actionName(state, now)}${spotOf(spots, now)}", not this one: two pieces share the spot. Use the panel's buttons for it (see \`status\`).`,
      );
    }
    // Two moves on one spot (Seafarers setup: road or ship): a board click makes the first; the
    // other needs its build card on, as a player would click it.
    const card = snap.ui.controls.find((c) => c.enabled && c.actions?.includes(spot.type));
    if (!card) {
      return refuse(
        `A click on ${spot.id} would make "${now ? actionName(state, now) : 'nothing'}", and no button switches it to "${spot.does}". Take a \`shot\`; this may be a bug.`,
      );
    }
    const err = await pressControl(seat, snap, card);
    if (err) return refuse(err);
    await sleep(SETTLE_MS);
    const mode = await snapshot(seat);
    if (actionForClick(mode.targets, at)?.type !== spot.type) {
      return refuse(
        `Clicked [${card.label}] to switch to "${spot.does}", but ${spot.id} still does not take it. Run \`status\`.`,
      );
    }
    return clickBoardId(snap, seat, spot.id, `[${card.label}], then ${what}`);
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
    // All buttons first: a better-matching disabled button is refused, never swapped for a
    // looser enabled match ("Ship" must not press "Move ship").
    const m = matchControl(query, controls);
    if (m.kind === 'many') {
      const list = m.indices.map((i) => `[${controls[i]?.label}]`).join(' ');
      return refuse(`"${query}" matches several buttons: ${list}. Use the full label.`);
    }
    if (m.kind === 'disabled') {
      const why = controls[m.index]?.why;
      return refuse(
        `[${controls[m.index]?.label}] is disabled right now${why ? ` (${why})` : ''}. ${listButtons(snap)}`,
      );
    }
    if (m.kind === 'none') {
      const stale = snap.state ? staleTradeHint(snap.state, query) : null;
      if (stale) return refuse(`${stale} ${listButtons(snap)}`);
      return refuse(`No button matches "${query}". ${listButtons(snap)}`);
    }
    const c = controls[m.index];
    if (!c) return refuse('internal: match out of range');
    const err = await pressControl(seat, snap, c);
    if (err) return refuse(err);
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
      const err = await press(seat, id, `the ${label} ${up ? '+' : '−'} button`, async () => {
        const again = (await snapshot(seat)).ui.steppers.find((x) => x.label === label);
        return (up ? again?.incId : again?.decId) ?? null;
      });
      if (err) return refuse(err);
      snap = await snapshot(seat);
      // Module steppers clamp instead of disabling their button: stop when it did not move.
      if (snap.ui.steppers.find((x) => x.label === label)?.value === s.value) {
        const res = await afterAction(first, seat, `${label} stopped at ${s.value}`);
        return { out: `${res}\nNOTE: ${label} did not go past ${s.value} here.` };
      }
    }
    const after = snap.ui.steppers.find((x) => x.label === label);
    return { out: await afterAction(first, seat, `${label} = ${after?.value ?? '?'}`) };
  },

  async choose(seat, args) {
    const line = args.join(' ');
    const eq = line.lastIndexOf('=');
    const query = eq < 0 ? '' : line.slice(0, eq).trim();
    const want = eq < 0 ? '' : line.slice(eq + 1).trim();
    if (!query || !want) {
      return refuse('Usage: `choose <dropdown> = <option>`, e.g. `choose Bank: give = Grain`.');
    }
    const snap = await guarded(seat, 'act');
    if (typeof snap === 'string') return refuse(snap);
    const drops = snap.ui.dropdowns ?? [];
    if (drops.length === 0) return refuse('No dropdowns are showing. Run `status`.');
    const m = matchChoice(
      query,
      drops.map((d) => d.label),
    );
    const names = drops.map((d) => d.label).join(', ');
    if (m.kind === 'many') {
      return refuse(
        `"${query}" matches several: ${m.indices.map((i) => drops[i]?.label).join(', ')}.`,
      );
    }
    if (m.kind === 'none') return refuse(`No dropdown "${query}". Dropdowns: ${names}.`);
    const d = drops[m.index];
    if (!d) return refuse('internal: match out of range');
    if (!d.enabled) return refuse(`[${d.label}] is disabled right now.`);
    const o = matchChoice(want, d.options);
    if (o.kind !== 'one') {
      return refuse(
        `[${d.label}] has no single option "${want}". Options: ${d.options.join(' | ')}.`,
      );
    }
    const label = d.options[o.index] as string;
    try {
      await ctxOf(seat).page.selectOption(`[data-pt="${d.id}"]`, { label }, { timeout: 5000 });
    } catch {
      return refuse(`[${d.label}] is gone: the screen changed. Run \`status\`.`);
    }
    return { out: await afterAction(snap, seat, `${d.label} = ${label}`) };
  },

  async pass(seat) {
    if (isOnline) return refuse('There is no pass-the-device cover online; just act.');
    const snap = await guarded(seat, 'pass');
    if (typeof snap === 'string') return refuse(snap);
    const btn = snap.ui.controls.find((c) => c.enabled && /show my cards/i.test(c.label));
    if (!btn)
      return refuse('The cover is up but its button was not found. Take a `shot` and report this.');
    const err = await pressControl(seat, snap, btn);
    if (err) return refuse(err);
    return { out: await afterAction(snap, seat, `dismissed the cover ("${snap.ui.cover}")`) };
  },

  async shot(seat, args) {
    const mode = args[0] ?? 'full';
    if (!['board', 'hud', 'full'].includes(mode)) return refuse('Usage: `shot [board|hud|full]`.');
    const file = await screenshot(seat, SHOTS_DIR, `seat${seat + 1}-${nextShotNumber(seat)}`, mode);
    return { out: `Saved ${relative(REPO_ROOT, file)} (${mode}). Open it to look.` };
  },

  async console(seat) {
    const { consoleLog } = ctxOf(seat);
    const fresh = consoleLog.slice(consoleCursor.get(seat) ?? 0);
    consoleCursor.set(seat, consoleLog.length);
    if (fresh.length === 0) return { out: 'No new console errors or warnings.' };
    return {
      out: fresh.map((c) => `#${c.n} [${c.level}] ${c.text.slice(0, 600)}`).join('\n'),
    };
  },

  // ---- online only ----------------------------------------------------------------------

  /** Say something in the room chat (the sidebar box, like a player would). */
  async chat(seat, args) {
    if (!isOnline) return onlineOnly('chat');
    const { page } = ctxOf(seat);
    const text = args.join(' ').trim();
    if (!text) return refuse('Usage: `chat <message>`.');
    const input = page.locator('.sec-chat .chat-input');
    if ((await input.count()) === 0) return refuse('The chat box is not on screen right now.');
    if (await input.isDisabled())
      return refuse('The chat box is disabled (offline?). Take a `shot`.');
    await input.fill(text);
    await input.press('Enter');
    for (let i = 0; i < 20; i++) {
      await sleep(150);
      const snap = await snapshot(seat);
      if (snap.online?.chat.some((c) => c.line.endsWith(`: ${text}`))) {
        return { out: `OK: said "${text}"` };
      }
    }
    return {
      out: `Sent "${text}" but it did not show up in your chat after 3 s (rate limit? offline?). Run \`status\`; maybe report it.`,
    };
  },

  /** Cut this seat's network (as a dropped Wi-Fi would): the page should show a reconnect banner. */
  async drop(seat) {
    if (!isOnline) return onlineOnly('drop');
    const ctx = ctxOf(seat);
    if (ctx.dropped) return refuse('Your network is already dropped. Run `reconnect`.');
    ctx.dropped = true;
    await dropNetwork(ctx.context, ctx.page);
    await sleep(1000);
    const snap = await snapshot(seat);
    return {
      out: [
        `OK: ${seatName(seat)}'s network is cut.`,
        `Connection: ${snap.online?.status ?? '?'}${snap.online?.banner ? `; banner: "${snap.online.banner}"` : '; no banner showing (is that right?)'}`,
        'The others should see you as away. After about 60 s without you a bot plays your seat.',
        'Run `reconnect` to come back (try `status` and `shot` while offline first).',
      ].join('\n'),
    };
  },

  /** Restore the network and wait for the page to be back in the game. */
  async reconnect(seat) {
    if (!isOnline) return onlineOnly('reconnect');
    const ctx = ctxOf(seat);
    const before = await snapshot(seat);
    await restoreNetwork(ctx.context, ctx.page);
    ctx.dropped = false;
    let after = before;
    for (let i = 0; i < 80; i++) {
      await sleep(250);
      after = await snapshot(seat);
      if (after.online?.status === 'open' && after.online.seq !== null) break;
    }
    const open = after.online?.status === 'open';
    const lines = [
      open
        ? `OK: back online (connection ${after.online?.status}, game seq ${after.online?.seq}).`
        : `PROBLEM: still ${after.online?.status ?? '?'} after 20 s${after.online?.fatal ? ` (${after.online.fatal.code})` : ''}. Report this if the network is up.`,
    ];
    if (after.online?.banner) lines.push(`Banner still showing: "${after.online.banner}"`);
    if (before.state && after.state) {
      const fresh = newLogEntries(before.state.log, after.state.log);
      if (fresh.length > 0) {
        lines.push('Log while you were away:');
        for (const e of fresh) lines.push(formatLogEntry(after.state, e));
      }
    }
    lines.push(`Now: ${nowLine(after, seat)}`);
    return { out: lines.join('\n') };
  },

  /** Reload the tab (the stored token should put you straight back in your seat). */
  async reload(seat) {
    if (!isOnline) return onlineOnly('reload');
    const ctx = ctxOf(seat);
    const before = ctx.dropped ? null : await snapshot(seat);
    if (ctx.dropped) {
      await ctx.context.setOffline(false);
      ctx.dropped = false;
    }
    // Creating / joining a room rewrites the URL to the bare invite link (`?room=CODE`), which
    // drops `?debug=1`: a plain reload would come back without the state hook the CLI reads.
    await ctx.page.goto(withDebug(ctx.page.url()));
    try {
      await ctx.page.waitForFunction(
        'window.__catanDebug && window.__catanDebug.state() !== null',
        null,
        { timeout: 20_000 },
      );
    } catch {
      return {
        out: 'PROBLEM: the game did not come back within 20 s of reloading. Take a `shot` and report this.',
      };
    }
    const after = await snapshot(seat);
    const lines = ['OK: reloaded; the game is back.'];
    if (before?.viewer !== undefined && before.viewer !== after.viewer) {
      lines.push(
        `PROBLEM: you were seat ${(before.viewer ?? -1) + 1} before, now ${(after.viewer ?? -1) + 1}.`,
      );
    }
    lines.push(`Now: ${nowLine(after, seat)}`);
    return { out: lines.join('\n') };
  },

  async report(seat, _args, f) {
    const severity = (f.severity ?? '').toLowerCase();
    if (!f.title) return refuse('A report needs --title "...".');
    if (!(SEVERITIES as readonly string[]).includes(severity)) {
      return refuse(`--severity must be one of: ${SEVERITIES.join(', ')}.`);
    }
    const snap = await snapshot(seat);
    const state = snap.state;
    const { consoleLog } = ctxOf(seat);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const base = `${stamp}-seat${seat + 1}-${slugify(f.title)}`;
    mkdirSync(BUGS_DIR, { recursive: true });
    const shotFile = await screenshot(seat, BUGS_DIR, base, 'full');
    const stateFile = join(BUGS_DIR, `${base}.state.json`);
    writeFileSync(stateFile, JSON.stringify(snap, null, 2));
    const log = state ? state.log.slice(-20).map((e) => formatLogEntry(state, e)) : [];
    const errs = consoleLog.slice(-20).map((c) => `#${c.n} [${c.level}] ${c.text.slice(0, 800)}`);
    const where = state
      ? `turn ${state.turn.number}, phase ${state.phase.kind}, current player ${state.players[state.turn.current]?.name}`
      : 'game not loaded';
    const session = onl
      ? `online room \`${snap.online?.room ?? '?'}\` on ${serverOrigin}, ${onl.humans} humans + ${onl.bots} bots, map ${onl.map}, timer ${onl.timer ?? 'off'}, vp ${vp ?? 'default'}`
      : `${hot?.seats} seats, seed \`${seed}\`, map ${hot?.map ?? 'default'}, vp ${vp ?? 'default'}`;
    const md = [
      `# ${f.title}`,
      '',
      `- Severity: **${severity}**`,
      `- Reporter: ${seatName(seat)} (seat ${seat + 1})`,
      `- When: ${new Date().toISOString()} — ${where}`,
      `- Session: ${session}`,
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
      `- Snapshot (state, legal actions, UI scan${snap.online ? ', online connection' : ''}): \`${relative(REPO_ROOT, stateFile)}\``,
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

async function screenshot(
  seat: PlayerId,
  dir: string,
  base: string,
  mode: string,
): Promise<string> {
  const { page } = ctxOf(seat);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${base}.png`);
  // Render on demand (headless): draw the current board first.
  await page.evaluate('window.__pt && window.__pt.render()');
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

/** Things to close if boot fails half way. */
const cleanups: (() => Promise<void>)[] = [];

/** Where the pages load the app and the rooms live (hotseat: the preview server). */
let serverOrigin = '';
let roomCode: string | undefined;

async function newSeatCtx(browser: Browser): Promise<SeatCtx> {
  // Same page size headed or not, so screenshots and click positions match what a watcher sees.
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.addInitScript({ path: join(REPO_ROOT, 'scripts', 'playtest', 'inpage.js') });
  // Headless has no GPU: drawing the board every frame in software starves the page (and the
  // machine, with several sessions). Watchers of a headed window keep the smooth board.
  if (!headed) await context.addInitScript('window.__pt.renderOnDemand()');
  const page = await context.newPage();
  const ctx: SeatCtx = { page, context, consoleLog: [], dropped: false };
  watchConsole(ctx);
  return ctx;
}

async function main() {
  mkdirSync(PLAYTEST_DIR, { recursive: true });
  let preview_: Awaited<ReturnType<typeof preview>> | null = null;
  let roomSrv: RoomServer | null = null;
  let gameUrl: string;

  const launch = () =>
    chromium.launch({
      headless: !headed,
      ...(headed ? { args: [`--window-size=${VIEWPORT.width},${VIEWPORT.height + 100}`] } : {}),
    });

  let browser: Browser;
  if (onl) {
    // The room server serves dist/ (the client), so a local run builds that; --remote does not.
    roomSrv = await roomServer(onl.remote, async () => {
      await build({ root: REPO_ROOT, logLevel: 'warn' });
    });
    serverOrigin = roomSrv.origin;
    cleanups.push(() => roomSrv?.stop() ?? Promise.resolve());
    browser = await launch();
    cleanups.push(() => browser.close());
    const room = await createAndStart(serverOrigin, onl, async (seat, url) => {
      const ctx = await newSeatCtx(browser);
      ctxs[seat] = ctx;
      await ctx.page.goto(url);
      return ctx.page;
    });
    roomCode = room.code;
    gameUrl = `${serverOrigin}/?room=${room.code}`;
  } else if (hot) {
    console.log('Building the app…');
    await build({
      root: REPO_ROOT,
      logLevel: 'warn',
      build: { outDir: OUT_DIR, emptyOutDir: true },
    });
    preview_ = await preview({
      root: REPO_ROOT,
      logLevel: 'warn',
      build: { outDir: OUT_DIR },
      preview: { host: '127.0.0.1', port: 4319, strictPort: false, open: false },
    });
    const appUrl = preview_.resolvedUrls?.local[0] ?? 'http://127.0.0.1:4319/';
    serverOrigin = appUrl;
    browser = await launch();
    const ctx = await newSeatCtx(browser);
    for (let i = 0; i < hot.seats; i++) ctxs[i] = ctx;
    gameUrl = `${appUrl}?${new URLSearchParams(hot.query).toString()}`;
    await ctx.page.goto(gameUrl);
    await ctx.page.waitForFunction(
      'window.__catanDebug && window.__catanDebug.state() !== null',
      null,
      { timeout: 20000 },
    );
    // Builds without 5-8 player support ignore `?seats=` longer than they know: fail loudly.
    const loaded = (await snapshot(0)).state;
    const got = loaded?.players.length ?? 0;
    if (got !== hot.seats || loaded?.players.some((p, i) => p.name !== `Seat${i + 1}`)) {
      await browser.close();
      await preview_.close();
      throw new Error(
        `Asked for ${hot.seats} seats but the app started ${got} (${loaded?.players.map((p) => p.name).join(', ')}). ` +
          'This build probably does not support that many players yet; try --seats 3 or 4.',
      );
    }
    if (hot.map && !['base', 'baseRandom'].includes(hot.map)) {
      console.log(
        `Note: passed ?map=${hot.map}; builds that do not know it fall back to a random board.`,
      );
    }
  } else {
    throw new Error('no mode');
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
      if (!Number.isInteger(body.seat) || body.seat < 0 || body.seat >= humanSeats) {
        return reply(400, { out: `This game has seats 1 to ${humanSeats}.` });
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
    seats: humanSeats,
    map: onl?.map ?? hot?.map ?? null,
    seed,
    vp,
    startedAt: new Date().toISOString(),
    mode: onl ? 'online' : 'hotseat',
    ...(onl && roomCode ? { room: roomCode, server: serverOrigin } : {}),
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
      await preview_?.close();
      await roomSrv?.stop();
    } finally {
      process.exit(0);
    }
  }
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  if (onl) {
    console.log(
      `Online playtest ready: room ${roomCode} on ${serverOrigin}, ${onl.humans} human seat(s) + ${onl.bots} bot(s), map ${onl.map}, timer ${onl.timer ?? 'off'}.\n  invite: ${gameUrl}\n  command port: ${port}`,
    );
  } else {
    console.log(
      `Playtest session ready (${humanSeats} seats).\n  game: ${gameUrl}\n  command port: ${port}\n  seed: ${seed}`,
    );
  }
  console.log(
    `Players: \`pnpm -s pt <1..${humanSeats}> help\`. Stop: \`pnpm -s pt stop\` or Ctrl+C.`,
  );
}

main().catch(async (e: unknown) => {
  console.error(e);
  rmSync(SESSION_FILE, { force: true });
  // Do not leave a browser or a wrangler we started behind.
  for (const fn of cleanups.reverse()) await fn().catch(() => undefined);
  process.exit(1);
});
