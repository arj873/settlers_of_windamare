/**
 * HUD themes: token sets in CSS (`wood.css` is the `:root` default, the others override it under
 * `:root[data-theme='…']`). `applyTheme` only sets the attribute on <html>, so the HUD, setup
 * screen, toasts and page background all switch together at runtime.
 */
// Bundled fonts: @font-face only, a browser fetches a file once a theme actually uses it.
import '@fontsource/im-fell-english-sc/400.css';
import '@fontsource/alegreya/400.css';
import '@fontsource/alegreya/400-italic.css';
import '@fontsource/alegreya/700.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/500.css';
import '@fontsource/alegreya-sans/700.css';
import '@fontsource/alegreya-sans/800.css';
import '@fontsource-variable/fraunces';
import '@fontsource/figtree/400.css';
import '@fontsource/figtree/500.css';
import '@fontsource/figtree/600.css';
import '@fontsource/figtree/700.css';
import '@fontsource/figtree/800.css';
import '@fontsource/marcellus/400.css';
import '@fontsource-variable/nunito';
import './wood.css';
import './chartroom.css';
import './parlour.css';
import './sunfired.css';

export const THEMES = ['wood', 'chartroom', 'parlour', 'sunfired'] as const;
export type ThemeName = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeName = 'wood';

export function isTheme(name: string | null | undefined): name is ThemeName {
  return (THEMES as readonly string[]).includes(name ?? '');
}

/** `?theme=<name>` from a query string; unknown or missing names give the default. */
export function themeFromSearch(search: string): ThemeName {
  const name = new URLSearchParams(search).get('theme');
  return isTheme(name) ? name : DEFAULT_THEME;
}

/** Switch the whole page to a theme. */
export function applyTheme(name: ThemeName, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = name;
}
