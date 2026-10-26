/** Theme picker: one button per theme with a tiny preview tile. Used in the HUD menu and setup footer. */
import { h } from '../dom';
import { currentTheme, setTheme, THEME_INFO, THEMES, type ThemeName } from './index';

export interface ThemePickerOptions {
  /** Preview tiles only, names in tooltips (setup footer). */
  compact?: boolean;
  /** Called after the theme changed (the picker already updated itself). */
  onPick?: (name: ThemeName) => void;
}

export function themePicker(opts: ThemePickerOptions = {}): HTMLElement {
  const active = currentTheme();
  const options = THEMES.map((name) => {
    const info = THEME_INFO[name];
    const [s0 = '', s1 = '', s2 = '', s3 = ''] = info.swatch;
    return h(
      'button',
      {
        class: `theme-opt${name === active ? ' is-on' : ''}`,
        title: `${info.label} theme`,
        attrs: {
          'data-theme-opt': name,
          'aria-pressed': String(name === active),
          ...(opts.compact ? { 'aria-label': `${info.label} theme` } : {}),
        },
        on: {
          click: () => {
            setTheme(name);
            for (const b of options) {
              const on = b.dataset.themeOpt === name;
              b.classList.toggle('is-on', on);
              b.setAttribute('aria-pressed', String(on));
            }
            opts.onPick?.(name);
          },
        },
      },
      h('span', {
        class: 'theme-sw',
        style: { '--s0': s0, '--s1': s1, '--s2': s2, '--s3': s3 },
        attrs: { 'aria-hidden': 'true' },
      }),
      !opts.compact && h('span', { class: 'theme-name' }, info.label),
    );
  });
  return h(
    'div',
    {
      class: `theme-pick${opts.compact ? ' is-compact' : ''}`,
      attrs: { role: 'group', 'aria-label': 'Theme' },
    },
    ...options,
  );
}
