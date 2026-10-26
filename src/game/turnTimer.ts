/**
 * Turn timer, pure: which human is on the clock, how the clock moves between states, and what a
 * timed-out player does. The controller ticks it; no DOM, no timers. Two kinds (engine `timerOf`):
 * the legacy per-turn timer (settings.turnTimerSec, `syncClock`: a fresh countdown per slot) and
 * the chess clock (settings.timer, `syncBankClock`: each player's bank, engine clock.ts).
 *
 * Slots (one human on the clock at a time; bots are never timed):
 *  - `turn`   the current player's whole turn: setup placement, roll, robber, free roads, own
 *             trade offer once nobody human still has to reply, main phase.
 *  - `discard` / `trade`  a human who owes a discard or a trade reply (the viewer first, as in
 *             pickViewer). The interrupted turn clock is stashed and resumes afterwards, so
 *             waiting for others never costs the current player time.
 *  - `specialBuild`  one special build step.
 * A new slot starts with the full time. Timeout moves are the minimum legal moves (`timeoutMove`).
 */
import {
  creditIncrement,
  type Action,
  type Banks,
  type GameState,
  type PlayerId,
  type Rng,
} from '../engine';
import { obligated, type Seats } from './logic';

export type SlotKind = 'turn' | 'discard' | 'trade' | 'specialBuild';

export interface TimerSlot {
  /** Identity: a new key means a fresh countdown. */
  key: string;
  kind: SlotKind;
  player: PlayerId;
}

export interface TurnClock {
  key: string | null;
  kind: SlotKind | null;
  player: PlayerId | null;
  remainingMs: number;
  totalMs: number;
  /** A turn clock interrupted by a discard / trade reply / bot reaction, resumed when it returns. */
  stash: { key: string; player: PlayerId; remainingMs: number } | null;
}

export const IDLE_CLOCK: TurnClock = {
  key: null,
  kind: null,
  player: null,
  remainingMs: 0,
  totalMs: 0,
  stash: null,
};

const canAct = (legal: readonly Action[], p: PlayerId) => legal.some((a) => a.player === p);

/** The human on the clock right now, or null (bot to move, game over, no timer). */
export function timerSlot(
  state: GameState,
  seats: Seats,
  legal: readonly Action[],
  viewer: PlayerId | null,
): TimerSlot | null {
  const phase = state.phase;
  if (phase.kind === 'gameOver') return null;
  const turn = state.turn.number;

  if (phase.kind === 'discard' || phase.kind === 'trade' || phase.kind === 'event') {
    const owed = obligated(state).filter((p) => seats[p] === 'human' && canAct(legal, p));
    const p = viewer !== null && owed.includes(viewer) ? viewer : owed[0];
    if (p !== undefined) {
      // Several offers per turn: the offer counter tells them apart.
      const id = phase.kind === 'trade' ? `${turn}:${state.turn.tradeOffers}` : `${turn}`;
      // An event task is a reaction like a discard (it never costs the current player time).
      const kind = phase.kind === 'event' ? 'discard' : phase.kind;
      return { key: `${phase.kind}:${id}:${p}`, kind, player: p };
    }
    // Nobody human owes anything: only a trade offerer can still act (confirm / cancel).
    if (phase.kind !== 'trade') return null;
  }

  const cur = state.turn.current;
  if (seats[cur] !== 'human' || !canAct(legal, cur)) return null;
  if (phase.kind === 'specialBuild') {
    return { key: `specialBuild:${turn}:${cur}`, kind: 'specialBuild', player: cur };
  }
  if (phase.kind === 'setup') return { key: `setup:${phase.index}`, kind: 'turn', player: cur };
  return { key: `turn:${turn}:${cur}`, kind: 'turn', player: cur };
}

/** Move the clock to `slot` (after a state change). `totalMs` = settings.turnTimerSec * 1000. */
export function syncClock(clock: TurnClock, slot: TimerSlot | null, totalMs: number): TurnClock {
  if (slot && slot.key === clock.key) return clock;
  // Leaving a running turn for something that is not another turn: keep its time for later.
  const keep =
    clock.kind === 'turn' &&
    clock.key !== null &&
    clock.player !== null &&
    slot?.kind !== 'turn' &&
    slot?.kind !== 'specialBuild'
      ? { key: clock.key, player: clock.player, remainingMs: clock.remainingMs }
      : clock.stash;
  if (!slot) return { ...IDLE_CLOCK, stash: keep };
  const at = (remainingMs: number, stash: TurnClock['stash']): TurnClock => ({
    key: slot.key,
    kind: slot.kind,
    player: slot.player,
    remainingMs,
    totalMs,
    stash,
  });
  if (keep && keep.key === slot.key) return at(keep.remainingMs, null);
  if (slot.kind === 'turn' || slot.kind === 'specialBuild') return at(totalMs, null);
  // A player whose turn already timed out gets no fresh time to discard on their own 7.
  const timedOut = keep !== null && keep.player === slot.player && keep.remainingMs <= 0;
  return at(timedOut ? 0 : totalMs, keep);
}

/**
 * Chess clock (settings.timer, engine clock.ts): write the running clock's time back into its
 * player's bank. Call before changing banks (increments) or the slot.
 */
export function flushBank(clock: TurnClock, banks: Banks): Banks {
  const p = clock.player;
  if (clock.key === null || p === null || banks[p] === undefined) return banks;
  if (banks[p] === clock.remainingMs) return banks;
  const out = [...banks];
  out[p] = clock.remainingMs;
  return out;
}

/**
 * Chess clock: put `slot`'s player on the clock with whatever their bank holds (no stash, no
 * fresh time: the bank is the time). `bankMs` = the starting bank, shown as the total.
 */
export function syncBankClock(
  clock: TurnClock,
  banks: Banks,
  slot: TimerSlot | null,
  bankMs: number,
): { clock: TurnClock; banks: Banks } {
  const flushed = flushBank(clock, banks);
  if (!slot) return { clock: IDLE_CLOCK, banks: flushed };
  return {
    clock: {
      key: slot.key,
      kind: slot.kind,
      player: slot.player,
      remainingMs: flushed[slot.player] ?? 0,
      totalMs: bankMs,
      stash: null,
    },
    banks: flushed,
  };
}

/**
 * Chess clock, after an action took the game from `prev` to `next`: bank the running time and
 * credit the increment of a turn that just ended. The clock keeps its slot (so a timeout's pacing
 * is not reset); its remaining time follows the (credited) bank. Call `syncBankClock` next.
 */
export function bankAfterAction(
  clock: TurnClock,
  banks: Banks,
  prev: GameState,
  next: GameState,
): { clock: TurnClock; banks: Banks } {
  const credited = creditIncrement(prev.settings, flushBank(clock, banks), prev, next);
  const p = clock.player;
  if (clock.key === null || p === null) return { clock, banks: credited };
  return { clock: { ...clock, remainingMs: credited[p] ?? clock.remainingMs }, banks: credited };
}

export function tickClock(clock: TurnClock, dtMs: number): TurnClock {
  if (clock.key === null || dtMs <= 0 || clock.remainingMs <= 0) return clock;
  return { ...clock, remainingMs: Math.max(0, clock.remainingMs - dtMs) };
}

export function isExpired(clock: TurnClock): boolean {
  return clock.key !== null && clock.remainingMs <= 0;
}

/** What the HUD shows (`HudView.turnTimer`), or null when nobody is on the clock. */
export function clockView(clock: TurnClock): { remainingSec: number; totalSec: number } | null {
  if (clock.key === null) return null;
  return { remainingSec: clock.remainingMs / 1000, totalSec: clock.totalMs / 1000 };
}

/**
 * The minimum move for a timed-out `player`: roll, discard a random legal selection, move the
 * robber / steal / place setup pieces and free roads at random, reject a trade reply or cancel
 * the own offer, pass the special build step, end the turn. Null when `player` cannot act.
 */
export function timeoutMove(
  state: GameState,
  legal: readonly Action[],
  player: PlayerId,
  rng: Rng,
): Action | null {
  const mine = legal.filter((a) => a.player === player);
  const first = (...types: Action['type'][]) => {
    for (const t of types) {
      const options = mine.filter((a) => a.type === t);
      if (options.length > 0) return rng.pick(options);
    }
    return null;
  };
  switch (state.phase.kind) {
    case 'setup':
      return first('placeSetupSettlement', 'placeSetupRoad');
    case 'preRoll':
      return first('rollDice');
    case 'discard':
      return first('discard');
    case 'moveRobber':
      return first('moveRobber');
    case 'steal':
      return first('steal');
    case 'roadBuilding':
      return first('placeFreeRoad');
    case 'trade':
      return first('rejectTrade', 'cancelTrade');
    case 'main':
      return first('endTurn');
    case 'specialBuild':
      return first('passSpecialBuild');
    case 'mapVeto':
      return first('vetoMap');
    case 'event':
      // Pass an optional steal; otherwise a random choice.
      return (
        mine.find((a) => a.type === 'eventSteal' && a.victim === null) ??
        first('eventGain', 'eventGive', 'eventSteal', 'eventDamageRoad')
      );
    case 'gameOver':
      return null;
  }
}
