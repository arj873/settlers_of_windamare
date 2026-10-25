/**
 * OWNER: T3 (rules-trade).
 * Post-action hook: recompute Longest Road (>= LONGEST_ROAD_MIN, broken by opponent buildings;
 * ties keep the current holder; if nobody uniquely leads after a break, nobody holds it) and
 * Largest Army (>= LARGEST_ARMY_MIN knights; a challenger must exceed the holder).
 * Runs after EVERY successful action, on the draft. Mutate in place.
 */
import { LARGEST_ARMY_MIN, LONGEST_ROAD_MIN } from '../constants';
import { log } from '../actions/common';
import type { GameState, PlayerId } from '../types';
import { longestRoadLengths } from './longestRoad';

/**
 * Shared award rule. `scores[p]` is p's metric; returns the new holder.
 * - The holder keeps the award while still qualifying and not strictly beaten.
 * - Otherwise the award goes to the unique qualifying leader, or to nobody on a tie.
 */
export function awardHolder(
  scores: readonly number[],
  holder: PlayerId | null,
  min: number,
): PlayerId | null {
  const max = Math.max(...scores);
  if (holder !== null && (scores[holder] ?? 0) >= min && (scores[holder] ?? 0) >= max) {
    return holder;
  }
  if (max < min) return null;
  const leaders = scores.flatMap((s, p) => (s === max ? [p] : []));
  return leaders.length === 1 ? (leaders[0] ?? null) : null;
}

export function updateAwards(draft: GameState): void {
  const name = (p: PlayerId) => draft.players[p]?.name ?? `Player ${p}`;

  const road = awardHolder(longestRoadLengths(draft), draft.awards.longestRoad, LONGEST_ROAD_MIN);
  if (road !== draft.awards.longestRoad) {
    const prev = draft.awards.longestRoad;
    draft.awards.longestRoad = road;
    if (road !== null) log(draft, road, `${name(road)} took Longest Road`);
    else if (prev !== null) log(draft, prev, `${name(prev)} lost Longest Road; nobody holds it`);
  }

  // Knights never decrease, so Largest Army only ever moves to a strictly larger army.
  const army = awardHolder(
    draft.players.map((p) => p.knightsPlayed),
    draft.awards.largestArmy,
    LARGEST_ARMY_MIN,
  );
  if (army !== draft.awards.largestArmy) {
    draft.awards.largestArmy = army;
    if (army !== null) log(draft, army, `${name(army)} took Largest Army`);
  }
}
