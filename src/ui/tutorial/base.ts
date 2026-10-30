/** The base game's course: the "Learn to play" game (game.ts) and its lessons (lessons.ts). */
import type { Course } from './course';
import {
  TUTORIAL_BOT_LEVELS,
  TUTORIAL_ME,
  TUTORIAL_SEATS,
  TUTORIAL_SEED,
  isTutorialGame,
  tutorialGame,
} from './game';
import { LESSONS, wrapUp, type LessonId } from './lessons';

export const BASE_COURSE: Course = {
  id: 'base',
  name: 'Base game',
  mode: 'base',
  seed: TUTORIAL_SEED,
  me: TUTORIAL_ME,
  seats: TUTORIAL_SEATS,
  botLevels: TUTORIAL_BOT_LEVELS,
  game: tutorialGame,
  isGame: isTutorialGame,
  lessons: LESSONS,
  finish: 'finish',
  wrapUp: (c, done) => wrapUp(c, done as ReadonlySet<LessonId>),
};
