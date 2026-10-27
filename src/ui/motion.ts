/**
 * The "Animations" setting (HUD menu, saved in localStorage like the theme) and the system's
 * `prefers-reduced-motion`. Either one off: no flying cards, results still show as badges.
 */
import { browserThemeStorage, type ThemeStorage } from './theme';

export const ANIMATIONS_KEY = 'catan.animations';

/** The saved setting: on unless the player turned it off. */
export function loadAnimations(storage: ThemeStorage | null = browserThemeStorage()): boolean {
  try {
    return storage?.getItem(ANIMATIONS_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveAnimations(on: boolean, storage: ThemeStorage | null = browserThemeStorage()) {
  try {
    storage?.setItem(ANIMATIONS_KEY, on ? 'on' : 'off');
  } catch {
    // Full or blocked storage: the choice just isn't remembered.
  }
}

/** The system asks for reduced motion (false where it cannot be asked: node, old browsers). */
export function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}
