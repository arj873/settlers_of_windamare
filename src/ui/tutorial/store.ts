/** "Learn to play" memory in localStorage: finished?, first-visit hint shown?, the run in progress. */
import { parseRun, type TutorialRun } from './machine';

export const TUTORIAL_KEY = 'catan:tutorial:v1';

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

export function loadTutorial(store: TutorialStorage | null): TutorialRecord {
  try {
    const text = store?.getItem(TUTORIAL_KEY);
    if (!text) return EMPTY;
    const raw = JSON.parse(text) as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') return EMPTY;
    return {
      completed: raw.completed === true,
      offered: raw.offered === true,
      run: parseRun(raw.run),
    };
  } catch {
    return EMPTY;
  }
}

export function saveTutorial(store: TutorialStorage | null, rec: TutorialRecord): void {
  try {
    store?.setItem(TUTORIAL_KEY, JSON.stringify(rec));
  } catch {
    /* quota / privacy mode: the tutorial just doesn't resume */
  }
}
