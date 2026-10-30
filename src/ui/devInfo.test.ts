// @vitest-environment jsdom
/** The hand's dev card info card (#devinfo): what a card does and why it can't be played now. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { legalActions, type Action, type GameState } from '../engine';
import { gameOverGame, midGame } from '../engine/fixtures';
import { Hud } from './hud';
import type { HudView } from './types';

let root: HTMLElement;
let hud: Hud;
let actions: Action[];

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  hud = new Hud(root);
  actions = [];
  hud.on('action', (a) => actions.push(a));
});

afterEach(() => {
  hud.destroy();
  vi.useRealTimers();
});

const show = (s: GameState, viewer: number, extra: Partial<HudView> = {}) =>
  hud.render(s, { viewer, legal: legalActions(s), isBotTurn: false, ...extra });
const card = (type: string) =>
  root.querySelector<HTMLButtonElement>(`.hud-bottom .dcard[data-dev="${type}"]`)!;
const info = () => root.querySelector<HTMLElement>('.hud-pop-layer .dev-info');
const infoText = () => info()?.textContent ?? '';
const press = (el: Element, type: string, pointerType = 'mouse') => {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    pointerType: string;
  };
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  el.dispatchEvent(e);
  return e;
};
const key = (k: string) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

describe('dev card info card', () => {
  it("off-turn: a card that can't be played opens its info card, never an action", () => {
    show(midGame(), 3); // Blue's turn; Orange holds Road Building
    const rb = card('roadBuilding');
    expect(rb.disabled).toBe(false);
    expect(rb.getAttribute('aria-disabled')).toBe('true');
    expect(rb.classList.contains('is-off')).toBe(true);
    expect(rb.getAttribute('aria-expanded')).toBe('false');
    expect(info()).toBeNull();

    rb.click();
    expect(actions).toEqual([]);
    expect(infoText()).toContain('Road Building');
    expect(infoText()).toContain('Place 2 roads for free');
    expect(infoText()).toContain(
      'Not your turn. You can play this on your turn, before or after rolling.',
    );
    expect(card('roadBuilding').getAttribute('aria-expanded')).toBe('true');
    expect(card('roadBuilding').getAttribute('aria-describedby')).toBe(info()!.id);

    card('roadBuilding').click(); // tapping the card again closes it
    expect(info()).toBeNull();
    expect(actions).toEqual([]);
  });

  it('closes on Escape and on a click outside; a click inside keeps it', () => {
    show(midGame(), 3);
    card('roadBuilding').click();
    key('Escape');
    expect(info()).toBeNull();

    card('roadBuilding').click();
    info()!.click();
    expect(info()).not.toBeNull();
    root.querySelector<HTMLElement>('.rcard')!.click();
    expect(info()).toBeNull();
  });

  it('survives re-renders (a bot moving) as the same node, and follows the game', () => {
    const s = midGame();
    show(s, 3);
    card('roadBuilding').click();
    const node = info();
    const face = node!.querySelector('.card-face');

    // Another move on Blue's turn: same node, same content (nothing rebuilt).
    s.log.push({ turn: 12, player: 1, text: 'Blue built a road' });
    show(s, 3);
    expect(info()).toBe(node);
    expect(node!.querySelector('.card-face')).toBe(face);

    // Orange's turn starts: the card can be played now; the open info card says so.
    s.turn = { ...s.turn, number: 13, current: 3 };
    s.phase = { kind: 'preRoll' };
    show(s, 3);
    expect(info()).toBe(node);
    expect(infoText()).toContain('Playable now');
    expect(card('roadBuilding').classList.contains('can-play')).toBe(true);
  });

  it('closes when the card leaves the hand, for another viewer and for spectators', () => {
    const s = midGame();
    show(s, 3);
    card('roadBuilding').click();
    s.players[3]!.devCards.roadBuilding = 0;
    show(s, 3);
    expect(info()).toBeNull();

    // Hotseat: the next player gets the cover, then their own hand with nothing open.
    s.players[3]!.devCards.roadBuilding = 1;
    s.players[1]!.devCards.roadBuilding = 1;
    show(s, 3);
    card('roadBuilding').click();
    show(s, 1);
    expect(info()).toBeNull();
    root.querySelector<HTMLButtonElement>('.hud-overlay-layer button')!.click();
    expect(card('roadBuilding')).not.toBeNull();
    expect(info()).toBeNull();

    // Online spectators have no hand: nothing to open.
    hud.destroy();
    hud = new Hud(root);
    show(s, -1, { spectator: true, legal: [] });
    expect(root.querySelector('.dcard')).toBeNull();
    expect(info()).toBeNull();
  });

  it('Victory Point and game over: info only', () => {
    show(midGame(), 1);
    card('victoryPoint').click();
    expect(infoText()).toContain('Victory Point: counts automatically, keep it hidden.');

    show(gameOverGame(), 1, { legal: [] });
    card('monopoly').click();
    expect(infoText()).toContain('The game is over.');
    expect(actions).toEqual([]);
  });

  it('a playable card keeps one-click play; right-click opens its info card instead', () => {
    show(midGame(), 1); // Blue's turn, Knight ready
    const knight = card('knight');
    expect(knight.classList.contains('can-play')).toBe(true);
    expect(knight.hasAttribute('aria-disabled')).toBe(false);

    const menu = press(knight, 'contextmenu');
    expect(menu.defaultPrevented).toBe(true);
    expect(actions).toEqual([]);
    expect(infoText()).toContain('Move the robber');
    expect(infoText()).toContain('Playable now: click the card to play it.');

    card('knight').click(); // plays, and the info card closes
    expect(actions).toEqual([{ type: 'playKnight', player: 1 }]);
    expect(info()).toBeNull();
  });

  it('a touch long-press opens the info card and does not play the card', () => {
    vi.useFakeTimers();
    show(midGame(), 1);
    press(card('knight'), 'pointerdown', 'touch');
    vi.advanceTimersByTime(300);
    expect(info()).toBeNull(); // not yet
    vi.advanceTimersByTime(200);
    expect(infoText()).toContain('Knight');
    press(card('knight'), 'contextmenu'); // Android sends one after a long-press: no toggle
    expect(info()).not.toBeNull();
    card('knight').click(); // the click that ends the press
    expect(actions).toEqual([]);
    expect(info()).not.toBeNull();
    card('knight').click(); // a normal tap still plays
    expect(actions).toEqual([{ type: 'playKnight', player: 1 }]);
  });

  it('a short touch on a playable card plays it (no info card)', () => {
    vi.useFakeTimers();
    show(midGame(), 1);
    press(card('knight'), 'pointerdown', 'touch');
    vi.advanceTimersByTime(100);
    press(card('knight'), 'pointerup', 'touch');
    card('knight').click();
    vi.advanceTimersByTime(1000);
    expect(info()).toBeNull();
    expect(actions).toEqual([{ type: 'playKnight', player: 1 }]);
  });

  it('keyboard: the card keeps the focus when its info card opens and closes', () => {
    show(midGame(), 1);
    card('monopoly').focus(); // bought this turn
    card('monopoly').click(); // Enter / Space on a button
    expect(infoText()).toContain('Bought this turn: playable from your next turn.');
    expect(document.activeElement).toBe(card('monopoly'));
    key('Escape');
    expect(info()).toBeNull();
    expect(document.activeElement).toBe(card('monopoly'));
    expect(actions).toEqual([]);
  });

  it('switches to another card', () => {
    show(midGame(), 1);
    card('victoryPoint').click();
    const node = info();
    card('monopoly').click();
    expect(info()).toBe(node);
    expect(infoText()).toContain('Monopoly');
    expect(infoText()).not.toContain('Victory Point');
    expect(card('victoryPoint').classList.contains('is-open')).toBe(false);
    expect(card('monopoly').classList.contains('is-open')).toBe(true);
  });
});
