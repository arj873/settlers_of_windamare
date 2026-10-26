/**
 * T&B scenario pairs HUD: the pair's rules and target, the 2-fish wagon button; a free bridge
 * (6 fish) and a fish-paid knight move are board clicks on the highlighted paths. Everything else
 * is the T&B HUD.
 */
import type { Action, GameState } from '../../engine';
import { h } from '../../ui/dom';
import type { HudExtension } from '../../ui/expansions';
import type { HudView } from '../../ui/types';
import { has } from '../tb/engine';
import { FISH_BRIDGE, FISH_KNIGHT, FISH_WAGON, TBPAIR } from './engine';
import './tbpair.css';

type Send = (a: Action) => void;
const mine = (view: HudView, type: string): Action[] =>
  view.legal.filter((a) => a.player === view.viewer && a.type === type);

export function pairRules(state: GameState): string[] {
  const out = ['No lake (with the Caravans it lies beside the oasis). The old boot: 1 more VP.'];
  if (has(state, 'rivers')) out.push(`${FISH_BRIDGE} fish pay for a bridge (click a bridge site).`);
  if (has(state, 'traders')) out.push(`${FISH_WAGON} fish give the wagon 2 more MP (like grain).`);
  if (has(state, 'ba')) {
    out.push(
      `${FISH_KNIGHT} fish move a knight up to 5 paths (like grain).`,
      'Conquered buildings catch no fish.',
    );
  }
  if (has(state, 'caravans')) out.push('The hex with the 2 also produces on a 12.');
  return out;
}

function panel(state: GameState, view: HudView, send: Send) {
  const body = h(
    'div',
    { class: 'tbpair-panel' },
    h('p', { class: 'tbpair-goal' }, `${state.settings.vpToWin} VP to win`),
    ...pairRules(state).map((r) => h('p', { class: 'tbpair-fact' }, r)),
  );
  if (!view.spectator) {
    for (const a of mine(view, 'tbpair/fishWagon')) {
      body.append(
        h(
          'button',
          { class: 'btn tbpair-btn', on: { click: () => send(a) } },
          `2 more MP (${FISH_WAGON} fish)`,
        ),
      );
    }
  }
  return { title: 'T&B pair', body };
}

export const tbpairHud: HudExtension = {
  id: TBPAIR,
  panel: (state, view, send) => panel(state, view, send),
  hint(_state, view) {
    if (mine(view, 'tbpair/fishKnight').length > 0) {
      return 'Move the knight, or pay 2 fish to reach a highlighted path farther away';
    }
    return null;
  },
  impliedActions: ['tbpair/fishBridge', 'tbpair/fishKnight'],
};
