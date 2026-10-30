// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../engine';
import { BASE_COURSE } from '../../ui/tutorial/base';
import { advance, newRun, panelView } from '../../ui/tutorial/machine';
import { courseById, courseOfGame } from '../../ui/tutorial/registry';
import {
  LEARNERS,
  courseProblems,
  ctxOf,
  drive,
  firstTurn,
  type Drive,
} from '../../ui/tutorial/testkit';
import { oilSlice, type OilSlice } from './engine';
import { OIL_TUTORIAL_SEED, oilTutorial as course } from './tutorial';

const ctx = (s: GameState) => ctxOf(course, s);
const [normal, hard, easy] = LEARNERS;
const play = (l = normal, until?: (d: Drive) => boolean) =>
  drive(course, { learner: l?.bot, learnerSeed: l?.seed, ...(until ? { until } : {}) });
const withOil = (s: GameState, patch: Partial<OilSlice>): GameState => ({
  ...s,
  ext: { ...s.ext, oil: { ...oilSlice(s), ...patch } },
});
const view = (d: Drive) => panelView(d.run, ctx(d.state), course);

describe('the Oil Springs tutorial game', () => {
  it('is the rulebook board: 3 players, the learner first, 12 VP', () => {
    const s = course.game();
    expect(s.settings.mode).toBe('oil');
    expect(s.settings.scenario).toBe('oil/oilSprings');
    expect(s.settings.map).toBe('oil/fixed19');
    expect(s.players).toHaveLength(3);
    expect(s.settings.vpToWin).toBe(12);
    expect(s.settings.startingPlayer).toBe(course.me);
    expect(course.botLevels).toEqual(['easy', 'easy', 'easy']);
    expect(course.isGame(s)).toBe(true);
    expect(BASE_COURSE.isGame(s)).toBe(false);
    expect(course.isGame(BASE_COURSE.game())).toBe(false);
  });

  it('comes with the Oil Springs pack and is found by its game', () => {
    expect(courseById('oil')).toBe(course);
    expect(courseOfGame(course.game())).toBe(course);
  });

  it('passes the course checks (every learner finishes)', () => {
    expect(courseProblems(course)).toEqual([]);
  });

  it('the seed: oil is used by turn 12 and a disaster strikes by turn 25, for every learner', () => {
    expect(OIL_TUTORIAL_SEED).toBe('learn-oil-288');
    for (const l of LEARNERS) {
      const d = play(l);
      expect(firstTurn(d, /turned 1 oil into|built a metropolis/), l.name).toBeLessThanOrEqual(12);
      expect(firstTurn(d, /^Disaster! /), l.name).toBeLessThanOrEqual(25);
    }
  });
});

describe('Oil Springs lessons', () => {
  it('opens with what is new (springs, pollution, 12 VP at the end of the turn), offers the base tutorial', () => {
    const s = course.game();
    const run = advance(newRun(course.seed, course.me), ctx(s), course);
    const v = panelView(run, ctx(s), course);
    expect(run.current).toBe('intro');
    expect(v.text).toContain('three tiles with a derrick are oil springs');
    expect(v.text).toContain('First to 12 points at the end of their own turn');
    expect(v.lesson?.offerBase).toBe(true);
  });

  it('setup: after the intro (read first), the place lesson waits for the first settlement', () => {
    const d = drive(course, { readAfter: 0, until: (x) => x.run.current === 'place' });
    expect(d.state.phase).toMatchObject({ kind: 'setup', step: 'settlement' });
    expect(view(d).text).toContain('1 per settlement, 2 per city');
    const later = drive(course, { readAfter: Infinity, until: (x) => x.moves === 1 }, d);
    expect(later.run.done).toContain('place');
  });

  it('first turn: what oil does (with its picture), and a todo once the learner holds oil', () => {
    const d = play(normal, (x) => x.run.current === 'oil');
    expect(d.state.turn).toMatchObject({ number: 1, current: course.me });
    expect(d.state.phase.kind).toBe('main');
    const v = view(d);
    expect(v.text).toContain('1 oil for 2 cards');
    expect(v.text).toContain('at most 4 oil');
    expect(v.focus).toBe('oil-panel');
    expect(v.lesson?.visual).toBe('uses');
    expect(v.todo).toBeNull();
    const rich = withOil(d.state, { oil: [2, 0, 0], supply: oilSlice(d.state).supply - 2 });
    expect(panelView(d.run, ctx(rich), course).todo).toMatch(/^Turn 1 oil into 2 cards/);
  });

  it('the uses picture: 1 oil → cards, 2 oil + Brick, Wheat, Ore → metropolis, 3 sequestered → 1 point', () => {
    const el = course.visuals?.['uses']?.();
    const rows = [...(el?.querySelectorAll('li') ?? [])];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.querySelectorAll('.oil-drop').length)).toEqual([1, 2, 3]);
    expect(rows[1]?.querySelectorAll('.ico')).toHaveLength(3);
    expect(rows[2]?.textContent).toContain('1 point');
  });

  it('pollution comes with the first oil used, and shows where the marker is', () => {
    const d = play(normal, (x) => x.run.current === 'pollution');
    expect(oilSlice(d.state).marker).toBeGreaterThan(0);
    const v = view(d);
    expect(v.text).toContain(`it is at ${oilSlice(d.state).marker} now`);
    expect(v.text).toContain('When it reaches 5');
    expect(v.focus).toBe('oil-track');
  });

  it('sequestering shows when a bot sequesters oil, the metropolis when a city stands', () => {
    const d = play(easy, (x) => x.run.current === 'sequester');
    expect(oilSlice(d.state).sequestered.some((n) => n > 0)).toBe(true);
    expect(view(d).text).toContain('Every 3 sequestered is 1 point');
    const m = play(normal, (x) => x.run.current === 'metropolis');
    expect(Object.values(m.state.pieces.buildings).some((b) => b?.kind === 'city')).toBe(true);
    const v = view(m);
    expect(v.text).toContain('1 Brick, 1 Wheat, 1 Ore and 2 oil');
    expect(v.text).toContain('only 4 in the game');
    expect(v.focus).toBe('oil-metro');
  });

  it('the disaster lesson names the roll live, and not when paged back to', () => {
    const d = play(hard, (x) => x.run.current === 'disaster');
    const v = view(d);
    expect(v.text).toMatch(/^The disaster dice showed \d+\. A 7 floods the coast/);
    expect(v.text).toContain('Once 5 hexes are lost');
    const back = panelView(
      { ...d.run, back: d.run.shown.indexOf('disaster') },
      ctx(d.state),
      course,
    );
    expect(back.text).toMatch(/^A 7 floods the coast/);
  });
});

describe('Oil Springs completion', () => {
  it('each learner gets through it with every lesson live (no recap)', () => {
    for (const l of LEARNERS) {
      const d = play(l);
      expect(d.run.over, l.name).toBe(true);
      expect(d.shown.at(-1)?.id).toBe('finish');
      expect(
        d.shown.filter((s) => s.recap),
        l.name,
      ).toEqual([]);
    }
  });
});
