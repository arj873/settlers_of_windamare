import { describe, expect, it } from 'vitest';
import { applyTheme, DEFAULT_THEME, isTheme, themeFromSearch, THEMES } from './index';

describe('themes', () => {
  it('reads ?theme= and falls back to the default', () => {
    expect(themeFromSearch('?theme=chartroom')).toBe('chartroom');
    expect(themeFromSearch('?fixture=midGame&theme=sunfired')).toBe('sunfired');
    expect(themeFromSearch('?theme=nope')).toBe(DEFAULT_THEME);
    expect(themeFromSearch('')).toBe(DEFAULT_THEME);
  });

  it('knows every theme and nothing else', () => {
    for (const t of THEMES) expect(isTheme(t)).toBe(true);
    expect(isTheme('Wood')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  it('sets data-theme on the root', () => {
    const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyTheme('parlour', root);
    expect(root.dataset.theme).toBe('parlour');
  });
});
