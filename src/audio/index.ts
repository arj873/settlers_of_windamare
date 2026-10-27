/** Sound effects (A1): synthesized recipes, settings, rate limiting and the page's engine. */
import { SoundEngine } from './engine';

export * from './types';
export { BASE_SOUNDS, type BaseSoundId } from './recipes';
export { SoundEngine, type SoundEngineOptions } from './engine';
export { SoundLimiter, coalesce, DEFAULT_LIMITS, type LimiterOptions } from './limiter';
export {
  DEFAULT_SOUND,
  SOUND_KEY,
  isHeadless,
  loadSoundSettings,
  masterGain,
  saveSoundSettings,
  type SoundSettings,
} from './settings';

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    // Not in Node (tests), whose global localStorage warns on access.
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The page's one sound engine (settings widgets and the game share it). Silent until main.ts
 * unlocks it on a user gesture; in tests there is no AudioContext, so it never plays.
 */
export const sfx = new SoundEngine({ storage: storage() });
