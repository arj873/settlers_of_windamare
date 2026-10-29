import { describe, expect, it } from 'vitest';
import { viewFor, type Action, type GameState } from '../../engine';
import { moveRobberGame } from '../../engine/fixtures';
import {
  DEFAULT_ROOM_CONFIG,
  FakeClock,
  GameSession,
  hostConnect,
  RoomClient,
  RoomHost,
  tokenKey,
  type KeyStore,
  type RoomInfo,
} from '../../net';
import { fakeDeps } from '../../net/testHarness';
import type { HudEvents, HudView } from '../../ui';
import type { SpotPromptRequest } from '../../ui/spotPrompt';
import type { BoardLike, HudLike } from '../controller';
import { locationOf } from '../logic';
import type { SpotPromptLike } from '../spotPicker';
import { NetGameController, seatFlags } from './netController';

type Handlers = { [K in keyof HudEvents]?: (p: HudEvents[K]) => void };

function fakeHud() {
  const handlers: Handlers = {};
  const renders: { state: GameState; view: HudView }[] = [];
  const timers: HudView['turnTimer'][] = [];
  const hud: HudLike = {
    render: (state, view) => void renders.push({ state, view }),
    on: (event, cb) => {
      (handlers as Record<string, unknown>)[event] = cb;
    },
    isCovered: () => false,
    setTurnTimer: (t) => void timers.push(t),
  };
  return { hud, handlers, renders, timers };
}

function fakeBoard() {
  const clicks: Record<string, (id: string) => void> = {};
  const highlights: unknown[] = [];
  const board = {
    render: () => undefined,
    setHighlights: (h: unknown) => void highlights.push(h),
    on: (event: string, cb: (id: string) => void) => {
      clicks[event] = cb;
      return () => delete clicks[event];
    },
  } as unknown as BoardLike;
  return { board, clicks, highlights };
}

const mem = (): KeyStore => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
};

/** Ann (host, seat 0) and Bob (seat 1), 3 seats, started; Eve joins later as a spectator. */
/** `seed`: the game seed (default: the harness's `seed-1`). */
function table(config = {}, seed?: string) {
  const clock = new FakeClock(1000);
  const deps = seed === undefined ? fakeDeps() : { ...fakeDeps(), seed: () => seed };
  const { session, hostToken } = GameSession.create('K3J9QX', clock.now(), deps, {
    graceMs: 5000,
    botDelayMs: 100,
  });
  const host = new RoomHost(session, clock);
  const mk = (name: string, store = mem()) => {
    const c = new RoomClient({
      roomId: 'K3J9QX',
      connect: hostConnect(host, clock, { prefix: `${name}-` }),
      clock,
      store,
      name,
      pingMs: 0,
    });
    c.start();
    return c;
  };
  const annStore = mem();
  annStore.set(tokenKey('K3J9QX'), hostToken);
  const ann = mk('Ann', annStore);
  const bob = mk('Bob');
  clock.flush();
  ann.configure({ ...DEFAULT_ROOM_CONFIG, seatCount: 3, ...config });
  ann.send({ type: 'takeSeat', seat: 0 });
  bob.send({ type: 'takeSeat', seat: 1 });
  ann.send({ type: 'start' });
  clock.flush();
  return { clock, host, ann, bob, mk };
}

function controller(client: RoomClient, prompt: SpotPromptLike | null = null) {
  const h = fakeHud();
  const b = fakeBoard();
  let tick: (() => void) | null = null;
  const net = new NetGameController({
    board: b.board,
    hud: h.hud,
    client,
    prompt,
    every: (fn) => {
      tick = fn;
      return () => (tick = null);
    },
  });
  net.start();
  return { net, ...h, ...b, tick: () => tick?.() };
}

describe('seatFlags', () => {
  it('bots and disconnected owners', () => {
    const room = {
      seats: [
        { index: 0, color: 'a', occupant: 'm1', status: 'human' },
        { index: 1, color: 'b', occupant: 'm2', status: 'away' },
        { index: 2, color: 'c', occupant: 'm3', status: 'bot' },
        { index: 3, color: 'd', occupant: null, status: 'bot' },
      ],
      members: [
        { id: 'm1', name: 'A', connected: true, seat: 0 },
        { id: 'm2', name: 'B', connected: false, seat: 1 },
        { id: 'm3', name: 'C', connected: false, seat: 2 },
      ],
    } as unknown as RoomInfo;
    expect(seatFlags(room, 4)).toEqual({
      bots: [false, false, true, true],
      away: [false, true, true, false],
    });
  });
});

describe('NetGameController', () => {
  it('renders each server view for its seat and sends HUD actions as intents', () => {
    const t = table();
    const a = controller(t.ann);
    const b = controller(t.bob);
    expect(a.renders.at(-1)!.view.viewer).toBe(0);
    expect(b.renders.at(-1)!.view.viewer).toBe(1);
    expect(a.renders.at(-1)!.view.bots).toEqual([false, false, true]);
    // Play the humans' first legal action until a few moves happened.
    for (let i = 0; i < 40; i++) {
      const mover = [a, b].find((x) => x.renders.at(-1)!.view.legal.length > 0);
      if (!mover) {
        t.clock.advance(100);
        continue;
      }
      const act = mover.renders.at(-1)!.view.legal[0]!;
      mover.handlers.action!(act);
      t.clock.flush();
    }
    expect(t.ann.game!.seq).toBeGreaterThan(5);
    // Both see the same public board.
    const pa = a.renders.at(-1)!.state.pieces;
    const pb = b.renders.at(-1)!.state.pieces;
    expect(pa).toEqual(pb);
  });

  it('board clicks become intents only for highlighted targets', () => {
    const t = table({ seatCount: 3 });
    const a = controller(t.ann);
    const b = controller(t.bob);
    const ctl = [
      { c: a, client: t.ann },
      { c: b, client: t.bob },
    ];
    for (let i = 0; i < 20 && !ctl.some((x) => x.c.net.boardActions.length > 0); i++) {
      t.clock.advance(100);
    }
    const mover = ctl.find((x) => x.c.net.boardActions.length > 0)!;
    const target = mover.c.net.boardActions[0] as Extract<Action, { vertex: string }>;
    expect(target.type).toBe('placeSetupSettlement');
    const seq = mover.client.game!.seq;
    mover.c.clicks['vertexClick']!('v:99,99,N');
    t.clock.flush();
    expect(mover.client.game!.seq).toBe(seq);
    mover.c.clicks['vertexClick']!(target.vertex);
    t.clock.flush();
    expect(mover.client.game!.seq).toBeGreaterThan(seq);
  });

  it('build by clicking a spot: setup clicks act at once, main-phase builds ask first', () => {
    // Humans only roll and end turns here, so they reach a build only on a kind seed (s15:
    // the RNG change made the default seed-1 one where the bot wins first).
    const t = table({ seatCount: 3 }, 'seed-4');
    const reqs: SpotPromptRequest[] = [];
    const prompt: SpotPromptLike = {
      show: (r) => void reqs.push(r),
      hide: () => undefined,
    };
    const ctl = [
      { c: controller(t.ann, prompt), client: t.ann },
      { c: controller(t.bob, prompt), client: t.bob },
    ];
    const mine = () => ctl.find((x) => x.c.net.boardActions.length > 0);
    // Setup: placements are prompts, a click places at once (no question).
    for (let i = 0; i < 200 && t.ann.game!.view.phase.kind !== 'main'; i++) {
      const m = mine();
      const legal = ctl.flatMap((x) => x.c.renders.at(-1)?.view.legal ?? []);
      if (m && t.ann.game!.view.turn.number === 0) {
        const a = m.c.net.boardActions[0]!;
        const at = locationOf(a)!;
        m.c.clicks[`${at.kind}Click`]!(at.id);
      } else {
        const roll = legal.find((a) => a.type === 'rollDice' || a.type === 'endTurn');
        const who = ctl.find((x) => x.c.renders.at(-1)?.view.legal.includes(roll as Action));
        if (roll && who) who.c.handlers.action!(roll);
      }
      t.clock.advance(150);
      t.clock.flush();
    }
    expect(reqs).toEqual([]);
    // Find a human in the main phase with something to build anywhere.
    for (let i = 0; i < 400; i++) {
      const m = mine();
      if (m && m.client.game!.view.phase.kind === 'main') {
        const a = m.c.net.boardActions[0]!;
        expect(m.c.highlights.at(-1)).toMatchObject({ hoverOnly: true });
        const at = locationOf(a)!;
        const seq = m.client.game!.seq;
        m.c.clicks[`${at.kind}Click`]!(at.id);
        expect(reqs.at(-1)?.choices).toContainEqual(a);
        t.clock.flush();
        expect(m.client.game!.seq).toBe(seq); // nothing sent before Build
        reqs.at(-1)!.onPick(a);
        t.clock.flush();
        expect(m.client.game!.seq).toBeGreaterThan(seq);
        return;
      }
      const legal = ctl.flatMap((x) => x.c.renders.at(-1)?.view.legal ?? []);
      const next = legal.find((x) =>
        ['rollDice', 'endTurn', 'discard', 'moveRobber', 'steal', 'rejectTrade'].includes(x.type),
      );
      const who = ctl.find((x) => next && x.c.renders.at(-1)?.view.legal.includes(next));
      if (next && who) who.c.handlers.action!(next);
      t.clock.advance(150);
      t.clock.flush();
    }
    throw new Error('no main-phase build for a human');
  });

  it('spectators get the public view, no legal actions, the spectator flag', () => {
    const t = table();
    const eve = t.mk('Eve');
    t.clock.flush();
    const e = controller(eve);
    const v = e.renders.at(-1)!.view;
    expect(v).toMatchObject({ viewer: -1, legal: [], spectator: true });
    expect(e.net.boardActions).toEqual([]);
    e.handlers.action!({ type: 'endTurn', player: 0 });
    t.clock.flush();
  });

  it('turn timer: counts down on the client clock between messages', () => {
    const t = table({ turnTimerSec: 30 });
    const a = controller(t.ann);
    controller(t.bob);
    for (let i = 0; i < 40 && !t.ann.game?.timer; i++) t.clock.advance(100);
    const total = t.ann.game!.timer!.totalMs;
    expect(total).toBe(30_000);
    const before = a.timers.length;
    t.clock.advance(1000);
    a.tick();
    expect(a.timers.length).toBeGreaterThanOrEqual(before);
    const left = t.ann.timerLeftMs()!;
    expect(left).toBeLessThanOrEqual(30_000);
    expect(a.net.hudView()!.turnTimer!.totalSec).toBe(30);
  });

  it('sends the only steal at once and never shows its dialog (#34)', () => {
    const view = viewFor(moveRobberGame(), 1);
    view.phase = { kind: 'steal', candidates: [0], resume: 'preRoll' };
    const steal: Action = { type: 'steal', player: 1, victim: 0 };
    const sent: Action[] = [];
    let listener: ((e: { type: string }) => void) | null = null;
    const client = {
      game: { seq: 1, view, legal: [steal], timer: null, receivedAt: 0 },
      room: null,
      on: (fn: (e: { type: string }) => void) => {
        listener = fn;
        return () => undefined;
      },
      intent: (a: Action) => sent.push(a) > 0,
      timerLeftMs: () => null,
    } as unknown as RoomClient;
    const c = controller(client);
    expect(sent).toEqual([steal]);
    expect(c.renders.at(-1)!.view.legal).toEqual([]);
    // The same view again (e.g. a room update): not sent twice.
    listener!({ type: 'room' });
    expect(sent).toHaveLength(1);
  });

  it('away flag while a player is disconnected; stop() ignores further events', () => {
    const t = table();
    const a = controller(t.ann);
    const bobConn = t.host.conns().find((c) => c.startsWith('Bob-'))!;
    t.host.cut(bobConn);
    t.clock.flush();
    expect(a.renders.at(-1)!.view.away).toEqual([false, true, false]);
    a.net.stop();
    const n = a.renders.length;
    t.clock.advance(10_000);
    expect(a.renders.length).toBe(n);
  });
});
