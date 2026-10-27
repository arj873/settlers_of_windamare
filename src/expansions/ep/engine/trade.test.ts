import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../../../engine/engine';
import { EVENT_CARD_IDS, EVENT_CARDS } from '../../../engine/rules/events';
import type { Action, GameState } from '../../../engine/types';
import { epSlice } from './state';
import { blank, give, movement, R, run, tryAct } from './testkit';

const goldOf = (s: GameState, p: number) => epSlice(s).gold[p] ?? 0;
const offer = (s: GameState, payload: object) =>
  tryAct(s, 'ep/offerTrade', 0, { to: [1, 2, 3], ...payload });

describe('player trades with gold (§3.3, M6 p. 5)', () => {
  it('gold for resources: offer, accept, confirm moves both sides', () => {
    let s = blank();
    epSlice(s).gold[0] = 3;
    give(s, 1, { ore: 2 });
    s = run(s, 'ep/offerTrade', 0, { giveGold: 2, want: { ore: 1 }, to: [1, 2] });
    expect(s.phase.kind).toBe('trade');
    expect(epSlice(s).trade).toEqual({ give: 2, want: 0 });
    s = run(s, 'acceptTrade', 1);
    s = run(s, 'confirmTrade', 0, { partner: 1 });
    expect(goldOf(s, 0)).toBe(1);
    expect(goldOf(s, 1)).toBe(2);
    expect(s.players[0]?.resources.ore).toBe(1);
    expect(s.players[1]?.resources.ore).toBe(1);
    expect(s.phase.kind).toBe('main');
    expect(epSlice(s).trade ?? null).toBeNull();
    expect(s.log.at(-1)?.text).toMatch(/ traded 2 gold to .+ for 1 ore$/);
  });

  it('resources for gold, mixed with resources on the wanted side', () => {
    let s = blank();
    give(s, 0, { wool: 2 });
    epSlice(s).gold[1] = 1;
    give(s, 1, { brick: 1 });
    s = run(s, 'ep/offerTrade', 0, { give: { wool: 2 }, want: { brick: 1 }, wantGold: 1, to: [1] });
    s = run(s, 'acceptTrade', 1);
    s = run(s, 'confirmTrade', 0, { partner: 1 });
    expect(goldOf(s, 0)).toBe(1);
    expect(goldOf(s, 1)).toBe(0);
    expect(s.players[0]?.resources).toEqual(R({ brick: 1 }));
    expect(s.players[1]?.resources).toEqual(R({ wool: 2 }));
    expect(s.log.at(-1)?.text).toMatch(/ traded 2 wool to .+ for 1 brick, 1 gold$/);
  });

  it('a partner without the gold asked for cannot accept', () => {
    let s = blank();
    give(s, 0, { grain: 1 });
    s = run(s, 'ep/offerTrade', 0, { give: { grain: 1 }, wantGold: 2, to: [1] });
    expect(tryAct(s, 'acceptTrade', 1).ok).toBe(false);
    expect(legalActions(s, 1).some((a) => a.type === 'acceptTrade')).toBe(false);
    epSlice(s).gold[1] = 2;
    expect(tryAct(s, 'acceptTrade', 1).ok).toBe(true);
  });

  it('confirm checks the gold again (spent meanwhile)', () => {
    let s = blank();
    epSlice(s).gold[0] = 1;
    give(s, 1, { ore: 1 });
    s = run(s, 'ep/offerTrade', 0, { giveGold: 1, want: { ore: 1 }, to: [1] });
    s = run(s, 'acceptTrade', 1);
    epSlice(s).gold[0] = 0;
    expect(tryAct(s, 'confirmTrade', 0, { partner: 1 }).ok).toBe(false);
    expect(legalActions(s, 0).some((a) => a.type === 'confirmTrade')).toBe(false);
  });

  it('refuses bad offers: no gold, gold both ways, empty side, not held, Movement phase', () => {
    const s = blank();
    give(s, 0, { ore: 1 });
    epSlice(s).gold[0] = 1;
    expect(offer(s, { give: { ore: 1 }, want: { wool: 1 } }).ok).toBe(false);
    expect(offer(s, { giveGold: 1, wantGold: 1, want: { wool: 1 } }).ok).toBe(false);
    expect(offer(s, { giveGold: 1 }).ok).toBe(false);
    expect(offer(s, { giveGold: 2, want: { wool: 1 } }).ok).toBe(false);
    expect(offer(s, { give: { ore: 1 }, want: { ore: 1 }, wantGold: 1 }).ok).toBe(false);
    expect(offer(s, { giveGold: -1, want: { wool: 1 } }).ok).toBe(false);
    expect(offer(s, { giveGold: 1, want: { wool: 1 }, to: [0] }).ok).toBe(false);
    expect(offer(s, { giveGold: 1, want: { wool: 1 } }).ok).toBe(true);
    expect(offer(movement(s), { giveGold: 1, want: { wool: 1 } }).ok).toBe(false);
  });

  it('the second player of a pair may not trade with players (§8.1)', () => {
    const s = blank('full', 4);
    epSlice(s).gold[0] = 1;
    s.turn.secondSettlerOf = 3;
    expect(offer(s, { giveGold: 1, want: { wool: 1 } }).ok).toBe(false);
  });

  it('legal offers are sound', () => {
    const s = blank();
    epSlice(s).gold[0] = 1;
    give(s, 0, { lumber: 1 });
    const offers = legalActions(s, 0).filter((a) => a.type === 'ep/offerTrade');
    expect(offers.length).toBeGreaterThan(0);
    for (const a of offers) expect(applyAction(s, a as Action).ok).toBe(true);
  });
});

describe('Event Cards give only the number (E&P + T&B sheet)', () => {
  it('the event of a drawn card is dropped, its number still produces', () => {
    let s = blank('pirateLairs');
    s.settings = { ...s.settings, eventCards: true };
    s.phase = { kind: 'preRoll' };
    // Plentiful Year (a 2) on top: every player would take a resource.
    const id = EVENT_CARDS.findIndex((c) => c.event === 'plentifulYear');
    s.eventDeck = [...EVENT_CARD_IDS.filter((x) => x !== id), id];
    s = run(s, 'rollDice', 0);
    expect((s.dice?.[0] ?? 0) + (s.dice?.[1] ?? 0)).toBe(2);
    expect(s.lastEvent).toBe('none');
    expect(s.phase.kind).toBe('main');
    expect(s.log.some((l) => l.text.includes('only the number'))).toBe(true);
  });
});
