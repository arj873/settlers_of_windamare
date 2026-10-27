/**
 * Cities & Knights HUD: a sidebar panel (barbarian track and strengths, the event die, the
 * viewer's city improvements with Improve buttons, players' knights / commodities / progress
 * cards / Defender cards, commodity trades, the Alchemist), build cards (knight, activate,
 * promote, knight action, city wall), commodities and progress cards in the hand bar, and
 * dialogs for discards with commodities, every C&K choice (prompts) and the selected knight.
 */
import {
  RESOURCES,
  costOf,
  type Action,
  type ExpansionAction,
  type GameState,
  type PlayerId,
  type Resource,
} from '../../engine';
import { h, type Child } from '../../ui/dom';
import type { HudDialog, HudExtension } from '../../ui/expansions';
import { RESOURCE_LABEL } from '../../ui/icons';
import type { HudView } from '../../ui/types';
import { playerStyle, resCardFace } from '../../ui/widgets';
import {
  ACTIVATE_ITEM,
  BARBARIAN_STEPS,
  CARD_NAMES,
  CARD_TEXT,
  CARD_TRACK,
  CK,
  COMMODITIES,
  IMPROVEMENT_NAMES,
  KNIGHT_ITEM,
  KNIGHTS_PER_LEVEL,
  MAX_LEVEL,
  PROGRESS_HAND_MAX,
  PROMOTE_ITEM,
  TRACK_COMMODITY,
  TRACKS,
  WALL_ITEM,
  WALLS_PER_PLAYER,
  activeStrength,
  barbarianStrength,
  canChase,
  choiceOf,
  ckSlice,
  commodityCount,
  defenderStrength,
  displaceTargets,
  giveRatio,
  improvementCost,
  isCommodity,
  knightActionBlocker,
  knightsInSupply,
  knightsOf,
  metropolisesOf,
  moveTargets,
  phaseOf,
  promptFor,
  redDieDraws,
  wallsOf,
  shipSails,
  type Choice,
  type CkAction,
  type Commodity,
  type Good,
  type ProgressCard,
  type Track,
} from './engine';
import './ck.css';

type Send = (a: Action) => void;

const act = (a: Record<string, unknown>): Action => a as unknown as ExpansionAction;
const mine = (view: HudView, type: string): Action[] =>
  view.legal.filter((a) => a.player === view.viewer && a.type === type);
const field = (a: Action, k: string): unknown => (a as Record<string, unknown>)[k];

export const TRACK_LABEL: Readonly<Record<Track, string>> = {
  trade: 'Trade',
  politics: 'Politics',
  science: 'Science',
};
export const COMMODITY_LABEL: Readonly<Record<Commodity, string>> = {
  paper: 'Paper',
  cloth: 'Cloth',
  coin: 'Coin',
};
const ABILITY: Readonly<Record<Track, string>> = {
  trade: 'Trading House: commodities 2:1',
  politics: 'Fortress: mighty knights',
  science: 'Aqueduct: a free resource on an empty roll',
};
const goodLabel = (g: Good) => (isCommodity(g) ? COMMODITY_LABEL[g] : RESOURCE_LABEL[g]);
const KNIGHT_TITLE = { 1: 'Basic', 2: 'Strong', 3: 'Mighty' } as const;

// ---------------------------------------------------------------------------
// Icons and card faces (static SVG; colours from the card faces / theme)
// ---------------------------------------------------------------------------

const COMMODITY_SVG: Readonly<Record<Commodity, string>> = {
  paper:
    '<path d="M8 7h14a3 3 0 0 1 3 3v14a3 3 0 0 0 3-3V8" fill="none" stroke="#5a4a2a" stroke-width="1.6"/><rect x="5" y="6" width="17" height="21" rx="2" fill="#fbf4dc" stroke="#5a4a2a" stroke-width="1.6"/><path d="M9 12h9M9 16h9M9 20h6" stroke="#8a7a52" stroke-width="1.6" stroke-linecap="round"/>',
  cloth:
    '<path d="M6 9c4-3 16-3 20 0v14c-4-3-16-3-20 0z" fill="#b24f86" stroke="#4a1734" stroke-width="1.6" stroke-linejoin="round"/><path d="M6 13c4-3 16-3 20 0M6 17c4-3 16-3 20 0" fill="none" stroke="#e6a3c9" stroke-width="1.3"/>',
  coin: '<circle cx="16" cy="16" r="11" fill="#e8c13a" stroke="#6b4a14" stroke-width="1.8"/><circle cx="16" cy="16" r="7.5" fill="none" stroke="#a87b16" stroke-width="1.4"/><path d="M16 11v10M13 13.5h5a2 2 0 0 1 0 4h-4a2 2 0 0 0 0 4h5" fill="none" stroke="#6b4a14" stroke-width="1.5" stroke-linecap="round"/>',
};

const TRACK_SVG: Readonly<Record<Track, string>> = {
  trade:
    '<path d="M16 5v20M8 25h16M6 12h20M6 12l-3 7a3 3 0 0 0 6 0zm20 0-3 7a3 3 0 0 0 6 0z" fill="none" stroke="#3a2a08" stroke-width="1.8" stroke-linejoin="round"/>',
  politics:
    '<path d="M6 22h20l-2-11-5 5-3-8-3 8-5-5z" fill="#fff4c2" stroke="#10224a" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 25h20" stroke="#10224a" stroke-width="2"/>',
  science:
    '<path d="M13 5h6M14 5v8l-7 11a2 2 0 0 0 2 3h14a2 2 0 0 0 2-3l-7-11V5" fill="#e9f7e4" stroke="#163b1c" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 20h12" stroke="#3f9d4b" stroke-width="2"/>',
};

function svg(markup: string, size: number, label?: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'ck-ico';
  span.style.width = span.style.height = `${size}px`;
  if (label) {
    span.setAttribute('role', 'img');
    span.setAttribute('aria-label', label);
  } else span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}">${markup}</svg>`;
  return span;
}

/** A commodity card face (same frame as resource cards). */
export function commodityFace(c: Commodity, w: number, ...extra: Child[]): HTMLElement {
  return h(
    'span',
    {
      class: `card-face ck-cf ck-cf-${c}`,
      style: { '--cw': `${w}px` },
      attrs: { role: 'img', 'aria-label': COMMODITY_LABEL[c] },
    },
    svg(COMMODITY_SVG[c], Math.round(w * 0.72)),
    ...extra,
  );
}

/** A card face standing for "commodity cards" of any type (players' public totals). */
function anyCommodityFace(w: number): HTMLElement {
  return h('span', {
    class: 'card-face ck-cf ck-cf-any',
    style: { '--cw': `${w}px` },
    attrs: { 'aria-hidden': 'true' },
  });
}

export function goodFace(g: Good, w: number): HTMLElement {
  return isCommodity(g) ? commodityFace(g, w) : resCardFace(g as Resource, w);
}

/** A progress card face in its deck's colour. */
export function progressFace(card: ProgressCard, w: number, ...extra: Child[]): HTMLElement {
  const t = CARD_TRACK[card];
  return h(
    'span',
    {
      class: `card-face ck-pf ck-pf-${t}`,
      style: { '--cw': `${w}px` },
      attrs: { role: 'img', 'aria-label': CARD_NAMES[card] },
    },
    svg(TRACK_SVG[t], Math.round(w * 0.6)),
    h('span', { class: 'ck-pf-name' }, CARD_NAMES[card]),
    ...extra,
  );
}

const SHIP_SVG =
  '<path d="M4 20h24l-4 6H8z" fill="#5b3a1e" stroke="#1d1208" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 4v16" stroke="#1d1208" stroke-width="1.8"/><path d="M16 5l9 12H16z" fill="#d9433a" stroke="#1d1208" stroke-width="1.4" stroke-linejoin="round"/><path d="M15 7 8 17h7z" fill="#f3e5c0" stroke="#1d1208" stroke-width="1.4" stroke-linejoin="round"/>';
const CASTLE_SVG =
  '<path d="M6 27V12h4v3h3v-3h6v3h3v-3h4v15z" fill="#8f877b" stroke="#1d1208" stroke-width="1.6" stroke-linejoin="round"/><path d="M13 27v-6a3 3 0 0 1 6 0v6" fill="#1d1208"/>';

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function barbarianTrack(state: GameState): HTMLElement {
  const s = ckSlice(state);
  const b = barbarianStrength(state);
  const k = defenderStrength(state);
  const cells = Array.from({ length: BARBARIAN_STEPS + 1 }, (_, i) =>
    h(
      'span',
      {
        class: `ck-cell${i === s.barbarian ? ' is-ship' : ''}${i === BARBARIAN_STEPS ? ' is-land' : ''}`,
        title: i === BARBARIAN_STEPS ? 'Catan: the barbarians attack' : `Step ${i}`,
      },
      i === s.barbarian
        ? svg(SHIP_SVG, 20, 'Barbarian ship')
        : i === BARBARIAN_STEPS && svg(CASTLE_SVG, 18),
    ),
  );
  return h(
    'div',
    { class: 'ck-barb' },
    h(
      'div',
      { class: 'ck-barb-head' },
      h('b', {}, 'Barbarians'),
      h(
        'span',
        {
          class: `ck-vs${b > k ? ' is-bad' : ' is-good'}`,
          title: 'Cities on the board (barbarian strength) vs active knights of all players',
        },
        `${b} cities vs ${k} knights`,
      ),
    ),
    h(
      'div',
      {
        class: 'ck-track',
        attrs: { role: 'img', 'aria-label': `Ship at ${s.barbarian} of ${BARBARIAN_STEPS}` },
      },
      ...cells,
    ),
    h(
      'p',
      { class: 'muted ck-facts' },
      s.event
        ? `Event die: ${s.event === 'ship' ? 'ship' : `${TRACK_LABEL[s.event]} gate`}`
        : 'Event die not rolled yet',
      ' · ',
      s.attacks === 0
        ? 'robber asleep until the first attack'
        : `${s.attacks} attack${s.attacks > 1 ? 's' : ''}`,
    ),
  );
}

function trackRows(state: GameState, view: HudView, send: Send): HTMLElement {
  const me = view.viewer;
  const s = ckSlice(state);
  const pl = s.players[me];
  const improve = mine(view, 'ck/improve');
  return h(
    'div',
    { class: 'ck-tracks' },
    ...TRACKS.map((t) => {
      const level = pl?.improvements[t] ?? 0;
      const metro = s.metropolis[t];
      const can = improve.find((a) => field(a, 'track') === t);
      const cost = level < MAX_LEVEL ? improvementCost(state, me, t) : 0;
      const sub =
        level >= 3
          ? ABILITY[t]
          : level > 0
            ? `progress cards on a red die of ${redDieDraws(level)} or less`
            : 'no progress cards yet';
      return h(
        'div',
        { class: `ck-trk ck-trk-${t}`, title: `${TRACK_LABEL[t]} level ${level}: ${sub}` },
        h('span', { class: 'ck-trk-ico' }, svg(TRACK_SVG[t], 18, TRACK_LABEL[t])),
        h(
          'span',
          { class: 'ck-trk-main' },
          h(
            'span',
            { class: 'ck-trk-name' },
            h('b', {}, TRACK_LABEL[t]),
            ' ',
            level > 0 ? IMPROVEMENT_NAMES[t][level - 1] : 'none',
            metro && ' · ',
            metro &&
              h(
                'span',
                {
                  class: 'ck-metro-tag',
                  style: playerStyle(state.players[metro.owner]?.color ?? '#888'),
                },
                `metropolis: ${state.players[metro.owner]?.name ?? '?'}`,
              ),
          ),
          h(
            'span',
            { class: 'ck-pips', title: `Level ${level} of ${MAX_LEVEL}` },
            ...Array.from({ length: MAX_LEVEL }, (_, i) =>
              h('span', {
                class: `ck-pip${i < level ? ' is-on' : ''}${i >= 3 ? ' is-metro' : ''}`,
              }),
            ),
          ),
        ),
        level < MAX_LEVEL &&
          h(
            'button',
            {
              class: 'btn btn-sm ck-improve',
              disabled: !can,
              title: `${IMPROVEMENT_NAMES[t][level]} (level ${level + 1}): ${cost} ${TRACK_COMMODITY[t]}`,
              attrs: {
                'aria-label': `Improve ${t} to level ${level + 1} (${IMPROVEMENT_NAMES[t][level]}): ${cost} ${TRACK_COMMODITY[t]}`,
              },
              on: { click: () => can && send(can) },
            },
            `${cost}×`,
            commodityFace(TRACK_COMMODITY[t], 14),
          ),
      );
    }),
  );
}

function playerRows(state: GameState): HTMLElement {
  const s = ckSlice(state);
  return h(
    'ul',
    { class: 'ck-list' },
    ...state.players.map((p) => {
      const cp = s.players[p.id];
      const knights = knightsOf(state, p.id);
      // Online views zero other seats' per-type split: the public total comes from the helper.
      const commodities = commodityCount(state, p.id);
      return h(
        'li',
        { class: 'ck-row', style: playerStyle(p.color) },
        h('span', { class: 'ck-name' }, p.name),
        h(
          'span',
          {
            class: 'ck-stat',
            title: `Knights: ${activeStrength(state, p.id)} active strength, ${knights.length} on the board`,
          },
          '⚔ ',
          String(activeStrength(state, p.id)),
          h('span', { class: 'muted' }, `/${knights.length}`),
        ),
        h(
          'span',
          { class: 'ck-stat', title: 'Commodity cards' },
          // Not a coin face: online, other seats' split is hidden and only the total is known.
          anyCommodityFace(11),
          String(commodities),
        ),
        h(
          'span',
          { class: 'ck-stat', title: 'Progress cards in hand' },
          '🂠 ',
          String(cp?.progress.length ?? 0),
        ),
        h(
          'span',
          { class: 'ck-badges' },
          ...metropolisesOf(state, p.id).map((t) =>
            h('span', {
              class: `ck-mtag ck-mtag-${t}`,
              title: `${TRACK_LABEL[t]} metropolis (2 VP)`,
            }),
          ),
          (cp?.defender ?? 0) > 0 &&
            h(
              'span',
              { class: 'ck-def', title: 'Defender of Catan (1 VP each)' },
              `★${cp?.defender}`,
            ),
          (cp?.vpCards.length ?? 0) > 0 &&
            h(
              'span',
              { class: 'ck-def', title: cp?.vpCards.map((c) => CARD_NAMES[c]).join(', ') },
              `✎${cp?.vpCards.length}`,
            ),
          s.merchant?.owner === p.id &&
            h('span', { class: 'ck-def', title: 'Merchant (1 VP)' }, '⛀'),
        ),
      );
    }),
  );
}

function select(opts: readonly [string, string][], label: string): HTMLSelectElement {
  const el = h('select', { class: 'ck-select', attrs: { 'aria-label': label } });
  for (const [value, label] of opts) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    el.append(o);
  }
  return el;
}

function bankForm(state: GameState, view: HudView, send: Send): HTMLElement | null {
  const trades = mine(view, 'ck/bankTrade');
  if (trades.length === 0) return null;
  const gives = [...new Set(trades.map((a) => field(a, 'give') as Good))];
  const give = select(
    gives.map((g) => [g, goodLabel(g)]),
    'Bank: give',
  );
  const receive = select([], 'Bank: receive');
  const go = h('button', { class: 'btn btn-sm' }, 'Trade');
  // The button states the price: one click trades at once (no dialog).
  const price = () => {
    const n = giveRatio(state, view.viewer, give.value as Good);
    go.textContent = `Trade ${n}:1`;
    const got = goodLabel(receive.value as Good);
    go.setAttribute('aria-label', `Give ${n} ${goodLabel(give.value as Good)} for 1 ${got}`);
  };
  receive.addEventListener('change', price);
  const sync = () => {
    const options = trades.filter((a) => field(a, 'give') === give.value);
    receive.replaceChildren(
      ...options.map((a) => {
        const o = document.createElement('option');
        o.value = String(field(a, 'receive'));
        o.textContent = goodLabel(field(a, 'receive') as Good);
        return o;
      }),
    );
    price();
  };
  give.addEventListener('change', sync);
  go.addEventListener('click', () => {
    const a = trades.find(
      (x) => field(x, 'give') === give.value && field(x, 'receive') === receive.value,
    );
    if (a) send(a);
  });
  sync();
  return h('div', { class: 'ck-form' }, h('b', {}, 'Bank'), give, h('span', {}, '→'), receive, go);
}

function offerForm(state: GameState, view: HudView, send: Send): HTMLElement | null {
  if (mine(view, 'ck/offerTrade').length === 0) return null;
  const me = view.viewer;
  const goods = [...RESOURCES, ...COMMODITIES] as Good[];
  const counts = select(
    [1, 2, 3].map((n) => [String(n), String(n)]),
    'Offer: give count',
  );
  const give = select(
    goods.map((g) => [g, goodLabel(g)]),
    'Offer: give',
  );
  const wantN = select(
    [1, 2, 3].map((n) => [String(n), String(n)]),
    'Offer: want count',
  );
  const want = select(
    goods.map((g) => [g, goodLabel(g)]),
    'Offer: want',
  );
  want.value = 'coin';
  const go = h('button', { class: 'btn btn-sm' }, 'Offer');
  const others = state.players.filter((p) => p.id !== me).map((p) => p.id);
  go.addEventListener('click', () =>
    send(
      act({
        type: 'ck/offerTrade',
        player: me,
        give: { [give.value]: Number(counts.value) },
        want: { [want.value]: Number(wantN.value) },
        to: others,
      }),
    ),
  );
  return h(
    'div',
    { class: 'ck-form' },
    h('b', {}, 'Offer'),
    counts,
    give,
    h('span', {}, 'for'),
    wantN,
    want,
    go,
  );
}

function alchemistForm(view: HudView, send: Send): HTMLElement | null {
  if (mine(view, 'ck/alchemist').length === 0) return null;
  const faces = [1, 2, 3, 4, 5, 6].map((n): [string, string] => [String(n), String(n)]);
  const yellow = select(faces, 'Alchemist: yellow die');
  const red = select(faces, 'Alchemist: red die');
  return h(
    'div',
    { class: 'ck-form' },
    h('b', { title: CARD_TEXT.alchemist }, 'Alchemist'),
    h('span', { class: 'ck-die ck-die-y' }, 'yellow'),
    yellow,
    h('span', { class: 'ck-die ck-die-r' }, 'red'),
    red,
    h(
      'button',
      {
        class: 'btn btn-sm',
        on: {
          click: () =>
            send(
              act({
                type: 'ck/alchemist',
                player: view.viewer,
                yellow: Number(yellow.value),
                red: Number(red.value),
              }),
            ),
        },
      },
      'Play',
    ),
  );
}

function progressList(state: GameState, view: HudView, send: Send): HTMLElement | null {
  const cards = ckSlice(state).players[view.viewer]?.progress ?? [];
  if (cards.length === 0) return null;
  const plays = mine(view, 'ck/play');
  const discards = mine(view, 'ck/discardProgress');
  const over = cards.length > PROGRESS_HAND_MAX;
  return h(
    'div',
    { class: 'ck-cards' },
    over &&
      h(
        'p',
        { class: 'ck-warn' },
        `Play or discard down to ${PROGRESS_HAND_MAX} before ending your turn.`,
      ),
    ...[...new Set(cards)].map((c) => {
      const play = plays.find((a) => field(a, 'card') === c);
      const drop = discards.find((a) => field(a, 'card') === c);
      const n = cards.filter((x) => x === c).length;
      return h(
        'div',
        { class: `ck-card ck-card-${CARD_TRACK[c]}` },
        h('span', { class: 'ck-card-name', title: CARD_TEXT[c] }, CARD_NAMES[c], n > 1 && ` ×${n}`),
        h('span', { class: 'muted ck-card-text' }, CARD_TEXT[c]),
        // Named per card: two cards' "Play" buttons must not share a name.
        play &&
          h(
            'button',
            {
              class: 'btn btn-sm',
              attrs: { 'aria-label': `Play ${CARD_NAMES[c]}` },
              on: { click: () => send(play) },
            },
            'Play',
          ),
        drop &&
          h(
            'button',
            {
              class: 'btn btn-sm btn-ghost',
              attrs: { 'aria-label': `Discard ${CARD_NAMES[c]}` },
              on: { click: () => send(drop) },
            },
            'Discard',
          ),
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

let draft: { key: string; picks: Partial<Record<Good, number>> } = { key: '', picks: {} };

function stepper(g: Good, max: number, onChange: () => void): HTMLElement {
  const val = h('b', { class: 'ck-count' }, String(draft.picks[g] ?? 0));
  const bump = (d: number) => () => {
    draft.picks[g] = Math.max(0, Math.min(max, (draft.picks[g] ?? 0) + d));
    val.textContent = String(draft.picks[g]);
    onChange();
  };
  return h(
    'div',
    { class: 'ck-step' },
    goodFace(g, 22),
    h(
      'button',
      {
        class: 'btn btn-sm btn-ghost',
        attrs: { 'aria-label': `less ${g}` },
        on: { click: bump(-1) },
      },
      '−',
    ),
    val,
    h(
      'button',
      {
        class: 'btn btn-sm btn-ghost',
        attrs: { 'aria-label': `more ${g}` },
        on: { click: bump(1) },
      },
      '+',
    ),
    h('span', { class: 'muted' }, `of ${max}`),
  );
}

function discardDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  const phase = phaseOf(state);
  if (phase.kind !== 'discard' && phase.kind !== 'ck/sabotage' && phase.kind !== 'ck/wedding')
    return null;
  if (mine(view, 'ck/discard').length === 0) return null;
  const me = view.viewer;
  const owed = phase.pending[me] ?? 0;
  if (owed <= 0) return null;
  const key = `ck-discard-${phase.kind}-${state.turn.number}-${me}`;
  if (draft.key !== key) draft = { key, picks: {} };
  const have = (g: Good) =>
    isCommodity(g)
      ? (ckSlice(state).players[me]?.commodities[g] ?? 0)
      : (state.players[me]?.resources[g] ?? 0);
  const goods = ([...RESOURCES, ...COMMODITIES] as Good[]).filter((g) => have(g) > 0);
  const total = () => goods.reduce((n, g) => n + (draft.picks[g] ?? 0), 0);
  const sum = h('b', {}, `${total()} / ${owed}`);
  const go = h(
    'button',
    { class: 'btn btn-primary' },
    phase.kind === 'ck/wedding' ? 'Give' : 'Discard',
  );
  const sync = () => {
    sum.textContent = `${total()} / ${owed}`;
    go.disabled = total() !== owed;
  };
  go.addEventListener('click', () => {
    const resources: Record<string, number> = {};
    const commodities: Record<string, number> = {};
    for (const g of goods) {
      const n = draft.picks[g] ?? 0;
      if (n > 0) (isCommodity(g) ? commodities : resources)[g] = n;
    }
    send(act({ type: 'ck/discard', player: me, resources, commodities }));
  });
  const rows = goods.map((g) => stepper(g, have(g), sync));
  sync();
  const why =
    phase.kind === 'discard'
      ? `A 7 was rolled. Discard ${owed} cards (commodities count).`
      : phase.kind === 'ck/sabotage'
        ? `Saboteur! Discard half your cards: ${owed}.`
        : `Wedding: give ${owed} card${owed > 1 ? 's' : ''} to ${state.players[phase.to]?.name ?? 'the bride'}.`;
  return {
    key,
    title: phase.kind === 'ck/wedding' ? 'Wedding gift' : 'Discard cards',
    modal: true,
    body: [
      h('p', {}, why),
      ...rows,
      h('p', {}, 'Selected: ', sum),
      h('div', { class: 'dialog-actions' }, go),
    ],
  };
}

/** What a prompt asks, in words. */
function promptText(state: GameState): { title: string; text: string } {
  const phase = phaseOf(state);
  const name = (p: PlayerId) => state.players[p]?.name ?? `Player ${p + 1}`;
  switch (phase.kind) {
    case 'ck/pillage':
      return {
        title: 'Barbarians!',
        text: 'The barbarians pillage one of your cities: choose which (click it).',
      };
    case 'ck/defender':
      return {
        title: 'Defenders tied',
        text: 'Draw a progress card from the stack of your choice.',
      };
    case 'ck/progressDiscard':
      return {
        title: 'Too many progress cards',
        text: `You may hold ${PROGRESS_HAND_MAX}: discard one.`,
      };
    case 'ck/aqueduct':
      return { title: 'Aqueduct', text: 'You received nothing this roll: take a resource.' };
    case 'ck/metropolis':
      return {
        title: 'Metropolis',
        text: `Click the city for your ${TRACK_LABEL[phase.track].toLowerCase()} metropolis.`,
      };
    case 'ck/relocate':
      return { title: 'Knight displaced', text: 'Click where your knight retreats to.' };
    case 'ck/card': {
      const card = CARD_NAMES[phase.card];
      switch (phase.card) {
        case 'deserter':
          return phase.victim === null
            ? { title: card, text: 'Choose the opponent who loses a knight.' }
            : phase.removed === null
              ? { title: card, text: 'Click the knight that deserts.' }
              : { title: card, text: 'Click where your new knight stands, or skip.' };
        case 'diplomat':
          return phase.removed === null
            ? { title: card, text: 'Click an open road to remove.' }
            : { title: card, text: 'Click where your road goes, or remove it for good.' };
        case 'spy':
          return phase.victim === null
            ? { title: card, text: 'Whose progress cards do you look at?' }
            : { title: card, text: `Take one of ${name(phase.victim)}'s progress cards.` };
        case 'masterMerchant':
          return phase.victim === null
            ? { title: card, text: 'Take 2 cards from a player with more points.' }
            : { title: card, text: `Take a card from ${name(phase.victim)} (${phase.left} left).` };
        case 'commercialHarbor':
          return phase.offered === null
            ? {
                title: card,
                text: `Offer ${name(phase.queue[0] ?? 0)} a resource (they give a commodity), or stop.`,
              }
            : {
                title: card,
                text: `${name(state.turn.current)} offers you 1 ${phase.offered}: give a commodity.`,
              };
        case 'smith':
          return {
            title: card,
            text: `Click a knight to promote for free (${phase.left} left), or stop.`,
          };
        case 'merchantFleet':
          return { title: card, text: 'Which kind of card do you trade 2:1 this turn?' };
        case 'resourceMonopoly':
          return { title: card, text: 'Name a resource: each opponent gives you 2.' };
        case 'tradeMonopoly':
          return { title: card, text: 'Name a commodity: each opponent gives you 1.' };
        case 'inventor':
          return {
            title: card,
            text:
              phase.first === null
                ? 'Click the first number token.'
                : 'Click the token to swap with.',
          };
        default:
          return { title: card, text: CARD_TEXT[phase.card] };
      }
    }
    default:
      return { title: 'Cities & Knights', text: '' };
  }
}

function choiceButton(state: GameState, c: Choice, onClick: () => void): HTMLElement | null {
  const label: Child[] = (() => {
    switch (c.kind) {
      case 'player': {
        const p = state.players[c.id];
        return [
          h('span', { class: 'ck-pdot', style: playerStyle(p?.color ?? '#888') }),
          p?.name ?? '?',
        ];
      }
      case 'good':
        return [goodFace(c.id, 22), goodLabel(c.id)];
      case 'track':
        return [
          svg(TRACK_SVG[c.id], 18),
          `${TRACK_LABEL[c.id]} (${ckSlice(state).decks[c.id].length})`,
        ];
      case 'card':
        return [progressFace(c.id, 22), CARD_NAMES[c.id]];
      case 'done':
        return ['Done'];
      default:
        return [];
    }
  })();
  if (label.length === 0) return null;
  return h(
    'button',
    {
      class: `btn btn-sm ck-choice${c.kind === 'done' ? ' btn-ghost' : ''}`,
      on: { click: onClick },
    },
    ...label,
  );
}

const pickAction = (player: PlayerId, c: Choice): Action => {
  switch (c.kind) {
    case 'player':
      return act({ type: 'ck/pickPlayer', player, target: c.id });
    case 'good':
      return act({ type: 'ck/pickGood', player, good: c.id });
    case 'track':
      return act({ type: 'ck/pickTrack', player, track: c.id });
    case 'card':
      return act({ type: 'ck/pickCard', player, card: c.id });
    case 'done':
      return act({ type: 'ck/done', player });
    case 'vertex':
      return act({ type: 'ck/pickVertex', player, vertex: c.id });
    case 'edge':
      return act({ type: 'ck/pickEdge', player, edge: c.id });
    case 'hex':
      return act({ type: 'ck/pickHex', player, hex: c.id });
  }
};

function promptDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  const prompt = promptFor(state);
  if (!prompt || prompt.actor !== view.viewer || view.spectator) return null;
  // The choices come from the legal actions (they are the prompt's options): online, the view
  // lacks hidden cards some options depend on (Master Merchant victims hold "no cards" there).
  const options = view.legal.flatMap((a) => {
    const c = a.player === view.viewer ? choiceOf(a as unknown as CkAction) : null;
    return c ? [c] : [];
  });
  const buttons = options.filter(
    (c) => c.kind !== 'vertex' && c.kind !== 'edge' && c.kind !== 'hex',
  );
  const { title, text } = promptText(state);
  const onBoard = buttons.length < options.length;
  if (buttons.length === 0) return null; // board clicks only: the turn pill says what to do
  return {
    key: `ck-prompt-${state.phase.kind}-${JSON.stringify(state.phase)}`,
    title,
    modal: !onBoard,
    body: [
      h('p', {}, text),
      h(
        'div',
        { class: 'ck-choices' },
        ...buttons.map((c) => choiceButton(state, c, () => send(pickAction(view.viewer, c)))),
      ),
    ],
  };
}

/** Sentence-case list: "move, displace or chase". */
const orList = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * What the selected knight (phase ck/knight) can do, for the turn pill (`pill`) and the knight
 * dialog (`text`): both say the same, from the engine's own reason when it cannot act.
 */
export function knightStatus(state: GameState, view: HudView): { pill: string; text: string } {
  const phase = phaseOf(state);
  if (phase.kind !== 'ck/knight') return { pill: '', text: '' };
  const p = view.viewer;
  const v = phase.vertex;
  const tidy = [
    mine(view, 'ck/activateKnight').length > 0 && 'activate',
    mine(view, 'ck/promoteKnight').length > 0 && 'promote',
  ].filter((x): x is string => typeof x === 'string');
  const orTidy = tidy.length > 0 ? `: ${orList(tidy)} it, or close` : ': close';
  if (phase.resume === 'specialBuild') {
    return {
      pill: `Special build${orTidy}`,
      text: 'In the special build phase a knight can only be activated or promoted.',
    };
  }
  const blocker = knightActionBlocker(state, p, v);
  if (blocker === null) {
    const moves = moveTargets(state, p, v).length > 0;
    const displaces = displaceTargets(state, p, v).length > 0;
    const chases = canChase(state, p, v);
    const verbs = [
      moves && 'move',
      displaces && 'displace a weaker knight',
      chases && 'chase the robber',
    ].filter((x): x is string => typeof x === 'string');
    const click = [
      moves && 'click a highlighted spot to move there',
      displaces && 'click a weaker knight to displace it',
    ].filter((x): x is string => typeof x === 'string');
    return {
      pill: `Knight: ${orList(verbs)}`,
      text:
        click.length > 0
          ? `${capital(orList(click))}${chases ? ', or chase the robber' : ''}.`
          : 'This knight can chase the robber away.',
    };
  }
  if (phase.resume === 'preRoll') {
    return {
      pill: 'Before the roll a knight can only chase the robber',
      text: `Before the roll a knight can only chase the robber, and ${blocker}.`,
    };
  }
  if (blocker === 'only an active knight can act') {
    return {
      pill: `Inactive knight${orTidy}`,
      text: 'An inactive knight cannot move, displace or chase. Once activated it can act from your next turn.',
    };
  }
  if (blocker === 'a knight activated this turn cannot act yet') {
    return {
      pill: `Knight activated this turn${orTidy}`,
      text: 'This knight was activated this turn: it can act from your next turn.',
    };
  }
  if (blocker === 'that knight has nowhere to go') {
    return {
      pill: `Knight has nowhere to go${orTidy}`,
      text: 'This active knight has nowhere to go: no free spot along your roads, no weaker knight in reach, and the robber is not on a hex next to it.',
    };
  }
  return { pill: `Your knight cannot act${orTidy}`, text: `This knight cannot act: ${blocker}.` };
}

function knightDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  const phase = phaseOf(state);
  if (phase.kind !== 'ck/knight' || state.turn.current !== view.viewer) return null;
  const chase = mine(view, 'ck/chaseRobber')[0];
  const cancel = mine(view, 'ck/cancel')[0];
  const activate = mine(view, 'ck/activateKnight')[0];
  const promote = mine(view, 'ck/promoteKnight')[0];
  const k = ckSlice(state).knights[phase.vertex];
  const costFaces = (item: string) =>
    RESOURCES.flatMap((r) =>
      Array.from({ length: costOf(state, item)?.[r] ?? 0 }, () => resCardFace(r, 14)),
    );
  const button = (a: Action | undefined, label: string, item?: string, primary = false) =>
    a &&
    h(
      'button',
      { class: `btn ${primary ? 'btn-primary' : ''} ck-choice`, on: { click: () => send(a) } },
      label,
      ...(item ? costFaces(item) : []),
    );
  return {
    key: `ck-knight-${phase.vertex}`,
    title: k ? `${KNIGHT_TITLE[k.level]} knight (${k.active ? 'active' : 'inactive'})` : 'Knight',
    modal: false,
    body: [
      h('p', {}, knightStatus(state, view).text),
      h(
        'div',
        { class: 'ck-choices' },
        button(chase, 'Chase the robber', undefined, true),
        button(activate, 'Activate', ACTIVATE_ITEM),
        button(promote, 'Promote', PROMOTE_ITEM),
        button(cancel, 'Done'),
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// The extension
// ---------------------------------------------------------------------------

export const ckHud: HudExtension = {
  id: CK,

  panel(state, view, send) {
    // Barbarian Attack + C&K has no barbarian ship (its barbarians land on the coast).
    const body = h(
      'div',
      { class: 'ck-panel' },
      ...(shipSails(state) ? [barbarianTrack(state)] : []),
    );
    if (!view.spectator && state.players[view.viewer]) {
      body.append(trackRows(state, view, send));
      const extra = [
        alchemistForm(view, send),
        progressList(state, view, send),
        bankForm(state, view, send),
        offerForm(state, view, send),
      ].filter((x): x is HTMLElement => x !== null);
      if (extra.length > 0) body.append(h('div', { class: 'ck-actions' }, ...extra));
    }
    const bank = ckSlice(state).bank;
    body.append(
      playerRows(state),
      h(
        'p',
        { class: 'muted ck-facts' },
        'Commodity bank: ',
        ...COMMODITIES.flatMap((c) => [commodityFace(c, 12), ` ${bank[c]} `]),
      ),
    );
    return { title: 'Cities & Knights', body };
  },

  buildCards: [
    {
      mode: 'ck/knight',
      label: 'Knight',
      actionType: 'ck/buildKnight',
      glyph: 'knight',
      costItem: KNIGHT_ITEM,
      // Barbarian Attack + C&K: knights stand on paths (that module's own cards).
      available: shipSails,
      left: (state, p) => knightsInSupply(state, p, 1),
      total: () => KNIGHTS_PER_LEVEL,
    },
    {
      // Select a knight: activate, promote, move, displace or chase the robber (dialog).
      mode: 'ck/command',
      label: 'Command',
      actionType: 'ck/selectKnight',
      glyph: 'knight',
      costItem: 'ck/none',
      available: shipSails,
    },
    {
      mode: 'ck/wall',
      label: 'City wall',
      actionType: 'ck/buildWall',
      glyph: 'city',
      costItem: WALL_ITEM,
      left: (state, p) => WALLS_PER_PLAYER - wallsOf(state, p),
      total: () => WALLS_PER_PLAYER,
    },
  ],

  impliedActions: ['ck/pickVertex', 'ck/pickEdge', 'ck/pickHex'],

  dialog(state, view, _legal, send) {
    return (
      discardDialog(state, view, send) ??
      knightDialog(state, view, send) ??
      promptDialog(state, view, send)
    );
  },

  hint(state, view) {
    const phase = phaseOf(state);
    const prompt = promptFor(state);
    // (The knight phase is a prompt too, with no prompt text: the dialog says the same.)
    if (phase.kind === 'ck/knight' && state.turn.current === view.viewer)
      return knightStatus(state, view).pill;
    if (prompt && prompt.actor === view.viewer) return promptText(state).text;
    if (
      (phase.kind === 'ck/sabotage' || phase.kind === 'ck/wedding') &&
      (phase.pending[view.viewer] ?? 0) > 0
    ) {
      return phase.kind === 'ck/sabotage'
        ? 'Saboteur: discard half your cards'
        : 'Wedding: give 2 cards';
    }
    if (prompt) {
      const who = state.players[prompt.actor]?.name ?? 'Someone';
      return `${who} is choosing (${promptText(state).title})`;
    }
    return null;
  },

  handCards(state, view, send) {
    const cp = ckSlice(state).players[view.viewer];
    if (!cp || view.spectator) return [];
    const plays = mine(view, 'ck/play');
    const commodityCards = COMMODITIES.map((c) => {
      const n = cp.commodities[c];
      return h(
        'div',
        {
          class: `hcard rcard ck-hc${n === 0 ? ' is-zero' : n >= 3 ? ' stack-3' : n === 2 ? ' stack-2' : ''}`,
          title: `${COMMODITY_LABEL[c]}: ${n}`,
        },
        commodityFace(c, 46),
        h('span', { class: 'count-badge' }, String(n)),
      );
    });
    // Progress cards: one stack (the panel lists them with Play buttons); a click plays the
    // first playable one when only one kind is playable.
    const n = cp.progress.length;
    const playable = [...new Set(plays.map((a) => field(a, 'card') as ProgressCard))];
    const only = playable.length === 1 ? plays[0] : undefined;
    const top = cp.progress[n - 1];
    const stack =
      top === undefined
        ? null
        : h(
            'button',
            {
              class: `hcard dcard ck-hp${n >= 3 ? ' stack-3' : n === 2 ? ' stack-2' : ''}${playable.length > 0 ? ' can-play' : ''}`,
              disabled: !only,
              title: `Progress cards: ${cp.progress.map((c) => CARD_NAMES[c]).join(', ')}${n > PROGRESS_HAND_MAX ? ` (keep ${PROGRESS_HAND_MAX})` : ''}`,
              attrs: { 'aria-label': `${n} progress cards` },
              on: { click: () => only && send(only) },
            },
            progressFace(top, 46),
            h('span', { class: 'count-badge' }, String(n)),
          );
    return [h('span', { class: 'hand-sep' }), ...commodityCards, stack];
  },

  offerExtras(state, side) {
    const t = ckSlice(state).trade;
    if (!t) return [];
    const part = side === 'give' ? t.give : t.want;
    return COMMODITIES.filter((c) => part[c] > 0).map((c) =>
      h('span', { class: 'bundle-item' }, commodityFace(c, 24), `×${part[c]}`),
    );
  },
};

export { TRACK_SVG };
