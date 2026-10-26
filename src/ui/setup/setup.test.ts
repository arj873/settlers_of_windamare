// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { NewGameConfig } from '../types';
import {
  addSeat,
  buildConfig,
  defaultSetup,
  loadSetup,
  mapDisabledReason,
  MAPS,
  MAX_PLAYERS,
  pickSeatColor,
  removeSeat,
  saveSetup,
  SEAT_COLORS,
  setMap,
  setPlayerCount,
  STORAGE_KEY,
  TIMER_STEPS,
  timerLabel,
  type SetupStorage,
} from './model';
import { MAPS as ENGINE_MAPS, beginnerBoard, topologyFor } from '../../engine';
import { mapPreviewSvg, previewBoard, previewHexes } from './mapPreviews';
import { SetupScreen } from './screen';

class MemoryStorage implements SetupStorage {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

const throwing: SetupStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('defaults', () => {
  it('builds the documented default config', () => {
    const cfg = buildConfig(defaultSetup());
    expect(cfg).toEqual({
      mode: 'base',
      map: 'base',
      players: [
        { name: 'You', color: '#d64541', controller: 'human' },
        { name: 'Blue', color: '#3a7bd5', controller: 'bot' },
        { name: 'White', color: '#ecf0f1', controller: 'bot' },
        { name: 'Orange', color: '#f39c12', controller: 'bot' },
      ],
      rules: { balancedDice: false, hideBankCards: false },
      turnTimerSec: null,
      vpToWin: 10,
      discardLimit: 7,
    });
    expect('seed' in cfg).toBe(false);
  });

  it('trims names, fills blanks, dedupes, keeps a trimmed seed', () => {
    const d = defaultSetup();
    d.seats[0]!.name = '  Ann ';
    d.seats[1]!.name = 'ann';
    d.seats[2]!.name = '';
    d.seed = ' abc ';
    const cfg = buildConfig(d);
    expect(cfg.players.map((p) => p.name)).toEqual(['Ann', 'ann 2', 'Player 3', 'Orange']);
    expect(cfg.seed).toBe('abc');
  });

  it('maps the timer steps to seconds', () => {
    const d = { ...defaultSetup(), timerIdx: 3 };
    expect(buildConfig(d).turnTimerSec).toBe(60);
    expect(TIMER_STEPS).toEqual([null, 30, 45, 60, 90, 120, 180, 300]);
    expect(timerLabel(0)).toBe('Off');
    expect(timerLabel(1)).toBe('30s');
    expect(timerLabel(7)).toBe('5 min');
  });
});

describe('player / map coupling', () => {
  it('growing past the map picks the smallest map that fits', () => {
    const d = defaultSetup();
    expect(setPlayerCount(d, 5).map).toBe('base56');
    expect(setPlayerCount(d, 6).map).toBe('base56');
    expect(setPlayerCount(d, 7).map).toBe('base78');
    expect(setPlayerCount(d, 8).map).toBe('base78');
    expect(setPlayerCount({ ...d, map: 'baseRandom' }, 5).map).toBe('base56');
  });

  it('addSeat appends a human with an unused colour, switches map, stops at the maximum', () => {
    let d = defaultSetup();
    d = addSeat(d);
    expect(d.seats).toHaveLength(5);
    expect(d.seats[4]?.controller).toBe('human');
    expect(d.map).toBe('base56');
    expect(new Set(d.seats.map((s) => s.color)).size).toBe(5);
    while (d.seats.length < MAX_PLAYERS) d = addSeat(d);
    expect(d.map).toBe('base78');
    expect(addSeat(d)).toBe(d);
  });

  it('removeSeat removes that seat, keeps the others intact, stops at the minimum', () => {
    const d = setPlayerCount(defaultSetup(), 6);
    const r = removeSeat(d, 1);
    expect(r.seats).toHaveLength(5);
    expect(r.seats.map((s) => s.name)).toEqual(
      d.seats.filter((_, i) => i !== 1).map((s) => s.name),
    );
    expect(r.seats.map((s) => s.color)).toEqual(
      d.seats.filter((_, i) => i !== 1).map((s) => s.color),
    );
    expect(new Set(r.seats.map((s) => s.color)).size).toBe(5);
    expect(r.map).toBe('base56');
    expect(removeSeat(d, -1)).toBe(d);
    expect(removeSeat(d, 6)).toBe(d);
    expect(removeSeat(defaultSetup(3), 0)).toEqual(defaultSetup(3));
  });

  it('removing then re-adding reuses the freed colour', () => {
    const d = defaultSetup(4);
    const freed = d.seats[1]?.color;
    expect(addSeat(removeSeat(d, 1)).seats[3]?.color).toBe(freed);
  });

  it('keeps a bigger map when shrinking', () => {
    const d = setPlayerCount(defaultSetup(), 8);
    const s = setPlayerCount(d, 6);
    expect(s.map).toBe('base78');
    expect(s.seats).toHaveLength(6);
  });

  it('picking a map clamps players into its range', () => {
    const d = defaultSetup();
    expect(setMap(d, 'base56').seats).toHaveLength(5);
    expect(setMap(d, 'base78').seats).toHaveLength(7);
    const eight = setPlayerCount(d, 8);
    expect(setMap(eight, 'base').seats).toHaveLength(4);
    expect(setMap(eight, 'base56').seats).toHaveLength(6);
    expect(setMap(eight, 'base56').map).toBe('base56');
  });

  it('disables maps that are too small, with a reason', () => {
    expect(mapDisabledReason('base', 4)).toBeNull();
    expect(mapDisabledReason('base', 5)).toMatch(/Up to 4/);
    expect(mapDisabledReason('base56', 7)).toMatch(/Up to 6/);
    expect(mapDisabledReason('base78', 8)).toBeNull();
  });

  it('clamps the player count to 3..8', () => {
    const d = defaultSetup();
    expect(setPlayerCount(d, 1).seats).toHaveLength(3);
    expect(setPlayerCount(d, 99).seats).toHaveLength(8);
  });
});

describe('seats', () => {
  it('keeps colours unique at every size', () => {
    for (let n = 3; n <= 8; n++) {
      const d = setPlayerCount(defaultSetup(), n);
      expect(new Set(d.seats.map((s) => s.color)).size).toBe(n);
    }
    expect(SEAT_COLORS).toHaveLength(8);
    expect(new Set(SEAT_COLORS.map((c) => c.color)).size).toBe(8);
  });

  it('swaps colours so none repeat', () => {
    const d = setPlayerCount(defaultSetup(), 8);
    const swapped = pickSeatColor(d, 0, d.seats[5]!.color);
    expect(swapped.seats[0]!.color).toBe(d.seats[5]!.color);
    expect(swapped.seats[5]!.color).toBe(d.seats[0]!.color);
    expect(new Set(swapped.seats.map((s) => s.color)).size).toBe(8);
    expect(pickSeatColor(d, 0, '#123456')).toBe(d);
  });

  it('seat 1 is the human "You", the rest bots', () => {
    const d = setPlayerCount(defaultSetup(), 8);
    expect(d.seats[0]).toMatchObject({ name: 'You', controller: 'human' });
    expect(d.seats.slice(1).every((s) => s.controller === 'bot')).toBe(true);
  });
});

describe('persistence', () => {
  it('round-trips settings (except the seed)', () => {
    const st = new MemoryStorage();
    let d = setMap(defaultSetup(), 'base56');
    d = { ...d, balancedDice: true, timerIdx: 4, vpToWin: 12, discardLimit: 9, seed: 'x' };
    saveSetup(st, d);
    const back = loadSetup(st);
    expect(back).toEqual({ ...d, seed: '' });
  });

  it('falls back to defaults on corrupt or hostile storage', () => {
    const st = new MemoryStorage();
    st.setItem(STORAGE_KEY, '{not json');
    expect(loadSetup(st)).toEqual(defaultSetup());
    st.setItem(STORAGE_KEY, '42');
    expect(loadSetup(st)).toEqual(defaultSetup());
    expect(loadSetup(throwing)).toEqual(defaultSetup());
    expect(() => saveSetup(throwing, defaultSetup())).not.toThrow();
    expect(loadSetup(null)).toEqual(defaultSetup());
  });

  it('repairs out-of-range and inconsistent stored values', () => {
    const st = new MemoryStorage();
    st.setItem(
      STORAGE_KEY,
      JSON.stringify({
        map: 'nope',
        vpToWin: 99,
        discardLimit: -4,
        timerIdx: 'x',
        balancedDice: 'yes',
        seats: [
          { name: 'A', color: '#d64541', controller: 'bot' },
          { name: 'B', color: '#d64541', controller: 'human' },
          { name: 42, color: 'red', controller: 'robot' },
          ...Array.from({ length: 4 }, () => ({ name: 'Z', color: '#3a7bd5', controller: 'bot' })),
        ],
      }),
    );
    const d = loadSetup(st);
    expect(d.map).toBe('base78'); // 7 seats; unknown map fell back to base, then grew
    expect(d.seats).toHaveLength(7);
    expect(d.vpToWin).toBe(20);
    expect(d.discardLimit).toBe(5);
    expect(d.timerIdx).toBe(0);
    expect(d.balancedDice).toBe(false);
    expect(new Set(d.seats.map((s) => s.color)).size).toBe(7);
    expect(d.seats.every((s) => SEAT_COLORS.some((c) => c.color === s.color))).toBe(true);
    expect(d.seats.map((s) => s.controller)).toEqual(['bot', 'human', ...Array(5).fill('bot')]);
  });

  it('corrects a stored map that is too small for the stored seats', () => {
    const st = new MemoryStorage();
    const d = setPlayerCount(defaultSetup(), 6);
    saveSetup(st, { ...d, map: 'base' });
    expect(loadSetup(st).map).toBe('base56');
  });
});

describe('map previews', () => {
  it('has the documented hex counts', () => {
    expect(previewHexes('base')).toHaveLength(19);
    expect(previewHexes('baseRandom')).toHaveLength(19);
    expect(previewHexes('base56')).toHaveLength(30);
    expect(previewHexes('base78')).toHaveLength(37);
    for (const m of MAPS) {
      const keys = previewHexes(m.id).map((h) => `${h.q},${h.r}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('matches the engine boards: same hexes, terrain mix and harbors', () => {
    for (const m of MAPS) {
      const topo = topologyFor(m.id);
      expect(previewHexes(m.id).map((h) => `h:${h.q},${h.r}`)).toEqual(topo.landHexes);
      const board = previewBoard(m.id);
      expect(board.water).toHaveLength(topo.waterHexes.length);
      expect(board.harbors).toHaveLength(ENGINE_MAPS[m.id].harbors.length);
      const deserts = board.land.filter((h) => h.terrain === 'desert').length;
      expect(deserts).toBe(ENGINE_MAPS[m.id].terrain.desert);
    }
    // The beginner map shows its real, fixed layout.
    const beginner = beginnerBoard().board.hexes;
    for (const h of previewBoard('base').land) {
      expect(h.terrain).toBe(beginner[`h:${h.q},${h.r}`]?.terrain);
    }
  });

  it('draws one polygon per land and water hex, one dot per harbor', () => {
    const svg = mapPreviewSvg('base56');
    expect(svg.querySelectorAll('polygon')).toHaveLength(30 + 22);
    expect(svg.querySelectorAll('circle')).toHaveLength(11);
  });
});

describe('SetupScreen', () => {
  let st: MemoryStorage;
  let started: NewGameConfig[];
  let screen: SetupScreen;
  const q = <T extends HTMLElement>(sel: string) => screen.element.querySelector<T>(sel)!;
  const click = (k: string) => q(`[data-k="${k}"]`).click();
  const slide = (k: string, v: number) => {
    const el = q<HTMLInputElement>(`input[data-k="${k}"]`);
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const out = (k: string) => q(`[data-v="${k}"]`).textContent;

  beforeEach(() => {
    document.body.replaceChildren();
    st = new MemoryStorage();
    started = [];
    screen = new SetupScreen({ onStart: (c) => started.push(c), storage: st });
    document.body.append(screen.element);
  });

  it('renders the sections, 4 seats and only a Base mode tile', () => {
    const titles = [...screen.element.querySelectorAll('h2')].map((h) => h.textContent);
    expect(titles).toEqual(['Game mode', 'Map', 'Rules', 'Advanced settings', 'Seats']);
    expect(screen.element.querySelectorAll('.su-seat')).toHaveLength(4);
    expect(screen.element.querySelectorAll('[data-k^="mode-"]')).toHaveLength(1);
    expect(screen.element.querySelectorAll('.su-map')).toHaveLength(4);
    expect(screen.element.textContent).toContain('3–4 players');
    expect(screen.element.textContent).toContain('7–8 players');
  });

  it('emits the default config on Start', () => {
    click('start');
    expect(started).toHaveLength(1);
    expect(started[0]).toEqual(buildConfig(defaultSetup()));
  });

  it('couples the Players stepper and the maps', () => {
    click('players-inc'); // 5
    expect(out('players')).toBe('5');
    expect(q<HTMLButtonElement>('[data-k="map-base"]').disabled).toBe(true);
    expect(q('[data-k="map-base"]').textContent).toContain('Up to 4');
    expect(q('[data-k="map-base56"]').getAttribute('aria-pressed')).toBe('true');
    expect(q<HTMLButtonElement>('[data-k="map-base78"]').disabled).toBe(false);
    click('map-base78');
    expect(out('players')).toBe('7');
    expect(screen.element.querySelectorAll('.su-seat')).toHaveLength(7);
    click('start');
    expect(started[0]!.map).toBe('base78');
    expect(started[0]!.players).toHaveLength(7);
  });

  it('stepper bounds disable the buttons', () => {
    for (let i = 0; i < 10; i++) click('players-inc');
    expect(out('players')).toBe('8');
    expect(q<HTMLButtonElement>('[data-k="players-inc"]').disabled).toBe(true);
    for (let i = 0; i < 10; i++) click('players-dec');
    expect(out('players')).toBe('3');
    expect(q<HTMLButtonElement>('[data-k="players-dec"]').disabled).toBe(true);

    expect(q<HTMLButtonElement>('[data-k="timer-dec"]').disabled).toBe(true);
    for (let i = 0; i < 10; i++) click('timer-inc');
    expect(out('timer')).toBe('5 min');
    expect(q<HTMLButtonElement>('[data-k="timer-inc"]').disabled).toBe(true);
    click('start');
    expect(started[0]!.turnTimerSec).toBe(300);
  });

  it('sliders have the documented bounds and defaults', () => {
    const vp = q<HTMLInputElement>('input[data-k="vp"]');
    const dl = q<HTMLInputElement>('input[data-k="discard"]');
    expect([vp.min, vp.max, vp.value]).toEqual(['3', '20', '10']);
    expect([dl.min, dl.max, dl.value]).toEqual(['5', '20', '7']);
    slide('vp', 14);
    slide('discard', 12);
    expect(out('vp')).toBe('14');
    click('start');
    expect(started[0]).toMatchObject({ vpToWin: 14, discardLimit: 12 });
  });

  it('toggles rules and edits seats', () => {
    click('rule-balancedDice');
    expect(q('[data-k="rule-balancedDice"]').getAttribute('aria-pressed')).toBe('true');
    click('ctl-1-human');
    click('color-0-Pink');
    const name = q<HTMLInputElement>('[data-k="name-2"]');
    name.value = 'Zed';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    click('start');
    const cfg = started[0]!;
    expect(cfg.rules).toEqual({ balancedDice: true, hideBankCards: false });
    expect(cfg.players[1]!.controller).toBe('human');
    expect(cfg.players[0]!.color).toBe('#ec7fb5');
    expect(cfg.players[2]!.name).toBe('Zed');
    expect(new Set(cfg.players.map((p) => p.color)).size).toBe(4);
  });

  it('keeps the typed name when other controls re-render', () => {
    const name = q<HTMLInputElement>('[data-k="name-0"]');
    name.value = 'Ann';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    click('players-inc');
    expect(q<HTMLInputElement>('[data-k="name-0"]').value).toBe('Ann');
  });

  it('takes an optional seed', () => {
    const seed = q<HTMLInputElement>('input[data-k="seed"]');
    seed.value = ' hello ';
    seed.dispatchEvent(new Event('input', { bubbles: true }));
    click('start');
    expect(started[0]!.seed).toBe('hello');
  });

  it('restores the last-used settings, including after corrupt storage', () => {
    click('map-base56');
    click('rule-hideBankCards');
    slide('vp', 8);
    const again = new SetupScreen({ onStart: () => undefined, storage: st });
    expect(again.state.map).toBe('base56');
    expect(again.state.seats).toHaveLength(5);
    expect(again.state.hideBankCards).toBe(true);
    expect(again.state.vpToWin).toBe(8);

    st.setItem(STORAGE_KEY, 'garbage');
    expect(new SetupScreen({ onStart: () => undefined, storage: st }).state).toEqual(
      defaultSetup(),
    );
    expect(new SetupScreen({ onStart: () => undefined, storage: throwing }).state).toEqual(
      defaultSetup(),
    );
  });

  it('adds and removes seats from the Seats list and keeps the stepper in sync', () => {
    const seats = () => screen.element.querySelectorAll('.su-seat').length;
    click('add-seat');
    expect(seats()).toBe(5);
    expect(out('players')).toBe('5');
    expect(screen.state.map).toBe('base56');
    q<HTMLInputElement>('[data-k="name-1"]').value = 'Keep';
    q<HTMLInputElement>('[data-k="name-1"]').dispatchEvent(new Event('input', { bubbles: true }));
    click('remove-0');
    expect(seats()).toBe(4);
    expect(out('players')).toBe('4');
    expect(q<HTMLInputElement>('[data-k="name-0"]').value).toBe('Keep');
    expect(q<HTMLButtonElement>('[data-k="remove-0"]').disabled).toBe(false);
    click('remove-0');
    click('remove-0');
    expect(seats()).toBe(3);
    expect(q<HTMLButtonElement>('[data-k="remove-0"]').disabled).toBe(true);
    for (let i = 0; i < 5; i++) click('add-seat');
    expect(seats()).toBe(8);
    expect(q<HTMLButtonElement>('[data-k="add-seat"]').disabled).toBe(true);
  });

  it('shows Back only when there is a game to return to', () => {
    expect(screen.element.textContent).not.toContain('Back to game');
    let back = 0;
    const s = new SetupScreen({ onStart: () => undefined, onBack: () => back++, storage: st });
    [...s.element.querySelectorAll('button')]
      .find((b) => b.textContent === 'Back to game')!
      .click();
    expect(back).toBe(1);
  });
});
