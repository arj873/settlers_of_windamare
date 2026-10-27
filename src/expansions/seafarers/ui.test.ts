// @vitest-environment jsdom
/** Seafarers in the UI layer: setup screen, panel, Ship / Move cards, gold and pirate dialogs. */
import { beforeEach, describe, expect, it } from 'vitest';
import { legalActions, type Action, type GameState } from '../../engine';
import { actionForClick, boardActions } from '../../game/logic';
import { Hud } from '../../ui/hud';
import { SetupScreen } from '../../ui/setup/screen';
import { setupError, playerRange } from '../../ui/setup/model';
import type { NewGameConfig } from '../../ui/types';
import { seaSlice, type GoldPhase } from './engine';
import { E, H, V, mainPhase, seaGame, ship } from './engine/testkit';

describe('Seafarers setup screen', () => {
  const q = (screen: SetupScreen, k: string) =>
    screen.element.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);

  it('offers Seafarers as a ready mode with its nine scenarios and 3-6 seats', () => {
    const started: NewGameConfig[] = [];
    const screen = new SetupScreen({ onStart: (c) => started.push(c), storage: null });
    document.body.replaceChildren(screen.element);
    q(screen, 'mode-seafarers')?.click();
    expect(screen.state.mode).toBe('seafarers');
    expect(q(screen, 'scenario-seafarers/newShores')?.getAttribute('aria-pressed')).toBe('true');
    for (const s of [
      'fogIslands',
      'clothForCatan',
      'pirateIslands',
      'wondersOfCatan',
      'newWorld',
    ]) {
      expect(q(screen, `scenario-seafarers/${s}`)).not.toBeNull();
    }
    expect(playerRange(screen.state)).toEqual({ min: 3, max: 6 });
    q(screen, 'start')?.click();
    expect(started[0]).toMatchObject({
      mode: 'seafarers',
      scenario: 'seafarers/newShores',
      vpToWin: 14,
    });
  });

  it('refuses Event Cards with the Pirate Islands: a message, Start disabled', () => {
    const screen = new SetupScreen({ onStart: () => undefined, storage: null });
    document.body.replaceChildren(screen.element);
    q(screen, 'mode-seafarers')?.click();
    q(screen, 'scenario-seafarers/pirateIslands')?.click();
    const draft = { ...screen.state, eventCards: true };
    expect(setupError(draft)).toMatch(/Event Cards/);
    expect(setupError(screen.state)).toBeNull();
  });
});

describe('Seafarers HUD', () => {
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

  function coastGame(): GameState {
    const s = mainPhase(seaGame('newShores', 4));
    seaSlice(s).pirate = H(3, -1);
    s.pieces.buildings[V(2, 8, 'SE')] = { owner: 0, kind: 'settlement' };
    s.players[0]!.resources.lumber = 1;
    s.players[0]!.resources.wool = 1;
    s.bank.lumber -= 1;
    s.bank.wool -= 1;
    return s;
  }

  it('the panel shows the goal and ships left; the Ship card is enabled', () => {
    show(coastGame());
    const panel = root.querySelector('.sec-ext-seafarers');
    expect(panel?.textContent).toContain('Heading for New Shores');
    expect(panel?.textContent).toContain('14 VP wins');
    expect(panel?.querySelectorAll('.sea-row')).toHaveLength(4);
    const card = byText('Ship');
    expect(card?.disabled).toBe(false);
  });

  it('Seafarers words: settlements need a road or ship; Longest Trade Route', () => {
    const s = coastGame();
    show(s);
    const settlement = [...root.querySelectorAll<HTMLButtonElement>('.bcard')].find(
      (b) => b.querySelector('.bcard-label')?.textContent === 'Settlement',
    );
    expect(settlement?.dataset['why']).toMatch(/needs your road or ship,/);
    s.awards.longestRoad = 0;
    show(s);
    expect(root.querySelector('[aria-label="Longest Trade Route"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="Longest Road"]')).toBeNull();
  });

  it('Ship mode highlights the ship spots; a click builds there', () => {
    const s = coastGame();
    const spots = boardActions(legalActions(s), 0, 'seafarers/ship');
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.every((a) => a.type === 'seafarers/buildShip')).toBe(true);
    const a = actionForClick(spots, { kind: 'edge', id: E(2, 8, 'S') });
    expect(a).toMatchObject({ type: 'seafarers/buildShip', edge: E(2, 8, 'S') });
  });

  it('in setup, the Ship mode wins over the implied road on a coast edge', () => {
    const s = seaGame('newShores', 4);
    seaSlice(s).pirate = H(3, -1);
    s.pieces.buildings[V(2, 8, 'SE')] = { owner: 0, kind: 'settlement' };
    s.phase = { kind: 'setup', index: 0, step: 'road', lastSettlement: V(2, 8, 'SE') };
    const coast = { kind: 'edge', id: E(2, 8, 'S') } as const;
    expect(actionForClick(boardActions(legalActions(s), 0, null), coast)?.type).toBe(
      'placeSetupRoad',
    );
    expect(actionForClick(boardActions(legalActions(s), 0, 'seafarers/ship'), coast)?.type).toBe(
      'seafarers/placeSetupShip',
    );
  });

  it('the gold dialog sends the picked resources', () => {
    const s = coastGame();
    const phase: GoldPhase = {
      kind: 'seafarers/gold',
      pending: [2, 0, 0, 0],
      then: { phase: { kind: 'main' } },
    };
    s.phase = phase;
    show(s);
    const dialog = root.querySelector('.dialog');
    expect(dialog?.textContent).toContain('Take 2 resources');
    const ore = dialog?.querySelector<HTMLButtonElement>('[aria-label="Add Ore"]');
    ore?.click();
    ore?.click();
    byText('Take')?.click();
    expect(actions.at(-1)).toEqual({
      type: 'seafarers/pickGold',
      player: 0,
      resources: { ore: 2 },
    });
  });

  it('Cloth for Catan: the pirate may take a card or a cloth', () => {
    const s = mainPhase(seaGame('clothForCatan', 4));
    ship(s, 1, E(2, 2, 'S'));
    seaSlice(s).cloth!.held[1] = 2;
    seaSlice(s).cloth!.supply -= 2;
    s.players[1]!.resources.ore = 1;
    s.bank.ore -= 1;
    s.phase = { kind: 'seafarers/pirateSteal', candidates: [1], resume: 'main' };
    show(s);
    expect(byText('Random card')).toBeDefined();
    byText('Cloth')?.click();
    expect(actions.at(-1)).toEqual({ type: 'seafarers/stealCloth', player: 0, victim: 1 });
  });

  it('the Wonders panel offers Start for a wonder you qualify for', () => {
    const s = mainPhase(seaGame('wondersOfCatan', 4));
    show(s);
    const starts = [...root.querySelectorAll<HTMLButtonElement>('.sea-wonder .btn')];
    expect(starts).toHaveLength(5);
    expect(starts.every((b) => b.disabled)).toBe(true);
  });
});
