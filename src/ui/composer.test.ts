import { describe, expect, it } from 'vitest';
import { emptyResources } from '../engine';
import {
  buildNewGameConfig,
  defaultNewGame,
  discardAction,
  draftToAction,
  emptyDraft,
  pickSeatColor,
  resizeSeats,
  stepDiscard,
  stepDraft,
  toBundle,
  toggleRecipient,
  validateDiscard,
  validateDraft,
} from './composer';

const hand = { ...emptyResources(), brick: 2, ore: 3, grain: 1 };

describe('trade composer', () => {
  it('builds an offerTrade with non-zero bundles', () => {
    let d = emptyDraft([0, 2, 3]);
    d = stepDraft(d, 'give', 'ore', 1, hand);
    d = stepDraft(d, 'give', 'ore', 1, hand);
    d = stepDraft(d, 'want', 'wool', 1, hand);
    expect(draftToAction(1, d, hand)).toEqual({
      type: 'offerTrade',
      player: 1,
      give: { ore: 2 },
      want: { wool: 1 },
      to: [0, 2, 3],
    });
  });

  it('caps give at the hand and floors at 0', () => {
    let d = emptyDraft([0]);
    for (let i = 0; i < 6; i++) d = stepDraft(d, 'give', 'brick', 1, hand);
    expect(d.give.brick).toBe(2);
    d = stepDraft(d, 'give', 'wool', -1, hand);
    expect(d.give.wool).toBe(0);
    d = stepDraft(d, 'give', 'wool', 1, hand);
    expect(d.give.wool).toBe(0); // holds none
  });

  it('never has the same resource on both sides', () => {
    let d = emptyDraft([0]);
    d = stepDraft(d, 'give', 'ore', 1, hand);
    d = stepDraft(d, 'want', 'ore', 1, hand);
    expect(d.give.ore).toBe(0);
    expect(d.want.ore).toBe(1);
  });

  it('does not mutate the previous draft', () => {
    const d = emptyDraft([0]);
    stepDraft(d, 'give', 'ore', 1, hand);
    expect(d.give.ore).toBe(0);
  });

  it('validates', () => {
    const d = emptyDraft([0]);
    expect(validateDraft(d, hand)).toBe('Choose what you give');
    const g = stepDraft(d, 'give', 'ore', 1, hand);
    expect(validateDraft(g, hand)).toBe('Choose what you want');
    const w = stepDraft(g, 'want', 'wool', 1, hand);
    expect(validateDraft(w, hand)).toBeNull();
    expect(validateDraft({ ...w, to: [] }, hand)).toBe('Choose at least one player');
    expect(draftToAction(1, { ...w, to: [] }, hand)).toBeNull();
    // Holding fewer than offered (stale draft).
    expect(validateDraft({ ...w, give: { ...w.give, ore: 5 } }, hand)).toMatch(/only have/);
  });

  it('toggles recipients, keeping them sorted', () => {
    let d = emptyDraft([0, 2]);
    d = toggleRecipient(d, 2);
    expect(d.to).toEqual([0]);
    d = toggleRecipient(d, 3);
    d = toggleRecipient(d, 1);
    expect(d.to).toEqual([0, 1, 3]);
  });

  it('toBundle drops zeros', () => {
    expect(toBundle({ ...emptyResources(), grain: 2 })).toEqual({ grain: 2 });
  });
});

describe('discard validation', () => {
  const h = { ...emptyResources(), brick: 3, lumber: 2, wool: 2, grain: 3, ore: 1 }; // 11 cards

  it('requires exactly the right number', () => {
    expect(validateDiscard(h, 5, emptyResources())).toBe('Choose 5 more');
    expect(validateDiscard(h, 5, { ...emptyResources(), brick: 3, wool: 1 })).toBe('Choose 1 more');
    expect(validateDiscard(h, 5, { ...emptyResources(), brick: 3, wool: 2 })).toBeNull();
    expect(validateDiscard(h, 5, { ...emptyResources(), brick: 3, wool: 2, ore: 1 })).toBe(
      'Too many: remove 1',
    );
  });

  it('rejects cards the player does not hold', () => {
    expect(validateDiscard(h, 5, { ...emptyResources(), ore: 5 })).toMatch(/only have 1 ore/);
  });

  it('rejects negative or fractional amounts', () => {
    expect(validateDiscard(h, 1, { ...emptyResources(), brick: -1, lumber: 2 })).toBe(
      'Invalid amount',
    );
    expect(validateDiscard(h, 1, { ...emptyResources(), brick: 0.5 })).toBe('Invalid amount');
  });

  it('stepper never exceeds hand or required', () => {
    let sel = emptyResources();
    for (let i = 0; i < 10; i++) sel = stepDiscard(sel, 'ore', 1, h, 5);
    expect(sel.ore).toBe(1);
    for (let i = 0; i < 10; i++) sel = stepDiscard(sel, 'brick', 1, h, 5);
    expect(sel.brick).toBe(3);
    for (let i = 0; i < 10; i++) sel = stepDiscard(sel, 'grain', 1, h, 5);
    expect(sel.grain).toBe(1); // 1 + 3 + 1 = 5
    expect(validateDiscard(h, 5, sel)).toBeNull();
    expect(discardAction(1, sel)).toEqual({
      type: 'discard',
      player: 1,
      resources: { brick: 3, grain: 1, ore: 1 },
    });
    sel = stepDiscard(sel, 'ore', -3, h, 5);
    expect(sel.ore).toBe(0);
  });
});

describe('new game config', () => {
  it('defaults to a human plus three bots on the beginner board', () => {
    const cfg = buildNewGameConfig(defaultNewGame());
    expect(cfg.players.map((p) => p.controller)).toEqual(['human', 'bot', 'bot', 'bot']);
    expect(cfg.layout).toBe('beginner');
    expect(cfg.seed).toBeUndefined();
  });

  it('fills blank names, dedupes, trims and keeps the seed', () => {
    const d = defaultNewGame();
    d.seats[0]!.name = '  Ann ';
    d.seats[1]!.name = 'ann';
    d.seats[2]!.name = '';
    d.seed = ' abc ';
    const cfg = buildNewGameConfig(d);
    expect(cfg.players.map((p) => p.name)).toEqual(['Ann', 'ann 2', 'Player 3', 'Orange']);
    expect(cfg.seed).toBe('abc');
  });

  it('resizes between 3 and 4 seats with unique colors', () => {
    const three = resizeSeats(defaultNewGame(4), 3);
    expect(three.seats).toHaveLength(3);
    const four = resizeSeats(three, 4);
    expect(new Set(four.seats.map((s) => s.color)).size).toBe(4);
  });

  it('swaps colors so they stay unique', () => {
    const d = defaultNewGame();
    const red = d.seats[0]!.color;
    const blue = d.seats[1]!.color;
    const swapped = pickSeatColor(d, 0, blue);
    expect(swapped.seats[0]!.color).toBe(blue);
    expect(swapped.seats[1]!.color).toBe(red);
    const green = '#3fae6a';
    expect(pickSeatColor(d, 0, green).seats[0]!.color).toBe(green);
  });
});
