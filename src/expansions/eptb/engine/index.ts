/**
 * Explorers & Pirates + Traders & Barbarians (the 2025 combination sheet, docs/rules/combos.md
 * §8): the Fishermen of Catan on the E&P starting island. The only T&B scenario the sheet
 * combines; the others are refused (§8: Rivers, Merchant Trains, Barbarian Attack, Traders &
 * Barbarians "only balanced with CATAN"; Friendly Robber and Harbors of Catan impossible). Event
 * Cards may be used for the numbers only (the `ep` module drops their events).
 *
 * T&B runs its Fishermen feature in this mode (`tb` state.ts MODE_FEATURES): fish from the
 * fishing grounds and the lake (settlement 1, harbor settlement 1), the 7-token hand, the old
 * boot, a fish for a setup settlement on a ground, and its fish uses that still apply (3 steal,
 * 4 a resource, 5 a road). This module adds the board (6 grounds where the sheet shows them, the
 * optional lake on the 12) and E&P's fish uses: 2 fish ignore the pirate, 5 fish a free ship
 * (or road), 7 fish move a ship a second time. Fish are no resource cards, so a player who got
 * only fish takes E&P's 1 gold (ep's compensation counts resource cards only).
 *
 * Composition order (`before`): eptb, tb, ep. No first-wins hook is shared: T&B's and E&P's
 * afterProduction both return nothing (fish, then gold).
 */
import { fail, log, ok } from '../../../engine/actions/common';
import { cloneJson, doubledToHexId } from '../../../engine/expansions/ext';
import type { ExpansionModule, ExtHandler } from '../../../engine/expansions/types';
import { cornerVertex, parseHexId, type Corner } from '../../../engine/hex';
import type { Rng } from '../../../engine/rng';
import { playerName } from '../../../engine/rules/text';
import type {
  Action,
  EdgeId,
  GameState,
  HexId,
  PlayerId,
  Terrain,
  VertexId,
} from '../../../engine/types';
import { EP, epSlice, shipTurn, shipTurnDraft } from '../../ep/engine';
import {
  inMovement,
  newShipSpots,
  placeShip,
  whyAction,
  whyMovement,
  whyShipSpot,
} from '../../ep/engine/actions';
import { shipById, shipsOf } from '../../ep/engine/ships';
import { LAKE, TB, fishOf, fishTotal, has, type FishingGround } from '../../tb/engine';
import { fishPayment } from '../../tb/engine/fish';

export const EPTB = 'eptb';
export const EPTB_MODE = 'ep+tb';

/** Every 3-4 player E&P scenario: the grounds and the lake lie on the common starting island. */
export const EPTB_SCENARIOS = [
  'ep/landHo',
  'ep/pirateLairs',
  'ep/fish',
  'ep/spices',
  'ep/full',
] as const;

/** The fishing grounds' numbers (T&B's six tiles), dealt at random to the six places. */
export const GROUND_NUMBERS = [4, 5, 6, 8, 9, 10] as const;
/** The lake's numbers (T&B). */
export const LAKE_NUMBERS = [2, 3, 11, 12] as const;

/**
 * The six places of the sheet's diagram, on the island's west coast (doubled coordinates, p = 1):
 * each ground touches a notch between two coastal hexes and the two coastal corners beside it.
 */
// prettier-ignore
const GROUNDS: readonly (readonly [number, number, Corner])[][] = [
  [[3, 0, 'NE'], [3, 0, 'N'], [5, 0, 'N']],
  [[3, 0, 'SW'], [3, 0, 'NW'], [2, 1, 'NW']],
  [[1, 2, 'SW'], [1, 2, 'NW'], [0, 3, 'NW']],
  [[0, 3, 'S'], [0, 3, 'SW'], [1, 4, 'SW']],
  [[2, 5, 'S'], [2, 5, 'SW'], [3, 6, 'SW']],
  [[3, 6, 'SE'], [3, 6, 'S'], [5, 6, 'S']],
];

const hexAt = (c: number, r: number): HexId => doubledToHexId(c, r, 1);
const at = (c: number, r: number, k: Corner): VertexId =>
  cornerVertex(parseHexId(hexAt(c, r)).q, r, k);

export const GROUND_PLACES: readonly VertexId[][] = GROUNDS.map((g) =>
  g.map(([c, r, k]) => at(c, r, k)),
);

/** The island hex with the 12 disc: the lake goes there (the disc goes back to the box). */
export const LAKE_HEX: HexId = hexAt(2, 3);

/** The E&P fish uses of this combination (T&B's 2 and 7 have nothing to act on in E&P). */
export type EpFishUse = 'pirate' | 'ship' | 'secondMove';
export const EP_FISH_COST: Readonly<Record<EpFishUse, number>> = {
  pirate: 2,
  ship: 5,
  secondMove: 7,
};
export const EP_FISH_USES: readonly EpFishUse[] = ['pirate', 'ship', 'secondMove'];

export interface EptbSlice {
  v: 1;
  /** Players who paid 2 fish to ignore the pirate this turn. */
  freePassage: PlayerId[];
}

export type EptbAction =
  | { type: 'eptb/fish'; player: PlayerId; use: 'pirate' | 'secondMove'; ship?: number }
  | { type: 'eptb/fishShip'; player: PlayerId; edge: EdgeId; replace?: number };

export const eptbSlice = (state: Pick<GameState, 'ext'>): EptbSlice => state.ext[EPTB] as EptbSlice;

const pn = playerName;
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isEdge = (x: unknown): x is EdgeId => typeof x === 'string' && x.startsWith('e:');
const lakeOn = (state: Pick<GameState, 'settings'>) =>
  state.settings.options[EPTB]?.['lake'] !== false;

// ---------------------------------------------------------------------------------------------
// The board (init)
// ---------------------------------------------------------------------------------------------

function setUpBoard(draft: GameState, rng: Rng): void {
  const numbers = rng.shuffle([...GROUND_NUMBERS]);
  const grounds: FishingGround[] = GROUND_PLACES.map((vertices, i) => ({
    number: numbers[i] as number,
    vertices: [...vertices],
  }));
  let hexes = draft.board.hexes;
  const lakes: { hex: HexId; numbers: number[] }[] = [];
  const tile = hexes[LAKE_HEX];
  if (lakeOn(draft) && tile) {
    // "Remove 1 mountain hex before building the starting island": the 12's own terrain moves
    // to a mountain of the island when the 12 is not a mountain itself.
    const moved = tile.terrain;
    if (moved !== 'ore') {
      const mountains = (Object.keys(hexes) as HexId[])
        .filter((h) => h !== LAKE_HEX && hexes[h]?.terrain === 'ore')
        .sort();
      const m = mountains.length > 0 ? rng.pick(mountains) : undefined;
      const mt = m ? hexes[m] : undefined;
      if (m && mt) hexes = { ...hexes, [m]: { ...mt, terrain: moved } };
    }
    hexes = { ...hexes, [LAKE_HEX]: { ...tile, terrain: LAKE as Terrain, token: null } };
    lakes.push({ hex: LAKE_HEX, numbers: [...LAKE_NUMBERS] });
  }
  draft.board = {
    ...draft.board,
    hexes,
    ext: { ...draft.board.ext, [TB]: { grounds, lakes } },
  };
}

// ---------------------------------------------------------------------------------------------
// The E&P fish uses
// ---------------------------------------------------------------------------------------------

const fishHeld = (state: GameState, p: PlayerId) => fishTotal(fishOf(state).hands[p] ?? []);

/** A ship of `p` that has sailed this turn and may sail once more (7 fish). */
function movedShip(state: GameState, p: PlayerId, id: unknown): string | null {
  if (!isInt(id)) return 'pick a ship';
  const ship = shipById(epSlice(state), id);
  if (!ship || ship.owner !== p) return 'not your ship';
  const t = shipTurn(epSlice(state), id);
  return t.used > 0 || t.done ? null : 'that ship has not sailed yet this turn';
}

/** Why `p` may not use fish for `use` now (the target of the use included). */
export function epFishBlocker(
  state: GameState,
  p: PlayerId,
  a: Record<string, unknown>,
): string | null {
  const use = a['use'];
  if (!EP_FISH_USES.includes(use as EpFishUse)) return 'invalid use';
  if (state.phase.kind !== 'main' || state.turn.current !== p) return 'fish are used on your turn';
  if (state.turn.secondSettlerOf !== undefined) return 'not your turn';
  const cost = EP_FISH_COST[use as EpFishUse];
  if (fishHeld(state, p) < cost) return `needs ${cost} fish`;
  switch (use as EpFishUse) {
    case 'pirate': {
      const pirate = epSlice(state).pirate;
      if (!pirate || pirate.owner === p) return 'no opponent’s pirate to ignore';
      return eptbSlice(state).freePassage.includes(p) ? 'you already ignore the pirate' : null;
    }
    case 'ship': {
      const w = whyAction(state, p);
      if (w) return w;
      if (!isEdge(a['edge'])) return 'pick an edge at your harbor';
      const r = a['replace'];
      if (r !== undefined && !isInt(r)) return 'invalid ship';
      return whyShipSpot(state, p, a['edge'], r);
    }
    case 'secondMove':
      return whyMovement(state, p) ?? movedShip(state, p, a['ship']);
  }
}

/** `eptb/fish` (the pirate, a second move) and `eptb/fishShip` (a board click: its edge). */
const fishHandler =
  (ship: boolean): ExtHandler =>
  (draft, action) => {
    if (!ship && action['use'] === 'ship') return fail('a ship for fish is eptb/fishShip');
    return useFish(draft, ship ? { ...action, use: 'ship' } : action);
  };

const useFish: ExtHandler = (draft, action) => {
  const err = epFishBlocker(draft, action.player, action);
  if (err) return fail(err);
  const p = action.player;
  const use = action['use'] as EpFishUse;
  // Pay with whole tokens, the smallest overpayment (as T&B's own uses).
  const f = fishOf(draft);
  const hand = f.hands[p] ?? [];
  const paid = fishPayment(hand, EP_FISH_COST[use]) ?? [];
  for (const t of paid) hand.splice(hand.indexOf(t), 1);
  f.spent.push(...paid);
  const s = epSlice(draft);
  switch (use) {
    case 'pirate':
      eptbSlice(draft).freePassage.push(p);
      for (const ship of shipsOf(s, p)) shipTurnDraft(s, ship.id).tribute = true;
      log(
        draft,
        p,
        `${pn(draft, p)} paid ${fishTotal(paid)} fish: no tribute to the pirate this turn`,
      );
      break;
    case 'ship':
      log(draft, p, `${pn(draft, p)} paid ${fishTotal(paid)} fish for a ship`);
      placeShip(draft, p, action['edge'] as EdgeId, action['replace'] as number | undefined);
      break;
    case 'secondMove': {
      const id = action['ship'] as number;
      const t = shipTurnDraft(s, id);
      t.used = 0;
      t.done = false;
      s.turn.selected = id;
      log(draft, p, `${pn(draft, p)} paid ${fishTotal(paid)} fish to sail a ship again`);
      break;
    }
  }
  return ok(draft);
};

function legal(state: GameState): Action[] {
  if (!has(state, 'fish') || state.phase.kind !== 'main') return [];
  const p = state.turn.current;
  const out: Action[] = [];
  const add = (x: Record<string, unknown>) => {
    if (epFishBlocker(state, p, x) !== null) return;
    const { use, ...rest } = x;
    out.push(
      (use === 'ship'
        ? { type: 'eptb/fishShip', player: p, ...rest }
        : { type: 'eptb/fish', player: p, ...x }) as Action,
    );
  };
  add({ use: 'pirate' });
  if (!inMovement(state) && fishHeld(state, p) >= EP_FISH_COST.ship) {
    for (const [edge, replace] of newShipSpots(state, p)) {
      add(replace === undefined ? { use: 'ship', edge } : { use: 'ship', edge, replace });
    }
  }
  if (inMovement(state)) {
    for (const ship of shipsOf(epSlice(state), p)) add({ use: 'secondMove', ship: ship.id });
  }
  return out;
}

/** T&B's free road is building: the Action phase only (no building in the Movement phase). */
const roadInMovement = (state: GameState, a: Record<string, unknown>) =>
  a['type'] === 'tb/fish' && a['use'] === 'road' && inMovement(state);

export const eptbModule: ExpansionModule = {
  id: EPTB,
  name: 'Explorers & Pirates + Traders & Barbarians',
  requires: [TB, EP],
  before: [TB, EP],
  players: { min: 3, max: 4 },
  modes: [
    {
      id: EPTB_MODE,
      name: 'Explorers & Pirates + Fishermen',
      blurb: 'Fishing grounds and a lake on the explorers’ island; fish pay for ships',
      status: 'ready',
      expansions: [EPTB],
      scenarios: EPTB_SCENARIOS,
      players: { min: 3, max: 4 },
    },
  ],
  options: [
    {
      key: 'lake',
      label: 'Lake',
      description: 'The lake replaces the 12 of the island (a mountain goes back to the box)',
      type: 'boolean',
      default: true,
    },
  ],

  validate(settings) {
    if (!EPTB_SCENARIOS.includes(settings.scenario as (typeof EPTB_SCENARIOS)[number])) {
      return 'Explorers & Pirates + Traders & Barbarians is played on the 3-4 player E&P scenarios';
    }
    if (settings.options[TB]?.['harbormaster'] === true) {
      return 'Harbors of Catan: there are no harbors in Explorers & Pirates';
    }
    if (settings.robberMode === 'friendly') {
      return 'The Friendly Robber: there is no robber in Explorers & Pirates';
    }
    return null;
  },

  init(draft, rng) {
    draft.ext[EPTB] = { v: 1, freePassage: [] } satisfies EptbSlice;
    setUpBoard(draft, rng);
  },
  cloneExt: (slice) => cloneJson(slice),

  actions: { 'eptb/fish': fishHandler(false), 'eptb/fishShip': fishHandler(true) },
  wraps: {
    'tb/fish': (draft, action, next) =>
      roadInMovement(draft, action)
        ? fail('no building in the Movement phase')
        : next(draft, action),
  },
  legal,
  filterLegal: (state, actions) =>
    actions.filter((a) => !roadInMovement(state, a as unknown as Record<string, unknown>)),

  hooks: {
    onStartTurn(draft) {
      eptbSlice(draft).freePassage = [];
    },
    afterAction(draft) {
      // Ships built after the 2 fish were paid sail past the pirate too.
      const p = draft.turn.current;
      if (!eptbSlice(draft).freePassage.includes(p)) return;
      const s = epSlice(draft);
      for (const ship of shipsOf(s, p)) {
        if (!shipTurn(s, ship.id).tribute) shipTurnDraft(s, ship.id).tribute = true;
      }
    },
  },
};
