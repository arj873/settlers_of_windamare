import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../engine';
import { midGame, tradeOfferGame } from '../fixtures';
import { emptyResources } from '../resources';
import type { Action, GameState, PlayerId } from '../types';
import { bankTradeRatio } from './trade';

// midGame ports: Red generic, Blue ore + wool, White lumber, Orange none. Blue (1) to act.

function as(p: PlayerId, s = midGame()): GameState {
  s.turn.current = p;
  return s;
}

function apply(s: GameState, action: Action): GameState {
  const r = applyAction(s, action);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function err(s: GameState, action: Action): string {
  const r = applyAction(s, action);
  return r.ok ? 'ok' : r.error;
}

function expectSound(s: GameState): void {
  for (const a of legalActions(s)) expect(applyAction(s, a).ok, JSON.stringify(a)).toBe(true);
}

const bank = (player: PlayerId, give: string, receive: string) =>
  ({ type: 'bankTrade', player, give, receive }) as Action;

describe('bankTrade', () => {
  it('4:1 without a port', () => {
    const s = as(3);
    expect(bankTradeRatio(s, 3, 'lumber')).toBe(4);
    expect(err(s, bank(3, 'lumber', 'ore'))).toBe('need 4 lumber');
    s.players[3]!.resources.lumber = 4;
    const out = apply(s, bank(3, 'lumber', 'ore'));
    expect(out.players[3]!.resources.lumber).toBe(0);
    expect(out.players[3]!.resources.ore).toBe(3);
    expect(out.bank.lumber).toBe(s.bank.lumber + 4);
    expect(out.bank.ore).toBe(s.bank.ore - 1);
    expect(out.log.at(-1)?.text).toBe('Orange traded 4 lumber for 1 ore with the bank');
  });

  it('3:1 with a generic port', () => {
    const s = as(0);
    expect(bankTradeRatio(s, 0, 'brick')).toBe(3);
    expect(err(s, bank(0, 'brick', 'ore'))).toBe('need 3 brick');
    s.players[0]!.resources.brick = 3;
    expect(apply(s, bank(0, 'brick', 'ore')).players[0]!.resources.brick).toBe(0);
  });

  it('2:1 with the matching port, only for that resource', () => {
    const s = midGame();
    expect(bankTradeRatio(s, 1, 'ore')).toBe(2);
    expect(bankTradeRatio(s, 1, 'wool')).toBe(2);
    expect(bankTradeRatio(s, 1, 'grain')).toBe(4);
    const out = apply(s, bank(1, 'ore', 'brick'));
    expect(out.players[1]!.resources.ore).toBe(1);
    expect(out.players[1]!.resources.brick).toBe(1);
    expect(err(s, bank(1, 'grain', 'brick'))).toBe('need 4 grain');
  });

  it('a 2:1 port beats a generic port; generic applies to other resources', () => {
    const s = as(2);
    s.pieces.buildings['v:3,-1,S'] = { owner: 2, kind: 'settlement' }; // generic port
    expect(bankTradeRatio(s, 2, 'lumber')).toBe(2);
    expect(bankTradeRatio(s, 2, 'ore')).toBe(3);
  });

  it('a port counts from either of its vertices, also with a city', () => {
    const s = as(3);
    s.pieces.buildings['v:2,-3,S'] = { owner: 3, kind: 'city' }; // grain port, 2nd vertex
    expect(bankTradeRatio(s, 3, 'grain')).toBe(2);
  });

  it('the bank must have the resource', () => {
    const s = midGame();
    s.bank.brick = 0;
    expect(err(s, bank(1, 'ore', 'brick'))).toBe('the bank has no brick');
  });

  it('rejects same resource, bad resources, wrong phase and other players', () => {
    expect(err(midGame(), bank(1, 'ore', 'ore'))).toMatch(/different/);
    expect(err(midGame(), bank(1, 'ore', 'gold'))).toBe('invalid resource');
    const pre = midGame();
    pre.phase = { kind: 'preRoll' };
    expect(err(pre, bank(1, 'ore', 'brick'))).toMatch(/main phase/);
    expect(err(midGame(), bank(0, 'brick', 'ore'))).toBe('not your turn');
  });
});

const offer = (give: object, want: object, to: PlayerId[] = [0, 2, 3]) =>
  ({ type: 'offerTrade', player: 1, give, want, to }) as Action;

describe('offerTrade', () => {
  it('opens a trade phase addressed to the listed players', () => {
    const out = apply(midGame(), offer({ ore: 1, wool: 1 }, { brick: 1 }, [0, 3]));
    expect(out.phase).toEqual({
      kind: 'trade',
      offer: {
        from: 1,
        give: { ...emptyResources(), ore: 1, wool: 1 },
        want: { ...emptyResources(), brick: 1 },
        responses: ['pending', null, null, 'pending'],
      },
    });
    expect(out.log.at(-1)?.text).toBe('Blue offers 1 wool, 1 ore for 1 brick');
    // Resources do not move until confirm.
    expect(out.players).toEqual(midGame().players);
  });

  it('rejects giving or asking for nothing, and overlapping resources', () => {
    expect(err(midGame(), offer({}, { brick: 1 }))).toMatch(/non-empty/);
    expect(err(midGame(), offer({ ore: 1 }, {}))).toMatch(/non-empty/);
    expect(err(midGame(), offer({ ore: 1 }, { ore: 0 }))).toMatch(/non-empty/);
    expect(err(midGame(), offer({ ore: 1, wool: 1 }, { ore: 1 }))).toMatch(/same resource/);
  });

  it('the offerer must hold what they give', () => {
    expect(err(midGame(), offer({ ore: 4 }, { brick: 1 }))).toMatch(/do not have/);
  });

  it('rejects malformed bundles', () => {
    expect(err(midGame(), offer({ ore: -1 }, { brick: 1 }))).toBe('invalid resources');
    expect(err(midGame(), offer({ ore: 1.5 }, { brick: 1 }))).toBe('invalid resources');
    expect(err(midGame(), offer({ gold: 1 }, { brick: 1 }))).toBe('invalid resources');
  });

  it('must be addressed to distinct other players', () => {
    for (const to of [[], [1], [0, 0], [4], [-1], [0.5]]) {
      expect(err(midGame(), offer({ ore: 1 }, { brick: 1 }, to))).toMatch(/addressed/);
    }
  });

  it('only the current player, only in main', () => {
    expect(err(midGame(), { ...offer({ brick: 1 }, { ore: 1 }), player: 0 } as Action)).toBe(
      'not your turn',
    );
    const pre = midGame();
    pre.phase = { kind: 'preRoll' };
    expect(err(pre, offer({ ore: 1 }, { brick: 1 }))).toMatch(/main phase/);
    expect(err(tradeOfferGame(), offer({ ore: 1 }, { brick: 1 }))).toMatch(/main phase/);
  });
});

describe('responding to an offer', () => {
  // tradeOfferGame: Blue offers 1 ore for 1 brick; Red rejected, White pending, Orange accepted.

  it('an addressed player accepts if they hold the wanted cards', () => {
    const s = tradeOfferGame();
    expect(err(s, { type: 'acceptTrade', player: 2 })).toMatch(/do not have/);
    s.players[2]!.resources.brick = 1;
    const out = apply(s, { type: 'acceptTrade', player: 2 });
    expect(out.phase.kind === 'trade' && out.phase.offer.responses).toEqual([
      'rejected',
      null,
      'accepted',
      'accepted',
    ]);
  });

  it('only pending players may respond', () => {
    const s = tradeOfferGame();
    expect(err(s, { type: 'rejectTrade', player: 0 })).toMatch(/nothing to respond/);
    expect(err(s, { type: 'acceptTrade', player: 3 })).toMatch(/nothing to respond/);
    expect(err(s, { type: 'acceptTrade', player: 1 })).toMatch(/nothing to respond/);
    expect(err(midGame(), { type: 'rejectTrade', player: 0 })).toBe('no open trade offer');
  });

  it('closes automatically when everyone rejected', () => {
    let s = apply(midGame(), offer({ ore: 1 }, { brick: 1 }, [0, 2]));
    s = apply(s, { type: 'rejectTrade', player: 0 });
    expect(s.phase.kind).toBe('trade');
    s = apply(s, { type: 'rejectTrade', player: 2 });
    expect(s.phase).toEqual({ kind: 'main' });
  });

  it('stays open after rejections if someone accepted', () => {
    const s = apply(tradeOfferGame(), { type: 'rejectTrade', player: 2 });
    expect(s.phase.kind).toBe('trade');
  });
});

describe('confirmTrade / cancelTrade', () => {
  it('swaps resources with an accepted partner and returns to main', () => {
    const s = tradeOfferGame();
    const out = apply(s, { type: 'confirmTrade', player: 1, partner: 3 });
    expect(out.phase).toEqual({ kind: 'main' });
    expect(out.players[1]!.resources.ore).toBe(s.players[1]!.resources.ore - 1);
    expect(out.players[1]!.resources.brick).toBe(s.players[1]!.resources.brick + 1);
    expect(out.players[3]!.resources.ore).toBe(s.players[3]!.resources.ore + 1);
    expect(out.players[3]!.resources.brick).toBe(s.players[3]!.resources.brick - 1);
    expect(out.bank).toEqual(s.bank);
    expect(out.log.at(-1)?.text).toBe('Blue traded 1 ore to Orange for 1 brick');
  });

  it('partner must have accepted', () => {
    const s = tradeOfferGame();
    for (const partner of [0, 1, 2, 7]) {
      expect(err(s, { type: 'confirmTrade', player: 1, partner })).toMatch(/not accepted/);
    }
  });

  it('both sides must still hold the cards at confirm time', () => {
    const s = tradeOfferGame();
    s.players[3]!.resources.brick = 0;
    expect(err(s, { type: 'confirmTrade', player: 1, partner: 3 })).toMatch(/no longer/);
    const s2 = tradeOfferGame();
    s2.players[1]!.resources.ore = 0;
    expect(err(s2, { type: 'confirmTrade', player: 1, partner: 3 })).toMatch(/no longer/);
  });

  it('only the offerer confirms or cancels', () => {
    const s = tradeOfferGame();
    expect(err(s, { type: 'confirmTrade', player: 3, partner: 3 })).toMatch(/only the offerer/);
    expect(err(s, { type: 'cancelTrade', player: 3 })).toMatch(/only the offerer/);
    expect(err(midGame(), { type: 'cancelTrade', player: 1 })).toBe('no open trade offer');
  });

  it('cancel returns to main without moving resources', () => {
    const s = tradeOfferGame();
    const out = apply(s, { type: 'cancelTrade', player: 1 });
    expect(out.phase).toEqual({ kind: 'main' });
    expect(out.players).toEqual(s.players);
  });
});

describe('tradeLegal', () => {
  it('offers bank trades at the right ratio and 1:1 player offers in main', () => {
    const acts = legalActions(midGame()).filter(
      (a) => a.type === 'bankTrade' || a.type === 'offerTrade',
    );
    const banks = acts.filter((a) => a.type === 'bankTrade');
    // Blue: 3 ore (2:1) -> 4 targets; 2 wool (2:1) -> 4 targets; grain 3 < 4.
    expect(banks).toHaveLength(8);
    const offers = acts.filter((a) => a.type === 'offerTrade');
    // Blue holds lumber, wool, grain, ore -> 4 x 4 offers.
    expect(offers).toHaveLength(16);
    expect(offers[0]).toMatchObject({ to: [0, 2, 3] });
  });

  it('lists responses for each acting player during a trade', () => {
    const s = tradeOfferGame();
    const acts = legalActions(s);
    expect(acts).toEqual([
      { type: 'cancelTrade', player: 1 },
      { type: 'rejectTrade', player: 2 },
      { type: 'confirmTrade', player: 1, partner: 3 },
    ]);
  });

  it('is sound in main, preRoll and trade states', () => {
    const pre = midGame();
    pre.phase = { kind: 'preRoll' };
    expect(legalActions(pre).some((a) => a.type === 'bankTrade' || a.type === 'offerTrade')).toBe(
      false,
    );
    const accepting = tradeOfferGame();
    accepting.players[2]!.resources.brick = 2;
    for (const s of [midGame(), as(0), as(3), pre, tradeOfferGame(), accepting]) expectSound(s);
  });
});
