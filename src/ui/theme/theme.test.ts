import { describe, expect, it } from 'vitest';
import {
  currentTheme,
  DEFAULT_THEME,
  initTheme,
  isTheme,
  loadTheme,
  onThemeChange,
  parseHexColor,
  saveTheme,
  setTheme,
  THEME_KEY,
  themeFromSearch,
  THEMES,
  type ThemeStorage,
} from './index';

function memory(
  initial: Record<string, string> = {},
): ThemeStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}
const broken: ThemeStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};
const fakeRoot = () => ({ dataset: {} as Record<string, string> }) as unknown as HTMLElement;

describe('themes', () => {
  it('lists Sunfired first and makes it the default', () => {
    expect(THEMES[0]).toBe('sunfired');
    expect(DEFAULT_THEME).toBe('sunfired');
    expect(THEMES).toEqual(['sunfired', 'chartroom', 'parlour', 'wood']);
  });

  it('reads ?theme= and ignores unknown names', () => {
    expect(themeFromSearch('?theme=chartroom')).toBe('chartroom');
    expect(themeFromSearch('?fixture=midGame&theme=wood')).toBe('wood');
    expect(themeFromSearch('?theme=nope')).toBeNull();
    expect(themeFromSearch('')).toBeNull();
    expect(isTheme('Wood')).toBe(false);
  });

  it('picks ?theme= over the saved choice over the default, and applies it', () => {
    const root = fakeRoot();
    expect(initTheme('?theme=parlour', memory({ [THEME_KEY]: 'wood' }), root)).toBe('parlour');
    expect(root.dataset.theme).toBe('parlour');
    expect(initTheme('', memory({ [THEME_KEY]: 'wood' }), root)).toBe('wood');
    expect(initTheme('', memory({ [THEME_KEY]: 'bogus' }), root)).toBe(DEFAULT_THEME);
    expect(initTheme('', null, root)).toBe(DEFAULT_THEME);
    expect(root.dataset.theme).toBe(DEFAULT_THEME);
  });

  it('setTheme applies, remembers and notifies', () => {
    const root = fakeRoot();
    const store = memory();
    initTheme('', store, root);
    const seen: string[] = [];
    const off = onThemeChange((t) => seen.push(t));
    setTheme('chartroom', root);
    expect(currentTheme()).toBe('chartroom');
    expect(root.dataset.theme).toBe('chartroom');
    expect(store.data[THEME_KEY]).toBe('chartroom');
    off();
    setTheme('wood', root);
    expect(seen).toEqual(['chartroom']);
    // A later load finds the pick.
    expect(initTheme('', store, root)).toBe('wood');
  });

  it('survives storage that throws', () => {
    expect(loadTheme(broken)).toBeNull();
    expect(() => saveTheme(broken, 'wood')).not.toThrow();
    const root = fakeRoot();
    expect(initTheme('', broken, root)).toBe(DEFAULT_THEME);
    expect(() => setTheme('parlour', root)).not.toThrow();
    expect(root.dataset.theme).toBe('parlour');
  });

  it('parses board frame colours', () => {
    expect(parseHexColor(' #7b5431 ')).toBe(0x7b5431);
    expect(parseHexColor('#abc')).toBe(0xaabbcc);
    expect(parseHexColor('rgb(1, 2, 3)')).toBeNull();
    expect(parseHexColor('')).toBeNull();
  });
});
