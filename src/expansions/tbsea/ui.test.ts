// @vitest-environment jsdom
/** T&B + Seafarers in the UI layer: setup screen, the pair panel and its fish buttons. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createGame, legalActions, type Action, type GameState } from '../../engine';
import { Hud } from '../../ui/hud';
import { SetupScreen } from '../../ui/setup/screen';
import { playerRange } from '../../ui/setup/model';
import type { NewGameConfig } from '../../ui/types';
import { fishOf } from '../tb/engine/state';
import { PAIRS, TBSEA_MODE } from './engine';

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#20202${i}` }));
const q = (screen: SetupScreen, k: string) =>
  screen.element.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);

describe('T&B + Seafarers setup screen', () => {
  it('is a ready mode with one New Shores scenario per T&B scenario, for 3-4 players', () => {
    const started: NewGameConfig[] = [];
    const screen = new SetupScreen({ onStart: (c) => started.push(c), storage: null });
    document.body.replaceChildren(screen.element);
    q(screen, `mode-${TBSEA_MODE}`)?.click();
    expect(screen.state.mode).toBe(TBSEA_MODE);
    for (const p of PAIRS) expect(q(screen, `scenario-${p.id}`), p.id).not.toBeNull();
    expect(playerRange(screen.state)).toEqual({ min: 3, max: 4 });
    q(screen, 'scenario-tbsea/traders')?.click();
    q(screen, 'start')?.click();
    expect(started[0]).toMatchObject({ mode: TBSEA_MODE, scenario: 'tbsea/traders', vpToWin: 17 });
  });
});

describe('T&B + Seafarers HUD', () => {
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
      mode: TBSEA_MODE,
      scenario,
      startingPlayer: 0,
    });
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'main' };
    return s;
  }

  it('shows the scenario’s pair rules and VP target', () => {
    const want: Record<string, string> = {
      'tbsea/traders': 'Wagons cross the sea',
      'tbsea/fishermen': 'chase the pirate off the board',
      'tbsea/rivers': 'No ship on a bridge site',
      'tbsea/caravans': 'Camels may also go on sea edges',
      'tbsea/barbarianAttack': 'route grows only from an unconquered building',
    };
    for (const p of PAIRS) {
      show(main(p.id));
      const text = root.querySelector('.tbsea-panel')?.textContent ?? '';
      expect(text, p.id).toContain(`${p.vp} VP to win`);
      expect(text, p.id).toContain(want[p.id]);
    }
  });

  it('Fishermen: 2 fish chase the pirate from the panel', () => {
    const s = main('tbsea/fishermen');
    fishOf(s).hands[0] = [2];
    show(s);
    byText('Chase the pirate')?.click();
    expect(actions.at(-1)).toEqual({ type: 'tbsea/fishPirate', player: 0 });
    show(s, 1);
    expect(byText('Chase the pirate')).toBeUndefined();
  });
});
