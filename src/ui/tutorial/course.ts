/**
 * A tutorial ("course"): a game factory (mode, fixed seed, seats, bot levels), the lessons the
 * coach shows as their moments come up in that game, and when to wrap up. The base game's course
 * is `base.ts`; an expansion's lives in its module (`src/expansions/<id>/tutorial.ts`, registered
 * through its pack). docs/TUTORIAL.md has the how-to.
 *
 * Lessons are pure: every predicate reads only the game state and the learner's legal actions,
 * so a reload picks up where it was (machine.ts keeps the progress).
 */
import {
  createGame,
  PLAYER_COLORS,
  type Action,
  type GameState,
  type PlayerId,
} from '../../engine';
import type { BotLevel } from '../../bots/levels';
import type { Controller } from '../types';

export interface TutorialCtx {
  readonly state: GameState;
  /** The learner's seat. */
  readonly me: PlayerId;
  /** The learner's legal actions right now. */
  readonly legal: readonly Action[];
}

export interface LessonDef<Id extends string = string> {
  id: Id;
  title: string;
  /** 1-3 short sentences. `live` = about the current moment (false when paging back). */
  text: (c: TutorialCtx, live: boolean) => string;
  /** Lessons that must be finished first. */
  after?: readonly Id[];
  /** Its moment: it may show now. */
  when: (c: TutorialCtx) => boolean;
  /** Closes by itself once this holds (the player did it, or the moment passed). Else: Next. */
  doneWhen?: (c: TutorialCtx) => boolean;
  /** Not shown yet and no longer useful: finished without showing (no recap). */
  stale?: (c: TutorialCtx) => boolean;
  /** The player must act now: it pushes a reading lesson off the panel. */
  urgent?: boolean;
  /** Event lesson: if its event never comes up, it shows as a recap before the end. */
  recap?: boolean;
  /** A live "your move" line while the lesson is up. */
  todo?: (c: TutorialCtx) => string | null;
  /**
   * HUD element to point at: a name the HUD root gets as `data-tut-focus` (tutorial.css styles
   * the base ones; a course styles its own in its stylesheet).
   */
  focus?: string;
  /** Pictures under the text: a key of the course's `visuals` (or a base one). */
  visual?: string;
  /** Offer the base-game tutorial under this lesson while the learner hasn't done it. */
  offerBase?: boolean;
}

export interface Course {
  /** 'base' or the expansion id; also the storage key's middle part. */
  id: string;
  /** Shown in the picker and on the panel: "Base game", "Cities & Knights". */
  name: string;
  /** The game mode (`settings.mode`). */
  mode: string;
  seed: string;
  /** The learner's seat (it also places and plays first). */
  me: PlayerId;
  seats: readonly Controller[];
  botLevels: readonly BotLevel[];
  /** A fresh tutorial game. */
  game(): GameState;
  /** This state is (a later turn of) this course's game. */
  isGame(state: GameState): boolean;
  /** In the order they come up (ties: the first ready one shows). */
  lessons: readonly LessonDef[];
  /** The last lesson ("You're ready"): shown at the wrap-up, never by `when`. */
  finish: string;
  /** Time to show recaps and finish (`done` = finished lessons). */
  wrapUp(c: TutorialCtx, done: ReadonlySet<string>): boolean;
  /** Pictures for `LessonDef.visual` (DOM: built when shown). */
  visuals?: Readonly<Record<string, () => HTMLElement>>;
}

// ---------------------------------------------------------------------------
// Reading the game (helpers for lessons)
// ---------------------------------------------------------------------------

export const phaseKind = (c: TutorialCtx): string => c.state.phase.kind;
export const myTurn = (c: TutorialCtx): boolean => c.state.turn.current === c.me;
/** The learner may do an action of this type now. */
export const can = (c: TutorialCtx, type: string): boolean => c.legal.some((a) => a.type === type);
export const myMain = (c: TutorialCtx): boolean => myTurn(c) && phaseKind(c) === 'main';
/** The learner's turn is over (or it is not their turn / not rolled yet). */
export const turnOver = (c: TutorialCtx): boolean => !myTurn(c) || phaseKind(c) === 'preRoll';
/** The learner's setup step ('settlement' / 'road'), or null. */
export function setupStep(c: TutorialCtx): string | null {
  const p = c.state.phase;
  return p.kind === 'setup' && myTurn(c) ? p.step : null;
}
export const diceSum = (c: TutorialCtx): number | null =>
  c.state.dice ? c.state.dice[0] + c.state.dice[1] : null;

/** How many of the learner's turns have started (setup is turn 0). */
export function myTurnsStarted(c: TutorialCtx): number {
  const n = c.state.players.length;
  const first = 1 + ((c.me - c.state.settings.startingPlayer + n) % n);
  const t = c.state.turn.number;
  return t < first ? 0 : Math.floor((t - first) / n) + 1;
}

/** A rolled 7 is being resolved (discards, robber, steal), not a Knight. */
export function sevenNow(c: TutorialCtx): boolean {
  const kind = phaseKind(c);
  if (kind === 'discard') return true;
  if (kind !== 'moveRobber' && kind !== 'steal') return false;
  const turn = c.state.turn.number;
  for (let i = c.state.log.length - 1; i >= 0; i--) {
    const e = c.state.log[i];
    if (!e || e.turn !== turn) break;
    const roll = / rolled (\d+)\b/.exec(e.text);
    if (roll) return roll[1] === '7';
    if (/ played /.test(e.text)) return false;
  }
  return false;
}

/** The log of the current turn (oldest first). */
export function turnLog(c: TutorialCtx): readonly string[] {
  const turn = c.state.turn.number;
  const out: string[] = [];
  for (let i = c.state.log.length - 1; i >= 0; i--) {
    const e = c.state.log[i];
    if (!e || e.turn !== turn) break;
    out.push(e.text);
  }
  return out.reverse();
}

/**
 * The usual wrap-up: the game is over; or `gate` is done and either every event lesson happened
 * or the learner's `lastTurn`-th turn started.
 */
export function standardWrapUp(
  lessons: readonly LessonDef[],
  gate: string,
  lastTurn: number,
): Course['wrapUp'] {
  return (c, done) => {
    if (c.state.phase.kind === 'gameOver') return true;
    if (!done.has(gate)) return false;
    if (lessons.every((l) => !l.recap || done.has(l.id))) return true;
    return myTurnsStarted(c) >= lastTurn;
  };
}

export interface CourseSpec<Id extends string> {
  id: string;
  name: string;
  mode: string;
  /** A scenario of the mode (default: the mode's first). */
  scenario?: string;
  /** By convention `learn-<id>-<n>` (registry.ts `looksLikeTutorial`). */
  seed: string;
  /** Default: you + 2 Easy bots, you in seat 0. */
  seats?: readonly Controller[];
  botLevels?: readonly BotLevel[];
  me?: PlayerId;
  lessons: readonly LessonDef<Id>[];
  /** Recaps and the finish wait for this lesson (usually the first-turn lesson). */
  gate: Id;
  finish: Id;
  /** Play on without the coach after this many of the learner's turns (then recaps). */
  lastCoachedTurn: number;
  visuals?: Readonly<Record<string, () => HTMLElement>>;
}

/** A course for an expansion mode: official rules, the learner first, nothing rigged. */
export function defineCourse<Id extends string>(spec: CourseSpec<Id>): Course {
  const seats = spec.seats ?? ['human', 'bot', 'bot'];
  const me = spec.me ?? 0;
  return {
    id: spec.id,
    name: spec.name,
    mode: spec.mode,
    seed: spec.seed,
    me,
    seats,
    botLevels: spec.botLevels ?? seats.map(() => 'easy'),
    lessons: spec.lessons,
    finish: spec.finish,
    wrapUp: standardWrapUp(spec.lessons, spec.gate, spec.lastCoachedTurn),
    ...(spec.visuals ? { visuals: spec.visuals } : {}),
    game: () =>
      createGame({
        seed: spec.seed,
        players: PLAYER_COLORS.slice(0, seats.length).map((p) => ({ ...p })),
        mode: spec.mode,
        ...(spec.scenario ? { scenario: spec.scenario } : {}),
        startingPlayer: me,
      }),
    isGame: (s) =>
      String(s.settings.seed) === spec.seed &&
      s.settings.mode === spec.mode &&
      (!spec.scenario || s.settings.scenario === spec.scenario) &&
      s.players.length === seats.length,
  };
}
