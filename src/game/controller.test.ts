import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, legalActions, type Action, type GameState } from '../engine';
import {
  FIXTURE_PLAYERS,
  discardGame,
  freshGame,
  midGame,
  tradeOfferGame,
} from '../engine/fixtures';
import type { BoardEvents, Highlights } from '../render';
import type { HudEvents, HudView, NewGameConfig } from '../ui';
import { GameController, type BoardLike, type HudLike } from './controller';
import { SAVE_KEY, loadSession, type KeyValueStore } from './persist';

// --- stubs -----------------------------------------------------------------

class FakeBoard implements BoardLike {
  renders = 0;
  highlights: Highlights = {};
  private handlers = new Map<string, ((id: never) => void)[]>();
  render(): void {
    this.renders++;
  }
  setHighlights(h: Highlights): void {
    this.highlights = h;
  }
  on<K extends keyof BoardEvents>(type: K, cb: (p: BoardEvents[K]) => void): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(cb as (id: never) => void);
    this.handlers.set(type, list);
    return () => undefined;
  }
  click<K extends 'vertexClick' | 'edgeClick' | 'hexClick'>(type: K, id: BoardEvents[K]): void {
    for (const cb of this.handlers.get(type) ?? []) cb(id as never);
  }
}

class FakeHud implements HudLike {
  views: HudView[] = [];
  private handlers: { [E in keyof HudEvents]?: ((p: HudEvents[E]) => void)[] } = {};
  render(_state: GameState, view: HudView): void {
    this.views.push(view);
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

let board: FakeBoard;
let hud: FakeHud;
let store: MemoryStore;
let toasts: string[];

function make(speed = 500): GameController {
  return new GameController({
    board,
    hud,
    storage: store,
    speed,
    toast: (m) => toasts.push(m),
  });
}

beforeEach(() => {
  board = new FakeBoard();
  hud = new FakeHud();
  store = new MemoryStore();
  toasts = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const humans4 = ['human', 'human', 'human', 'human'] as const;

/** midGame where Blue (1, current, main phase) can afford anything. */
function richMidGame(): GameState {
  const s = midGame();
  const rich = { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 };
  return { ...s, players: s.players.map((p) => (p.id === 1 ? { ...p, resources: rich } : p)) };
}

// --- tests -----------------------------------------------------------------

describe('GameController: rendering and actions', () => {
  it('renders board and HUD on start with the current human as viewer', () => {
    const c = make();
    c.start(freshGame(4), humans4);
    expect(board.renders).toBe(1);
    expect(hud.last.viewer).toBe(0);
    expect(hud.last.isBotTurn).toBe(false);
    expect(hud.last.legal.length).toBeGreaterThan(0);
  });

  it('applies HUD actions through applyAction and re-renders', () => {
    const c = make();
    const s = midGame();
    c.start(s, humans4);
    hud.emit('action', { type: 'endTurn', player: 1 });
    expect(c.state).not.toBe(s);
    expect(c.state?.turn.current).toBe(2);
    expect(hud.last.viewer).toBe(2);
    expect(toasts).toEqual([]);
  });

  it('toasts on a rejected action and leaves the state alone', () => {
    const c = make();
    const s = midGame();
    c.start(s, humans4);
    hud.emit('action', { type: 'rollDice', player: 1 });
    expect(c.state).toBe(s);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatch(/rejected/);
  });

  it('starts a game from the new-game config with the chosen seats', () => {
    const c = make();
    const cfg: NewGameConfig = {
      players: [
        { name: 'Ann', color: '#d64541', controller: 'human' },
        { name: 'Bot', color: '#3a7bd5', controller: 'bot' },
        { name: 'Cy', color: '#ecf0f1', controller: 'human' },
      ],
      layout: 'beginner',
      seed: 'abc',
    };
    hud.emit('newGame', cfg);
    expect(c.state?.players.map((p) => p.name)).toEqual(['Ann', 'Bot', 'Cy']);
    expect(c.state?.settings.seed).toBe('abc');
    expect(c.seats).toEqual(['human', 'bot', 'human']);
  });

  it('reports a stalled game with a toast instead of hanging', () => {
    const c = make();
    const s = midGame();
    // Broken on purpose: discard phase where nobody owes anything.
    const stalled: GameState = { ...s, phase: { kind: 'discard', pending: [0, 0, 0, 0] } };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    c.start(stalled, humans4);
    expect(toasts.some((t) => /stalled/.test(t))).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('GameController: board highlights and clicks', () => {
  it('highlights setup settlement spots and maps a vertex click to placeSetupSettlement', () => {
    const c = make();
    c.start(freshGame(4), humans4);
    const spots = board.highlights.vertices ?? [];
    expect(spots.length).toBeGreaterThan(0);
    expect(board.highlights.color).toBe(FIXTURE_PLAYERS[0]!.color);
    board.click('vertexClick', spots[0]!);
    expect(c.state?.pieces.buildings[spots[0]!]).toEqual({ owner: 0, kind: 'settlement' });
    // Now the road step: edges only.
    expect(board.highlights.vertices).toEqual([]);
    expect((board.highlights.edges ?? []).length).toBeGreaterThan(0);
  });

  it('ignores clicks on spots that are not legal', () => {
    const c = make();
    c.start(freshGame(4), humans4);
    const before = c.state;
    board.click('edgeClick', 'e:0,0,NE');
    expect(c.state).toBe(before);
    expect(toasts).toEqual([]);
  });

  it('shows build targets only while the HUD is in place mode', () => {
    const c = make();
    const s = richMidGame();
    c.start(s, humans4);
    expect(board.highlights).toEqual({});
    const roads = legalActions(s, 1).filter((a) => a.type === 'buildRoad');
    expect(roads.length).toBeGreaterThan(0);
    hud.emit('placeMode', 'road');
    expect(board.highlights.edges).toEqual(roads.map((a) => a.edge));
    hud.emit('placeMode', null);
    expect(board.highlights).toEqual({});
  });

  it('maps a board click in place mode to the build action', () => {
    const c = make();
    c.start(richMidGame(), humans4);
    hud.emit('placeMode', 'road');
    const edge = board.highlights.edges![0]!;
    board.click('edgeClick', edge);
    expect(c.state?.pieces.roads[edge]).toBe(1);
  });

  it('highlights robber hexes after a knight and moves the robber on click', () => {
    const c = make();
    c.start(midGame(), humans4);
    hud.emit('action', { type: 'playKnight', player: 1 });
    const hexes = board.highlights.hexes ?? [];
    expect(hexes.length).toBeGreaterThan(0);
    expect(hexes).not.toContain(c.state!.robber);
    board.click('hexClick', hexes[0]!);
    expect(c.state?.robber).toBe(hexes[0]);
  });

  it('shows nothing to click during a bot turn', () => {
    const c = make();
    c.start(freshGame(4), ['bot', 'human', 'human', 'human']);
    expect(c.boardActions).toEqual([]);
    expect(board.highlights).toEqual({});
    expect(hud.last.isBotTurn).toBe(true);
  });
});

describe('GameController: viewer and hotseat', () => {
  it('switches the viewer to each human who must discard, then back to the current player', () => {
    const c = make();
    const s = discardGame(); // Blue (1, current) owes 5, Orange (3) owes 4
    c.start(s, humans4);
    expect(c.viewer).toBe(1);
    const discard = (p: number) =>
      c.legalActions.find((a): a is Action => a.type === 'discard' && a.player === p)!;
    hud.emit('action', discard(1));
    expect(c.viewer).toBe(3);
    hud.emit('action', discard(3));
    expect(c.state?.phase.kind).toBe('moveRobber');
    expect(c.viewer).toBe(1);
  });

  it('lets a pending human trade responder view before the offerer', () => {
    const c = make();
    c.start(tradeOfferGame(), humans4); // White (2) still pending
    expect(c.viewer).toBe(2);
    hud.emit('action', { type: 'rejectTrade', player: 2 });
    expect(c.viewer).toBe(1);
  });

  it('keeps the last human viewer fixed during bot turns', () => {
    const c = make();
    c.start(midGame(), ['human', 'human', 'bot', 'bot']);
    expect(c.viewer).toBe(1);
    hud.emit('action', { type: 'endTurn', player: 1 });
    expect(c.state?.turn.current).toBe(2);
    expect(c.viewer).toBe(1);
    expect(hud.last.isBotTurn).toBe(true);
  });

  it('uses a fixed spectator viewer in all-bot games', () => {
    const c = make();
    c.start(midGame(), ['bot', 'bot', 'bot', 'bot']);
    expect(c.viewer).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(hud.views.every((v) => v.viewer === 0)).toBe(true);
  });
});

describe('GameController: bots', () => {
  it('moves one bot action per tick after the configured delay', () => {
    const c = make(500);
    c.start(freshGame(4), ['bot', 'human', 'human', 'human']);
    const s0 = c.state;
    vi.advanceTimersByTime(499);
    expect(c.state).toBe(s0);
    vi.advanceTimersByTime(1);
    expect(c.state?.phase).toMatchObject({ kind: 'setup', step: 'road' });
    vi.advanceTimersByTime(500);
    expect(c.state?.turn.current).toBe(1);
    // Human's turn: the bot loop waits.
    vi.advanceTimersByTime(5000);
    expect(c.state?.turn.current).toBe(1);
    expect(c.viewer).toBe(1);
  });

  it('bots discard on a 7 faster than a normal move, humans keep their own dialog', () => {
    const c = make(1000);
    c.start(discardGame(), ['human', 'human', 'bot', 'bot']); // Orange (3) is a bot
    expect(c.viewer).toBe(1);
    vi.advanceTimersByTime(400);
    const phase = c.state!.phase;
    expect(phase.kind).toBe('discard');
    if (phase.kind === 'discard') expect(phase.pending[3]).toBe(0);
    expect(c.viewer).toBe(1);
  });

  it('bots respond to a human trade offer', () => {
    const c = make(100);
    c.start(midGame(), ['human', 'human', 'bot', 'bot']);
    const offer = legalActions(c.state!, 1).find((a) => a.type === 'offerTrade')!;
    hud.emit('action', offer);
    expect(c.state?.phase.kind).toBe('trade');
    vi.advanceTimersByTime(1000);
    const phase = c.state!.phase;
    // Every bot addressee answered; the human (0) is still asked, or the offer closed.
    if (phase.kind === 'trade') {
      expect(phase.offer.responses[2]).not.toBe('pending');
      expect(phase.offer.responses[3]).not.toBe('pending');
    }
  });

  it('a bot offerer waits for human responders', () => {
    const c = make(100);
    const s = tradeOfferGame(); // Blue (1) offered; White (2) pending
    c.start(s, ['bot', 'bot', 'human', 'bot']);
    vi.advanceTimersByTime(5000);
    expect(c.state).toBe(s);
    expect(c.viewer).toBe(2);
  });

  it('plays an all-bot game to the winner at instant speed', () => {
    const c = make(0);
    const state = createGame({
      seed: 'autoplay-test',
      players: FIXTURE_PLAYERS,
      layout: 'random',
      vpToWin: 5,
    });
    c.start(state, ['bot', 'bot', 'bot', 'bot']);
    for (let i = 0; i < 2000 && c.state?.phase.kind !== 'gameOver'; i++) {
      vi.advanceTimersByTime(20);
    }
    expect(c.state?.phase.kind).toBe('gameOver');
    expect(c.state?.winner).not.toBeNull();
    expect(toasts).toEqual([]);
  });
});

describe('GameController: autosave', () => {
  it('saves after every action and restores the same session', () => {
    const c = make();
    c.start(freshGame(3), ['human', 'bot', 'human']);
    board.click('vertexClick', board.highlights.vertices![0]!);
    const saved = loadSession(store);
    expect(saved?.state).toEqual(c.state);
    expect(saved?.seats).toEqual(['human', 'bot', 'human']);

    const board2 = new FakeBoard();
    const hud2 = new FakeHud();
    const c2 = new GameController({ board: board2, hud: hud2, storage: null });
    c2.resume(saved!);
    expect(c2.state).toEqual(c.state);
    expect(c2.seats).toEqual(c.seats);
    expect(c2.viewer).toBe(c.viewer);
    expect(hud2.last.legal).toEqual(hud.last.legal);
  });

  it('survives a storage that throws', () => {
    const bad: KeyValueStore = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const c = new GameController({ board, hud, storage: bad });
    expect(() => c.start(freshGame(3), ['human', 'human', 'human'])).not.toThrow();
    expect(loadSession(bad)).toBeNull();
    warn.mockRestore();
  });

  it('ignores a corrupt save', () => {
    store.setItem(SAVE_KEY, '{not json');
    expect(loadSession(store)).toBeNull();
    store.setItem(SAVE_KEY, JSON.stringify({ version: 1, state: midGame(), seats: ['human'] }));
    expect(loadSession(store)).toBeNull();
  });
});
