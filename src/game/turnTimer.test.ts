import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, Rng, type Action, type GameState } from '../engine';
import {
  discardGame,
  freshGame,
  gameOverGame,
  midGame,
  moveRobberGame,
  tradeOfferGame,
} from '../engine/fixtures';
import type { Seats } from './logic';
import {
  IDLE_CLOCK,
  clockView,
  isExpired,
  syncClock,
  tickClock,
  timeoutMove,
  timerSlot,
  type TurnClock,
} from './turnTimer';

const HUMANS: Seats = ['human', 'human', 'human', 'human'];
const slot = (s: GameState, seats: Seats = HUMANS, viewer: number | null = null) =>
  timerSlot(s, seats, legalActions(s), viewer);

function run(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe('timerSlot', () => {
  it('times the current human for their turn', () => {
    expect(slot(midGame())).toEqual({ key: 'turn:12:1', kind: 'turn', player: 1 });
  });

  it('never times bots', () => {
    expect(slot(midGame(), ['human', 'bot', 'human', 'human'])).toBeNull();
  });

  it('times setup placements per snake index', () => {
    expect(slot(freshGame())).toEqual({ key: 'setup:0', kind: 'turn', player: 0 });
  });

  it('times the viewer among humans owing a discard, else the first in table order', () => {
    expect(slot(discardGame(), HUMANS, 3)).toMatchObject({ kind: 'discard', player: 3 });
    expect(slot(discardGame(), HUMANS, 0)).toMatchObject({ kind: 'discard', player: 1 });
    // A bot owing a discard is not timed; the human one is.
    expect(slot(discardGame(), ['human', 'bot', 'human', 'human'])).toMatchObject({ player: 3 });
    // Only bots owe: nobody is on the clock.
    expect(slot(discardGame(), ['human', 'bot', 'human', 'bot'])).toBeNull();
  });

  it('times pending trade replies, then the offerer', () => {
    expect(slot(tradeOfferGame())).toEqual({ key: 'trade:12:0:2', kind: 'trade', player: 2 });
    // The pending responder is a bot: the human offerer is on their turn clock.
    expect(slot(tradeOfferGame(), ['human', 'human', 'bot', 'human'])).toEqual({
      key: 'turn:12:1',
      kind: 'turn',
      player: 1,
    });
  });

  it('times a special build step', () => {
    const s = midGame();
    s.phase = { kind: 'specialBuild', builder: 2, owner: 1 };
    s.turn.current = 2;
    expect(slot(s)).toEqual({ key: 'specialBuild:12:2', kind: 'specialBuild', player: 2 });
  });

  it('is null once the game is over', () => {
    expect(slot(gameOverGame())).toBeNull();
  });
});

describe('clock', () => {
  const turn = { key: 'turn:5:0', kind: 'turn', player: 0 } as const;
  const discard = { key: 'discard:5:2', kind: 'discard', player: 2 } as const;
  const next = { key: 'turn:6:1', kind: 'turn', player: 1 } as const;

  it('starts full, counts down, expires at zero and stays there', () => {
    let c = syncClock(IDLE_CLOCK, turn, 30000);
    expect(clockView(c)).toEqual({ remainingSec: 30, totalSec: 30 });
    c = tickClock(c, 10000);
    expect(c.remainingMs).toBe(20000);
    expect(syncClock(c, turn, 30000)).toBe(c); // same slot: unchanged
    c = tickClock(c, 25000);
    expect(c.remainingMs).toBe(0);
    expect(isExpired(c)).toBe(true);
    expect(isExpired(IDLE_CLOCK)).toBe(false);
  });

  it('pauses the turn while someone else reacts, then resumes it', () => {
    let c: TurnClock = tickClock(syncClock(IDLE_CLOCK, turn, 30000), 12000);
    c = syncClock(c, discard, 30000);
    expect(c.remainingMs).toBe(30000);
    c = tickClock(c, 5000);
    c = syncClock(c, turn, 30000);
    expect(c).toMatchObject({ key: 'turn:5:0', remainingMs: 18000, stash: null });
  });

  it('keeps the stash across bot reactions (no slot)', () => {
    let c = tickClock(syncClock(IDLE_CLOCK, turn, 30000), 4000);
    c = syncClock(c, null, 30000);
    expect(clockView(c)).toBeNull();
    expect(tickClock(c, 1000)).toBe(c);
    c = syncClock(c, turn, 30000);
    expect(c.remainingMs).toBe(26000);
  });

  it('starts the next turn fresh and drops the stash', () => {
    let c = tickClock(syncClock(IDLE_CLOCK, turn, 30000), 4000);
    c = syncClock(c, discard, 30000);
    c = syncClock(c, next, 30000);
    expect(c).toMatchObject({ key: 'turn:6:1', remainingMs: 30000, stash: null });
  });

  it('resumes an expired turn as expired', () => {
    let c = tickClock(syncClock(IDLE_CLOCK, turn, 30000), 30000);
    c = syncClock(c, discard, 30000);
    expect(isExpired(c)).toBe(false); // someone else discarding gets full time
    c = syncClock(c, turn, 30000);
    expect(isExpired(c)).toBe(true);
  });

  it('gives a timed-out player no fresh time to discard on their own 7', () => {
    let c = tickClock(syncClock(IDLE_CLOCK, turn, 30000), 30000);
    c = syncClock(c, { key: 'discard:5:0', kind: 'discard', player: 0 }, 30000);
    expect(isExpired(c)).toBe(true);
  });
});

describe('timeoutMove', () => {
  const rng = () => new Rng(7);
  const move = (s: GameState, p: number) => timeoutMove(s, legalActions(s), p, rng());

  it('rolls before anything else (no knight)', () => {
    const s = midGame();
    s.phase = { kind: 'preRoll' };
    expect(move(s, 1)).toEqual({ type: 'rollDice', player: 1 });
  });

  it('ends the turn in main', () => {
    expect(move(midGame(), 1)).toEqual({ type: 'endTurn', player: 1 });
  });

  it('discards a random legal selection of the right size', () => {
    const s = discardGame();
    const a = move(s, 3);
    expect(a?.type).toBe('discard');
    expect(applyAction(s, a!).ok).toBe(true);
  });

  it('moves the robber, then steals, at random', () => {
    let s = moveRobberGame();
    const a = move(s, 1);
    expect(a?.type).toBe('moveRobber');
    s = run(s, a!);
    if (s.phase.kind === 'steal') expect(move(s, 1)?.type).toBe('steal');
  });

  it('rejects an open trade reply, cancels the own offer', () => {
    const s = tradeOfferGame();
    expect(move(s, 2)).toEqual({ type: 'rejectTrade', player: 2 });
    expect(move(s, 1)).toEqual({ type: 'cancelTrade', player: 1 });
  });

  it('places setup pieces and free roads at random, passes a special build step', () => {
    let s = freshGame();
    const settle = move(s, 0);
    expect(settle?.type).toBe('placeSetupSettlement');
    s = run(s, settle!);
    expect(move(s, 0)?.type).toBe('placeSetupRoad');

    const rb = midGame();
    rb.phase = { kind: 'roadBuilding', remaining: 2, resume: 'main' };
    expect(move(rb, 1)?.type).toBe('placeFreeRoad');

    const sb = midGame();
    sb.phase = { kind: 'specialBuild', builder: 2, owner: 1 };
    sb.turn.current = 2;
    expect(move(sb, 2)).toEqual({ type: 'passSpecialBuild', player: 2 });
  });

  it('is null for a player with nothing to do', () => {
    expect(move(midGame(), 0)).toBeNull();
  });

  it('a timed-out turn reaches the next player through minimum moves only', () => {
    let s = midGame();
    s.phase = { kind: 'preRoll' };
    const r = rng();
    for (let i = 0; i < 40 && s.turn.number === 12; i++) {
      const legal = legalActions(s);
      // Whoever must act (the roller, or anyone discarding) times out.
      const actor = [1, 0, 2, 3].find((p) => legal.some((a) => a.player === p))!;
      const a = timeoutMove(s, legal, actor, r);
      expect(a).not.toBeNull();
      expect(['buildRoad', 'buildCity', 'bankTrade', 'offerTrade', 'buyDevCard']).not.toContain(
        a!.type,
      );
      s = run(s, a!);
    }
    expect(s.turn.number).toBe(13);
  });
});
