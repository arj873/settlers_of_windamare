// @vitest-environment jsdom
/** T&B scenario pairs in the UI layer: setup screen, the pair panel, the 2-fish wagon button. */
import { describe, expect, it } from 'vitest';
import { createGame, legalActions, type Action, type GameState } from '../../engine';
import { Hud } from '../../ui/hud';
import { SetupScreen } from '../../ui/setup/screen';
import { playerRange } from '../../ui/setup/model';
import type { NewGameConfig } from '../../ui/types';
import { fishOf, tradersOf } from '../tb/engine/state';
import { FISH_PAIRS, TBPAIR_MODE } from './engine';

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#20202${i}` }));
const q = (screen: SetupScreen, k: string) =>
  screen.element.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);

describe('T&B scenario pairs in the UI', () => {
  it('the setup screen offers the four Fishing pairs for 3-4 players', () => {
    const started: NewGameConfig[] = [];
    const screen = new SetupScreen({ onStart: (c) => started.push(c), storage: null });
    document.body.replaceChildren(screen.element);
    q(screen, `mode-${TBPAIR_MODE}`)?.click();
    for (const p of FISH_PAIRS) expect(q(screen, `scenario-${p.id}`), p.id).not.toBeNull();
    expect(playerRange(screen.state)).toEqual({ min: 3, max: 4 });
    q(screen, 'scenario-tbpair/fishRivers')?.click();
    q(screen, 'start')?.click();
    expect(started[0]).toMatchObject({
      mode: TBPAIR_MODE,
      scenario: 'tbpair/fishRivers',
      vpToWin: 10,
    });
  });

  it('the panel names the rules; 2 fish buy wagon MP from it', () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    const hud = new Hud(root);
    const actions: Action[] = [];
    hud.on('action', (a) => actions.push(a));
    const s: GameState = createGame({
      seed: 3,
      players: players(4),
      mode: TBPAIR_MODE,
      scenario: 'tbpair/fishTraders',
      startingPlayer: 0,
    });
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'tb/wagon' } as unknown as GameState['phase'];
    tradersOf(s).wagons[0] = 'v:0,0,N';
    fishOf(s).hands[0] = [2];
    hud.render(s, { viewer: 0, legal: legalActions(s), isBotTurn: false });
    const text = root.querySelector('.tbpair-panel')?.textContent ?? '';
    expect(text).toContain('12 VP to win');
    expect(text).toContain('2 more MP');
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('2 more MP'))?.click();
    expect(actions.at(-1)).toEqual({ type: 'tbpair/fishWagon', player: 0 });
  });
});
