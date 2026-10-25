import { describe, expect, it } from 'vitest';
import { Rng, type Action, type ActionResult, type GameState } from '../engine';
import { discardGame, midGame } from '../engine/fixtures';
import { actorsFor, createRandomBot } from './index';
import { checkInvariants } from './invariants';
import {
  makeDump,
  newGame,
  randomSource,
  replayDump,
  runGame,
  type EngineDeps,
  type GameSetup,
} from './runner';

/**
 * A stub rules source: main phase only, the only legal move is endTurn, and the game ends once
 * turn.number reaches `endAt`. Lets the loop be tested with no real rules.
 */
function stubDeps(overrides: Partial<EngineDeps> = {}, endAt = 15): EngineDeps {
  return {
    legalActions: (s, player) => {
      if (s.phase.kind !== 'main') return [];
      const a: Action = { type: 'endTurn', player: s.turn.current };
      return player === undefined || player === a.player ? [a] : [];
    },
    applyAction: (s, a): ActionResult => {
      const next = structuredClone(s);
      next.turn.number += 1;
      next.turn.current = (a.player + 1) % next.players.length;
      if (next.turn.number >= endAt) {
        next.phase = { kind: 'gameOver' };
        next.winner = a.player;
      }
      return { ok: true, state: next };
    },
    checkInvariants: () => [],
    ...overrides,
  };
}

describe('runGame (stubbed engine)', () => {
  it('plays to game over and reports turns, winner, history', () => {
    const r = runGame({ initial: midGame(), maxSteps: 100, deps: stubDeps() });
    expect(r.outcome).toBe('finished');
    expect(r.failure).toBeNull();
    expect(r.steps).toBe(3);
    expect(r.turns).toBe(15);
    expect(r.winner).toBe(r.history.at(-1)?.player);
    expect(r.history).toHaveLength(3);
  });

  it('stops at maxSteps without calling it a failure', () => {
    const r = runGame({ initial: midGame(), maxSteps: 2, deps: stubDeps({}, 1000) });
    expect(r.outcome).toBe('maxSteps');
    expect(r.failure).toBeNull();
    expect(r.steps).toBe(2);
  });

  it('reports a stall when nobody has a legal action', () => {
    const r = runGame({
      initial: midGame(),
      maxSteps: 10,
      deps: stubDeps({ legalActions: () => [] }),
    });
    expect(r.failure?.kind).toBe('stall');
    expect(r.failure?.step).toBe(0);
  });

  it('reports applyAction rejecting a legal action', () => {
    const r = runGame({
      initial: midGame(),
      maxSteps: 10,
      deps: stubDeps({ applyAction: () => ({ ok: false, error: 'nope' }) }),
    });
    expect(r.failure?.kind).toBe('illegal-action');
    expect(r.failure?.action?.type).toBe('endTurn');
    expect(r.failure?.message).toContain('nope');
  });

  it('reports exceptions from the engine', () => {
    const r = runGame({
      initial: midGame(),
      maxSteps: 10,
      deps: stubDeps({
        applyAction: () => {
          throw new Error('boom');
        },
      }),
    });
    expect(r.failure?.kind).toBe('exception');
    expect(r.failure?.message).toContain('boom');
  });

  it('reports an invariant violation after a step, with before/after states', () => {
    const base = stubDeps();
    const r = runGame({
      initial: midGame(),
      maxSteps: 10,
      deps: stubDeps({
        applyAction: (s, a) => {
          const res = base.applyAction(s, a);
          if (res.ok) res.state.bank.ore += 1;
          return res;
        },
        checkInvariants,
      }),
    });
    expect(r.failure?.kind).toBe('invariant');
    expect(r.failure?.step).toBe(0);
    expect(r.failure?.violations[0]?.code).toBe('resource-conservation');
    expect(r.failure?.stateBefore.bank.ore).toBe(r.failure!.stateAfter!.bank.ore - 1);
    expect(r.history).toHaveLength(0);
  });

  it('checks the initial state too', () => {
    const bad = midGame();
    bad.robber = 'h:0,-3';
    const r = runGame({ initial: bad, maxSteps: 10, deps: stubDeps({ checkInvariants }) });
    expect(r.failure?.kind).toBe('invariant');
    expect(r.failure?.step).toBe(0);
    expect(r.failure?.action).toBeNull();
  });

  it('flags legal actions offered for a player who may not act', () => {
    const r = runGame({
      initial: midGame(),
      maxSteps: 10,
      deps: stubDeps({
        legalActions: (s) => [{ type: 'endTurn', player: (s.turn.current + 1) % 4 }],
      }),
    });
    expect(r.failure?.kind).toBe('illegal-actor');
  });

  it('lets every pending discarder act, in a phase where the actor is not the current player', () => {
    const initial = discardGame();
    expect(actorsFor(initial)).toEqual([1, 3]);
    const deps = stubDeps({
      legalActions: (s) =>
        s.phase.kind === 'discard'
          ? actorsFor(s).map((p) => ({ type: 'discard', player: p, resources: {} }))
          : [],
      applyAction: (s, a): ActionResult => {
        const next: GameState = structuredClone(s);
        if (next.phase.kind === 'discard') {
          next.phase.pending[a.player] = 0;
          if (next.phase.pending.every((c) => c === 0)) next.phase = { kind: 'gameOver' };
        }
        return { ok: true, state: next };
      },
    });
    const r = runGame({ initial, maxSteps: 10, deps });
    expect(r.outcome).toBe('finished');
    expect(r.history.map((a) => a.player).sort()).toEqual([1, 3]);
  });

  it('is deterministic per bot seed and differs across seeds', () => {
    // Use a stub with several legal options so the bot's choices matter.
    const deps = stubDeps({
      legalActions: (s) =>
        s.phase.kind === 'main'
          ? [
              { type: 'endTurn', player: s.turn.current },
              { type: 'buyDevCard', player: s.turn.current },
              { type: 'bankTrade', player: s.turn.current, give: 'ore', receive: 'brick' },
            ]
          : [],
    });
    const play = (seed: string) =>
      runGame({
        initial: midGame(),
        maxSteps: 8,
        deps,
        source: randomSource(createRandomBot(), seed),
      })
        .history.map((a) => a.type)
        .join();
    expect(play('a')).toBe(play('a'));
    expect(new Set(['a', 'b', 'c', 'd', 'e'].map(play)).size).toBeGreaterThan(1);
  });

  it('records failures into a dump that replays to the same failure', () => {
    const base = stubDeps();
    // Fresh deps per run: the third applyAction call is rejected. Always offers endTurn so the
    // stub works from the setup-phase state that replayDump rebuilds from the seed.
    const makeDeps = () => {
      let calls = 0;
      return stubDeps({
        legalActions: (s) => [{ type: 'endTurn', player: s.turn.current }],
        applyAction: (s, a) =>
          ++calls === 3 ? { ok: false, error: 'third time unlucky' } : base.applyAction(s, a),
      });
    };
    const setup: GameSetup = { seed: 5, players: 4, layout: 'beginner' };
    const result = runGame({ initial: newGame(setup), maxSteps: 10, deps: makeDeps() });
    expect(result.failure?.kind).toBe('illegal-action');
    const dump = makeDump(setup, 0, result);
    expect(JSON.parse(JSON.stringify(dump))).toEqual(dump);
    expect(dump.history).toHaveLength(2);
    expect(dump.failure.step).toBe(2);
    const replayed = replayDump(dump, { deps: makeDeps() });
    expect(replayed.failure).toMatchObject({ kind: 'illegal-action', step: 2 });
    // With a healthy engine the same dump no longer reproduces.
    expect(
      replayDump(dump, { deps: stubDeps({ legalActions: makeDeps().legalActions }) }).failure,
    ).toBeNull();
  });
});

describe('random bot', () => {
  const options: Action[] = [
    { type: 'endTurn', player: 0 },
    { type: 'buyDevCard', player: 0 },
    { type: 'rollDice', player: 1 },
  ];

  it('picks only actions of the requested player', () => {
    const bot = createRandomBot();
    const rng = new Rng(1);
    for (let i = 0; i < 50; i++) {
      expect(bot(midGame(), 0, rng, options)?.player).toBe(0);
    }
  });

  it('returns null when the player has no legal action', () => {
    expect(createRandomBot()(midGame(), 2, new Rng(1), options)).toBeNull();
  });

  it('pure mode is uniform (picks every option eventually)', () => {
    const rng = new Rng(7);
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(createRandomBot()(midGame(), 0, rng, options)!.type);
    expect(seen).toEqual(new Set(['endTurn', 'buyDevCard']));
  });

  it('progressBias 1 never ends the turn while something else is legal, but falls back to it', () => {
    const bot = createRandomBot({ progressBias: 1 });
    const rng = new Rng(3);
    for (let i = 0; i < 100; i++) expect(bot(midGame(), 0, rng, options)?.type).toBe('buyDevCard');
    expect(bot(midGame(), 0, rng, [options[0]!])?.type).toBe('endTurn');
  });

  it('rejects a bias outside [0, 1]', () => {
    expect(() => createRandomBot({ progressBias: 2 })).toThrow();
  });
});
