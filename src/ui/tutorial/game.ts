/**
 * The tutorial game: a normal base game (beginner map, 10 VP, official rules), you + 2 Easy bots.
 * Nothing is rigged: the fixed seed was picked (headless search, 3 play styles for the learner)
 * so the learner places first, collects on their first roll (an 8), rolls a 7 themselves on their
 * second turn, and can usually build and buy a development card within the first few turns.
 * The rolls stay as described until the first robber steal; after that they follow the seed.
 */
import { createGame, PLAYER_COLORS, type GameState, type PlayerId } from '../../engine';
import type { BotLevel } from '../../bots/levels';
import type { Controller } from '../types';

export const TUTORIAL_SEED = 'learn-34';
/** The learner's seat (it also places and plays first). */
export const TUTORIAL_ME: PlayerId = 0;
export const TUTORIAL_SEATS: readonly Controller[] = ['human', 'bot', 'bot'];
export const TUTORIAL_BOT_LEVELS: readonly BotLevel[] = ['easy', 'easy', 'easy'];
/** Bot moves are at least this slow while the coach is on (ms per move), so the learner can follow. */
export const TUTORIAL_PACE_MS = 900;

export function tutorialGame(): GameState {
  return createGame({
    seed: TUTORIAL_SEED,
    players: PLAYER_COLORS.slice(0, TUTORIAL_SEATS.length).map((p) => ({ ...p })),
    map: 'base',
    startingPlayer: TUTORIAL_ME,
  });
}

/** This state is (a later turn of) the tutorial game. */
export function isTutorialGame(state: GameState): boolean {
  return (
    String(state.settings.seed) === TUTORIAL_SEED &&
    state.settings.map === 'base' &&
    state.settings.mode === 'base' &&
    state.players.length === TUTORIAL_SEATS.length
  );
}
