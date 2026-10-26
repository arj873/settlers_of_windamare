// @vitest-environment jsdom
/** T&B + C&K in the UI layer: setup screen, the pair panel, the brick / lumber camel vote. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createGame, legalActions, type Action, type GameState } from '../../engine';
import { Hud } from '../../ui/hud';
import { SetupScreen } from '../../ui/setup/screen';
import { playerRange } from '../../ui/setup/model';
import type { NewGameConfig } from '../../ui/types';
import { setGoods } from '../ck/engine/testkit';
import { fishOf } from '../tb/engine/state';
import { TBCK_MODE } from './engine';

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#20202${i}` }));
const q = (screen: SetupScreen, k: string) =>
  screen.element.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);

describe('T&B + C&K setup screen', () => {
  it('is a ready mode with the combinable scenarios and their VP targets', () => {
    const started: NewGameConfig[] = [];
    const screen = new SetupScreen({ onStart: (c) => started.push(c), storage: null });
    document.body.replaceChildren(screen.element);
    q(screen, `mode-${TBCK_MODE}`)?.click();
    expect(screen.state.mode).toBe(TBCK_MODE);
    for (const s of ['fishermen', 'rivers', 'caravans', 'traders', 'variants']) {
      expect(q(screen, `scenario-tb/${s}`), s).not.toBeNull();
    }
    expect(q(screen, 'scenario-tb/barbarianAttack')).toBeNull();
    expect(playerRange(screen.state)).toEqual({ min: 3, max: 6 });
    q(screen, 'scenario-tb/traders')?.click();
    q(screen, 'start')?.click();
    expect(started[0]).toMatchObject({ mode: TBCK_MODE, scenario: 'tb/traders', vpToWin: 15 });
  });
});

describe('T&B + C&K HUD', () => {
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

  function main(scenario: string): GameState {
    const s = createGame({
      seed: 3,
      players: players(4),
      mode: TBCK_MODE,
      scenario,
      startingPlayer: 0,
    });
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'main' };
    return s;
  }

  it('Fishermen: 7 fish buy a progress card from the panel', () => {
    const s = main('tb/fishermen');
    const f = fishOf(s);
    for (const t of [3, 3, 1]) {
      f.pool.splice(f.pool.indexOf(t), 1);
      f.hands[0]!.push(t);
    }
    show(s);
    expect(root.querySelector('.tbck-panel')?.textContent).toContain('13 VP to win');
    byText('7 fish: ')?.click();
    expect(actions.at(-1)?.type).toBe('tbck/fishProgress');
  });

  it('Rivers: commodities sell for gold from the panel', () => {
    const s = main('tb/rivers');
    setGoods(s, 0, { coin: 4 });
    show(s);
    byText('Sell coin for gold')?.click();
    expect(actions.at(-1)).toEqual({ type: 'tbck/sellCommodity', player: 0, commodity: 'coin' });
  });

  it('Caravans: the camel vote bids brick and lumber', () => {
    const s = main('tb/caravans');
    s.players[0]!.resources = { brick: 1, lumber: 1, wool: 3, grain: 3, ore: 0 };
    s.phase = {
      kind: 'tb/vote',
      ender: 0,
      order: [0, 1, 2, 3],
      bids: [0, 0, 0, 0],
      camels: 1,
      placer: null,
      then: 'endTurn',
    } as unknown as GameState['phase'];
    show(s);
    expect(byText('Pass')).toBeDefined();
    byText('Vote 2')?.click();
    expect(actions.at(-1)).toEqual({ type: 'tb/bid', player: 0, brick: 1, lumber: 1 });
  });
});
