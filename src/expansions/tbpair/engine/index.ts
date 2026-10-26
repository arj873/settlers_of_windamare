/**
 * T&B scenario pairs (the 2025 sheets, docs/rules/traders-barbarians.md §8.1): Fishing on Catan
 * with Rivers, Traders & Barbarians, Barbarian Attack or the Caravans, on T&B's own boards
 * (maps.ts). Each scenario plays as two T&B scenarios (`playsAs`), so T&B switches both features
 * on; this module adds only the sheets' changes:
 * - Fishing + Rivers: 6 fish pay for a bridge;
 * - Fishing + T&B: no robber to chase, so 2 fish give the wagon 2 more MP (as 1 grain does);
 * - Fishing + BA: 2 fish let a knight move up to 5 paths (as 1 grain does); conquered buildings
 *   catch no fish (T&B's fish payout); no fish road on a conquered hex's edge (T&B's road rule);
 * - Fishing + Caravans: only the board (the lake beside the oasis, the 2 on the 12 hex).
 * Engine status per rule: docs/rules/combos.md §2c.
 */
import { fail, isCurrent, log, ok } from '../../../engine/actions/common';
import type { ExpansionModule, ExtHandler, ScenarioDef } from '../../../engine/expansions/types';
import { playerName } from '../../../engine/rules/text';
import type { Action, EdgeId, GameState, PlayerId } from '../../../engine/types';
import { knightReach, knightTargets } from '../../tb/engine/ba';
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
  type TbPhase,
} from '../../tb/engine/state';
import { FISH_PAIRS, mapIdOf, TBPAIR, TBPAIR_MAPS } from './maps';

export { TBPAIR, FISH_PAIRS } from './maps';

export const TBPAIR_MODE = 'tb+tb';
export const TBPAIR_SCENARIOS = FISH_PAIRS.map((p) => p.id);
export const FISH_BRIDGE = 6;
export const FISH_WAGON = 2;
export const FISH_KNIGHT = 2;

export type TbpairAction =
  | { type: 'tbpair/fishBridge'; player: PlayerId; edge: EdgeId }
  | { type: 'tbpair/fishWagon'; player: PlayerId }
  | { type: 'tbpair/fishKnight'; player: PlayerId; edge: EdgeId };

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
  if (m.grain) return 'grain or fish was paid for this move already';
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
// The module
// ---------------------------------------------------------------------------------------------

function legal(state: GameState): Action[] {
  const p = state.turn.current;
  const out: Action[] = [];
  const act = (a: Record<string, unknown>) => out.push({ player: p, ...a } as unknown as Action);
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

const scenarios: ScenarioDef[] = FISH_PAIRS.map((pair) => ({
  id: pair.id,
  name: pair.name,
  blurb: pair.blurb,
  players: { min: 3, max: 4 },
  maps: [mapIdOf(pair)],
  mapFor: () => mapIdOf(pair),
  vpToWin: pair.vp,
  playsAs: { [TB]: ['tb/fishermen', pair.other] },
}));

export const tbpairModule: ExpansionModule = {
  id: TBPAIR,
  name: 'T&B scenario pairs',
  requires: [TB],
  before: [TB],
  players: { min: 3, max: 4 },
  maps: TBPAIR_MAPS,
  scenarios,
  modes: [
    {
      id: TBPAIR_MODE,
      name: 'T&B scenario pairs',
      blurb: 'Fishing on Catan with Rivers, the wagons, Barbarian Attack or the camels',
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
  },
  legal,
  changesRoads: ['tbpair/fishBridge'],
};
