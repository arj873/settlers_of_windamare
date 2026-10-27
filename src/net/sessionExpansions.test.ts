/**
 * GameSession with expansion modes (X1): the host configures modes / scenarios / options, humans
 * and bots play expansion games over the wire, every view is the engine's `viewFor`, and the
 * intent guard only lets a seat send the kinds of moves legalActions offers it.
 */
import { describe, expect, it } from 'vitest';
import { viewFor, type Action, type EdgeId, type VertexId } from '../engine';
import { topologyOf } from '../engine/topology';
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from './protocol';
import { GameSession } from './session';
import { fakeDeps, LocalNet } from './testHarness';

/** Ann (host, seat 0) and Bob (seat 1); the other seats are bots. Game started. */
function started(patch: Partial<RoomConfig>) {
  const { session, hostToken } = GameSession.create('room1', 1000, fakeDeps(), {
    graceMs: 10_000,
    botDelayMs: 500,
  });
  const net = new LocalNet(session, 1000);
  net.connect('host');
  net.send('host', { type: 'hello', token: hostToken, name: 'Ann' });
  net.connect('bob');
  net.send('bob', { type: 'hello', token: null, name: 'Bob' });
  net.connect('spec');
  net.send('spec', { type: 'hello', token: null, name: 'Sue' });
  net.send('host', {
    type: 'configure',
    config: { ...DEFAULT_ROOM_CONFIG, seatCount: 4, turnTimerSec: null, ...patch },
  });
  expect(net.last('host', 'error')).toBeUndefined();
  net.send('host', { type: 'takeSeat', seat: 0 });
  net.send('bob', { type: 'takeSeat', seat: 1 });
  net.send('host', { type: 'start' });
  expect(net.last('host', 'error')).toBeUndefined();
  return { net, session };
}

const legalOf = (net: LocalNet, conn: string): Action[] => net.last(conn, 'game')?.legal ?? [];

/** Humans play a legal action (expansion moves first); otherwise time passes for the bots. */
function playUntil(net: LocalNet, until: () => boolean, maxSteps = 3000): void {
  for (let i = 0; i < maxSteps && !until(); i++) {
    const conn = ['host', 'bob'].find((c) => legalOf(net, c).length > 0);
    if (conn) {
      const legal = legalOf(net, conn).filter((a) => !/offerTrade$/.test(a.type));
      const pick = legal[i % 3 === 0 ? legal.length - 1 : 0] ?? legalOf(net, conn)[0]!;
      net.send(conn, { type: 'intent', action: pick, seq: net.last(conn, 'game')!.seq });
      // Time passes between moves (10 intents a second; a 2-seat game has no bots to wait for).
      net.advance(100);
    } else {
      net.advance(500);
    }
  }
}

describe('GameSession: expansion modes online', () => {
  it.each([
    { mode: 'ck' },
    { mode: 'seafarers', scenario: 'seafarers/fogIslands' },
    { mode: 'ep', scenario: 'ep/landHo' },
    { mode: 'tb', scenario: 'tb/fishermen' },
    { mode: 'seafarers+ck', scenario: 'seafarers/newShores' },
    { mode: 'ep+ck', scenario: 'ep/pirateLairs', vpToWin: 17 },
    { mode: 'ep+tb', scenario: 'ep/fish' },
    { mode: 'ba+ck', scenario: 'tb/barbarianAttack' },
    { mode: 'two+ck', scenario: 'tb/variants', seatCount: 2 },
  ])('$mode $scenario: humans and bots play; each seat gets its own view', (patch) => {
    const { net, session } = started(patch);
    expect(session.state!.settings.mode).toBe(patch.mode);
    const types = new Set<string>();
    playUntil(net, () => {
      const s = session.state!;
      return s.turn.number >= 10 || session.phase !== 'playing';
    });
    const at = `${session.phase} turn ${session.state!.turn.number} ${session.state!.phase.kind}`;
    expect(session.state!.turn.number >= 10 || session.phase === 'over', at).toBe(true);
    for (const conn of ['host', 'bob', 'spec']) {
      expect(net.messages(conn, 'error')).toEqual([]);
      const games = net.messages(conn, 'game');
      for (const g of games) for (const a of g.legal) expect(a.player).toBe(g.view.view.viewer);
      // The latest view is exactly the engine's view for that seat (round-tripped as JSON).
      const last = games[games.length - 1]!;
      const seat = conn === 'host' ? 0 : conn === 'bob' ? 1 : 'spectator';
      expect(last.view).toEqual(JSON.parse(JSON.stringify(viewFor(session.state!, seat))));
      for (const g of games) for (const a of g.legal) types.add(a.type);
    }
    // An expansion's own move was offered (the combination modes: one of the composed ones).
    const ids = session.state!.settings.expansions;
    expect([...types].some((t) => ids.some((id) => t.startsWith(`${id}/`)))).toBe(true);
  });

  it('refuses unknown modes / scenarios and settings createGame would refuse', () => {
    const { session, hostToken } = GameSession.create('room1', 0, fakeDeps());
    const net = new LocalNet(session);
    net.connect('host');
    net.send('host', { type: 'hello', token: hostToken, name: 'Ann' });
    for (const patch of [
      { mode: 'atlantis' },
      { mode: 'ck', scenario: 'ep/landHo' },
      { mode: 'ck', variants: { rushMode: true } },
      { mode: 'ck', seatCount: 8 },
    ]) {
      net.clear('host');
      net.send('host', { type: 'configure', config: { ...DEFAULT_ROOM_CONFIG, ...patch } });
      expect(net.last('host', 'error')?.code).toBe('bad_message');
    }
    net.send('host', { type: 'sync' });
    expect(net.last('host', 'room')?.room.config).toEqual(DEFAULT_ROOM_CONFIG);
  });

  it('intent guard: only moves legalActions offers the seat now', () => {
    const { net, session } = started({ mode: 'ck' });
    playUntil(
      net,
      () => session.state!.phase.kind === 'preRoll' && legalOf(net, 'host').length > 0,
    );
    const seq = net.last('host', 'game')!.seq;
    net.clear('host');
    // A well-formed C&K action the seat may not take now (no knight there, wrong phase).
    net.send('host', {
      type: 'intent',
      action: { type: 'ck/chaseRobber', player: 0 },
      seq,
    });
    expect(net.last('host', 'error')?.code).toBe('illegal_action');
    // Another seat's action.
    net.send('host', { type: 'intent', action: { type: 'rollDice', player: 1 }, seq });
    expect(net.last('host', 'error')?.code).toBe('not_your_seat');
    // An unknown expansion action never reaches the engine.
    net.send('host', { type: 'intent', action: { type: 'ck/teleport', player: 0 }, seq });
    expect(net.last('host', 'error')?.code).toBe('bad_message');
    expect(net.last('host', 'game')).toBeUndefined();
  });

  it('T&B Traders: a spoke road (e:q,r,C<corner>) is accepted over the wire', () => {
    const { net, session } = started({ mode: 'tb', scenario: 'tb/traders' });
    const topo = topologyOf(session.state!);
    const spokes = Object.keys(topo.edge).filter((e) => /,C/.test(e)) as EdgeId[];
    const spokeEnds = new Set(spokes.flatMap((e) => topo.edge[e]!.vertices));
    const isSpoke = (a: Action) => 'edge' in a && /,C/.test(String(a.edge));
    let sent: Action | null = null;
    for (let i = 0; i < 400 && !sent; i++) {
      const conn = ['host', 'bob'].find((c) => legalOf(net, c).length > 0);
      if (!conn) {
        net.advance(500);
        continue;
      }
      const legal = legalOf(net, conn);
      // Settle on a plaza corner so a spoke road becomes legal; take it as soon as it is.
      const pick =
        legal.find(isSpoke) ??
        legal.find((a) => 'vertex' in a && spokeEnds.has(a.vertex as VertexId)) ??
        legal[0]!;
      if (isSpoke(pick)) sent = pick;
      const seq = net.last(conn, 'game')!.seq;
      net.send(conn, { type: 'intent', action: pick, seq });
      expect(net.messages(conn, 'error')).toEqual([]);
      net.advance(100);
    }
    expect(sent).not.toBeNull();
    const edge = (sent as { edge: EdgeId }).edge;
    expect(session.state!.pieces.roads[edge]).toBe(sent!.player);
  });
});
