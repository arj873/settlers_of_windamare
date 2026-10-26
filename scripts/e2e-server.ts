/**
 * End-to-end check of the room server (M2): starts `wrangler dev` on a free port, creates a room
 * over HTTP, connects 3 WebSocket clients (host + 2 friends; the 4th seat is a server bot), plays
 * a 3-VP game to the end with random-bot clients, and drops + reconnects one player mid-game.
 * Then one game each of Cities & Knights, Seafarers (Fog Islands), T&B + Seafarers (Fishermen
 * on New Shores) and Explorers & Pirates (Land Ho!): 2 clients + 2 server bots to the end, every
 * view checked for masked secrets.
 *
 *   pnpm e2e:server            (builds dist/ first if it is missing)
 *
 * Exit code 0 = the game finished and every check passed.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Rng, type Action, type GameState, type GameView } from '../src/engine';
import { defaultBot } from '../src/game/controller';
import type { CreateRoomResponse, RoomSummary } from '../src/net/api';
import { roomApiPath, roomSocketPath } from '../src/net/api';
import {
  DEFAULT_ROOM_CONFIG,
  parseServerMessage,
  PROTOCOL_VERSION,
  type RoomConfig,
  type ServerMessage,
} from '../src/net/protocol';

const TIMEOUT_MS = 900_000;
/** One expansion game, start to win. */
const EXPANSION_TIMEOUT_MS = 240_000;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() =>
        typeof addr === 'object' && addr ? resolve(addr.port) : reject(new Error('no port')),
      );
    });
  });
}

function check(ok: unknown, what: string): void {
  if (!ok) throw new Error(`check failed: ${what}`);
  console.log(`  ok  ${what}`);
}

function must<T>(x: T | null | undefined, what: string): T {
  if (x === null || x === undefined) throw new Error(`missing: ${what}`);
  return x;
}

async function startWrangler(): Promise<{ base: string; proc: ChildProcess; stateDir: string }> {
  const port = await freePort();
  const inspector = await freePort();
  const stateDir = mkdtempSync(join(tmpdir(), 'catan-e2e-'));
  const proc = spawn(
    'nice',
    [
      '-n',
      '19',
      'node_modules/.bin/wrangler',
      'dev',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      String(inspector),
      '--persist-to',
      stateDir,
      '--var',
      'BOT_DELAY_MS:40',
      '--var',
      'GRACE_MS:2000',
    ],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  const ready = new Promise<void>((resolve, reject) => {
    const onData = (b: Buffer) => {
      log += b.toString();
      if (log.includes('Ready on')) resolve();
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.once('exit', (code) => reject(new Error(`wrangler exited (${code}):\n${log}`)));
    setTimeout(() => reject(new Error(`wrangler not ready after 60 s:\n${log}`)), 60_000);
  });
  await ready;
  return { base: `http://127.0.0.1:${port}`, proc, stateDir };
}

/** One browser tab: a socket, its inbox, and a random-bot autopilot for its seat. */
class Client {
  readonly inbox: ServerMessage[] = [];
  ws!: WebSocket;
  token: string | null;
  autopilot = false;
  private actedOn = -1;
  private readonly rng: Rng;
  private waiters: (() => void)[] = [];

  constructor(
    readonly name: string,
    private readonly url: string,
    token: string | null,
  ) {
    this.token = token;
    this.rng = Rng.fromSeed(`e2e-${name}`);
  }

  async connect(): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('message', (e) => this.onMessage(String(e.data)));
    this.ws.addEventListener('close', () => this.wake());
    await new Promise<void>((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error(`${this.name}: socket error`)), {
        once: true,
      });
    });
    this.send({ type: 'hello', token: this.token, name: this.name });
    const welcome = await this.waitFor((m) => m.type === 'welcome');
    if (welcome.type === 'welcome') this.token = welcome.you.token;
  }

  send(body: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ v: PROTOCOL_VERSION, ...body }));
  }

  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      const m = must(this.inbox[i], 'message');
      if (m.type === type) return m as Extract<ServerMessage, { type: T }>;
    }
    return undefined;
  }

  waitFor(pred: (m: ServerMessage) => boolean, ms = 10_000): Promise<ServerMessage> {
    const start = this.inbox.length;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name}: timed out waiting`)), ms);
      const look = () => {
        const hit = this.inbox.slice(start).find(pred);
        if (hit) {
          clearTimeout(timer);
          this.waiters = this.waiters.filter((w) => w !== look);
          resolve(hit);
        }
      };
      this.waiters.push(look);
      look();
    });
  }

  private onPong: (() => void) | null = null;

  ping(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name}: no pong`)), 5_000);
      this.onPong = () => {
        clearTimeout(timer);
        resolve();
      };
      this.ws.send('ping');
    });
  }

  private wake(): void {
    for (const w of [...this.waiters]) w();
  }

  private onMessage(raw: string): void {
    if (raw === 'pong') {
      this.onPong?.();
      return;
    }
    const parsed = parseServerMessage(raw);
    if (!parsed.ok) throw new Error(`${this.name}: bad server frame ${raw.slice(0, 80)}`);
    this.inbox.push(parsed.msg);
    this.wake();
    if (parsed.msg.type === 'game' && this.autopilot) {
      setTimeout(() => this.act(), 5);
    }
    // A rate-limited intent was dropped and no new state follows: try that move again later
    // (without this the game hangs on that player's move: no turn timer in this test).
    if (parsed.msg.type === 'error' && parsed.msg.code === 'rate_limited' && this.autopilot) {
      this.actedOn = -1;
      setTimeout(() => this.act(), 500);
    }
  }

  /** Play the latest game message once (a stale_state reply re-sends it with a new seq). */
  private act(): void {
    const game = this.last('game');
    if (!game || game.seq === this.actedOn || this.ws.readyState !== WebSocket.OPEN) return;
    const seat = game.view.view.viewer;
    const legal = game.legal.filter((a: Action) => a.type !== 'offerTrade');
    if (seat === null || legal.length === 0) return;
    this.actedOn = game.seq;
    // The random bot reads the masked view here (the server's bots get the full state).
    let pick: Action;
    try {
      pick = defaultBot(game.view as GameState, seat, this.rng, legal) ?? must(legal[0], 'move');
    } catch {
      pick = this.rng.pick(legal);
    }
    this.send({ type: 'intent', action: pick, seq: game.seq });
  }
}

interface ExpansionGame {
  label: string;
  config: Partial<RoomConfig>;
  /** Secrets of other seats / face-down stacks are masked in this client's view (or why not). */
  hidden: (view: GameView) => string | null;
  /** Longer than EXPANSION_TIMEOUT_MS for slow games (random bots on Seafarers maps). */
  timeoutMs?: number;
}

const opponents = (view: GameView) => view.players.filter((p) => p.id !== view.view.viewer);

const EXPANSION_GAMES: ExpansionGame[] = [
  {
    label: 'Cities & Knights',
    config: { mode: 'ck', scenario: 'ck/classic', vpToWin: 6 },
    hidden: (view) => {
      const ck = view.ext['ck'] as {
        players: { progress: string[] }[];
        decks: Record<string, string[]>;
      };
      const decks = Object.values(ck.decks).flat();
      if (new Set(decks).size > 1) return 'progress deck order is visible';
      // The Spy shows its player the victim's hand (ck/engine/mask.ts): that one is allowed.
      const phase = view.phase as { kind: string; card?: string; victim?: number | null };
      const spied =
        phase.kind === 'ck/card' && phase.card === 'spy' && view.turn.current === view.view.viewer
          ? phase.victim
          : null;
      for (const p of opponents(view)) {
        if (p.id === spied) continue;
        if (new Set(ck.players[p.id]?.progress).size > 1) return `${p.name}'s progress cards`;
      }
      return null;
    },
  },
  {
    label: 'Seafarers: The Fog Islands',
    config: { mode: 'seafarers', scenario: 'seafarers/fogIslands', vpToWin: 5 },
    hidden: (view) => {
      const fog = (view.ext['seafarers'] as { fog?: { terrains: string[]; tokens: number[] } }).fog;
      if (!fog) return 'no fog stacks';
      if (fog.terrains.some((t) => t !== 'fog') || fog.tokens.some((t) => t !== 0)) {
        return 'fog stack contents are visible';
      }
      return null;
    },
  },
  {
    label: 'T&B + Seafarers: Fishermen on New Shores',
    config: { mode: 'tb+seafarers', scenario: 'tbsea/fishermen', vpToWin: 4 },
    timeoutMs: 480_000,
    hidden: (view) => {
      const fish = (view.ext['tb'] as { fish?: { pool: number[]; hands: number[][] } }).fish;
      if (!fish) return 'no fish';
      // 0 = the masked token (tb/engine/mask.ts HIDDEN_FISH); the boot is 0 too, so any 1-3 leaks.
      if (fish.pool.some((t) => t !== 0)) return 'the fish pool is visible';
      for (const p of opponents(view)) {
        if ((fish.hands[p.id] ?? []).some((t) => t !== 0)) return `${p.name}'s fish`;
      }
      return null;
    },
  },
  {
    label: 'Explorers & Pirates: Land Ho!',
    config: { mode: 'ep', scenario: 'ep/landHo', vpToWin: 5 },
    hidden: (view) => {
      const ep = view.ext['ep'] as { hidden: Record<string, { terrain: string }> };
      if (Object.values(ep.hidden).some((h) => h.terrain !== 'ep/hidden')) {
        return 'unexplored hexes are visible';
      }
      return null;
    },
  },
];

async function playExpansionGame(base: string, game: ExpansionGame): Promise<void> {
  console.log(`\n${game.label} ...`);
  const created = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { origin: base } });
  const { roomId, hostToken } = (await created.json()) as CreateRoomResponse;
  const wsUrl = `${base.replace('http', 'ws')}${roomSocketPath(roomId)}`;
  const ann = new Client('Ann', wsUrl, hostToken);
  const bob = new Client('Bob', wsUrl, null);
  const clients = [ann, bob];
  for (const c of clients) await c.connect();
  ann.send({
    type: 'configure',
    config: { ...DEFAULT_ROOM_CONFIG, seatCount: 4, turnTimerSec: null, ...game.config },
  });
  await ann.waitFor((m) => m.type === 'room' && m.room.config.mode === game.config.mode);
  check(true, `${game.label}: host configured the mode`);
  for (const [i, c] of clients.entries()) {
    c.send({ type: 'takeSeat', seat: i });
    await c.waitFor((m) => m.type === 'room' && m.room.seats[i]?.status === 'human');
  }
  for (const c of clients) c.autopilot = true;
  ann.send({ type: 'start' });
  await Promise.all(clients.map((c) => c.waitFor((m) => m.type === 'game')));
  const first = must(ann.last('game'), 'game');
  check(first.view.settings.mode === game.config.mode, `${game.label}: game started`);
  const over = await Promise.all(
    clients.map((c) =>
      c.waitFor(
        (m) => m.type === 'game' && m.view.winner !== null,
        game.timeoutMs ?? EXPANSION_TIMEOUT_MS,
      ),
    ),
  ).catch((e: unknown) => {
    for (const c of clients) {
      const g = c.last('game');
      console.error(
        `${c.name}: seq ${g?.seq} turn ${g?.view.turn.number} phase ${g?.view.phase.kind} legal ${JSON.stringify(g?.legal.map((a) => a.type))}`,
      );
    }
    throw e;
  });
  // Every view each client got along the way kept the secrets hidden.
  for (const c of clients) {
    const games = c.inbox.filter((m) => m.type === 'game');
    const leaks = games
      .filter((m) => m.view.phase.kind !== 'gameOver')
      .map((m) => game.hidden(m.view))
      .filter((x) => x !== null);
    check(
      leaks.length === 0,
      `${game.label}: ${c.name}'s ${games.length} views hide secrets ${leaks[0] ?? ''}`,
    );
    const errs = c.inbox.filter((m) => m.type === 'error');
    check(
      errs.every((e) => e.code === 'rate_limited' || e.code === 'stale_state'),
      `${game.label}: ${c.name} had no refused moves ${JSON.stringify(errs.slice(0, 2))}`,
    );
  }
  const final = must(over[0], 'final');
  if (final.type !== 'game') throw new Error('unreachable');
  const winner = must(final.view.players[must(final.view.winner, 'winner')], 'winner');
  check(true, `${game.label}: over after turn ${final.view.turn.number}, ${winner.name} won`);
  for (const c of clients) c.ws.close();
}

async function main(): Promise<void> {
  if (!existsSync('dist/index.html')) {
    console.log('dist/ missing: building the client');
    const r = spawnSync('nice', ['-n', '19', 'pnpm', 'build'], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('build failed');
  }
  console.log('starting wrangler dev ...');
  const { base, proc, stateDir } = await startWrangler();
  const stop = () => {
    try {
      if (proc.pid) process.kill(-proc.pid, 'SIGTERM');
    } catch {
      // already gone
    }
    rmSync(stateDir, { recursive: true, force: true });
  };
  const deadline = setTimeout(() => {
    console.error(`timed out after ${TIMEOUT_MS / 1000} s`);
    stop();
    process.exit(1);
  }, TIMEOUT_MS);
  const clients: Client[] = [];
  try {
    console.log(`server at ${base}`);
    check((await fetch(`${base}/`)).ok, 'static client served at /');

    const evil = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    });
    check(evil.status === 403, 'foreign Origin is refused (403)');

    const created = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { origin: base } });
    check(created.status === 201, 'POST /api/rooms -> 201');
    const { roomId, hostToken } = (await created.json()) as CreateRoomResponse;
    check(/^[2-9A-HJ-NP-Z]{6}$/.test(roomId), `room code ${roomId} is 6 unambiguous chars`);

    const info = (await (
      await fetch(`${base}${roomApiPath(roomId.toLowerCase())}`)
    ).json()) as RoomSummary;
    check(info.roomId === roomId && info.phase === 'lobby', 'GET /api/rooms/:code (any case)');
    check((await fetch(`${base}${roomApiPath('ZZZZZZ')}`)).status === 404, 'unknown room -> 404');

    const wsUrl = `${base.replace('http', 'ws')}${roomSocketPath(roomId)}`;
    const ann = new Client('Ann', wsUrl, hostToken);
    const bob = new Client('Bob', wsUrl, null);
    const cat = new Client('Cat', wsUrl, null);
    clients.push(ann, bob, cat);
    for (const c of clients) await c.connect();
    check(ann.last('welcome')?.you.member === 'm1', 'host joined with the creation token');

    await ann.ping();
    check(true, 'ping -> pong (auto-response)');

    ann.send({
      type: 'configure',
      config: { ...DEFAULT_ROOM_CONFIG, seatCount: 4, vpToWin: 3, turnTimerSec: null },
    });
    for (const [i, c] of clients.entries()) {
      c.send({ type: 'takeSeat', seat: i });
      await c.waitFor((m) => m.type === 'room' && m.room.seats[i]?.status === 'human');
    }
    for (const c of clients) c.autopilot = true;
    ann.send({ type: 'start' });
    await Promise.all(clients.map((c) => c.waitFor((m) => m.type === 'game')));
    check(true, 'game started; every client got its own view');
    for (const [i, c] of clients.entries()) {
      const g = must(c.last('game'), 'game');
      check(
        g.view.view.viewer === i && g.view.settings.seed === 'hidden',
        `${c.name}: own seat view, seed hidden`,
      );
    }

    // Mid-game: Bob drops and comes back with his token.
    await bob.waitFor((m) => m.type === 'game' && m.view.turn.number >= 2, 60_000);
    const bobMember = must(bob.last('welcome'), 'welcome').you.member;
    bob.ws.close();
    await ann.waitFor((m) => m.type === 'room' && m.room.seats[1]?.status !== 'human');
    check(true, 'Bob disconnected: his seat is away/bot for the others');
    await new Promise((r) => setTimeout(r, 300));
    const bob2 = new Client('Bob', wsUrl, bob.token);
    bob2.autopilot = true;
    clients[1] = bob2;
    await bob2.connect();
    check(bob2.last('welcome')?.you.member === bobMember, 'Bob reconnected as the same member');
    await bob2.waitFor((m) => m.type === 'game');
    check(bob2.last('game')?.view.view.viewer === 1, 'Bob got his seat view back');

    console.log('playing to the end ...');
    const over = await Promise.all(
      clients.map((c) => c.waitFor((m) => m.type === 'game' && m.view.winner !== null, 160_000)),
    ).catch((e: unknown) => {
      // Say where it hung: phase, log tail and each client's legal moves.
      for (const c of clients) {
        const g = c.last('game');
        const errs = c.inbox.filter((m) => m.type === 'error').slice(-2);
        console.error(
          `${c.name}: seq ${g?.seq} phase ${g?.view.phase.kind} legal ${JSON.stringify(g?.legal.map((a) => a.type))} errors ${JSON.stringify(errs)}`,
        );
      }
      const g = clients[0]?.last('game');
      for (const l of g?.view.log.slice(-8) ?? []) console.error(`  T${l.turn} ${l.text}`);
      throw e;
    });
    const final = must(over[0], 'final game');
    if (final.type !== 'game') throw new Error('unreachable');
    const winner = must(final.view.players[must(final.view.winner, 'winner')], 'winner');
    check(true, `game over after turn ${final.view.turn.number}: ${winner.name} won`);
    const end = (await (await fetch(`${base}${roomApiPath(roomId)}`)).json()) as RoomSummary;
    check(end.phase === 'over', 'room phase is over');
    for (const c of clients) c.ws.close();

    // Expansion games (X1): two network clients + two server bots, played to the end.
    for (const game of EXPANSION_GAMES) await playExpansionGame(base, game);
    console.log('e2e passed');
  } finally {
    clearTimeout(deadline);
    stop();
  }
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
