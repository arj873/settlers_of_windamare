/**
 * End-to-end check of the room server (M2): starts `wrangler dev` on a free port, creates a room
 * over HTTP, connects 3 WebSocket clients (host + 2 friends; the 4th seat is a server bot), plays
 * a 3-VP game to the end with random-bot clients, and drops + reconnects one player mid-game.
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
import { Rng, type Action, type GameState } from '../src/engine';
import { defaultBot } from '../src/game/controller';
import type { CreateRoomResponse, RoomSummary } from '../src/net/api';
import { roomApiPath, roomSocketPath } from '../src/net/api';
import {
  DEFAULT_ROOM_CONFIG,
  parseServerMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '../src/net/protocol';

const TIMEOUT_MS = 180_000;

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
  }

  /** Play the latest game message once (a stale_state reply re-sends it with a new seq). */
  private act(): void {
    const game = this.last('game');
    if (!game || game.seq === this.actedOn || this.ws.readyState !== WebSocket.OPEN) return;
    const seat = game.view.view.viewer;
    const legal = game.legal.filter((a: Action) => a.type !== 'offerTrade');
    if (seat === null || legal.length === 0) return;
    this.actedOn = game.seq;
    const pick =
      defaultBot(game.view as GameState, seat, this.rng, legal) ?? must(legal[0], 'move');
    this.send({ type: 'intent', action: pick, seq: game.seq });
  }
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
      clients.map((c) =>
        c.waitFor((m) => m.type === 'game' && m.view.winner !== null, TIMEOUT_MS - 20_000),
      ),
    );
    const final = must(over[0], 'final game');
    if (final.type !== 'game') throw new Error('unreachable');
    const winner = must(final.view.players[must(final.view.winner, 'winner')], 'winner');
    check(true, `game over after turn ${final.view.turn.number}: ${winner.name} won`);
    const end = (await (await fetch(`${base}${roomApiPath(roomId)}`)).json()) as RoomSummary;
    check(end.phase === 'over', 'room phase is over');
    for (const c of clients) c.ws.close();
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
