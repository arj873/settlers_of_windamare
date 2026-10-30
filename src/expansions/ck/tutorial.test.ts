// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../engine';
import { BASE_COURSE } from '../../ui/tutorial/base';
import { advance, newRun, next, panelView, type TutorialRun } from '../../ui/tutorial/machine';
import { courseById, courseOfGame } from '../../ui/tutorial/registry';
import {
  LEARNERS,
  courseProblems,
  ctxOf,
  drive,
  firstTurn,
  type Drive,
} from '../../ui/tutorial/testkit';
import { ckSlice, type CkSlice } from './engine';
import { CK_TUTORIAL_SEED, ckTutorial as course } from './tutorial';

const ctx = (s: GameState) => ctxOf(course, s);
/** Play until `stop`, reading every lesson (Normal learner). */
const until = (stop: (d: Drive) => boolean) => drive(course, { until: stop });
const withCk = (s: GameState, patch: Partial<CkSlice>): GameState => ({
  ...s,
  ext: { ...s.ext, ck: { ...ckSlice(s), ...patch } },
});

describe('the C&K tutorial game', () => {
  it('is a C&K game on the starter board: 3 players, the learner first, 13 VP, no options', () => {
    const s = course.game();
    expect(s.settings.mode).toBe('ck');
    expect(s.settings.scenario).toBe('ck/starter');
    expect(s.settings.vpToWin).toBe(13);
    expect(s.settings.startingPlayer).toBe(course.me);
    expect(s.players).toHaveLength(3);
    expect(s.settings.options['ck']).toMatchObject({ easyStart: false, knightErrant: false });
    expect(course.botLevels).toEqual(['easy', 'easy', 'easy']);
    expect(course.isGame(s)).toBe(true);
    expect(BASE_COURSE.isGame(s)).toBe(false);
    expect(course.isGame(BASE_COURSE.game())).toBe(false);
  });

  it('comes with the C&K pack and is found by its game', () => {
    expect(courseById('ck')).toBe(course);
    expect(courseOfGame(course.game())).toBe(course);
  });

  it('passes the course checks (every learner finishes)', () => {
    expect(courseProblems(course)).toEqual([]);
  });

  it('the seed: a gate on the first roll, the ship moving early, the attack on turn 15 for every learner', () => {
    expect(CK_TUTORIAL_SEED).toBe('learn-ck-7');
    for (const l of LEARNERS) {
      const d = drive(course, { learner: l.bot, learnerSeed: l.seed });
      expect(firstTurn(d, /The event die shows the .* gate/), l.name).toBe(1);
      expect(firstTurn(d, /barbarians sail closer/), l.name).toBe(4);
      expect(firstTurn(d, /barbarians attack!/), l.name).toBe(15);
      // Before the attack the robber sleeps: no steal moves the dice off the seed.
      expect(firstTurn(d, / stole /) ?? 99, l.name).toBeGreaterThanOrEqual(15);
    }
  });
});

describe('C&K lessons', () => {
  it('opens with what is new and offers the base tutorial', () => {
    const s = course.game();
    const run = advance(newRun(course.seed, course.me), ctx(s), course);
    expect(run.current).toBe('intro');
    const v = panelView(run, ctx(s), course);
    expect(v.text).toContain('13 points');
    expect(v.lesson?.offerBase).toBe(true);
  });

  it('setup: place, then "a city right away" for the second building', () => {
    const seen: string[] = [];
    let d = until((x) => x.state.phase.kind !== 'setup');
    seen.push(...d.shown.map((s) => s.id));
    expect(seen).toEqual(expect.arrayContaining(['intro', 'city']));
    // The city lesson is urgent and closed by placing the city.
    expect(d.run.done).toContain('city');
    d = until((x) => x.state.turn.number >= 1 && x.state.phase.kind === 'main');
    expect(d.shown.map((s) => s.id)).toContain('dice');
  });

  it('the dice lesson names the event die face of the learner’s roll', () => {
    const d = until((x) => x.run.current === 'dice');
    expect(d.state.turn).toMatchObject({ number: 1, current: course.me });
    const v = panelView(d.run, ctx(d.state), course);
    expect(v.text).toMatch(/^The event die shows the (yellow|blue|green) \(\w+\) gate\. /);
    expect(v.focus).toBe('ck-dice');
    // Paged back to later it no longer names the roll.
    const run: TutorialRun = next(d.run, ctx(d.state), course);
    const back = panelView({ ...run, back: run.shown.indexOf('dice') }, ctx(d.state), course);
    expect(back.text).toMatch(/^The red and yellow dice/);
  });

  it('commodities come up when the learner holds one, then the improvements', () => {
    const d = until((x) => x.shown.some((s) => s.id === 'improve'));
    const order = d.shown.map((s) => s.id);
    expect(order.indexOf('commodities')).toBeLessThan(order.indexOf('improve'));
    expect(d.state.turn.number).toBeLessThanOrEqual(4);
  });

  it('warns before the attack and explains it when it comes (all of it live, no recap)', () => {
    const d = until((x) => x.shown.some((s) => s.id === 'attack'));
    const at = (id: string) => d.shown.find((s) => s.id === id);
    expect(at('barbarians')?.recap).toBe(false);
    expect(at('warning')?.turn).toBeLessThan(15);
    expect(at('attack')).toMatchObject({ turn: 15, recap: false });
    const v = panelView(d.run, ctx(d.state), course);
    expect(v.text).toMatch(/^Barbarians \d+, knights \d+: /);
    expect(v.text).toContain('robber is awake');
  });

  it('the attack lesson asks the learner to pick a city when they must', () => {
    const s = course.game();
    const pillage = {
      ...withCk(s, { attacks: 1 }),
      phase: { kind: 'ck/pillage', queue: [course.me] } as unknown as GameState['phase'],
    };
    let run = advance(newRun(course.seed, course.me), ctx(s), course);
    run = { ...run, done: ['intro', 'place', 'city', 'dice', 'barbarians'], current: null };
    run = advance(run, ctx(pillage), course);
    expect(run.current).toBe('attack');
    expect(panelView(run, ctx(pillage), course).todo).toBe('Pick the city you lose.');
  });

  it('a 7 before the first attack: the robber sleeps', () => {
    const d = until((x) => x.shown.some((s) => s.id === 'seven'));
    const v = panelView({ ...d.run, current: 'seven', back: null }, ctx(d.state), course);
    expect(v.text).toContain('robber sleeps');
    const after = withCk(d.state, { attacks: 1 });
    expect(panelView({ ...d.run, current: 'seven' }, ctx(after), course).text).toContain(
      'Since the first attack',
    );
  });
});

describe('C&K completion', () => {
  it('each learner gets through it; the Normal learner sees every lesson live', () => {
    const results = LEARNERS.map((l) => drive(course, { learner: l.bot, learnerSeed: l.seed }));
    for (const d of results) {
      expect(d.run.over).toBe(true);
      expect(d.shown.at(-1)?.id).toBe('finish');
    }
    const normal = results[0];
    expect(normal?.shown.filter((s) => s.recap)).toEqual([]);
    const ids = new Set(normal?.shown.map((s) => s.id));
    for (const l of course.lessons) {
      if (l.id === 'place') continue; // placed while the intro was up: no longer needed
      expect(ids.has(l.id), l.id).toBe(true);
    }
  });
});
