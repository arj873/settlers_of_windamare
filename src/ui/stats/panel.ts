/**
 * Game statistics panel (UX2), shown from the winner screen. Stateless: the HUD keeps the open
 * tab, the picked player and the collapsed flag, and re-renders on change. Charts are plain
 * SVG; every colour is a theme token except the players' own colours (series identity).
 */
import {
  EVENT_INFO,
  RESOURCES,
  sumCounts,
  type EventKind,
  type GameState,
  type GameStats,
  type PlayerId,
  type PlayerStats,
} from '../../engine';
import { h, type Child } from '../dom';
import { DEV_GLYPH, glyph, RESOURCE_LABEL, resourceIcon } from '../icons';
import { DEV_CARD_INFO } from '../model';
import { avatar, playerStyle } from '../widgets';
import { seatAvatar } from '../profile/looks';
import {
  awards,
  devRows,
  diceHistogram,
  formatDuration,
  GAIN_LABEL,
  LOSS_LABEL,
  luck,
  rollsOf,
  sevensOf,
  standings,
  STATS_TABS,
  total,
  vpSeries,
  type StatsTab,
} from './model';
import './stats.css';

export interface StatsPanelOptions {
  tab: StatsTab;
  /** Player shown in the Resources detail table. */
  player: PlayerId;
  collapsed: boolean;
  durationMs: number | null;
  onTab: (tab: StatsTab) => void;
  onPlayer: (p: PlayerId) => void;
  onToggle: () => void;
  /** Footer buttons (back to the results, new game / session actions). */
  actions: HTMLElement[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  ...children: (SVGElement | string | null)[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) if (c !== null) el.append(c);
  return el;
}

const dot = (color: string) => h('span', { class: 'gs-dot', style: playerStyle(color) });

function who(state: GameState, p: PlayerId): HTMLElement {
  const pl = state.players[p];
  return h(
    'span',
    { class: 'gs-who', style: playerStyle(pl?.color ?? '#999') },
    // PR1: the profile picture when the seat has one (bots and pictureless seats keep the dot).
    pl && seatAvatar(p) ? avatar(pl, false, 22) : dot(pl?.color ?? '#999'),
    h('span', { class: 'gs-name' }, pl?.name ?? `Player ${p + 1}`),
  );
}

function whoList(state: GameState, ps: PlayerId[]): HTMLElement {
  return h('span', { class: 'gs-wholist' }, ...ps.map((p) => who(state, p)));
}

interface Row {
  label: Child;
  cell: (p: PlayerStats, id: PlayerId) => Child;
  strong?: boolean;
  title?: string;
}

/** Metric rows × player columns (scrolls sideways inside itself on narrow screens). */
function playerTable(state: GameState, stats: GameStats, caption: string, rows: Row[]) {
  return h(
    'div',
    { class: 'gs-scroll' },
    h(
      'table',
      { class: 'gs-table' },
      h('caption', { class: 'gs-sr' }, caption),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { attrs: { scope: 'col' } }, ''),
          ...state.players.map((p) => h('th', { attrs: { scope: 'col' } }, who(state, p.id))),
        ),
      ),
      h(
        'tbody',
        {},
        ...rows.map((r) =>
          h(
            'tr',
            { class: r.strong ? 'is-strong' : '' },
            h('th', { attrs: { scope: 'row' }, ...(r.title ? { title: r.title } : {}) }, r.label),
            ...state.players.map((p) => {
              const s = stats.players[p.id];
              return h('td', {}, s ? r.cell(s, p.id) : '—');
            }),
          ),
        ),
      ),
    ),
  );
}

const section = (title: string, ...children: Child[]) =>
  h('section', { class: 'gs-section' }, h('h3', {}, title), ...children);

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function overview(state: GameState, stats: GameStats): HTMLElement[] {
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const rows = standings(state).map((b, i) => {
    const chips: Child[] = [
      b.settlements > 0 && chip(plural(b.settlements, 'settlement'), b.settlements),
      b.cities > 0 && chip(plural(b.cities, 'city', 'cities'), 2 * b.cities),
      b.vpCards > 0 && chip(plural(b.vpCards, 'VP card'), b.vpCards),
      b.longestRoad && chip('Longest Road', 2),
      b.largestArmy && chip('Largest Army', 2),
      ...b.parts.map((part) => part.vp !== 0 && chip(part.label, part.vp)),
      b.other !== 0 && chip('Other', b.other),
    ];
    return h(
      'li',
      {
        class: `gs-stand${b.player === state.winner ? ' is-winner' : ''}`,
        style: playerStyle(state.players[b.player]?.color ?? '#999'),
      },
      h('span', { class: 'gs-rank' }, String(i + 1)),
      who(state, b.player),
      h('span', { class: 'gs-vp' }, `${b.total} VP`),
      h('span', { class: 'gs-chips' }, ...chips),
    );
  });
  const list = awards(stats);
  return [
    section('Final standings', h('ol', { class: 'gs-standings' }, ...rows)),
    section(
      'Awards',
      list.length === 0
        ? h('p', { class: 'gs-muted' }, 'No awards this time.')
        : h(
            'ul',
            { class: 'gs-awards' },
            ...list.map((a) =>
              h(
                'li',
                { class: 'gs-award', attrs: { 'data-award': a.id } },
                h('span', { class: 'gs-award-title' }, a.title),
                whoList(state, a.players),
                h('span', { class: 'gs-muted' }, a.detail),
              ),
            ),
          ),
    ),
  ];
}

function chip(label: string, vp: number): HTMLElement {
  return h('span', { class: 'gs-chip' }, label, h('b', {}, ` ${vp >= 0 ? '+' : ''}${vp}`));
}

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

function diceChart(stats: GameStats): HTMLElement {
  const bars = diceHistogram(stats);
  const W = Math.round(Math.max(300, Math.min(440, (globalThis.innerWidth || 440) - 40))),
    H = 200,
    L = 28,
    B = 24,
    T = 18;
  const top = Math.max(1, ...bars.map((b) => Math.max(b.count, b.expected)));
  const step = (W - L) / bars.length;
  const y = (v: number) => H - B - ((H - B - T) * v) / top;
  const ticks = niceTicks(top);
  const chart = svg(
    'svg',
    {
      class: 'gs-chart',
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': `Dice totals rolled: ${bars.map((b) => `${b.total}: ${b.count}`).join(', ')}`,
    },
    ...ticks.map((t) =>
      svg(
        'g',
        {},
        svg('line', { class: 'gs-grid', x1: L, x2: W, y1: y(t), y2: y(t) }),
        svg('text', { class: 'gs-axis', x: L - 6, y: y(t) + 4, 'text-anchor': 'end' }, String(t)),
      ),
    ),
    ...bars.map((b, i) => {
      const x = L + i * step;
      const bw = Math.max(4, step - 6);
      const hgt = Math.max(0, H - B - y(b.count));
      return svg(
        'g',
        { class: `gs-bar${b.total === 7 ? ' is-seven' : ''}` },
        svg('title', {}, `${b.total}: rolled ${b.count}× (expected ${b.expected.toFixed(1)})`),
        svg('rect', { class: 'gs-hit', x, y: T, width: step, height: H - B - T }),
        svg('path', { class: 'gs-bar-fill', d: roundTop(x + 3, H - B, bw, hgt) }),
        svg('line', {
          class: 'gs-expected',
          x1: x + 1,
          x2: x + step - 1,
          y1: y(b.expected),
          y2: y(b.expected),
        }),
        b.count > 0
          ? svg('text', { class: 'gs-val', x: x + step / 2, y: y(b.count) - 4 }, String(b.count))
          : null,
        svg('text', { class: 'gs-axis', x: x + step / 2, y: H - 6 }, String(b.total)),
      );
    }),
  );
  return h(
    'figure',
    { class: 'gs-figure' },
    chart,
    h(
      'figcaption',
      { class: 'gs-legend' },
      h('span', { class: 'gs-key gs-key-bar' }, 'Rolled'),
      h('span', { class: 'gs-key gs-key-seven' }, 'Sevens'),
      h('span', { class: 'gs-key gs-key-expected' }, 'Expected (fair dice)'),
    ),
  );
}

/** A bar of height `hgt` from the baseline `base`, its top corners rounded (4px). */
function roundTop(x: number, base: number, w: number, hgt: number): string {
  if (hgt <= 0) return '';
  const r = Math.min(4, w / 2, hgt);
  return `M${x},${base}V${base - hgt + r}Q${x},${base - hgt} ${x + r},${base - hgt}H${x + w - r}Q${x + w},${base - hgt} ${x + w},${base - hgt + r}V${base}Z`;
}

/** 0, step, 2·step … ≤ max, with a round step giving at most `count` intervals. */
function niceTicks(max: number, count = 6): number[] {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
  const step = steps.find((s) => max / s <= count) ?? Math.ceil(max / count);
  const out: number[] = [];
  for (let t = 0; t <= max; t += step) out.push(t);
  return out;
}

function dice(state: GameState, stats: GameStats): HTMLElement[] {
  const all = stats.players.reduce((n, p) => n + rollsOf(p), 0);
  const sevens = stats.players.reduce((n, p) => n + sevensOf(p), 0);
  const events = Object.entries(stats.events) as [EventKind, number][];
  return [
    h(
      'div',
      { class: 'gs-tiles' },
      tile('Rolls', all),
      tile('Sevens', sevens, all > 0 ? `${Math.round((100 * sevens) / all)}% (expected 17%)` : ''),
    ),
    section('Totals rolled', diceChart(stats)),
    section(
      'Rolls per player',
      playerTable(state, stats, 'Rolls per player', [
        { label: 'Rolls', cell: (s) => rollsOf(s) },
        { label: 'Sevens', cell: (s) => sevensOf(s) },
        {
          label: 'Most rolled',
          cell: (s) => {
            const best = Math.max(...s.rolls);
            return best > 0
              ? s.rolls.flatMap((n, i) => (n === best ? [i + 2] : [])).join(', ')
              : '—';
          },
        },
      ]),
    ),
    events.length > 0 &&
      section(
        'Event cards drawn',
        h(
          'ul',
          { class: 'gs-events' },
          ...events
            .sort((a, b) => b[1] - a[1])
            .map(([kind, n]) =>
              h('li', {}, h('span', {}, EVENT_INFO[kind]?.name ?? kind), h('b', {}, `×${n}`)),
            ),
        ),
      ),
  ].filter((x): x is HTMLElement => x instanceof HTMLElement);
}

function tile(label: string, value: Child, sub = ''): HTMLElement {
  return h(
    'div',
    { class: 'gs-tile' },
    h('span', { class: 'gs-tile-label' }, label),
    h('b', { class: 'gs-tile-value' }, value),
    sub && h('span', { class: 'gs-muted' }, sub),
  );
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

function resources(state: GameState, stats: GameStats, opts: StatsPanelOptions): HTMLElement[] {
  const pick = stats.players[opts.player] ? opts.player : 0;
  const ps = stats.players[pick];
  const summary = playerTable(state, stats, 'Resources per player', [
    { label: 'Gained', cell: (s) => total(sumCounts(s.gained)), strong: true },
    { label: 'Production', cell: (s) => total(s.gained.production) },
    {
      label: 'Expected production',
      title: 'What their buildings should have produced on their rolls with fair dice',
      cell: (s) => (s.expected36 / 36).toFixed(1),
    },
    { label: 'Trades (in)', cell: (s) => total(s.gained.trade) + total(s.gained.bank) },
    { label: 'Stolen by them', cell: (s) => total(s.gained.steal) },
    { label: 'Dev cards', cell: (s) => total(s.gained.devCard) },
    { label: 'Spent', cell: (s) => total(s.lost.build) + total(s.lost.buyDev), strong: true },
    {
      label: 'Lost to robber',
      title: 'Stolen, discarded on 7s and taken by Monopoly',
      cell: (s) => total(s.lost.stolen) + total(s.lost.discard) + total(s.lost.monopoly),
    },
    { label: 'Blocked by robber', cell: (s) => total(s.blocked) },
    { label: 'Luck', cell: (s) => signed(luck(s)), title: 'Production minus expected' },
  ]);
  const picker = h(
    'div',
    { class: 'gs-picker', attrs: { role: 'group', 'aria-label': 'Player' } },
    ...state.players.map((p) =>
      h(
        'button',
        {
          class: `gs-pick${p.id === pick ? ' is-on' : ''}`,
          attrs: { 'aria-pressed': String(p.id === pick) },
          on: { click: () => opts.onPlayer(p.id) },
        },
        who(state, p.id),
      ),
    ),
  );
  return [
    section('Totals', summary),
    section('By type and source', picker, ps ? resourceDetail(ps, state, pick) : null),
  ];
}

const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;

function resourceDetail(ps: PlayerStats, state: GameState, p: PlayerId): HTMLElement {
  const line = (label: string, c: Record<(typeof RESOURCES)[number], number>, cls = '') =>
    h(
      'tr',
      { class: cls },
      h('th', { attrs: { scope: 'row' } }, label),
      ...RESOURCES.map((r) => h('td', {}, c[r] ? String(c[r]) : '·')),
      h('td', { class: 'gs-sum' }, String(total(c))),
    );
  const gains = (Object.keys(GAIN_LABEL) as (keyof typeof GAIN_LABEL)[])
    .filter((k) => total(ps.gained[k]) > 0)
    .map((k) => line(GAIN_LABEL[k] ?? k, ps.gained[k]));
  const losses = (Object.keys(LOSS_LABEL) as (keyof typeof LOSS_LABEL)[])
    .filter((k) => total(ps.lost[k]) > 0)
    .map((k) => line(LOSS_LABEL[k] ?? k, ps.lost[k]));
  const hand = state.players[p]?.resources;
  return h(
    'div',
    { class: 'gs-scroll' },
    h(
      'table',
      { class: 'gs-table gs-res' },
      h('caption', { class: 'gs-sr' }, `${state.players[p]?.name ?? ''}: resources by type`),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}, ''),
          ...RESOURCES.map((r) =>
            h('th', { attrs: { scope: 'col' }, title: RESOURCE_LABEL[r] }, resourceIcon(r, 20)),
          ),
          h('th', { attrs: { scope: 'col' } }, 'Σ'),
        ),
      ),
      h(
        'tbody',
        {},
        h('tr', { class: 'gs-group' }, h('th', { attrs: { colspan: '7' } }, 'Gained')),
        ...gains,
        line('Total gained', sumCounts(ps.gained), 'is-strong'),
        h('tr', { class: 'gs-group' }, h('th', { attrs: { colspan: '7' } }, 'Lost')),
        ...losses,
        line('Total lost', sumCounts(ps.lost), 'is-strong'),
        total(ps.blocked) > 0 ? line('Blocked by robber', ps.blocked, 'gs-dim') : null,
        hand ? line('Final hand', hand, 'is-strong') : null,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

function vpChart(state: GameState, stats: GameStats): HTMLElement {
  const series = vpSeries(stats, state.players.length);
  const n = series.turns.length;
  // Narrow screens get a narrower viewBox, so the axis text keeps its size.
  const W = Math.round(Math.max(320, Math.min(600, (globalThis.innerWidth || 600) - 40))),
    H = W < 480 ? 220 : 240,
    L = 30,
    R = 12,
    T = 12,
    B = 26;
  const goal = state.settings.vpToWin;
  const top = Math.max(goal, series.max);
  const first = series.turns[0] ?? 0;
  const last = series.turns[n - 1] ?? 1;
  const span = Math.max(1, last - first);
  const x = (turn: number) => L + ((W - L - R) * (turn - first)) / span;
  const y = (v: number) => H - B - ((H - B - T) * v) / top;
  const xTicks = niceTicks(span, W < 480 ? 5 : 10).map((t) => t + first);

  const tip = h('div', { class: 'gs-tip', attrs: { hidden: '' } });
  const cross = svg('line', { class: 'gs-cross', y1: T, y2: H - B, x1: -10, x2: -10 });
  const marks = state.players.map((p) =>
    svg('circle', { class: 'gs-mark', r: 4, cx: -10, cy: -10, style: `--pc:${p.color}` }),
  );

  const chart = svg(
    'svg',
    {
      class: 'gs-chart gs-line',
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': `Victory points over ${last} turns`,
    },
    ...niceTicks(top).map((t) =>
      svg(
        'g',
        {},
        svg('line', { class: 'gs-grid', x1: L, x2: W - R, y1: y(t), y2: y(t) }),
        svg('text', { class: 'gs-axis', x: L - 6, y: y(t) + 4, 'text-anchor': 'end' }, String(t)),
      ),
    ),
    svg('line', { class: 'gs-goal', x1: L, x2: W - R, y1: y(goal), y2: y(goal) }),
    ...xTicks.map((t) => svg('text', { class: 'gs-axis', x: x(t), y: H - 8 }, String(t))),
    ...series.vp.flatMap((vals, p) => {
      if (n === 0) return [];
      const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(series.turns[i] ?? 0)},${y(v)}`).join('');
      const color = state.players[p]?.color ?? '#999';
      return [
        svg('path', { class: 'gs-line-under', d }),
        svg('path', { class: 'gs-line-stroke', d, style: `--pc:${color}` }),
      ];
    }),
    cross,
    ...marks,
  );

  const show = (clientX: number) => {
    if (n === 0) return;
    const box = chart.getBoundingClientRect();
    const vx = box.width > 0 ? ((clientX - box.left) / box.width) * W : 0;
    const turnAt = first + ((vx - L) / (W - L - R)) * span;
    let i = 0;
    for (let k = 1; k < n; k++) {
      if (Math.abs((series.turns[k] ?? 0) - turnAt) < Math.abs((series.turns[i] ?? 0) - turnAt))
        i = k;
    }
    const turn = series.turns[i] ?? 0;
    const cx = x(turn);
    cross.setAttribute('x1', String(cx));
    cross.setAttribute('x2', String(cx));
    marks.forEach((m, p) => {
      m.setAttribute('cx', String(cx));
      m.setAttribute('cy', String(y(series.vp[p]?.[i] ?? 0)));
    });
    const order = state.players
      .map((p) => ({ p, v: series.vp[p.id]?.[i] ?? 0 }))
      .sort((a, b) => b.v - a.v);
    tip.replaceChildren(
      h('b', {}, turn === 0 ? 'After setup' : `Turn ${turn}`),
      ...order.map(({ p, v }) =>
        h('span', { class: 'gs-tip-row' }, who(state, p.id), h('b', {}, String(v))),
      ),
    );
    tip.hidden = false;
    const left = box.width > 0 ? (cx / W) * box.width : 0;
    tip.style.left = `${Math.min(Math.max(left, 60), Math.max(60, box.width - 60))}px`;
  };
  const hide = () => {
    tip.hidden = true;
    cross.setAttribute('x1', '-10');
    cross.setAttribute('x2', '-10');
    for (const m of marks) m.setAttribute('cx', '-10');
  };
  chart.addEventListener('pointermove', (e) => show(e.clientX));
  chart.addEventListener('pointerdown', (e) => show(e.clientX));
  chart.addEventListener('pointerleave', hide);

  return h(
    'figure',
    { class: 'gs-figure gs-figure-line' },
    h('div', { class: 'gs-plot' }, chart, tip),
    h(
      'figcaption',
      { class: 'gs-legend' },
      ...state.players.map((p) => who(state, p.id)),
      h('span', { class: 'gs-key gs-key-goal' }, `${goal} VP to win`),
    ),
  );
}

function activity(state: GameState, stats: GameStats): HTMLElement[] {
  return [
    section(
      'Victory points over turns',
      stats.vpHistory.length > 1
        ? vpChart(state, stats)
        : h('p', { class: 'gs-muted' }, 'Not enough turns recorded.'),
    ),
    section(
      'Building, trading and the robber',
      playerTable(state, stats, 'Activity per player', [
        { label: 'Roads', cell: (s) => s.built.road },
        { label: 'Free roads (Road Building)', cell: (s) => s.freeRoads },
        { label: 'Settlements', cell: (s) => s.built.settlement },
        { label: 'Cities', cell: (s) => s.built.city },
        { label: 'Trade offers', cell: (s) => s.offersMade },
        {
          label: 'Trades done',
          title: 'Own offers accepted + others’ offers completed',
          cell: (s) => s.tradesAsOfferer + s.tradesAsPartner,
        },
        { label: 'Bank trades (4:1)', cell: (s) => s.bankTrades },
        { label: 'Harbor trades', cell: (s) => s.portTrades },
        { label: 'Robber moves', cell: (s) => s.robberMoves },
        { label: 'Steals', cell: (s) => s.steals },
        { label: 'Robbed', cell: (s) => s.robbed },
        { label: 'Discards', cell: (s) => s.discards },
      ]),
    ),
  ];
}

// ---------------------------------------------------------------------------
// Dev cards
// ---------------------------------------------------------------------------

function devCards(state: GameState, stats: GameStats): HTMLElement[] {
  const rows = devRows(stats);
  const label = (t: (typeof rows)[number]['type']) =>
    h('span', { class: 'gs-dev' }, glyph(DEV_GLYPH[t], 18), DEV_CARD_INFO[t].name);
  const history = (award: 'largestArmy' | 'longestRoad') => {
    const entries = stats.awardHistory.filter((e) => e.award === award);
    if (entries.length === 0) return h('p', { class: 'gs-muted' }, 'Nobody claimed it.');
    return h(
      'ol',
      { class: 'gs-history' },
      ...entries.map((e) =>
        h(
          'li',
          {},
          h('span', { class: 'gs-turn' }, `Turn ${e.turn}`),
          e.player === null
            ? h('span', { class: 'gs-muted' }, 'nobody holds it')
            : who(state, e.player),
        ),
      ),
    );
  };
  return [
    section(
      'Bought',
      playerTable(state, stats, 'Dev cards bought', [
        ...rows.map((r) => ({
          label: label(r.type),
          cell: (_: PlayerStats, p: PlayerId) => r.bought[p] ?? 0,
        })),
        {
          label: 'Total',
          strong: true,
          cell: (_: PlayerStats, p: PlayerId) => rows.reduce((n, r) => n + (r.bought[p] ?? 0), 0),
        },
      ]),
    ),
    section(
      'Played',
      playerTable(
        state,
        stats,
        'Dev cards played',
        rows
          .filter((r) => r.type !== 'victoryPoint')
          .map((r) => ({
            label: label(r.type),
            cell: (_: PlayerStats, p: PlayerId) => r.played[p] ?? 0,
          })),
      ),
    ),
    section('Largest Army', history('largestArmy')),
    section('Longest Road', history('longestRoad')),
  ];
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export function statsPanel(
  state: GameState,
  stats: GameStats,
  opts: StatsPanelOptions,
): HTMLElement {
  const winner = state.winner === null ? null : state.players[state.winner];
  const head = h(
    'header',
    { class: 'gs-head' },
    h('h2', { class: 'gs-title', id: 'gs-title' }, 'Game Statistics'),
    h(
      'div',
      { class: 'gs-meta' },
      winner && h('span', { class: 'gs-meta-item' }, 'Winner: ', who(state, winner.id)),
      h('span', { class: 'gs-meta-item' }, 'Turns: ', h('b', {}, String(state.turn.number))),
      h(
        'span',
        { class: 'gs-meta-item' },
        'Duration: ',
        h('b', {}, formatDuration(opts.durationMs)),
      ),
    ),
    h(
      'button',
      {
        class: 'gs-collapse',
        title: opts.collapsed ? 'Show statistics' : 'Hide statistics (see the board)',
        attrs: {
          'aria-expanded': String(!opts.collapsed),
          'aria-label': opts.collapsed ? 'Show statistics' : 'Hide statistics',
        },
        on: { click: () => opts.onToggle() },
      },
      glyph('chevron', 22),
    ),
  );
  if (opts.collapsed) {
    return h(
      'section',
      { class: 'gstats is-collapsed', attrs: { 'aria-labelledby': 'gs-title' } },
      head,
    );
  }
  const tabs = h(
    'nav',
    { class: 'gs-tabs', attrs: { role: 'tablist', 'aria-label': 'Statistics' } },
    ...STATS_TABS.map((t) =>
      h(
        'button',
        {
          class: `gs-tab${t.id === opts.tab ? ' is-on' : ''}`,
          attrs: {
            role: 'tab',
            'aria-selected': String(t.id === opts.tab),
            'data-tab': t.id,
          },
          on: { click: () => opts.onTab(t.id) },
        },
        t.label,
      ),
    ),
  );
  const body: HTMLElement[] =
    opts.tab === 'overview'
      ? overview(state, stats)
      : opts.tab === 'dice'
        ? dice(state, stats)
        : opts.tab === 'resources'
          ? resources(state, stats, opts)
          : opts.tab === 'activity'
            ? activity(state, stats)
            : devCards(state, stats);
  return h(
    'section',
    { class: 'gstats', attrs: { role: 'dialog', 'aria-labelledby': 'gs-title' } },
    head,
    tabs,
    h(
      'div',
      { class: 'gs-body', attrs: { role: 'tabpanel', 'data-tab': opts.tab } },
      !stats.complete &&
        h(
          'p',
          { class: 'gs-note' },
          `Recorded from turn ${stats.fromTurn} on (this game was saved before statistics existed).`,
        ),
      ...body,
    ),
    opts.actions.length > 0 && h('footer', { class: 'gs-foot' }, ...opts.actions),
  );
}
