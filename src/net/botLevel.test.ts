/** B1 online: the host picks each open seat's bot level; the room's bots play at that level. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_CONFIG, PROTOCOL_VERSION, parseClientMessage } from './protocol';
import { GameSession } from './session';
import { fakeDeps, LocalNet } from './testHarness';

const v = PROTOCOL_VERSION;

function lobby() {
  const { session, hostToken } = GameSession.create('room1', 1000, fakeDeps(), {
    graceMs: 10_000,
    botDelayMs: 100,
  });
  const net = new LocalNet(session, 1000);
  net.connect('host');
  net.send('host', { type: 'hello', token: hostToken, name: 'Ann' });
  net.connect('eve');
  net.send('eve', { type: 'hello', token: null, name: 'Eve' });
  return { net, session };
}

describe('setBotLevel', () => {
  it('parses a seat and a known level only', () => {
    const ok = parseClientMessage({ v, type: 'setBotLevel', seat: 2, level: 'hard' });
    expect(ok.ok && ok.msg).toEqual({ v, type: 'setBotLevel', seat: 2, level: 'hard' });
    for (const bad of [
      { v, type: 'setBotLevel', seat: 2, level: 'expert' },
      { v, type: 'setBotLevel', seat: -1, level: 'easy' },
      { v, type: 'setBotLevel', level: 'easy' },
    ]) {
      expect(parseClientMessage(bad).ok).toBe(false);
    }
  });

  it('the host sets it in the lobby; guests and started games cannot', () => {
    const { net } = lobby();
    const seats = () => net.last('host', 'room')!.room.seats;
    expect(seats().every((s) => s.botLevel === undefined)).toBe(true);
    net.send('host', { type: 'setBotLevel', seat: 2, level: 'hard' });
    net.send('host', { type: 'setBotLevel', seat: 3, level: 'easy' });
    expect(seats().map((s) => s.botLevel)).toEqual([undefined, undefined, 'hard', 'easy']);
    net.send('eve', { type: 'setBotLevel', seat: 1, level: 'easy' });
    expect(net.last('eve', 'error')!.code).toBe('not_host');
    net.send('host', { type: 'setBotLevel', seat: 9, level: 'easy' });
    expect(net.last('host', 'error')!.code).toBe('bad_message');
    net.send('host', { type: 'takeSeat', seat: 0 });
    net.send('host', { type: 'start' });
    net.send('host', { type: 'setBotLevel', seat: 2, level: 'normal' });
    expect(net.last('host', 'error')!.code).toBe('wrong_phase');
  });

  it('levels move with their seats under Randomize Turn Order, and the bots play', () => {
    const { net } = lobby();
    net.send('host', {
      type: 'configure',
      config: { ...DEFAULT_ROOM_CONFIG, seatCount: 4, variants: { randomTurnOrder: true } },
    });
    net.send('host', { type: 'takeSeat', seat: 0 });
    net.send('host', { type: 'setBotLevel', seat: 1, level: 'hard' });
    net.send('host', { type: 'setBotLevel', seat: 2, level: 'easy' });
    const levels = () =>
      new Map(net.last('host', 'room')!.room.seats.map((s) => [s.color, s.botLevel] as const));
    const before = levels();
    net.send('host', { type: 'start' });
    expect(levels()).toEqual(before);
    // Bots (Hard, Easy, Normal) take their turns; Ann plays her first legal move.
    for (let i = 0; i < 300; i++) {
      const g = net.last('host', 'game')!;
      if (g.legal.length > 0) {
        net.send('host', { type: 'intent', action: g.legal[0]!, seq: g.seq });
      } else net.advance(100);
    }
    expect(net.last('host', 'game')!.view.turn.number).toBeGreaterThan(4);
    expect(net.last('host', 'error')).toBeUndefined();
  });
});
