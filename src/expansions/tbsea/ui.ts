/**
 * T&B + Seafarers HUD: a short panel with the pair's rules for the scenario in play and the two
 * fish actions only the pair has (chase the pirate off the board, a free ship). Everything else
 * is the T&B and Seafarers HUDs (wagon steps, barbarians and camels on sea paths are board
 * clicks like on land).
 */
import type { Action, GameState } from '../../engine';
import { h } from '../../ui/dom';
import type { HudExtension } from '../../ui/expansions';
import type { HudView } from '../../ui/types';
import { seaSlice } from '../seafarers/engine';
import { has, tbBoard } from '../tb/engine';
import { FISH_PIRATE, FISH_SHIP, TBSEA } from './engine';
import './tbsea.css';

type Send = (a: Action) => void;
const mine = (view: HudView, type: string): Action[] =>
  view.legal.filter((a) => a.player === view.viewer && a.type === type);

/** The pair's rules for the scenario in play (docs/rules/combos.md §3). */
export function pairRules(state: GameState): string[] {
  const out: string[] = [];
  if (has(state, 'traders')) {
    out.push(
      'Wagons cross the sea: 2 MP, 1 MP along your ship, 1 MP + 1 gold to the owner of another ship.',
      'A barbarian may be put on a sea edge (it robs the ship’s owner there).',
      'No robber, no pirate, no Longest Trade Route.',
    );
  }
  const cloth = seaSlice(state).cloth !== undefined;
  const pirate = seaSlice(state).pirate !== null;
  if (has(state, 'fish')) {
    if (pirate) {
      out.push(
        cloth
          ? `${FISH_PIRATE} fish chase the pirate off the board (needs a route to a village).`
          : `${FISH_PIRATE} fish chase the pirate off the board.`,
      );
    }
    out.push(`${FISH_SHIP} fish build a free ship.`);
    out.push(
      pirate
        ? 'The pirate on a fishing ground blocks it. Ships catch no fish.'
        : 'Ships catch no fish.',
    );
  }
  for (const x of tbBoard(state).alsoOn ?? []) {
    const own = state.board.hexes[x.hex]?.token;
    out.push(`The hex with ${own} and ${x.number} produces on either number.`);
  }
  if (has(state, 'caravans') && tbBoard(state).robberOnOasis) {
    out.push('The robber starts on the watering hole and may go back there.');
  }
  if (has(state, 'rivers')) {
    out.push(
      'A ship built on a river hex’s edge earns 1 gold; sailing it off costs 1 gold.',
      'No ship on a bridge site.',
    );
    out.push('Gold fields produce resource cards, never gold coins.');
  }
  if (has(state, 'caravans')) {
    out.push(
      'Camels may also go on sea edges.',
      'A camel on your ship counts it twice for the Longest Trade Route.',
    );
  }
  if (has(state, 'ba')) {
    out.push(
      'Ships may sail along conquered hexes, but a route grows only from an unconquered building.',
      'A conquered settlement cuts the trade route. No robber, no pirate.',
    );
  }
  return out;
}

function panel(state: GameState, view: HudView, send: Send) {
  const body = h(
    'div',
    { class: 'tbsea-panel' },
    h('p', { class: 'tbsea-goal' }, `${state.settings.vpToWin} VP to win`),
    ...pairRules(state).map((r) => h('p', { class: 'tbsea-fact' }, r)),
  );
  if (!view.spectator) {
    const buttons = [
      ...mine(view, 'tbsea/fishPirate').map((a) =>
        h(
          'button',
          { class: 'btn tbsea-btn', on: { click: () => send(a) } },
          `Chase the pirate (${FISH_PIRATE} fish)`,
        ),
      ),
      ...mine(view, 'tbsea/fishShip').map((a) =>
        h(
          'button',
          { class: 'btn btn-primary tbsea-btn', on: { click: () => send(a) } },
          `Free ship (${FISH_SHIP} fish)`,
        ),
      ),
    ];
    if (buttons.length > 0) body.append(h('div', { class: 'tbsea-buttons' }, ...buttons));
  }
  return { title: 'T&B + Seafarers', body };
}

export const tbseaHud: HudExtension = {
  id: TBSEA,
  panel: (state, view, send) => panel(state, view, send),
};
