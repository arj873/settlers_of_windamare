/**
 * Catan for Two + C&K HUD: a panel with the pair's rules, the neutral knights and the
 * resource-and-commodity Forced Trade; a build card to turn a knight in for tokens; dialogs for
 * the cards given back and for Treason against a neutral; hints for the neutral steps. T&B's
 * panel keeps the resource-only Forced Trade and the robber token; C&K's the rest.
 */
import type { Action, GameState } from '../../engine';
import { h, type Child } from '../../ui/dom';
import type { HudDialog, HudExtension } from '../../ui/expansions';
import type { HudView } from '../../ui/types';
import { ckSlice, type Good, type Knight } from '../ck/engine';
import { goodFace } from '../ck/ui';
import { NEUTRAL_NAMES } from '../tb/engine';
import { TWOCK, goodsTradePrice, neutralOf, type TwockPhase } from './engine';
import './twock.css';

type Send = (a: Action) => void;
const mine = (view: HudView, type: string): Action[] =>
  view.legal.filter((a) => a.player === view.viewer && a.type === type);
const field = (a: Action, k: string): unknown => (a as Record<string, unknown>)[k];
const nameOf = (state: GameState, p: number) => state.players[p]?.name ?? `Player ${p + 1}`;
const phaseOf = (state: GameState) => state.phase as unknown as TwockPhase;

function neutralLine(state: GameState): HTMLElement {
  const knights = Object.values(ckSlice(state).knights) as Knight[];
  const parts = ([0, 1] as const).map((i) => {
    const own = knights.filter((k) => neutralOf(state, k.owner) === i);
    const strong = own.filter((k) => k.level === 2).length;
    return `${NEUTRAL_NAMES[i]}: ${own.length} knight${own.length === 1 ? '' : 's'}${strong > 0 ? ` (${strong} strong)` : ''}`;
  });
  return h('p', { class: 'twock-fact' }, parts.join(' · '));
}

function panel(state: GameState, view: HudView, send: Send) {
  const body = h(
    'div',
    { class: 'twock-panel' },
    h('p', { class: 'twock-goal' }, `${state.settings.vpToWin} VP to win`),
    h(
      'p',
      { class: 'twock-fact' },
      'Recruiting a knight gives a neutral player a knight too; promoting one to strong promotes a neutral knight.',
    ),
    h(
      'p',
      { class: 'twock-fact' },
      'Remove a knight for trade tokens (basic 1, strong 2, mighty 3). Forced trades: resources only (T&B price), or any cards at twice the price.',
    ),
    neutralLine(state),
  );
  const goods = mine(view, 'twock/forcedTrade')[0];
  if (!view.spectator && goods) {
    body.append(
      h(
        'div',
        { class: 'twock-buttons' },
        h(
          'button',
          { class: 'btn twock-btn', on: { click: () => send(goods) } },
          `${goodsTradePrice(state, view.viewer)} tokens · Forced trade (any cards)`,
        ),
      ),
    );
  }
  return { title: 'Catan for Two + C&K', body };
}

function giveDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  const ph = phaseOf(state);
  if (ph.kind !== 'twock/forcedGive') return null;
  const options = mine(view, 'twock/forcedGive');
  if (options.length === 0) return null;
  const faces = (a: Action): Child[] => {
    const out: Child[] = [];
    for (const [k, n] of Object.entries({
      ...(field(a, 'resources') as Record<string, number>),
      ...(field(a, 'commodities') as Record<string, number>),
    })) {
      for (let i = 0; i < n; i++) out.push(goodFace(k as Good, 16));
    }
    return out;
  };
  return {
    key: `twock-give-${state.turn.number}-${state.log.length}`,
    title: 'Forced trade',
    modal: true,
    body: [
      h(
        'p',
        {},
        `Give ${ph.count} card${ph.count > 1 ? 's' : ''} of your choice to ${nameOf(state, 1 - view.viewer)}.`,
      ),
      h(
        'div',
        { class: 'twock-buttons' },
        ...options.map((a) =>
          h('button', { class: 'btn twock-btn', on: { click: () => send(a) } }, ...faces(a)),
        ),
      ),
    ],
  };
}

/** Treason: the opponent (C&K's pick) or a neutral player (its weakest knight). */
function deserterDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  const neutrals = mine(view, 'twock/deserterNeutral');
  if (neutrals.length === 0) return null;
  const players = mine(view, 'ck/pickPlayer');
  return {
    key: `twock-deserter-${state.turn.number}-${state.log.length}`,
    title: 'Treason',
    modal: true,
    body: [
      h(
        'p',
        {},
        'Whose knight deserts? A neutral player loses its weakest knight; your knight may take its place.',
      ),
      h(
        'div',
        { class: 'twock-buttons' },
        ...players.map((a) =>
          h(
            'button',
            { class: 'btn twock-btn', on: { click: () => send(a) } },
            nameOf(state, Number(field(a, 'target'))),
          ),
        ),
        ...neutrals.map((a) =>
          h(
            'button',
            { class: 'btn twock-btn', on: { click: () => send(a) } },
            NEUTRAL_NAMES[Number(field(a, 'neutral')) as 0 | 1],
          ),
        ),
      ),
    ],
  };
}

function hint(state: GameState, view: HudView): string | null {
  const ph = phaseOf(state);
  const acting = !view.spectator && view.legal.some((a) => a.player === view.viewer);
  if (ph.kind === 'twock/neutral') {
    if (!acting) return `${nameOf(state, state.turn.current)} builds for a neutral player`;
    return ph.step === 'recruit'
      ? `Place a free knight for ${NEUTRAL_NAMES[0]} or ${NEUTRAL_NAMES[1]}`
      : 'Promote a neutral knight to strong';
  }
  if (ph.kind === 'twock/forcedGive') return acting ? 'Forced trade: give cards back' : null;
  if (mine(view, 'twock/relocate').length > 0)
    return 'Move the displaced neutral knight to a highlighted spot';
  return null;
}

export const twockHud: HudExtension = {
  id: TWOCK,

  panel: (state, view, send) => panel(state, view, send),

  buildCards: [
    {
      mode: 'twock/tokens',
      label: 'Knight → tokens',
      actionType: 'twock/knightForTokens',
      glyph: 'knight',
    },
  ],

  dialog(state, view, _legal, send) {
    if (view.spectator) return null;
    return giveDialog(state, view, send) ?? deserterDialog(state, view, send);
  },

  hint,

  impliedActions: ['twock/neutralKnight', 'twock/neutralPromote', 'twock/relocate'],
};
