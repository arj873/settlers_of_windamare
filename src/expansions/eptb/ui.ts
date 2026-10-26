/**
 * E&P + T&B HUD: a short panel with the pair's rules and E&P's fish uses (2 fish: no tribute to
 * the pirate this turn; 7 fish: sail a ship again), and the "Ship (5 fish)" build card (click an
 * edge at your harbor). T&B's panel shows the fish tokens, the old boot and its own fish uses
 * (steal, a resource, a road); E&P's everything else.
 */
import type { Action, GameState } from '../../engine';
import { h } from '../../ui/dom';
import type { HudExtension } from '../../ui/expansions';
import type { HudView } from '../../ui/types';
import { epSlice } from '../ep/engine';
import { shipsOf } from '../ep/engine/ships';
import { has } from '../tb/engine';
import { EP_FISH_COST, EPTB, eptbSlice } from './engine';
import './eptb.css';

type Send = (a: Action) => void;
const mine = (view: HudView, type: string): Action[] =>
  view.legal.filter((a) => a.player === view.viewer && a.type === type);
const field = (a: Action, k: string): unknown => (a as unknown as Record<string, unknown>)[k];

function useButtons(state: GameState, view: HudView, send: Send): HTMLElement | null {
  const uses = mine(view, 'eptb/fish');
  if (uses.length === 0) return null;
  const ships = shipsOf(epSlice(state), view.viewer);
  return h(
    'div',
    { class: 'eptb-uses' },
    ...uses.map((a) => {
      const use = field(a, 'use');
      const n = ships.findIndex((s) => s.id === field(a, 'ship')) + 1;
      const label =
        use === 'pirate'
          ? `${EP_FISH_COST.pirate} fish: no tribute to the pirate this turn`
          : `${EP_FISH_COST.secondMove} fish: sail ship ${n} again`;
      return h('button', { class: 'btn btn-sm eptb-btn', on: { click: () => send(a) } }, label);
    }),
  );
}

function panel(state: GameState, view: HudView, send: Send): { title: string; body: HTMLElement } {
  const passage = eptbSlice(state).freePassage.includes(state.turn.current);
  const body = h(
    'div',
    { class: 'eptb-panel' },
    h('p', { class: 'eptb-goal' }, `${state.settings.vpToWin} VP to win (the old boot: +1)`),
    h(
      'p',
      { class: 'eptb-fact' },
      'Fishing grounds and the lake pay fish tokens. Only fish from a roll: 1 gold.',
    ),
    h(
      'p',
      { class: 'eptb-fact muted' },
      `Fish: ${EP_FISH_COST.pirate} ignore the pirate · ${EP_FISH_COST.ship} a ship or a road · ${EP_FISH_COST.secondMove} a ship sails again`,
    ),
  );
  if (passage) {
    body.append(h('p', { class: 'eptb-fact is-on' }, 'No tribute to the pirate this turn.'));
  }
  const uses = useButtons(state, view, send);
  if (uses) body.append(uses);
  return { title: 'E&P + Fishermen', body };
}

export const eptbHud: HudExtension = {
  id: EPTB,

  panel: (state, view, send) => panel(state, view, send),

  buildCards: [
    {
      mode: 'eptb/fishShip',
      label: `Ship (${EP_FISH_COST.ship} fish)`,
      actionType: 'eptb/fishShip',
      glyph: 'ship',
      costItem: 'eptb/fishShip',
      available: (state) => has(state, 'fish'),
    },
  ],
};
