/**
 * Explorers & Pirates HUD: a sidebar panel (goal and phase, players' gold and pieces, mission
 * tracks with their bonus tiles, the viewer's fleet and harbors with their buttons, trading with
 * the supply), build cards (Harbor, Ship, Settler, Crew), the gold card in the hand, the pirate's
 * steal dialog and turn-pill hints. Board clicks: setup road / ship, moving and selecting ships,
 * landing settlers, placing the pirate.
 */
import type { Action, GameState, PlayerId, Resource, VertexId } from '../../engine';
import { RESOURCES } from '../../engine/constants';
import { h, type Child } from '../../ui/dom';
import type { HudDialog, HudExtension } from '../../ui/expansions';
import { glyph, RESOURCE_LABEL } from '../../ui/icons';
import type { HudView } from '../../ui/types';
import { playerStyle, resCardFace } from '../../ui/widgets';
import { A } from './engine/actions';
import { missionsOf, missionVp, tileHolder, totalMissionVp, vpParts } from './engine/missions';
import { isCoastal } from './engine/geometry';
import {
  crewsLeft,
  harborsLeft,
  isHarbor,
  mpLeft,
  settlersLeft,
  shipsLeft,
  shipsOf,
} from './engine/ships';
import { goldOffer } from './engine/trade';
import {
  citiesInPlay,
  epSlice,
  GOLD_BUYS,
  isHarborStep,
  ITEM,
  LIMIT,
  MISSION_NAME,
  rulesOf,
  scenarioKey,
  SCENARIOS,
  TILE_NAME,
  TRACK_VP,
  type Cargo,
  type Mission,
  type PirateStealPhase,
  type Ship,
} from './engine/state';
import { epSounds } from './sounds';
import './ep.css';

type Send = (a: Action) => void;
const mine = (view: HudView, type: string): Action[] =>
  view.legal.filter((a) => a.player === view.viewer && a.type === type);
const field = (a: Action, k: string): unknown => (a as unknown as Record<string, unknown>)[k];

// ---------------------------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------------------------

const ICON: Record<Cargo | 'gold' | 'ship', string> = {
  settler:
    '<circle cx="16" cy="9" r="5" fill="currentColor" stroke="#1c1c24" stroke-width="1.6"/><path d="M8 28 L11 15 H21 L24 28 Z" fill="currentColor" stroke="#1c1c24" stroke-width="1.6" stroke-linejoin="round"/>',
  crew: '<circle cx="16" cy="11" r="4" fill="currentColor" stroke="#1c1c24" stroke-width="1.6"/><rect x="11" y="6" width="10" height="2.6" fill="#d9433a"/><path d="M10 27 L12.5 16 H19.5 L22 27 Z" fill="currentColor" stroke="#1c1c24" stroke-width="1.6" stroke-linejoin="round"/>',
  fish: '<ellipse cx="17" cy="16" rx="9" ry="5" fill="#7fb3d5" stroke="#1c1c24" stroke-width="1.6"/><path d="M8 16 L3 11 V21 Z" fill="#7fb3d5" stroke="#1c1c24" stroke-width="1.6" stroke-linejoin="round"/><circle cx="22" cy="15" r="1.2" fill="#1c1c24"/>',
  spice:
    '<path d="M9 27 L8 17 L13 9 H19 L24 17 L23 27 Z" fill="#b07a3a" stroke="#1c1c24" stroke-width="1.6" stroke-linejoin="round"/><rect x="12" y="7" width="8" height="3" fill="#e8d3a0" stroke="#1c1c24" stroke-width="1.2"/>',
  gold: '<circle cx="16" cy="16" r="11" fill="#f2c35a" stroke="#7a5410" stroke-width="2"/><circle cx="16" cy="16" r="7" fill="none" stroke="#b88a2a" stroke-width="1.6"/><path d="M16 11 V21 M13 13.5 H18 a2.5 2.5 0 0 1 0 5 H14" fill="none" stroke="#7a5410" stroke-width="1.6"/>',
  ship: '<path d="M5 19 H27 L23 25 H9 Z" fill="currentColor" stroke="#1c1c24" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 19 V5 L25 17 H16" fill="#f3ead2" stroke="#1c1c24" stroke-width="1.4" stroke-linejoin="round"/>',
};

function icon(name: keyof typeof ICON, size: number, color?: string, label?: string): HTMLElement {
  const span = document.createElement('span');
  span.className = `ep-ico ep-ico-${name}`;
  span.style.width = span.style.height = `${size}px`;
  if (color) span.style.color = color;
  if (label) {
    span.setAttribute('role', 'img');
    span.setAttribute('aria-label', label);
    span.title = label;
  } else span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}">${ICON[name]}</svg>`;
  return span;
}

/** The gold coin card face for the hand bar. */
export function goldFace(w: number): HTMLElement {
  return h(
    'span',
    {
      class: 'card-face ep-gold-face',
      style: { '--cw': `${w}px` },
      attrs: { role: 'img', 'aria-label': 'Gold' },
    },
    icon('gold', Math.round(w * 0.72)),
  );
}

const CARGO_NAME: Record<Cargo, string> = {
  settler: 'settler',
  crew: 'crew',
  fish: 'fish haul',
  spice: 'spice sack',
};

const cargoIcons = (cargo: readonly Cargo[], color: string) =>
  cargo.length === 0
    ? [h('span', { class: 'ep-empty muted' }, 'empty')]
    : cargo.map((c) => icon(c, 18, color, CARGO_NAME[c]));

const btn = (label: Child, a: Action, send: Send, title?: string) =>
  h(
    'button',
    { class: 'btn btn-sm ep-btn', title: title ?? '', on: { click: () => send(a) } },
    label,
  );

// ---------------------------------------------------------------------------------------------
// Panel sections
// ---------------------------------------------------------------------------------------------

function goalText(state: GameState): string {
  const vp = state.settings.vpToWin;
  const missions = missionsOf(rulesOf(state)).map((m) => MISSION_NAME[m]);
  return missions.length === 0
    ? `${vp} VP wins. Sail settlers to new land: settlements 1 VP, harbor settlements 2 VP.`
    : `${vp} VP wins. Missions: ${missions.join(', ')}.`;
}

function phaseLine(state: GameState, view: HudView, send: Send): HTMLElement | null {
  if (state.phase.kind !== 'main' || state.turn.current !== view.viewer) return null;
  const moving = epSlice(state).turn.movement;
  const start = mine(view, A.startMovement)[0];
  return h(
    'div',
    { class: `ep-phase${moving ? ' is-moving' : ''}` },
    h('b', {}, moving ? 'Movement phase' : 'Action phase'),
    h('span', { class: 'muted' }, moving ? ' sail, load, explore' : ' trade and build'),
    start && btn('Start Movement phase', start, send, 'No more trading or building this turn'),
  );
}

function playerRows(state: GameState): HTMLElement {
  const s = epSlice(state);
  const crews = rulesOf(state).crews;
  return h(
    'ul',
    { class: 'ep-list' },
    ...state.players.map((p) => {
      const v = missionVp(state, p.id);
      const mvp = totalMissionVp(v);
      // Harbor settlements' extra VP plus mission tracks and tiles (not only missions).
      const parts = vpParts(v).map((x) => `${x.label} +${x.vp}`);
      return h(
        'li',
        { class: 'ep-row', style: playerStyle(p.color) },
        h('span', { class: 'ep-name' }, p.name),
        h('span', { class: 'ep-stat', title: 'Gold' }, icon('gold', 15), String(s.gold[p.id] ?? 0)),
        h(
          'span',
          { class: 'ep-stat', title: `${shipsLeft(state, p.id)} of ${LIMIT.ship} ships in supply` },
          icon('ship', 15, p.color),
          String(shipsLeft(state, p.id)),
        ),
        h(
          'span',
          { class: 'ep-stat', title: `${settlersLeft(state, p.id)} settlers in supply` },
          icon('settler', 15, p.color),
          String(settlersLeft(state, p.id)),
        ),
        crews &&
          h(
            'span',
            { class: 'ep-stat', title: `${crewsLeft(state, p.id)} crews in supply` },
            icon('crew', 15, p.color),
            String(crewsLeft(state, p.id)),
          ),
        h(
          'span',
          {
            class: 'ep-stat',
            title: `${harborsLeft(state, p.id)} harbor settlements left; extra VP: ${parts.join(', ') || 'none yet'}`,
          },
          glyph('victoryPoint', 13),
          `+${mvp}`,
        ),
      );
    }),
  );
}

function trackBlock(state: GameState, m: Mission): HTMLElement {
  const t = epSlice(state).tracks[m];
  const vps = TRACK_VP[m];
  const holder = tileHolder(t);
  const space = (i: number) =>
    h(
      'span',
      {
        class: `ep-space${i === 0 ? ' is-start' : ''}`,
        title: i === 0 ? 'Start' : `${vps[i - 1]} VP`,
      },
      h('span', { class: 'ep-pips' }, i === 0 ? '·' : String(vps[i - 1])),
      h(
        'span',
        { class: 'ep-markers' },
        ...state.players
          .filter((p) => (t?.pos[p.id] ?? 0) === i)
          .sort((a, b) => (t?.arrived[a.id] ?? 0) - (t?.arrived[b.id] ?? 0))
          .map((p) =>
            h('span', { class: 'ep-marker', style: playerStyle(p.color), title: p.name }),
          ),
      ),
    );
  return h(
    'div',
    { class: 'ep-track' },
    h(
      'div',
      { class: 'ep-track-head' },
      h('b', {}, MISSION_NAME[m]),
      h(
        'span',
        { class: 'muted', title: `${TILE_NAME[m]} (1 VP)` },
        holder === null
          ? `${TILE_NAME[m]}: —`
          : `${TILE_NAME[m]}: ${state.players[holder]?.name ?? ''}`,
      ),
    ),
    h('div', { class: 'ep-spaces' }, ...Array.from({ length: vps.length + 1 }, (_, i) => space(i))),
  );
}

const SHIP_ACTIONS: readonly string[] = [
  A.selectShip,
  A.extraMove,
  A.load,
  A.unload,
  A.swap,
  A.dropCrew,
  A.pickCrew,
  A.loadSpice,
  A.catchFish,
  A.deliver,
  A.chase,
];

function shipButton(state: GameState, a: Action, send: Send): HTMLElement {
  const c = field(a, 'cargo') as Cargo | undefined;
  const hex = field(a, 'hex') as string | undefined;
  switch (a.type) {
    case A.selectShip:
      return btn('Select', a, send, 'Moves are offered for the selected ship');
    case A.extraMove:
      return btn('+2 moves', a, send, 'Extra ship move: 1 sheep, once per ship per turn');
    case A.load:
      return btn(
        h('span', {}, 'Load ', icon(c ?? 'crew', 14)),
        a,
        send,
        `Load a ${CARGO_NAME[c ?? 'crew']}`,
      );
    case A.unload:
      return btn(
        h('span', {}, 'Unload ', icon(c ?? 'crew', 14)),
        a,
        send,
        `Unload a ${CARGO_NAME[c ?? 'crew']}`,
      );
    case A.swap:
      return btn(
        'Swap',
        a,
        send,
        `Swap: ${field(a, 'give')} to the harbor, ${field(a, 'take')} on board`,
      );
    case A.dropCrew:
      return btn(
        epSlice(state).lairs[hex as never] ? 'Crew to lair' : 'Befriend farm',
        a,
        send,
        epSlice(state).lairs[hex as never]
          ? 'Land a crew on the pirate lair (3 capture it)'
          : 'A crew stays on the spice farm',
      );
    case A.pickCrew:
      return btn('Pick up crew', a, send);
    case A.loadSpice:
      return btn('Load spice', a, send);
    case A.catchFish:
      return btn('Catch fish', a, send);
    case A.deliver:
      return btn('Deliver', a, send, 'Deliver fish and spice to the Council of Catan');
    case A.chase:
      return btn(
        'Chase pirate',
        a,
        send,
        'Roll a 6 (or your Pirate Bonus number) to chase it away',
      );
    default:
      return btn(a.type, a, send);
  }
}

function fleetBlock(state: GameState, view: HudView, send: Send): HTMLElement | null {
  const s = epSlice(state);
  const me = view.viewer;
  const ships = shipsOf(s, me);
  const color = state.players[me]?.color ?? '#888';
  const moving = s.turn.movement && state.turn.current === me && state.phase.kind === 'main';
  const harbors = (Object.keys(s.harbors) as (keyof typeof s.harbors)[]).filter(
    (v) => state.pieces.buildings[v]?.owner === me,
  );
  if (ships.length === 0 && harbors.length === 0) return null;
  const rows: Child[] = ships.map((ship: Ship, i) => {
    const acts = view.legal.filter(
      (a) => a.player === me && SHIP_ACTIONS.includes(a.type) && field(a, 'ship') === ship.id,
    );
    return h(
      'li',
      {
        class: `ep-ship${s.turn.selected === ship.id ? ' is-selected' : ''}`,
        style: playerStyle(color),
      },
      h('span', { class: 'ep-ship-name' }, icon('ship', 16, color), `Ship ${i + 1}`),
      h('span', { class: 'ep-cargo' }, ...cargoIcons(ship.cargo, color)),
      moving &&
        h('span', { class: 'ep-mp', title: 'Movement points left' }, `${mpLeft(state, ship)} MP`),
      acts.length > 0 &&
        h('span', { class: 'ep-acts' }, ...acts.map((a) => shipButton(state, a, send))),
    );
  });
  for (const [i, v] of harbors.entries()) {
    const dumps = mine(view, A.dump).filter((a) => field(a, 'vertex') === v);
    rows.push(
      h(
        'li',
        { class: 'ep-ship ep-harbor', style: playerStyle(color) },
        h('span', { class: 'ep-ship-name' }, '⚓', ` Harbor ${i + 1}`),
        h('span', { class: 'ep-cargo' }, ...cargoIcons(s.harbors[v] ?? [], color)),
        dumps.length > 0 &&
          h(
            'span',
            { class: 'ep-acts' },
            ...dumps.map((a) =>
              btn(
                h('span', {}, 'Return ', icon(field(a, 'cargo') as Cargo, 14)),
                a,
                send,
                'Back to your supply (to make room)',
              ),
            ),
          ),
      ),
    );
  }
  return h(
    'div',
    { class: 'ep-fleet' },
    h('div', { class: 'ep-sub' }, 'Your fleet'),
    h('ul', { class: 'ep-list' }, ...rows),
  );
}

function supplyBlock(state: GameState, view: HudView, send: Send): HTMLElement | null {
  const buys = mine(view, A.buyWithGold);
  const sells = mine(view, A.sellForGold);
  const fast = mine(view, A.fastGold);
  if (buys.length + sells.length + fast.length === 0) return null;
  const s = epSlice(state);
  const row = (title: string, list: Action[], note: string) =>
    list.length > 0 &&
    h(
      'div',
      { class: 'ep-trade' },
      h('span', { class: 'ep-trade-title', title: note }, title),
      h(
        'span',
        { class: 'ep-trade-btns' },
        ...list.map((a) => {
          const r = field(a, 'resource') as Resource;
          return h(
            'button',
            {
              class: 'ep-res',
              title: `${title}: ${RESOURCE_LABEL[r]}`,
              on: { click: () => send(a) },
            },
            resCardFace(r, 22),
          );
        }),
      ),
    );
  return h(
    'div',
    { class: 'ep-supply' },
    h('div', { class: 'ep-sub' }, 'Trade with the supply'),
    row(
      `Buy for 2 gold (${GOLD_BUYS - s.turn.goldBuys} left)`,
      buys,
      '2 gold for 1 resource, twice per turn',
    ),
    row('Sell 3 for 1 gold', sells, '3 cards of one resource for 1 gold'),
    row('Fast Gold: 1 for 1 gold', fast, 'Spice farm advantage'),
  );
}

function select(opts: readonly (readonly [string, string])[]): HTMLSelectElement {
  const el = h('select', { class: 'ep-select' });
  for (const [value, label] of opts) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    el.append(o);
  }
  return el;
}

/**
 * A one-line player offer form: "Offer [n] [good] for [n] [good] [Offer]". `goods` = [id, label];
 * `make(give, giveN, want, wantN)` builds the action (null: not a valid offer).
 */
export function offerForm(
  goods: readonly (readonly [string, string])[],
  want0: string,
  make: (give: string, giveN: number, want: string, wantN: number) => Action | null,
  send: Send,
): HTMLElement {
  const counts = [1, 2, 3].map((n) => [String(n), String(n)] as const);
  const giveN = select(counts);
  const give = select(goods);
  const wantN = select(counts);
  const want = select(goods);
  want.value = want0;
  const go = h('button', { class: 'btn btn-sm' }, 'Offer');
  go.addEventListener('click', () => {
    const a = make(give.value, Number(giveN.value), want.value, Number(wantN.value));
    if (a) send(a);
  });
  return h(
    'div',
    { class: 'ep-form' },
    h('b', {}, 'Offer'),
    giveN,
    give,
    h('span', {}, 'for'),
    wantN,
    want,
    go,
  );
}

/** Player offers with gold (`ep/offerTrade`; resource-only offers use the base trade dialog). */
function goldOfferBlock(state: GameState, view: HudView, send: Send): HTMLElement | null {
  if (mine(view, A.offerTrade).length === 0) return null;
  const me = view.viewer;
  const to = state.players.filter((p) => p.id !== me).map((p) => p.id);
  const goods = [
    ['gold', 'Gold'],
    ...RESOURCES.map((r) => [r, RESOURCE_LABEL[r]] as const),
  ] as const;
  const make = (give: string, giveN: number, want: string, wantN: number): Action | null => {
    if (give === want || (give !== 'gold' && want !== 'gold')) return null;
    const side = (g: string, n: number, gold: string) =>
      g === 'gold' ? { [gold]: n } : { [gold === 'giveGold' ? 'give' : 'want']: { [g]: n } };
    return {
      type: A.offerTrade,
      player: me,
      to,
      ...side(give, giveN, 'giveGold'),
      ...side(want, wantN, 'wantGold'),
    } as unknown as Action;
  };
  return h(
    'div',
    { class: 'ep-supply' },
    h('div', { class: 'ep-sub' }, 'Trade gold with players'),
    offerForm(goods, 'gold', make, send),
  );
}

// ---------------------------------------------------------------------------------------------
// Dialogs and the module
// ---------------------------------------------------------------------------------------------

function stealDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  if (state.phase.kind !== 'ep/pirateSteal') return null;
  const steals = mine(view, A.pirateSteal);
  if (steals.length === 0) return null;
  const phase = state.phase as PirateStealPhase;
  const s = epSlice(state);
  return {
    key: `ep-steal-${state.turn.number}-${state.log.length}`,
    title: 'Your pirates attack',
    modal: true,
    body: [
      h(
        'p',
        {},
        'Rob a player with a ship next to your pirate: a random card, or 1 gold from a player without cards.',
      ),
      ...phase.candidates.map((v) => {
        const p = state.players[v];
        const a = steals.find((x) => field(x, 'victim') === v);
        return h(
          'div',
          { class: 'ep-victim', style: playerStyle(p?.color ?? '#888') },
          h('b', {}, p?.name ?? `Player ${v + 1}`),
          h('span', { class: 'muted' }, ` ${s.gold[v] ?? 0} gold`),
          a && btn('Rob', a, send),
        );
      }),
    ],
  };
}

const left = (item: string) => (state: GameState, p: PlayerId) =>
  item === ITEM.harbor
    ? harborsLeft(state, p)
    : item === ITEM.ship
      ? shipsLeft(state, p)
      : item === ITEM.settler
        ? settlersLeft(state, p)
        : crewsLeft(state, p);

export const epHud: HudExtension = {
  id: 'ep',
  sounds: epSounds,

  cardFace: (kind, w) => (kind === 'gold' ? goldFace(w) : null),

  panel(state, view, send) {
    const row = SCENARIOS.find((r) => r.key === scenarioKey(state));
    const body = h('div', { class: 'ep-panel' }, h('p', { class: 'ep-goal' }, goalText(state)));
    const phase = phaseLine(state, view, send);
    if (phase) body.append(phase);
    body.append(playerRows(state));
    const fish = mine(view, A.rollFish)[0];
    if (fish)
      body.append(
        h(
          'div',
          { class: 'ep-actions' },
          btn(
            'Roll for fish',
            fish,
            send,
            'Once per turn: a haul appears on the shoal with that number',
          ),
        ),
      );
    for (const m of missionsOf(rulesOf(state))) body.append(trackBlock(state, m));
    const fleet = fleetBlock(state, view, send);
    if (fleet) body.append(fleet);
    const supply = supplyBlock(state, view, send);
    if (supply) body.append(supply);
    const offers = goldOfferBlock(state, view, send);
    if (offers) body.append(offers);
    return { title: row?.name ?? 'Explorers & Pirates', body };
  },

  offerExtras(state, side) {
    const g = goldOffer(state);
    const n = g ? (side === 'give' ? g.give : g.want) : 0;
    return n > 0
      ? [h('span', { class: 'bundle-item' }, icon('gold', 22, undefined, 'Gold'), `×${n}`)]
      : [];
  },

  buildCards: [
    {
      mode: 'ep/harbor',
      label: 'Harbor',
      actionType: A.buildHarbor,
      glyph: 'city',
      costItem: ITEM.harbor,
      left: left(ITEM.harbor),
      total: () => LIMIT.harbor,
      blocker: (state, p) => {
        if (harborsLeft(state, p) <= 0) return 'No harbor settlements left';
        const coastal = Object.entries(state.pieces.buildings).some(
          ([v, b]) =>
            b?.owner === p &&
            b.kind === 'settlement' &&
            !isHarbor(state, v as VertexId) &&
            isCoastal(state, v as VertexId),
        );
        return coastal ? null : 'No coastal settlement to upgrade';
      },
    },
    {
      mode: 'ep/ship',
      label: 'Ship',
      actionType: A.buildShip,
      glyph: 'ship',
      costItem: ITEM.ship,
      left: left(ITEM.ship),
      total: () => LIMIT.ship,
    },
    {
      mode: 'ep/settler',
      label: 'Settler',
      actionType: A.buildSettler,
      glyph: 'person',
      costItem: ITEM.settler,
      left: left(ITEM.settler),
      total: () => LIMIT.settler,
    },
    {
      mode: 'ep/crew',
      label: 'Crew',
      actionType: A.buildCrew,
      glyph: 'person',
      costItem: ITEM.crew,
      available: (state) => rulesOf(state).crews,
      left: left(ITEM.crew),
      total: () => LIMIT.crew,
    },
  ],

  dialog(state, view, _legal, send) {
    return stealDialog(state, view, send);
  },

  hint(state, view) {
    const can = (t: string) => mine(view, t).length > 0;
    switch (state.phase.kind) {
      case 'setup':
        if (isHarborStep(state, state.phase.index) && state.phase.step === 'settlement') {
          return 'Place your harbor settlement on a marked coastal corner';
        }
        return null;
      case 'ep/setupFleet':
        return can(A.setupRoad)
          ? 'Place a road at your settlement'
          : can(A.setupShip)
            ? 'Place your ship (with a settler) next to your harbor settlement'
            : null;
      case 'ep/pirate':
        return can(A.placePirate)
          ? 'Place your pirate ship on a sea hex away from the island'
          : null;
      case 'ep/pirateSteal':
        return 'Choose whom your pirates rob';
      case 'main': {
        if (state.turn.current !== view.viewer || !epSlice(state).turn.movement) return null;
        if (can(A.land))
          return 'Movement: sail, or click a highlighted corner to land your settler';
        if (can(A.moveShip)) return 'Movement: click a highlighted edge to sail there';
        if (can(A.selectShip)) return 'Movement: click one of your ships to sail it';
        return 'Movement phase: end your turn when done';
      }
      default:
        return null;
    }
  },

  handCards(state, view) {
    if (view.spectator) return [];
    const n = epSlice(state).gold[view.viewer] ?? 0;
    return [
      h('span', { class: 'hand-sep' }),
      h(
        'div',
        {
          class: `hcard rcard ep-hc${n === 0 ? ' is-zero' : n >= 3 ? ' stack-3' : n === 2 ? ' stack-2' : ''}`,
          title: `Gold: ${n}`,
          attrs: { 'data-card': 'gold' },
        },
        goldFace(46),
        h('span', { class: 'count-badge' }, String(n)),
      ),
    ];
  },

  impliedActions: [A.setupRoad, A.setupShip, A.placePirate, A.moveShip, A.selectShip, A.land],
  hideBaseCards: (state) => (citiesInPlay(state) ? [] : ['city']),
};
