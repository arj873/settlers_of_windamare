/**
 * "Learn to play" memory in localStorage, one record per course: finished?, first-visit hint
 * shown? (base only), the run in progress.
 */
import { BASE_COURSE } from './base';
import type { Course } from './course';
import { parseRun, type TutorialRun } from './machine';

/** The base course's key; a module's course uses `catan:tutorial:<id>:v1` (`tutorialKey`). */
export const TUTORIAL_KEY = 'catan:tutorial:v1';

export const tutorialKey = (courseId: string): string =>
  courseId === BASE_COURSE.id ? TUTORIAL_KEY : `catan:tutorial:${courseId}:v1`;

export type TutorialStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface TutorialRecord {
  /** The learner finished or skipped the tutorial once. */
  completed: boolean;
  /** The first-visit hint was shown (it is offered once). */
  offered: boolean;
  /** The tutorial in progress (resumes with its game after a reload). */
  run: TutorialRun | null;
}

const EMPTY: TutorialRecord = { completed: false, offered: false, run: null };

export function defaultTutorialStorage(): TutorialStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** True when nothing was ever saved here (a first visit, as far as the tutorial knows). */
export function hasTutorialRecord(store: TutorialStorage | null): boolean {
  try {
    return (store?.getItem(TUTORIAL_KEY) ?? null) !== null;
  } catch {
    return false;
  }
}

function read(store: TutorialStorage | null, courseId: string): Record<string, unknown> | null {
  try {
    const text = store?.getItem(tutorialKey(courseId));
    if (!text) return null;
    const raw = JSON.parse(text) as Record<string, unknown> | null;
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

export function loadTutorial(store: TutorialStorage | null, course = BASE_COURSE): TutorialRecord {
  const raw = read(store, course.id);
  if (!raw) return EMPTY;
  return {
    completed: raw.completed === true,
    offered: raw.offered === true,
    run: parseRun(raw.run, course),
  };
}

/** The course was finished or skipped once (works before a module's course has loaded). */
export function tutorialCompleted(store: TutorialStorage | null, courseId: string): boolean {
  return read(store, courseId)?.completed === true;
}

export function saveTutorial(
  store: TutorialStorage | null,
  rec: TutorialRecord,
  course: Pick<Course, 'id'> = BASE_COURSE,
): void {
  try {
    store?.setItem(tutorialKey(course.id), JSON.stringify(rec));
  } catch {
    /* quota / privacy mode: the tutorial just doesn't resume */
  }
}
