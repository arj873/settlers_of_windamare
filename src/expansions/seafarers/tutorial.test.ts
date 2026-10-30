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
import { seaSlice } from './engine';
import { SEA_TUTORIAL_SEED, islandSpots, seaTutorial as course } from './tutorial';

const ctx = (s: GameState) => ctxOf(course, s);
const [normal, hard, easy] = LEARNERS;
const play = (l = normal, until?: (d: Drive) => boolean) =>
  drive(course, { learner: l?.bot, learnerSeed: l?.seed, ...(until ? { until } : {}) });

describe('the Seafarers tutorial game', () => {
  it('is Heading for New Shores: 3 players, the printed map, the learner first, 14 VP', () => {
    const s = course.game();
    expect(s.settings.mode).toBe('seafarers');
    expect(s.settings.scenario).toBe('seafarers/newShores');
    expect(s.settings.map).toBe('seafarers/hns3');
    expect(s.settings.options['seafarers']).toMatchObject({ layout: 'fixed' });
    expect(s.settings.vpToWin).toBe(14);
    expect(s.settings.startingPlayer).toBe(course.me);
    expect(course.isGame(s)).toBe(true);
    expect(BASE_COURSE.isGame(s)).toBe(false);
  });

  it('comes with the Seafarers pack and is found by its game', () => {
    expect(courseById('seafarers')).toBe(course);
    expect(courseOfGame(course.game())).toBe(course);
  });

  it('passes the course checks (every learner finishes)', () => {
    expect(courseProblems(course)).toEqual([]);
  });

  it('the seed: the learner rolls a 7 on their second turn (until a card draw or steal shifts the dice)', () => {
    expect(SEA_TUTORIAL_SEED).toBe('learn-sea-316');
    for (const l of [normal, hard]) {
      const d = play(l);
      expect(firstTurn(d, / rolled 7\b/), l?.name).toBe(4);
      expect(d.log.find((e) => / rolled 7\b/.test(e.text))?.player).toBe(course.me);
    }
  });
});

describe('Seafarers lessons', () => {
  it('opens with what is new (scenario, target, island bonus) and offers the base tutorial', () => {
    const s = course.game();
    const run = advance(newRun(course.seed, course.me), ctx(s), course);
    const v = panelView(run, ctx(s), course);
    expect(run.current).toBe('intro');
    expect(v.text).toContain('Heading for New Shores, first to 14 points');
    expect(v.text).toContain('2 extra points');
    expect(v.lesson?.offerBase).toBe(true);
  });

  it('a coastal starting settlement: the ship-instead-of-a-road lesson', () => {
    const d = play(easy, (x) => x.run.current === 'setupShip');
    expect(d.state.phase).toMatchObject({ kind: 'setup', step: 'road' });
    const v = panelView(d.run, ctx(d.state), course);
    expect(v.focus).toBe('sea-ship');
    expect(d.run.current).toBe('setupShip');
  });

  it('ships on the first turn, then the 7: robber or pirate, with the move to make', () => {
    const d = play(normal, (x) => x.run.current === 'pirate');
    expect(d.shown.map((s) => s.id)).toEqual(expect.arrayContaining(['ships', 'pirate']));
    expect(d.shown.find((s) => s.id === 'ships')?.turn).toBe(1);
    expect(d.state.turn.number).toBe(4);
    const v = panelView(d.run, ctx(d.state), course);
    expect(v.text).toContain('robber or the pirate');
    expect(v.todo).toMatch(/robber or a sea tile for the pirate|cards to give back/);
  });

  it('land ho: the island lesson comes when a settlement there is possible, then the bonus', () => {
    const d = play(normal, (x) => x.run.current === 'island');
    expect(islandSpots(ctx(d.state)).length).toBeGreaterThan(0);
    expect(panelView(d.run, ctx(d.state), course).todo).toBe('Build a settlement on the island.');
    const later = play(normal, (x) => seaSlice(x.state).chits.some((c) => c.player === course.me));
    expect(firstTurn(later, /Red settled new land: \+2 VP/)).toBe(16);
  });
});

describe('Seafarers completion', () => {
  it('each learner gets through it; the Normal learner needs no recap', () => {
    for (const l of LEARNERS) {
      const d = play(l);
      expect(d.run.over, l.name).toBe(true);
      expect(d.shown.at(-1)?.id).toBe('finish');
      if (l === normal) expect(d.shown.filter((s) => s.recap)).toEqual([]);
    }
  });
});
