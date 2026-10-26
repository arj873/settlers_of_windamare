// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { showResumePrompt, showToast } from './overlays';
import { parseParams } from './params';

describe('parseParams', () => {
  it('reads the autoplay test switch', () => {
    const p = parseParams('?autoplay=4bots&speed=0');
    expect(p.autoplay).toBe(4);
    expect(p.speed).toBe(0);
  });

  it('reads the bot level per seat (B1)', () => {
    expect(parseParams('?autoplay=4bots&levels=hnee').levels).toEqual([
      'hard',
      'normal',
      'easy',
      'easy',
    ]);
    expect(parseParams('?levels=hx').levels).toBeNull();
  });

  it('reads the playtest names and debug switch', () => {
    const p = parseParams('?seats=hhh&names=Seat1, Seat2 ,,Seat3&debug=1');
    expect(p.names).toEqual(['Seat1', 'Seat2', 'Seat3']);
    expect(p.debug).toBe(true);
    expect(parseParams('?debug=yes')).toMatchObject({ names: null, debug: false });
  });

  it('keeps the dev params and rejects junk', () => {
    const p = parseParams('?fixture=midGame&seed=42&layout=beginner&seats=hbhb&vp=5&hl=edges');
    expect(p).toMatchObject({
      fixture: 'midGame',
      seed: '42',
      layout: 'beginner',
      seats: ['human', 'bot', 'human', 'bot'],
      vpToWin: 5,
      hl: 'edges',
    });
    const bad = parseParams('?autoplay=9bots&speed=-1&layout=hex&seats=hx&vp=99');
    expect(bad).toMatchObject({
      autoplay: null,
      speed: null,
      layout: null,
      seats: null,
      vpToWin: null,
    });
  });

  it('reads the turn timer and starting seat (T14)', () => {
    expect(parseParams('?timer=20&first=2')).toMatchObject({ timer: 20, first: 2 });
    expect(parseParams('?timer=0&first=9')).toMatchObject({ timer: null, first: null });
    expect(parseParams('?timer=1.5&first=x')).toMatchObject({ timer: null, first: null });
  });
});

describe('overlays', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('resume prompt calls the chosen callback and removes itself', () => {
    const resume = vi.fn();
    const fresh = vi.fn();
    showResumePrompt('Unfinished game', resume, fresh);
    const buttons = [...document.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['New game', 'Resume']);
    buttons[1]!.click();
    expect(resume).toHaveBeenCalledOnce();
    expect(fresh).not.toHaveBeenCalled();
    expect(document.querySelector('.game-resume')).toBeNull();
  });

  it('toasts disappear after a while', () => {
    vi.useFakeTimers();
    showToast('Action rejected', 'error', 1000);
    expect(document.querySelector('.game-toast.is-error')?.textContent).toBe('Action rejected');
    vi.advanceTimersByTime(1500);
    expect(document.querySelector('.game-toast')).toBeNull();
  });
});
