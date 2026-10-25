/**
 * OWNER: T3 (rules-trade).
 * Post-action hook: recompute Longest Road (>= LONGEST_ROAD_MIN, broken by opponent buildings;
 * ties keep the current holder; if nobody uniquely leads after a break, nobody holds it) and
 * Largest Army (>= LARGEST_ARMY_MIN knights; a challenger must exceed the holder).
 * Runs after EVERY successful action, on the draft. Mutate in place.
 */
import type { GameState } from '../types';

export function updateAwards(_draft: GameState): void {
  // not implemented — T3
}
