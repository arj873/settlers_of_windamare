// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { legalActions, type Action } from '../engine';
import { midGame } from '../engine/fixtures';
import { newGame } from '../bots/runner';
import { Hud } from './hud';
import { SpotPrompt, spotChoice } from './spotPrompt';

const s = midGame();
const road = legalActions(s, 1).find((a) => a.type === 'buildRoad') ?? {
  type: 'buildRoad',
  player: 1,
  edge: 'e:0,0,NE',
};
const ship = { type: 'seafarers/buildShip', player: 1, edge: 'e:0,0,NE' } as unknown as Action;
const city = { type: 'buildCity', player: 1, vertex: 'v:0,0,N' } as Action;

let layer: HTMLElement;
let prompt: SpotPrompt;
let picked: Action[];
let cancelled: number;

beforeEach(() => {
  document.body.replaceChildren();
  layer = document.createElement('div');
  document.body.append(layer);
  prompt = new SpotPrompt(layer);
  picked = [];
  cancelled = 0;
});

const open = (choices: Action[]) =>
  prompt.show({
    state: s,
    choices,
    at: { x: 200, y: 300 },
    color: '#3060c0',
    onPick: (a) => picked.push(a),
    onCancel: () => cancelled++,
  });
const box = () => layer.querySelector<HTMLElement>('.spot-prompt');
const button = (k: string) => [...layer.querySelectorAll<HTMLButtonElement>(`[data-k="${k}"]`)];

describe('spotChoice', () => {
  it('names base builds with their cost', () => {
    expect(spotChoice(s, road as Action)).toMatchObject({
      label: 'Road',
      cost: { brick: 1, lumber: 1, wool: 0, grain: 0, ore: 0 },
      free: false,
      glyph: 'road',
    });
    expect(spotChoice(s, city)).toMatchObject({ label: 'City', cost: { grain: 2, ore: 3 } });
  });

  it('names module builds from their build card; free pieces have no cost', () => {
    const sea = newGame({ seed: 1, players: 3, mode: 'seafarers' });
    expect(spotChoice(sea, ship)).toMatchObject({ label: 'Ship', glyph: 'ship', free: false });
    expect(spotChoice(sea, ship).cost).toMatchObject({ lumber: 1, wool: 1 });
    const setupShip = { type: 'seafarers/placeSetupShip', player: 1, edge: 'e:0,0,NE' };
    expect(spotChoice(s, setupShip as unknown as Action)).toMatchObject({
      label: 'Ship',
      cost: null,
      free: true,
    });
    expect(
      spotChoice(s, { type: 'placeFreeRoad', player: 1, edge: 'e:0,0,NE' } as Action),
    ).toMatchObject({ label: 'Road', cost: null, free: true });
  });

  it('falls back to the action name', () => {
    const other = { type: 'ck/activateKnight', player: 1, vertex: 'v:0,0,N' } as unknown as Action;
    expect(spotChoice(s, other)).toMatchObject({ label: 'Activate knight', cost: null });
  });
});

describe('SpotPrompt', () => {
  it('one choice: label, cost cards, Cancel and Build; Build submits', () => {
    open([road as Action]);
    expect(prompt.isOpen).toBe(true);
    expect(box()?.textContent).toContain('Road');
    expect(box()?.querySelectorAll('.spot-cost > *').length).toBe(2);
    const [build] = button('spot-build');
    expect(build?.textContent).toBe('Build');
    expect(document.activeElement).toBe(build);
    build!.click();
    expect(picked).toEqual([road]);
    expect(cancelled).toBe(0);
    expect(box()).toBeNull();
  });

  it('several choices: one button per choice', () => {
    open([road as Action, ship]);
    const builds = button('spot-build');
    expect(builds.map((b) => b.getAttribute('data-action'))).toEqual([
      'buildRoad',
      'seafarers/buildShip',
    ]);
    expect(builds[1]?.textContent).toContain('Ship');
    builds[1]!.click();
    expect(picked).toEqual([ship]);
  });

  it('Cancel, Esc and a press elsewhere cancel', () => {
    open([road as Action]);
    button('spot-cancel')[0]!.click();
    expect(cancelled).toBe(1);
    expect(box()).toBeNull();

    open([road as Action]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancelled).toBe(2);
    expect(box()).toBeNull();

    open([road as Action]);
    box()!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(cancelled).toBe(2); // inside: stays open
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(cancelled).toBe(3);
    expect(picked).toEqual([]);
  });

  it('hide closes without a callback and removes the listeners', () => {
    open([road as Action]);
    prompt.hide();
    expect(box()).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancelled).toBe(0);
  });

  it('is placed next to the spot inside the window', () => {
    open([road as Action]);
    const el = box()!;
    expect(el.style.left).toMatch(/px$/);
    expect(el.style.top).toMatch(/px$/);
    expect(parseFloat(el.style.left)).toBeGreaterThanOrEqual(8);
  });
});

describe('Hud: Confirm before building setting', () => {
  it('shows On / Off in the menu and reports changes', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const hud = new Hud(root);
    const changes: boolean[] = [];
    hud.setBuildConfirm({ value: true, onChange: (on) => changes.push(on) });
    hud.render(s, { viewer: 1, legal: legalActions(s, 1), isBotTurn: false });
    root.querySelector<HTMLButtonElement>('.menu-btn')!.click();
    expect(root.textContent).toContain('Confirm before building');
    const on = () => root.querySelector<HTMLButtonElement>('[data-k="confirm-on"]')!;
    const off = () => root.querySelector<HTMLButtonElement>('[data-k="confirm-off"]')!;
    expect(on().classList.contains('is-on')).toBe(true);
    off().click();
    expect(changes).toEqual([false]);
    expect(off().classList.contains('is-on')).toBe(true);
    hud.destroy();
  });
});
