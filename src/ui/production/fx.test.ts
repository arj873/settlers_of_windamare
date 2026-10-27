// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../../engine';
import { midGame } from '../../engine/fixtures';
import { rollTotal, run } from '../../engine/actions/testkit';
import { fakeLegal } from '../devLegal';
import { Hud } from '../hud';
import { ANIMATIONS_KEY } from '../motion';
import { BADGE_MS, ProductionFx } from './fx';
import { RAPID_MS, productionPlan } from './plan';

/** jsdom lays nothing out: give every element a box, and a fake Web Animations API. */
let animations: { cancel: () => void; onfinish: (() => void) | null; cancelled: boolean }[];
beforeEach(() => {
  vi.useFakeTimers();
  animations = [];
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 10,
    right: 110,
    bottom: 40,
    width: 100,
    height: 30,
    x: 10,
    y: 10,
    toJSON: () => ({}),
  });
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function () {
    const a = {
      cancelled: false,
      onfinish: null,
      cancel() {
        a.cancelled = true;
      },
    };
    animations.push(a);
    return a;
  };
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
});

/** midGame after Blue's turn (White to roll), then a roll that pays someone. */
function rolls(): { prev: GameState; next: GameState } {
  const prev = run(midGame(), { type: 'endTurn', player: 1 });
  for (const roll of [8, 6, 5, 9, 10, 4]) {
    const next = rollTotal(prev, roll);
    if (productionPlan(prev, next)?.gains.length) return { prev, next };
  }
  throw new Error('no paying roll');
}

describe('ProductionFx in the HUD', () => {
  let root: HTMLElement;
  let hud: Hud;
  let now: number;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.append(root);
    hud = new Hud(root);
    hud.setHexLocator(() => ({ x: 500, y: 300 }));
    now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  const render = (s: GameState) =>
    hud.render(s, { viewer: 3, legal: fakeLegal(s, 3), isBotTurn: false });
  const badges = () => [...root.querySelectorAll('.prod-badge')];

  it('flies cards after a roll, then pops one badge per receiving player', () => {
    const { prev, next } = rolls();
    const plan = productionPlan(prev, next);
    render(prev);
    render(next);
    expect(animations.length).toBeGreaterThan(0);
    expect(badges()).toHaveLength(0); // badges wait for the first card to land
    vi.advanceTimersByTime(2000);
    expect(badges().map((b) => b.getAttribute('data-player'))).toEqual(
      plan?.gains.map((g) => String(g.player)),
    );
    expect(badges()[0]?.textContent).toMatch(/^\+\d/);
    vi.advanceTimersByTime(BADGE_MS);
    expect(badges()).toHaveLength(0);
  });

  it('a re-render of the same state does not replay', () => {
    const { prev, next } = rolls();
    render(prev);
    render(next);
    const n = animations.length;
    render(next);
    expect(animations.length).toBe(n);
  });

  it('a roll arriving mid-flight cancels it and shows badges only', () => {
    const { prev, next } = rolls();
    render(prev);
    render(next);
    const first = [...animations];
    // The next player's roll (a fast bot), well inside RAPID_MS.
    now += RAPID_MS / 3;
    const after = run(next, { type: 'endTurn', player: next.turn.current });
    const again = [8, 6, 5, 9, 10, 4]
      .map((r) => rollTotal(after, r))
      .find((s) => productionPlan(after, s)?.gains.length);
    if (!again) throw new Error('no paying roll');
    render(after);
    render(again);
    expect(first.every((a) => a.cancelled)).toBe(true);
    expect(animations.length).toBe(first.length); // nothing new flies
    expect(badges().length).toBeGreaterThan(0); // the result shows at once
  });

  it('Animations off: badges only, at once', () => {
    localStorage.setItem(ANIMATIONS_KEY, 'off');
    const { prev, next } = rolls();
    render(prev);
    render(next);
    expect(animations).toHaveLength(0);
    expect(badges().length).toBeGreaterThan(0);
    expect(badges()[0]?.classList.contains('is-still')).toBe(true);
  });

  it('the menu toggle saves the setting', () => {
    const s = midGame();
    render(s);
    root.querySelector<HTMLButtonElement>('.menu-btn')!.click();
    root.querySelector<HTMLButtonElement>('[data-animations="off"]')!.click();
    expect(localStorage.getItem(ANIMATIONS_KEY)).toBe('off');
    expect(root.querySelector('[data-animations="off"]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('shows nothing under the hotseat cover', () => {
    const { prev, next } = rolls();
    hud.render(prev, { viewer: 3, legal: [], isBotTurn: false });
    // Another viewer: the cover hides the game until they unlock it.
    hud.render(next, { viewer: 0, legal: [], isBotTurn: false });
    expect(hud.isCovered()).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(animations).toHaveLength(0);
    expect(badges()).toHaveLength(0);
  });
});

describe('ProductionFx without a board locator', () => {
  it('flies from the dice', () => {
    document.body.replaceChildren();
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="hud-controls"><div class="dice"></div></div>' +
      '<div class="hud-players">' +
      [0, 1, 2, 3].map((p) => `<div class="pp" data-player="${p}"></div>`).join('') +
      '</div>';
    document.body.append(root);
    const fx = new ProductionFx(root, { motion: () => true });
    const { prev, next } = rolls();
    fx.update(prev, { viewer: -1, legal: [], isBotTurn: true, spectator: true }, false);
    fx.update(next, { viewer: -1, legal: [], isBotTurn: true, spectator: true }, false);
    expect(animations.length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.prod-card').length).toBeGreaterThan(0);
    fx.destroy();
    expect(animations.every((a) => a.cancelled)).toBe(true);
    expect(root.querySelector('.prod-fx')).toBeNull();
  });
});
