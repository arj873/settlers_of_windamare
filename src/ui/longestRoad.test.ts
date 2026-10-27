// @vitest-environment jsdom
/** #51: the "Show longest road on the board" setting, the hover targets and the road count. */
import { beforeEach, describe, expect, it } from 'vitest';
import { midGame } from '../engine/fixtures';
import { mainPhase, seaGame, ship, E, V } from '../expansions/seafarers/engine/testkit';
import { Hud } from './hud';
import { playerSummaries } from './model';

let root: HTMLElement;
let hud: Hud;

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  hud = new Hud(root);
});

const setting = () => root.querySelector('[data-k="longest-road-setting"]');
const segBtn = (label: string) =>
  [...(setting()?.querySelectorAll<HTMLButtonElement>('.seg-btn') ?? [])].find(
    (b) => b.textContent === label,
  );

describe('Show longest road on the board (menu)', () => {
  it('is in the menu once wired, and saves through onChange', () => {
    const changes: boolean[] = [];
    hud.setLongestRoadToggle({ value: false, onChange: (on) => changes.push(on) });
    hud.render(midGame(), { viewer: 1, legal: [], isBotTurn: false });
    root.querySelector<HTMLButtonElement>('.menu-btn')!.click();
    expect(setting()?.textContent).toContain('Show longest road on the board');
    expect(segBtn('Off')!.getAttribute('aria-pressed')).toBe('true');
    segBtn('On')!.click();
    expect(changes).toEqual([true]);
    expect(segBtn('On')!.getAttribute('aria-pressed')).toBe('true');
    segBtn('Off')!.click();
    expect(changes).toEqual([true, false]);
  });

  it('is not shown without a control', () => {
    hud.render(midGame(), { viewer: 1, legal: [], isBotTurn: false });
    root.querySelector<HTMLButtonElement>('.menu-btn')!.click();
    expect(setting()).toBeNull();
  });
});

describe('Longest Road hover targets (player rows)', () => {
  it("only the holder's road count and award badge", () => {
    const s = midGame();
    const holder = s.awards.longestRoad;
    expect(holder).not.toBeNull();
    hud.render(s, { viewer: 1, legal: [], isBotTurn: false });
    const targets = [...root.querySelectorAll<HTMLElement>('[data-longest-road]')];
    expect(targets).toHaveLength(2);
    const rows = [...root.querySelectorAll('.hud-players .pp')];
    for (const t of targets) expect(rows.indexOf(t.closest('.pp')!)).toBe(holder);
  });

  it('none while nobody holds the award', () => {
    const s = midGame();
    s.awards.longestRoad = null;
    hud.render(s, { viewer: 1, legal: [], isBotTurn: false });
    expect(root.querySelector('[data-longest-road]')).toBeNull();
  });
});

describe('road count in the player row', () => {
  it('Seafarers: counts the trade route, ships included', () => {
    const s = mainPhase(seaGame('newShores', 4));
    s.pieces.buildings[V(2, 8, 'SW')] = { owner: 0, kind: 'settlement' };
    s.pieces.roads[E(2, 8, 'SW')] = 0;
    ship(s, 0, E(2, 8, 'S'), E(3, 9, 'SW'));
    expect(playerSummaries(s, 0)[0]?.roadLength).toBe(3);
  });
});
