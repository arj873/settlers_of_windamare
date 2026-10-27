/**
 * Traders & Barbarians HUD: a sidebar panel per scenario (gold with Wealthiest / Poor Settler,
 * Harbormaster, fish and the old boot, bridges, camels, barbarians / prisoners / knights, the
 * baggage train, commodities and deliveries, Catan for Two's trade tokens) with the buttons of the
 * module's non-board actions, build cards (bridge, wagon, knights), dialogs for the caravan vote
 * and the forced trade's give-back, and turn-pill hints for every T&B phase. Board picks (wagon
 * steps, knights, barbarians, camels, neutral pieces) are implied clicks.
 */
import {
  costOf,
  type Action,
  type ExpansionAction,
  type GameState,
  type PlayerId,
  type Resource,
  type ResourceBundle,
  resourceWord,
} from '../../engine';
import { RESOURCES } from '../../engine/constants';
import { h, type Child } from '../../ui/dom';
import type { HudDialog, HudExtension } from '../../ui/expansions';
import { RESOURCE_LABEL, glyph } from '../../ui/icons';
import type { HudView } from '../../ui/types';
import { playerStyle, resCardFace } from '../../ui/widgets';
import {
  BAGGAGE,
  BA_CARD_ITEM,
  BRIDGES_PER_PLAYER,
  BRIDGE_ITEM,
  FISH_USES,
  GOLD_PER_RESOURCE,
  HARBORMASTER_MIN,
  KNIGHTS_PER_PLAYER,
  MAX_LEVEL,
  NEUTRAL_NAMES,
  SC_BA,
  SC_BASE,
  SC_CARAVANS,
  SC_FISH,
  SC_RIVERS,
  SC_TRADERS,
  TB,
  bridgesBuilt,
  caravanVictoryPoints,
  featuresOf,
  fishCost,
  fishTotal,
  goldOf,
  goldSaleRatio,
  harbormasterOn,
  harbourPoints,
  has,
  baCardsInPlay,
  prisonersPerVp,
  isTwo,
  knightsLeft,
  tbSlice,
  tokenPrice,
  upgradeCost,
  usesGold,
  type Commodity,
  type FishUse,
  type TbPhase,
  sheetRules,
} from './engine';
import { tbSounds } from './sounds';
import './tb.css';

type Send = (a: Action) => void;

const act = (a: Record<string, unknown>): Action => a as unknown as ExpansionAction;
const mine = (view: HudView, type: string): Action[] =>
  view.spectator ? [] : view.legal.filter((a) => a.player === view.viewer && a.type === type);
const field = (a: Action, k: string): unknown => (a as Record<string, unknown>)[k];
const tbPhase = (s: GameState) => s.phase as unknown as TbPhase | { kind: string };
const nameOf = (s: GameState, p: PlayerId) => s.players[p]?.name ?? `Player ${p + 1}`;

const SCENARIO_NAME: Readonly<Record<string, string>> = {
  [SC_BASE]: 'T&B variants',
  [SC_FISH]: 'Fishermen of Catan',
  [SC_RIVERS]: 'Rivers of Catan',
  [SC_CARAVANS]: 'The Caravans',
  [SC_BA]: 'Barbarian Attack',
  [SC_TRADERS]: 'Traders & Barbarians',
};

// ---------------------------------------------------------------------------
// Icons (fixed art colours, like the resource faces)
// ---------------------------------------------------------------------------

export type TbIcon =
  | 'gold'
  | 'fish'
  | 'boot'
  | 'bridge'
  | 'camel'
  | 'barbarian'
  | 'prisoner'
  | 'wagon'
  | 'token'
  | 'harbor'
  | 'mp'
  | Commodity;

const ART: Readonly<Record<TbIcon, string>> = {
  gold:
    '<circle cx="16" cy="16" r="12" fill="#f2c35a" stroke="#7a5512" stroke-width="2"/>' +
    '<circle cx="16" cy="16" r="7.5" fill="none" stroke="#b9861e" stroke-width="1.6"/>' +
    '<path d="M13 12.5h6M13 19.5h6M16 10v12" stroke="#7a5512" stroke-width="1.8" stroke-linecap="round"/>',
  fish:
    '<path d="M4 16c4-6 12-8 18-3l5-4v14l-5-4c-6 5-14 3-18-3z" fill="#5b9fd0" stroke="#1e4766" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<circle cx="10" cy="15" r="1.6" fill="#1e4766"/>',
  boot:
    '<path d="M9 4h8v12c4 0 9 2 10 7v3H6V18z" fill="#7a5a3a" stroke="#2a1708" stroke-width="1.7" stroke-linejoin="round"/>' +
    '<path d="M9 9h8M6 23h21" stroke="#2a1708" stroke-width="1.4"/>',
  bridge:
    '<path d="M3 20c4-8 22-8 26 0" fill="none" stroke="#8a5a2b" stroke-width="3"/>' +
    '<path d="M3 20h26M8 15v5M16 13v7M24 15v5" stroke="#5b3a1a" stroke-width="2" stroke-linecap="round"/>' +
    '<path d="M3 25c3-2 5 2 8 0s5 2 8 0 5 2 8 0" fill="none" stroke="#3f7fb5" stroke-width="1.6"/>',
  camel:
    '<path d="M4 22c0-4 2-6 5-6 1-4 3-6 5-6s3 3 4 5c1-3 3-4 5-3 2 1 2 4 2 6h3l-1-5 2-1 1 7c0 2-2 3-4 3v4h-2v-4H11v4H9v-4c-3 0-5-1-5-0z" fill="#c8964f" stroke="#5b3a1a" stroke-width="1.4" stroke-linejoin="round"/>',
  barbarian:
    '<circle cx="16" cy="10" r="5.5" fill="#b07c4e" stroke="#2a1708" stroke-width="1.6"/>' +
    '<path d="M10.5 9l-3-4M21.5 9l3-4" stroke="#e6dccb" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path d="M7 28c0-7 4-11 9-11s9 4 9 11z" fill="#7a3b26" stroke="#2a1708" stroke-width="1.6"/>',
  prisoner:
    '<circle cx="16" cy="11" r="5" fill="#b07c4e" stroke="#2a1708" stroke-width="1.5"/>' +
    '<path d="M8 28c0-6 4-10 8-10s8 4 8 10z" fill="#7a3b26" stroke="#2a1708" stroke-width="1.5"/>' +
    '<path d="M6 4v24M12 4v24M20 4v24M26 4v24" stroke="#4a4a52" stroke-width="2"/>',
  wagon:
    '<path d="M4 9h20v10H4z" fill="#a8743f" stroke="#2a1708" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M24 13h3l1 6h-4" fill="#a8743f" stroke="#2a1708" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<circle cx="9" cy="22" r="3.5" fill="#3a2a1a" stroke="#e8d3a8" stroke-width="1.4"/>' +
    '<circle cx="20" cy="22" r="3.5" fill="#3a2a1a" stroke="#e8d3a8" stroke-width="1.4"/>',
  token:
    '<circle cx="16" cy="16" r="12" fill="#e9dcc0" stroke="#2a1708" stroke-width="2"/>' +
    '<path d="M9 13h12l-3-3M23 19H11l3 3" fill="none" stroke="#7a3b26" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  harbor:
    '<circle cx="16" cy="7" r="3" fill="none" stroke="#2f5f86" stroke-width="2.2"/>' +
    '<path d="M16 10v17M9 14h14M6 20c1 5 5 7 10 7s9-2 10-7" fill="none" stroke="#2f5f86" stroke-width="2.4" stroke-linecap="round"/>',
  mp:
    '<path d="M7 26l5-20h8l5 20" fill="none" stroke="#7a5a3a" stroke-width="2.4" stroke-linejoin="round"/>' +
    '<path d="M16 9v3M16 15v3M16 21v3" stroke="#f2c35a" stroke-width="2.4" stroke-linecap="round"/>',
  glass:
    '<path d="M10 4h12l-2 22h-8z" fill="#9fd8e4" stroke="#1f5f6c" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M13 8l-1 12" stroke="#fff" stroke-opacity=".7" stroke-width="1.6" stroke-linecap="round"/>',
  marble:
    '<path d="M5 22l5-12h14l3 12z" fill="#ece7df" stroke="#5c5650" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M11 14c3 2 5-1 8 2M9 19c4-1 7 2 12 0" fill="none" stroke="#a49c92" stroke-width="1.2"/>',
  tools:
    '<path d="M8 25l10-10" stroke="#7a5a3a" stroke-width="3.2" stroke-linecap="round"/>' +
    '<path d="M15 7a6 6 0 0 0 8 8l3 3-2 2-3-3a6 6 0 0 1-8-8l3 3 2-2z" fill="#9aa3ad" stroke="#2f3842" stroke-width="1.4" stroke-linejoin="round"/>',
  sand:
    '<path d="M4 24c3-8 8-12 12-12s9 4 12 12z" fill="#e3c57f" stroke="#8a6a2a" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M11 21h2M17 19h2M20 22h2" stroke="#8a6a2a" stroke-width="1.6" stroke-linecap="round"/>',
};

const ICON_LABEL: Readonly<Record<TbIcon, string>> = {
  gold: 'gold',
  fish: 'fish',
  boot: 'old boot',
  bridge: 'bridge',
  camel: 'camel',
  barbarian: 'barbarian',
  prisoner: 'prisoners',
  wagon: 'wagon',
  token: 'trade token',
  harbor: 'harbour points',
  mp: 'movement points',
  glass: 'glass',
  marble: 'marble',
  tools: 'tools',
  sand: 'sand',
};

/** A static SVG icon of a T&B component. */
export function tbIcon(name: TbIcon, size = 16): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `tb-ico tb-ico-${name}`;
  span.style.width = span.style.height = `${size}px`;
  span.setAttribute('role', 'img');
  span.setAttribute('aria-label', ICON_LABEL[name]);
  span.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}">${ART[name]}</svg>`;
  return span;
}

/** An icon with a number: "🪙 3". */
const stat = (icon: TbIcon, value: Child, title: string, extra = ''): HTMLElement =>
  h('span', { class: `tb-stat ${extra}`.trim(), title }, tbIcon(icon, 15), h('b', {}, value));

// ---------------------------------------------------------------------------
// The players table
// ---------------------------------------------------------------------------

/** Wealthiest Settler (unique most gold) and Poor Settler (tied for the least), Rivers only. */
function wealthMarks(state: GameState, p: PlayerId): Child[] {
  if (!has(state, 'rivers')) return [];
  const gold = state.players.map((x) => goldOf(state, x.id));
  const max = Math.max(...gold);
  const min = Math.min(...gold);
  const mine = gold[p] ?? 0;
  const out: Child[] = [];
  if (mine === max && gold.filter((g) => g === max).length === 1) {
    out.push(h('span', { class: 'tb-tag is-good', title: 'Wealthiest Settler: +1 VP' }, '+1'));
  }
  // No penalty on the Rivers + BA and Rivers + T&B sheets.
  if (mine === min && !sheetRules(state).noPoorVp)
    out.push(h('span', { class: 'tb-tag is-bad', title: 'Poor Settler: −2 VP' }, '−2'));
  return out;
}

function playerCells(state: GameState, view: HudView, p: PlayerId): Child[] {
  const s = tbSlice(state);
  const cells: Child[] = [];
  if (usesGold(state)) {
    cells.push(
      h(
        'span',
        { class: 'tb-cell' },
        stat('gold', String(goldOf(state, p)), 'Gold coins'),
        ...wealthMarks(state, p),
      ),
    );
  }
  if (harbormasterOn(state)) {
    const holder = s.harbormaster === p;
    cells.push(
      stat(
        'harbor',
        String(harbourPoints(state, p)),
        holder
          ? 'Harbormaster (2 VP)'
          : `Harbour points (${HARBORMASTER_MIN}+ and the most: Harbormaster)`,
        holder ? 'is-holder' : '',
      ),
    );
  }
  if (s.fish) {
    const hand = s.fish.hands[p] ?? [];
    const own = !view.spectator && p === view.viewer;
    cells.push(
      stat(
        'fish',
        own ? String(fishTotal(hand)) : `${hand.length}×`,
        own ? `${hand.length} fish tokens worth ${fishTotal(hand)}` : `${hand.length} fish tokens`,
      ),
    );
    if (s.fish.boot === p)
      cells.push(h('span', { title: 'Old boot: needs 1 more VP' }, tbIcon('boot', 16)));
  }
  if (s.rivers) {
    cells.push(stat('bridge', String(BRIDGES_PER_PLAYER - bridgesBuilt(state, p)), 'Bridges left'));
  }
  if (s.caravans) {
    cells.push(
      stat(
        'camel',
        `+${caravanVictoryPoints(state, p)}`,
        'Buildings between two camels (+1 VP each)',
      ),
    );
  }
  if (s.ba) {
    const per = prisonersPerVp(state);
    cells.push(stat('prisoner', String(s.ba.prisoners[p] ?? 0), `Prisoners (${per} = 1 VP)`));
    // BA + C&K uses C&K's knights (its own panel) instead of BA's knights and cards.
    if (baCardsInPlay(state))
      cells.push(
        h(
          'span',
          { class: 'tb-stat', title: 'Knights in the supply' },
          glyph('knight', 15),
          h('b', {}, `${knightsLeft(state, p)}/${KNIGHTS_PER_PLAYER}`),
        ),
      );
  }
  if (s.traders) {
    const level = s.traders.level[p] ?? 1;
    const held = s.traders.commodity[p] ?? null;
    cells.push(stat('wagon', String(level), `Baggage train card ${level}`));
    cells.push(
      h(
        'span',
        { class: 'tb-stat', title: held ? `Carrying ${held}` : 'Carrying nothing' },
        held ? tbIcon(held, 15) : h('span', { class: 'muted' }, '—'),
      ),
    );
    cells.push(
      h(
        'span',
        { class: 'tb-stat', title: 'Commodities delivered (1 VP each)' },
        glyph('victoryPoint', 14),
        h('b', {}, String(s.traders.delivered[p] ?? 0)),
      ),
    );
  }
  if (s.two && p < 2 && !has(state, 'fish')) {
    cells.push(stat('token', String(s.two.tokens[p] ?? 0), 'Trade tokens'));
  }
  return cells;
}

function playerRows(state: GameState, view: HudView): HTMLElement {
  return h(
    'ul',
    { class: 'tb-list' },
    ...state.players.map((p) =>
      h(
        'li',
        {
          class: `tb-row${p.id === state.turn.current ? ' is-current' : ''}`,
          style: playerStyle(p.color),
        },
        h('span', { class: 'tb-name' }, p.name),
        h('span', { class: 'tb-cells' }, ...playerCells(state, view, p.id)),
      ),
    ),
  );
}

/** Shared facts: supplies, the barbarians, the current wagon move. */
function facts(state: GameState): HTMLElement | null {
  const s = tbSlice(state);
  const parts: Child[] = [];
  if (s.fish) parts.push(stat('fish', String(s.fish.pool.length), 'Fish tokens in the pool'));
  if (s.caravans) parts.push(stat('camel', String(s.caravans.left), 'Camels left'));
  if (s.ba) parts.push(stat('barbarian', String(s.ba.supply), 'Barbarians still to land'));
  if (s.traders) {
    const m = s.traders.move;
    if (m.steps > 0 || state.phase.kind === 'tb/wagon') {
      parts.push(stat('mp', String(m.mp), 'Movement points left in this move'));
    }
  }
  if (s.two && !has(state, 'fish'))
    parts.push(stat('token', String(s.two.supply), 'Trade tokens in the supply'));
  if (harbormasterOn(state)) {
    const holder = s.harbormaster;
    parts.push(
      h(
        'span',
        { class: 'tb-fact' },
        'Harbormaster: ',
        h('b', {}, holder === null ? 'nobody' : nameOf(state, holder)),
      ),
    );
  }
  return parts.length > 0 ? h('div', { class: 'tb-facts' }, ...parts) : null;
}

/** The viewer's own details: fish token values, baggage card, Swift Journey cards. */
function ownDetails(state: GameState, view: HudView): HTMLElement | null {
  if (view.spectator) return null;
  const me = view.viewer;
  const s = tbSlice(state);
  const rows: Child[] = [];
  if (s.fish) {
    const hand = [...(s.fish.hands[me] ?? [])].sort((a, b) => a - b);
    rows.push(
      h(
        'div',
        { class: 'tb-own' },
        h('span', { class: 'tb-label' }, 'Your fish'),
        hand.length === 0
          ? h('span', { class: 'muted' }, 'none')
          : h(
              'span',
              { class: 'tb-chips' },
              ...hand.map((t) => h('span', { class: 'tb-chip tb-chip-fish' }, String(t))),
            ),
      ),
    );
  }
  if (s.traders) {
    const level = s.traders.level[me] ?? 1;
    const card = BAGGAGE[level - 1];
    if (card) {
      rows.push(
        h(
          'div',
          { class: 'tb-own tb-baggage' },
          h('span', { class: 'tb-label' }, `Baggage train ${level}/${MAX_LEVEL}`),
          stat('mp', String(card.mp), 'Movement points per move'),
          stat('gold', `+${card.gold}`, 'Gold per delivery'),
          h(
            'span',
            { class: 'tb-fact', title: 'Drive a barbarian off with this die roll or higher' },
            card.driveOff === null ? 'no drive-off' : `drive off ${card.driveOff}+`,
          ),
        ),
      );
    }
    const swift = (s.traders.swift.held[me] ?? 0) + (s.traders.swift.fresh[me] ?? 0);
    if (swift > 0) {
      rows.push(
        h('div', { class: 'tb-own' }, h('span', { class: 'tb-label' }, `Swift Journey ×${swift}`)),
      );
    }
  }
  if (s.two && me < 2 && !has(state, 'fish')) {
    rows.push(
      h(
        'div',
        { class: 'tb-own' },
        h('span', { class: 'tb-label' }, 'Token action price'),
        stat(
          'token',
          String(tokenPrice(state, me)),
          'Trade tokens per action (1 while you are not ahead)',
        ),
      ),
    );
  }
  return rows.length > 0 ? h('div', { class: 'tb-owns' }, ...rows) : null;
}

// ---------------------------------------------------------------------------
// Action buttons (enabled from the viewer's legal actions only)
// ---------------------------------------------------------------------------

function button(
  label: Child[],
  title: string,
  a: Action,
  send: Send,
  cls = 'btn btn-sm',
): HTMLElement {
  return h('button', { class: cls, title, on: { click: () => send(a) } }, ...label);
}

/** Resource-card buttons; `name` says what each does ("Buy 1 Ore for 2 gold"), so a buy and a
 * sell button of one resource never share a name. */
function resourceButtons(
  options: Action[],
  send: Send,
  name: (label: string) => string,
): HTMLElement {
  return h(
    'span',
    { class: 'tb-res' },
    ...options.map((a) => {
      const r = field(a, 'resource') as Resource;
      const what = name(RESOURCE_LABEL[r]);
      return h(
        'button',
        {
          class: 'tb-resbtn',
          title: what,
          attrs: { 'aria-label': what },
          on: { click: () => send(a) },
        },
        resCardFace(r, 24),
      );
    }),
  );
}

const costFaces = (cost: Partial<Record<Resource, number>> | undefined): Child[] =>
  RESOURCES.flatMap((r) => Array.from({ length: cost?.[r] ?? 0 }, () => resCardFace(r, 14)));

const row = (...kids: Child[]): HTMLElement => h('div', { class: 'tb-act' }, ...kids);
const label = (...kids: Child[]): HTMLElement => h('span', { class: 'tb-label' }, ...kids);

const FISH_LABEL: Readonly<Record<FishUse, string>> = {
  robber: 'Chase the robber off',
  steal: 'Steal from',
  resource: 'Take a card:',
  road: 'Free road',
  devCard: 'Development card',
};

function fishActions(state: GameState, view: HudView, send: Send): Child[] {
  const out: Child[] = [];
  const me = view.viewer;
  const fish = mine(view, 'tb/fish');
  for (const use of FISH_USES) {
    const list = fish.filter((a) => field(a, 'use') === use);
    if (list.length === 0) continue;
    const cost = label(tbIcon('fish', 14), `${fishCost(state, me, use)}: ${FISH_LABEL[use]}`);
    if (use === 'resource') {
      const n = fishCost(state, me, use);
      out.push(
        row(
          cost,
          resourceButtons(list, send, (r) => `Take 1 ${resourceWord(r)} for ${n} fish`),
        ),
      );
    } else if (use === 'steal') {
      out.push(
        row(
          cost,
          ...list.map((a) => {
            const v = field(a, 'victim') as PlayerId;
            return button(
              [nameOf(state, v)],
              `Steal a random card from ${nameOf(state, v)}`,
              a,
              send,
            );
          }),
        ),
      );
    } else {
      out.push(
        row(
          button(
            [tbIcon('fish', 14), ` ${fishCost(state, me, use)} · ${FISH_LABEL[use]}`],
            FISH_LABEL[use],
            list[0] as Action,
            send,
          ),
        ),
      );
    }
  }
  const boot = mine(view, 'tb/giveBoot');
  if (boot.length > 0) {
    out.push(
      row(
        label(tbIcon('boot', 14), ' Give the boot to'),
        ...boot.map((a) => {
          const to = field(a, 'to') as PlayerId;
          return button([nameOf(state, to)], `Give the old boot to ${nameOf(state, to)}`, a, send);
        }),
      ),
    );
  }
  return out;
}

function goldActions(state: GameState, view: HudView, send: Send): Child[] {
  const out: Child[] = [];
  const buy = mine(view, 'tb/buyResource');
  if (buy.length > 0)
    out.push(
      row(
        label(tbIcon('gold', 14), ` ${GOLD_PER_RESOURCE} gold → 1`),
        resourceButtons(buy, send, (r) => `Buy 1 ${resourceWord(r)} for ${GOLD_PER_RESOURCE} gold`),
      ),
    );
  const sell = mine(view, 'tb/sellForGold');
  if (sell.length > 0) {
    const n = goldSaleRatio(state, view.viewer);
    out.push(
      row(
        label(`${n} of a kind → 1 `, tbIcon('gold', 14)),
        resourceButtons(sell, send, (r) => `Sell ${n} ${resourceWord(r)} for 1 gold`),
      ),
    );
  }
  return out;
}

function baActions(state: GameState, view: HudView, send: Send): Child[] {
  const buy = mine(view, 'tb/buyCard')[0];
  if (!buy) return [];
  return [
    row(
      button(
        [
          glyph('devCards', 16),
          ' Buy a development card ',
          ...costFaces(costOf(state, BA_CARD_ITEM)),
        ],
        'Barbarian Attack cards are resolved at once: Knighthood, Swift Knight, Treason, Intrigue',
        buy,
        send,
      ),
    ),
  ];
}

function tradersActions(state: GameState, view: HudView, send: Send): Child[] {
  const out: Child[] = [];
  const me = view.viewer;
  const s = tbSlice(state).traders;
  const up = mine(view, 'tb/upgradeWagon')[0];
  if (up && s) {
    const next = (s.level[me] ?? 1) + 1;
    out.push(
      row(
        button(
          [tbIcon('wagon', 16), ` Baggage train ${next} `, ...costFaces(upgradeCost(next))],
          next === MAX_LEVEL
            ? 'Upgrade the baggage train (+1 VP at card 5)'
            : 'Upgrade the baggage train',
          up,
          send,
        ),
      ),
    );
  }
  const grain = mine(view, 'tb/wagonGrain')[0];
  if (grain)
    out.push(
      row(button([resCardFace('grain', 14), ' Pay 1 grain: +2 MP'], 'Once per move', grain, send)),
    );
  const drives = mine(view, 'tb/driveOff');
  if (drives.length > 0 && s) {
    const need = BAGGAGE[(s.level[me] ?? 1) - 1]?.driveOff ?? 6;
    out.push(
      row(
        label(tbIcon('barbarian', 14), ` Drive off (${need}+)`),
        ...drives.map((a, i) =>
          button(
            [drives.length > 1 ? `#${i + 1}` : 'Roll'],
            `Roll a die: ${need} or higher moves the barbarian`,
            a,
            send,
          ),
        ),
      ),
    );
  }
  const swift = mine(view, 'tb/swiftJourney')[0];
  if (swift)
    out.push(
      row(button([glyph('devCards', 16), ' Swift Journey'], 'Move the wagon again', swift, send)),
    );
  return out;
}

function twoActions(state: GameState, view: HudView, send: Send): Child[] {
  const out: Child[] = [];
  const price = view.viewer < 2 ? tokenPrice(state, view.viewer) : 0;
  const forced = mine(view, 'tb/forcedTrade')[0];
  if (forced) {
    out.push(
      row(
        button(
          [tbIcon('token', 14), ` ${price} · Forced trade`],
          'Take 2 random cards, give 2 of your choice',
          forced,
          send,
        ),
      ),
    );
  }
  const robber = mine(view, 'tb/tokenRobber')[0];
  if (robber) {
    const what = has(state, 'traders') ? 'Move a barbarian' : 'Robber to the desert';
    out.push(
      row(button([tbIcon('token', 14), ` ${price} · ${what}`], `${what} (no theft)`, robber, send)),
    );
  }
  const knight = mine(view, 'tb/knightForTokens')[0];
  if (knight) {
    out.push(
      row(
        button(
          [glyph('knight', 14), ' Turn in a Knight: 2 ', tbIcon('token', 14)],
          'Once per turn',
          knight,
          send,
        ),
      ),
    );
  }
  return out;
}

function actionsFor(state: GameState, view: HudView, send: Send): HTMLElement | null {
  const rows: Child[] = [
    ...goldActions(state, view, send),
    ...(has(state, 'fish') ? fishActions(state, view, send) : []),
    ...(has(state, 'ba') ? baActions(state, view, send) : []),
    ...(has(state, 'traders') ? tradersActions(state, view, send) : []),
    ...(isTwo(state) ? twoActions(state, view, send) : []),
  ];
  return rows.length > 0 ? h('div', { class: 'tb-actions' }, ...rows) : null;
}

// ---------------------------------------------------------------------------
// Dialogs: the caravan vote, the forced trade's give-back
// ---------------------------------------------------------------------------

interface CountDraft {
  key: string;
  n: ResourceBundle;
}
let draft: CountDraft = { key: '', n: {} };

function stepper(r: Resource, max: number, onChange: () => void): HTMLElement {
  const val = h('b', { class: 'tb-count' }, String(draft.n[r] ?? 0));
  const bump = (d: number) => () => {
    draft.n[r] = Math.max(0, Math.min(max, (draft.n[r] ?? 0) + d));
    val.textContent = String(draft.n[r] ?? 0);
    onChange();
  };
  return h(
    'div',
    { class: 'tb-step' },
    resCardFace(r, 22),
    h(
      'button',
      {
        class: 'btn btn-sm btn-ghost',
        attrs: { 'aria-label': `less ${resourceWord(r)}` },
        on: { click: bump(-1) },
      },
      '−',
    ),
    val,
    h(
      'button',
      {
        class: 'btn btn-sm btn-ghost',
        attrs: { 'aria-label': `more ${resourceWord(r)}` },
        on: { click: bump(1) },
      },
      '+',
    ),
    h('span', { class: 'muted' }, `of ${max}`),
  );
}

const picked = (rs: readonly Resource[]) => rs.reduce((n, r) => n + (draft.n[r] ?? 0), 0);

function voteDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  const phase = tbPhase(state);
  if (phase.kind !== 'tb/vote' || mine(view, 'tb/bid').length === 0) return null;
  const vote = phase as Extract<TbPhase, { kind: 'tb/vote' }>;
  const me = view.viewer;
  const hand = state.players[me]?.resources;
  if (!hand) return null;
  const key = `tb-vote-${state.turn.number}-${vote.ender}-${me}`;
  if (draft.key !== key) draft = { key, n: {} };
  const rs: Resource[] = ['wool', 'grain'];
  const total = h('b', {}, String(picked(rs)));
  const go = h('button', { class: 'btn btn-primary' }, 'Vote');
  const sync = () => {
    total.textContent = String(picked(rs));
    go.textContent = picked(rs) === 0 ? 'Pass' : 'Vote';
  };
  go.addEventListener('click', () =>
    send(act({ type: 'tb/bid', player: me, wool: draft.n.wool ?? 0, grain: draft.n.grain ?? 0 })),
  );
  const bids = vote.bids.map((b, p) => ({ b, p })).filter(({ p }) => !vote.order.includes(p));
  sync();
  return {
    key,
    title: 'Camel vote',
    modal: true,
    body: [
      h(
        'p',
        {},
        vote.ender === me
          ? 'You built this turn: a camel joins a caravan. Bid sheep and wheat (1 vote each, paid to the bank). The most votes decides where it goes; a tie leaves it to you.'
          : `${nameOf(state, vote.ender)} built this turn: a camel joins a caravan. Bid sheep and wheat (1 vote each, paid to the bank). The most votes decides where it goes; a tie leaves it to ${nameOf(state, vote.ender)}.`,
      ),
      bids.length > 0 &&
        h(
          'p',
          { class: 'muted' },
          'Bids so far: ',
          bids.map(({ b, p }) => `${nameOf(state, p)} ${b}`).join(', '),
        ),
      ...rs.map((r) => stepper(r, hand[r], sync)),
      h('p', {}, 'Your votes: ', total),
      h('div', { class: 'dialog-actions' }, go),
    ],
  };
}

function forcedGiveDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  const phase = tbPhase(state);
  if (phase.kind !== 'tb/forcedGive' || mine(view, 'tb/forcedGive').length === 0) return null;
  const count = (phase as Extract<TbPhase, { kind: 'tb/forcedGive' }>).count;
  const me = view.viewer;
  const hand = state.players[me]?.resources;
  if (!hand) return null;
  const key = `tb-give-${state.turn.number}-${state.log.length}`;
  if (draft.key !== key) draft = { key, n: {} };
  const total = h('b', {}, `0 / ${count}`);
  const go = h('button', { class: 'btn btn-primary' }, 'Give');
  const sync = () => {
    total.textContent = `${picked(RESOURCES)} / ${count}`;
    (go as HTMLButtonElement).disabled = picked(RESOURCES) !== count;
  };
  go.addEventListener('click', () => {
    const resources: ResourceBundle = {};
    for (const r of RESOURCES) if ((draft.n[r] ?? 0) > 0) resources[r] = draft.n[r];
    send(act({ type: 'tb/forcedGive', player: me, resources }));
  });
  const rows = RESOURCES.filter((r) => hand[r] > 0).map((r) => stepper(r, hand[r], sync));
  sync();
  return {
    key,
    title: 'Forced trade',
    modal: true,
    body: [
      h(
        'p',
        {},
        `Give ${count} card${count > 1 ? 's' : ''} of your choice to ${nameOf(state, 1 - me)}.`,
      ),
      ...rows,
      h('p', {}, 'Selected: ', total),
      h('div', { class: 'dialog-actions' }, go),
    ],
  };
}

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

function hint(state: GameState, view: HudView): string | null {
  const phase = tbPhase(state);
  const me = view.viewer;
  const acting = !view.spectator && view.legal.some((a) => a.player === me);
  switch (phase.kind) {
    case 'tb/wagon': {
      const mp = tbSlice(state).traders?.move.mp ?? 0;
      return acting
        ? `Move your wagon (${mp} MP left), or end your turn`
        : `${nameOf(state, state.turn.current)} moves the wagon`;
    }
    case 'tb/knights': {
      const from = (phase as Extract<TbPhase, { kind: 'tb/knights' }>).from;
      if (!acting) return `${nameOf(state, state.turn.current)} moves knights`;
      return from === null
        ? 'Pick a knight to move, or end your turn (the barbarians are fought then)'
        : 'Move the knight to a highlighted path (more than 3 steps costs 1 wheat)';
    }
    case 'tb/placeKnight':
      return acting ? 'Place your new knight on a highlighted path' : null;
    case 'tb/treason': {
      const from = (phase as Extract<TbPhase, { kind: 'tb/treason' }>).from;
      return acting
        ? from === null
          ? 'Treason: pick a coastal hex to take a barbarian from'
          : 'Treason: pick the coastal hex the barbarian moves to'
        : null;
    }
    case 'tb/intrigue':
      return acting
        ? 'Intrigue: pick a coastal hex — one barbarian there becomes your prisoner'
        : null;
    case 'tb/barbarian': {
      const from = (phase as Extract<TbPhase, { kind: 'tb/barbarian' }>).from;
      if (!acting) return `${nameOf(state, state.turn.current)} moves a barbarian`;
      return from === null ? 'Pick a barbarian to move' : 'Pick the path the barbarian moves to';
    }
    case 'tb/neutral': {
      const piece = (phase as Extract<TbPhase, { kind: 'tb/neutral' }>).piece;
      return acting ? `Build a free ${piece} for ${NEUTRAL_NAMES[0]} or ${NEUTRAL_NAMES[1]}` : null;
    }
    case 'tb/vote': {
      const v = phase as Extract<TbPhase, { kind: 'tb/vote' }>;
      if (v.placer === null) {
        const bidder = v.order[0];
        return bidder === me && acting
          ? 'Camel vote: place your bid'
          : `Camel vote: ${nameOf(state, bidder ?? 0)} bids`;
      }
      return v.placer === me && acting
        ? 'Place the camel on a highlighted path'
        : `${nameOf(state, v.placer)} places the camel`;
    }
    case 'tb/forcedGive':
      return acting ? 'Forced trade: give cards back' : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The extension
// ---------------------------------------------------------------------------

export const tbHud: HudExtension = {
  id: TB,
  sounds: tbSounds,

  cardFace: (kind, w) =>
    kind === 'gold' || kind === 'fish'
      ? h(
          'span',
          { class: 'card-face tb-card-face', style: { '--cw': `${w}px` } },
          tbIcon(kind, Math.round(w * 0.72)),
        )
      : null,

  panel(state, view, send) {
    const scenario = state.settings.scenario ?? SC_BASE;
    // data-feat lets tb.css hide the build cards of other scenarios (bridge, wagon, knights).
    const body = h('div', {
      class: 'tb-panel',
      attrs: { 'data-feat': featuresOf(state.settings.scenario).join(' ') },
    });
    const f = facts(state);
    if (f) body.append(f);
    // The viewer's moves first (the section scrolls), then the table.
    const actions = actionsFor(state, view, send);
    if (actions) body.append(actions);
    const own = ownDetails(state, view);
    if (own) body.append(own);
    body.append(playerRows(state, view));
    if (isTwo(state)) {
      body.append(
        h(
          'p',
          { class: 'muted tb-note' },
          `Catan for Two: two rolls a turn; every road and settlement you build gives a neutral player one too.`,
        ),
      );
    }
    return { title: SCENARIO_NAME[scenario] ?? 'Traders & Barbarians', body };
  },

  buildCards: [
    {
      mode: 'tb/bridge',
      label: 'Bridge',
      actionType: 'tb/buildBridge',
      glyph: 'road',
      costItem: BRIDGE_ITEM,
      available: (state) => has(state, 'rivers'),
      left: (state, p) => (has(state, 'rivers') ? BRIDGES_PER_PLAYER - bridgesBuilt(state, p) : 0),
      total: () => BRIDGES_PER_PLAYER,
    },
    {
      mode: 'tb/wagon',
      label: 'Wagon',
      actionType: 'tb/startWagon',
      glyph: 'trade',
      available: (state) => has(state, 'traders'),
    },
    {
      mode: 'tb/knights',
      label: 'Move knights',
      actionType: 'tb/startKnights',
      glyph: 'knight',
      available: baCardsInPlay,
    },
  ],

  dialog(state, view, _legal, send) {
    if (view.spectator) return null;
    return voteDialog(state, view, send) ?? forcedGiveDialog(state, view, send);
  },

  hint,

  impliedActions: [
    'tb/wagonStep',
    'tb/placeKnight',
    'tb/treasonHex',
    'tb/intrigueHex',
    'tb/selectKnight',
    'tb/moveKnight',
    'tb/placeBarbarian',
    'tb/neutralRoad',
    'tb/neutralSettlement',
    'tb/placeCamel',
  ],
};
