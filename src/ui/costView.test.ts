// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { emptyResources } from '../engine';
import { costCards, costLabel, costTip, missingCards } from './costView';

const hand = { ...emptyResources(), grain: 1, ore: 3 };
const city = { grain: 2, ore: 3 };
const labels = (el: Element, sel = '.card-face') =>
  [...el.querySelectorAll(sel)].map((c) => c.getAttribute('aria-label'));

describe('cost component (#35)', () => {
  it('missing cards and labels', () => {
    expect(missingCards(city, hand)).toEqual({ grain: 1 });
    expect(missingCards(city, null)).toEqual({});
    expect(costLabel(city)).toBe('2 grain, 3 ore');
    expect(costLabel({})).toBe('free');
  });

  it('one face per card, the uncovered ones marked missing', () => {
    const el = costCards(city, hand);
    expect(labels(el)).toEqual(['Grain', 'Grain', 'Ore', 'Ore', 'Ore']);
    expect(labels(el, '.is-missing')).toEqual(['Grain']);
    expect(costCards(city).querySelector('.is-missing')).toBeNull();
  });

  it('tooltip: title, cost, what is missing, extra lines', () => {
    const tip = costTip('City', city, hand, ['Not your turn']);
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.querySelector('b')?.textContent).toBe('City');
    expect(tip.querySelector('.cost-have')?.textContent).toContain('Missing 1 grain');
    expect(tip.textContent).toContain('Not your turn');
    const ok = costTip('City', city, { ...hand, grain: 2 });
    expect(ok.querySelector('.cost-have')?.textContent).toBe('You have the cards');
    // No cost data (an expansion card without a price): just the title and the extras.
    expect(costTip('Move', null, hand).querySelector('.cost-line')).toBeNull();
  });
});
