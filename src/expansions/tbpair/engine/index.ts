/**
 * T&B scenario pairs (the ten 2025 sheets, docs/rules/traders-barbarians.md §8.1). Each scenario
 * plays as two T&B scenarios (`playsAs`), so T&B switches both features on; this module adds the
 * boards (maps.ts: Fishing with another; sheets.ts: the six others) and the sheets' changes.
 *
 * The six sheets without Fishing (docs/rules/combos.md §2d): T&B reads their static changes from
 * the board (`TbSheetRules`: start and bridge gold, no Poor Settler penalty, the wagon's river
 * crossing, BA's start hexes, barbarians by paths); this module adds the trade hexes' production
 * (quarry brick, glassworks lumber, castle wool), Barbarian Attack + T&B's barbarians
 * (barbarians.ts) and, there, knights and the wagon at the end of the turn in either order.
 *
 * Fishing pairs:
 * - Fishing + Rivers: 6 fish pay for a bridge;
 * - Fishing + T&B: no robber to chase, so 2 fish give the wagon 2 more MP (as 1 grain does);
 * - Fishing + BA: 2 fish let a knight move up to 5 paths (as 1 grain does); conquered buildings
 *   catch no fish (T&B's fish payout); no fish road on a conquered hex's edge (T&B's road rule);
 * - Fishing + Caravans: only the board (the lake beside the oasis, the 2 on the 12 hex).
 * Engine status per rule: docs/rules/combos.md §2c.
 */
import { fail, isCurrent, log, ok } from '../../../engine/actions/common';
import type {
  ExpansionModule,
  ExtHandler,
  ExtWrap,
  ScenarioDef,
} from '../../../engine/expansions/types';
import { playerName } from '../../../engine/rules/text';
import { hexVertices, topologyOf } from '../../../engine/topology';
import type { Action, EdgeId, GameState, PlayerId, Resource } from '../../../engine/types';
import { canSelectKnight, knightReach, knightTargets, knightsOf } from '../../tb/engine/ba';
import { isConqueredHex } from '../../tb/engine/conquest';
import { wagonSteps } from '../../tb/engine/traders';
import { addGold } from '../../tb/engine/common';
import { fishPayment } from '../../tb/engine/fish';
import { bridgeSiteBlocker } from '../../tb/engine/rivers';
import {
  baOf,
  BRIDGE_GOLD,
  fishOf,
  fishTotal,
  has,
  KNIGHT_STEPS_GRAIN,
  TB,
  tbBoard,
  tbSlice,
  tradersOf,
  WAGON_GRAIN_MP,
  hexHasNumber,
  type TbPhase,
  type TradeKind,
} from '../../tb/engine/state';
import {
  barbarianHex,
  barbarianLegal,
  barbarianPath,
  isBarbarianPhase,
  landOnRoll,
  pickBarbarian,
  withLanding,
  wrapBuyCard,
  wrapDriveOff,
  type BarbarianAction,
} from './barbarians';
import { FISH_PAIRS, mapIdOf, TBPAIR, TBPAIR_MAPS } from './maps';
import { SHEET_MAPS, SHEETS, sheetMapId } from './sheets';

export { TBPAIR, FISH_PAIRS } from './maps';
export { SHEETS, sheetMapId, type Sheet } from './sheets';
export {
  barbarianRefs,
  centreBarbarians,
  freePaths,
  hexPaths,
  pathBarbarians,
  type BarbarianAction,
  type BarbarianPhase,
} from './barbarians';

export const TBPAIR_MODE = 'tb+tb';
export const TBPAIR_SCENARIOS = [...FISH_PAIRS.map((p) => p.id), ...SHEETS.map((s) => s.id)];
export const FISH_BRIDGE = 6;
export const FISH_WAGON = 2;
export const FISH_KNIGHT = 2;

export type TbpairAction =
  | { type: 'tbpair/fishBridge'; player: PlayerId; edge: EdgeId }
  | { type: 'tbpair/fishWagon'; player: PlayerId }
  | { type: 'tbpair/fishKnight'; player: PlayerId; edge: EdgeId }
  | BarbarianAction;

const pn = playerName;
const fishOfPlayer = (s: GameState, p: PlayerId) => fishTotal(fishOf(s).hands[p] ?? []);

/** Pay `cost` fish with the smallest overpayment (T&B's rule). */
function spendFish(draft: GameState, p: PlayerId, cost: number): number {
  const s = fishOf(draft);
  const hand = s.hands[p] ?? [];
  const pay = fishPayment(hand, cost) ?? [];
  for (const t of pay) hand.splice(hand.indexOf(t), 1);
  s.spent.push(...pay);
  return fishTotal(pay);
}

/** Own turn, not in a special build phase or another player's paired turn. */
const ownTurn = (state: GameState, p: PlayerId) =>
  isCurrent(state, p) && state.turn.secondSettlerOf === undefined;

// ---------------------------------------------------------------------------------------------
// Fishing + Rivers: 6 fish for a bridge
// ---------------------------------------------------------------------------------------------

export function fishBridgeBlocker(state: GameState, p: PlayerId, e: unknown): string | null {
  if (!has(state, 'fish') || !has(state, 'rivers')) return 'not in this game';
  if (state.phase.kind !== 'main' || !ownTurn(state, p)) return 'build on your own turn';
  if (fishOfPlayer(state, p) < FISH_BRIDGE) return `needs ${FISH_BRIDGE} fish`;
  return bridgeSiteBlocker(state, p, e);
}

const fishBridge: ExtHandler = (draft, action) => {
  const e = action['edge'];
  const err = fishBridgeBlocker(draft, action.player, e);
  if (err) return fail(err);
  const p = action.player;
  const paid = spendFish(draft, p, FISH_BRIDGE);
  draft.pieces.roads[e as EdgeId] = p;
  const s = tbSlice(draft);
  if (s.rivers) s.rivers.bridges[e as EdgeId] = p;
  addGold(draft, p, BRIDGE_GOLD);
  log(draft, p, `${pn(draft, p)} paid ${paid} fish for a bridge (+${BRIDGE_GOLD} gold)`);
  return ok(draft);
};

// ---------------------------------------------------------------------------------------------
// Fishing + T&B: 2 fish for 2 more wagon MP
// ---------------------------------------------------------------------------------------------

export function fishWagonBlocker(state: GameState, p: PlayerId): string | null {
  if (!has(state, 'fish') || !has(state, 'traders')) return 'not in this game';
  if (state.phase.kind !== 'tb/wagon' || !isCurrent(state, p)) return 'while moving your wagon';
  const m = tradersOf(state).move;
  if (m.over) return 'the move is over';
  if (m.grain) return 'wheat or fish was paid for this move already';
  return fishOfPlayer(state, p) < FISH_WAGON ? `needs ${FISH_WAGON} fish` : null;
}

const fishWagon: ExtHandler = (draft, action) => {
  const err = fishWagonBlocker(draft, action.player);
  if (err) return fail(err);
  const m = tradersOf(draft).move;
  spendFish(draft, action.player, FISH_WAGON);
  m.grain = true;
  m.mp += WAGON_GRAIN_MP;
  log(draft, action.player, `${pn(draft, action.player)} paid fish for 2 more movement points`);
  return ok(draft);
};

// ---------------------------------------------------------------------------------------------
// Fishing + Barbarian Attack: 2 fish move a knight up to 5 paths
// ---------------------------------------------------------------------------------------------

/**
 * Paths the selected knight reaches only with the 2 fish (4-5 steps; with grain in hand the
 * grain move already reaches them: ours, so one click never means two things).
 */
export function fishKnightTargets(state: GameState, p: PlayerId): EdgeId[] {
  const phase = state.phase as unknown as TbPhase;
  if (phase.kind !== 'tb/knights' || phase.from === null || !isCurrent(state, p)) return [];
  if (!has(state, 'fish') || fishOfPlayer(state, p) < FISH_KNIGHT) return [];
  const plain = knightTargets(state, phase.from);
  return [...knightReach(state, phase.from, KNIGHT_STEPS_GRAIN).keys()].filter(
    (e) => !plain.has(e),
  );
}

const fishKnight: ExtHandler = (draft, action) => {
  const e = action['edge'] as EdgeId;
  if (!has(draft, 'ba')) return fail('not in this game');
  if (!fishKnightTargets(draft, action.player).includes(e)) {
    return fail('the knight cannot reach that path with fish');
  }
  const phase = draft.phase as unknown as Extract<TbPhase, { kind: 'tb/knights' }>;
  const from = phase.from as EdgeId;
  const s = baOf(draft);
  spendFish(draft, action.player, FISH_KNIGHT);
  Reflect.deleteProperty(s.knights, from);
  s.knights[e] = action.player;
  s.moved.push(e);
  phase.from = null;
  log(draft, action.player, `${pn(draft, action.player)} moved a knight (paid fish)`);
  return ok(draft);
};

// ---------------------------------------------------------------------------------------------
// The six other sheets: trade hexes that produce; BA + T&B's end of the turn
// ---------------------------------------------------------------------------------------------

/** What a trade hex produces on the sheets that number them. */
export const TRADE_YIELD: Readonly<Record<TradeKind, Resource>> = {
  quarry: 'brick',
  glassworks: 'lumber',
  castle: 'wool',
};

export const sheetOf = (state: GameState) => SHEETS.find((x) => x.id === state.settings.scenario);

/** Barbarian Attack + T&B: knights and the wagon both move at the end of the turn. */
const bothEndSteps = (state: GameState) => has(state, 'ba') && has(state, 'traders');

/** Start the other end-of-turn step from `kind` (knights after the wagon, or the other way). */
const fromEndStep =
  (kind: string): ExtWrap =>
  (draft, action, next) => {
    if (bothEndSteps(draft) && draft.phase.kind === kind && isCurrent(draft, action.player)) {
      draft.phase = { kind: 'main' };
    }
    return next(draft, action);
  };

function endStepLegal(state: GameState, out: Action[]): void {
  if (!bothEndSteps(state)) return;
  const p = state.turn.current;
  const k = state.phase.kind;
  if (k === 'tb/wagon') {
    for (const e of knightsOf(state, p)) {
      if (canSelectKnight(state, p, e)) {
        out.push({ type: 'tb/startKnights', player: p, edge: e } as unknown as Action);
      }
    }
  } else if (k === 'tb/knights' && tradersOf(state).move.steps === 0) {
    for (const x of wagonSteps(state, p)) {
      out.push({ type: 'tb/startWagon', player: p, vertex: x.vertex } as unknown as Action);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------------------------

function legal(state: GameState): Action[] {
  const p = state.turn.current;
  const out: Action[] = [];
  const act = (a: Record<string, unknown>) => out.push({ player: p, ...a } as unknown as Action);
  if (isBarbarianPhase(state.phase.kind)) return barbarianLegal(state);
  endStepLegal(state, out);
  if (!has(state, 'fish')) return out;
  if (has(state, 'rivers') && state.phase.kind === 'main') {
    for (const e of tbBoard(state).bridgeSites ?? []) {
      if (fishBridgeBlocker(state, p, e) === null) act({ type: 'tbpair/fishBridge', edge: e });
    }
  }
  if (fishWagonBlocker(state, p) === null) act({ type: 'tbpair/fishWagon' });
  for (const e of fishKnightTargets(state, p)) act({ type: 'tbpair/fishKnight', edge: e });
  return out;
}

const scenarios: ScenarioDef[] = [
  ...FISH_PAIRS.map((pair) => ({
    id: pair.id,
    name: pair.name,
    blurb: pair.blurb,
    players: { min: 3, max: 4 },
    maps: [mapIdOf(pair)],
    mapFor: () => mapIdOf(pair),
    vpToWin: pair.vp,
    playsAs: { [TB]: ['tb/fishermen', pair.other] },
  })),
  ...SHEETS.map((sheet) => ({
    id: sheet.id,
    name: sheet.name,
    blurb: sheet.blurb,
    players: { min: 3, max: 4 },
    maps: [sheetMapId(sheet)],
    mapFor: () => sheetMapId(sheet),
    vpToWin: sheet.vp,
    playsAs: { [TB]: sheet.pair },
  })),
];

export const tbpairModule: ExpansionModule = {
  id: TBPAIR,
  name: 'T&B scenario pairs',
  requires: [TB],
  before: [TB],
  players: { min: 3, max: 4 },
  maps: [...TBPAIR_MAPS, ...SHEET_MAPS],
  scenarios,
  modes: [
    {
      id: TBPAIR_MODE,
      name: 'T&B scenario pairs',
      blurb: 'The ten 2025 sheets: two T&B scenarios on one board',
      status: 'ready',
      expansions: [TBPAIR],
      scenarios: TBPAIR_SCENARIOS,
      players: { min: 3, max: 4 },
    },
  ],

  validate(settings) {
    return TBPAIR_SCENARIOS.includes(settings.scenario ?? '')
      ? null
      : 'T&B scenario pairs are played on their own scenarios';
  },

  actions: {
    'tbpair/fishBridge': fishBridge,
    'tbpair/fishWagon': fishWagon,
    'tbpair/fishKnight': fishKnight,
    'tbpair/barbarianPath': barbarianPath,
    'tbpair/barbarianHex': barbarianHex,
    'tbpair/pickBarbarian': pickBarbarian,
  },
  wraps: {
    'tb/buyCard': wrapBuyCard,
    'tb/driveOff': wrapDriveOff,
    'tb/startKnights': fromEndStep('tb/wagon'),
    'tb/startWagon': fromEndStep('tb/knights'),
  },
  overrides: {
    buildSettlement: (draft, action, next) => withLanding(draft, () => next(draft, action)),
    buildCity: (draft, action, next) => withLanding(draft, () => next(draft, action)),
  },
  legal,
  changesRoads: ['tbpair/fishBridge'],
  actors: (state) => (state.phase.kind.startsWith('tbpair/') ? [state.turn.current] : undefined),

  hooks: {
    onRoll: (draft, roll) => landOnRoll(draft, roll),

    production(state, roll, owed, ctx) {
      if (!sheetOf(state)?.tradeYield) return;
      const t = topologyOf(state);
      for (const x of tbBoard(state).tradeHexes ?? []) {
        if (!hexHasNumber(state, x.hex, roll) || x.hex === ctx.blocked) continue;
        if (isConqueredHex(state, x.hex)) continue;
        const r = TRADE_YIELD[x.kind];
        for (const v of hexVertices(t, x.hex)) {
          const b = state.pieces.buildings[v];
          const hand = b && owed[b.owner];
          if (hand) hand[r] += b.kind === 'city' ? ctx.cityYield : 1;
        }
      }
    },
  },
};
