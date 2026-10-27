/**
 * "What changed since your last turn" (#33): remembers the state each player's turn ended in, so
 * the board can briefly mark what the others built in between when that player's turn starts
 * again (`BoardView.markSince`). Pure bookkeeping, no DOM.
 */
import type { GameState, PlayerId } from '../engine';

export class TurnRecap {
  private readonly since = new Map<PlayerId, GameState>();

  /**
   * Call with each newly shown state (`prev` = the one shown before). Returns the state to recap
   * from when `viewer`'s turn has just started, else null.
   */
  update(prev: GameState | null, next: GameState, viewer: PlayerId | null): GameState | null {
    if (!prev || next.turn.number === prev.turn.number) return null;
    if (next.turn.number < prev.turn.number) {
      // Another game.
      this.since.clear();
      return null;
    }
    // prev's player has finished: what they left behind is their baseline.
    this.since.set(prev.turn.current, next);
    if (viewer === null || viewer < 0 || next.turn.current !== viewer) return null;
    const from = this.since.get(viewer) ?? null;
    this.since.delete(viewer);
    return from === next ? null : from;
  }

  clear(): void {
    this.since.clear();
  }
}
