/** Seafarers smart-bot strategy (strategy.ts): ships to new land, the island bonus, the pirate. */
import { describe, expect, it } from 'vitest';
import { Rng, type GameState, type VertexId } from '../../engine';
import { seatSource } from '../../bots/bench';
import { newGame, runGame } from '../../bots/runner';
import { BotContext, HARD_PARAMS, baseScore, hardBot, normalBot } from '../../bots/smart';
import { areasAt } from './engine/effects';
import { fortressOf } from './engine/pirates';
import { seaSlice } from './engine';
import { mainPhase, seaGame } from './engine/testkit';
import { newLandVp, seaScore } from './strategy';

const ctxOf = (s: GameState) => new BotContext(s, 0, HARD_PARAMS, new Rng(1));

describe('Seafarers smart bots', () => {
  it('counts the special VP of a first settlement on new land, not on a home island', () => {
    const s = mainPhase(seaGame('newShores'));
    const ctx = ctxOf(s);
    const vertices = Object.keys(ctx.topo.vertex) as VertexId[];
    const fresh = vertices.filter((v) => newLandVp(ctx, v) > 0);
    expect(fresh.length).toBeGreaterThan(0);
    for (const v of fresh) {
      expect(areasAt(s, v).some((a) => !(seaSlice(s).home[0] ?? []).includes(a))).toBe(true);
    }
    // Settling there scores the bonus on top of the base settlement score.
    const v = fresh[0]!;
    const a = { type: 'buildSettlement' as const, player: 0, vertex: v };
    expect((seaScore(ctx, a) ?? 0) - (baseScore(ctx, a) ?? 0)).toBeCloseTo(0.9 * 100 * 2);
    // Setup settlements found home islands: no bonus then.
    expect(newLandVp(ctxOf(seaGame('newShores')), v)).toBe(0);
  });

  it('sails to the islands: smart bots collect new-land chits in Heading for New Shores', () => {
    let chits = 0;
    for (let g = 0; g < 3; g++) {
      const seed = `sea-strategy:${g}`;
      const r = runGame({
        initial: newGame({ seed, players: 4, mode: 'seafarers', scenario: 'seafarers/newShores' }),
        maxSteps: 20000,
        source: seatSource([hardBot, normalBot, hardBot, normalBot], seed),
      });
      expect(r.failure?.message ?? null).toBeNull();
      expect(r.outcome).toBe('finished');
      chits += seaSlice(r.finalState).chits.filter((c) => c.area !== 'gift').length;
    }
    expect(chits).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('wins the Pirate Islands by capturing its fortress', () => {
    const seed = 'sea-strategy:pirates';
    const r = runGame({
      initial: newGame({
        seed,
        players: 4,
        mode: 'seafarers',
        scenario: 'seafarers/pirateIslands',
      }),
      maxSteps: 20000,
      source: seatSource([hardBot, hardBot, normalBot, normalBot], seed),
    });
    expect(r.failure?.message ?? null).toBeNull();
    expect(r.outcome).toBe('finished');
    expect(fortressOf(r.finalState, r.winner!)?.chits).toBe(0);
  }, 60_000);

  it('never picks up a ship to move it', () => {
    const s = mainPhase(seaGame('newShores'));
    const ctx = ctxOf(s);
    const score = seaScore(ctx, { type: 'seafarers/pickShip', player: 0, edge: 'e:0,0,NE' });
    expect(score).toBeLessThan(0);
  });
});
