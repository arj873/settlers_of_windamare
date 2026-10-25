import { describe, expect, it } from 'vitest';
import { midGame } from '../fixtures';
import type { GameState } from '../types';
import { awardHolder, updateAwards } from './awards';
import { addRoads, emptyBoard, settle, zigzag, zigzagJoint } from './roadTestBoard';

/** Rows used for each player's road (vertex-disjoint): p0 row 0, p1 row 1, p2 row -1, p3 row 2. */
const ROWS: [q0: number, r: number][] = [
  [-2, 0],
  [-2, 1],
  [-1, -1],
  [-2, 2],
];

function roads(lengths: number[], holder: number | null = null): GameState {
  const s = emptyBoard();
  lengths.forEach((n, p) => {
    const [q0, r] = ROWS[p]!;
    addRoads(s, p, zigzag(q0, r, n));
  });
  s.awards.longestRoad = holder;
  return s;
}

/** Break player 0's row-0 road with an opponent settlement after edge k. */
function breakRoad0(s: GameState, k: number): void {
  settle(s, 3, zigzagJoint(-2, 0, k));
}

function after(s: GameState): GameState {
  updateAwards(s);
  return s;
}

describe('Longest Road', () => {
  it('needs at least 5 roads', () => {
    expect(after(roads([4])).awards.longestRoad).toBe(null);
    expect(after(roads([5])).awards.longestRoad).toBe(0);
  });

  it('tied holder keeps it', () => {
    expect(after(roads([5, 5], 0)).awards.longestRoad).toBe(0);
    expect(after(roads([5, 5], 1)).awards.longestRoad).toBe(1);
  });

  it('transfers when strictly beaten', () => {
    const s = after(roads([5, 6], 0));
    expect(s.awards.longestRoad).toBe(1);
    expect(s.log.at(-1)?.text).toBe('Blue took Longest Road');
  });

  it('nobody gets it on a tie with no holder', () => {
    expect(after(roads([5, 5])).awards.longestRoad).toBe(null);
  });

  it('goes to the unique leader when the holder is broken', () => {
    const s = roads([8, 5], 0);
    breakRoad0(s, 3); // 4 + 4
    expect(after(s).awards.longestRoad).toBe(1);
  });

  it('is set aside when the holder is broken and others tie', () => {
    const s = roads([8, 5, 5], 0);
    breakRoad0(s, 3); // 4 + 4
    const out = after(s);
    expect(out.awards.longestRoad).toBe(null);
    expect(out.log.at(-1)?.text).toBe('Red lost Longest Road; nobody holds it');
  });

  it('holder keeps it after a break if still tied for longest', () => {
    const s = roads([9, 5], 0);
    breakRoad0(s, 4); // 5 + 4
    expect(after(s).awards.longestRoad).toBe(0);
  });

  it('holder keeps it after a break if still uniquely longest', () => {
    const s = roads([10, 5], 0);
    breakRoad0(s, 5); // 6 + 4
    expect(after(s).awards.longestRoad).toBe(0);
  });

  it('is lost when the holder drops below 5 and nobody else qualifies', () => {
    const s = roads([7, 4], 0);
    breakRoad0(s, 3); // 4 + 3
    expect(after(s).awards.longestRoad).toBe(null);
  });

  it('a later strictly-longer road picks it up again', () => {
    const s = roads([8, 5, 5], 0);
    breakRoad0(s, 3);
    updateAwards(s);
    addRoads(s, 2, zigzag(-1, -1, 6));
    expect(after(s).awards.longestRoad).toBe(2);
  });
});

describe('Largest Army', () => {
  function army(knights: number[], holder: number | null = null): GameState {
    const s = emptyBoard();
    knights.forEach((k, p) => (s.players[p]!.knightsPlayed = k));
    s.awards.largestArmy = holder;
    updateAwards(s);
    return s;
  }

  it('needs at least 3 knights', () => {
    expect(army([2]).awards.largestArmy).toBe(null);
    expect(army([3]).awards.largestArmy).toBe(0);
  });

  it('challenger must exceed the holder', () => {
    expect(army([3, 3], 0).awards.largestArmy).toBe(0);
    expect(army([3, 4], 0).awards.largestArmy).toBe(1);
  });

  it('logs the transfer', () => {
    expect(army([3, 4], 0).log.at(-1)?.text).toBe('Blue took Largest Army');
  });
});

describe('updateAwards', () => {
  it('leaves the midGame fixture unchanged', () => {
    const s = midGame();
    const before = JSON.stringify(s);
    updateAwards(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('awardHolder handles empty and null cases', () => {
    expect(awardHolder([0, 0, 0], null, 5)).toBe(null);
    expect(awardHolder([6, 2, 7], 0, 5)).toBe(2);
    expect(awardHolder([6, 7, 7], 0, 5)).toBe(null);
  });
});
