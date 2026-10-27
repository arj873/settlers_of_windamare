// @vitest-environment jsdom
/**
 * E&P + C&K in the UI layer: setup screen, the pair's panel (Fast Gold with commodities, the
 * combined offer form), the City card, the Medicine harbor card and the setup hint.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createGame, legalActions, type Action, type GameState } from '../../engine';
import { Hud } from '../../ui/hud';
import { hiddenBaseCards } from '../../ui/expansions';
import { SetupScreen } from '../../ui/setup/screen';
import { pickMode } from '../../ui/setup/testkit';
import { playerRange } from '../../ui/setup/model';
import type { NewGameConfig } from '../../ui/types';
import { giveCards, setGoods } from '../ck/engine/testkit';
import { epSlice, freshTurn } from '../ep/engine';
import { players, V } from '../ep/engine/testkit';
import { EPCK_MODE } from './engine';

const q = (screen: SetupScreen, k: string) =>
  screen.element.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);

describe('E&P + C&K setup screen', () => {
  it('is a ready mode with the four variable-setup scenarios, 3-4 seats, VP target + 5', () => {
    const started: NewGameConfig[] = [];
    const screen = new SetupScreen({ onStart: (c) => started.push(c), storage: null });
    document.body.replaceChildren(screen.element);
    expect(pickMode(screen.element, EPCK_MODE)).toBe(true);
    expect(screen.state.mode).toBe(EPCK_MODE);
    for (const sc of ['pirateLairs', 'fish', 'spices', 'full']) {
      expect(q(screen, `scenario-ep/${sc}`), sc).not.toBeNull();
    }
    expect(q(screen, 'scenario-ep/landHo')).toBeNull();
    expect(playerRange(screen.state)).toEqual({ min: 3, max: 4 });
    q(screen, 'scenario-ep/full')?.click();
    q(screen, 'start')?.click();
    expect(started[0]).toMatchObject({ mode: EPCK_MODE, scenario: 'ep/full', vpToWin: 22 });
  });
});

describe('E&P + C&K HUD', () => {
  let root: HTMLElement;
  let hud: Hud;
  let actions: Action[];
  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
    hud = new Hud(root);
    actions = [];
    hud.on('action', (a) => actions.push(a));
  });
  const show = (s: GameState, viewer = 0) =>
    hud.render(s, { viewer, legal: legalActions(s), isBotTurn: false });
  const byText = (t: string) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(t));

  function game(): GameState {
    const s = createGame({ seed: 1, players: players(4), mode: EPCK_MODE, startingPlayer: 0 });
    s.pieces = { buildings: {}, roads: {} };
    for (const p of s.players) setGoods(s, p.id, {});
    epSlice(s).turn = freshTurn();
    epSlice(s).gold = [0, 0, 0, 0];
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'main' };
    return s;
  }

  it('shows the pair panel and keeps the City card (E&P alone hides it)', () => {
    const s = game();
    show(s);
    // The mode's first scenario: Pirate Lairs, 12 + 5.
    expect(root.querySelector('.epck-panel')?.textContent).toContain('17 VP to win');
    expect(hiddenBaseCards(s).has('city')).toBe(false);
    const ep = createGame({ seed: 1, players: players(4), mode: 'ep', startingPlayer: 0 });
    expect(hiddenBaseCards(ep).has('city')).toBe(true);
  });

  it('Fast Gold sells a commodity from the panel', () => {
    const s = game();
    epSlice(s).spice['h:9,0' as never] = { kind: 'fast', sacks: [], crews: [0] };
    setGoods(s, 0, { cloth: 1 });
    show(s);
    const b = root.querySelector<HTMLButtonElement>('.epck-good');
    expect(b).not.toBeNull();
    b?.click();
    expect(actions.at(-1)).toEqual({ type: 'epck/fastGold', player: 0, commodity: 'cloth' });
  });

  it('one offer form sends commodities and gold', () => {
    const s = game();
    setGoods(s, 0, { paper: 2 });
    show(s);
    const form = root.querySelector('.epck-offer');
    expect(form).not.toBeNull();
    const selects = form?.querySelectorAll('select') ?? [];
    const [giveN, give, , want] = [...selects] as HTMLSelectElement[];
    if (!giveN || !give || !want) throw new Error('no selects');
    giveN.value = '2';
    give.value = 'paper';
    want.value = 'gold';
    form?.querySelector('button')?.click();
    expect(actions.at(-1)).toMatchObject({
      type: 'epck/offerTrade',
      give: { paper: 2 },
      want: { gold: 1 },
      to: [1, 2, 3],
    });
  });

  it('Medicine shows the harbor card and the hint names both choices', () => {
    let s = game();
    s.pieces.buildings[V(5, 0, 'SE')] = { owner: 0, kind: 'settlement' };
    setGoods(s, 0, { grain: 1, ore: 1 });
    giveCards(s, 0, 'medicine');
    s = { ...s, phase: { kind: 'ck/card', card: 'medicine' } as unknown as GameState['phase'] };
    show(s);
    expect(byText('Harbor (Medicine)')).toBeDefined();
    expect(root.textContent).toContain('Medicine: click a settlement');
  });

  it('the setup hint asks for the city first', () => {
    const s = createGame({ seed: 1, players: players(4), mode: EPCK_MODE, startingPlayer: 0 });
    show(s);
    expect(root.textContent).toContain('Place your city anywhere');
  });
});
