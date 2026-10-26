import { describe, expect, it } from 'vitest';
import { applyAction, type Action, type GameState } from '../engine';
import { midGame, tradeOfferGame } from '../engine/fixtures';
import { tradeEndNotice } from './logic';

// Fixture: Blue (1) offers 1 ore for 1 brick; Red (0) rejected, White (2) pending, Orange (3)
// accepted.
function offer(): GameState {
  const s = tradeOfferGame();
  for (const p of s.players) p.resources = { ...p.resources, ore: 2, brick: 2 };
  return s;
}

function after(state: GameState, ...actions: Action[]): GameState {
  let s = state;
  for (const a of actions) {
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
    s = r.state;
  }
  return s;
}

describe('tradeEndNotice (BUG-B3)', () => {
  it('tells an accepter that the offerer withdrew', () => {
    const prev = offer();
    const next = after(prev, { type: 'cancelTrade', player: 1 });
    expect(next.log.at(-1)?.text).toBe('Blue withdrew the offer');
    expect(tradeEndNotice(prev, next, 3)).toBe('Blue withdrew the offer you accepted');
    expect(tradeEndNotice(prev, next, 2)).toBe('Blue withdrew the offer');
    // The offerer: told when it was not their own click (turn timer), quiet otherwise.
    expect(tradeEndNotice(prev, next, 1)).toBe('Your trade offer was withdrawn');
    expect(tradeEndNotice(prev, next, 1, true)).toBeNull();
  });

  it('tells the offerer that everyone rejected', () => {
    const prev = offer();
    if (prev.phase.kind === 'trade') prev.phase.offer.responses[3] = 'pending';
    const mid = after(prev, { type: 'rejectTrade', player: 3 });
    const next = after(mid, { type: 'rejectTrade', player: 2 });
    expect(next.phase.kind).toBe('main');
    expect(tradeEndNotice(mid, next, 1)).toBe('Everyone rejected your offer');
    expect(tradeEndNotice(mid, next, 2)).toBeNull();
    expect(tradeEndNotice(mid, next, 2, true)).toBeNull();
  });

  it('tells the partner and an accepter who was not picked', () => {
    const prev = offer();
    if (prev.phase.kind === 'trade') prev.phase.offer.responses[0] = 'accepted';
    const next = after(prev, { type: 'confirmTrade', player: 1, partner: 3 });
    expect(tradeEndNotice(prev, next, 3)).toMatch(/^Trade done: Blue traded 1 ore to Orange/);
    expect(tradeEndNotice(prev, next, 0)).toBe('Blue traded with Orange');
    expect(tradeEndNotice(prev, next, 1)).toBeNull();
  });

  it('is quiet while the offer is open, outside trades, and for bystanders', () => {
    const prev = offer();
    if (prev.phase.kind === 'trade') prev.phase.offer.responses[0] = 'pending';
    const still = after(prev, { type: 'rejectTrade', player: 0 });
    expect(tradeEndNotice(prev, still, 0)).toBeNull();
    expect(tradeEndNotice(midGame(), midGame(), 1)).toBeNull();
    // Red was never asked.
    const unasked = offer();
    if (unasked.phase.kind === 'trade') unasked.phase.offer.responses[0] = null;
    expect(
      tradeEndNotice(unasked, after(unasked, { type: 'cancelTrade', player: 1 }), 0),
    ).toBeNull();
  });
});
