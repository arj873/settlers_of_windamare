/**
 * Who looks at an online view (engine/view.ts), and the one rule every mask follows. No imports
 * besides types, so expansion modules can use it from their `maskFor` hook without import cycles.
 */
import type { GameState, PlayerId } from './types';

/** A seat, or 'spectator' (sees only public information). */
export type Viewer = PlayerId | 'spectator';

/**
 * Is `owner`'s secret hidden from `viewer`? Yes for everyone but the owner (a spectator owns
 * nothing), until the game is over: then hands are revealed (decks, rng and seed stay hidden).
 */
export function hiddenFrom(
  state: Pick<GameState, 'phase'>,
  viewer: Viewer,
  owner: PlayerId,
): boolean {
  return state.phase.kind !== 'gameOver' && owner !== viewer;
}
