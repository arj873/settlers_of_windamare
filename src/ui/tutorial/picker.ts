/**
 * "Learn to play" picker: the base game and every module with a tutorial (registry.ts), with a
 * tick on the ones done. Names come from the engine catalog, so modules need not be loaded.
 */
import { expansionById, modeById } from '../../engine';
import { h } from '../dom';
import { TUTORIAL_MODULES } from './registry';

export interface PickerEntry {
  /** Course id ('base' or the module id). */
  id: string;
  name: string;
  icon: string;
  blurb: string;
  done: boolean;
}

/** The picker's rows: base first, then the modules in TUTORIAL_MODULES order. */
export function pickerEntries(isDone: (courseId: string) => boolean): PickerEntry[] {
  const base: PickerEntry = {
    id: 'base',
    name: 'Base game',
    icon: '⬡',
    blurb: 'The rules of Catan, in your first game',
    done: isDone('base'),
  };
  return [
    base,
    ...TUTORIAL_MODULES.flatMap((id) => {
      const info = expansionById(id);
      if (!info) return [];
      return [
        {
          id,
          name: info.name,
          icon: info.icon ?? '🧩',
          blurb: modeById(id)?.blurb ?? '',
          done: isDone(id),
        },
      ];
    }),
  ];
}

export interface PickerOptions {
  isDone: (courseId: string) => boolean;
  /** Start that course (may load its module first; a rejection shows on the row). */
  onPick: (courseId: string) => Promise<void> | void;
  onCancel: () => void;
}

/** Open the picker as a modal in `parent` (the HUD root). Returns it; it removes itself. */
export function openTutorialPicker(parent: HTMLElement, o: PickerOptions): HTMLElement {
  parent.querySelector('.tut-pick-scrim')?.remove();
  const entries = pickerEntries(o.isDone);
  const baseDone = entries[0]?.done === true;
  const close = () => {
    scrim.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    close();
    o.onCancel();
  };
  const error = h('p', { class: 'summary is-error', attrs: { role: 'alert', hidden: '' } });
  let busy = false;
  const pick = (entry: PickerEntry, row: HTMLButtonElement) => {
    if (busy) return;
    busy = true;
    row.classList.add('is-busy');
    error.hidden = true;
    Promise.resolve(o.onPick(entry.id)).then(close, (e: unknown) => {
      console.error(e);
      busy = false;
      row.classList.remove('is-busy');
      error.textContent = `Could not load ${entry.name}. Check the connection and try again.`;
      error.hidden = false;
    });
  };
  const rows = entries.map((e) => {
    const row: HTMLButtonElement = h(
      'button',
      {
        class: `tut-pick-row${e.done ? ' is-done' : ''}`,
        attrs: { 'data-k': `tut-pick-${e.id}` },
        on: { click: () => pick(e, row) },
      },
      h('span', { class: 'tut-pick-ico', attrs: { 'aria-hidden': 'true' } }, e.icon),
      h(
        'span',
        { class: 'tut-pick-main' },
        h('b', {}, e.name),
        h('small', {}, e.blurb),
        e.id !== 'base' && h('small', { class: 'tut-pick-new' }, 'Teaches only what’s new'),
      ),
      e.done
        ? h('span', { class: 'tut-pick-done', attrs: { 'aria-label': 'done' } }, '✓')
        : h('span', { class: 'tut-pick-go', attrs: { 'aria-hidden': 'true' } }, '›'),
    );
    return h('li', {}, row);
  });
  const scrim = h(
    'div',
    { class: 'scrim is-modal tut-pick-scrim' },
    h(
      'div',
      {
        class: 'dialog enter tut-pick',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tut-pick-h' },
      },
      h('h2', { id: 'tut-pick-h' }, 'Learn to play'),
      h(
        'p',
        { class: 'tut-pick-sub' },
        'A guided game against two Easy bots: tips show up as things happen.',
      ),
      h('ul', { class: 'tut-pick-list' }, ...rows),
      !baseDone &&
        h(
          'p',
          { class: 'note tut-pick-hint' },
          'New to Catan? Start with the base game: the expansions build on it.',
        ),
      error,
      h(
        'div',
        { class: 'dialog-actions' },
        h(
          'button',
          {
            class: 'btn btn-ghost',
            attrs: { 'data-k': 'tut-pick-cancel' },
            on: {
              click: () => {
                close();
                o.onCancel();
              },
            },
          },
          'Cancel',
        ),
      ),
    ),
  );
  document.addEventListener('keydown', onKey);
  parent.append(scrim);
  scrim.querySelector<HTMLButtonElement>('.tut-pick-row')?.focus();
  return scrim;
}
