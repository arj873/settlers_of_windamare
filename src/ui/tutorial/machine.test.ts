import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, type Action, type GameState } from '../../engine';
import { TUTORIAL_ME, TUTORIAL_SEED, isTutorialGame, tutorialGame } from './game';
import {
  LAST_COACHED_TURN,
  myTurnsStarted,
  offerToMe,
  sevenNow,
  type TutorialCtx,
} from './lessons';
import {
  advance,
  back,
  IDLE_TEXT,
  newRun,
  next,
  panelView,
  parseRun,
  skip,
  type TutorialRun,
} from './machine';
import { loadTutorial, saveTutorial, TUTORIAL_KEY } from './store';

const me = TUTORIAL_ME;
const ctx = (state: GameState): TutorialCtx => ({
  state,
  me,
  legal: legalActions(state).filter((a) => a.player === me),
});

function act(state: GameState, a: Action): GameState {
  const r = applyAction(state, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

/** Anyone's simplest move: place / roll / resolve the robber / discard, otherwise end the turn. */
const PREFER = [
  'placeSetupSettlement',
  'placeSetupRoad',
  'discard',
  'moveRobber',
  'steal',
  'rollDice',
  'rejectTrade',
  'endTurn',
];
function simpleMove(state: GameState, player?: number): Action {
  const legal = legalActions(state).filter((a) => player === undefined || a.player === player);
  for (const t of PREFER) {
    const a = legal.find((x) => x.type === t);
    if (a) return a;
  }
  throw new Error(`no simple move in ${state.phase.kind}`);
}

/** Play simple moves until `stop` holds, following the coach after every state. */
function playUntil(
  state: GameState,
  run: TutorialRun,
  stop: (s: GameState) => boolean,
  limit = 400,
): { state: GameState; run: TutorialRun } {
  let s = state;
  let r = run;
  for (let i = 0; i < limit && !stop(s); i++) {
    s = act(s, simpleMove(s));
    r = advance(r, ctx(s));
  }
  if (!stop(s)) throw new Error('playUntil: limit reached');
  return { state: s, run: r };
}

const shownNow = (run: TutorialRun) => run.current;
const fresh = () => {
  const state = tutorialGame();
  return { state, run: advance(newRun(TUTORIAL_SEED, me), ctx(state)) };
};
/** Next until the panel shows something other than these reading lessons. */
function readPast(run: TutorialRun, state: GameState, ids: string[]): TutorialRun {
  let r = run;
  while (r.current !== null && ids.includes(r.current)) r = next(r, ctx(state));
  return r;
}

describe('tutorial game', () => {
  it('is a normal base game: beginner map, 3 players, the learner first', () => {
    const s = tutorialGame();
    expect(isTutorialGame(s)).toBe(true);
    expect(s.settings.map).toBe('base');
    expect(s.settings.vpToWin).toBe(10);
    expect(s.settings.discardLimit).toBe(7);
    expect(s.settings.startingPlayer).toBe(me);
    expect(s.phase).toMatchObject({ kind: 'setup', step: 'settlement' });
  });

  it('the seed gives a first roll that pays and the learner’s own 7 on their second turn', () => {
    let { state, run } = fresh();
    ({ state, run } = playUntil(state, run, (s) => s.turn.number === 1 && s.phase.kind === 'main'));
    expect(state.dice && state.dice[0] + state.dice[1]).toBe(8);
    ({ state } = playUntil(state, run, (s) => s.turn.number === 4 && s.phase.kind !== 'preRoll'));
    expect(state.turn.current).toBe(me);
    expect(state.dice && state.dice[0] + state.dice[1]).toBe(7);
  });
});

describe('lesson order', () => {
  it('opens with the goal, then the board, then the first placement', () => {
    let { state, run } = fresh();
    expect(shownNow(run)).toBe('goal');
    run = next(run, ctx(state));
    expect(shownNow(run)).toBe('board');
    expect(panelView(run, ctx(state)).lesson?.visual).toBe('terrain');
    run = next(run, ctx(state));
    expect(shownNow(run)).toBe('place1');
    // Placing the settlement (not Next) moves on to the road.
    state = act(state, simpleMove(state, me));
    run = advance(run, ctx(state));
    expect(run.done).toContain('place1');
    expect(shownNow(run)).toBe('road1');
  });

  it('walks through setup in snake order and the first turn', () => {
    let { state, run } = fresh();
    run = readPast(run, state, ['goal', 'board']);
    const seen: (string | null)[] = [];
    const note = (r: TutorialRun) => {
      if (r.current !== seen.at(-1)) seen.push(r.current);
    };
    for (let i = 0; i < 400 && state.turn.number < 2; i++) {
      // Read every reading lesson right away, act otherwise.
      while (run.current && ['production', 'build'].includes(run.current)) {
        note(run);
        run = next(run, ctx(state));
      }
      note(run);
      state = act(state, simpleMove(state));
      run = advance(run, ctx(state));
    }
    expect(seen.filter(Boolean)).toEqual([
      'place1',
      'road1',
      'snake',
      'place2',
      'road2',
      'roll',
      'production',
      'build',
      'endTurn',
    ]);
  });

  it('production names the roll; paging back shows it without the live number', () => {
    let { state, run } = fresh();
    run = readPast(run, state, ['goal', 'board']);
    ({ state, run } = playUntil(state, run, (s) => s.turn.number === 1 && s.phase.kind === 'main'));
    expect(shownNow(run)).toBe('production');
    expect(panelView(run, ctx(state)).text).toMatch(/^You rolled 8\. /);
    run = next(run, ctx(state));
    expect(shownNow(run)).toBe('build');
    expect(panelView(run, ctx(state)).focus).toBe('build');
    run = back(run);
    const v = panelView(run, ctx(state));
    expect(v.lesson?.id).toBe('production');
    expect(v.live).toBe(false);
    expect(v.text).not.toMatch(/rolled 8/);
    expect(v.focus).toBe(null);
    run = next(run, ctx(state));
    expect(run.back).toBe(null);
    expect(panelView(run, ctx(state)).lesson?.id).toBe('build');
  });

  it('a 7 brings the robber lesson with a live "your move" line', () => {
    let { state, run } = fresh();
    run = readPast(run, state, ['goal', 'board']);
    ({ state, run } = playUntil(state, run, (s) => s.phase.kind === 'moveRobber'));
    expect(sevenNow(ctx(state))).toBe(true);
    expect(shownNow(run)).toBe('seven');
    const v = panelView(run, ctx(state));
    expect(v.text).toContain('more than 7 cards');
    expect(v.todo).toBe('Click a glowing tile to move the robber.');
    // Robber moved and the steal done: back in the learner's main phase, the lesson closes.
    ({ run } = playUntil(state, run, (s) => s.phase.kind === 'main'));
    expect(run.done).toContain('seven');
  });

  it('skips setup lessons the learner already did while reading', () => {
    let { state, run } = fresh();
    run = next(run, ctx(state)); // goal -> board
    state = act(state, simpleMove(state, me)); // settlement placed while the board lesson is up
    run = advance(run, ctx(state));
    // The road step is urgent: it pushes the reading lesson aside; place1 is no longer useful.
    expect(shownNow(run)).toBe('road1');
    expect(run.done).toEqual(expect.arrayContaining(['board', 'place1']));
    expect(run.shown).not.toContain('place1');
  });

  it('goes idle between moments, and Back still pages', () => {
    let { state, run } = fresh();
    run = readPast(run, state, ['goal', 'board']);
    ({ state, run } = playUntil(state, run, (s) => s.turn.number === 2));
    expect(run.current).toBe(null);
    const v = panelView(run, ctx(state));
    expect(v.lesson).toBe(null);
    expect(v.text).toBe(IDLE_TEXT);
    expect(v.canNext).toBe(false);
    expect(v.canBack).toBe(true);
    run = back(run);
    expect(panelView(run, ctx(state)).lesson?.id).toBe(run.shown.at(-1));
    run = next(run, ctx(state));
    expect(run.back).toBe(null);
  });
});

describe('event lessons and the end', () => {
  it('a trade offer to the learner brings the trading lesson', () => {
    let { state, run } = fresh();
    run = readPast(run, state, ['goal', 'board']);
    ({ state, run } = playUntil(state, run, (s) => s.turn.number === 2 && s.phase.kind === 'main'));
    // Blue offers the learner a trade (cards given so the offer is legal).
    const rich = { brick: 2, lumber: 2, wool: 2, grain: 2, ore: 2 };
    state = {
      ...state,
      players: state.players.map((p) => ({ ...p, resources: { ...rich } })),
    };
    run = advance(run, ctx(state));
    state = act(state, {
      type: 'offerTrade',
      player: 1,
      give: { brick: 1, lumber: 0, wool: 0, grain: 0, ore: 0 },
      want: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 1 },
      to: [me],
    } as Action);
    expect(offerToMe(ctx(state))).toBe(true);
    run = advance(run, ctx(state));
    expect(shownNow(run)).toBe('trade');
    expect(panelView(run, ctx(state)).todo).toMatch(/offers you a trade/);
  });

  it('recaps what never happened, then finishes', () => {
    let { state, run } = fresh();
    run = readPast(run, state, ['goal', 'board']);
    const target = (s: GameState) =>
      myTurnsStarted(ctx(s)) >= LAST_COACHED_TURN && s.turn.current === me;
    let guard = 0;
    while (!target(state) && guard++ < 2000) {
      // Read whatever comes up, so the run never waits on Next.
      while (run.current && !['place1', 'road1', 'place2', 'road2', 'roll'].includes(run.current)) {
        run = next(run, ctx(state));
      }
      state = act(state, simpleMove(state));
      run = advance(run, ctx(state));
    }
    expect(target(state)).toBe(true);
    // Simple moves never buy cards or build long roads: those lessons come as recaps.
    const recaps: string[] = [];
    for (let i = 0; i < 10 && run.current !== 'finish'; i++) {
      if (run.current) {
        const v = panelView(run, ctx(state));
        if (v.recap) recaps.push(run.current);
      }
      run = next(run, ctx(state));
    }
    expect(recaps).toEqual(expect.arrayContaining(['devCards', 'awards']));
    expect(run.recapped).toEqual(recaps);
    // Every event lesson came up, in play or as a recap; the card list follows its lesson.
    expect(run.done).toEqual(expect.arrayContaining(['seven', 'trade', 'devCards', 'awards']));
    expect(run.shown).toContain('devTypes');
    expect(run.current).toBe('finish');
    const v = panelView(run, ctx(state));
    expect(v.final).toBe(true);
    expect(v.text).toContain('10 points');
    run = next(run, ctx(state));
    expect(run.over).toBe(true);
    expect(advance(run, ctx(state))).toBe(run);
  });

  it('skip ends the run for good', () => {
    const { state, run } = fresh();
    const off = skip(run);
    expect(off.over).toBe(true);
    expect(advance(off, ctx(state))).toBe(off);
    expect(next(off, ctx(state))).toBe(off);
  });

  it('a Knight is not a 7', () => {
    let { state } = fresh();
    ({ state } = playUntil(state, newRun(TUTORIAL_SEED, me), (s) => s.turn.number === 2));
    const knightTurn: GameState = {
      ...state,
      phase: { kind: 'moveRobber', resume: 'preRoll' },
      dice: [3, 4],
      log: [...state.log, { turn: state.turn.number, player: 1, text: 'Blue played a Knight' }],
    };
    expect(sevenNow(ctx(knightTurn))).toBe(false);
  });
});

describe('resume', () => {
  it('a saved run comes back equal and keeps advancing the same way', () => {
    let { state, run } = fresh();
    run = readPast(run, state, ['goal', 'board']);
    ({ state, run } = playUntil(state, run, (s) => s.turn.number === 1 && s.phase.kind === 'main'));
    run = back(run);
    const mem = new Map<string, string>();
    const store = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    saveTutorial(store, { completed: false, offered: true, run });
    const loaded = loadTutorial(store);
    expect(loaded).toEqual({ completed: false, offered: true, run });
    expect(advance(loaded.run!, ctx(state))).toEqual(advance(run, ctx(state)));
  });

  it('bad or missing data loads as a fresh record', () => {
    const bad = (text: string | null) =>
      loadTutorial({ getItem: () => text, setItem: () => undefined });
    const empty = { completed: false, offered: false, run: null };
    expect(bad(null)).toEqual(empty);
    expect(bad('{oops')).toEqual(empty);
    expect(bad(JSON.stringify({ completed: true, run: { seed: 1 } }))).toEqual({
      ...empty,
      completed: true,
    });
    expect(parseRun({ ...newRun('x', 0), shown: ['nope'] })).toBe(null);
    expect(parseRun({ ...newRun('x', 0), current: 'nope' })).toBe(null);
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadTutorial(throwing)).toEqual(empty);
    expect(() => saveTutorial(throwing, empty)).not.toThrow();
    expect(TUTORIAL_KEY).toBe('catan:tutorial:v1');
  });
});
