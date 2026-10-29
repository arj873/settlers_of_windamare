/**
 * Player trades in an online room with several humans (BUG-B3): every human addressee is asked,
 * the offerer waits for them, and every way an offer ends leaves a log line.
 */
import { describe, expect, it } from 'vitest';
import type { Action, GameState, PlayerId, Resource } from '../engine';
import { defaultBot } from '../game/controller';
import { DEFAULT_ROOM_CONFIG } from './protocol';
import { GameSession } from './session';
import { fakeDeps, LocalNet } from './testHarness';

const CONNS = ['ann', 'bob', 'cat'] as const;

/** Ann, Bob and Cat in seats 0–2, seat 3 open → bot; started. */
function table(turnTimerSec: number | null = 120) {
  const { session, hostToken } = GameSession.create('room1', 1000, fakeDeps(), {
    graceMs: 60_000,
    botDelayMs: 500,
    // The seeded answers below assume the random (Easy) bot in seat 3.
    bot: defaultBot,
  });
  const net = new LocalNet(session, 1000);
  net.connect('ann');
  net.send('ann', { type: 'hello', token: hostToken, name: 'Ann' });
  for (const c of ['bob', 'cat'] as const) {
    net.connect(c);
    net.send(c, { type: 'hello', token: null, name: c === 'bob' ? 'Bob' : 'Cat' });
  }
  net.send('ann', {
    type: 'configure',
    config: { ...DEFAULT_ROOM_CONFIG, seatCount: 4, turnTimerSec },
  });
  CONNS.forEach((c, seat) => net.send(c, { type: 'takeSeat', seat }));
  net.send('ann', { type: 'start' });
  return { net, session };
}

const game = (net: LocalNet, conn: string) => net.last(conn, 'game')!;
const legalOf = (net: LocalNet, conn: string): Action[] => game(net, conn).legal;
const stateOf = (net: LocalNet, conn: string) => game(net, conn).view as unknown as GameState;
const logText = (net: LocalNet) => stateOf(net, 'ann').log.map((e) => e.text);

function act(net: LocalNet, conn: string, action: Action): void {
  net.send(conn, { type: 'intent', action, seq: game(net, conn).seq });
}

/**
 * Humans play their first non-trade legal move until Ann may offer a 1-for-1 to everyone
 * (and, with `ok`, one that `ok` accepts).
 */
function untilAnnOffers(net: LocalNet, ok: (offer: Action) => boolean = () => true): Action {
  for (let i = 0; i < 2000; i++) {
    const offer = legalOf(net, 'ann').find(
      (a) => a.type === 'offerTrade' && a.to.length === 3 && ok(a),
    );
    if (offer) return offer;
    const conn = CONNS.find((c) => legalOf(net, c).length > 0);
    if (!conn) {
      net.advance(500);
      continue;
    }
    const legal = legalOf(net, conn);
    act(
      net,
      conn,
      legal.find((a) => a.type !== 'offerTrade' && a.type !== 'buyDevCard') ?? legal[0]!,
    );
  }
  throw new Error('Ann never got to offer a trade');
}

const types = (legal: readonly Action[]) => [...new Set(legal.map((a) => a.type))].sort();

describe('online player trade with several humans', () => {
  it('asks every human addressee; the bot answers; the offerer only waits', () => {
    const { net } = table();
    const offer = untilAnnOffers(net);
    act(net, 'ann', offer);
    net.advance(2000); // the bot (seat 3) answers on its clock
    const st = stateOf(net, 'bob');
    expect(st.phase.kind).toBe('trade');
    const responses = (st.phase as Extract<GameState['phase'], { kind: 'trade' }>).offer.responses;
    expect(responses[3]).not.toBe('pending');
    for (const c of ['bob', 'cat'] as const) {
      expect(stateOf(net, c).phase.kind).toBe('trade');
      expect(types(legalOf(net, c))).toContain('rejectTrade');
    }
    // Ann can only withdraw while both humans think.
    expect(types(legalOf(net, 'ann'))).toEqual(['cancelTrade']);
    // The clock is on a responder, not on the offerer.
    expect(game(net, 'ann').timer?.player).not.toBe(0);
    expect(game(net, 'ann').timer?.kind).toBe('trade');
  });

  // 20261026-051231: the server bot withdrew offers a human had accepted (T33, T69, T85).
  it('a bot offer accepted by a human is traded, not withdrawn', () => {
    const { net } = table(null);
    let trades = 0;
    for (let i = 0; i < 6000 && trades < 3; i++) {
      const st = stateOf(net, 'ann');
      if (st.phase.kind === 'gameOver') break;
      if (st.phase.kind === 'trade' && st.phase.offer.from === 3) {
        const accepter = CONNS.find((c) => legalOf(net, c).some((a) => a.type === 'acceptTrade'));
        if (accepter) {
          const before = st.log.length;
          for (const c of CONNS) {
            const legal = legalOf(net, c);
            const answer =
              c === accepter
                ? legal.find((a) => a.type === 'acceptTrade')
                : legal.find((a) => a.type === 'rejectTrade');
            if (answer) act(net, c, answer);
          }
          net.advance(3000);
          const fresh = stateOf(net, 'ann')
            .log.slice(before)
            .map((e) => e.text);
          expect(fresh.some((t) => / Bot traded .* to /.test(t))).toBe(true);
          expect(fresh.some((t) => /withdrew the offer/.test(t))).toBe(false);
          trades++;
          continue;
        }
      }
      const conn = CONNS.find((c) => legalOf(net, c).length > 0);
      if (!conn) {
        net.advance(500);
        continue;
      }
      const legal = legalOf(net, conn);
      act(net, conn, legal.find((a) => !/Trade$|buyDevCard/.test(a.type)) ?? legal[0]!);
    }
    expect(trades).toBeGreaterThan(0);
  });

  // 20261026-050222: an open offer seemed to vanish. Every ending leaves a log line.
  it('the offerer running out of time withdraws the offer with a log line', () => {
    const { net, session } = table(30);
    // An offer Bob or Cat can pay for (read on the full state), so a human accepts it.
    const payable = (a: Action) =>
      a.type === 'offerTrade' &&
      [1, 2].some((p) =>
        Object.entries(a.want).every(
          ([r, n]) => (session.state!.players[p]!.resources[r as Resource] ?? 0) >= (n ?? 0),
        ),
      );
    act(net, 'ann', untilAnnOffers(net, payable));
    for (const c of ['bob', 'cat'] as const) {
      const accept = legalOf(net, c).find((a) => a.type === 'acceptTrade');
      const answer = accept ?? legalOf(net, c).find((a) => a.type === 'rejectTrade')!;
      act(net, c, answer);
    }
    net.advance(2000);
    // Someone accepted, so the offer waits for Ann.
    expect(stateOf(net, 'ann').phase.kind).toBe('trade');
    // Ann sits on her offer: her turn clock runs out, the minimum move withdraws it.
    expect(game(net, 'ann').timer?.player).toBe(0);
    net.advance(31_000);
    expect(logText(net)).toContain('Ann withdrew the offer');
    const chat = net.inbox.get('ann')!.flatMap((m) => (m.type === 'chat' ? [m.entry.text] : []));
    expect(chat).toContain('Ann ran out of time');
  });

  it('logs the cancel or the all-reject that ends an offer', () => {
    const { net } = table(30);
    act(net, 'ann', untilAnnOffers(net));
    net.advance(2000);
    for (const c of ['bob', 'cat'] as const) {
      const reject = legalOf(net, c).find((a) => a.type === 'rejectTrade');
      if (reject) act(net, c, reject);
    }
    // The bot may have accepted: then Ann's offer stays open until she confirms or cancels.
    if (stateOf(net, 'ann').phase.kind === 'trade') {
      act(net, 'ann', { type: 'cancelTrade', player: 0 as PlayerId });
      expect(logText(net)).toContain('Ann withdrew the offer');
    } else {
      expect(logText(net)).toContain('Everyone rejected the offer');
    }
    expect(stateOf(net, 'ann').phase.kind).toBe('main');
  });
});
