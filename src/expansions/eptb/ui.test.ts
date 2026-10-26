// @vitest-environment jsdom
/** E&P + T&B in the UI layer: setup screen (lake option), the pair's panel, the fish ship card. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createGame, legalActions, type Action, type GameState } from '../../engine';
import { Hud } from '../../ui/hud';
import { SetupScreen } from '../../ui/setup/screen';
import { playerRange, setupError } from '../../ui/setup/model';
import type { NewGameConfig } from '../../ui/types';
import { epSlice, freshTurn } from '../ep/engine';
import { E, H, players } from '../ep/engine/testkit';
import { fishOf } from '../tb/engine';
import { EPTB_MODE } from './engine';

const q = (screen: SetupScreen, k: string) =>
  screen.element.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);

describe('E&P + T&B setup screen', () => {
  it('is a ready mode with the five E&P scenarios, 3-4 seats, the scenario’s VP', () => {
    const started: NewGameConfig[] = [];
    const screen = new SetupScreen({ onStart: (c) => started.push(c), storage: null });
    document.body.replaceChildren(screen.element);
    q(screen, `mode-${EPTB_MODE}`)?.click();
    expect(screen.state.mode).toBe(EPTB_MODE);
    for (const sc of ['landHo', 'pirateLairs', 'fish', 'spices', 'full']) {
      expect(q(screen, `scenario-ep/${sc}`), sc).not.toBeNull();
    }
    expect(playerRange(screen.state)).toEqual({ min: 3, max: 4 });
    q(screen, 'scenario-ep/full')?.click();
    q(screen, 'start')?.click();
    expect(started[0]).toMatchObject({ mode: EPTB_MODE, scenario: 'ep/full', vpToWin: 17 });
  });

  it('refuses Harbors of Catan with a message', () => {
    const screen = new SetupScreen({ onStart: () => undefined, storage: null });
    document.body.replaceChildren(screen.element);
    q(screen, `mode-${EPTB_MODE}`)?.click();
    const options = { ...screen.state.options, tb: { harbormaster: true } };
    expect(setupError({ ...screen.state, options })).toMatch(/harbors/);
  });
});

describe('E&P + T&B HUD', () => {
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

  function game(): GameState {
    const s = createGame({ seed: 1, players: players(4), mode: EPTB_MODE, startingPlayer: 0 });
    s.pieces = { buildings: {}, roads: {} };
    epSlice(s).turn = freshTurn();
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'main' };
    return s;
  }

  it('shows the pair panel and the pirate pass for 2 fish', () => {
    const s = game();
    epSlice(s).pirate = { owner: 1, hex: H(9, 4) };
    epSlice(s).ships.push({ id: 9, owner: 0, edge: E(5, 0, 'E'), cargo: [] });
    const f = fishOf(s);
    f.pool.splice(f.pool.indexOf(2), 1);
    f.hands[0] = [2];
    show(s);
    expect(root.querySelector('.eptb-panel')?.textContent).toContain('Fishing grounds');
    const b = [...root.querySelectorAll('button')].find((x) =>
      x.textContent?.includes('no tribute to the pirate'),
    );
    expect(b).toBeDefined();
    b?.click();
    expect(actions.at(-1)).toEqual({ type: 'eptb/fish', player: 0, use: 'pirate' });
  });

  it('shows the Ship (5 fish) build card', () => {
    show(game());
    expect(root.textContent).toContain('Ship (5 fish)');
  });
});
