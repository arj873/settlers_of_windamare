/** Demo expansion HUD (F1 example): a sidebar panel, a "Well" build card and the bloom dialog. */
import { pieceLimit, type Action, type ExpansionAction, type Resource } from '../../engine';
import { h } from '../../ui/dom';
import type { HudExtension } from '../../ui/expansions';
import { RESOURCE_LABEL } from '../../ui/icons';
import { playerStyle, resCardFace } from '../../ui/widgets';
import { DEMO, WELL, demoSlice, wellsOf } from './engine';
import './demo.css';

const isPick = (a: Action): a is ExpansionAction & { resource: Resource } =>
  a.type === 'demo/pickBloom';

export const demoHud: HudExtension = {
  id: DEMO,

  panel(state) {
    const rows = state.players.map((p) => {
      const n = wellsOf(state, p.id).length;
      return h(
        'li',
        { class: 'demo-row', style: playerStyle(p.color) },
        h('span', { class: 'demo-name' }, p.name),
        h('span', { class: 'demo-wells' }, `${n} well${n === 1 ? '' : 's'}`),
      );
    });
    const total = Object.keys(demoSlice(state).wells).length;
    return {
      title: 'Oasis',
      body: h(
        'div',
        { class: 'demo-panel' },
        h('p', { class: 'muted' }, `${total} well${total === 1 ? '' : 's'} dug. 2 wells = 1 VP.`),
        h('ul', { class: 'demo-list' }, ...rows),
      ),
    };
  },

  buildCards: [
    {
      mode: 'demo/well',
      label: 'Well',
      actionType: 'demo/buildWell',
      glyph: 'city',
      costItem: WELL,
      left: (state, p) => pieceLimit(state, p, WELL) - wellsOf(state, p).length,
      total: (state, p) => pieceLimit(state, p, WELL),
    },
  ],

  dialog(state, view, legal, send) {
    if (state.phase.kind !== 'demo/bloom') return null;
    const picks = legal.filter(isPick).filter((a) => a.player === view.viewer);
    if (picks.length === 0) return null;
    return {
      key: `demo-bloom-${state.turn.number}`,
      title: 'The oasis blooms',
      modal: true,
      body: [
        h('p', {}, 'Take one resource of your choice from the bank.'),
        h(
          'div',
          { class: 'pick-row' },
          ...picks.map((a) =>
            h(
              'button',
              {
                class: 'pick',
                title: RESOURCE_LABEL[a.resource],
                attrs: { 'aria-label': RESOURCE_LABEL[a.resource] },
                on: { click: () => send(a) },
              },
              resCardFace(a.resource, 46),
            ),
          ),
        ),
      ],
    };
  },

  hint(state) {
    return state.phase.kind === 'demo/bloom' ? 'The oasis blooms — pick a free resource' : null;
  },
};
