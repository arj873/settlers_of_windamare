// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AWARD_BANNER_MS, awardBanner, showAwardBanner } from './awardBanner';

const players = [
  { id: 0, name: 'Red', color: '#c0392b' },
  { id: 1, name: 'Blue', color: '#2e6fd8' },
];

describe('award banner (#36)', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('names the award, who took it and from whom, in their colours', () => {
    const el = awardBanner(
      {
        award: 'longestRoad',
        label: 'Longest Road',
        text: 'Blue took Longest Road from Red',
        to: 1,
      },
      players,
      0,
    );
    expect(el.querySelector('.award-title')?.textContent).toBe('Longest Road');
    // Seen by Red (0): their own name reads "you".
    expect(el.querySelector('.award-text')?.textContent).toBe('Blue took Longest Road from you');
    expect([...el.querySelectorAll('.pname')].map((p) => p.textContent)).toEqual(['Blue']);
    expect(el.querySelector('.g-longestRoad')).not.toBeNull();
    expect(el.style.getPropertyValue('--pc')).toBe('#2e6fd8');
    expect(el.classList.contains('is-mine')).toBe(false);
    expect(el.getAttribute('role')).toBe('status');
  });

  it('marks the viewer’s own gain; expansion titles get a fitting icon', () => {
    const mine = awardBanner(
      { award: 'largestArmy', label: 'Largest Army', text: 'You took Largest Army', to: 0 },
      players,
      0,
    );
    expect(mine.classList.contains('is-mine')).toBe(true);
    expect(mine.querySelector('.award-text')?.textContent).toBe('You took Largest Army');
    const metro = awardBanner(
      {
        award: 'other',
        label: 'science metropolis',
        text: 'Red built the science metropolis',
        to: 0,
      },
      players,
    );
    expect(metro.querySelector('.g-city')).not.toBeNull();
  });

  it('stacks without blocking and fades out on its own', () => {
    vi.useFakeTimers();
    const info = {
      award: 'largestArmy' as const,
      label: 'Largest Army',
      text: 'Red took Largest Army',
      to: 0,
    };
    showAwardBanner(info, players);
    showAwardBanner(info, players);
    expect(document.querySelectorAll('.award-banners > .award-banner')).toHaveLength(2);
    vi.advanceTimersByTime(AWARD_BANNER_MS + 500);
    expect(document.querySelector('.award-banner')).toBeNull();
  });
});
