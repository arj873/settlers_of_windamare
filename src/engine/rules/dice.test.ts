/** Balanced dice (T13, RULES.md §17): rolls drawn from a 36-card deck of two-dice outcomes. */
import { describe, expect, it } from 'vitest';
import { DICE_DECK_RESHUFFLE_AT, DICE_DECK_SIZE } from '../constants';
import { createGame } from '../createGame';
import { applyAction } from '../engine';
import { PLAYER_COLORS } from '../constants';
import { upgradeState } from '../migrate';
import { Rng } from '../rng';
import type { GameState } from '../types';
import { expectOk } from '../actions/testkit';
import { DICE_CARDS, diceOfCard, rollTwoDice } from './dice';

/** Ways to roll each total 2..12 with two dice: 1,2,3,4,5,6,5,4,3,2,1. */
const WAYS: Record<number, number> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
};
/** Cards drawn between two reshuffles. */
const CYCLE = DICE_DECK_SIZE - DICE_DECK_RESHUFFLE_AT;

function game(balancedDice: boolean, seed: number | string = 1): GameState {
  return createGame({ seed, players: PLAYER_COLORS.slice(0, 4), balancedDice });
}

/** Roll `n` times on a private copy (rollTwoDice mutates its draft). */
function rolls(s: GameState, n: number): { dice: [number, number]; deckBefore: number[] }[] {
  const draft = structuredClone(s);
  return Array.from({ length: n }, () => {
    const deckBefore = [...draft.diceDeck];
    return { dice: rollTwoDice(draft).dice, deckBefore };
  });
}

const total = ([a, b]: [number, number]) => a + b;
const card = ([a, b]: [number, number]) => (a - 1) * 6 + (b - 1);

describe('dice cards', () => {
  it('the 36 cards are every ordered pair of two dice once', () => {
    expect(DICE_CARDS).toHaveLength(36);
    const pairs = new Set(DICE_CARDS.map((c) => diceOfCard(c).join(',')));
    expect(pairs.size).toBe(36);
    for (const c of DICE_CARDS) {
      const [a, b] = diceOfCard(c);
      expect(a).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(6);
      expect(card([a, b])).toBe(c);
    }
    const ways: Record<number, number> = {};
    for (const c of DICE_CARDS) ways[total(diceOfCard(c))] = (ways[total(diceOfCard(c))] ?? 0) + 1;
    expect(ways).toEqual(WAYS);
  });
});

describe('balanced dice', () => {
  it('starts with an empty deck; the first roll shuffles all 36 and draws one', () => {
    const s = game(true);
    expect(s.diceDeck).toEqual([]);
    const draft = structuredClone(s);
    const { reshuffled } = rollTwoDice(draft);
    expect(reshuffled).toBe(true);
    expect(draft.diceDeck).toHaveLength(35);
    expect(draft.rng).not.toBe(s.rng);
  });

  it(`reshuffles exactly when ${DICE_DECK_RESHUFFLE_AT} or fewer cards remain (every ${CYCLE} rolls)`, () => {
    const seq = rolls(game(true), CYCLE * 6 + 3);
    seq.forEach(({ deckBefore }, i) => {
      // Roll i is the first of a new cycle iff the deck had <= RESHUFFLE_AT cards (or none yet).
      expect(deckBefore.length <= DICE_DECK_RESHUFFLE_AT, `roll ${i}`).toBe(i % CYCLE === 0);
    });
    expect(Math.min(...seq.map((r) => r.deckBefore.length))).toBe(0); // only before the 1st roll
    expect(seq.slice(1).every((r) => r.deckBefore.length >= DICE_DECK_RESHUFFLE_AT)).toBe(true);
  });

  it('each cycle draws distinct cards; drawn + the unseen rest is exactly the 36-card deck', () => {
    const k = 40;
    const draft = structuredClone(game(true, 'cycles'));
    for (let c = 0; c < k; c++) {
      const drawn = Array.from({ length: CYCLE }, () => card(rollTwoDice(draft).dice));
      expect(new Set(drawn).size).toBe(CYCLE);
      expect([...drawn, ...draft.diceDeck].sort((a, b) => a - b)).toEqual([...DICE_CARDS]);
      // Totals: every cycle's drawn counts are bounded by the exact distribution...
      const counts: Record<number, number> = {};
      for (const x of drawn) counts[total(diceOfCard(x))] = (counts[total(diceOfCard(x))] ?? 0) + 1;
      for (const [t, n] of Object.entries(counts)) expect(n).toBeLessThanOrEqual(WAYS[Number(t)]!);
      // ...and with the unseen rest they are exactly it.
      for (const x of draft.diceDeck)
        counts[total(diceOfCard(x))] = (counts[total(diceOfCard(x))] ?? 0) + 1;
      expect(counts).toEqual(WAYS);
    }
  });

  it('over many cycles each total is within the 5 unseen cards per cycle of its exact share', () => {
    const k = 50;
    const seq = rolls(game(true, 'long'), CYCLE * k);
    const counts: Record<number, number> = {};
    for (const r of seq) counts[total(r.dice)] = (counts[total(r.dice)] ?? 0) + 1;
    for (let t = 2; t <= 12; t++) {
      const n = counts[t] ?? 0;
      expect(n).toBeLessThanOrEqual(WAYS[t]! * k);
      expect(n).toBeGreaterThanOrEqual(WAYS[t]! * k - DICE_DECK_RESHUFFLE_AT * k);
    }
    // Plain dice are far less even: count how often a cycle repeats a card (impossible above).
    const plain = rolls(game(false, 'long'), CYCLE);
    expect(new Set(plain.map((r) => card(r.dice))).size).toBeLessThan(CYCLE);
  });

  it('is deterministic per seed and differs between seeds', () => {
    const a = rolls(game(true, 'x'), 80).map((r) => r.dice);
    const b = rolls(game(true, 'x'), 80).map((r) => r.dice);
    const c = rolls(game(true, 'y'), 80).map((r) => r.dice);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('off: diceDeck stays empty and the dice are two plain Rng.die() rolls', () => {
    const s = game(false);
    const draft = structuredClone(s);
    const rng = new Rng(s.rng);
    for (let i = 0; i < 50; i++) {
      expect(rollTwoDice(draft).dice).toEqual([rng.die(), rng.die()]);
      expect(draft.diceDeck).toEqual([]);
    }
  });

  it('rollDice through applyAction: two dice values, unchanged roll log, shuffle logged', () => {
    const s = game(true);
    s.turn = { number: 1, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'preRoll' };
    const before = JSON.stringify(s);
    const after = expectOk(applyAction(s, { type: 'rollDice', player: 0 }));
    expect(JSON.stringify(s)).toBe(before); // input untouched
    expect(after.dice).toHaveLength(2);
    expect(after.diceDeck).toHaveLength(35);
    expect(after.diceDeck).not.toContain(card(after.dice!));
    const texts = after.log.slice(-2).map((l) => l.text);
    expect(texts[0]).toBe('The dice deck was shuffled');
    expect(texts[1]).toBe(`Red rolled ${total(after.dice!)}`);
  });
});

describe('balanced dice: save / load', () => {
  it('a mid-deck state survives JSON + upgradeState and continues identically', () => {
    const draft = structuredClone(game(true, 'save'));
    for (let i = 0; i < 17; i++) rollTwoDice(draft);
    const loaded = upgradeState(JSON.parse(JSON.stringify(draft)));
    expect(loaded).toEqual(draft);
    expect(loaded!.diceDeck).toHaveLength(36 - 17);
    expect(rolls(loaded!, 60).map((r) => r.dice)).toEqual(rolls(draft, 60).map((r) => r.dice));
  });

  it('a v2 save gets an empty deck; its next balanced roll shuffles a fresh one', () => {
    const s = game(true);
    const { diceDeck: _drop, ...rest } = s;
    const v2 = { ...rest, schemaVersion: 2 };
    const up = upgradeState(JSON.parse(JSON.stringify(v2)))!;
    expect(up.schemaVersion).toBe(3);
    expect(up.diceDeck).toEqual([]);
    const draft = structuredClone(up);
    expect(rollTwoDice(draft).reshuffled).toBe(true);
  });

  it('rejects a v3 save without a dice deck', () => {
    const { diceDeck: _drop, ...rest } = game(true);
    expect(upgradeState(rest)).toBeNull();
  });
});
