/** Controller + timer behaviour of the V1 variants (seat shuffle, chess clock, events, veto). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EVENT_CARDS,
  legalActions,
  randomSeatOrder,
  timerSettings,
  type GameState,
} from '../engine';
import { midGame } from '../engine/fixtures';
import type { BoardEvents } from '../render';
import type { HudEvents, HudView, NewGameConfig } from '../ui';
import { GameController, type BoardLike, type HudLike } from './controller';
import { boardActions, nextBot, obligated, pickViewer } from './logic';
import { SAVE_KEY, loadSession, type KeyValueStore } from './persist';
import { IDLE_CLOCK, flushBank, syncBankClock, timeoutMove, timerSlot } from './turnTimer';
import { Rng } from '../engine';

class FakeBoard implements BoardLike {
  render(): void {}
  setHighlights(): void {}
  on<K extends keyof BoardEvents>(_t: K, _cb: (p: BoardEvents[K]) => void): () => void {
    return () => undefined;
  }
}

class FakeHud implements HudLike {
  views: HudView[] = [];
  timers: HudView['turnTimer'][] = [];
  private handlers: { [E in keyof HudEvents]?: ((p: HudEvents[E]) => void)[] } = {};
  render(_s: GameState, view: HudView): void {
    this.views.push(view);
  }
  isCovered(): boolean {
    return false;
  }
  setTurnTimer(t: HudView['turnTimer']): void {
    this.timers.push(t);
  }
  on<E extends keyof HudEvents>(event: E, cb: (p: HudEvents[E]) => void): void {
    const list = (this.handlers[event] ?? []) as ((p: HudEvents[E]) => void)[];
    list.push(cb);
    (this.handlers as Record<string, unknown>)[event] = list;
  }
  emit<E extends keyof HudEvents>(event: E, payload: HudEvents[E]): void {
    for (const cb of (this.handlers[event] ?? []) as ((p: HudEvents[E]) => void)[]) cb(payload);
  }
  get last(): HudView {
    return this.views[this.views.length - 1]!;
  }
}

class MemoryStore implements KeyValueStore {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

let hud: FakeHud;
let store: MemoryStore;
let toasts: string[];
const make = (speed = 500) =>
  new GameController({
    board: new FakeBoard(),
    hud,
    storage: store,
    speed,
    toast: (m) => toasts.push(m),
  });

beforeEach(() => {
  hud = new FakeHud();
  store = new MemoryStore();
  toasts = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const humans4 = ['human', 'human', 'human', 'human'] as const;

const config = (variants: NewGameConfig['variants']): NewGameConfig => ({
  mode: 'base',
  map: 'base',
  rules: { balancedDice: false, hideBankCards: false },
  turnTimerSec: null,
  vpToWin: 10,
  discardLimit: 7,
  players: [
    { name: 'Ann', color: '#d64541', controller: 'human' },
    { name: 'B1', color: '#3a7bd5', controller: 'bot' },
    { name: 'B2', color: '#ecf0f1', controller: 'bot' },
    { name: 'B3', color: '#f39c12', controller: 'bot' },
  ],
  seed: 'seat-test',
  ...(variants ? { variants } : {}),
});

describe('newGame with variants', () => {
  it('passes the variants to the engine', () => {
    const c = make();
    hud.emit('newGame', config({ robberMode: 'friendly', eventCards: true, turboMode: true }));
    expect(c.state?.settings).toMatchObject({
      robberMode: 'friendly',
      eventCards: true,
      turboMode: true,
    });
  });

  it('Randomize Turn Order: each seat keeps its own controller after the shuffle', () => {
    const c = make();
    hud.emit('newGame', config({ randomTurnOrder: true }));
    const order = randomSeatOrder('seat-test', 4);
    expect(c.state?.players.map((p) => p.name)).toEqual(
      order.map((i) => ['Ann', 'B1', 'B2', 'B3'][i]),
    );
    const annSeat = c.state!.players.findIndex((p) => p.name === 'Ann');
    expect(c.seats[annSeat]).toBe('human');
    expect(c.seats.filter((s) => s === 'human')).toHaveLength(1);
  });

  it('map veto with bots and one human: the human gets the veto dialog in turn', () => {
    const c = make(0);
    hud.emit('newGame', config({ mapSelection: 'veto' }));
    for (let i = 0; i < 50 && c.state?.phase.kind === 'mapVeto'; i++) {
      const s = c.state;
      if (c.seats[s.turn.current] === 'human') {
        expect(c.viewer).toBe(s.turn.current);
        hud.emit('action', legalActions(s)[0]!);
      } else vi.advanceTimersByTime(20);
    }
    expect(c.state?.phase.kind).toBe('setup');
    expect(toasts).toEqual([]);
  });

  it('plays an all-bot event-card + rush + second-settler game to the end', () => {
    const c = make(0);
    const cfg = config({ eventCards: true, rushMode: true, secondSettler: true });
    hud.emit('newGame', { ...cfg, players: cfg.players.map((p) => ({ ...p, controller: 'bot' })) });
    for (let i = 0; i < 4000 && c.state?.phase.kind !== 'gameOver'; i++) vi.advanceTimersByTime(20);
    expect(c.state?.phase.kind).toBe('gameOver');
    expect(toasts).toEqual([]);
  });
});

describe('event phase in the controller', () => {
  /** midGame, Plentiful Year just drawn: every player owes a choice. */
  function plentiful(): GameState {
    const s = midGame();
    const id = EVENT_CARDS.findIndex((c) => c.event === 'plentifulYear');
    return {
      ...s,
      settings: { ...s.settings, eventCards: true },
      eventDeck: [0, 1, 2, 3, 4, 5],
      lastEvent: 'plentifulYear',
      damagedRoads: [null, null, null, null],
      dice: [1, 1],
      phase: {
        kind: 'event',
        event: EVENT_CARDS[id]!.event,
        tasks: [0, 1, 2, 3].map((player) => ({
          player,
          kind: 'gain',
          targets: [],
          optional: false,
        })),
      },
    };
  }

  it('players with a task owe a response: viewer, bots and timer follow it', () => {
    const s = plentiful();
    expect(obligated(s)).toEqual([1, 2, 3, 0]);
    const legal = legalActions(s);
    expect(pickViewer(s, ['bot', 'bot', 'human', 'bot'], legal, null)).toBe(2);
    expect(nextBot(s, ['bot', 'human', 'human', 'human'], legal)).toEqual({
      player: 0,
      fast: true,
    });
    expect(timerSlot(s, humans4, legal, 3)).toMatchObject({ kind: 'discard', player: 3 });
    const move = timeoutMove(s, legal, 3, new Rng(1));
    expect(move?.type).toBe('eventGain');
  });

  it('Earthquake roads are picked on the board', () => {
    const s = midGame();
    const edge = Object.keys(s.pieces.roads).find((e) => s.pieces.roads[e as never] === 1)!;
    const legal = [{ type: 'eventDamageRoad' as const, player: 1, edge: edge as never }];
    expect(boardActions(legal, 1, null)).toEqual(legal);
  });
});

describe('chess clock', () => {
  const clocked = (s: GameState): GameState => ({
    ...s,
    settings: { ...s.settings, timer: timerSettings('custom', { bankSec: 60, incrementSec: 10 })! },
  });

  it('runs the bank of the human on the clock and credits the increment after the turn', () => {
    const c = make();
    c.start(clocked(midGame()), humans4);
    expect(hud.last.turnTimer).toEqual({ remainingSec: 60, totalSec: 60 });
    vi.advanceTimersByTime(5000);
    hud.emit('action', { type: 'endTurn', player: 1 });
    // White is on the clock with a full bank; Blue banked 55 s + 10 s.
    expect(hud.last.turnTimer).toEqual({ remainingSec: 60, totalSec: 60 });
    const saved = loadSession(store);
    expect(saved?.banks?.[1]).toBeCloseTo(65_000, -3);
    expect(store.map.has(SAVE_KEY)).toBe(true);
  });

  it('resumes the banks from a save', () => {
    const c = make();
    c.start(clocked(midGame()), humans4, { banks: [60_000, 7_000, 60_000, 60_000] });
    expect(hud.last.turnTimer).toEqual({ remainingSec: 7, totalSec: 60 });
  });

  it('an empty bank means timeout moves right away (only the increment comes back)', () => {
    const c = make();
    c.start(
      clocked({ ...midGame(), phase: { kind: 'preRoll' } }),
      ['human', 'human', 'bot', 'bot'],
      {
        banks: [60_000, 0, 60_000, 60_000],
      },
    );
    for (let i = 0; i < 40 && c.state?.turn.current === 1; i++) vi.advanceTimersByTime(250);
    expect(c.state?.turn.current).toBe(2);
    expect(toasts).toContain('Blue ran out of time');
  });

  it('flushBank / syncBankClock are pure', () => {
    const banks = [10, 20];
    expect(flushBank(IDLE_CLOCK, banks)).toBe(banks);
    const on = syncBankClock(IDLE_CLOCK, banks, { key: 'k', kind: 'turn', player: 1 }, 99);
    expect(on.clock).toMatchObject({ player: 1, remainingMs: 20, totalMs: 99 });
    const ran = { ...on.clock, remainingMs: 5 };
    expect(flushBank(ran, banks)).toEqual([10, 5]);
    expect(syncBankClock(ran, banks, null, 99)).toEqual({ clock: IDLE_CLOCK, banks: [10, 5] });
  });
});
