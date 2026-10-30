/**
 * A tutorial's progress as plain data (saved, so a reload resumes) and the pure steps that
 * move it: `advance` after every game render, `next` / `back` / `skip` from the panel buttons.
 * Every step takes the course (default: the base game's).
 */
import type { PlayerId } from '../../engine';
import { BASE_COURSE } from './base';
import type { Course, LessonDef, TutorialCtx } from './course';

export interface TutorialRun {
  /** The tutorial game's seed: the run belongs to that game. */
  seed: string;
  /** The learner's seat. */
  me: PlayerId;
  /** Lessons in the order they were shown (Back pages through them). */
  shown: string[];
  /** Finished: closed with Next, by the player's move, pushed aside, or no longer useful. */
  done: string[];
  /** Event lessons shown as a recap at the end because their event never came up. */
  recapped: string[];
  /** The live lesson on the panel; null = nothing to say right now. */
  current: string | null;
  /** Paging back: an index into `shown`; null = the live lesson. */
  back: number | null;
  collapsed: boolean;
  /** Finished or skipped: the coach is gone. */
  over: boolean;
}

export function newRun(seed: string, me: PlayerId): TutorialRun {
  return {
    seed,
    me,
    shown: [],
    done: [],
    recapped: [],
    current: null,
    back: null,
    collapsed: false,
    over: false,
  };
}

/** A course's lesson by id. */
export function lessonOf(course: Course, id: string): LessonDef {
  const l = course.lessons.find((x) => x.id === id);
  if (!l) throw new Error(`unknown lesson ${id} in tutorial ${course.id}`);
  return l;
}

const ready = (course: Course, c: TutorialCtx, done: ReadonlySet<string>) =>
  course.lessons.filter(
    (l) =>
      l.id !== course.finish &&
      !done.has(l.id) &&
      (l.after ?? []).every((a) => done.has(a)) &&
      l.when(c),
  );

/** The lesson to show next, and whether it is a recap; null = nothing now. */
function choose(
  course: Course,
  c: TutorialCtx,
  done: ReadonlySet<string>,
): { l: LessonDef; recap: boolean } | null {
  const now = ready(course, c, done);
  const pick = now.find((l) => l.urgent) ?? now[0];
  if (pick) return { l: pick, recap: false };
  if (!course.wrapUp(c, done)) return null;
  const missed = course.lessons.find((l) => l.recap && !done.has(l.id));
  if (missed) return { l: missed, recap: true };
  return done.has(course.finish) ? null : { l: lessonOf(course, course.finish), recap: false };
}

/** After a game change: close the live lesson if its moment passed, then pick the next one. */
export function advance(run: TutorialRun, c: TutorialCtx, course = BASE_COURSE): TutorialRun {
  if (run.over) return run;
  const done = new Set(run.done);
  let { current, shown, recapped, back } = run;

  if (current !== null && !recapped.includes(current)) {
    const l = lessonOf(course, current);
    const pushed = !l.urgent && ready(course, c, done).some((x) => x.urgent && x.id !== current);
    if (l.doneWhen?.(c) || pushed) {
      done.add(current);
      current = null;
    }
  }
  for (const l of course.lessons) {
    if (l.id !== current && !done.has(l.id) && l.stale?.(c)) done.add(l.id);
  }
  const pick = current === null ? choose(course, c, done) : null;
  if (pick) {
    current = pick.l.id;
    shown = [...shown, current];
    if (pick.recap) recapped = [...recapped, current];
    back = null;
  }
  const doneList = course.lessons.map((l) => l.id).filter((id) => done.has(id));
  if (
    current === run.current &&
    shown === run.shown &&
    back === run.back &&
    doneList.length === run.done.length
  ) {
    return run;
  }
  return { ...run, done: doneList, current, shown, recapped, back };
}

/** Index of the live lesson in `shown` (one past the end when idle). */
const liveIndex = (run: TutorialRun) =>
  run.current === null ? run.shown.length : run.shown.length - 1;

/** Next: page forward, or finish the live lesson and move on. */
export function next(run: TutorialRun, c: TutorialCtx, course = BASE_COURSE): TutorialRun {
  if (run.over) return run;
  if (run.back !== null) {
    const i = run.back + 1;
    return { ...run, back: i >= liveIndex(run) ? null : i };
  }
  if (run.current === null) return run;
  const finished = run.current;
  const after: TutorialRun = {
    ...run,
    done: run.done.includes(finished) ? run.done : [...run.done, finished],
    current: null,
  };
  if (finished === course.finish) return { ...after, over: true };
  return advance(after, c, course);
}

/** Back: show the lesson before the one on the panel. */
export function back(run: TutorialRun): TutorialRun {
  const from = run.back ?? liveIndex(run);
  return from <= 0 ? run : { ...run, back: from - 1 };
}

export function skip(run: TutorialRun): TutorialRun {
  return { ...run, over: true, current: null, back: null };
}

export function setCollapsed(run: TutorialRun, collapsed: boolean): TutorialRun {
  return { ...run, collapsed };
}

/** What the panel shows. */
export interface PanelView {
  /** null = idle (no lesson right now). */
  lesson: LessonDef | null;
  title: string;
  text: string;
  /** About the current moment (false while paging back). */
  live: boolean;
  /** Shown as a recap: its event never came up. */
  recap: boolean;
  /** A live "your move" line. */
  todo: string | null;
  focus: string | null;
  canBack: boolean;
  canNext: boolean;
  /** The last lesson: Next becomes "Keep playing" next to "New game". */
  final: boolean;
  collapsed: boolean;
}

export const IDLE_TEXT = 'Keep playing. The next tip shows up when it’s useful.';

export function panelView(run: TutorialRun, c: TutorialCtx, course = BASE_COURSE): PanelView {
  const id = run.back !== null ? run.shown[run.back] : run.current;
  const l = id ? lessonOf(course, id) : null;
  const live = run.back === null;
  const recap = id !== null && id !== undefined && run.recapped.includes(id);
  return {
    lesson: l,
    title: l ? l.title : 'Tutorial',
    text: l ? l.text(c, live && !recap) : IDLE_TEXT,
    live,
    recap,
    todo: l && live && !recap ? (l.todo?.(c) ?? null) : null,
    focus: l && live ? (l.focus ?? null) : null,
    canBack: (run.back ?? liveIndex(run)) > 0,
    canNext: run.back !== null || run.current !== null,
    final: live && id === course.finish,
    collapsed: run.collapsed,
  };
}

/** A saved run of `course`, checked field by field (null if it is not one). */
export function parseRun(raw: unknown, course = BASE_COURSE): TutorialRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const isId = (x: unknown): x is string =>
    typeof x === 'string' && course.lessons.some((l) => l.id === x);
  const ids = (x: unknown) => (Array.isArray(x) && x.every(isId) ? (x as string[]) : null);
  const shown = ids(r.shown);
  const done = ids(r.done);
  const recapped = ids(r.recapped);
  if (typeof r.seed !== 'string' || !shown || !done || !recapped) return null;
  if (typeof r.me !== 'number' || !Number.isInteger(r.me) || r.me < 0) return null;
  const current = r.current === null || isId(r.current) ? r.current : undefined;
  if (current === undefined) return null;
  const back =
    typeof r.back === 'number' && Number.isInteger(r.back) && r.back >= 0 && r.back < shown.length
      ? r.back
      : null;
  return {
    seed: r.seed,
    me: r.me,
    shown,
    done,
    recapped,
    current,
    back,
    collapsed: r.collapsed === true,
    over: r.over === true,
  };
}
