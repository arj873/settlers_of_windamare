/**
 * T&B scenario pairs HUD: the pair's rules and target, the 2-fish wagon button; a free bridge
 * (6 fish) and a fish-paid knight move are board clicks on the highlighted paths. Barbarian
 * Attack + T&B: picking a barbarian, its hex and its path are board clicks too (the hint says
 * which). Everything else is the T&B HUD.
 */
import type { Action, GameState } from '../../engine';
import { h } from '../../ui/dom';
import type { HudExtension } from '../../ui/expansions';
import type { HudView } from '../../ui/types';
import { has } from '../tb/engine';
import {
  FISH_BRIDGE,
  FISH_KNIGHT,
  FISH_WAGON,
  TBPAIR,
  sheetOf,
  type BarbarianPhase,
} from './engine';
import './tbpair.css';

type Send = (a: Action) => void;
const mine = (view: HudView, type: string): Action[] =>
  view.legal.filter((a) => a.player === view.viewer && a.type === type);

/** The six sheets without Fishing: their changes, in a line each. */
const SHEET_RULES: Readonly<Record<string, readonly string[]>> = {
  'tbpair/baTraders': [
    'Each barbarian stands by a path of its hex (its centre once all are taken); there it slows wagons.',
    'A 2 or 12 lands a barbarian on that hex (no re-roll).',
    'A 7: steal 1 card from any player; no barbarian moves.',
    'Treason and drive-offs move barbarians to any unconquered hex.',
    'The castle (12) produces wool, the glassworks (2) lumber; not once conquered.',
    'Knights and the wagon end the turn, in either order.',
  ],
  'tbpair/caravansBa': [
    'The oasis is on the coast: two caravans.',
    'Barbarians never stop a camel.',
  ],
  'tbpair/caravansTraders': [
    'Trade hexes produce: quarry brick, glassworks lumber, castle wool.',
    'The 2 and the 12 are not re-rolled.',
  ],
  'tbpair/riversBa': [
    'The 2 and 12 share a hex: it produces and takes barbarians on both.',
    'The Poor Settler loses no VP.',
  ],
  'tbpair/riversCaravans': [
    'The two 3s also carry the 2 and the 12.',
    'Camels may stand on bridge sites.',
  ],
  'tbpair/riversTraders': [
    '3 gold to start; a building beside a river pays gold only during set-up.',
    'Bridges pay 2 gold. The Poor Settler loses no VP.',
    'A wagon crosses a river for 3 MP; 1 MP over your bridge, 1 MP + 2 gold over another’s.',
    'Trade hexes produce: quarry brick, glassworks lumber, castle wool. The 2 shares the 12’s hex.',
  ],
};

export function pairRules(state: GameState): string[] {
  const sheet = sheetOf(state);
  if (sheet) return [...(SHEET_RULES[sheet.id] ?? [])];
  const out = ['No lake (with the Caravans it lies beside the oasis). The old boot: 1 more VP.'];
  if (has(state, 'rivers')) out.push(`${FISH_BRIDGE} fish pay for a bridge (click a bridge site).`);
  if (has(state, 'traders')) out.push(`${FISH_WAGON} fish give the wagon 2 more MP (like grain).`);
  if (has(state, 'ba')) {
    out.push(
      `${FISH_KNIGHT} fish move a knight up to 5 paths (like grain).`,
      'Conquered buildings catch no fish.',
    );
  }
  if (has(state, 'caravans')) out.push('The 12 hex carries the 2 too: it produces on both.');
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

function barbarianHint(phase: BarbarianPhase): string | null {
  switch (phase.kind) {
    case 'tbpair/landPath':
      return 'A barbarian landed: pick the path it stands by';
    case 'tbpair/moveBarbarian':
      if (phase.from === null) return 'Treason: pick a barbarian to move';
      return phase.to === null
        ? 'Pick the hex the barbarian goes to'
        : 'Pick the path it stands by';
    case 'tbpair/intrigue':
      return 'Intrigue: pick the barbarian to take prisoner';
    default:
      return null;
  }
}

export const tbpairHud: HudExtension = {
  id: TBPAIR,
  panel: (state, view, send) => panel(state, view, send),
  hint(state, view) {
    if (!view.spectator && state.turn.current === view.viewer) {
      const h = barbarianHint(state.phase as unknown as BarbarianPhase);
      if (h) return h;
    }
    if (mine(view, 'tbpair/fishKnight').length > 0) {
      return 'Move the knight, or pay 2 fish to reach a highlighted path farther away';
    }
    return null;
  },
  impliedActions: [
    'tbpair/fishBridge',
    'tbpair/fishKnight',
    'tbpair/barbarianPath',
    'tbpair/barbarianHex',
    'tbpair/pickBarbarian',
  ],
};
