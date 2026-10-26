// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { midGame } from '../../engine/fixtures';
import { fakeLegal } from '../devLegal';
import { Hud } from '../hud';
import { initTheme, THEME_KEY, themePicker, type ThemeStorage } from './index';

let data: Record<string, string>;
const store: ThemeStorage = {
  getItem: (k) => data[k] ?? null,
  setItem: (k, v) => {
    data[k] = v;
  },
};

beforeEach(() => {
  data = {};
  document.body.replaceChildren();
  initTheme('', store);
});

const opts = (el: ParentNode) => [...el.querySelectorAll<HTMLButtonElement>('.theme-opt')];

describe('theme picker', () => {
  it('lists every theme with a preview, the active one pressed', () => {
    const el = themePicker();
    expect(opts(el).map((b) => b.dataset.themeOpt)).toEqual([
      'sunfired',
      'chartroom',
      'parlour',
      'wood',
    ]);
    expect(el.querySelectorAll('.theme-sw')).toHaveLength(4);
    expect(opts(el).map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(el.textContent).toContain('Chartroom');
  });

  it('switches the page theme and remembers it', () => {
    const el = themePicker();
    document.body.append(el);
    opts(el)[2]!.click();
    expect(document.documentElement.dataset.theme).toBe('parlour');
    expect(data[THEME_KEY]).toBe('parlour');
    expect(el.querySelector('.is-on')?.getAttribute('data-theme-opt')).toBe('parlour');
    expect(opts(el)[0]!.getAttribute('aria-pressed')).toBe('false');
    // A fresh load restores it, unless the URL says otherwise.
    expect(initTheme('', store)).toBe('parlour');
    expect(initTheme('?theme=wood', store)).toBe('wood');
  });

  it('compact mode drops the names but keeps accessible labels', () => {
    const el = themePicker({ compact: true });
    expect(el.querySelector('.theme-name')).toBeNull();
    expect(opts(el)[1]!.getAttribute('aria-label')).toBe('Chartroom theme');
  });

  it('is in the HUD menu and on the setup screen', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const hud = new Hud(root);
    const s = midGame();
    hud.render(s, { viewer: 1, legal: fakeLegal(s, 1), isBotTurn: false });
    expect(root.querySelector('.theme-pick')).toBeNull();
    root.querySelector<HTMLButtonElement>('.menu-btn')!.click();
    const menuPick = root.querySelector('.menu-panel .theme-pick');
    expect(menuPick).not.toBeNull();
    opts(menuPick!)[3]!.click();
    expect(document.documentElement.dataset.theme).toBe('wood');
    // Picking keeps the menu open.
    expect(root.querySelector('.menu-panel')).not.toBeNull();

    hud.showNewGame();
    expect(root.querySelector('.su-footer .theme-pick.is-compact')).not.toBeNull();
    hud.destroy();
  });
});
