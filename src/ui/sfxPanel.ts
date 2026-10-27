/**
 * Sound audition panel (A1, `?sfx=1`): one button per registered sound (base + expansion
 * modules), the level they would play at, a "Play all" walk-through and the volume control.
 */
import { LEVEL_GAIN, sfx, type CueLevel, type SoundEngine } from '../audio';
import { h } from './dom';
import { soundControl } from './sound';
import './sound.css';

const LEVELS: CueLevel[] = ['high', 'normal', 'low'];
const LEVEL_LABEL: Record<CueLevel, string> = {
  high: 'You (full)',
  normal: 'Others',
  low: 'Bots (quiet)',
};

export function sfxPanel(engine: SoundEngine = sfx): HTMLElement {
  let level: CueLevel = 'high';
  let walk: ReturnType<typeof setTimeout> | null = null;
  const play = (id: string) => {
    engine.unlock();
    engine.play(id, LEVEL_GAIN[level]);
  };

  const levelSeg = h(
    'div',
    { class: 'seg', attrs: { role: 'group', 'aria-label': 'Level' } },
    ...LEVELS.map((l) =>
      h(
        'button',
        {
          class: `seg-btn${l === level ? ' is-on' : ''}`,
          attrs: { 'data-level': l },
          on: {
            click: (e) => {
              level = l;
              for (const b of levelSeg.querySelectorAll('button')) {
                b.classList.toggle('is-on', b === e.currentTarget);
              }
            },
          },
        },
        LEVEL_LABEL[l],
      ),
    ),
  );

  const playAll = () => {
    if (walk !== null) clearTimeout(walk);
    const ids = engine.recipes().map(([id]) => id);
    const next = (i: number) => {
      const id = ids[i];
      if (id === undefined) {
        walk = null;
        return;
      }
      play(id);
      walk = setTimeout(() => next(i + 1), 1600);
    };
    next(0);
  };

  const panel = h(
    'div',
    { class: 'sfx-panel', attrs: { role: 'region', 'aria-label': 'Sound effects' } },
    h(
      'div',
      { class: 'sfx-head' },
      h('h2', {}, 'Sound effects'),
      h('button', { class: 'sfx-play', on: { click: () => panel.remove() } }, 'Close'),
    ),
    h('p', {}, 'All synthesized in the browser (Web Audio). Click to audition.'),
    soundControl({ engine }),
    h('div', { class: 'sfx-row' }, levelSeg),
    h(
      'div',
      { class: 'sfx-row' },
      h('button', { class: 'sfx-play', on: { click: playAll } }, '▶ Play all'),
      h(
        'button',
        {
          class: 'sfx-play',
          on: {
            click: () => {
              if (walk !== null) clearTimeout(walk);
              walk = null;
            },
          },
        },
        '■ Stop',
      ),
    ),
    h(
      'div',
      { class: 'sfx-grid' },
      ...engine.recipes().map(([id, r]) =>
        h(
          'button',
          {
            class: 'sfx-play',
            title: id,
            attrs: { 'data-sfx': id },
            on: { click: () => play(id) },
          },
          r.label,
        ),
      ),
    ),
  );
  return panel;
}
