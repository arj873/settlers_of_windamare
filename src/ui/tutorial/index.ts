/** "Learn to play" (tutorial mode): a coach panel over a normal hotseat game. */
export { TutorialCoach, offerTutorial, type CoachHost } from './coach';
export { isTutorialGame } from './game';
export { openTutorialPicker, type PickerEntry } from './picker';
export {
  TUTORIAL_MODULES,
  courseById,
  courseOfGame,
  looksLikeTutorial,
  registerCourse,
} from './registry';
export type { Course, LessonDef, TutorialCtx } from './course';
