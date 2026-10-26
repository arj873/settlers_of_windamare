/**
 * T&B + C&K HUD: a short panel with the pair's rules (VP target; Fishermen: 7 fish for a
 * progress card; Rivers: commodities for gold), the camel vote with brick and lumber, and the
 * C&K knight dialog with a hint for chasing a barbarian (a board click on its path). Everything
 * else is the C&K and T&B HUDs.
 */
import type { Action, GameState } from '../../engine';
import { h, type Child } from '../../ui/dom';
import type { HudDialog, HudExtension } from '../../ui/expansions';
import type { HudView } from '../../ui/types';
import { resCardFace } from '../../ui/widgets';
import { TRACK_LABEL, ckHud } from '../ck/ui';
import { has } from '../tb/engine';
import { TBCK } from './engine';
import './tbck.css';

type Send = (a: Action) => void;
const mine = (view: HudView, type: string): Action[] =>
  view.legal.filter((a) => a.player === view.viewer && a.type === type);
const field = (a: Action, k: string): unknown => (a as Record<string, unknown>)[k];

function buttons(view: HudView, send: Send, type: string, label: (a: Action) => Child): Child {
  const list = mine(view, type);
  if (list.length === 0) return null;
  return h(
    'div',
    { class: 'tbck-buttons' },
    ...list.map((a) =>
      h('button', { class: 'btn tbck-btn', on: { click: () => send(a) } }, label(a)),
    ),
  );
}

function panel(state: GameState, view: HudView, send: Send) {
  const rules: string[] = [];
  if (has(state, 'fish')) rules.push('7 fish buy a progress card; 3 fish steal any card.');
  if (has(state, 'rivers')) {
    rules.push('Commodities sell for gold like resources. The Diplomat never takes a bridge.');
  }
  if (has(state, 'caravans')) rules.push('The camel vote is bid with brick and lumber.');
  if (has(state, 'traders')) {
    rules.push('An active knight next to a barbarian may chase it (and rob the road owner).');
  }
  rules.push('The robber (and the barbarians’ 7 move) sleep until the first attack.');
  const body = h(
    'div',
    { class: 'tbck-panel' },
    h('p', { class: 'tbck-goal' }, `${state.settings.vpToWin} VP to win`),
    ...rules.map((r) => h('p', { class: 'tbck-fact' }, r)),
  );
  if (!view.spectator) {
    const fish = buttons(view, send, 'tbck/fishProgress', (a) => {
      const t = field(a, 'track') as keyof typeof TRACK_LABEL;
      return `7 fish: ${TRACK_LABEL[t] ?? t}`;
    });
    const sell = buttons(
      view,
      send,
      'tbck/sellCommodity',
      (a) => `Sell ${String(field(a, 'commodity'))} for gold`,
    );
    for (const x of [fish, sell]) if (x) body.append(x as Node);
  }
  return { title: 'T&B + C&K', body };
}

/** The camel vote, bid with brick and lumber (C4). */
function voteDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  if (state.phase.kind !== 'tb/vote' || !has(state, 'caravans')) return null;
  const bids = mine(view, 'tb/bid');
  if (bids.length === 0) return null;
  const options = bids
    .map((a) => ({
      a,
      brick: Number(field(a, 'brick') ?? 0),
      lumber: Number(field(a, 'lumber') ?? 0),
    }))
    .sort((x, y) => x.brick + x.lumber - (y.brick + y.lumber));
  return {
    key: `tbck-vote-${state.turn.number}-${view.viewer}`,
    title: 'Camel vote',
    modal: true,
    body: [
      h(
        'p',
        {},
        'A camel joins a caravan. Bid brick and lumber (1 vote each, paid to the bank); the most votes decides where it goes.',
      ),
      h(
        'div',
        { class: 'tbck-buttons' },
        ...options.map(({ a, brick, lumber }) =>
          h(
            'button',
            {
              class: `btn tbck-btn${brick + lumber === 0 ? '' : ' btn-primary'}`,
              on: { click: () => send(a) },
            },
            brick + lumber === 0 ? 'Pass' : `Vote ${brick + lumber}`,
            ...Array.from({ length: brick }, () => resCardFace('brick', 14)),
            ...Array.from({ length: lumber }, () => resCardFace('lumber', 14)),
          ),
        ),
      ),
    ],
  };
}

export const tbckHud: HudExtension = {
  id: TBCK,

  panel: (state, view, send) => panel(state, view, send),

  dialog(state, view, legal, send) {
    const vote = voteDialog(state, view, send);
    if (vote) return vote;
    if (state.phase.kind !== 'ck/knight') return null;
    const base = ckHud.dialog?.(state, view, legal, send) ?? null;
    if (!base || mine(view, 'tbck/chaseBarbarian').length === 0) return base;
    return {
      ...base,
      key: `${base.key}-barbarian`,
      body: [
        ...base.body,
        h(
          'p',
          { class: 'tbck-fact' },
          'Click a highlighted barbarian next to this knight to chase it away (the knight is deactivated).',
        ),
      ],
    };
  },

  hint(state, view) {
    if (state.phase.kind !== 'ck/knight' || state.turn.current !== view.viewer) return null;
    return mine(view, 'tbck/chaseBarbarian').length > 0
      ? 'Move the knight, or click a barbarian next to it to chase it'
      : null;
  },

  impliedActions: ['tbck/chaseBarbarian'],
};
