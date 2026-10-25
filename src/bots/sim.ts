/**
 * Headless simulator placeholder (T5 owns this). Run: pnpm sim [games] [seed]
 * Plays random bots until game over, no legal actions, or a step cap.
 */
import { actingPlayers, applyAction, createGame, Rng, type GameState } from '../engine';
import { FIXTURE_PLAYERS } from '../engine/fixtures';
import { randomBot } from './index';

const MAX_STEPS = 5_000;

export function simulate(seed: number): { state: GameState; steps: number; reason: string } {
  let state = createGame({ seed, players: FIXTURE_PLAYERS, layout: 'random' });
  // Bot RNG is separate from the game RNG so bot choices never perturb game randomness.
  const botRng = Rng.fromSeed(`bots:${seed}`);
  for (let step = 0; step < MAX_STEPS; step++) {
    if (state.phase.kind === 'gameOver') return { state, steps: step, reason: 'game over' };
    const actor = actingPlayers(state)[0];
    const action = actor === undefined ? null : randomBot(state, actor, botRng);
    if (!action) return { state, steps: step, reason: 'no legal actions' };
    const result = applyAction(state, action);
    if (!result.ok) throw new Error(`illegal action from legalActions: ${result.error}`);
    state = result.state;
  }
  return { state, steps: MAX_STEPS, reason: 'step cap' };
}

const games = Number(process.argv[2] ?? 1);
const seed = Number(process.argv[3] ?? 1);
for (let i = 0; i < games; i++) {
  const { state, steps, reason } = simulate(seed + i);
  console.log(`game ${seed + i}: ${reason} after ${steps} steps, winner=${String(state.winner)}`);
}
