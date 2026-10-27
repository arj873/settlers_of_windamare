// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { legalActions, type Action } from '../engine';
import {
  discardGame,
  freshGame,
  midGame,
  moveRobberGame,
  tradeOfferGame,
} from '../engine/fixtures';
import { fakeLegal } from './devLegal';
import { Hud } from './hud';
import type { NewGameConfig, PlaceMode } from './types';

let root: HTMLElement;
let hud: Hud;
let actions: Action[];
let modes: (PlaceMode | null)[];

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  hud = new Hud(root);
  actions = [];
  modes = [];
  hud.on('action', (a) => actions.push(a));
  hud.on('placeMode', (m) => modes.push(m));
});

const buttons = () => [...root.querySelectorAll('button')];
const byText = (t: string) => buttons().find((b) => b.textContent?.includes(t));

describe('Hud', () => {
  it('emits actions only for enabled, legal buttons', () => {
    const s = midGame();
    hud.render(s, { viewer: 1, legal: fakeLegal(s, 1), isBotTurn: false });
    expect(byText('Roll dice')!.disabled).toBe(true);
    expect(byText('End turn')!.disabled).toBe(false);
    byText('End turn')!.click();
    expect(actions).toEqual([{ type: 'endTurn', player: 1 }]);
  });

  it('disables everything when there are no legal actions (bot turn)', () => {
    const s = midGame();
    hud.render(s, { viewer: 1, legal: [], isBotTurn: true });
    const act = [...root.querySelectorAll<HTMLButtonElement>('button.act')];
    expect(act.length).toBeGreaterThan(5);
    expect(act.every((b) => b.disabled)).toBe(true);
  });

  it('build buttons emit placeMode, not actions, and toggle off', () => {
    const s = midGame();
    hud.render(s, { viewer: 1, legal: fakeLegal(s, 1), isBotTurn: false });
    byText('City')!.click();
    expect(modes).toEqual(['city']);
    expect(actions).toEqual([]);
    expect(root.textContent).toContain('Place a city');
    byText('City')!.click();
    expect(modes).toEqual(['city', null]);
  });

  it('leaves build mode when the board changes', () => {
    const s = midGame();
    hud.render(s, { viewer: 1, legal: fakeLegal(s, 1), isBotTurn: false });
    byText('City')!.click();
    s.pieces.roads['e:0,0,E'] = 1;
    hud.render(s, { viewer: 1, legal: fakeLegal(s, 1), isBotTurn: false });
    expect(modes).toEqual(['city', null]);
  });

  it('bank trade dialog emits the matching legal bankTrade', () => {
    const s = midGame();
    hud.render(s, { viewer: 1, legal: fakeLegal(s, 1), isBotTurn: false });
    byText('Bank')!.click();
    // The dialog is rebuilt on every click, so look it up each time.
    const pick = (label: string) =>
      [...root.querySelectorAll('.dialog button')].find((b) =>
        b.textContent?.includes(label),
      )! as HTMLButtonElement;
    pick('Ore').click();
    // Second "Brick" button = the Receive row.
    [...root.querySelectorAll<HTMLButtonElement>('.dialog .rpick')[1]!.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Brick'))!
      .click();
    root.querySelector<HTMLButtonElement>('.dialog-actions .btn-primary')!.click();
    expect(actions).toEqual([{ type: 'bankTrade', player: 1, give: 'ore', receive: 'brick' }]);
  });

  it('discard dialog only submits an exact selection', () => {
    const s = discardGame();
    hud.render(s, { viewer: 1, legal: fakeLegal(s, 1), isBotTurn: false });
    const submit = () => root.querySelector<HTMLButtonElement>('.dialog .btn-primary')!;
    expect(submit().disabled).toBe(true);
    // Steppers in order: brick, lumber, wool, grain, ore (Blue holds 1,1,2,3,3 = 10, discards 5).
    const plus = (i: number) =>
      root
        .querySelectorAll<HTMLElement>('.dialog .step')
        [i]!.querySelectorAll('button')[1]!
        .click();
    for (let i = 0; i < 5; i++) plus(3);
    // Grain is capped at the 3 held; the 4th and 5th clicks do nothing.
    expect(submit().disabled).toBe(true);
    plus(4);
    expect(submit().disabled).toBe(true); // 4 of 5
    plus(4);
    expect(submit().disabled).toBe(false);
    submit().click();
    const a = actions[0];
    expect(a).toMatchObject({ type: 'discard', player: 1 });
  });

  it("discard selection does not carry over to the next player's discard", () => {
    const s = discardGame(); // Blue (1) and Orange (3) both owe a discard.
    hud.render(s, { viewer: 1, legal: fakeLegal(s, 1), isBotTurn: false });
    const plus = (i: number) =>
      root
        .querySelectorAll<HTMLElement>('.dialog .step')
        [i]!.querySelectorAll('button')[1]!
        .click();
    plus(3);
    plus(3);
    hud.render(s, { viewer: 3, legal: fakeLegal(s, 3), isBotTurn: false });
    byText('show my cards')!.click();
    const values = [...root.querySelectorAll('.dialog .step-val')].map((e) => e.textContent);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => v === '0')).toBe(true);
  });

  it('responder sees accept/reject; offerer can confirm an acceptor', () => {
    const s = tradeOfferGame();
    s.players[2]!.resources.brick = 1;
    hud.render(s, { viewer: 2, legal: fakeLegal(s, 2), isBotTurn: false });
    expect(root.querySelector('.dialog h2')!.textContent).toBe('Blue offers a trade');
    byText('Accept')!.click();
    expect(actions).toEqual([{ type: 'acceptTrade', player: 2 }]);

    actions.length = 0;
    hud.render(s, { viewer: 2, legal: fakeLegal(s, 2), isBotTurn: false });
    byText('Reject')!.click();
    expect(actions).toEqual([{ type: 'rejectTrade', player: 2 }]);
  });

  it('trade offers are a non-blocking side card, not a modal', () => {
    const s = tradeOfferGame();
    // A fresh Hud per viewer: switching viewers on one Hud shows the hotseat cover instead.
    for (const viewer of [1, 2]) {
      root.replaceChildren();
      hud = new Hud(root);
      hud.render(s, { viewer, legal: fakeLegal(s, viewer), isBotTurn: false });
      const scrim = root.querySelector('.scrim')!;
      expect(scrim.classList.contains('is-side')).toBe(true);
      expect(scrim.classList.contains('is-modal')).toBe(false);
    }
  });

  it('offerer confirms with the accepted partner or cancels', () => {
    const s = tradeOfferGame();
    hud.render(s, { viewer: 1, legal: fakeLegal(s, 1), isBotTurn: false });
    expect(root.querySelector('.dialog h2')!.textContent).toBe('Your trade offer');
    root.querySelector<HTMLButtonElement>('.resp .btn-primary')!.click();
    byText('Cancel offer')!.click();
    expect(actions).toEqual([
      { type: 'confirmTrade', player: 1, partner: 3 },
      { type: 'cancelTrade', player: 1 },
    ]);
  });

  it('steal picker lists candidates', () => {
    const s = moveRobberGame();
    s.phase = { kind: 'steal', candidates: [0, 3], resume: 'main' };
    hud.render(s, { viewer: 1, legal: fakeLegal(s, 1), isBotTurn: false });
    const victims = [...root.querySelectorAll<HTMLButtonElement>('.victim')];
    expect(victims).toHaveLength(2);
    victims[1]!.click();
    expect(actions).toEqual([{ type: 'steal', player: 1, victim: 3 }]);
  });

  it('steal picker also shows with a single candidate', () => {
    const s = moveRobberGame();
    s.phase = { kind: 'steal', candidates: [3], resume: 'main' };
    hud.render(s, { viewer: 1, legal: fakeLegal(s, 1), isBotTurn: false });
    const victims = [...root.querySelectorAll<HTMLButtonElement>('.victim')];
    expect(victims).toHaveLength(1);
    victims[0]!.click();
    expect(actions).toEqual([{ type: 'steal', player: 1, victim: 3 }]);
  });

  it('shows a Pass-to cover when the viewer changes and hides the hand until confirmed', () => {
    const s = midGame();
    hud.render(s, { viewer: 1, legal: fakeLegal(s, 1), isBotTurn: false });
    expect(root.querySelector('.hand')).not.toBeNull();
    hud.render(s, { viewer: 0, legal: [], isBotTurn: false });
    expect(root.textContent).toContain('Pass to Red');
    expect(root.querySelector('.hand')).toBeNull();
    byText('show my cards')!.click();
    expect(root.querySelector('.hand')).not.toBeNull();
  });

  it('winner screen ranks players including hidden VP', () => {
    const s = midGame();
    s.phase = { kind: 'gameOver' };
    s.winner = 1;
    hud.render(s, { viewer: 1, legal: [], isBotTurn: false });
    const rows = [...root.querySelectorAll('.score')].map((r) => r.textContent);
    // Red 5, then Blue 4 public + 1 hidden VP = 5 (tie broken by seat order), White 5, Orange 2.
    expect(rows.map((r) => r?.replace(/^\d/, ''))).toEqual([
      'Red5 VP',
      'Blue5 VP',
      'White5 VP',
      'Orange2 VP',
    ]);
    expect(root.querySelector('.winner h1')!.textContent).toBe('Blue wins!');
  });

  it('new game screen emits a config', () => {
    let cfg: NewGameConfig | undefined;
    hud.on('newGame', (c) => (cfg = c));
    hud.showNewGame();
    root.querySelector<HTMLElement>('[data-k="players-dec"]')!.click();
    byText('Base Random')!.click();
    byText('Start game')!.click();
    expect(cfg?.players).toHaveLength(3);
    expect(cfg?.map).toBe('baseRandom');
  });

  it('tells the CSS how many hand cards, separators and build cards to fit', () => {
    const s = midGame();
    hud.render(s, { viewer: 1, legal: fakeLegal(s, 1), isBotTurn: false });
    const hand = root.querySelector<HTMLElement>('.hand')!;
    const build = root.querySelector<HTMLElement>('.build-bar')!;
    expect(hand.style.getPropertyValue('--hand-n')).toBe(
      String(hand.querySelectorAll(':scope > .hcard').length),
    );
    expect(Number(hand.style.getPropertyValue('--hand-n'))).toBeGreaterThanOrEqual(5);
    expect(hand.style.getPropertyValue('--hand-seps')).toBe(
      String(hand.querySelectorAll(':scope > .hand-sep').length),
    );
    expect(build.style.getPropertyValue('--build-n')).toBe(String(build.childElementCount));
  });

  it('build bar shows pieces and dev cards left', () => {
    const s = midGame();
    hud.render(s, { viewer: 1, legal: fakeLegal(s, 1), isBotTurn: false });
    const cards = [...root.querySelectorAll('.bcard')].map((b) => [
      b.querySelector('.bcard-label')!.textContent,
      b.querySelector('.bcard-left')!.textContent,
    ]);
    // Blue (midGame) has 4 roads, 2 settlements and 1 city on the board.
    expect(cards).toEqual([
      ['Buy card', `${s.devDeck.length}/25`],
      ['Road', '11/15'],
      ['Settlement', '3/5'],
      ['City', '3/4'],
    ]);
  });

  it('bank shows counts, or bare stacks when bank cards are hidden', () => {
    const s = midGame();
    hud.render(s, { viewer: 1, legal: [], isBotTurn: false });
    const counts = () => [...root.querySelectorAll('.bank .count-badge')].map((b) => b.textContent);
    expect(counts()).toEqual([...Object.values(s.bank).map(String), String(s.devDeck.length)]);

    const hidden = { ...s, settings: { ...s.settings, hideBankCards: true } };
    hud.render(hidden, { viewer: 1, legal: [], isBotTurn: false });
    expect(root.querySelectorAll('.bank .bank-stack')).toHaveLength(6);
    // Only the development deck keeps its count.
    expect(counts()).toEqual([String(s.devDeck.length)]);
  });

  it('lists up to 8 players, compact, with bot markers and the current turn', () => {
    const s = midGame();
    for (let i = 4; i < 8; i++) {
      s.players.push({ ...s.players[i % 4]!, id: i, name: `P${i + 1}` });
    }
    const bots = s.players.map((p) => p.id % 2 === 0);
    hud.render(s, { viewer: 1, legal: [], isBotTurn: false, bots });
    const list = root.querySelector('.hud-players')!;
    expect(list.classList.contains('is-compact')).toBe(true);
    const bars = [...list.querySelectorAll('.pp')];
    expect(bars).toHaveLength(8);
    expect(bars.map((b) => b.querySelector('.pp-name')!.textContent)).toEqual([
      'Red',
      'Blue',
      'White',
      'Orange',
      'P5',
      'P6',
      'P7',
      'P8',
    ]);
    expect(bars.filter((b) => b.querySelector('.tag-bot'))).toHaveLength(4);
    expect(bars[1]!.classList.contains('is-current')).toBe(true);
    expect(bars[1]!.textContent).toContain('You');
  });

  it('dice tumble only for a real roll, not on first render or End turn', () => {
    const rolling = () => root.querySelector('.dice')!.classList.contains('rolling');
    const view = { viewer: 1, legal: [], isBotTurn: false };
    const s = midGame();
    s.dice = [3, 4];
    s.phase = { kind: 'main' };
    hud.render(s, view);
    expect(rolling()).toBe(false); // reload / reconnect
    // End turn: next turn, same stale faces, waiting for the roll.
    const next = {
      ...s,
      phase: { kind: 'preRoll' as const },
      turn: { ...s.turn, number: s.turn.number + 1 },
    };
    hud.render(next, view);
    expect(rolling()).toBe(false);
    hud.render({ ...next }, view);
    expect(rolling()).toBe(false);
    // The roll with the very same faces still animates.
    hud.render({ ...next, phase: { kind: 'main' } }, view);
    expect(rolling()).toBe(true);
  });

  it('renders the log with player names and icons', () => {
    const s = midGame();
    hud.render(s, { viewer: 1, legal: [], isBotTurn: false });
    const rows = [...root.querySelectorAll('.log-row')];
    const roll = rows.find((r) => r.textContent?.includes('rolled'))!;
    // The latest roll shows both dice faces.
    expect(roll.querySelectorAll('.die')).toHaveLength(2);
    expect(roll.querySelector('.pname')!.textContent).toBe('Blue');
    const built = rows.find((r) => r.textContent?.includes('built'))!;
    expect(built.querySelector('.g-road')).not.toBeNull();
  });

  it('log shows both dice faces from the roll text, and old saves still render', () => {
    const s = midGame();
    s.dice = [6, 6];
    s.log.push({ turn: 12, player: 1, text: 'Blue rolled 5 (1+4)' });
    hud.render(s, { viewer: 1, legal: [], isBotTurn: false });
    const rolls = [...root.querySelectorAll('.log-row')].filter((r) =>
      r.textContent?.includes('rolled'),
    );
    const faces = (r: Element) =>
      [...r.querySelectorAll('.die')].map((d) => d.getAttribute('aria-label'));
    expect(faces(rolls.at(-1)!)).toEqual(['Die showing 1', 'Die showing 4']);
    // The fixture's older "Blue rolled 8" has no faces and is not the latest roll: a number.
    expect(faces(rolls[0]!)).toEqual([]);
    expect(rolls[0]!.querySelector('.log-roll')!.textContent).toBe('8');
  });

  it('disabled build buttons explain why on tap (missing cards as card faces)', () => {
    const s = midGame(); // Blue lacks a brick for a road
    hud.render(s, { viewer: 1, legal: legalActions(s, 1), isBotTurn: false });
    const road = byText('Road')!;
    expect(road.disabled).toBe(true);
    expect(road.getAttribute('data-why')).toBe('Missing 1 brick');
    const slot = road.closest('.bslot')!;
    expect(slot.classList.contains('is-blocked')).toBe(true);
    (slot as HTMLElement).click();
    const open = root.querySelector('.bslot.is-why .why')!;
    expect(open.textContent).toContain('Missing 1 brick');
    expect(open.querySelectorAll('.cost-have .card-face[aria-label="Brick"]')).toHaveLength(1);
    // #35: the cost as card faces, the missing brick marked.
    const cost = open.querySelector('.cost-line .cost-cards')!;
    expect(cost.getAttribute('aria-label')).toBe('Cost: 1 brick, 1 lumber');
    expect(
      [...cost.querySelectorAll('.is-missing')].map((c) => c.getAttribute('aria-label')),
    ).toEqual(['Brick']);
    // Enabled buttons have no reason, but the same cost tooltip.
    const city = byText('City')!.closest('.bslot')!;
    expect(city.classList.contains('is-blocked')).toBe(false);
    const tip = city.querySelector('.why.cost-tip')!;
    expect(tip.querySelector('.cost-cards')!.getAttribute('aria-label')).toBe(
      'Cost: 2 wheat, 3 ore',
    );
    expect(tip.textContent).toContain('You have the cards');
    expect(tip.querySelector('.is-missing')).toBeNull();
  });

  it('cost tooltips work at any time: another player’s turn, setup, spectating (#35)', () => {
    const tipOf = (label: string) =>
      [...root.querySelectorAll('.bslot')]
        .find((s) => s.querySelector('.bcard-label')?.textContent === label)
        ?.querySelector('.cost-tip');
    const s = midGame(); // Blue's turn; Red (0) watches their hand
    hud.render(s, { viewer: 0, legal: legalActions(s, 0), isBotTurn: false });
    for (const label of ['Road', 'Settlement', 'City']) {
      expect(tipOf(label)?.querySelector('.cost-cards')).not.toBeNull();
    }
    expect(tipOf('Road')!.textContent).toMatch(/not your turn/i);

    const setup = freshGame(4);
    hud.render(setup, { viewer: 0, legal: legalActions(setup, 0), isBotTurn: false });
    expect(tipOf('City')?.querySelector('.cost-cards')?.getAttribute('aria-label')).toBe(
      'Cost: 2 wheat, 3 ore',
    );
  });

  it('a spectator has no hand but a read-only bar with the cost tooltips (#35)', () => {
    const tipOf = (label: string) =>
      [...root.querySelectorAll('.bslot')]
        .find((s) => s.querySelector('.bcard-label')?.textContent === label)
        ?.querySelector('.cost-tip');
    hud.render(midGame(), { viewer: -1, legal: [], isBotTurn: false, spectator: true });
    expect(root.querySelector('.hand')).toBeNull();
    const bar = root.querySelector('.build-bar.is-costs')!;
    expect([...bar.querySelectorAll('.bcard-label')].map((l) => l.textContent)).toEqual([
      'Buy card',
      'Road',
      'Settlement',
      'City',
    ]);
    expect(tipOf('Settlement')?.querySelector('.cost-cards')?.getAttribute('aria-label')).toBe(
      'Cost: 1 brick, 1 lumber, 1 sheep, 1 wheat',
    );
    expect(tipOf('Settlement')?.querySelector('.cost-have')).toBeNull();
    expect(bar.querySelectorAll('button:not([disabled])')).toHaveLength(0);
  });

  it('a long-press on an enabled build button opens its cost tooltip instead of clicking (#35)', () => {
    vi.useFakeTimers();
    try {
      const s = midGame(); // Blue can build a city
      const modes: unknown[] = [];
      hud.on('placeMode', (m) => modes.push(m));
      hud.render(s, { viewer: 1, legal: legalActions(s, 1), isBotTurn: false });
      const slot = byText('City')!.closest('.bslot')!;
      const press = new Event('pointerdown') as Event & { pointerType: string };
      Object.defineProperty(press, 'pointerType', { value: 'touch' });
      slot.dispatchEvent(press);
      vi.advanceTimersByTime(500);
      expect(root.querySelector('.bslot.is-why .cost-tip b')!.textContent).toBe('City');
      byText('City')!.click(); // the click that ends the long-press
      expect(modes).toEqual([]);
      byText('City')!.click(); // a normal tap still works
      expect(modes).toEqual(['city']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('turn timer: updates the pill in place and warns in the last 10 s', () => {
    const s = midGame();
    hud.render(s, {
      viewer: 1,
      legal: [],
      isBotTurn: false,
      turnTimer: { remainingSec: 30, totalSec: 30 },
    });
    const hand = root.querySelector('.hud-bottom')!.firstChild;
    hud.setTurnTimer({ remainingSec: 9.2, totalSec: 30 });
    const pill = root.querySelector('.turn-pill')!;
    expect(pill.classList.contains('is-timer-low')).toBe(true);
    expect(pill.querySelector('.turn-timer.is-low')!.textContent).toBe('0:10');
    expect(root.querySelector('.hud-bottom')!.firstChild).toBe(hand); // not re-rendered
    expect(hud.isCovered()).toBe(false);
  });

  it('special build pill names the builder and who is still to go', () => {
    const s = midGame();
    for (const p of s.players) p.resources = { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 };
    s.phase = { kind: 'specialBuild', builder: 2, owner: 1 };
    s.turn.current = 2;
    hud.render(s, { viewer: 2, legal: legalActions(s, 2), isBotTurn: false });
    const title = root.querySelector('.turn-title')!;
    expect(title.textContent).toBe('Special build: youthen Orange, Red');
    expect(title.querySelector('.turn-next')!.textContent).toBe('then Orange, Red');
    expect(byText('Pass')!.disabled).toBe(false);
  });

  it('turn pill names the current player and shows a timer when given one', () => {
    const s = midGame();
    hud.render(s, {
      viewer: 0,
      legal: [],
      isBotTurn: true,
      turnTimer: { remainingSec: 75, totalSec: 90 },
    });
    const pill = root.querySelector('.turn-pill')!;
    expect(pill.querySelector('.turn-title')!.textContent).toBe("Blue's turn");
    expect(pill.querySelector('.turn-timer')!.textContent).toBe('1:15');
  });

  it('menu offers a new game and the bot speed', () => {
    const speeds: number[] = [];
    hud.setBotSpeed({
      value: 500,
      presets: [
        { label: 'Normal', ms: 500 },
        { label: 'Fast', ms: 150 },
      ],
      onChange: (ms) => speeds.push(ms),
    });
    const s = midGame();
    hud.render(s, { viewer: 1, legal: [], isBotTurn: false, bots: [true, false, true, true] });
    expect(byText('New game')).toBeUndefined();
    root.querySelector<HTMLButtonElement>('.menu-btn')!.click();
    byText('Fast')!.click();
    expect(speeds).toEqual([150]);
    byText('New game')!.click();
    expect(root.querySelector('.setup')).not.toBeNull();
  });

  it('escapes player names', () => {
    const s = midGame();
    s.players[0]!.name = '<img src=x onerror=alert(1)>';
    hud.render(s, { viewer: 1, legal: [], isBotTurn: false });
    expect(root.querySelector('.hud-players img')).toBeNull();
    expect(root.querySelector('.pp-name')!.textContent).toContain('<img');
  });
});
