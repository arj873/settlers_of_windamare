// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, Rng, type GameState } from '../engine';
import { midGame } from '../engine/fixtures';
import { LogList, logList } from './sidebar';

/** A few random legal moves after `state`, each state kept. */
function play(state: GameState, moves: number, seed = 7): GameState[] {
  const rng = new Rng(seed);
  const out = [state];
  for (let i = 0; i < moves; i++) {
    const legal = legalActions(state).filter((a) => a.type !== 'offerTrade');
    const r = applyAction(state, rng.pick(legal));
    if (!r.ok) throw new Error(r.error);
    state = r.state;
    out.push(state);
  }
  return out;
}

describe('LogList (s17)', () => {
  it('shows the same DOM as a fresh logList after every move', () => {
    const list = new LogList();
    for (const s of play(midGame(), 60)) {
      list.update(s, 1);
      expect(list.element.outerHTML).toBe(logList(s, 1).outerHTML);
    }
  });

  it('keeps the groups whose entries did not change', () => {
    const states = play(midGame(), 30);
    const list = new LogList();
    list.update(states[0]!, 1);
    const first = list.element.firstElementChild;
    list.update(states.at(-1)!, 1);
    expect(list.element.firstElementChild).toBe(first);
  });

  it('rebuilds everything for another viewer (private texts)', () => {
    const s = midGame();
    const list = new LogList();
    list.update(s, 1);
    const first = list.element.firstElementChild;
    list.update(s, 2);
    expect(list.element.firstElementChild).not.toBe(first);
    expect(list.element.outerHTML).toBe(logList(s, 2).outerHTML);
  });
});
