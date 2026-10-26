// @vitest-environment jsdom
/** Setup screen + HUD for the V1 variants. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createGame, EVENT_CARDS, legalActions, type Action, type GameState } from '../engine';
import { FIXTURE_PLAYERS, midGame } from '../engine/fixtures';
import { Hud } from './hud';
import {
  buildConfig,
  buildVariants,
  clockLabel,
  defaultSetup,
  RUSH_DISCARD_LIMIT,
  sanitizeSetup,
  setClockPreset,
  setPlayerCount,
  setTimerIdx,
  toggle,
  type SetupStorage,
} from './setup/model';
import { SetupScreen } from './setup/screen';
import type { NewGameConfig } from './types';

describe('setup model: variants', () => {
  it('the default draft builds no variants (official rules)', () => {
    expect(buildVariants(defaultSetup())).toBeUndefined();
    expect('variants' in buildConfig(defaultSetup())).toBe(false);
  });

  it('Event Cards and Balanced Dice exclude each other', () => {
    let d = toggle(defaultSetup(), 'balancedDice');
    d = toggle(d, 'eventCards');
    expect([d.balancedDice, d.eventCards]).toEqual([false, true]);
    d = toggle(d, 'balancedDice');
    expect([d.balancedDice, d.eventCards]).toEqual([true, false]);
  });

  it('Rush applies the Colonist Rush defaults (discard 9, friendly robber)', () => {
    const d = toggle(defaultSetup(), 'rushMode');
    expect(d.discardLimit).toBe(RUSH_DISCARD_LIMIT);
    expect(d.robberMode).toBe('friendly');
    expect(buildConfig(d).variants).toEqual({ robberMode: 'friendly', rushMode: true });
  });

  it('Second Settler needs 4+ players and turns off below that', () => {
    let d = toggle(defaultSetup(4), 'secondSettler');
    expect(d.secondSettler).toBe(true);
    d = setPlayerCount(d, 3);
    expect(d.secondSettler).toBe(false);
    expect(toggle(d, 'secondSettler').secondSettler).toBe(false);
  });

  it('chess clock and per-turn timer are exclusive; presets map to bank + increment', () => {
    let d = setTimerIdx(defaultSetup(), 3);
    d = setClockPreset(d, 'classic');
    expect(d.timerIdx).toBe(0);
    expect(clockLabel(d)).toBe('20m + 30s');
    const cfg = buildConfig(d);
    expect(cfg.turnTimerSec).toBeNull();
    expect(cfg.variants?.timer).toEqual({ preset: 'classic', bankSec: 1200, incrementSec: 30 });
    d = setTimerIdx(d, 2);
    expect(d.clockPreset).toBe('off');
    const custom = {
      ...setClockPreset(defaultSetup(), 'custom'),
      customBankMin: 8,
      customIncrementSec: 12,
    };
    expect(buildConfig(custom).variants?.timer).toEqual({
      preset: 'custom',
      bankSec: 480,
      incrementSec: 12,
    });
  });

  it('every built variant config is accepted by createGame', () => {
    let d = defaultSetup(4);
    for (const k of [
      'eventCards',
      'rushMode',
      'turboMode',
      'secondSettler',
      'randomTurnOrder',
    ] as const) {
      d = toggle(d, k);
    }
    d = {
      ...setClockPreset(d, 'blitz'),
      mapSelection: 'veto',
      robberMode: 'none',
      setupPlacement: {
        first: { building: 'city', restriction: 'anyVertex' },
        second: { building: 'settlement', restriction: 'normal' },
      },
    };
    const cfg = buildConfig(d);
    const s = createGame({
      seed: 1,
      players: cfg.players,
      map: cfg.map,
      ...cfg.variants,
    });
    expect(s.phase.kind).toBe('mapVeto');
  });

  it('old stored drafts (no variant fields) load with the defaults; junk is dropped', () => {
    const old = sanitizeSetup({ map: 'base', seats: [], timerIdx: 2 });
    expect(buildVariants(old)).toBeUndefined();
    const junk = sanitizeSetup({
      robberMode: 'evil',
      clockPreset: 'forever',
      setupPlacement: { first: { building: 'castle' } },
      customBankMin: 99999,
      eventCards: true,
      balancedDice: true,
    });
    expect(junk.robberMode).toBe('normal');
    expect(junk.clockPreset).toBe('off');
    expect(junk.setupPlacement.first.building).toBe('settlement');
    expect(junk.customBankMin).toBe(180);
    expect(junk.eventCards).toBe(false);
  });
});

class MemoryStorage implements SetupStorage {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

describe('setup screen: variant controls', () => {
  let started: NewGameConfig[];
  let screen: SetupScreen;
  const q = <T extends HTMLElement>(sel: string) => screen.element.querySelector<T>(sel)!;
  const pick = (k: string, v: string) => {
    const el = q<HTMLSelectElement>(`select[data-k="${k}"]`);
    el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  beforeEach(() => {
    document.body.replaceChildren();
    started = [];
    screen = new SetupScreen({ onStart: (c) => started.push(c), storage: new MemoryStorage() });
    document.body.append(screen.element);
  });

  it('has every control, defaulting to the official rules', () => {
    for (const k of [
      'robber',
      'clock',
      'mapSelection',
      'setup-first-building',
      'setup-first-restriction',
      'setup-second-building',
      'setup-second-restriction',
    ]) {
      expect(q(`select[data-k="${k}"]`)).toBeTruthy();
    }
    expect(q<HTMLSelectElement>('select[data-k="robber"]').value).toBe('normal');
    for (const k of ['eventCards', 'rushMode', 'turboMode', 'randomTurnOrder', 'secondSettler']) {
      expect(q(`[data-k="rule-${k}"]`).getAttribute('aria-pressed')).toBe('false');
    }
    q('[data-k="start"]').click();
    expect(started[0]!.variants).toBeUndefined();
  });

  it('emits the chosen variants', () => {
    pick('robber', 'friendly');
    pick('mapSelection', 'veto');
    pick('setup-second-building', 'city');
    pick('clock', 'custom');
    const bank = q<HTMLInputElement>('input[data-k="clock-bank"]');
    bank.value = '5';
    bank.dispatchEvent(new Event('change', { bubbles: true }));
    q('[data-k="rule-eventCards"]').click();
    q('[data-k="rule-randomTurnOrder"]').click();
    q('[data-k="start"]').click();
    expect(started[0]!.variants).toEqual({
      robberMode: 'friendly',
      eventCards: true,
      randomTurnOrder: true,
      mapSelection: 'veto',
      setupPlacement: {
        first: { building: 'settlement', restriction: 'normal' },
        second: { building: 'city', restriction: 'normal' },
      },
      timer: { preset: 'custom', bankSec: 300, incrementSec: 20 },
    });
  });
});

describe('HUD: variant dialogs', () => {
  let root: HTMLElement;
  let hud: Hud;
  let actions: Action[];
  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.append(root);
    hud = new Hud(root);
    actions = [];
    hud.on('action', (a) => actions.push(a));
  });
  const buttons = () => [...root.querySelectorAll('button')];

  it('map veto: the vetoer sees the candidates and vetoes one', () => {
    const s = createGame({
      seed: 3,
      players: FIXTURE_PLAYERS,
      mapSelection: 'veto',
      startingPlayer: 0,
    });
    hud.render(s, { viewer: 3, legal: legalActions(s), isBotTurn: false });
    const maps = [...root.querySelectorAll<HTMLButtonElement>('.veto-map')];
    expect(maps).toHaveLength(3);
    maps[1]!.click();
    expect(actions).toEqual([{ type: 'vetoMap', player: 3, candidate: 1 }]);
  });

  /** midGame with an event phase for `kind`, Blue drew it. */
  function eventState(event: 'plentifulYear' | 'tradeAdvantage'): GameState {
    const s = midGame();
    s.settings = { ...s.settings, eventCards: true };
    s.eventDeck = [];
    s.lastEvent = event;
    s.damagedRoads = [null, null, null, null];
    s.phase = {
      kind: 'event',
      event,
      tasks:
        event === 'plentifulYear'
          ? [{ player: 1, kind: 'gain', targets: [], optional: false }]
          : [{ player: 1, kind: 'steal', targets: [0, 3], optional: true }],
    };
    return s;
  }

  it('event gain: a resource picker sends eventGain', () => {
    const s = eventState('plentifulYear');
    hud.render(s, { viewer: 1, legal: legalActions(s), isBotTurn: false });
    expect(root.textContent).toContain('Plentiful Year');
    const ore = [...root.querySelectorAll<HTMLButtonElement>('.rpick-btn')].find((b) =>
      b.textContent?.includes('Ore'),
    )!;
    ore.click();
    expect(actions).toEqual([{ type: 'eventGain', player: 1, resource: 'ore' }]);
  });

  it('optional event steal offers "Take nothing"', () => {
    const s = eventState('tradeAdvantage');
    hud.render(s, { viewer: 1, legal: legalActions(s), isBotTurn: false });
    buttons()
      .find((b) => b.textContent === 'Take nothing')!
      .click();
    expect(actions).toEqual([{ type: 'eventSteal', player: 1, victim: null }]);
  });

  it('shows the last event under the dice', () => {
    const s = eventState('plentifulYear');
    s.phase = { kind: 'main' };
    s.dice = [1, 1];
    hud.render(s, { viewer: 1, legal: legalActions(s), isBotTurn: false });
    expect(root.querySelector('.dice-event')?.textContent).toBe('Plentiful Year');
    expect(EVENT_CARDS.length).toBe(36);
  });
});
