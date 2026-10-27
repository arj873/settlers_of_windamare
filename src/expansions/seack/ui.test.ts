// @vitest-environment jsdom
/** Seafarers + C&K in the UI layer: setup screen, the pair's panel, chasing the pirate. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createGame, legalActions, type Action, type GameState } from '../../engine';
import { Hud } from '../../ui/hud';
import { SetupScreen } from '../../ui/setup/screen';
import { pickMode } from '../../ui/setup/testkit';
import { playerRange, setupError } from '../../ui/setup/model';
import type { NewGameConfig } from '../../ui/types';
import { ckSlice } from '../ck/engine';
import { knight } from '../ck/engine/testkit';
import { seaSlice } from '../seafarers/engine';
import { E, H, V, players, ship } from '../seafarers/engine/testkit';
import { SEACK_MODE } from './engine';

const q = (screen: SetupScreen, k: string) =>
  screen.element.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);

describe('Seafarers + C&K setup screen', () => {
  it('is a ready mode with the two suitable scenarios, 3-6 seats, VP target + 2', () => {
    const started: NewGameConfig[] = [];
    const screen = new SetupScreen({ onStart: (c) => started.push(c), storage: null });
    document.body.replaceChildren(screen.element);
    expect(pickMode(screen.element, SEACK_MODE)).toBe(true);
    expect(screen.state.mode).toBe(SEACK_MODE);
    expect(q(screen, 'scenario-seafarers/newShores')).not.toBeNull();
    expect(q(screen, 'scenario-seafarers/throughTheDesert')).not.toBeNull();
    expect(q(screen, 'scenario-seafarers/fogIslands')).toBeNull();
    expect(playerRange(screen.state)).toEqual({ min: 3, max: 6 });
    q(screen, 'start')?.click();
    expect(started[0]).toMatchObject({
      mode: SEACK_MODE,
      scenario: 'seafarers/newShores',
      vpToWin: 16,
    });
  });

  it('refuses Rush mode (C&K) with a message', () => {
    const screen = new SetupScreen({ onStart: () => undefined, storage: null });
    document.body.replaceChildren(screen.element);
    expect(pickMode(screen.element, SEACK_MODE)).toBe(true);
    expect(setupError({ ...screen.state, rushMode: true })).toMatch(/Rush/);
    expect(setupError({ ...screen.state, eventCards: true })).toBeNull();
  });
});

describe('Seafarers + C&K HUD', () => {
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
    const s = createGame({
      seed: 1,
      players: players(4),
      mode: SEACK_MODE,
      startingPlayer: 0,
    });
    s.pieces.buildings = {};
    s.pieces.roads = {};
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'main' };
    return s;
  }

  it('shows the pair panel: VP target, the sleeping robber and pirate', () => {
    const s = game();
    show(s);
    const panel = root.querySelector('.seack-panel');
    expect(panel?.textContent).toContain('16 VP to win');
    expect(panel?.textContent).toContain('sleep until the barbarians');
    ckSlice(s).attacks = 1;
    show({ ...s });
    expect(root.querySelector('.seack-panel')?.textContent).toContain('awake');
  });

  it('the knight dialog offers Chase the pirate when a knight stands next to it', () => {
    const s = game();
    const tip = V(2, 8, 'SE');
    s.pieces.buildings[V(2, 8, 'SW')] = { owner: 0, kind: 'settlement' };
    ship(s, 0, E(2, 8, 'S'));
    knight(s, 0, tip, 1, true);
    seaSlice(s).pirate = H(3, 9);
    ckSlice(s).attacks = 1;
    s.phase = { kind: 'ck/knight', vertex: tip, resume: 'main' } as unknown as GameState['phase'];
    show(s);
    const b = byText('Chase the pirate');
    expect(b).toBeDefined();
    b?.click();
    expect(actions.at(-1)).toEqual({ type: 'seack/chasePirate', player: 0 });
  });
});
