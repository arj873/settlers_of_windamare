/**
 * Seafarers + C&K HUD: a short panel with the pair's rules in play (VP target, sleeping robber
 * and pirate, knights at sea), the C&K knight dialog with a "Chase the pirate" button, and the
 * turn-pill text while the chased piece moves. Everything else is the C&K and Seafarers HUDs.
 */
import type { Action, GameState } from '../../engine';
import { touchesLand } from '../../engine';
import { h } from '../../ui/dom';
import type { HudExtension } from '../../ui/expansions';
import type { HudView } from '../../ui/types';
import { ckSlice, isRobberActive } from '../ck/engine';
import { ckHud } from '../ck/ui';
import { SEACK, SEACK_VP_BONUS, seackSlice } from './engine';
import './seack.css';

const mine = (view: HudView, type: string): Action[] =>
  view.legal.filter((a) => a.player === view.viewer && a.type === type);

/** Knights standing at sea (on their owner's ships). */
export function knightsAtSea(state: GameState): number {
  return Object.keys(ckSlice(state).knights).filter(
    (v) => !touchesLand(state, v as Parameters<typeof touchesLand>[1]),
  ).length;
}

function panel(state: GameState): { title: string; body: HTMLElement } {
  const awake = isRobberActive(state);
  const atSea = knightsAtSea(state);
  return {
    title: 'Seafarers + C&K',
    body: h(
      'div',
      { class: 'seack-panel' },
      h(
        'p',
        { class: 'seack-goal' },
        `${state.settings.vpToWin} VP to win (scenario + ${SEACK_VP_BONUS})`,
      ),
      h(
        'p',
        { class: `seack-fact ${awake ? 'is-awake' : 'is-asleep'}` },
        awake
          ? 'Robber and pirate are awake. An active knight next to either may chase it.'
          : 'Robber and pirate sleep until the barbarians first reach Catan.',
      ),
      h(
        'p',
        { class: 'seack-fact muted' },
        atSea > 0
          ? `Knights at sea: ${atSea}. Ships under a knight stay put.`
          : 'Knights sail along your ships and may stop at sea.',
      ),
    ),
  };
}

export const seackHud: HudExtension = {
  id: SEACK,

  panel: (state) => panel(state),

  dialog(state, view, legal, send) {
    // The C&K knight dialog, plus chasing the pirate (C2.8).
    if (state.phase.kind !== 'ck/knight') return null;
    const base = ckHud.dialog?.(state, view, legal, send) ?? null;
    const chase = mine(view, 'seack/chasePirate')[0];
    if (!base || !chase) return base;
    const button = h(
      'button',
      { class: 'btn btn-primary ck-choice', on: { click: () => send(chase) } },
      'Chase the pirate',
    );
    return {
      ...base,
      key: `${base.key}-pirate`,
      body: [
        ...base.body,
        h('div', { class: 'ck-choices seack-chase' }, button),
        h('p', { class: 'muted' }, 'The knight is deactivated; then move the pirate.'),
      ],
    };
  },

  hint(state, view) {
    if (state.phase.kind !== 'moveRobber' || state.turn.current !== view.viewer) return null;
    const chase = seackSlice(state).chase;
    if (chase === 'pirate') return 'Your knight chased the pirate: move it to another sea hex';
    if (chase === 'robber') return 'Your knight chased the robber: move it';
    return null;
  },
};
