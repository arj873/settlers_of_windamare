// @vitest-environment jsdom
/**
 * Catan for Two + C&K in the UI layer: the setup tile (2 seats, 13 VP), the pair panel with the
 * any-cards Forced Trade, the cards-back dialog with commodities, Treason against a neutral and
 * the neutral-knight hint.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createGame, legalActions, type GameState } from '../../engine';
import { topologyOf, vertexEdges } from '../../engine/topology';
import { Hud } from '../../ui/hud';
import { SetupScreen } from '../../ui/setup/screen';
import { pickMode } from '../../ui/setup/testkit';
import { playerRange } from '../../ui/setup/model';
import type { NewGameConfig } from '../../ui/types';
import { ckSlice } from '../ck/engine';
import { giveCards, players, setGoods } from '../ck/engine/testkit';
import { SC_BASE, twoOf } from '../tb/engine';
import { TWOCK_MODE, neutralOwner } from './engine';

const q = (screen: SetupScreen, k: string) =>
  screen.element.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);

describe('Catan for Two + C&K setup screen', () => {
  it('is a ready mode on the base board for 2 seats, 13 VP', () => {
    const started: NewGameConfig[] = [];
    const screen = new SetupScreen({ onStart: (c) => started.push(c), storage: null });
    document.body.replaceChildren(screen.element);
    expect(pickMode(screen.element, TWOCK_MODE)).toBe(true);
    expect(screen.state.mode).toBe(TWOCK_MODE);
    expect(playerRange(screen.state)).toEqual({ min: 2, max: 2 });
    q(screen, 'start')?.click();
    expect(started[0]).toMatchObject({ mode: TWOCK_MODE, scenario: SC_BASE, vpToWin: 13 });
  });
});

describe('Catan for Two + C&K HUD', () => {
  let root: HTMLElement;
  let hud: Hud;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
    hud = new Hud(root);
  });
  const show = (s: GameState, viewer = 0) =>
    hud.render(s, { viewer, legal: legalActions(s), isBotTurn: false });
  const byText = (t: string) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(t));

  function game(): GameState {
    const s = createGame({
      seed: 1,
      players: players(2),
      mode: TWOCK_MODE,
      scenario: SC_BASE,
      startingPlayer: 0,
    });
    s.pieces = { buildings: {}, roads: {} };
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'main' };
    twoOf(s).rolls = 2;
    return s;
  }

  it('the panel offers the any-cards Forced Trade at twice the price', () => {
    const s = game();
    setGoods(s, 1, { paper: 1 });
    show(s);
    expect(root.querySelector('.twock-panel')?.textContent).toContain('13 VP to win');
    expect(byText('2 tokens · Forced trade (any cards)')).toBeDefined();
    byText('Forced trade (any cards)')?.click();
  });

  it('cards given back may be commodities', () => {
    const s = game();
    setGoods(s, 0, { coin: 1 });
    s.phase = { kind: 'twock/forcedGive', count: 1, resume: 'main' } as never;
    show(s);
    expect(root.textContent).toContain('Give 1 card of your choice');
    expect(root.querySelectorAll('.twock-buttons button').length).toBe(1);
  });

  it('Treason names the neutral players', () => {
    const s = game();
    giveCards(s, 0, 'deserter');
    ckSlice(s).knights['v:0,0,N'] = {
      owner: neutralOwner(s, 1),
      level: 1,
      active: false,
      activatedOn: null,
      promotedOn: null,
    };
    s.phase = { kind: 'ck/card', card: 'deserter', victim: null, removed: null } as never;
    show(s);
    expect(byText('Neutral 2')).toBeDefined();
  });

  it('words the neutral knight step in the turn pill', () => {
    const s = game();
    const n = twoOf(s).neutrals[0];
    n.roads.push(vertexEdges(topologyOf(s), n.settlements[0]!)[0]!);
    s.phase = { kind: 'twock/neutral', step: 'recruit', resume: { kind: 'main' } } as never;
    show(s);
    expect(root.textContent).toContain('Place a free knight for Neutral 1 or Neutral 2');
  });
});
