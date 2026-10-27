/**
 * Barbarian Attack + C&K HUD: a panel with the pair's rules and the viewer's path knights, build
 * cards for recruiting (castle), activating and promoting knights and for the end-of-turn knight
 * actions, dialogs for Treason's victim and the Smith, and hints for every phase. C&K's own
 * knight cards and barbarian track are hidden in this mode (ck `shipSails`).
 */
import type { Action, GameState } from '../../engine';
import { h } from '../../ui/dom';
import type { HudDialog, HudExtension } from '../../ui/expansions';
import type { HudView } from '../../ui/types';
import {
  ACTIVATE_ITEM,
  KNIGHT_ITEM,
  KNIGHT_LEVELS,
  KNIGHT_NAMES,
  KNIGHTS_PER_LEVEL,
  PROMOTE_ITEM,
} from '../ck/engine';
import {
  ACTIVE_STEPS,
  BACK,
  DISPLACE_STEPS,
  INACTIVE_STEPS,
  PRISONERS_PER_TOKEN,
  backSlice,
  cutTracks,
  inSupply,
  knightEdges,
  type BackPhase,
} from './engine';
import './back.css';

type Send = (a: Action) => void;
const mine = (view: HudView, type: string): Action[] =>
  view.legal.filter((a) => a.player === view.viewer && a.type === type);
const nameOf = (state: GameState, p: number) => state.players[p]?.name ?? `Player ${p + 1}`;
const phaseOf = (state: GameState) => state.phase as unknown as BackPhase | { kind: string };

function knightsLine(state: GameState, p: number): HTMLElement {
  const knights = knightEdges(state, p).flatMap((e) => backSlice(state).knights[e] ?? []);
  const parts = KNIGHT_LEVELS.map((l) => {
    const on = knights.filter((k) => k.level === l);
    const active = on.filter((k) => k.active).length;
    return `${KNIGHT_NAMES[l]} ${on.length}/${KNIGHTS_PER_LEVEL}${active > 0 ? ` (${active} active)` : ''}`;
  });
  return h('p', { class: 'back-fact' }, `Your knights: ${parts.join(' · ')}`);
}

function panel(state: GameState, view: HudView) {
  const body = h(
    'div',
    { class: 'back-panel' },
    h('p', { class: 'back-goal' }, `${state.settings.vpToWin} VP to win`),
    h(
      'p',
      { class: 'back-fact' },
      'A ship on the event die lands a barbarian on the coastal hex of the roll; so does every city improvement.',
    ),
    h(
      'p',
      { class: 'back-fact' },
      `Knights start on the castle and act at the end of your turn: active ${ACTIVE_STEPS} paths, inactive ${INACTIVE_STEPS}, displace within ${DISPLACE_STEPS}. Active knights beat barbarians by strength.`,
    ),
    h(
      'p',
      { class: 'back-fact' },
      `${PRISONERS_PER_TOKEN} prisoners = 1 VP. A metropolis is never conquered.`,
    ),
  );
  if (!view.spectator && state.players[view.viewer]) {
    const p = view.viewer;
    body.append(knightsLine(state, p));
    const tokens = backSlice(state).tokens[p] ?? 0;
    if (tokens > 0) body.append(h('p', { class: 'back-fact' }, `Prisoner tokens: ${tokens} VP`));
    const cut = cutTracks(state, p);
    if (cut.length > 0) {
      body.append(
        h(
          'p',
          { class: 'back-warn' },
          `Your ${cut.join(', ')} metropolis stands among conquered hexes: no improvements there.`,
        ),
      );
    }
  }
  return { title: 'Barbarian Attack + C&K', body };
}

function deserterDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  const options = mine(view, 'back/deserterPlayer');
  if (options.length === 0) return null;
  return {
    key: `back-deserter-${state.turn.number}-${state.log.length}`,
    title: 'Treason',
    modal: true,
    body: [
      h('p', {}, 'Pick an opponent: they remove one of their knights, and yours takes its path.'),
      h(
        'div',
        { class: 'back-buttons' },
        ...options.map((a) => {
          const v = (a as unknown as { victim: number }).victim;
          return h(
            'button',
            { class: 'btn back-btn', on: { click: () => send(a) } },
            nameOf(state, v),
          );
        }),
      ),
    ],
  };
}

function smithDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  const done = mine(view, 'back/smithDone')[0];
  if (!done) return null;
  const ph = phaseOf(state) as Extract<BackPhase, { kind: 'back/smith' }>;
  return {
    key: `back-smith-${state.turn.number}-${ph.left}`,
    title: 'Smith',
    modal: false,
    body: [
      h('p', {}, `Click a highlighted knight to promote it for free (${ph.left} left).`),
      h(
        'div',
        { class: 'back-buttons' },
        h('button', { class: 'btn back-btn', on: { click: () => send(done) } }, 'Done'),
      ),
    ],
  };
}

function hint(state: GameState, view: HudView): string | null {
  const ph = phaseOf(state);
  const acting = !view.spectator && view.legal.some((a) => a.player === view.viewer);
  const who = nameOf(state, state.turn.current);
  switch (ph.kind) {
    case 'back/knights': {
      if (!acting) return `${who}'s knights act`;
      return (ph as Extract<BackPhase, { kind: 'back/knights' }>).from === null
        ? 'Pick a knight to move, or end your turn (the barbarians are fought then)'
        : 'Move the knight to a highlighted path, or click a weaker knight to displace it';
    }
    case 'back/relocate':
      return acting
        ? 'Your knight was displaced: put it on a highlighted path'
        : 'A displaced knight retreats';
    case 'back/intrigue':
      return acting ? 'Intrigue: pick a hex — one barbarian there becomes your prisoner' : null;
    case 'back/taxation':
      return acting ? 'Taxation: pick a hex — rob each opponent with a building there' : null;
    case 'back/deserter':
      return acting
        ? (ph as Extract<BackPhase, { kind: 'back/deserter' }>).victim === null
          ? 'Treason: pick an opponent'
          : 'Treason: remove one of your knights (click it)'
        : `${who} plays Treason`;
    case 'back/smith':
      return acting ? 'Smith: promote up to 2 knights for free' : null;
    default:
      return null;
  }
}

export const backHud: HudExtension = {
  id: BACK,

  panel: (state, view) => panel(state, view),

  buildCards: [
    {
      mode: 'back/knight',
      label: 'Knight',
      actionType: 'back/recruit',
      glyph: 'knight',
      costItem: KNIGHT_ITEM,
      left: (state, p) => inSupply(state, p, 1),
      total: () => KNIGHTS_PER_LEVEL,
    },
    {
      mode: 'back/activate',
      label: 'Activate',
      actionType: 'back/activate',
      glyph: 'knight',
      costItem: ACTIVATE_ITEM,
    },
    {
      mode: 'back/promote',
      label: 'Promote',
      actionType: 'back/promote',
      glyph: 'knight',
      costItem: PROMOTE_ITEM,
    },
    {
      mode: 'back/knights',
      label: 'Knight actions',
      actionType: 'back/startKnights',
      glyph: 'knight',
    },
  ],

  dialog(state, view, _legal, send) {
    if (view.spectator) return null;
    return deserterDialog(state, view, send) ?? smithDialog(state, view, send);
  },

  hint,

  impliedActions: [
    'back/selectKnight',
    'back/moveKnight',
    'back/displace',
    'back/relocate',
    'back/intrigueHex',
    'back/taxHex',
    'back/deserterKnight',
    'back/smithKnight',
  ],
};
