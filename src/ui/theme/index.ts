/**
 * HUD themes: token sets in CSS (`wood.css` is the `:root` base, every theme overrides it under
 * `:root[data-theme='…']`). The active theme is the `data-theme` attribute on <html>, so the HUD,
 * setup screen, toasts and page background all switch together at runtime.
 *
 * Choice order on load: `?theme=` (dev / sharing), then the saved pick, then DEFAULT_THEME.
 * `setTheme` (the pickers) applies, saves and tells listeners (main.ts redraws the board frame).
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
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import './wood.css';
import './chartroom.css';
import './parlour.css';
import './sunfired.css';
import './githubdark.css';
import './materialdark.css';
import './picker.css';

/** Picker order. */
export const THEMES = [
  'sunfired',
  'chartroom',
  'parlour',
  'wood',
  'githubdark',
  'materialdark',
] as const;
export type ThemeName = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeName = 'sunfired';
export const THEME_KEY = 'catan.theme';

/** Picker label and a static preview: panel, header, accent, text (the CSS of other themes is not live). */
export const THEME_INFO: Record<ThemeName, { label: string; swatch: readonly string[] }> = {
  sunfired: { label: 'Sunfired', swatch: ['#96452a', '#1f4fa0', '#f5b82e', '#fbf3e4'] },
  chartroom: { label: 'Chartroom', swatch: ['#efe2c4', '#2c1d10', '#9e2a1f', '#1f4767'] },
  parlour: { label: 'Parlour', swatch: ['#5e1f2c', '#d8ad55', '#f4ead6', '#0d2233'] },
  wood: { label: 'Wood', swatch: ['#6e411f', '#b47a49', '#f2c35a', '#fff3dc'] },
  githubdark: { label: 'GitHub Dark', swatch: ['#161b22', '#30363d', '#2f81f7', '#e6edf3'] },
  materialdark: { label: 'Material Dark', swatch: ['#211f24', '#4a4458', '#d0bcff', '#e6e1e5'] },
};

export type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function isTheme(name: string | null | undefined): name is ThemeName {
  return (THEMES as readonly string[]).includes(name ?? '');
}

/** `?theme=<name>` from a query string, or null when missing / unknown. */
export function themeFromSearch(search: string): ThemeName | null {
  const name = new URLSearchParams(search).get('theme');
  return isTheme(name) ? name : null;
}

/** localStorage, or null where it is blocked (private mode, sandboxed frames, node). */
export function browserThemeStorage(): ThemeStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadTheme(storage: ThemeStorage | null): ThemeName | null {
  try {
    const name = storage?.getItem(THEME_KEY);
    return isTheme(name) ? name : null;
  } catch {
    return null;
  }
}

export function saveTheme(storage: ThemeStorage | null, name: ThemeName): void {
  try {
    storage?.setItem(THEME_KEY, name);
  } catch {
    // Full or blocked storage: the pick just isn't remembered.
  }
}

/** Set the attribute only (no save, no listeners). */
export function applyTheme(name: ThemeName, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = name;
}

let current: ThemeName = DEFAULT_THEME;
let store: ThemeStorage | null = null;
const listeners = new Set<(name: ThemeName) => void>();

export function currentTheme(): ThemeName {
  return current;
}

/** Called after every `setTheme`; returns an unsubscribe function. */
export function onThemeChange(cb: (name: ThemeName) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Pick the theme on load (`?theme=` > saved > default) and apply it. */
export function initTheme(
  search: string,
  storage: ThemeStorage | null = browserThemeStorage(),
  root?: HTMLElement,
): ThemeName {
  store = storage;
  current = themeFromSearch(search) ?? loadTheme(storage) ?? DEFAULT_THEME;
  applyTheme(current, root);
  return current;
}

/** Switch theme from a picker: apply, remember, notify. */
export function setTheme(name: ThemeName, root?: HTMLElement): void {
  current = name;
  applyTheme(name, root);
  saveTheme(store, name);
  for (const cb of listeners) cb(name);
}

/** "#rrggbb" (or "#rgb") to 0xrrggbb; null when it isn't one. */
export function parseHexColor(value: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m?.[1]) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return parseInt(hex, 16);
}

export interface BoardFrameColors {
  frame: number;
  frameDark: number;
  frameLight: number;
}

/** The active theme's board frame (`--board-frame*` tokens) for the Pixi board, or null. */
export function boardFrameColors(
  root: HTMLElement = document.documentElement,
): BoardFrameColors | null {
  const css = getComputedStyle(root);
  const read = (name: string) => parseHexColor(css.getPropertyValue(name));
  const frame = read('--board-frame');
  const frameDark = read('--board-frame-dark');
  const frameLight = read('--board-frame-light');
  return frame === null || frameDark === null || frameLight === null
    ? null
    : { frame, frameDark, frameLight };
}

export { themePicker } from './picker';
