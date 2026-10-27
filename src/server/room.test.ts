import { describe, expect, it } from 'vitest';
import { HIDDEN_SEED, Rng, type Action, type GameState } from '../engine';
import { defaultBot } from '../game/controller';
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from '../net/protocol';
import { DEFAULT_SESSION_OPTIONS, type SessionSnapshot } from '../net/session';
import { SERVER_LIMITS } from './limits';
import { CLOSE_POLICY, RETRY_AFTER_ERROR_MS, sessionDeps, sessionOptionsFrom } from './room';
import { FakeRuntime, type FakeSocket } from './testRuntime';

async function newRoom(options?: ConstructorParameters<typeof FakeRuntime>[0]) {
  const rt = new FakeRuntime(options);
  await rt.load();
  const created = await rt.core.create('ABC234');
  if (!created) throw new Error('create failed');
  return { rt, hostToken: created.hostToken };
}

/** Host Ann in seat 0, Bob in seat 1, seat 2 open (bot); started. */
async function started(config: Partial<RoomConfig> = {}, options = {}) {
  const { rt, hostToken } = await newRoom({ botDelayMs: 0, ...options });
  const ann = (await rt.connect('1.1.1.1'))!;
  await rt.send(ann, { type: 'hello', token: hostToken, name: 'Ann' });
  const bob = (await rt.connect('2.2.2.2'))!;
  await rt.send(bob, { type: 'hello', token: null, name: 'Bob' });
  const bobToken = bob.last('welcome')!.you.token;
  await rt.send(ann, {
    type: 'configure',
    config: { ...DEFAULT_ROOM_CONFIG, seatCount: 3, turnTimerSec: null, ...config },
  });
  await rt.send(ann, { type: 'takeSeat', seat: 0 });
  await rt.send(bob, { type: 'takeSeat', seat: 1 });
  await rt.send(ann, { type: 'start' });
  return { rt, ann, bob, hostToken, bobToken };
}

const rng = Rng.fromSeed('test-client');

/** One move for whichever socket has legal actions (random bot policy, no trade offers). */
async function step(rt: FakeRuntime, players: FakeSocket[]): Promise<boolean> {
  for (const s of players) {
    const game = s.last('game');
    const legal = (game?.legal ?? []).filter((a: Action) => a.type !== 'offerTrade');
    if (!game || legal.length === 0) continue;
    const seat = game.view.view.viewer;
    if (seat === null) continue;
    const pick = defaultBot(game.view as GameState, seat, rng, legal) ?? legal[0]!;
    await rt.send(s, { type: 'intent', action: pick, seq: game.seq });
    return true;
  }
  return false;
}

describe('RoomCore: create and info', () => {
  it('creates once; a second create on the same object is a collision', async () => {
    const { rt } = await newRoom();
    expect(rt.core.exists).toBe(true);
    expect(await rt.core.create('ABC234')).toBeNull();
    expect(rt.stored).toBeDefined();
    // An empty room expires after idleExpiryMs, so the alarm is set right away.
    expect(rt.alarmAt).toBe(rt.now + 24 * 3600_000);
  });

  it('info: public counts only, null for a missing room', async () => {
    const empty = new FakeRuntime();
    await empty.load();
    expect(await empty.core.info()).toBeNull();
    expect(await empty.core.admit('1.1.1.1')).toEqual([404, 'no such room']);

    const { rt, ann } = await started();
    expect(await rt.core.info()).toEqual({
      roomId: 'ABC234',
      phase: 'playing',
      seats: 3,
      taken: 2,
      connected: 2,
    });
    expect(JSON.stringify(await rt.core.info())).not.toContain(ann.last('welcome')!.you.token);
  });
});

describe('RoomCore: sockets and security', () => {
  it('fans out per-player views: own hand visible, others masked, no seed', async () => {
    const { ann, bob } = await started();
    const a = ann.last('game')!;
    const b = bob.last('game')!;
    expect(a.view.view.viewer).toBe(0);
    expect(b.view.view.viewer).toBe(1);
    expect(a.view.settings.seed).toBe(HIDDEN_SEED);
    expect(a.legal.every((x) => x.player === 0)).toBe(true);
    expect(b.legal.every((x) => x.player === 1)).toBe(true);
    // Every frame on the wire, for both players: never another member's token.
    const annToken = ann.last('welcome')!.you.token;
    const bobToken = bob.last('welcome')!.you.token;
    expect(bob.sent.join('\n')).not.toContain(annToken);
    expect(ann.sent.join('\n')).not.toContain(bobToken);
  });

  it('caps sockets per IP and per room; stale sockets without hello make room', async () => {
    const { rt } = await newRoom();
    for (let i = 0; i < SERVER_LIMITS.socketsPerIp; i++)
      expect(await rt.connect('9.9.9.9')).not.toBeNull();
    expect(await rt.core.admit('9.9.9.9')).toEqual([429, 'too many connections from your network']);

    let n = SERVER_LIMITS.socketsPerIp;
    for (let ip = 0; n < SERVER_LIMITS.socketsPerRoom; ip++, n++) await rt.connect(`10.0.0.${ip}`);
    expect(await rt.core.admit('8.8.8.8')).toEqual([503, 'room is full']);

    rt.now += SERVER_LIMITS.helloTimeoutMs;
    const s = await rt.connect('8.8.8.8');
    expect(s).not.toBeNull();
    const evicted = [...rt.sockets.values()].filter((x) => x.closedWith?.reason === 'no hello');
    expect(evicted).toHaveLength(1);
  });

  it('rejects binary and oversized frames before the session sees them', async () => {
    const { rt } = await newRoom();
    const s = (await rt.connect())!;
    await rt.core.message(s, new ArrayBuffer(4));
    await rt.core.message(s, 'x'.repeat(SERVER_LIMITS.messageChars + 1));
    expect(s.of('error').map((e) => e.code)).toEqual(['bad_message', 'bad_message']);
  });

  it('per-socket frame limit: drops with rate_limited, then closes a flooder', async () => {
    const { rt } = await newRoom();
    const s = (await rt.connect())!;
    const frame = JSON.stringify({ v: 1, type: 'sync' });
    for (let i = 0; i < SERVER_LIMITS.frame.burst; i++) await rt.core.message(s, frame);
    expect(s.of('error').every((e) => e.code === 'not_joined')).toBe(true);
    await rt.core.message(s, frame);
    expect(s.last('error')!.code).toBe('rate_limited');
    for (let i = 1; i < SERVER_LIMITS.frameStrikes; i++) await rt.core.message(s, frame);
    expect(s.closedWith?.code).toBe(CLOSE_POLICY);
  });
});

describe('RoomCore: storage and alarms', () => {
  it('persists after every change and skips identical snapshots', async () => {
    const { rt, ann } = await started();
    const before = rt.saves;
    await rt.send(ann, { type: 'chat', text: 'hi' });
    expect(rt.saves).toBe(before + 1);
    const snap = JSON.parse(rt.stored!) as SessionSnapshot;
    expect(snap.chat.at(-1)!.text).toBe('hi');
    // An alarm with nothing due changes nothing: no write.
    const saves = rt.saves;
    await rt.core.alarm();
    expect(rt.saves).toBe(saves);
  });

  it('plays a full game with bots on alarms, surviving hibernation and eviction', async () => {
    const { rt, ann, bob, bobToken } = await started({ vpToWin: 3 }, { botDelayMs: 300 });
    let players = [ann, bob];
    let hibernated = false;
    let evicted = false;
    for (let i = 0; i < 5000 && rt.core.current?.phase === 'playing'; i++) {
      const turn = rt.core.current.state!.turn.number;
      if (!hibernated && turn >= 2) {
        hibernated = true;
        const seq = rt.core.current.seq;
        await rt.hibernate();
        expect(rt.core.current!.seq).toBe(seq);
      }
      if (!evicted && turn >= 4) {
        evicted = true;
        // Restart: every socket is gone; the room must keep its game and let people back in.
        await rt.evict();
        expect(rt.core.current!.room().members.every((m) => !m.connected)).toBe(true);
        expect(rt.core.current!.room().seats.map((s) => s.status)).toEqual(['away', 'away', 'bot']);
        const newAnn = (await rt.connect('1.1.1.1'))!;
        await rt.send(newAnn, { type: 'hello', token: ann.last('welcome')!.you.token });
        const newBob = (await rt.connect('2.2.2.2'))!;
        await rt.send(newBob, { type: 'hello', token: bobToken });
        expect(newBob.last('welcome')!.you.member).toBe(bob.last('welcome')!.you.member);
        expect(newBob.last('game')!.view.view.viewer).toBe(1);
        players = [newAnn, newBob];
      }
      if (!(await step(rt, players))) await rt.advance(300);
    }
    expect(hibernated && evicted).toBe(true);
    expect(rt.core.current!.phase).toBe('over');
    const last = players[0]!.last('game')!;
    expect(last.view.winner).not.toBeNull();
    // Saved state is the finished game.
    expect((JSON.parse(rt.stored!) as SessionSnapshot).phase).toBe('over');
  });

  it('alarm follows nextWakeAt; an idle room expires and is deleted', async () => {
    const { rt, hostToken } = await newRoom();
    const s = (await rt.connect())!;
    await rt.send(s, { type: 'hello', token: hostToken, name: 'Ann' });
    expect(rt.alarmAt).toBeNull(); // lobby, someone connected: nothing scheduled
    await rt.disconnect(s);
    // Ann sat down on joining (L1): her lobby seat is kept for the grace period first.
    const grace = DEFAULT_SESSION_OPTIONS.graceMs;
    expect(rt.alarmAt).toBe(rt.now + grace);
    await rt.advance(grace);
    expect(rt.alarmAt).toBe(rt.now - grace + 24 * 3600_000); // empty room: idle expiry
    await rt.advance(24 * 3600_000 - grace);
    expect(rt.core.exists).toBe(false);
    expect(rt.stored).toBeUndefined();
    expect(rt.alarmAt).toBeNull();
    expect(await rt.core.info()).toBeNull();
    // The code is free again.
    expect(await rt.core.create('ABC234')).not.toBeNull();
  });

  it('a session error rolls back to the last snapshot and retries later', async () => {
    let calls = 0;
    const flaky: typeof defaultBot = (...args) => {
      if (calls++ === 0) throw new Error('bot bug');
      return defaultBot(...args);
    };
    const { rt, ann, bob } = await started({}, { botDelayMs: 300, bot: flaky });
    // Play humans until the bot seat is due; the first bot move throws.
    for (let i = 0; i < 200 && calls === 0; i++) {
      if (!(await step(rt, [ann, bob]))) await rt.advance(300);
    }
    expect(rt.logs.some((l) => l.includes('session error'))).toBe(true);
    const seq = rt.core.current!.seq;
    expect(rt.alarmAt).toBeGreaterThanOrEqual(rt.now + RETRY_AFTER_ERROR_MS);
    await rt.advance(RETRY_AFTER_ERROR_MS);
    expect(rt.core.current!.seq).toBeGreaterThan(seq);
  });
});

describe('platform helpers', () => {
  it('sessionDeps: 32-symbol url-safe tokens, hex seeds', () => {
    let i = 0;
    const deps = sessionDeps((n) => Uint8Array.from({ length: n }, () => i++ % 256));
    expect(deps.token()).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(deps.seed()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('sessionOptionsFrom: integers in range only', () => {
    expect(sessionOptionsFrom({})).toEqual({});
    expect(sessionOptionsFrom({ BOT_DELAY_MS: '50', GRACE_MS: '5000' })).toEqual({
      botDelayMs: 50,
      graceMs: 5000,
    });
    expect(sessionOptionsFrom({ BOT_DELAY_MS: 'x', GRACE_MS: '1' })).toEqual({});
  });
});
