// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Bot } from '../../bots';
import { botForLevel } from '../../bots/byLevel';
import type { Action, EdgeId, GameState, VertexId } from '../../engine';
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
import { EP_ACTIONS as A, epSlice } from './engine';
import { graph, touchesFog } from './engine/geometry';
import { epBoard } from './engine/maps';
import { harborsOf, shipsOf } from './engine/ships';
import { EP_TUTORIAL_SEED, canExplore, epTutorial as course, explored } from './tutorial';

const ctx = (s: GameState) => ctxOf(course, s);
const [normal, hard, easy] = LEARNERS;
const play = (l = normal, until?: (d: Drive) => boolean) =>
  drive(course, { learner: l?.bot, learnerSeed: l?.seed, ...(until ? { until } : {}) });
const view = (d: Drive) => panelView(d.run, ctx(d.state), course);
const field = (a: Action, k: string) => (a as unknown as Record<string, unknown>)[k];

/** A corner of a region hex (discovered land), not the home island. */
const onNewLand = (s: GameState, v: VertexId) =>
  (graph(s).hexesAt.get(v) ?? []).some((h) => epBoard(s).region[h] !== undefined);

/**
 * A learner who does what the coach says on their first turn (roll, Start Movement, sail to the
 * fog, land the settler on what turned up), then plays like the Normal bot.
 */
const coached: Bot = (state, p, rng, legal) => {
  if (state.turn.number === 1 && state.phase.kind === 'main') {
    const pick = (type: string, ok: (a: Action) => boolean = () => true) =>
      (legal ?? []).find((a) => a.type === type && ok(a));
    const found = explored(ctx(state)) > 0;
    const move =
      pick(A.land, (a) => onNewLand(state, field(a, 'vertex') as VertexId)) ??
      pick(A.startMovement) ??
      (found ? undefined : pick(A.moveShip, (a) => touchesFog(state, field(a, 'edge') as EdgeId)));
    if (move) return move;
    return pick('endTurn') ?? null;
  }
  return botForLevel('normal')(state, p, rng, legal);
};

describe('the Explorers & Pirates tutorial game', () => {
  it('is Land Ho!: 3 players, the printed starting pieces, the learner first, 8 VP', () => {
    const s = course.game();
    expect(s.settings.mode).toBe('ep');
    expect(s.settings.scenario).toBe('ep/landHo');
    expect(s.settings.vpToWin).toBe(8);
    expect(s.players).toHaveLength(3);
    expect(s.settings.startingPlayer).toBe(course.me);
    // No setup to place: the first turn starts at once.
    expect(s.phase.kind).toBe('preRoll');
    expect(s.turn).toMatchObject({ number: 1, current: course.me });
    expect(harborsOf(s, course.me)).toHaveLength(1);
    expect(shipsOf(epSlice(s), course.me).map((x) => x.cargo)).toEqual([['settler']]);
    expect(epSlice(s).gold[course.me]).toBe(2);
    expect(course.isGame(s)).toBe(true);
    expect(BASE_COURSE.isGame(s)).toBe(false);
  });

  it('comes with the E&P pack and is found by its game', () => {
    expect(courseById('ep')).toBe(course);
    expect(courseOfGame(course.game())).toBe(course);
  });

  it('passes the course checks (every learner finishes)', () => {
    expect(courseProblems(course)).toEqual([]);
  });

  it('the seed: the first roll pays the learner nothing (1 gold), the first 7 on turn 5', () => {
    expect(EP_TUTORIAL_SEED).toBe('learn-ep-221');
    // Land Ho! draws nothing else from the game's rng: the dice are the seed's in every game.
    for (const l of LEARNERS) {
      const d = play(l);
      expect(d.log.find((e) => / rolled /.test(e.text))?.text, l.name).toBe('Red rolled 4 (3+1)');
      expect(firstTurn(d, /^Red received 1 gold \(no resources\)/), l.name).toBe(1);
      expect(firstTurn(d, / rolled 7\b/), l.name).toBe(5);
    }
  });

  it('the seed: sailing to the fog on turn 1 finds land, and the settler can land on it', () => {
    const d = drive(course, { learner: coached });
    expect(firstTurn(d, /^Red discovered (lumber|ore) 8/)).toBe(1);
    expect(firstTurn(d, /^Red’s settler founded a settlement/)).toBe(1);
    expect(
      Object.entries(d.state.pieces.buildings).some(
        ([v, b]) => b.owner === course.me && onNewLand(d.state, v as VertexId),
      ),
    ).toBe(true);
  });
});

describe('E&P lessons', () => {
  it('opens with what is new (scenario, target, what is gone) and offers the base tutorial', () => {
    const s = course.game();
    const run = advance(newRun(course.seed, course.me), ctx(s), course);
    const v = panelView(run, ctx(s), course);
    expect(run.current).toBe('intro');
    expect(v.text).toContain('Land Ho!, first to 8 points');
    expect(v.text).toContain('no cities, development cards, robber');
    expect(v.lesson?.offerBase).toBe(true);
  });

  it('after the roll: Action then Movement (the phase line pulses), then gold', () => {
    const d = play(normal, (x) => x.run.current === 'turn');
    expect(d.state.phase.kind).toBe('main');
    expect(view(d).focus).toBe('ep-phase');
    expect(view(d).text).toContain('press Start Movement phase in the Land Ho! panel');
    const g = play(normal, (x) => x.run.current === 'gold');
    expect(g.state.turn.number).toBe(1);
    expect(epSlice(g.state).turn.movement).toBe(false);
    expect(view(g).text).toContain('2 gold buy 1 resource');
    expect(view(g).focus).toBe('ep-gold');
  });

  it('a learner who reads each lesson, then does what it says: all of it on turn 1', () => {
    // readAfter 0: Next before every move (the learner reads first, then acts).
    const go = (until?: (d: Drive) => boolean) =>
      drive(course, { learner: coached, readAfter: 0, ...(until ? { until } : {}) });
    const sail = go((x) => x.run.current === 'sail');
    expect(view(sail).todo).toBe('Sail to a corner of a parrot or goose hex to explore it.');
    expect(view(sail).focus).toBe('ep-fleet');
    expect(canExplore(ctx(sail.state))).toBe(true);
    const land = go((x) => x.run.current === 'land');
    expect(view(land).todo).toBe(
      'Click a highlighted corner to found a settlement there, or sail on.',
    );
    const d = go();
    const first = d.shown.filter((x) => x.turn === 1).map((x) => x.id);
    expect(first).toEqual(['intro', 'island', 'turn', 'gold', 'sail', 'explore', 'land']);
    // The later scenarios come up while the bots play, with their picture.
    expect(d.shown.find((x) => x.id === 'next')).toMatchObject({ turn: 2, recap: false });
    expect(d.run.over).toBe(true);
  });

  it('a learner who acts before reading still gets sailing, exploring and landing on turn 1', () => {
    const d = drive(course, { learner: coached });
    const first = d.shown.filter((x) => x.turn === 1).map((x) => x.id);
    expect(first).toEqual(expect.arrayContaining(['sail', 'explore', 'land']));
    // The phases lesson waits for an Action phase (turn 4) instead of telling a sailing
    // learner to start sailing.
    expect(d.shown.find((x) => x.id === 'turn')?.turn).toBe(4);
  });

  it('a 7: discards only, no robber (Blue rolls it on turn 5)', () => {
    const d = play(easy, (x) => x.run.current === 'seven');
    expect(d.state.turn.number).toBe(5);
    expect(view(d).text).toContain('more than 7 resource cards discard half (gold never counts)');
    expect(view(d).text).toContain('there is no robber');
  });

  it('settlers and ships once the first settler has landed, with their costs', () => {
    const d = play(hard, (x) => x.run.current === 'fleet');
    expect(epSlice(d.state).turn.movement).toBe(false);
    expect(view(d).focus).toBe('ep-build');
    expect(view(d).text).toContain('a ship 1 Lumber + 1 Sheep');
    expect(view(d).lesson?.visual).toBe('costs');
  });

  it('harbor settlements: when the learner can upgrade one (or someone did)', () => {
    const d = play(normal, (x) => x.run.current === 'harbor');
    expect(view(d).text).toContain('2 Wheat + 2 Ore');
    expect(view(d).focus).toBe('ep-harbor');
  });
});

describe('E&P pictures', () => {
  it('draws the costs, the gold trades and the scenario ladder', () => {
    const v = course.visuals ?? {};
    expect(v.costs?.().textContent).toContain('Settler');
    // Settler 4 cards, ship 2, extra moves 1.
    expect(v.costs?.().querySelectorAll('.tut-ep-cost > *')).toHaveLength(7);
    expect(v.gold?.().textContent).toContain('any resource');
    const ladder = v.scenarios?.();
    expect(ladder?.querySelectorAll('li')).toHaveLength(5);
    expect(ladder?.textContent).toContain('Pirate Lairs');
    expect(ladder?.textContent).toContain('17 VP');
  });
});

describe('E&P completion', () => {
  it('each learner gets through it without a recap', () => {
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
