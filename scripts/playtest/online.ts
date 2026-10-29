/**
 * Online playtest setup (`pt:serve --online`): get a room server (reuse or start `pnpm dev:server`),
 * then create a room and seat every human in its own browser context through the real UI.
 * Pure Playwright / node; the command handlers live in serve.ts.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { REPO_ROOT, PLAYTEST_DIR } from './protocol';
import type { OnlineServeOptions } from './options';

/** `pnpm dev:server` listens here (wrangler dev default). */
export const LOCAL_ORIGIN = 'http://localhost:8787';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll a JS expression (string) until it is truthy. `page.waitForFunction` with a string re-evals
 * it in the page on every poll, which the page's Content-Security-Policy forbids (no
 * 'unsafe-eval'); `page.evaluate` runs through DevTools and is allowed.
 */
async function waitUntil(page: Page, expr: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await page.evaluate(expr))) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${expr}`);
    await sleep(100);
  }
}

/** Is a room server answering at `origin`? (A missing room is a 404 from the Worker.) */
export async function serverUp(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/api/rooms/AAAAAA`, { signal: AbortSignal.timeout(2000) });
    return res.status === 404 || res.ok;
  } catch {
    return false;
  }
}

/** Does `origin` serve this checkout's freshly built client (same index.html, same asset hashes)? */
async function servesThisCheckout(origin: string): Promise<boolean> {
  try {
    const served = await (await fetch(`${origin}/`, { signal: AbortSignal.timeout(5000) })).text();
    return served === readFileSync(join(REPO_ROOT, 'dist', 'index.html'), 'utf8');
  } catch {
    return true; // cannot tell: do not cry wolf
  }
}

export interface RoomServer {
  origin: string;
  /** True when this run started wrangler (and so stops it). */
  started: boolean;
  stop(): Promise<void>;
}

/**
 * `--remote URL`: use it as is. Otherwise reuse a server already on :8787 (after rebuilding dist/
 * so it serves this checkout's client), or start `pnpm dev:server` and wait until it answers.
 */
export async function roomServer(
  remote: string | null,
  rebuild: () => Promise<void>,
): Promise<RoomServer> {
  if (remote) {
    if (!(await serverUp(remote))) throw new Error(`No room server answers at ${remote}.`);
    return { origin: remote, started: false, stop: () => Promise.resolve() };
  }
  if (await serverUp(LOCAL_ORIGIN)) {
    console.log(`Reusing the room server on ${LOCAL_ORIGIN}; rebuilding dist/ for it…`);
    await rebuild();
    if (!(await servesThisCheckout(LOCAL_ORIGIN))) {
      console.log(
        `NOTE: the server on ${LOCAL_ORIGIN} serves another checkout's client (its index.html differs from ` +
          `this checkout's dist/). Client changes made here are not in this game. To test them, run ` +
          '`nice -n 19 pnpm dev:server --port 8788 --inspector-port 9239` here and pass `--remote http://localhost:8788`.',
      );
    }
    return { origin: LOCAL_ORIGIN, started: false, stop: () => Promise.resolve() };
  }
  const logFile = join(PLAYTEST_DIR, 'server.log');
  console.log(`Starting \`pnpm dev:server\` (build + wrangler dev); log: ${logFile}`);
  const fd = openSync(logFile, 'w');
  const proc: ChildProcess = spawn('nice', ['-n', '19', 'pnpm', 'dev:server'], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  let exited: number | null | undefined;
  proc.once('exit', (code) => (exited = code));
  const deadline = Date.now() + 180_000;
  while (!(await serverUp(LOCAL_ORIGIN))) {
    if (exited !== undefined) {
      throw new Error(`\`pnpm dev:server\` exited (${exited}). See ${logFile}.`);
    }
    if (Date.now() > deadline) throw new Error(`dev:server not ready after 180 s. See ${logFile}.`);
    await sleep(500);
  }
  return {
    origin: LOCAL_ORIGIN,
    started: true,
    stop: async () => {
      // Negative pid = the whole process group (pnpm -> vite/wrangler -> workerd).
      try {
        if (proc.pid) process.kill(-proc.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
      await sleep(300);
    },
  };
}

export interface SeatedRoom {
  code: string;
  /** Page per human seat, index = seat. */
  pages: Page[];
}

/** The page's RoomClient (main.ts exposes window.catan.online). */
const CLIENT = 'window.catan.online.roomClient';

/**
 * Create a room as Seat1 (home screen -> Play online), apply the table config over the wire, join
 * the others from the invite link, sit everyone in order, start. `open(seat)` makes the page for
 * a seat (its own browser context, so its own token and nickname).
 */
export async function createAndStart(
  origin: string,
  o: OnlineServeOptions,
  open: (seat: number, url: string) => Promise<Page>,
): Promise<SeatedRoom> {
  const pages: Page[] = [];
  const host = await open(0, `${origin}/?debug=1`);
  pages.push(host);
  await host.waitForSelector('[data-k="create"]', { timeout: 30_000 });
  await host.fill('[data-k="nickname"]', 'Seat1');
  await host.click('[data-k="create"]');
  await host.waitForSelector('.ol-lobby', { timeout: 30_000 });
  const code = (await host.evaluate('window.catan.online.roomId')) as string;

  // Table settings go over the wire like the lobby's own configure does.
  const x = o.expansion;
  const patch = JSON.stringify({
    ...(x
      ? {
          mode: x.mode,
          ...(x.scenario ? { scenario: x.scenario } : {}),
          options: x.options,
          vpToWin: x.vpToWin,
        }
      : {}),
    map: o.map,
    seatCount: o.total,
    turnTimerSec: o.timer,
    ...(o.vp === null ? {} : { vpToWin: o.vp }),
  });
  const sent = await host.evaluate(
    `(() => { const c = ${CLIENT}; return c.configure({ ...c.room.config, ...${patch} }); })()`,
  );
  if (sent !== true) throw new Error('The host could not send the table settings.');
  await waitUntil(
    host,
    `${CLIENT}.room.config.seatCount === ${o.total} && ${CLIENT}.room.config.map === ${JSON.stringify(o.map)} && ${CLIENT}.room.config.mode === ${JSON.stringify(x?.mode ?? 'base')}`,
    15_000,
  );

  for (let seat = 1; seat < o.humans; seat++) {
    const p = await open(seat, `${origin}/?room=${code}&debug=1`);
    pages.push(p);
    await p.waitForSelector('[data-k="join"]', { timeout: 30_000 });
    await p.fill('[data-k="nickname"]', `Seat${seat + 1}`);
    await p.click('[data-k="join"]');
    await p.waitForSelector('.ol-lobby', { timeout: 30_000 });
  }
  for (const [seat, p] of pages.entries()) {
    // The lobby seats everyone on joining; only move a player that landed elsewhere.
    await waitUntil(p, `${CLIENT}.mySeat !== null`, 15_000);
    if ((await p.evaluate(`${CLIENT}.mySeat`)) !== seat) {
      await p.waitForSelector(`[data-k="sit-${seat}"]`, { timeout: 15_000 });
      await p.click(`[data-k="sit-${seat}"]`);
      await waitUntil(p, `${CLIENT}.mySeat === ${seat}`, 15_000);
    }
    await waitUntil(host, `${CLIENT}.room.seats[${seat}].occupant !== null`, 15_000);
  }
  await host.click('[data-k="lobby-start"]');
  for (const p of pages) {
    await waitUntil(p, 'window.__catanDebug && window.__catanDebug.state() !== null', 30_000);
  }
  return { code, pages };
}

/** Drop a seat's network: sockets die, new connection attempts fail until `restoreNetwork`. */
export async function dropNetwork(ctx: BrowserContext, page: Page): Promise<void> {
  await ctx.setOffline(true);
  // Emulated offline does not touch open sockets: close this one like a dead network would.
  await page.evaluate(`${CLIENT}.transport && ${CLIENT}.transport.close()`);
}

export async function restoreNetwork(ctx: BrowserContext, page: Page): Promise<void> {
  await ctx.setOffline(false);
  await page.evaluate(`${CLIENT}.retryNow()`);
}
