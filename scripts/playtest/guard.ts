/**
 * Seat guard: which seat owns the screen right now, what it must do, and whether an acting
 * command from a given seat is allowed. Pure (works on a Snapshot), so it is unit-tested.
 *
 * The rule: only the seat the controller shows the screen to (the hotseat viewer) may act, and
 * only when it has a legal action. While the "Pass to <name>" cover is up, that seat may only
 * `pass`. This keeps three agents from clicking over each other.
 */
import type { Action, GameState, PlayerId } from '../../src/engine';
import type { Snapshot } from './protocol';

export type Verdict = { ok: true } | { ok: false; reason: string };

const nameOf = (state: GameState, p: PlayerId | null) =>
  p === null ? 'nobody' : (state.players[p]?.name ?? `P${p}`);

/** Players who have at least one legal action. */
export function actors(legal: readonly Action[]): PlayerId[] {
  return [...new Set(legal.map((a) => a.player))].sort((a, b) => a - b);
}

/** One line: what `seat` has to do now (assumes it is their moment). */
export function mustDo(state: GameState, seat: PlayerId, legal: readonly Action[]): string {
  const mine = legal.filter((a) => a.player === seat);
  const phase = state.phase;
  if (phase.kind === 'gameOver') return `Game over: ${nameOf(state, state.winner)} won.`;
  if (mine.length === 0) return 'Nothing to do right now.';
  switch (phase.kind) {
    case 'setup':
      return phase.step === 'settlement'
        ? 'Place your setup settlement: run `spots`, then `click-spot N`.'
        : 'Place your setup road next to the new settlement: `spots`, then `click-spot N`.';
    case 'preRoll':
      return 'Roll the dice: `click Roll dice` (you may play a ready development card first).';
    case 'main':
      return 'Your turn: build, trade or play a card, then `click End turn`.';
    case 'discard':
      return `Discard ${phase.pending[seat] ?? 0} cards: \`set <resource> <count>\` for each, then \`click Discard\`.`;
    case 'moveRobber':
      return 'Move the robber: `spots`, then `click-spot N`.';
    case 'steal':
      return 'Choose who to rob: `click <player name>`.';
    case 'roadBuilding':
      return `Place a free road (${phase.remaining} left): \`spots\`, then \`click-spot N\`.`;
    case 'trade':
      return phase.offer.from === seat
        ? 'Your trade offer is open: confirm with an accepting player (`click <name>: Trade`) or `click Cancel offer`.'
        : `${nameOf(state, phase.offer.from)} offers you a trade: \`click Accept\` or \`click Reject\`.`;
  }
}

/** Why `seat` should wake from `wait`, or null to keep waiting. */
export function wakeReason(snap: Snapshot, seat: PlayerId): string | null {
  const state = snap.state;
  if (!state) return null;
  if (state.phase.kind === 'gameOver') return `GAME OVER: ${nameOf(state, state.winner)} won.`;
  if (snap.legal.length === 0) {
    return `STALLED: nobody has a legal action in phase "${state.phase.kind}". Report this as a blocker.`;
  }
  if (snap.viewer !== seat || !snap.legal.some((a) => a.player === seat)) return null;
  const covered = snap.ui.cover !== null;
  return `YOUR MOVE${covered ? ' (screen is covered: run `pass` first)' : ''}: ${mustDo(state, seat, snap.legal)}`;
}

/** Who the table is waiting on (for `wait` timeouts and refusals). */
export function waitingOn(snap: Snapshot): string {
  const state = snap.state;
  if (!state) return 'the game to load';
  const who = actors(snap.legal).map((p) => nameOf(state, p));
  const screen = nameOf(state, snap.viewer);
  return `screen is with ${screen}; can act: ${who.length > 0 ? who.join(', ') : 'nobody'}`;
}

/**
 * May `seat` run an acting command? `pass` is the only command allowed while the cover is up,
 * and it is only allowed then.
 */
export function actingVerdict(snap: Snapshot, seat: PlayerId, cmd: 'act' | 'pass'): Verdict {
  const state = snap.state;
  if (!state) return { ok: false, reason: 'The game has not loaded yet.' };
  if (snap.ui.screen === 'winner' || state.phase.kind === 'gameOver') {
    return { ok: false, reason: 'The game is over. You can still use status, shot and report.' };
  }
  if (snap.viewer !== seat) {
    return {
      ok: false,
      reason: `Not your moment: ${waitingOn(snap)}. Run \`wait\`.`,
    };
  }
  const covered = snap.ui.cover !== null;
  if (cmd === 'pass') {
    return covered ? { ok: true } : { ok: false, reason: 'No cover is showing; just act.' };
  }
  if (covered) return { ok: false, reason: 'The hotseat cover is up: run `pass` first.' };
  if (!snap.legal.some((a) => a.player === seat)) {
    return { ok: false, reason: `You have nothing to do right now (${waitingOn(snap)}).` };
  }
  return { ok: true };
}

type LogEntry = GameState['log'][number];
const key = (e: LogEntry) => `${e.turn}|${e.player}|${e.text}`;

/**
 * Log entries in `after` that were not in `before`. The engine trims the log to its newest
 * entries, so this aligns on the longest suffix of `before` that is a prefix-run in `after`.
 */
export function newLogEntries(before: readonly LogEntry[], after: readonly LogEntry[]): LogEntry[] {
  if (before.length === 0) return [...after];
  const a = after.map(key);
  const b = before.map(key);
  // Align `before`'s last entry with each position in `after` (newest first) and accept the
  // first position where the overlap matches all the way back.
  for (let end = a.length - 1; end >= 0; end--) {
    let i = end;
    let j = b.length - 1;
    while (i >= 0 && j >= 0 && a[i] === b[j]) {
      i--;
      j--;
    }
    if (i < 0 || j < 0) return after.slice(end + 1);
  }
  return [...after];
}
