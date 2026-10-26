/**
 * Chess-clock turn timer (settings.timer), pure maths so a client and a future server (M2) can
 * run the same rules. No Date, no timers: callers pass elapsed milliseconds.
 *
 * Each timed player owns a bank. The bank of whoever is on the clock runs down; when a player's
 * turn ends (turn.number moves on, or the setup placement passes), that player gets the
 * increment (Fischer style: added after the move). A player whose bank is empty is "out of time":
 * the client makes their minimum moves (game/turnTimer.ts `timeoutMove`).
 *
 * The legacy per-turn timer (`settings.turnTimerSec`, a fresh countdown per turn) stays as it was;
 * `timerOf(settings)` tells the two apart.
 */
import type { GameSettings, GameState, PlayerId, TimerPreset, TimerSettings } from './types';

export const TIMER_PRESETS: readonly TimerPreset[] = [
  'off',
  'bullet',
  'blitz',
  'rapid',
  'classic',
  'custom',
];

/** Bank and increment (seconds) of each named preset. RULES.md §18.5 has the sources. */
export const TIMER_PRESET_VALUES: Record<
  Exclude<TimerPreset, 'off' | 'custom'>,
  { bankSec: number; incrementSec: number }
> = {
  bullet: { bankSec: 3 * 60, incrementSec: 5 },
  blitz: { bankSec: 5 * 60, incrementSec: 10 },
  rapid: { bankSec: 10 * 60, incrementSec: 15 },
  classic: { bankSec: 20 * 60, incrementSec: 30 },
};

/** Custom limits. */
export const TIMER_BANK_RANGE = { min: 30, max: 3 * 60 * 60 } as const;
export const TIMER_INCREMENT_RANGE = { min: 0, max: 10 * 60 } as const;

export type ResolvedTimer =
  | { kind: 'off' }
  /** Legacy: a fresh countdown of `sec` for every slot (turn, discard, reply ...). */
  | { kind: 'perTurn'; sec: number }
  | { kind: 'bank'; preset: TimerPreset; bankSec: number; incrementSec: number };

/** The timer a game uses: settings.timer (chess clock) wins over the legacy turnTimerSec. */
export function timerOf(settings: GameSettings): ResolvedTimer {
  const t = settings.timer;
  if (t) {
    return { kind: 'bank', preset: t.preset, bankSec: t.bankSec, incrementSec: t.incrementSec };
  }
  if (settings.turnTimerSec) return { kind: 'perTurn', sec: settings.turnTimerSec };
  return { kind: 'off' };
}

/**
 * Settings for a preset; `custom` needs bank and increment. Throws on out-of-range values.
 * 'off' returns null (no settings.timer at all).
 */
export function timerSettings(
  preset: TimerPreset,
  custom?: { bankSec: number; incrementSec: number },
): TimerSettings | null {
  if (preset === 'off') return null;
  if (preset !== 'custom') return { preset, ...TIMER_PRESET_VALUES[preset] };
  if (!custom) throw new Error('custom timer needs bankSec and incrementSec');
  const { bankSec, incrementSec } = custom;
  const inRange = (v: number, r: { min: number; max: number }) =>
    Number.isInteger(v) && v >= r.min && v <= r.max;
  if (!inRange(bankSec, TIMER_BANK_RANGE)) throw new Error(`timer bank out of range: ${bankSec}`);
  if (!inRange(incrementSec, TIMER_INCREMENT_RANGE)) {
    throw new Error(`timer increment out of range: ${incrementSec}`);
  }
  return { preset, bankSec, incrementSec };
}

export function isTimerPreset(x: unknown): x is TimerPreset {
  return typeof x === 'string' && (TIMER_PRESETS as readonly string[]).includes(x);
}

/** Banks, in ms, indexed by PlayerId. */
export type Banks = number[];

export function initialBanks(settings: GameSettings, players: number): Banks {
  const t = timerOf(settings);
  return Array.from({ length: players }, () => (t.kind === 'bank' ? t.bankSec * 1000 : 0));
}

/** Charge `elapsedMs` to `player`'s bank (never below 0). Returns new banks. */
export function chargeBank(banks: Banks, player: PlayerId, elapsedMs: number): Banks {
  if (elapsedMs <= 0 || banks[player] === undefined) return banks;
  const out = [...banks];
  out[player] = Math.max(0, (banks[player] as number) - elapsedMs);
  return out;
}

/**
 * The turn a state belongs to, for increments: one key per setup placement, per regular turn
 * and per special build step. A change of key ends the previous owner's turn.
 */
export function turnKey(state: GameState): { key: string; player: PlayerId } {
  const phase = state.phase;
  const player = state.turn.current;
  if (phase.kind === 'setup') return { key: `setup:${phase.index}`, player };
  if (phase.kind === 'mapVeto') return { key: `veto:${phase.next}`, player };
  if (phase.kind === 'specialBuild') return { key: `sb:${state.turn.number}:${player}`, player };
  // turn.current changes inside a turn only for the second settler's step: a turn of its own.
  return { key: `turn:${state.turn.number}:${player}`, player };
}

/**
 * After a state change from `prev` to `next`: credit the increment to the player whose turn just
 * ended. Banks unchanged when no turn ended or the timer has no increment.
 */
export function creditIncrement(
  settings: GameSettings,
  banks: Banks,
  prev: GameState,
  next: GameState,
): Banks {
  const t = timerOf(settings);
  if (t.kind !== 'bank' || t.incrementSec <= 0) return banks;
  const a = turnKey(prev);
  if (a.key === turnKey(next).key || banks[a.player] === undefined) return banks;
  const out = [...banks];
  out[a.player] = (banks[a.player] as number) + t.incrementSec * 1000;
  return out;
}

/** Sanitize banks from a save: right length, finite, ≥ 0; otherwise fresh banks. */
export function restoreBanks(raw: unknown, settings: GameSettings, players: number): Banks {
  if (
    Array.isArray(raw) &&
    raw.length === players &&
    raw.every((b) => typeof b === 'number' && Number.isFinite(b) && b >= 0)
  ) {
    return [...(raw as number[])];
  }
  return initialBanks(settings, players);
}
