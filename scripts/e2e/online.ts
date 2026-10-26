/**
 * Headless 2-tab online flow on the in-browser dev server (no backend):
 *
 *   pnpm e2e:online [--out dir] [--headed]
 *
 * Builds the app, serves it with `vite preview`, then in one Chrome profile (so the tabs share the
 * dev-server SharedWorker): Ann creates a room, Bob joins from the invite link, they sit, the host
 * removes a bot seat and starts; both chat and react, play a few moves through their own legal
 * actions, Eve joins as a spectator, Bob's tab closes (away icon). Screenshots of every step go to
 * --out (default playtest/shots/e2e-online). Exits non-zero on the first failed check.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { build, preview } from 'vite';

const REPO = join(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};
const OUT = flag('--out') ?? join(REPO, 'playtest', 'shots', 'e2e-online');
/** `--remote http://localhost:8787/`: play against a running room server (M2) instead. */
const REMOTE = flag('--remote');
const HEADED = args.includes('--headed');
const VIEWPORT = { width: 1440, height: 900 };

function check(ok: unknown, what: string): void {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`ok  ${what}`);
}

async function shot(page: Page, name: string): Promise<void> {
  // Lobby: show it from the top.
  await page.evaluate(() => document.querySelector('.ol-lobby .su-scroll')?.scrollTo(0, 0));
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

/** The page's RoomClient (main.ts exposes window.catan.online). */
const clientExpr = '(window.catan && window.catan.online && window.catan.online.roomClient)';

async function main() {
  mkdirSync(OUT, { recursive: true });
  let server: Awaited<ReturnType<typeof preview>> | null = null;
  let base = REMOTE;
  if (!base) {
    const outDir = join(REPO, 'playtest', 'dist', 'e2e');
    console.log('Building…');
    await build({ root: REPO, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
    server = await preview({
      root: REPO,
      logLevel: 'warn',
      build: { outDir },
      preview: { host: '127.0.0.1', port: 4329, strictPort: false, open: false },
    });
    base = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:4329/';
  }
  const browser = await chromium.launch({
    headless: !HEADED,
    executablePath: '/usr/bin/google-chrome-stable',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const errors: string[] = [];
  try {
    // Dev server: one profile, so the tabs share its SharedWorker (tokens are per tab).
    // Real server: tokens live in localStorage, so each player needs their own profile.
    const shared = await browser.newContext({ viewport: VIEWPORT });
    const open = async (url: string) => {
      const ctx = REMOTE ? await browser.newContext({ viewport: VIEWPORT }) : shared;
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(e.message));
      p.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await p.goto(url);
      return p;
    };

    // Hotseat still starts from the home screen.
    const solo = await open(base);
    await solo.click('[data-k="offline"]');
    await solo.waitForSelector('.setup [data-k="start"]');
    await solo.click('.setup [data-k="start"]');
    await solo.waitForSelector('.hud-side .sec-players');
    check(!(await solo.$('.sec-chat')), 'Play offline -> hotseat setup -> game (no chat)');
    await solo.close();

    // Home -> create.
    const ann = await open(REMOTE ? base : `${base}?server=local`);
    await ann.waitForSelector('[data-k="create"]');
    await shot(ann, '1-home');
    await ann.fill('[data-k="nickname"]', 'Ann');
    await ann.click('[data-k="create"]');
    await ann.waitForSelector('.ol-lobby');
    const invite = await ann.inputValue('[data-k="invite"]');
    check(
      (REMOTE ? /\?room=[2-9A-Z]{6}$/ : /\?room=[2-9A-Z]{6}&server=local$/).test(invite),
      `invite link ${invite}`,
    );
    check(new URL(ann.url()).searchParams.get('room'), 'host URL carries ?room=');

    // Bob opens the link.
    const bob = await open(invite);
    await bob.waitForSelector('[data-k="join"]');
    await shot(bob, '2-invite-landing');
    await bob.fill('[data-k="nickname"]', 'Bob');
    await bob.click('[data-k="join"]');
    await bob.waitForSelector('.ol-lobby');
    await ann.waitForFunction(() => document.body.textContent?.includes('Bob'));
    check(true, 'Bob joined; Ann sees him');

    await ann.click('[data-k="sit-0"]');
    await bob.waitForSelector('[data-k="sit-1"]');
    await bob.click('[data-k="sit-1"]');
    await ann.waitForFunction(() =>
      document.querySelector('.ol-seat[data-seat="1"]')?.textContent?.includes('Bob'),
    );
    await ann.click('[data-k="remove-bot"]');
    await bob.waitForFunction(() => document.querySelectorAll('.ol-seat[data-seat]').length === 3);
    check(true, 'host removed a bot seat (4 -> 3), guest sees it');
    // Host flips a rule in the wrapped setup screen; the guest sees it read-only.
    await ann.click('.ol-config [data-k="timer-inc"]');
    await bob.waitForFunction(
      () => document.querySelector('.ol-config [data-v="timer"]')?.textContent === '2 min',
    );
    check(true, 'host config (turn timer 90s -> 2 min) reaches the guest');
    check(await bob.$('.ol-config[inert]'), 'guest config is inert');
    await bob.fill('.ol-chat .chat-input', 'ready when you are');
    await bob.press('.ol-chat .chat-input', 'Enter');
    await ann.waitForFunction(() =>
      document.querySelector('.ol-chat')?.textContent?.includes('ready when you are'),
    );
    check(true, 'lobby chat');
    await shot(ann, '3-lobby-host');
    await shot(bob, '4-lobby-guest');

    // Start.
    await ann.click('[data-k="lobby-start"]');
    await ann.waitForSelector('.hud-side .sec-chat');
    await bob.waitForSelector('.hud-side .sec-chat');
    check(true, 'game started in both tabs, chat in the sidebar');
    await ann.waitForSelector('.turn-timer');
    check(true, 'turn timer shown from the server clock');

    // Play: each tab plays its first legal action (setup placements) for a while.
    const playSome = async (until: number) => {
      for (let i = 0; i < 200; i++) {
        const seq = await ann.evaluate(`${clientExpr}.game.seq`);
        if ((seq as number) >= until) return;
        for (const p of [ann, bob]) {
          await p.evaluate(
            `(() => { const c = ${clientExpr}; const l = c.game && c.game.legal; if (l && l.length) c.intent(l.find(a => a.type !== 'offerTrade') || l[0]); })()`,
          );
        }
        await ann.waitForTimeout(120);
      }
    };
    await playSome(14);
    const seqs = await Promise.all([ann, bob].map((p) => p.evaluate(`${clientExpr}.game.seq`)));
    check((seqs[0] as number) >= 14, `game advanced (seq ${String(seqs[0])})`);

    await bob.fill('.sec-chat .chat-input', 'gl hf');
    await bob.press('.sec-chat .chat-input', 'Enter');
    await ann.waitForFunction(() =>
      document.querySelector('.sec-chat')?.textContent?.includes('gl hf'),
    );
    await bob.click('.sec-chat [data-k="react-thumbsUp"]');
    await ann.waitForSelector('.reaction-bubble');
    check(true, 'in-game chat and reaction');
    await shot(ann, '5-game-ann');

    // Spectator.
    const eve = await open(invite);
    await eve.waitForSelector('[data-k="join"]');
    check(
      (await eve.textContent('[data-k="join"]'))?.trim() === 'Watch',
      'late arrival is offered "Watch"',
    );
    await eve.fill('[data-k="nickname"]', 'Eve');
    await eve.click('[data-k="join"]');
    await eve.waitForSelector('.spectate-pill');
    check((await eve.$$('.hud-bottom > *')).length === 0, 'spectator has no hand bar');
    check(!(await eve.$('.btn-roll')), 'spectator has no buttons');
    await shot(eve, '6-spectator');

    // Bob's tab closes: Ann sees him as disconnected.
    await bob.close({ runBeforeUnload: true });
    await ann.waitForSelector('.pp.is-away .pp-away', { timeout: 10_000 });
    check(true, 'closed tab shows the away icon');
    await shot(ann, '7-bob-away');

    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log(`\nAll checks passed. Screenshots in ${OUT}`);
  } finally {
    await browser.close();
    await server?.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
