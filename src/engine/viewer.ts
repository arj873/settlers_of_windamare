/**
 * Who looks at an online view (engine/view.ts), and the one rule every mask follows. No imports
 * besides types, so expansion modules can use it from their `maskFor` hook without import cycles.
 */
import type { GameState, PlayerId } from './types';

/** A seat, or 'spectator' (sees only public information). */
export type Viewer = PlayerId | 'spectator';

/** The public counts of a view (engine/view.ts `ViewInfo`) a `maskFor` hook may adjust. */
interface PublicCounts {
  handCounts: number[];
  devCardCounts: number[];
}

/**
 * For `maskFor` hooks: add per-player cards a module keeps outside the base hands (T&B Swift
 * Journeys are dev cards) to the view's public counts, so the counts stay the true hand sizes
 * once the cards themselves are masked. `view` must be the view a hook was given.
 */
export function addPublicCounts(
  view: GameState,
  extra: { handCounts?: readonly number[]; devCardCounts?: readonly number[] },
): GameState {
  const info = (view as GameState & { view?: PublicCounts }).view;
  if (!info) throw new Error('addPublicCounts: not a view');
  const add = (base: number[], more: readonly number[] | undefined) =>
    more ? base.map((n, p) => n + (more[p] ?? 0)) : base;
  return {
    ...view,
    view: {
      ...info,
      handCounts: add(info.handCounts, extra.handCounts),
      devCardCounts: add(info.devCardCounts, extra.devCardCounts),
    },
  } as GameState;
}

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
