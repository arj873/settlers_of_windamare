// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Action } from '../engine';
import { discardGame, midGame, moveRobberGame, tradeOfferGame } from '../engine/fixtures';
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
    const act = [...root.querySelectorAll<HTMLButtonElement>('.actions button')];
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
    byText('3')!.click();
    byText('Random')!.click();
    byText('Start game')!.click();
    expect(cfg?.players).toHaveLength(3);
    expect(cfg?.layout).toBe('random');
  });

  it('escapes player names', () => {
    const s = midGame();
    s.players[0]!.name = '<img src=x onerror=alert(1)>';
    hud.render(s, { viewer: 1, legal: [], isBotTurn: false });
    expect(root.querySelector('.hud-players img')).toBeNull();
    expect(root.querySelector('.pp-name')!.textContent).toContain('<img');
  });
});
