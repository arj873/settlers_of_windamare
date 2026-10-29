import { describe, expect, it } from 'vitest';
import { expandState, HIDDEN_SEED, isRngState, totalResources, type Action } from '../engine';
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from './protocol';
import { GameSession, type SessionOptions } from './session';
import { fakeDeps, LocalNet } from './testHarness';

const GRACE = 10_000;

function room(opts: Partial<SessionOptions> = {}) {
  const { session, hostToken } = GameSession.create('room1', 1000, fakeDeps(), {
    graceMs: GRACE,
    botDelayMs: 500,
    ...opts,
  });
  const net = new LocalNet(session, 1000);
  net.connect('host');
  net.send('host', { type: 'hello', token: hostToken, name: 'Ann' });
  return { net, session, hostToken };
}

/** Host Ann in seat 0, Bob in seat 1 (3 seats, seat 2 open -> bot), game started. */
function started(config: Partial<RoomConfig> = {}, opts: Partial<SessionOptions> = {}) {
  const r = room(opts);
  const { net } = r;
  net.connect('bob');
  net.send('bob', { type: 'hello', token: null, name: 'Bob' });
  const bobToken = net.last('bob', 'welcome')!.you.token;
  net.send('host', {
    type: 'configure',
    config: { ...DEFAULT_ROOM_CONFIG, seatCount: 3, ...config },
  });
  net.send('host', { type: 'takeSeat', seat: 0 });
  net.send('bob', { type: 'takeSeat', seat: 1 });
  net.send('host', { type: 'start' });
  return { ...r, bobToken };
}

/** The legal actions the server last sent to `conn`. */
function legalOf(net: LocalNet, conn: string): Action[] {
  return net.last(conn, 'game')?.legal ?? [];
}

/** Let the humans play their first legal action until `until` holds (bots move on the clock). */
function playUntil(net: LocalNet, conns: string[], until: () => boolean, maxSteps = 400): void {
  for (let i = 0; i < maxSteps && !until(); i++) {
    const conn = conns.find((c) => legalOf(net, c).length > 0);
    if (conn) {
      const legal = legalOf(net, conn);
      const pick =
        legal.find((a) => a.type !== 'offerTrade' && a.type !== 'buyDevCard') ?? legal[0]!;
      net.send(conn, { type: 'intent', action: pick, seq: net.last(conn, 'game')!.seq });
    } else {
      net.advance(500);
    }
  }
}

describe('GameSession lobby', () => {
  it('host joins with the creation token, a friend joins with a nickname', () => {
    const { net } = room();
    const hw = net.last('host', 'welcome')!;
    expect(hw.you.member).toBe('m1');
    expect(hw.room.host).toBe('m1');

    net.connect('bob');
    net.send('bob', { type: 'hello', token: null, name: '  Bob  ' });
    const bw = net.last('bob', 'welcome')!;
    expect(bw.you.member).toBe('m2');
    expect(bw.you.token).not.toBe(hw.you.token);
    expect(bw.room.members.map((m) => m.name)).toEqual(['Ann', 'Bob']);
    // Everyone gets the room update and the join notice.
    expect(net.last('host', 'room')!.room.members).toHaveLength(2);
    expect(net.last('host', 'chat')!.entry.text).toBe('Bob joined the room');
  });

  it('seats, colours and duplicate names', () => {
    const { net } = room();
    net.connect('c2');
    net.send('c2', { type: 'hello', token: null });
    net.send('c2', { type: 'takeSeat', seat: 1 });
    expect(net.last('c2', 'error')!.code).toBe('name_required');
    net.send('c2', { type: 'setName', name: 'ann' });
    expect(net.last('c2', 'room')!.room.members[1]!.name).toBe('ann 2');
    // Naming yourself sits you in the first open seat (L1): the host has seat 0.
    expect(net.last('c2', 'room')!.room.seats[1]!.occupant).toBe('m2');

    net.send('host', { type: 'takeSeat', seat: 1 });
    expect(net.last('host', 'error')!.code).toBe('seat_taken');
    net.send('c2', { type: 'takeSeat', seat: 2 });
    net.send('host', { type: 'takeSeat', seat: 1 });
    const seats = net.last('c2', 'room')!.room.seats;
    expect(seats[1]!.occupant).toBe('m1');
    expect(seats[2]!.occupant).toBe('m2');

    net.send('c2', { type: 'setColor', color: seats[1]!.color });
    expect(net.last('c2', 'error')!.code).toBe('color_taken');
    net.send('c2', { type: 'setColor', color: '#9b59b6' });
    expect(net.last('c2', 'room')!.room.seats[2]!.color).toBe('#9b59b6');

    // Moving seats frees the old one.
    net.send('host', { type: 'takeSeat', seat: 0 });
    expect(net.last('host', 'room')!.room.seats[1]!.occupant).toBeNull();
    net.send('host', { type: 'leaveSeat' });
    expect(net.last('host', 'room')!.room.seats.every((s) => s.occupant !== 'm1')).toBe(true);
  });

  it('only the host configures and starts; shrinking unseats', () => {
    const { net } = room();
    net.connect('bob');
    net.send('bob', { type: 'hello', token: null, name: 'Bob' });
    net.send('host', { type: 'leaveSeat' });
    net.send('bob', { type: 'leaveSeat' });
    net.send('host', { type: 'start' });
    expect(net.last('host', 'error')!.code).toBe('not_seated'); // nobody seated
    expect(net.last('host', 'game')).toBeUndefined();

    net.send('bob', { type: 'takeSeat', seat: 3 });
    net.send('bob', { type: 'start' });
    expect(net.last('bob', 'error')!.code).toBe('not_host');
    net.send('bob', { type: 'configure', config: DEFAULT_ROOM_CONFIG });
    expect(net.last('bob', 'error')!.code).toBe('not_host');

    net.send('host', { type: 'configure', config: { ...DEFAULT_ROOM_CONFIG, seatCount: 3 } });
    const r = net.last('bob', 'room')!.room;
    expect(r.seats).toHaveLength(3);
    expect(r.members.find((m) => m.id === 'm2')!.seat).toBeNull();

    // Invalid configs never reach the session.
    net.send('host', { type: 'configure', config: { ...DEFAULT_ROOM_CONFIG, seatCount: 6 } });
    expect(net.last('host', 'error')!.code).toBe('bad_message');
  });

  /** Joins `names` in order (each on its own connection); returns everyone's seat by name. */
  function join(net: LocalNet, session: GameSession, names: string[]) {
    for (const name of names) {
      net.connect(name);
      net.send(name, { type: 'hello', token: null, name });
      expect(net.messages(name, 'error')).toEqual([]);
    }
    return Object.fromEntries(session.room().members.map((m) => [m.name, m.seat]));
  }

  it('L1: the host sits in seat 1 once they have a nickname', () => {
    const { session, hostToken } = GameSession.create('room1', 1000, fakeDeps(), {
      graceMs: GRACE,
    });
    const net = new LocalNet(session, 1000);
    net.connect('host');
    // The creator connects without a nickname first: not seated yet.
    net.send('host', { type: 'hello', token: hostToken });
    expect(session.room().members[0]!.seat).toBeNull();
    net.send('host', { type: 'setName', name: 'Ann' });
    expect(session.room().members[0]!.seat).toBe(0);
    expect(session.room().seats[0]!.status).toBe('human');
    // A hello with the nickname seats the host right away, too.
    expect(room().session.room().members[0]!.seat).toBe(0);
  });

  it('L1: a joiner takes the first seat a bot holds; leaving and moving still work', () => {
    const { net, session } = room();
    net.send('host', { type: 'takeSeat', seat: 2 }); // Move here: seats 0, 1 and 3 have bots
    expect(join(net, session, ['Bob', 'Cy'])).toEqual({ Ann: 2, Bob: 0, Cy: 1 });
    expect(session.room().seats).toHaveLength(4);
    // Someone who stood up stays standing, even after a rename.
    net.send('Bob', { type: 'leaveSeat' });
    net.send('Bob', { type: 'setName', name: 'Robert' });
    expect(session.room().members[1]!.seat).toBeNull();
    // A member named later (no nickname in hello) sits down when they pick one.
    net.connect('anon');
    net.send('anon', { type: 'hello', token: null });
    expect(session.room().members[3]!.seat).toBeNull();
    net.send('anon', { type: 'setName', name: 'Dee' });
    expect(session.room().members[3]!.seat).toBe(0);
  });

  it('L1: a joiner adds a seat when every seat has a human (base game grows its board)', () => {
    const { net, session } = room();
    join(net, session, ['Bob', 'Cy', 'Dee']);
    expect(session.room().seats.every((s) => s.occupant !== null)).toBe(true);
    expect(join(net, session, ['Eve'])['Eve']).toBe(4);
    const r = session.room();
    expect(r.seats).toHaveLength(5);
    expect(r.config.seatCount).toBe(5);
    expect(r.config.map).toBe('base56'); // like the host's Add bot: the 5-6 player board
    expect(new Set(r.seats.map((s) => s.color)).size).toBe(5);
    expect(net.messages('host', 'chat').map((c) => c.entry.text)).toContain('Added seat 5 for Eve');
    // The host can still remove an open seat.
    net.send('Eve', { type: 'leaveSeat' });
    net.send('host', { type: 'configure', config: { ...r.config, seatCount: 4 } });
    expect(net.last('host', 'error')).toBeUndefined();
    expect(session.room().seats).toHaveLength(4);
  });

  it('L1: the table grows to 8 players; the ninth person watches', () => {
    const { net, session } = room();
    const seats = join(net, session, ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
    expect(Object.values(seats)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, null]);
    expect(session.room().config).toMatchObject({ seatCount: 8, map: 'base78' });
    net.send('host', { type: 'start' });
    expect(net.last('host', 'error')).toBeUndefined();
    expect(session.state!.players).toHaveLength(8);
  });

  it("L1: a mode's lower cap holds (Seafarers 6, a 3-4 player scenario 4)", () => {
    const { net, session } = room();
    net.send('host', {
      type: 'configure',
      config: {
        ...DEFAULT_ROOM_CONFIG,
        mode: 'seafarers',
        scenario: 'seafarers/fourIslands',
        seatCount: 3,
      },
    });
    const six = join(net, session, ['B', 'C', 'D', 'E', 'F', 'G']);
    expect(Object.values(six)).toEqual([0, 1, 2, 3, 4, 5, null]);
    expect(session.room().config.mode).toBe('seafarers');

    const r2 = room();
    r2.net.send('host', {
      type: 'configure',
      config: { ...DEFAULT_ROOM_CONFIG, mode: 'ep', scenario: 'ep/landHo', seatCount: 3 },
    });
    expect(r2.net.last('host', 'error')).toBeUndefined();
    const four = join(r2.net, r2.session, ['B', 'C', 'D', 'E']);
    expect(Object.values(four)).toEqual([0, 1, 2, 3, null]);
    expect(r2.session.room().seats).toHaveLength(4);
  });

  it('L1: nobody is auto-seated once the game has started', () => {
    const { net, session } = started({ seatCount: 4 });
    net.connect('late');
    net.send('late', { type: 'hello', token: null, name: 'Late' });
    expect(session.room().members.find((m) => m.name === 'Late')!.seat).toBeNull();
    expect(session.room().seats[3]!.occupant).toBeNull();
    expect(net.messages('late', 'error')).toEqual([]);
  });

  it('L1: a returning member keeps their own seat, not a new one', () => {
    const { net, session } = room();
    net.connect('bob');
    net.send('bob', { type: 'hello', token: null, name: 'Bob' });
    const token = net.last('bob', 'welcome')!.you.token;
    net.send('bob', { type: 'takeSeat', seat: 3 });
    net.disconnect('bob');
    net.connect('bob2');
    net.send('bob2', { type: 'hello', token, name: 'Bob' });
    expect(session.room().seats.map((s) => s.occupant)).toEqual(['m1', null, null, 'm2']);
  });

  it('a lobby seat is freed after the grace period', () => {
    const { net } = room();
    net.connect('bob');
    net.send('bob', { type: 'hello', token: null, name: 'Bob' });
    net.send('bob', { type: 'takeSeat', seat: 1 });
    net.disconnect('bob');
    net.advance(GRACE - 1);
    expect(net.last('host', 'room')!.room.seats[1]!.occupant).toBe('m2');
    net.advance(1);
    expect(net.last('host', 'room')!.room.seats[1]!.occupant).toBeNull();
  });
});

describe('GameSession game', () => {
  it('start: every seat gets its own view and legal actions; spectators see public info', () => {
    const { net, session } = started();
    const state = session.state!;
    expect(session.phase).toBe('playing');
    expect(state.players.map((p) => p.name)).toEqual(['Ann', 'Bob', 'White Bot']);

    const ann = net.last('host', 'game')!;
    const bob = net.last('bob', 'game')!;
    expect(ann.view.view.viewer).toBe(0);
    expect(bob.view.view.viewer).toBe(1);
    expect(ann.view.settings.seed).toBe(HIDDEN_SEED);
    for (const a of ann.legal) expect(a.player).toBe(0);
    for (const a of bob.legal) expect(a.player).toBe(1);
    const cur = state.turn.current;
    // The seat to move (a human) has legal actions; with the bot first, the humans wait.
    expect(cur === 2 ? 1 : ann.legal.length + bob.legal.length).toBeGreaterThan(0);

    net.connect('eve');
    net.send('eve', { type: 'hello', token: null, name: 'Eve' });
    const eve = net.last('eve', 'game')!;
    expect(eve.view.view.viewer).toBeNull();
    expect(eve.legal).toEqual([]);
    expect(net.last('eve', 'welcome')!.room.members.find((m) => m.name === 'Eve')!.seat).toBeNull();
  });

  it('plays turns: intents are validated, bots move on the clock, hands stay hidden', () => {
    const { net, session } = started({ map: 'base' });
    playUntil(net, ['host', 'bob'], () => (session.state?.turn.number ?? 0) >= 4);
    const state = session.state!;
    expect(state.turn.number).toBeGreaterThanOrEqual(4);
    expect(state.log.some((e) => e.player === 2)).toBe(true); // the bot played

    // Every game message Bob ever got hides Ann's hand and the bot's, with honest counts.
    for (const g of net.messages('bob', 'game')) {
      expect(totalResources(g.view.players[0]!.resources)).toBe(0);
      expect(totalResources(g.view.players[2]!.resources)).toBe(0);
      expect(g.view.rng).toEqual([0, 0, 0, 0]);
    }
    const lastBob = net.last('bob', 'game')!;
    expect(lastBob.view.view.handCounts).toEqual(
      state.players.map((p) => totalResources(p.resources)),
    );
    expect(lastBob.view.players[1]).toEqual(state.players[1]);
    expect(JSON.stringify(net.inbox.get('bob'))).not.toContain('seed-1');
  });

  it('rejects intents for another seat, from spectators, stale or illegal', () => {
    const { net, session } = started({ map: 'base' });
    const cur = session.state!.turn.current;
    const me = cur === 0 ? 'host' : cur === 1 ? 'bob' : null;
    const other = me === 'host' ? 'bob' : 'host';
    const seq = session.seq;

    const roll: Action = { type: 'rollDice', player: cur };
    net.send(other, { type: 'intent', action: roll });
    expect(net.last(other, 'error')!.code).toBe(cur === 2 ? 'not_your_seat' : 'not_your_seat');

    net.connect('eve');
    net.send('eve', { type: 'hello', token: null, name: 'Eve' });
    net.send('eve', { type: 'intent', action: roll });
    expect(net.last('eve', 'error')!.code).toBe('not_seated');

    if (me) {
      net.send(me, { type: 'intent', action: { type: 'rollDice', player: cur }, seq });
      expect(net.last(me, 'error')!.code).toBe('illegal_action'); // setup: cannot roll
      net.send(me, { type: 'intent', action: legalOf(net, me)[0]!, seq: seq - 1 });
      expect(net.last(me, 'error')!.code).toBe('stale_state');
    }
    expect(session.seq).toBe(seq);
  });

  it('disconnect -> grace -> bot takes over -> reconnect reclaims the seat', () => {
    const { net, session, bobToken } = started({ map: 'base', turnTimerSec: null });
    // Play until it is Bob's move.
    playUntil(
      net,
      ['host'],
      () => legalOf(net, 'bob').length > 0 && session.state!.turn.current === 1,
    );
    expect(session.state!.turn.current).toBe(1);

    net.disconnect('bob');
    expect(net.last('host', 'room')!.room.seats[1]!.status).toBe('away');
    const before = session.seq;
    net.advance(GRACE - 1);
    expect(session.seq).toBe(before); // the turn waits for Bob during the grace period

    net.advance(1);
    expect(net.last('host', 'room')!.room.seats[1]!.status).toBe('bot');
    expect(net.messages('host', 'chat').some((c) => c.entry.text.includes('a bot plays'))).toBe(
      true,
    );
    net.advance(600);
    expect(session.seq).toBeGreaterThan(before); // the bot moved for Bob

    net.connect('bob2');
    net.send('bob2', { type: 'hello', token: bobToken });
    const w = net.last('bob2', 'welcome')!;
    expect(w.you.member).toBe('m2');
    expect(w.room.seats[1]!.status).toBe('human');
    expect(net.last('bob2', 'game')!.view.view.viewer).toBe(1);
    expect(net.messages('host', 'chat').some((c) => c.entry.text.includes('is back'))).toBe(true);
  });

  it('turn timer: a human who does nothing times out (minimum moves)', () => {
    const { net, session } = started({ map: 'base', turnTimerSec: 30 });
    playUntil(
      net,
      ['bob'],
      () => session.state!.turn.current === 0 && legalOf(net, 'host').length > 0,
    );
    const t = net.last('host', 'game')!.timer!;
    expect(t.player).toBe(0);
    expect(t.totalMs).toBe(30_000);
    const seq = session.seq;
    net.advance(29_000);
    expect(session.seq).toBe(seq);
    net.advance(1_500);
    expect(session.seq).toBeGreaterThan(seq);
    expect(net.messages('bob', 'chat').some((c) => c.entry.text === 'Ann ran out of time')).toBe(
      true,
    );
  });

  it('pauses when nobody is connected and expires after the idle time', () => {
    const { net, session } = started({ map: 'base' }, { idleExpiryMs: 3600_000 });
    net.disconnect('host');
    net.disconnect('bob');
    const seq = session.seq;
    net.advance(10 * GRACE);
    expect(session.seq).toBe(seq); // bots and timers wait
    expect(session.isExpired(net.now)).toBe(false);
    expect(session.nextWakeAt()).toBe(net.now - 10 * GRACE + 3600_000);
    net.advance(3600_000);
    expect(session.isExpired(net.now)).toBe(true);
    net.connect('late');
    net.send('late', { type: 'hello', token: null, name: 'Late' });
    expect(net.last('late', 'error')!.code).toBe('room_expired');
    expect(net.closed.get('late')).toBe(4004);
  });

  it('a bot-only table plays to the end; the new host starts a rematch', () => {
    const { net, session, bobToken } = started(
      { map: 'base', turnTimerSec: null },
      { botDelayMs: 0 },
    );
    net.connect('eve');
    net.send('eve', { type: 'hello', token: null, name: 'Eve' });
    net.disconnect('host');
    net.disconnect('bob');
    for (let i = 0; i < 40 && session.phase !== 'over'; i++) net.advance(GRACE);
    expect(session.phase).toBe('over');
    expect(net.last('eve', 'room')!.room.host).toBe(net.last('eve', 'welcome')!.you.member);
    // Game over reveals hands, and the winner is announced.
    const final = net.last('eve', 'game')!;
    expect(final.view.view.masked.every((m) => !m)).toBe(true);
    // UX2: the stats and the game's duration (room clock) come with the game-over view only.
    expect(final.view.stats?.complete).toBe(true);
    expect(final.durationMs).toBeGreaterThan(0);
    const midGame = net.messages('eve', 'game').filter((m) => m.view.phase.kind !== 'gameOver');
    expect(midGame.length).toBeGreaterThan(0);
    expect(midGame.every((m) => m.view.stats === undefined && m.durationMs === undefined)).toBe(
      true,
    );
    expect(net.messages('eve', 'chat').some((c) => c.entry.text.endsWith('won the game!'))).toBe(
      true,
    );

    net.connect('bob2');
    net.send('bob2', { type: 'hello', token: bobToken });
    net.send('eve', { type: 'rematch' });
    expect(session.phase).toBe('lobby');
    const seats = net.last('eve', 'room')!.room.seats;
    expect(seats[1]!.occupant).toBe('m2'); // Bob is here: keeps his seat
    expect(seats[0]!.occupant).toBeNull(); // Ann left long ago: seat open
  });

  it('snapshot / restore mid-game keeps playing', () => {
    const { net, session } = started({ map: 'base' });
    playUntil(net, ['host', 'bob'], () => session.state!.turn.number >= 1);
    const snap = JSON.parse(JSON.stringify(session.snapshot()));
    const restored = GameSession.restore(snap, fakeDeps('r'), { graceMs: GRACE, botDelayMs: 500 });
    expect(restored.state).toEqual(session.state);
    expect(restored.seq).toBe(session.seq);
    net.session = restored;
    playUntil(net, ['host', 'bob'], () => restored.state!.turn.number >= 3);
    expect(restored.state!.turn.number).toBeGreaterThanOrEqual(3);
  });

  it('restores a snapshot stored before schema v6 (uint32 rng, bot RNGs) and keeps playing', () => {
    const { net, session } = started({ map: 'base' });
    playUntil(net, ['host', 'bob'], () => session.state!.turn.number >= 1);
    const snap = JSON.parse(JSON.stringify(session.snapshot()));
    snap.game.state = { ...snap.game.state, schemaVersion: 5, rng: 123456789 };
    snap.game.botRng = 5;
    snap.game.timeoutRng = 6;
    const restored = GameSession.restore(snap, fakeDeps('r'), { graceMs: GRACE, botDelayMs: 500 });
    expect(restored.state!.schemaVersion).toBe(6);
    expect(restored.state!.rng).toEqual(expandState(123456789));
    net.session = restored;
    playUntil(net, ['host', 'bob'], () => restored.state!.turn.number >= 3);
    expect(restored.state!.turn.number).toBeGreaterThanOrEqual(3);
    expect(isRngState(restored.snapshot().game!.botRng)).toBe(true);
  });

  it('refuses a snapshot whose game state does not load', () => {
    const { session } = started({ map: 'base' });
    const snap = JSON.parse(JSON.stringify(session.snapshot()));
    snap.game.state = { ...snap.game.state, rng: 'nope' };
    expect(() => GameSession.restore(snap, fakeDeps('r'))).toThrow(/unreadable game state/);
  });

  it('reconcile drops connections the transport lost', () => {
    const { net, session } = started({ map: 'base' });
    net.deliver(session.reconcile(['host'], net.now));
    expect(net.last('host', 'room')!.room.members.find((m) => m.id === 'm2')!.connected).toBe(
      false,
    );
  });
});

describe('GameSession identity and safety', () => {
  it('the same token in a second tab replaces the first socket', () => {
    const { net, hostToken } = room();
    net.connect('tab2');
    net.send('tab2', { type: 'hello', token: hostToken });
    expect(net.last('host', 'error')!.code).toBe('replaced');
    expect(net.closed.get('host')).toBe(4003);
    expect(net.last('tab2', 'welcome')!.you.member).toBe('m1');
  });

  it('kick invalidates the token', () => {
    const { net } = room();
    net.connect('bob');
    net.send('bob', { type: 'hello', token: null, name: 'Bob' });
    const token = net.last('bob', 'welcome')!.you.token;
    net.send('host', { type: 'kick', member: 'm2' });
    expect(net.last('bob', 'error')!.code).toBe('kicked');
    expect(net.closed.get('bob')).toBe(4002);
    net.connect('bob2');
    net.send('bob2', { type: 'hello', token });
    expect(net.last('bob2', 'welcome')!.you.member).not.toBe('m2');
  });

  it('host passes to a connected member after the grace period', () => {
    const { net } = room();
    net.connect('bob');
    net.send('bob', { type: 'hello', token: null, name: 'Bob' });
    net.disconnect('host');
    net.advance(GRACE);
    expect(net.last('bob', 'room')!.room.host).toBe('m2');
    expect(net.last('bob', 'chat')!.entry.text).toBe('Bob is now the host');
  });

  it('nextWakeAt never asks for a past tick (no alarm loop while a handover must wait)', () => {
    const { net, session } = room();
    net.connect('anon');
    net.send('anon', { type: 'hello', token: null }); // no name: cannot become host
    net.disconnect('host');
    net.advance(GRACE * 3);
    const wake = session.nextWakeAt();
    expect(wake === null || wake > net.now).toBe(true);
    expect(net.last('anon', 'room')!.room.host).toBe('m1');
    net.send('anon', { type: 'setName', name: 'Zed' });
    net.advance(1);
    expect(net.last('anon', 'room')!.room.host).toBe('m2');
  });

  it('rejects junk, wrong versions and messages before hello', () => {
    const { net } = room();
    net.connect('x');
    net.sendRaw('x', '{not json');
    expect(net.last('x', 'error')!.code).toBe('bad_message');
    net.send('x', { type: 'chat', text: 'hi' });
    expect(net.last('x', 'error')!.code).toBe('not_joined');
    net.sendRaw('x', JSON.stringify({ v: 99, type: 'hello', token: null }));
    expect(net.last('x', 'error')!.code).toBe('version_mismatch');
    expect(net.closed.get('x')).toBe(4000);
  });

  it('chat: broadcast, cleaned, clipped and rate limited; reactions broadcast', () => {
    const { net } = room();
    net.connect('bob');
    net.send('bob', { type: 'hello', token: null, name: 'Bob' });
    net.send('bob', { type: 'chat', text: '  hello\n\u0007there  ' });
    expect(net.last('host', 'chat')!.entry).toMatchObject({
      from: 'm2',
      name: 'Bob',
      text: 'hello there',
    });
    net.send('bob', { type: 'chat', text: 'x'.repeat(500) });
    expect(net.last('host', 'chat')!.entry.text).toHaveLength(280);

    for (let i = 0; i < 4; i++) net.send('bob', { type: 'chat', text: `spam ${i}` });
    expect(net.last('bob', 'error')!.code).toBe('rate_limited');
    net.advance(2000);
    net.send('bob', { type: 'chat', text: 'later' });
    expect(net.last('host', 'chat')!.entry.text).toBe('later');

    net.send('bob', { type: 'react', reaction: 'gg' });
    expect(net.last('host', 'reaction')).toMatchObject({
      member: 'm2',
      reaction: 'gg',
      seat: 1,
    });

    // History comes with the welcome.
    net.connect('eve');
    net.send('eve', { type: 'hello', token: null, name: 'Eve' });
    expect(net.last('eve', 'welcome')!.chat.some((c) => c.text === 'later')).toBe(true);
  });

  it('a full room turns new people away but keeps known tokens working', () => {
    const { net, hostToken } = room();
    for (let i = 0; i < 31; i++) {
      net.connect(`c${i}`);
      net.send(`c${i}`, { type: 'hello', token: null, name: `P${i}` });
    }
    net.connect('extra');
    net.send('extra', { type: 'hello', token: null, name: 'Extra' });
    expect(net.last('extra', 'error')!.code).toBe('room_full');
    // A gone spectator makes room (c0-c6 filled the 8 seats with the host).
    net.disconnect('c20');
    net.connect('extra2');
    net.send('extra2', { type: 'hello', token: null, name: 'Extra' });
    expect(net.last('extra2', 'welcome')).toBeDefined();
    net.connect('host2');
    net.send('host2', { type: 'hello', token: hostToken });
    expect(net.last('host2', 'welcome')!.you.member).toBe('m1');
  });
});
