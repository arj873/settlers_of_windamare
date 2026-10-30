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
import { SPECIES, cropSlice, emptyCounts, fieldsHexes, totalOf, type CropSlice } from './engine';
import { CROP_TUTORIAL_SEED, cropTutorial as course } from './tutorial';

const ctx = (s: GameState) => ctxOf(course, s);
const [normal, hard, easy] = LEARNERS;
const play = (l = normal, until?: (d: Drive) => boolean) =>
  drive(course, { learner: l?.bot, learnerSeed: l?.seed, ...(until ? { until } : {}) });
const withCrop = (s: GameState, patch: Partial<CropSlice>): GameState => ({
  ...s,
  ext: { ...s.ext, crop: { ...cropSlice(s), ...patch } },
});
const view = (d: Drive) => panelView(d.run, ctx(d.state), course);

describe('the Crop Trust tutorial game', () => {
  it('is the first-game board: 3 players, the learner first, 10 VP', () => {
    const s = course.game();
    expect(s.settings.mode).toBe('crop');
    expect(s.settings.scenario).toBe('crop/cropTrust');
    expect(s.settings.map).toBe('crop/first19');
    expect(s.players).toHaveLength(3);
    expect(s.settings.vpToWin).toBe(10);
    expect(s.settings.startingPlayer).toBe(course.me);
    expect(course.botLevels).toEqual(['easy', 'easy', 'easy']);
    expect(course.isGame(s)).toBe(true);
    expect(BASE_COURSE.isGame(s)).toBe(false);
    expect(course.isGame(BASE_COURSE.game())).toBe(false);
  });

  it('comes with the Crop Trust pack and is found by its game', () => {
    expect(courseById('crop')).toBe(course);
    expect(courseOfGame(course.game())).toBe(course);
  });

  it('passes the course checks (every learner finishes)', () => {
    expect(courseProblems(course)).toEqual([]);
  });

  it('the seed: the learner harvests within their first three turns, and the crops hold out', () => {
    expect(CROP_TUTORIAL_SEED).toBe('learn-crop-52');
    for (const l of LEARNERS) {
      const d = play(l);
      expect(firstTurn(d, /^Red harvested /), l.name).toBeLessThanOrEqual(7);
      expect(firstTurn(d, /^Crop collapse/), l.name).toBeNull();
    }
  });
});

describe('Crop Trust lessons', () => {
  it('opens with what is new (10 VP, the crops, food) and offers the base tutorial', () => {
    const s = course.game();
    const run = advance(newRun(course.seed, course.me), ctx(s), course);
    const v = panelView(run, ctx(s), course);
    expect(run.current).toBe('intro');
    expect(v.text).toContain('First to 10 points wins, unless the crops die out first');
    expect(v.text).toContain('Wheat cards are called food here');
    expect(v.lesson?.offerBase).toBe(true);
  });

  it('then the fields and their five crops (a picture of them)', () => {
    const d = play(normal, (x) => x.run.current === 'fields');
    expect(d.state.phase.kind).toBe('setup');
    const v = view(d);
    expect(v.text).toContain('There is no desert');
    expect(v.focus).toBe('crop-fields');
    const pic = course.visuals?.[v.lesson?.visual ?? '']?.();
    expect([...(pic?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual([
      'Beans',
      'Maize',
      'Quinoa',
      'Rice',
      'Wheat',
    ]);
    expect(pic?.querySelectorAll('.crop-chip')).toHaveLength(SPECIES.length);
  });

  it('first turn: the seed vault, with a todo when the learner can store a seed', () => {
    const d = play(easy, (x) => x.run.current === 'vault');
    expect(d.state.turn).toMatchObject({ number: 1, current: course.me });
    const v = view(d);
    expect(v.text).toContain('pay 1 Lumber + 1 Ore');
    expect(v.text).toContain('the 3rd, 4th and 5th earn 1 point each');
    expect(v.focus).toBe('crop-vault');
    expect(v.todo).toBe('Store a seed: pick the crop, the field and a row, then Store.');
  });

  it('storing a seed: replanting is urgent, with the seeds left to plant', () => {
    const d = play(easy, (x) => x.run.current === 'replant');
    expect(d.state.phase.kind).toBe('crop/replant');
    expect(d.run.done).toContain('vault');
    const v = view(d);
    expect(v.text).toContain('refills your seed vault with 4 seeds');
    expect(v.todo).toMatch(/^Click a field to plant a seed \([1-4] left\)\.$/);
  });

  it('a harvest: urgent, with the pick to make', () => {
    const d = play(hard, (x) => x.run.current === 'harvest');
    expect(d.state.phase.kind).toBe('crop/harvest');
    const v = view(d);
    expect(v.text).toContain('take 1 crop off it for 1 food');
    expect(v.todo).toBe('Pick a crop to harvest, or Skip to leave it growing.');
  });

  it('an event token: the lesson names what was revealed', () => {
    const d = play(normal, (x) => x.run.current === 'events');
    const v = view(d);
    expect(v.text).toMatch(/^Red reveals an event: .+\. Each settlement or city built/);
    expect(
      panelView({ ...d.run, back: d.run.shown.indexOf('events') }, ctx(d.state), course).text,
    ).toMatch(/^Each settlement or city built/);
  });

  it('the collapse warning: a field down to its last crop, and how many are empty', () => {
    const d = play(normal, (x) => x.run.current === 'collapse');
    const s = cropSlice(d.state);
    expect(fieldsHexes(d.state).some((h) => totalOf(s.crops[h] ?? emptyCounts()) <= 1)).toBe(true);
    expect(view(d).text).toContain('If 3 fields are empty or 2 kinds die out');
    const [first] = fieldsHexes(d.state);
    const empty = withCrop(d.state, { crops: { ...s.crops, [first as string]: emptyCounts() } });
    expect(panelView(d.run, ctx(empty), course).text).toMatch(/^Fields empty now: \d of 5\. /);
  });
});

describe('Crop Trust completion', () => {
  it('each learner gets through it; Normal and Hard learners need no recap', () => {
    for (const l of LEARNERS) {
      const d = play(l);
      expect(d.run.over, l.name).toBe(true);
      expect(d.shown.at(-1)?.id).toBe('finish');
      if (l !== easy) expect(d.shown.filter((s) => s.recap)).toEqual([]);
    }
  });
});
