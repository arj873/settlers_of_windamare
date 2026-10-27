import { describe, expect, it } from 'vitest';
import { emptyResources } from '../engine';
import {
  discardAction,
  discardRows,
  discardStatus,
  draftToAction,
  emptyDraft,
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

describe('discard dialog model', () => {
  const hand = { ...emptyResources(), lumber: 3, wool: 2, grain: 2, ore: 1 }; // 8 cards, no brick

  it('has a row per resource with held counts, brick included at 0', () => {
    const rows = discardRows(hand, emptyResources(), 4);
    expect(rows.map((r) => r.resource)).toEqual(['brick', 'lumber', 'wool', 'grain', 'ore']);
    expect(rows.map((r) => r.held)).toEqual([0, 3, 2, 2, 1]);
    expect(rows[0]?.max).toBe(0);
  });

  it('caps "+" at the held count and at what is still owed', () => {
    const rows = discardRows(hand, emptyResources(), 4);
    expect(rows.find((r) => r.resource === 'lumber')?.max).toBe(3);
    const picked = { ...emptyResources(), lumber: 3 };
    const after = discardRows(hand, picked, 4);
    expect(after.find((r) => r.resource === 'lumber')?.max).toBe(3);
    expect(after.find((r) => r.resource === 'wool')?.max).toBe(1);
    expect(after.find((r) => r.resource === 'lumber')?.left).toBe(0);
  });

  it('status counts down, then confirms', () => {
    expect(discardStatus(hand, 4, emptyResources())).toEqual({ text: 'Choose 4 more', ok: false });
    expect(discardStatus(hand, 4, { ...emptyResources(), lumber: 3, ore: 1 })).toEqual({
      text: 'Discarding 4 of 4',
      ok: true,
    });
  });
});
