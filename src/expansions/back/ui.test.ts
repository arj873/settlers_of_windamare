// @vitest-environment jsdom
/**
 * Barbarian Attack + C&K in the UI layer: the setup tile, the pair panel, the path-knight build
 * cards (C&K's vertex knight cards, its barbarian track and BA's knight card are hidden), the
 * Treason dialog and the end-of-turn hint.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createGame, legalActions, type Action, type GameState } from '../../engine';
import { hexEdges, topologyOf } from '../../engine/topology';
import { Hud } from '../../ui/hud';
import { SetupScreen } from '../../ui/setup/screen';
import { pickMode } from '../../ui/setup/testkit';
import { playerRange } from '../../ui/setup/model';
import type { NewGameConfig } from '../../ui/types';
import { giveCards, players, setGoods } from '../ck/engine/testkit';
import { SC_BA } from '../tb/engine';
import { BACK_MODE, backSlice } from './engine';

const q = (screen: SetupScreen, k: string) =>
  screen.element.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);

describe('Barbarian Attack + C&K setup screen', () => {
  it('is a ready mode with the Barbarian Attack scenario, 3-6 seats, 13 VP', () => {
    const started: NewGameConfig[] = [];
    const screen = new SetupScreen({ onStart: (c) => started.push(c), storage: null });
    document.body.replaceChildren(screen.element);
    expect(pickMode(screen.element, BACK_MODE)).toBe(true);
    expect(screen.state.mode).toBe(BACK_MODE);
    expect(q(screen, `scenario-${SC_BA}`)).not.toBeNull();
    expect(playerRange(screen.state)).toEqual({ min: 3, max: 6 });
    q(screen, 'start')?.click();
    expect(started[0]).toMatchObject({ mode: BACK_MODE, scenario: SC_BA, vpToWin: 13 });
  });
});

describe('Barbarian Attack + C&K HUD', () => {
  let root: HTMLElement;
  let hud: Hud;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
    hud = new Hud(root);
  });
  const show = (s: GameState, viewer = 0) =>
    hud.render(s, { viewer, legal: legalActions(s), isBotTurn: false });

  function game(): GameState {
    const s = createGame({
      seed: 1,
      players: players(4),
      mode: BACK_MODE,
      scenario: SC_BA,
      startingPlayer: 0,
    });
    s.pieces = { buildings: {}, roads: {} };
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'main' };
    return s;
  }
  const castle = (s: GameState) => hexEdges(topologyOf(s), 'h:-2,2');

  it('shows the pair panel without C&K’s barbarian track', () => {
    const s = game();
    show(s);
    expect(root.querySelector('.back-panel')?.textContent).toContain('13 VP to win');
    expect(root.querySelector('.back-panel')?.textContent).toContain('Your knights');
    expect(root.querySelector('[aria-label^="Ship at"]')).toBeNull();
  });

  it('offers the path-knight cards; C&K’s knight cards and BA’s card are hidden', () => {
    const s = game();
    setGoods(s, 0, { wool: 1, ore: 1 });
    show(s);
    const cards = [...root.querySelectorAll<HTMLButtonElement>('.ext-card')];
    const labels = cards.map((b) => b.querySelector('.bcard-label')?.textContent ?? '');
    expect(labels).toEqual(['Knight', 'Activate', 'Promote', 'Knight actions', 'City wall']);
    expect(cards[0]?.disabled).toBe(false);
    // #35: each card's slot carries the cost tooltip (from the module's cost data).
    const tip = cards[0]!.closest('.bslot')!.querySelector('.cost-tip')!;
    expect(tip.querySelector('b')?.textContent).toBe('Knight');
    expect(tip.querySelector('.cost-cards')?.getAttribute('aria-label')).toBe(
      'Cost: 1 wool, 1 ore',
    );
    expect(tip.textContent).toContain('You have the cards');
    const wall = cards[4]!.closest('.bslot')!.querySelector('.cost-tip')!;
    expect(wall.querySelector('.cost-have')?.classList.contains('is-short')).toBe(true);
  });

  it('Treason asks for the opponent in a dialog', () => {
    const s = game();
    giveCards(s, 0, 'deserter');
    backSlice(s).knights[castle(s)[0]!] = {
      owner: 2,
      level: 1,
      active: false,
      activatedOn: null,
      promotedOn: null,
    };
    const r = legalActions(s).find(
      (a) => a.type === 'ck/play' && (a as { card?: string }).card === 'deserter',
    ) as Action;
    expect(r).toBeDefined();
    s.phase = { kind: 'back/deserter', victim: null } as never;
    show(s);
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent === 'P2');
    expect(btn).toBeDefined();
  });

  it('words the end-of-turn knight step in the turn pill', () => {
    const s = game();
    s.phase = { kind: 'back/knights', from: null } as never;
    show(s);
    expect(root.textContent).toContain('Pick a knight to move, or end your turn');
  });
});
