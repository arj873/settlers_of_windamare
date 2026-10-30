/**
 * Which tutorials exist. The base course is built in; an expansion's course lives in its module's
 * chunk and registers when the module loads (`ExpansionPack.tutorial`, expansions/load.ts). The
 * picker lists expansion tutorials before their module loads, so they are named here too.
 *
 * ADDING ONE (docs/TUTORIAL.md): the module id in TUTORIAL_MODULES, `tutorial` in its pack.ts.
 */
import type { ExpansionId, GameState } from '../../engine';
import { BASE_COURSE } from './base';
import type { Course } from './course';

/** Modules with a tutorial (their id is the course id and the mode id), picker order. */
export const TUTORIAL_MODULES: readonly ExpansionId[] = ['ck', 'seafarers', 'ep'];

const courses = new Map<string, Course>([[BASE_COURSE.id, BASE_COURSE]]);

/** A module's course (when its pack loads; the same one again does nothing). */
export function registerCourse(course: Course): void {
  const have = courses.get(course.id);
  if (have === course) return;
  if (have) throw new Error(`a tutorial "${course.id}" is already registered`);
  courses.set(course.id, course);
}

/** A loaded course ('base' always; a module's once its pack loaded). */
export const courseById = (id: string): Course | undefined => courses.get(id);

/** The course whose game `state` is (loaded courses only). */
export function courseOfGame(state: GameState): Course | undefined {
  for (const c of courses.values()) if (c.isGame(state)) return c;
  return undefined;
}

/** A tutorial game by its seed (`learn-…`), also before its module has loaded (resume prompt). */
export function looksLikeTutorial(state: GameState): boolean {
  const mode = state.settings.mode;
  return (
    courseOfGame(state) !== undefined ||
    (String(state.settings.seed).startsWith('learn-') && TUTORIAL_MODULES.includes(mode))
  );
}
