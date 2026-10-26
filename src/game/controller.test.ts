import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAction, createGame, legalActions, type Action, type GameState } from '../engine';
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
  covered = false;
  timers: HudView['turnTimer'][] = [];
  private handlers: { [E in keyof HudEvents]?: ((p: HudEvents[E]) => void)[] } = {};
  render(_state: GameState, view: HudView): void {
    this.views.push(view);
  }
  isCovered(): boolean {
    return this.covered;
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
      mode: 'base',
      map: 'base',
      rules: { balancedDice: false, hideBankCards: false },
      turnTimerSec: null,
      vpToWin: 10,
      discardLimit: 7,
      players: [
        { name: 'Ann', color: '#d64541', controller: 'human' },
        { name: 'Bot', color: '#3a7bd5', controller: 'bot' },
        { name: 'Cy', color: '#ecf0f1', controller: 'human' },
      ],
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

const timed = (s: GameState, sec: number): GameState => ({
  ...s,
  settings: { ...s.settings, turnTimerSec: sec },
});

describe('GameController: turn timer', () => {
  it('shows nothing without settings.turnTimerSec', () => {
    const c = make();
    c.start(midGame(), humans4);
    expect(hud.last.turnTimer ?? null).toBeNull();
  });

  it('counts down for the current human and ticks only the pill', () => {
    const c = make();
    c.start(timed(midGame(), 30), humans4);
    expect(hud.last.turnTimer).toEqual({ remainingSec: 30, totalSec: 30 });
    const renders = hud.views.length;
    vi.advanceTimersByTime(5000);
    expect(hud.views.length).toBe(renders);
    expect(Math.ceil(hud.timers.at(-1)!.remainingSec)).toBe(25);
    expect(c.state?.turn.current).toBe(1);
  });

  it('on timeout makes the minimum moves: roll, robber/steal if needed, end turn', () => {
    const c = make();
    const s = timed(midGame(), 20);
    c.start({ ...s, phase: { kind: 'preRoll' } }, ['human', 'human', 'bot', 'bot']);
    vi.advanceTimersByTime(19000);
    expect(c.state?.phase.kind).toBe('preRoll');
    for (let i = 0; i < 400 && c.state?.turn.current === 1; i++) vi.advanceTimersByTime(250);
    expect(c.state?.turn.current).toBe(2);
    expect(toasts).toContain('Blue ran out of time');
    const types = c.state!.log.filter((e) => e.player === 1 && e.turn === 12).map((e) => e.text);
    expect(types.some((t) => /rolled/.test(t))).toBe(true);
    expect(types.some((t) => /built|bought/.test(t))).toBe(false);
  });

  it('pauses while the hotseat cover is up', () => {
    const c = make();
    c.start(timed(midGame(), 20), humans4);
    hud.covered = true;
    vi.advanceTimersByTime(60000);
    expect(c.state?.turn.current).toBe(1);
    hud.covered = false;
    vi.advanceTimersByTime(5000);
    expect(Math.ceil(hud.timers.at(-1)!.remainingSec)).toBe(15);
  });

  it('never times bots', () => {
    const c = make(0);
    c.start(timed(midGame(), 5), ['bot', 'bot', 'bot', 'bot']);
    expect(hud.last.turnTimer ?? null).toBeNull();
  });

  it('times a human trade reply and rejects it on timeout', () => {
    const c = make();
    c.start(timed(tradeOfferGame(), 10), humans4);
    expect(c.viewer).toBe(2);
    vi.advanceTimersByTime(10250);
    const phase = c.state?.phase;
    expect(phase?.kind === 'trade' && phase.offer.responses[2]).toBe('rejected');
    // Orange accepted earlier: Blue must now confirm or cancel, on Blue's own clock.
    expect(c.viewer).toBe(1);
    expect(hud.last.turnTimer?.remainingSec).toBe(10);
    vi.advanceTimersByTime(10250);
    // Timed out: offer cancelled, then the turn ended.
    expect(c.state?.log.some((e) => e.text === 'Blue withdrew the offer')).toBe(true);
    expect(c.state?.turn.current).toBe(2);
  });
});

describe('GameController: special building phase (hotseat)', () => {
  /** 5 players, SBP on, Red (0) in main. Everyone can afford a dev card. */
  function sbpGame(): GameState {
    let s = createGame({
      seed: 'sbp',
      players: [...FIXTURE_PLAYERS, { name: 'Green', color: '#2ecc71' }],
      map: 'base56',
      specialBuildPhase: true,
      startingPlayer: 0,
    });
    for (let i = 0; i < 400 && s.phase.kind === 'setup'; i++) {
      const a = legalActions(s)[0]!;
      const r = applyAction(s, a);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    const rich = { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 };
    return {
      ...s,
      phase: { kind: 'main' },
      players: s.players.map((p) => ({ ...p, resources: rich })),
    };
  }

  it('bots take their step, the next human gets the screen, then the turn moves on', () => {
    const c = make(10);
    c.start(sbpGame(), ['human', 'bot', 'human', 'bot', 'bot']);
    hud.emit('action', { type: 'endTurn', player: 0 });
    expect(c.state?.phase).toMatchObject({ kind: 'specialBuild', builder: 1, owner: 0 });
    expect(c.viewer).toBe(0); // a bot builds: the screen stays with Red
    for (let i = 0; i < 100 && c.state?.turn.current === 1; i++) vi.advanceTimersByTime(10);
    expect(c.state?.phase).toMatchObject({ kind: 'specialBuild', builder: 2 });
    expect(c.viewer).toBe(2); // White's step: the HUD shows the cover for White
    hud.emit('action', { type: 'passSpecialBuild', player: 2 });
    for (let i = 0; i < 300 && c.state?.phase.kind === 'specialBuild'; i++) {
      vi.advanceTimersByTime(10);
    }
    expect(c.state?.phase.kind).toBe('preRoll');
    expect(c.state?.turn.current).toBe(1);
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

  it('loads a stage-1 save (schemaVersion 1) upgraded to the current schema', () => {
    const v1 = {
      ...midGame(),
      schemaVersion: 1,
      settings: { seed: 'old', layout: 'beginner', vpToWin: 10 },
    };
    const seats = ['human', 'bot', 'bot', 'bot'];
    store.setItem(SAVE_KEY, JSON.stringify({ version: 1, state: v1, seats, viewer: 0, botRng: 5 }));
    const saved = loadSession(store);
    expect(saved?.state.schemaVersion).toBe(5);
    expect(saved?.state.settings).toMatchObject({ map: 'base', discardLimit: 7, vpToWin: 10 });
    expect(saved?.state.pieces).toEqual(midGame().pieces);
  });

  it('ignores a corrupt save', () => {
    store.setItem(SAVE_KEY, '{not json');
    expect(loadSession(store)).toBeNull();
    store.setItem(SAVE_KEY, JSON.stringify({ version: 1, state: midGame(), seats: ['human'] }));
    expect(loadSession(store)).toBeNull();
  });
});
