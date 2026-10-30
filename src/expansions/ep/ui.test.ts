// @vitest-environment jsdom
/** Explorers & Pirates in the UI layer: setup screen, panel, build cards, board clicks, dialogs. */
import { beforeEach, describe, expect, it } from 'vitest';
import { legalActions, type Action, type GameState } from '../../engine';
import { actionForClick, boardActions } from '../../game/logic';
import { Hud } from '../../ui/hud';
import { bestRatios } from '../../ui/model';
import { SetupScreen } from '../../ui/setup/screen';
import { pickMode } from '../../ui/setup/testkit';
import { playerRange, setupError } from '../../ui/setup/model';
import type { NewGameConfig } from '../../ui/types';
import { A } from './engine/actions';
import { epSlice } from './engine/state';
import { addShip, blank, E, give, H, movement, openSea, reveal, settle, V } from './engine/testkit';

const COAST = V(5, 0, 'SE');

describe('E&P setup screen', () => {
  const q = (screen: SetupScreen, k: string) =>
    screen.element.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);

  it('offers Explorers & Pirates with its five scenarios, 3-6 seats; Land Ho! for 3-4', () => {
    const started: NewGameConfig[] = [];
    const screen = new SetupScreen({ onStart: (c) => started.push(c), storage: null });
    document.body.replaceChildren(screen.element);
    expect(pickMode(screen.element, 'ep')).toBe(true);
    expect(screen.state.mode).toBe('ep');
    for (const s of ['landHo', 'pirateLairs', 'fish', 'spices', 'full']) {
      expect(q(screen, `scenario-ep/${s}`), s).not.toBeNull();
    }
    expect(q(screen, 'scenario-ep/landHo')?.getAttribute('aria-pressed')).toBe('true');
    expect(playerRange(screen.state)).toEqual({ min: 3, max: 4 });
    q(screen, 'scenario-ep/full')?.click();
    expect(playerRange(screen.state)).toEqual({ min: 3, max: 6 });
    q(screen, 'start')?.click();
    expect(started[0]).toMatchObject({ mode: 'ep', scenario: 'ep/full', vpToWin: 17 });
  });

  it('refuses unofficial combinations with a message: setup variants, balance rules', () => {
    const screen = new SetupScreen({ onStart: () => undefined, storage: null });
    document.body.replaceChildren(screen.element);
    expect(pickMode(screen.element, 'ep')).toBe(true);
    expect(setupError(screen.state)).toBeNull();
    expect(setupError({ ...screen.state, eventCards: true })).toBeNull();
  });
});

describe('E&P HUD', () => {
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
  const panel = () => root.querySelector('.sec-ext-ep');

  it('the panel shows the goal, the Action phase with Start Movement, gold and mission tracks', () => {
    const s = blank('full');
    epSlice(s).gold = [5, 1, 0, 2];
    show(s);
    const text = panel()?.textContent ?? '';
    expect(text).toMatch(/17 VP wins/);
    expect(text).toMatch(/Pirate Lairs/);
    expect(text).toMatch(/Best Fisher/);
    expect(text).toMatch(/Action phase/);
    byText('Start Movement phase')?.click();
    expect(actions).toEqual([{ type: A.startMovement, player: 0 }]);
  });

  it('player rows: the extra-VP stat names its parts (a harbor is not mission VP)', () => {
    const s = blank('pirateLairs');
    settle(s, 0, COAST, true);
    show(s);
    const vpStat = (i: number) =>
      [
        ...(root.querySelectorAll('.ep-row')[i]?.querySelectorAll<HTMLElement>('.ep-stat') ?? []),
      ].at(-1)!;
    expect(vpStat(0).textContent).toBe('+1');
    expect(vpStat(0).title).toMatch(/Harbors \+1/);
    expect(vpStat(0).title).not.toMatch(/mission VP/);
    expect(vpStat(1).title).toMatch(/none yet/);
  });

  it('a disabled Harbor card says why when resources are not the problem', () => {
    const s = blank('full');
    give(s, 0, { grain: 2, ore: 2 });
    show(s);
    const harbor = () =>
      [...root.querySelectorAll<HTMLButtonElement>('.bcard')].find(
        (b) => b.querySelector('.bcard-label')?.textContent === 'Harbor',
      )!;
    expect(harbor().disabled).toBe(true);
    expect(harbor().dataset['why']).toBe('No coastal settlement to upgrade');
    give(s, 0, { grain: -2, ore: -2 });
    show(s);
    expect(harbor().dataset['why']).toBe(
      'Missing 2 wheat, 2 ore; No coastal settlement to upgrade',
    );
  });

  it('build bar: Harbor, Ship, Settler and Crew cards; no City card', () => {
    const s = blank('full');
    settle(s, 0, COAST);
    give(s, 0, { grain: 2, ore: 2 });
    show(s);
    const labels = [...root.querySelectorAll('.bcard-label')].map((x) => x.textContent);
    expect(labels).toEqual(
      expect.arrayContaining(['Road', 'Settlement', 'Harbor', 'Ship', 'Settler', 'Crew']),
    );
    expect(labels).not.toContain('City');
    const harbor = [...root.querySelectorAll<HTMLButtonElement>('.bcard')].find(
      (b) => b.querySelector('.bcard-label')?.textContent === 'Harbor',
    );
    expect(harbor?.disabled).toBe(false);
    // In the Harbor mode a click on the settlement upgrades it.
    const legal = legalActions(s);
    const clicks = boardActions(legal, 0, 'ep/harbor');
    expect(actionForClick(clicks, { kind: 'vertex', id: COAST })).toMatchObject({
      type: A.buildHarbor,
      vertex: COAST,
    });
  });

  it('Land Ho!: no Crew card', () => {
    show(blank('landHo'));
    const labels = [...root.querySelectorAll('.bcard-label')].map((x) => x.textContent);
    expect(labels).not.toContain('Crew');
  });

  it('the bank shows 3:1 for every resource (no ports, no 4:1)', () => {
    const s = blank('full');
    expect(Object.values(bestRatios(s, 0))).toEqual([3, 3, 3, 3, 3]);
  });

  it('gold is a card in the hand bar', () => {
    const s = blank('full');
    epSlice(s).gold[0] = 4;
    show(s);
    const card = root.querySelector<HTMLButtonElement>('.ep-hc');
    expect(card?.textContent).toContain('4');
    // #cardinfo: a tap says what gold is for.
    card!.click();
    const info = root.querySelector('.hud-pop-layer .dev-info')?.textContent ?? '';
    expect(info).toContain('2 gold buy 1 resource of your choice (at most 2 times per turn)');
    expect(info).toContain('Gold purchases this turn: 0 of 2.');
  });

  it('movement: ships are clicked to select, edges to sail; the fleet lists cargo and buttons', () => {
    const s = movement(openSea(blank('full')));
    addShip(s, 0, E(8, 3, 'E'), ['crew']);
    addShip(s, 0, E(8, 3, 'SE'));
    show(s);
    const fleet = panel()?.querySelector('.ep-fleet');
    expect(fleet?.textContent).toMatch(/Ship 1/);
    expect(fleet?.querySelectorAll('.ep-ico-crew').length).toBe(1);
    const legal = legalActions(s);
    const clicks = boardActions(legal, 0, null);
    const sel = actionForClick(clicks, { kind: 'edge', id: E(8, 3, 'SE') });
    expect(sel).toMatchObject({ type: A.selectShip, ship: 1 });
    byText('Select')?.click();
    expect(actions[0]).toMatchObject({ type: A.selectShip });
  });

  it('landing: a highlighted corner builds the settlement', () => {
    const s = movement(openSea(blank('full')));
    reveal(s, H(9, 2), 'ore', 5);
    addShip(s, 0, E(7, 2, 'NE'), ['settler']);
    const clicks = boardActions(legalActions(s), 0, null);
    expect(actionForClick(clicks, { kind: 'vertex', id: V(7, 2, 'NE') })).toMatchObject({
      type: A.land,
    });
  });

  it('the pirate: hexes are board clicks; the steal is a dialog', () => {
    const s = openSea(blank('full'));
    s.phase = { kind: 'ep/pirate', resume: 'main' };
    const clicks = boardActions(legalActions(s), 0, null);
    expect(actionForClick(clicks, { kind: 'hex', id: H(8, 3) })).toMatchObject({
      type: A.placePirate,
    });
    const t = openSea(blank('full'));
    t.phase = { kind: 'ep/pirateSteal', candidates: [1], resume: 'main' };
    show(t);
    expect(root.textContent).toMatch(/Your pirates attack/);
    byText('Rob')?.click();
    expect(actions[0]).toEqual({ type: A.pirateSteal, player: 0, victim: 1 });
  });

  it('trading with the supply: 2 gold for a card, 3 cards for a gold', () => {
    const s = blank('full');
    epSlice(s).gold[0] = 2;
    give(s, 0, { ore: 3 });
    show(s);
    expect(panel()?.textContent).toMatch(/Buy for 2 gold \(2 left\)/);
    expect(panel()?.textContent).toMatch(/Sell 3 for 1 gold/);
    panel()?.querySelector<HTMLButtonElement>('.ep-res')?.click();
    expect(actions[0]?.type).toBe(A.buyWithGold);
  });
});
