// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../engine';
import { BASE_COURSE } from '../../ui/tutorial/base';
import { advance, lessonOf, newRun, panelView } from '../../ui/tutorial/machine';
import { courseById, courseOfGame } from '../../ui/tutorial/registry';
import {
  LEARNERS,
  courseProblems,
  ctxOf,
  drive,
  firstTurn,
  type Drive,
} from '../../ui/tutorial/testkit';
import { tradersOf } from './engine';
import { pathEnds } from './engine/paths';
import { freshMove } from './engine/traders';
import { TB_TUTORIAL_SEED, tbTutorial as course } from './tutorial';

const ctx = (s: GameState) => ctxOf(course, s);
const [normal, hard, easy] = LEARNERS;
const play = (l = normal, until?: (d: Drive) => boolean) =>
  drive(course, { learner: l?.bot, learnerSeed: l?.seed, ...(until ? { until } : {}) });
const view = (d: Drive) => panelView(d.run, ctx(d.state), course);
/** A copy of `s` with the T&B traders slice changed by `f`. */
function patch(s: GameState, f: (s: GameState) => void): GameState {
  const out = structuredClone(s);
  f(out);
  return out;
}

describe('the Traders & Barbarians tutorial game', () => {
  it('is the Traders & Barbarians scenario: 3 players, the learner first, 13 VP', () => {
    const s = course.game();
    expect(s.settings.mode).toBe('tb');
    expect(s.settings.scenario).toBe('tb/traders');
    expect(s.settings.map).toBe('tb/traders19');
    expect(s.players).toHaveLength(3);
    expect(s.settings.vpToWin).toBe(13);
    expect(s.settings.options['tb']?.['harbormaster']).not.toBe(true);
    expect(s.settings.startingPlayer).toBe(course.me);
    expect(course.botLevels).toEqual(['easy', 'easy', 'easy']);
    expect(course.isGame(s)).toBe(true);
    expect(BASE_COURSE.isGame(s)).toBe(false);
  });

  it('comes with the T&B pack and is found by its game', () => {
    expect(courseById('tb')).toBe(course);
    expect(courseOfGame(course.game())).toBe(course);
  });

  it('passes the course checks (every learner finishes)', () => {
    expect(courseProblems(course)).toEqual([]);
  });

  it('the seed: a 7 on turn 3, a commodity on the learner’s second turn, delivered on their sixth', () => {
    expect(TB_TUTORIAL_SEED).toBe('learn-tb-77');
    for (const l of [normal, hard]) {
      const d = play(l);
      expect(firstTurn(d, /^Red loaded /), l?.name).toBe(4);
      expect(firstTurn(d, / rolled 7\b/), l?.name).toBeLessThanOrEqual(5);
    }
    const d = play(normal);
    expect(firstTurn(d, / rolled 7\b/)).toBe(3);
    expect(firstTurn(d, /^Red delivered /)).toBe(16);
  });

  it('every focus name has a pulse and a reduced-motion rule in tutorial.css', () => {
    // Under jsdom import.meta.url is not a file URL: read from the project root (vitest's cwd).
    const css = readFileSync('src/expansions/tb/tutorial.css', 'utf8');
    const [pulse = '', still = ''] = css.split('@media (prefers-reduced-motion: reduce)');
    const own = course.lessons.flatMap((l) => (l.focus?.startsWith('tb-') ? [l.focus] : []));
    expect(own.length).toBeGreaterThan(0);
    for (const f of own) {
      expect(pulse, f).toContain(`[data-tut-focus='${f}']`);
      expect(still, f).toContain(`[data-tut-focus='${f}']`);
    }
  });
});

describe('Traders & Barbarians lessons', () => {
  it('opens with what is new (target, wagon, deliveries) and offers the base tutorial', () => {
    const s = course.game();
    const run = advance(newRun(course.seed, course.me), ctx(s), course);
    const v = panelView(run, ctx(s), course);
    expect(run.current).toBe('intro');
    expect(v.text).toContain('first to 13 points');
    expect(v.text).toContain('1 point and gold');
    expect(v.lesson?.offerBase).toBe(true);
  });

  it('setup: the second building is a city and the wagon starts on it', () => {
    const d = play(normal, (x) => x.run.current === 'city');
    expect(d.state.phase).toMatchObject({ kind: 'setup', step: 'settlement' });
    const after = play(normal, (x) => x.state.phase.kind !== 'setup');
    const [city] = Object.entries(after.state.pieces.buildings).find(
      ([, b]) => b?.owner === course.me && b.kind === 'city',
    ) ?? [null];
    expect(city).not.toBeNull();
    expect(tradersOf(after.state).wagons[course.me]).toBe(city);
  });

  it('the first turn: the wagon (the Wagon card pulsing), then the move with its points left', () => {
    const d = play(normal, (x) => x.run.current === 'wagon');
    expect(d.state.turn.number).toBe(1);
    expect(view(d).focus).toBe('tb-wagon');
    expect(view(d).text).toContain('4 movement points');
    const m = play(normal, (x) => x.run.current === 'roads');
    expect(m.state.phase.kind).toBe('tb/wagon');
    expect(view(m).todo).toBe(
      `${tradersOf(m.state).move.mp} movement points left: click a glowing corner, or end your turn.`,
    );
  });

  it('a 7: barbarians instead of the robber; on the learner’s own 7 the move to make', () => {
    const d = play(normal, (x) => x.run.current === 'barbarians');
    expect(d.state.turn.number).toBe(3);
    expect(['discard', 'tb/barbarian']).toContain(d.state.phase.kind);
    expect(view(d).text).toContain('moves one barbarian');
    const own = play(
      normal,
      (x) => x.state.turn.current === course.me && x.state.phase.kind === 'tb/barbarian',
    );
    const todo = lessonOf(course, 'barbarians').todo;
    expect(todo?.(ctx(own.state))).toBe('Click a barbarian to move.');
  });

  it('loading and delivering: where each commodity goes, then 1 point and gold', () => {
    const d = play(normal, (x) => x.run.current === 'load');
    expect(tradersOf(d.state).commodity[course.me]).not.toBeNull();
    expect(view(d).focus).toBe('tb-table');
    const goods = course.visuals?.goods?.();
    expect([...(goods?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual([
      'Glass, Marble → Castle',
      'Tools → Quarry',
      'Sand → Glassworks',
    ]);
    const del = play(normal, (x) => x.run.current === 'deliver');
    expect(tradersOf(del.state).delivered[course.me]).toBe(1);
    expect(view(del).text).toContain('1 point and gold: 1 with your baggage train card 1');
  });

  it('the baggage train: costs from the engine and the five cards', () => {
    const d = play(normal, (x) => x.run.current === 'baggage');
    expect(view(d).focus).toBe('tb-baggage');
    expect(view(d).text).toContain('1 Lumber + 1 Sheep + 1 Ore');
    expect(view(d).text).toContain('2 Lumber + 1 Sheep + 1 Ore for cards 4 and 5');
    const table = course.visuals?.baggage?.();
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(table?.querySelector('tbody tr:last-child')?.textContent).toBe('5 (+1 pt)7+53+');
  });

  it('gold: the start purse, the bank price and the sale ratio', () => {
    const d = play(normal, (x) => x.run.current === 'gold');
    expect(view(d).text).toMatch(/^You start with 5 gold\. .* 2 gold buy 1 resource .* [34] cards/);
    expect(view(d).focus).toBe('tb-gold');
  });

  it('drive-off and Swift Journey come up when the learner can use them', () => {
    const d = play(normal, (x) => x.state.phase.kind === 'tb/wagon');
    const s = patch(d.state, (x) => {
      const t = tradersOf(x);
      const e = t.barbarians[0];
      const v = e ? pathEnds(x, e)[0] : undefined;
      if (!v) throw new Error('no barbarian path');
      t.level[course.me] = 2;
      t.wagons[course.me] = v;
      t.move = freshMove(2);
      t.swift.held[course.me] = 1;
    });
    const drive = lessonOf(course, 'driveOff');
    expect(drive.when(ctx(s))).toBe(true);
    expect(drive.text(ctx(s), true)).toContain('6 or more');
    expect(lessonOf(course, 'swift').when(ctx(s))).toBe(true);
    expect(lessonOf(course, 'driveOff').when(ctx(d.state))).toBe(false);
  });
});

describe('Traders & Barbarians completion', () => {
  it('each learner gets through it with no recap', () => {
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

  it('the finish names the target and what scores (no Longest Road)', () => {
    const d = play(easy, (x) => x.run.current === 'finish');
    expect(view(d).final).toBe(true);
    expect(view(d).text).toContain('13 points');
    expect(view(d).text).toContain('no Longest Road');
  });
});
