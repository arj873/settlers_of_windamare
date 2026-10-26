/**
 * Oil Springs HUD: a sidebar panel (Disaster Track, oil and sequestered oil per player, buttons to
 * convert / sequester / use the dev cards on oil / offer an oil trade), a Metropolis build card,
 * and dialogs for discarding oil on a 7, stealing oil and answering an oil trade.
 */
import {
  actingPlayers,
  type Action,
  type ExpansionAction,
  type GameState,
  type PlayerId,
  type Resource,
  type ResourceBundle,
} from '../../engine';
import { RESOURCES } from '../../engine/constants';
import { h, type Child } from '../../ui/dom';
import type { HudDialog, HudExtension } from '../../ui/expansions';
import { RESOURCE_LABEL } from '../../ui/icons';
import type { HudView } from '../../ui/types';
import { playerStyle, resCardFace } from '../../ui/widgets';
import {
  DISASTER_AT,
  METROPOLIS,
  OIL,
  metropolisCount,
  oilOf,
  oilScale,
  oilSlice,
  sequesteredOf,
  type OilTradePhase,
} from './engine';
import './oil.css';

type Send = (a: Action) => void;

const act = (a: Record<string, unknown>): Action => a as unknown as ExpansionAction;
const mine = (view: HudView, type: string): Action[] =>
  view.legal.filter((a) => a.player === view.viewer && a.type === type);
const flag = (a: Action, k: string): unknown => (a as Record<string, unknown>)[k];

/** A drop of oil (or a green drop for sequestered oil), static SVG. */
export function drop(size = 16, kind: 'oil' | 'saved' = 'oil'): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `oil-drop oil-drop-${kind}`;
  span.style.width = span.style.height = `${size}px`;
  span.setAttribute('role', 'img');
  span.setAttribute('aria-label', kind === 'oil' ? 'oil' : 'sequestered oil');
  const fill = kind === 'oil' ? '#1c1a22' : '#3f8f46';
  const edge = kind === 'oil' ? '#8d7be0' : '#1d4a28';
  span.innerHTML =
    `<svg viewBox="0 0 32 32" width="${size}" height="${size}">` +
    `<path d="M16 3c5.5 7.5 9.5 11.5 9.5 16.5a9.5 9.5 0 0 1-19 0C6.5 14.5 10.5 10.5 16 3z" fill="${fill}" stroke="${edge}" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M11 20a5.5 5.5 0 0 0 4.4 5" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>` +
    (kind === 'saved'
      ? `<path d="M12 18l3 3 6-7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`
      : '') +
    `</svg>`;
  return span;
}

const drops = (n: number, kind: 'oil' | 'saved', size = 14): Child[] =>
  Array.from({ length: n }, () => drop(size, kind));

/** The Disaster Track: six pips, the last one is the disaster. */
function track(marker: number): HTMLElement {
  return h(
    'div',
    {
      class: 'oil-track',
      attrs: { role: 'img', 'aria-label': `Pollution ${marker} of ${DISASTER_AT}` },
    },
    ...Array.from({ length: DISASTER_AT + 1 }, (_, i) =>
      h(
        'span',
        {
          class: `oil-pip${i <= marker ? ' is-on' : ''}${i === DISASTER_AT ? ' is-doom' : ''}`,
          title: i === DISASTER_AT ? 'Disaster' : String(i),
        },
        i === DISASTER_AT ? '!' : String(i),
      ),
    ),
  );
}

function playerRows(state: GameState): HTMLElement {
  const s = oilSlice(state);
  const cap = oilScale(state).cap;
  return h(
    'ul',
    { class: 'oil-list' },
    ...state.players.map((p) =>
      h(
        'li',
        { class: 'oil-row', style: playerStyle(p.color) },
        h(
          'span',
          { class: 'oil-name' },
          p.name,
          s.champion === p.id &&
            h('span', { class: 'oil-champ', title: 'Champion of the Environment' }, ' ★'),
        ),
        h(
          'span',
          { class: 'oil-held', title: `${oilOf(state, p.id)} of ${cap} oil` },
          ...drops(oilOf(state, p.id), 'oil'),
          oilOf(state, p.id) === 0 && h('span', { class: 'muted' }, '0'),
        ),
        h(
          'span',
          { class: 'oil-saved', title: `${sequesteredOf(state, p.id)} sequestered (3 = 1 VP)` },
          ...drops(sequesteredOf(state, p.id), 'saved', 12),
        ),
      ),
    ),
  );
}

/** A row of resource buttons; each sends `make(resource)`. */
function resourceButtons(
  options: Resource[],
  make: (r: Resource) => Action,
  send: Send,
): HTMLElement {
  return h(
    'span',
    { class: 'oil-res' },
    ...options.map((r) =>
      h(
        'button',
        {
          class: 'oil-resbtn',
          title: RESOURCE_LABEL[r],
          attrs: { 'aria-label': RESOURCE_LABEL[r] },
          on: { click: () => send(make(r)) },
        },
        resCardFace(r, 26),
      ),
    ),
  );
}

function tradeForm(state: GameState, view: HudView, send: Send): HTMLElement | null {
  const offers = mine(view, 'oil/offerTrade');
  if (offers.length === 0) return null;
  const me = view.viewer;
  const others = state.players.filter((p) => p.id !== me);
  const select = (opts: [string, string][]) => {
    const el = h('select', { class: 'oil-select' });
    for (const [value, label] of opts) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      el.append(o);
    }
    return el;
  };
  const dir = select([
    ['sell', 'Give oil for cards'],
    ['buy', 'Get oil for cards'],
  ]);
  const n = select([1, 2, 3, 4].map((i) => [String(i), `${i} oil`]));
  const m = select([1, 2, 3, 4].map((i) => [String(i), `${i} card${i > 1 ? 's' : ''}`]));
  const res = select(RESOURCES.map((r) => [r, RESOURCE_LABEL[r]]));
  const who = select(others.map((p) => [String(p.id), p.name]));
  const go = h('button', { class: 'btn btn-sm' }, 'Offer');
  const sync = () => {
    const sell = dir.value === 'sell';
    const oil = Number(n.value);
    const cards = Number(m.value);
    const r = res.value as Resource;
    const have = sell ? oilOf(state, me) >= oil : (state.players[me]?.resources[r] ?? 0) >= cards;
    (go as HTMLButtonElement).disabled = !have;
  };
  for (const el of [dir, n, m, res]) el.addEventListener('change', sync);
  go.addEventListener('click', () => {
    const sell = dir.value === 'sell';
    const bundle: ResourceBundle = { [res.value as Resource]: Number(m.value) };
    send(
      act({
        type: 'oil/offerTrade',
        player: me,
        to: Number(who.value),
        giveOil: sell ? Number(n.value) : 0,
        wantOil: sell ? 0 : Number(n.value),
        give: sell ? {} : bundle,
        want: sell ? bundle : {},
      }),
    );
  });
  sync();
  return h('div', { class: 'oil-trade' }, h('b', {}, 'Oil trade'), dir, n, m, res, who, go);
}

function actionsFor(state: GameState, view: HudView, send: Send): HTMLElement | null {
  const me = view.viewer;
  const rows: Child[] = [];
  const convert = mine(view, 'oil/convert');
  if (convert.length > 0) {
    rows.push(
      h(
        'div',
        { class: 'oil-act' },
        h('span', { class: 'oil-label' }, drop(14), ' 1 oil → 2 cards of'),
        resourceButtons(
          convert.map((a) => flag(a, 'resource') as Resource),
          (resource) => act({ type: 'oil/convert', player: me, resource }),
          send,
        ),
      ),
    );
  }
  if (mine(view, 'oil/sequester').length > 0) {
    rows.push(
      h(
        'div',
        { class: 'oil-act' },
        h(
          'button',
          {
            class: 'btn btn-sm',
            title: 'Flip 1 oil out of the game (3 sequestered = 1 VP). Not on a turn you used oil.',
            on: { click: () => send(act({ type: 'oil/sequester', player: me })) },
          },
          drop(14, 'saved'),
          ' Sequester 1 oil',
        ),
      ),
    );
  }
  const yop = mine(view, 'oil/yearOfPlenty');
  if (yop.length > 0) {
    rows.push(
      h(
        'div',
        { class: 'oil-act' },
        h('span', { class: 'oil-label' }, 'Year of Plenty: oil and'),
        h(
          'button',
          {
            class: 'oil-resbtn',
            title: 'Two oil',
            on: {
              click: () =>
                send(act({ type: 'oil/yearOfPlenty', player: me, picks: ['oil', 'oil'] })),
            },
          },
          drop(22),
        ),
        resourceButtons(
          yop
            .map((a) => (flag(a, 'picks') as string[])[1] as Resource)
            .filter((r) => r !== ('oil' as string)),
          (r) => act({ type: 'oil/yearOfPlenty', player: me, picks: ['oil', r] }),
          send,
        ),
      ),
    );
  }
  if (mine(view, 'oil/monopoly').length > 0) {
    rows.push(
      h(
        'div',
        { class: 'oil-act' },
        h(
          'button',
          {
            class: 'btn btn-sm',
            on: { click: () => send(act({ type: 'oil/monopoly', player: me })) },
          },
          drop(14),
          ' Monopoly on oil',
        ),
      ),
    );
  }
  const form = tradeForm(state, view, send);
  if (form) rows.push(form);
  return rows.length > 0 ? h('div', { class: 'oil-actions' }, ...rows) : null;
}

// --- dialogs -------------------------------------------------------------------------------

interface Draft {
  key: string;
  res: ResourceBundle;
  oil: number;
}
let discardDraft: Draft = { key: '', res: {}, oil: 0 };

function stepper(
  label: Child,
  max: number,
  get: () => number,
  set: (n: number) => void,
  onChange: () => void,
): HTMLElement {
  const val = h('b', { class: 'oil-count' }, String(get()));
  const bump = (d: number) => () => {
    set(Math.max(0, Math.min(max, get() + d)));
    val.textContent = String(get());
    onChange();
  };
  return h(
    'div',
    { class: 'oil-step' },
    h('span', { class: 'oil-step-label' }, label),
    h(
      'button',
      { class: 'btn btn-sm btn-ghost', attrs: { 'aria-label': 'less' }, on: { click: bump(-1) } },
      '−',
    ),
    val,
    h(
      'button',
      { class: 'btn btn-sm btn-ghost', attrs: { 'aria-label': 'more' }, on: { click: bump(1) } },
      '+',
    ),
    h('span', { class: 'muted' }, `of ${max}`),
  );
}

function discardDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  const phase = state.phase;
  if (phase.kind !== 'discard' || mine(view, 'oil/discard').length === 0) return null;
  const me = view.viewer;
  const owed = phase.pending[me] ?? 0;
  const hand = state.players[me]?.resources;
  if (!hand || owed <= 0) return null;
  const key = `oil-discard-${state.turn.number}-${me}`;
  if (discardDraft.key !== key) discardDraft = { key, res: {}, oil: 0 };
  const total = () =>
    discardDraft.oil + RESOURCES.reduce((n, r) => n + (discardDraft.res[r] ?? 0), 0);
  const sum = h('b', {}, `${total()} / ${owed}`);
  const ok = h('button', { class: 'btn btn-primary' }, 'Discard');
  const sync = () => {
    sum.textContent = `${total()} / ${owed}`;
    (ok as HTMLButtonElement).disabled = total() !== owed;
  };
  ok.addEventListener('click', () =>
    send(
      act({
        type: 'oil/discard',
        player: me,
        resources: { ...discardDraft.res },
        oil: discardDraft.oil,
      }),
    ),
  );
  const rows = [
    stepper(
      drop(18),
      oilOf(state, me),
      () => discardDraft.oil,
      (n) => (discardDraft.oil = n),
      sync,
    ),
    ...RESOURCES.filter((r) => hand[r] > 0).map((r) =>
      stepper(
        resCardFace(r, 22),
        hand[r],
        () => discardDraft.res[r] ?? 0,
        (n) => (discardDraft.res[r] = n),
        sync,
      ),
    ),
  ];
  sync();
  return {
    key,
    title: 'Discard cards',
    modal: true,
    body: [
      h('p', {}, `A 7 was rolled. Discard ${owed} cards; oil goes back to the supply.`),
      ...rows,
      h('p', {}, 'Selected: ', sum),
      h('div', { class: 'dialog-actions' }, ok),
    ],
  };
}

function stealDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  const options = mine(view, 'oil/steal');
  if (state.phase.kind !== 'steal' || options.length === 0) return null;
  const me = view.viewer;
  const victims = [...new Set(options.map((a) => flag(a, 'victim') as PlayerId))];
  return {
    key: `oil-steal-${state.turn.number}`,
    title: 'Steal',
    modal: true,
    body: [
      h('p', {}, 'Take a random card, or 1 oil.'),
      ...victims.map((v) => {
        const p = state.players[v];
        const canOil = options.some((a) => flag(a, 'victim') === v && flag(a, 'oil') === true);
        return h(
          'div',
          { class: 'oil-victim', style: playerStyle(p?.color ?? '#888') },
          h('b', {}, p?.name ?? `Player ${v + 1}`),
          h(
            'button',
            {
              class: 'btn btn-sm',
              on: {
                click: () => send(act({ type: 'oil/steal', player: me, victim: v, oil: false })),
              },
            },
            'Random card',
          ),
          canOil &&
            h(
              'button',
              {
                class: 'btn btn-sm',
                on: {
                  click: () => send(act({ type: 'oil/steal', player: me, victim: v, oil: true })),
                },
              },
              drop(14),
              ` Oil (${oilOf(state, v)})`,
            ),
        );
      }),
    ],
  };
}

function tradeDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  const t = state.phase as OilTradePhase;
  if (state.phase.kind !== 'oil/trade' || t.to !== view.viewer) return null;
  const from = state.players[t.from];
  const bundle = (b: ResourceBundle, oil: number): Child[] => [
    ...drops(oil, 'oil', 18),
    ...RESOURCES.flatMap((r) => Array.from({ length: b[r] ?? 0 }, () => resCardFace(r, 24))),
  ];
  const can = mine(view, 'oil/acceptTrade').length > 0;
  return {
    key: `oil-trade-${state.turn.number}-${t.from}`,
    title: 'Oil trade offer',
    modal: true,
    body: [
      h('p', {}, `${from?.name ?? 'A player'} offers you`),
      h('div', { class: 'oil-offer' }, ...bundle(t.give, t.giveOil)),
      h('p', {}, 'for your'),
      h('div', { class: 'oil-offer' }, ...bundle(t.want, t.wantOil)),
      !can && h('p', { class: 'muted' }, 'You cannot accept this (cards or oil limit).'),
      h(
        'div',
        { class: 'dialog-actions' },
        h(
          'button',
          {
            class: 'btn btn-primary',
            disabled: !can,
            on: { click: () => send(act({ type: 'oil/acceptTrade', player: view.viewer })) },
          },
          'Accept',
        ),
        h(
          'button',
          {
            class: 'btn btn-ghost',
            on: { click: () => send(act({ type: 'oil/rejectTrade', player: view.viewer })) },
          },
          'Decline',
        ),
      ),
    ],
  };
}

export const oilHud: HudExtension = {
  id: OIL,

  panel(state, view, send) {
    const s = oilSlice(state);
    const scale = oilScale(state);
    const body = h(
      'div',
      { class: 'oil-panel' },
      h('div', { class: 'oil-head' }, h('b', {}, 'Pollution'), track(s.marker)),
      h(
        'p',
        { class: 'muted oil-facts' },
        `Oil supply ${s.supply} · metropolises left ${scale.metropolises - metropolisCount(state)} · hexes lost ${s.destroyed.length}/${scale.ruin} · cap ${scale.cap} oil`,
      ),
      playerRows(state),
    );
    const actions = actionsFor(state, view, send);
    if (actions) body.append(actions);
    return { title: 'Oil Springs', body };
  },

  buildCards: [
    {
      mode: 'oil/metropolis',
      label: 'Metropolis',
      actionType: 'oil/metropolis',
      glyph: 'city',
      costItem: METROPOLIS,
      left: (state) => oilScale(state).metropolises - metropolisCount(state),
      total: (state) => oilScale(state).metropolises,
    },
  ],

  dialog(state, view, _legal, send) {
    return (
      discardDialog(state, view, send) ??
      stealDialog(state, view, send) ??
      tradeDialog(state, view, send)
    );
  },

  hint(state, view) {
    const phase = state.phase;
    if (phase.kind === 'oil/trade' && actingPlayers(state).includes(view.viewer)) {
      return 'Answer the oil trade offer';
    }
    return null;
  },
};
