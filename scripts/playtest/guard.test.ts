import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type PlayerId } from '../../src/engine';
import {
  discardGame,
  freshGame,
  gameOverGame,
  midGame,
  tradeOfferGame,
} from '../../src/engine/fixtures';
import { actingVerdict, mustDo, newLogEntries, staleTradeHint, wakeReason } from './guard';
import type { Snapshot, UiScan } from './protocol';

const EMPTY_UI: UiScan = {
  cover: null,
  screen: null,
  winnerText: null,
  hint: null,
  dialogTitle: null,
  dialogText: [],
  controls: [],
  steppers: [],
  toasts: [],
  hand: null,
  panels: [],
  diceTotal: null,
};

function snap(state: GameState, viewer: PlayerId, ui: Partial<UiScan> = {}): Snapshot {
  return {
    state,
    viewer,
    legal: legalActions(state),
    targets: [],
    ui: { ...EMPTY_UI, ...ui },
    consoleCount: 0,
  };
}

describe('online snapshots (own legal actions only)', () => {
  const online = (status = 'open', fatal: { code: string; message: string } | null = null) => ({
    room: 'ABC234',
    status,
    attempts: 0,
    seq: 5,
    roomPhase: 'playing',
    fatal,
    seats: [],
    chat: [],
    timerLeftMs: null,
    banner: null,
    notice: null,
  });
  const mine = (seat: PlayerId, o = online()): Snapshot => {
    const state = freshGame(3);
    return {
      ...snap(state, seat),
      legal: legalActions(state).filter((a) => a.player === seat),
      online: o,
    };
  };

  it('is not STALLED when this seat has nothing to do', () => {
    const state = freshGame(3);
    const other = (state.turn.current + 1) % 3;
    const s = mine(other);
    expect(s.legal).toEqual([]);
    expect(wakeReason(s, other)).toBeNull();
  });

  it('wakes the seat on the clock', () => {
    const state = freshGame(3);
    expect(wakeReason(mine(state.turn.current), state.turn.current)).toMatch(/^YOUR MOVE/);
  });

  // BUG-B3: Cancel offer is always legal for the offerer, so `wait` returned at once.
  it('keeps the offerer waiting while addressees still owe an answer', () => {
    const own = (state: GameState, seat: PlayerId): Snapshot => ({
      ...snap(state, seat),
      legal: legalActions(state).filter((a) => a.player === seat),
      online: online(),
    });
    // Blue (1) offered; Red rejected, White (2) still pending, Orange (3) accepted.
    const t = tradeOfferGame();
    expect(wakeReason(own(t, 1), 1)).toBeNull();
    expect(mustDo(t, 1, legalActions(t))).toMatch(/waiting for White to answer: `wait`/);
    // The pending responder is woken to answer.
    const pendingSeat = t.phase.kind === 'trade' ? t.phase.offer.responses.indexOf('pending') : -1;
    expect(wakeReason(own(t, pendingSeat), pendingSeat)).toMatch(
      /^YOUR MOVE: .* offers you a trade/,
    );
    // Everyone answered: the offerer wakes to confirm or cancel.
    if (t.phase.kind === 'trade') t.phase.offer.responses[pendingSeat] = 'rejected';
    expect(wakeReason(own(t, 1), 1)).toMatch(/^YOUR MOVE: Your trade offer is open: confirm/);
  });

  it('explains a click on a trade button of an offer that already closed', () => {
    const m = midGame();
    m.log.push({ turn: 46, player: null, text: 'Everyone rejected the offer' });
    expect(staleTradeHint(m, 'Cancel offer')).toMatch(
      /already closed.*"T46 Everyone rejected the offer"/,
    );
    expect(staleTradeHint(m, 'Roll dice')).toBeNull();
    expect(staleTradeHint(m, 'Trade')).toBeNull(); // the Trade (composer) button itself
    expect(staleTradeHint(tradeOfferGame(), 'Cancel offer')).toBeNull();
  });

  it('wakes on a fatal close and refuses acting while offline', () => {
    const cur = freshGame(3).turn.current;
    const dead = mine(cur, online('closed', { code: 'replaced', message: 'Another tab.' }));
    expect(wakeReason(dead, cur)).toMatch(/DISCONNECTED for good \(replaced\)/);
    const off = actingVerdict(mine(cur, online('reconnecting')), cur, 'act');
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.reason).toMatch(/offline/);
  });
});

describe('actingVerdict (seat guard)', () => {
  it('lets only the viewer with a legal action act', () => {
    const s = snap(freshGame(3), 0);
    expect(actingVerdict(s, 0, 'act')).toEqual({ ok: true });
    const other = actingVerdict(s, 1, 'act');
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.reason).toMatch(/Not your moment: screen is with Red/);
  });

  it('allows only `pass` while the cover is up, and only for the covered seat', () => {
    const s = snap(freshGame(3), 1, { cover: 'Pass to Blue' });
    expect(actingVerdict(s, 1, 'pass')).toEqual({ ok: true });
    expect(actingVerdict(s, 1, 'act')).toMatchObject({ ok: false });
    expect(actingVerdict(s, 2, 'pass')).toMatchObject({ ok: false });
    expect(actingVerdict(snap(freshGame(3), 0), 0, 'pass')).toMatchObject({ ok: false });
  });

  it('refuses the viewer when it has nothing to do', () => {
    // Trade fixture: Blue offered; Red and Orange already answered, White pending.
    const s = snap(tradeOfferGame(), 0);
    expect(actingVerdict(s, 0, 'act')).toMatchObject({ ok: false });
  });

  it('refuses everything once the game is over', () => {
    const s = snap(gameOverGame(), 0);
    expect(actingVerdict(s, 0, 'act')).toMatchObject({ ok: false });
    expect(actingVerdict(s, 0, 'pass')).toMatchObject({ ok: false });
  });

  it('has no seat limit of its own (5-8 player games)', () => {
    const s = snap(freshGame(4), 0);
    for (const seat of [1, 2, 3, 4, 5, 6, 7]) {
      expect(actingVerdict(s, seat, 'act')).toMatchObject({ ok: false });
      expect(wakeReason(s, seat)).toBeNull();
    }
  });
});

describe('wakeReason / mustDo', () => {
  it('wakes the viewer with its task and tells it to pass first if covered', () => {
    expect(wakeReason(snap(freshGame(3), 0), 0)).toMatch(/^YOUR MOVE: Place your setup settlement/);
    expect(wakeReason(snap(freshGame(3), 0, { cover: 'Pass to Red' }), 0)).toMatch(
      /screen is covered: run `pass` first/,
    );
    expect(wakeReason(snap(freshGame(3), 0), 1)).toBeNull();
  });

  it('wakes everyone on game over', () => {
    for (const p of [0, 1, 2, 3])
      expect(wakeReason(snap(gameOverGame(), 0), p)).toMatch(/^GAME OVER/);
  });

  it('wakes everyone when the game is stalled', () => {
    const s = { ...snap(freshGame(3), 0), legal: [] };
    expect(wakeReason(s, 2)).toMatch(/^STALLED/);
  });

  it('describes discards, trades and the main phase', () => {
    const d = discardGame();
    expect(mustDo(d, 1, legalActions(d))).toMatch(/^Discard 5 cards/);
    const t = tradeOfferGame();
    expect(mustDo(t, 2, legalActions(t))).toMatch(/offers you a trade/);
    expect(mustDo(t, 1, legalActions(t))).toMatch(/^Your trade offer is open/);
    const m = midGame();
    expect(mustDo(m, 1, legalActions(m))).toMatch(/End turn/);
    expect(mustDo(m, 0, legalActions(m))).toBe('Nothing to do right now.');
  });
});

describe('newLogEntries', () => {
  const e = (text: string, turn = 1) => ({ turn, player: 0, text });

  it('returns only what was appended', () => {
    expect(newLogEntries([e('a'), e('b')], [e('a'), e('b'), e('c')])).toEqual([e('c')]);
    expect(newLogEntries([e('a')], [e('a')])).toEqual([]);
    expect(newLogEntries([], [e('a')])).toEqual([e('a')]);
  });

  it('copes with the log being trimmed at the front', () => {
    expect(newLogEntries([e('a'), e('b'), e('c')], [e('b'), e('c'), e('d'), e('e')])).toEqual([
      e('d'),
      e('e'),
    ]);
  });

  it('does not confuse a repeated text in the same turn', () => {
    const before = [e('x'), e('rolled 6')];
    const after = [e('x'), e('rolled 6'), e('y'), e('rolled 6')];
    expect(newLogEntries(before, after)).toEqual([e('y'), e('rolled 6')]);
  });
});
