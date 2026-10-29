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

/**
 * Poll a JS expression (string) until it is truthy. `page.waitForFunction` with a string re-evals
 * it in the page on every poll, which the page's Content-Security-Policy forbids (no
 * 'unsafe-eval'); `page.evaluate` runs through DevTools and is allowed.
 */
async function waitUntil(page: Page, expr: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await page.evaluate(expr))) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${expr}`);
    await page.waitForTimeout(100);
  }
}

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
        // Reconnect attempts during the emulated network drop are expected to fail.
        if (m.type() === 'error' && !m.text().includes('ERR_INTERNET_DISCONNECTED')) {
          errors.push(m.text());
        }
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

    // L1: both sat down on joining, the host in seat 1, Bob in the first bot seat.
    await ann.waitForFunction(() =>
      document.querySelector('.ol-seat[data-seat="1"]')?.textContent?.includes('Bob'),
    );
    check(
      (await ann.textContent('.ol-seat[data-seat="0"]'))?.includes('Ann') &&
        (await ann.$('[data-k="watching"][hidden]')),
      'host and guest are seated on joining (seats 1 and 2), nobody is watching',
    );
    // "Move here" still works: Bob moves to seat 4 and back.
    await bob.click('[data-k="sit-3"]');
    await ann.waitForFunction(() =>
      document.querySelector('.ol-seat[data-seat="3"]')?.textContent?.includes('Bob'),
    );
    await bob.click('[data-k="sit-1"]');
    await ann.waitForFunction(() =>
      document.querySelector('.ol-seat[data-seat="1"]')?.textContent?.includes('Bob'),
    );
    check(true, 'Move here: Bob moves seats and back');
    await ann.click('[data-k="copy"]');
    await ann.waitForSelector('[data-k="copy"] .ol-copy-label:not(.is-off):has-text("Copied!")');
    check(
      (await ann.$eval('[data-k="copy"] .ol-copy-label.is-off', (e) => e.textContent)) ===
        'Copy link',
      '"Copy link" is hidden while "Copied!" shows',
    );
    check(
      (await ann.textContent('[data-k="copy"] .ol-copy-label:not(.is-off)')) === 'Copied!',
      'Copy link shows only "Copied!"',
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

    // Player trade between two humans (BUG-B3): the other human gets the offer card, the
    // offerer only sees "thinking…" for them, and how the offer ends is toasted.
    const offerExpr = `(${clientExpr}.game.legal.find(a => a.type === 'offerTrade' && a.to.length === 2) || null)`;
    let offerer: Page | null = null;
    for (let i = 0; i < 300 && !offerer; i++) {
      for (const p of [ann, bob]) if (!offerer && (await p.evaluate(offerExpr))) offerer = p;
      if (offerer) break;
      for (const p of [ann, bob]) {
        await p.evaluate(
          `(() => { const c = ${clientExpr}; const l = c.game && c.game.legal; if (l && l.length) c.intent(l.find(a => !/Trade$|buyDevCard/.test(a.type)) || l[0]); })()`,
        );
      }
      await ann.waitForTimeout(150);
    }
    if (!offerer) throw new Error('FAILED: nobody got to offer a player trade');
    const responder = offerer === ann ? bob : ann;
    await offerer.evaluate(`${clientExpr}.intent(${offerExpr})`);
    await responder.waitForSelector('[role="dialog"][aria-label$="offers a trade"]');
    check(true, 'the other human gets the trade offer card');
    await offerer.waitForSelector('[role="dialog"][aria-label="Your trade offer"]');
    check(
      (await offerer.textContent('[role="dialog"][aria-label="Your trade offer"]'))?.includes(
        'thinking…',
      ),
      'the offerer sees the other human thinking',
    );
    await shot(responder, '5c-trade-offer');
    const respond = responder.locator('[role="dialog"] .dialog-actions button');
    if (await respond.filter({ hasText: 'Accept' }).isEnabled()) {
      await respond.filter({ hasText: 'Accept' }).click();
      const cancel = offerer.locator('[role="dialog"] button', { hasText: 'Cancel offer' });
      await offerer.waitForFunction(() =>
        document
          .querySelector('[aria-label="Your trade offer"]')
          ?.textContent?.includes('accepted'),
      );
      await cancel.click();
      await responder.waitForSelector('.game-toast:has-text("withdrew the offer you accepted")');
      check(true, 'accepter is told the offer was withdrawn');
    } else {
      await respond.filter({ hasText: 'Reject' }).click();
      // The bot (seat 2) answered first: everyone rejected, or the bot accepted.
      const closed = await offerer
        .waitForSelector('.game-toast:has-text("Everyone rejected your offer")', { timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      if (!closed) {
        await offerer.locator('[role="dialog"] button', { hasText: 'Cancel offer' }).click();
      }
      check(true, closed ? 'offerer is told everyone rejected' : 'offerer withdrew (bot accepted)');
    }
    await offerer.waitForFunction(() => !document.querySelector('[aria-label="Your trade offer"]'));
    check(true, 'the offer card is gone once the offer ended');

    if (REMOTE) {
      // Network drop (real sockets only): banner, then back with the same seat.
      await ann.context().setOffline(true);
      // Emulated offline does not touch open sockets: drop this one like a dead network would.
      await ann.evaluate(`${clientExpr}.transport.close()`);
      await ann.waitForSelector('.conn-banner:not([hidden])', { timeout: 20_000 });
      await shot(ann, '5b-reconnecting');
      await ann.context().setOffline(false);
      await ann.waitForSelector('.conn-banner[hidden]', { state: 'attached', timeout: 30_000 });
      const viewer = await ann.evaluate(`${clientExpr}.game.view.view.viewer`);
      check(viewer === 0, 'network drop: reconnecting banner, then back in seat 0');
    }

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
    check(!(await eve.$('.hud-bottom .hand')), 'spectator has no hand bar');
    // #35: only a read-only price list (cost tooltips), nothing clickable.
    check(
      (await eve.$$('.hud-bottom > *')).length === 1 &&
        (await eve.$$('.hud-bottom .build-bar.is-costs button:not([disabled])')).length === 0,
      'spectator sees build costs only',
    );
    check(!(await eve.$('.btn-roll')), 'spectator has no buttons');
    await shot(eve, '6-spectator');

    // Bob's tab closes: Ann sees him as disconnected.
    await bob.close({ runBeforeUnload: true });
    await ann.waitForSelector('.pp.is-away .pp-away', { timeout: 10_000 });
    check(true, 'closed tab shows the away icon');
    await shot(ann, '7-bob-away');

    // Expansion room (X1): the host picks Cities & Knights with the setup screen's expansion
    // chip; Ann + Dan play against two bots; the C&K HUD renders from the masked views.
    const host = await open(REMOTE ? base : `${base}?server=local`);
    await host.fill('[data-k="nickname"]', 'Ann');
    await host.click('[data-k="create"]');
    await host.waitForSelector('.ol-lobby');
    await host.click('.ol-config [data-k="chip-ck"]');
    await waitUntil(host, `${clientExpr}.room.config.mode === 'ck'`);
    check(true, 'host picked Cities & Knights in the lobby (setup screen expansion chip)');
    const dan = await open(await host.inputValue('[data-k="invite"]'));
    await dan.fill('[data-k="nickname"]', 'Dan');
    await dan.click('[data-k="join"]');
    await dan.waitForSelector('.ol-lobby');
    check(
      (await dan.textContent('.ol-lobby'))?.includes('Cities & Knights'),
      'guest sees the C&K setup',
    );
    // Both sat down on joining (L1).
    await host.waitForFunction(() =>
      document.querySelector('.ol-seat[data-seat="1"]')?.textContent?.includes('Dan'),
    );
    await shot(host, '8-lobby-ck');
    await host.click('[data-k="lobby-start"]');
    await host.waitForSelector('.hud-side .sec-chat');
    await dan.waitForSelector('.hud-side .sec-chat');
    check(
      (await host.evaluate(`${clientExpr}.game.view.settings.mode`)) === 'ck',
      'C&K game started online',
    );
    for (let i = 0; i < 400; i++) {
      const turn = (await host.evaluate(`${clientExpr}.game.view.turn.number`)) as number;
      if (turn >= 4) break;
      for (const p of [host, dan]) {
        await p.evaluate(
          `(() => { const c = ${clientExpr}; const l = c.game && c.game.legal; if (l && l.length) c.intent(l.find(a => !/offerTrade$|cancel$/.test(a.type)) || l[0]); })()`,
        );
      }
      await host.waitForTimeout(120);
    }
    const ckTurn = (await host.evaluate(`${clientExpr}.game.view.turn.number`)) as number;
    check(ckTurn >= 4, `C&K game reached turn ${ckTurn}`);
    const leak = (await dan.evaluate(
      `(() => { const v = ${clientExpr}.game.view; const ck = v.ext.ck; return v.players.filter(p => p.id !== v.view.viewer).some(p => new Set(ck.players[p.id].progress).size > 1 || Object.values(ck.players[p.id].commodities).some(n => n > 0)); })()`,
    )) as boolean;
    check(!leak, "Dan's view hides Ann's progress cards and commodities");
    check(await host.$('.ck-stat, .ck-die'), 'C&K HUD panel renders');
    await shot(host, '9-game-ck-ann');
    await shot(dan, '9-game-ck-dan');

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
