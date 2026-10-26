/** GameSession with the V1 variants: veto / event phases online, seat shuffle, chess clock. */
import { describe, expect, it } from 'vitest';
import { HIDDEN_EVENT_CARD, timerSettings, type Action } from '../engine';
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from './protocol';
import { GameSession } from './session';
import { fakeDeps, LocalNet } from './testHarness';

/** Ann (host, seat 0) and Bob (seat 1) at a 4-seat table (seats 2, 3: bots), game started. */
function started(patch: Partial<RoomConfig>, botDelayMs = 500) {
  const { session, hostToken } = GameSession.create('room1', 1000, fakeDeps(), {
    graceMs: 10_000,
    botDelayMs,
  });
  const net = new LocalNet(session, 1000);
  net.connect('host');
  net.send('host', { type: 'hello', token: hostToken, name: 'Ann' });
  net.connect('bob');
  net.send('bob', { type: 'hello', token: null, name: 'Bob' });
  net.send('host', {
    type: 'configure',
    config: { ...DEFAULT_ROOM_CONFIG, seatCount: 4, turnTimerSec: null, ...patch },
  });
  net.send('host', { type: 'takeSeat', seat: 0 });
  net.send('bob', { type: 'takeSeat', seat: 1 });
  net.send('host', { type: 'start' });
  expect(net.last('host', 'error')).toBeUndefined();
  return { net, session };
}

const legalOf = (net: LocalNet, conn: string): Action[] => net.last(conn, 'game')?.legal ?? [];

/** Humans play their first legal action; otherwise time passes for the bots. */
function playUntil(net: LocalNet, until: () => boolean, maxSteps = 3000): void {
  for (let i = 0; i < maxSteps && !until(); i++) {
    const conn = ['host', 'bob'].find((c) => legalOf(net, c).length > 0);
    if (conn) {
      const legal = legalOf(net, conn);
      const pick = legal.find((a) => a.type !== 'offerTrade') ?? legal[0]!;
      net.send(conn, { type: 'intent', action: pick, seq: net.last(conn, 'game')!.seq });
    } else {
      net.advance(500);
    }
  }
}

describe('GameSession: V1 variants online', () => {
  it('the host can configure variants; invalid combinations are refused', () => {
    const { session } = started({ variants: { eventCards: true, robberMode: 'friendly' } });
    expect(session.state!.settings).toMatchObject({ eventCards: true, robberMode: 'friendly' });

    const r = GameSession.create('room2', 0, fakeDeps(), { graceMs: 10_000, botDelayMs: 0 });
    const net = new LocalNet(r.session, 0);
    net.connect('host');
    net.send('host', { type: 'hello', token: r.hostToken, name: 'Ann' });
    net.send('host', {
      type: 'configure',
      config: { ...DEFAULT_ROOM_CONFIG, seatCount: 3, variants: { secondSettler: true } },
    });
    expect(net.last('host', 'error')!.code).toBe('bad_message');
  });

  it('map veto, event cards and second settler: humans and bots play on, secrets stay hidden', () => {
    const { net, session } = started({
      variants: { mapSelection: 'veto', eventCards: true, secondSettler: true },
    });
    expect(session.state!.phase.kind).toBe('mapVeto');
    const seen = new Set<string>();
    playUntil(net, () => {
      seen.add(session.state!.phase.kind);
      return session.state!.turn.number >= 12 || session.phase !== 'playing';
    });
    expect(session.state!.log.some((e) => /^Map \d was chosen$/.test(e.text))).toBe(true);
    expect(session.state!.turn.number >= 12 || session.phase === 'over').toBe(true);
    expect(seen.has('mapVeto')).toBe(true);
    // No intent was ever refused, and the event deck order never left the server.
    for (const conn of ['host', 'bob']) {
      expect(net.messages(conn, 'error')).toEqual([]);
      for (const g of net.messages(conn, 'game')) {
        expect((g.view.eventDeck ?? []).every((c) => c === HIDDEN_EVENT_CARD)).toBe(true);
        for (const a of g.legal) expect(a.player).toBe(g.view.view.viewer);
      }
    }
  });

  it('Randomize Turn Order: lobby seats follow the shuffled players', () => {
    const { net, session } = started({ variants: { randomTurnOrder: true } });
    const state = session.state!;
    expect(state.settings.seatOrder).toBeDefined();
    const room = net.last('host', 'room')!.room;
    for (const [conn, name] of [
      ['host', 'Ann'],
      ['bob', 'Bob'],
    ] as const) {
      const g = net.last(conn, 'game')!;
      const seat = g.view.view.viewer!;
      expect(state.players[seat]!.name).toBe(name);
      expect(room.seats[seat]!.color).toBe(state.players[seat]!.color);
      expect(room.members.find((m) => m.name === name)!.seat).toBe(seat);
    }
  });

  it('chess clock: the bank runs down, carries over and gets the increment', () => {
    const timer = timerSettings('custom', { bankSec: 60, incrementSec: 10 })!;
    const { net, session } = started({ variants: { timer } });
    // Until it is Ann's (seat 0) own turn after setup.
    playUntil(
      net,
      () =>
        session.state!.turn.number >= 1 &&
        session.state!.turn.current === 0 &&
        session.state!.phase.kind === 'preRoll',
    );
    const before = net.last('host', 'game')!.timer!;
    expect(before.player).toBe(0);
    expect(before.totalMs).toBe(60_000);
    net.advance(5_000);
    net.send('host', { type: 'intent', action: { type: 'rollDice', player: 0 }, seq: session.seq });
    playUntil(net, () => session.state!.turn.current !== 0 || session.state!.phase.kind === 'main');
    if (session.state!.phase.kind === 'main' && session.state!.turn.current === 0) {
      net.send('host', {
        type: 'intent',
        action: { type: 'endTurn', player: 0 },
        seq: session.seq,
      });
    }
    // Banked: what was left after ~5 s, plus the 10 s increment.
    const snap = session.snapshot();
    const bank = snap.game!.banks![0]!;
    expect(bank).toBeGreaterThan(before.remainingMs - 5_000 + 10_000 - 1_000);
    expect(bank).toBeLessThanOrEqual(before.remainingMs - 5_000 + 10_000);
  });
});
