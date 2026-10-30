/** The coach panel: one short lesson, Back / Next / Skip tutorial, collapsible to a small pill. */
import { RESOURCES, type DevCardType, type Resource } from '../../engine';
import { append, h } from '../dom';
import { glyph, RESOURCE_LABEL, resourceIcon } from '../icons';
import { DEV_CARD_INFO } from '../model';
import { devCardFace } from '../widgets';
import type { Visual } from './lessons';
import type { PanelView } from './machine';

export interface PanelHandlers {
  next: () => void;
  back: () => void;
  skip: () => void;
  collapse: (collapsed: boolean) => void;
  /** The last lesson's "New game" button. */
  newGame: () => void;
  /** "Base game tutorial" under an expansion's intro (absent: no link). */
  base?: () => void;
}

/** What the course adds to the panel. */
export interface PanelCourse {
  /** The badge over the title ("Learn to play" / the expansion's name). */
  badge: string;
  visuals?: Readonly<Record<string, () => HTMLElement>>;
}

const TERRAIN: Record<Resource, string> = {
  lumber: 'Forest',
  brick: 'Hills',
  wool: 'Pasture',
  grain: 'Fields',
  ore: 'Mountains',
};

const DEV_TYPES: readonly DevCardType[] = [
  'knight',
  'victoryPoint',
  'roadBuilding',
  'yearOfPlenty',
  'monopoly',
];

function visual(kind: string, own?: Readonly<Record<string, () => HTMLElement>>): HTMLElement {
  const made = own?.[kind];
  if (made) return made();
  if ((kind as Visual) === 'terrain') {
    return h(
      'ul',
      { class: 'tut-terrain', attrs: { 'aria-label': 'Tiles and what they produce' } },
      ...RESOURCES.map((r) =>
        h(
          'li',
          {},
          resourceIcon(r, 22),
          h('span', {}, TERRAIN[r], ' → ', h('b', {}, RESOURCE_LABEL[r])),
        ),
      ),
    );
  }
  return h(
    'ul',
    { class: 'tut-devs' },
    ...DEV_TYPES.map((t) =>
      h(
        'li',
        {},
        devCardFace(t, 24),
        h('span', {}, h('b', {}, DEV_CARD_INFO[t].name), ' ', DEV_CARD_INFO[t].blurb),
      ),
    ),
  );
}

/** The panel's content for `view` (the element itself stays; main.ts measures it). */
export function renderPanel(
  el: HTMLElement,
  view: PanelView,
  on: PanelHandlers,
  course: PanelCourse = { badge: 'Learn to play' },
): void {
  el.classList.toggle('is-collapsed', view.collapsed);
  el.classList.toggle('is-idle', view.lesson === null);
  if (view.collapsed) {
    el.replaceChildren(
      h(
        'button',
        {
          class: 'tut-pill',
          title: 'Show the tutorial',
          attrs: { 'aria-expanded': 'false', 'data-k': 'tut-expand' },
          on: { click: () => on.collapse(false) },
        },
        h('span', { class: 'tut-pill-dot', attrs: { 'aria-hidden': 'true' } }, '?'),
        h('span', {}, view.lesson && view.live ? view.title : 'Tutorial'),
      ),
    );
    return;
  }
  const btn = (label: string, cls: string, k: string, fn: () => void, enabled = true) =>
    h(
      'button',
      { class: `btn btn-sm ${cls}`, disabled: !enabled, attrs: { 'data-k': k }, on: { click: fn } },
      label,
    );
  el.replaceChildren();
  append(el, [
    h(
      'div',
      { class: 'tut-head' },
      h('span', { class: 'tut-badge' }, view.recap ? 'Recap' : course.badge),
      !view.live && h('span', { class: 'tut-badge is-back' }, 'Earlier tip'),
      h(
        'button',
        {
          class: 'tut-min',
          title: 'Minimize',
          attrs: { 'aria-label': 'Minimize the tutorial', 'data-k': 'tut-min' },
          on: { click: () => on.collapse(true) },
        },
        glyph('chevron', 16),
      ),
    ),
    view.lesson && h('h2', { class: 'tut-title' }, view.title),
    h('p', { class: 'tut-text' }, view.text),
    view.lesson?.visual && visual(view.lesson.visual, course.visuals),
    view.todo && h('p', { class: 'tut-todo', attrs: { role: 'status' } }, view.todo),
    on.base &&
      h(
        'p',
        { class: 'tut-base' },
        'New to Catan? ',
        h(
          'button',
          { class: 'tut-link', attrs: { 'data-k': 'tut-base' }, on: { click: on.base } },
          'Start with the base game tutorial',
        ),
      ),
    h(
      'div',
      { class: 'tut-actions' },
      !view.final &&
        h(
          'button',
          { class: 'tut-skip', attrs: { 'data-k': 'tut-skip' }, on: { click: on.skip } },
          'Skip tutorial',
        ),
      h('span', { class: 'tut-gap' }),
      btn('Back', 'btn-ghost', 'tut-back', on.back, view.canBack),
      view.final
        ? btn('New game', 'btn-ghost', 'tut-new', on.newGame)
        : btn('Next', 'btn-primary', 'tut-next', on.next, view.canNext),
      view.final && btn('Keep playing', 'btn-primary', 'tut-next', on.next),
    ),
  ]);
}
