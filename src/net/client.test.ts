import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_CONFIG, type ServerMessage } from './protocol';
import { backoffDelay, RoomClient, type ClientEvent, type RoomClientOptions } from './client';
import { FakeClock, hostConnect, RoomHost } from './loopback';
import { GameSession } from './session';
import { fakeDeps } from './testHarness';
import { parseRoomCode, tokenKey, type KeyStore, type TransportHandlers } from './transport';

const GRACE = 10_000;

function memStore(): KeyStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
}

/** A room on a fake clock, plus a factory for clients connected to it. */
function world() {
  const clock = new FakeClock(1000);
  const { session, hostToken } = GameSession.create('room1', clock.now(), fakeDeps(), {
    graceMs: GRACE,
    botDelayMs: 200,
  });
  const host = new RoomHost(session, clock);
  let offline = false;
  let prefix = 0;
  const client = (name: string, store = memStore(), extra: Partial<RoomClientOptions> = {}) => {
    const events: ClientEvent[] = [];
    const c = new RoomClient({
      roomId: 'room1',
      connect: hostConnect(host, clock, { offline: () => offline, prefix: `p${++prefix}-` }),
      clock,
      store,
      name,
      pingMs: 0,
      ...extra,
    });
    c.on((e) => events.push(e));
    c.start();
    return { c, store, events };
  };
  return {
    clock,
    host,
    session,
    hostToken,
    client,
    setOffline: (v: boolean) => (offline = v),
  };
}

describe('parseRoomCode', () => {
  it('takes codes and invite links', () => {
    expect(parseRoomCode(' k3j9qx ')).toBe('K3J9QX');
    expect(parseRoomCode('https://x.dev/?room=K3J9QX')).toBe('K3J9QX');
    expect(parseRoomCode('https://x.dev/?server=local&room=k3j9qx#x')).toBe('K3J9QX');
    expect(parseRoomCode('https://x.dev/room/K3J9QX')).toBe('K3J9QX');
    expect(parseRoomCode('')).toBeNull();
    expect(parseRoomCode('K3J9Q')).toBeNull();
    // 0, O, 1 and I are not in the alphabet.
    expect(parseRoomCode('K3J9Q0')).toBeNull();
    expect(parseRoomCode('no spaces here')).toBeNull();
    expect(parseRoomCode('%E0%A4%A')).toBeNull();
  });
});

describe('backoffDelay', () => {
  it('doubles up to the cap', () => {
    const b = { baseMs: 500, maxMs: 4000, factor: 2 };
    expect([1, 2, 3, 4, 5, 9].map((n) => backoffDelay(n, b))).toEqual([
      500, 1000, 2000, 4000, 4000, 4000,
    ]);
  });
});

describe('RoomClient over LocalNet', () => {
  it('joins with the host token, stores it, and sees the lobby', () => {
    const w = world();
    const store = memStore();
    store.set(tokenKey('room1'), w.hostToken);
    const { c, events } = w.client('Ann', store);
    expect(c.status).toBe('connecting');
    w.clock.flush();
    expect(c.status).toBe('open');
    expect(c.isHost).toBe(true);
    expect(c.me?.name).toBe('Ann');
    expect(c.room?.phase).toBe('lobby');
    expect(events.map((e) => e.type)).toContain('room');
    expect(store.get(tokenKey('room1'))).toBe(w.hostToken);
  });

  it('a new member gets and keeps a token', () => {
    const w = world();
    const { c, store } = w.client('Bob');
    w.clock.flush();
    expect(c.isHost).toBe(false);
    const token = store.get(tokenKey('room1'));
    expect(token).toBe(c.you?.token);
    expect(token).toMatch(/^t\d+$/);
  });

  it('lobby flow: seats, config, start; both get their own view and legal actions', () => {
    const w = world();
    const annStore = memStore();
    annStore.set(tokenKey('room1'), w.hostToken);
    const ann = w.client('Ann', annStore).c;
    const bob = w.client('Bob').c;
    w.clock.flush();
    ann.configure({ ...DEFAULT_ROOM_CONFIG, seatCount: 3 });
    ann.send({ type: 'takeSeat', seat: 0 });
    bob.send({ type: 'takeSeat', seat: 1 });
    w.clock.flush();
    expect(bob.room?.config.seatCount).toBe(3);
    expect(bob.mySeat).toBe(1);
    ann.send({ type: 'start' });
    w.clock.flush();
    expect(ann.room?.phase).toBe('playing');
    expect(ann.game?.view.view.viewer).toBe(0);
    expect(bob.game?.view.view.viewer).toBe(1);
    const mover = [ann, bob].find((x) => (x.game?.legal.length ?? 0) > 0)!;
    const other = mover === ann ? bob : ann;
    expect(other.game?.legal).toEqual([]);
    const seq = mover.game!.seq;
    expect(mover.intent(mover.game!.legal[0]!)).toBe(true);
    w.clock.flush();
    expect(mover.game!.seq).toBeGreaterThan(seq);
    expect(other.game!.seq).toBe(mover.game!.seq);
  });

  it('server errors reach the UI as events; stale intents get the current state back', () => {
    const w = world();
    const { c, events } = w.client('Eve');
    w.clock.flush();
    c.send({ type: 'start' });
    w.clock.flush();
    const err = events.find((e) => e.type === 'error');
    expect(err).toMatchObject({ type: 'error', code: 'not_host', ref: 'start' });
    expect(c.status).toBe('open');
  });

  it('reconnects with backoff after a drop and keeps the same member', () => {
    const w = world();
    const { c, events } = w.client('Bob');
    w.clock.flush();
    const member = c.you!.member;
    w.setOffline(true);
    w.host.cut(w.host.conns()[0]!);
    w.clock.flush();
    expect(c.status).toBe('reconnecting');
    // 500, 1000, 2000 ms: every attempt fails while the network is down.
    w.clock.advance(500);
    expect(c.attempts).toBe(2);
    w.clock.advance(1000);
    expect(c.attempts).toBe(3);
    w.setOffline(false);
    w.clock.advance(1999);
    expect(c.status).toBe('reconnecting');
    w.clock.advance(1);
    expect(c.status).toBe('open');
    expect(c.attempts).toBe(0);
    expect(c.you!.member).toBe(member);
    const statuses = events.filter((e) => e.type === 'status').map((e) => e.status);
    expect(statuses).toEqual(['open', 'reconnecting', 'open']);
  });

  it('retryNow skips the wait', () => {
    const w = world();
    const { c } = w.client('Bob');
    w.clock.flush();
    w.host.cut(w.host.conns()[0]!);
    w.clock.flush();
    expect(c.status).toBe('reconnecting');
    c.retryNow();
    w.clock.flush();
    expect(c.status).toBe('open');
  });

  it('mid-game: away within the grace, a bot after it, reclaimed on reconnect', () => {
    const w = world();
    const annStore = memStore();
    annStore.set(tokenKey('room1'), w.hostToken);
    const ann = w.client('Ann', annStore).c;
    const bob = w.client('Bob').c;
    w.clock.flush();
    ann.configure({ ...DEFAULT_ROOM_CONFIG, seatCount: 3 });
    ann.send({ type: 'takeSeat', seat: 0 });
    bob.send({ type: 'takeSeat', seat: 1 });
    ann.send({ type: 'start' });
    w.clock.flush();
    const bobConn = w.host.conns().find((x) => x.startsWith('p2-'))!;
    w.setOffline(true);
    w.host.cut(bobConn);
    w.clock.flush();
    expect(ann.room?.seats[1]?.status).toBe('away');
    w.clock.advance(GRACE + 1);
    expect(ann.room?.seats[1]?.status).toBe('bot');
    expect(ann.chat.some((e) => /Bob is away/.test(e.text))).toBe(true);
    w.setOffline(false);
    bob.retryNow();
    w.clock.advance(20_000);
    expect(bob.status).toBe('open');
    expect(ann.room?.seats[1]?.status).toBe('human');
    expect(bob.game?.view.view.viewer).toBe(1);
  });

  it('stops for good on a fatal close (another tab took over)', () => {
    const w = world();
    const store = memStore();
    const first = w.client('Bob', store);
    w.clock.flush();
    const second = w.client('Bob', store);
    w.clock.flush();
    expect(second.c.status).toBe('open');
    expect(first.c.status).toBe('closed');
    expect(first.c.fatal?.code).toBe('replaced');
    w.clock.advance(60_000);
    expect(first.c.status).toBe('closed');
    expect(w.host.connections).toBe(1);
  });

  it('spectators: joining a running game gives the spectator view and no legal actions', () => {
    const w = world();
    const annStore = memStore();
    annStore.set(tokenKey('room1'), w.hostToken);
    const ann = w.client('Ann', annStore).c;
    w.clock.flush();
    ann.send({ type: 'takeSeat', seat: 0 });
    ann.send({ type: 'start' });
    w.clock.flush();
    const eve = w.client('Eve').c;
    w.clock.flush();
    expect(eve.mySeat).toBeNull();
    expect(eve.game?.view.view.viewer).toBeNull();
    expect(eve.game?.legal).toEqual([]);
    expect(eve.chatSend('hi all')).toBe(true);
    w.clock.flush();
    expect(ann.chat.at(-1)?.text).toBe('hi all');
  });

  it('reactions are broadcast; sending while disconnected returns false', () => {
    const w = world();
    const ann = w.client('Ann');
    const bob = w.client('Bob');
    w.clock.flush();
    ann.c.react('clap');
    w.clock.flush();
    expect(bob.events.find((e) => e.type === 'reaction')).toMatchObject({ reaction: 'clap' });
    ann.c.close();
    expect(ann.c.react('gg')).toBe(false);
    expect(ann.c.status).toBe('closed');
  });

  it('the turn timer counts down from the arrival time', () => {
    const w = world();
    const store = memStore();
    store.set(tokenKey('room1'), w.hostToken);
    const ann = w.client('Ann', store).c;
    w.clock.flush();
    ann.configure({ ...DEFAULT_ROOM_CONFIG, seatCount: 3, turnTimerSec: 60 });
    ann.send({ type: 'takeSeat', seat: 0 });
    ann.send({ type: 'start' });
    w.clock.flush();
    // Wait until the human is on the clock (bots may set up first).
    for (let i = 0; i < 50 && ann.game?.timer?.player !== 0; i++) w.clock.advance(250);
    const t = ann.game!.timer!;
    expect(t.totalMs).toBe(60_000);
    expect(ann.timerLeftMs(ann.game!.receivedAt + 1500)).toBe(t.remainingMs - 1500);
    expect(ann.timerLeftMs(ann.game!.receivedAt + 10 ** 7)).toBe(0);
  });

  it('dead socket detection: no frames for deadMs -> reconnect', () => {
    const clock = new FakeClock(0);
    let opened = 0;
    const sent: string[] = [];
    let handlers: TransportHandlers | null = null;
    const c = new RoomClient({
      roomId: 'r1x',
      clock,
      pingMs: 1000,
      deadMs: 3000,
      connect: (h) => {
        opened++;
        handlers = h;
        clock.setTimeout(() => h.onOpen(), 0);
        return { send: (t) => sent.push(t), close: () => undefined };
      },
    });
    c.start();
    clock.flush();
    const welcome: ServerMessage = {
      v: 1,
      type: 'welcome',
      you: { member: 'm1', token: 'tok0000000000000001' },
      room: {
        id: 'r1x',
        phase: 'lobby',
        host: 'm1',
        config: DEFAULT_ROOM_CONFIG,
        seats: [],
        members: [],
      },
      chat: [],
    };
    handlers!.onMessage(JSON.stringify(welcome));
    expect(c.status).toBe('open');
    clock.advance(1000);
    expect(sent.at(-1)).toBe('ping');
    clock.advance(2000);
    expect(c.status).toBe('reconnecting');
    clock.advance(500);
    expect(opened).toBe(2);
  });

  it('version mismatch is fatal', () => {
    const clock = new FakeClock(0);
    let handlers: TransportHandlers | null = null;
    const c = new RoomClient({
      roomId: 'r1x',
      clock,
      connect: (h) => {
        handlers = h;
        clock.setTimeout(() => h.onOpen(), 0);
        return { send: () => undefined, close: () => undefined };
      },
    });
    c.start();
    clock.flush();
    handlers!.onMessage(JSON.stringify({ v: 99, type: 'room' }));
    expect(c.status).toBe('closed');
    expect(c.fatal?.code).toBe('version_mismatch');
  });
});
