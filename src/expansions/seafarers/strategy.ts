/**
 * Seafarers strategy for the smart bots (BotExtension.score / goals, src/bots/smart): ships
 * toward the best coastal spots (islands first when the scenario pays for new land), the
 * island bonus on settlements, gold picks, the pirate, and the scenario goals (wonders,
 * fortresses). Ships never move (moving one rarely beats building). Public information only.
 */
import {
  RESOURCES,
  costOf,
  isVertexOpen,
  touchesLand,
  type Action,
  type EdgeId,
  type ExpansionAction,
  type GameState,
  type HexId,
  type PlayerId,
  type ResourceBundle,
  type ResourceCounts,
  type VertexId,
} from '../../engine';
import { VP, baseScore, conflict, trade, type BotContext, type BotGoal } from '../../bots/smart';
import { areasAt } from './engine/effects';
import { graph, hexKind, isShipEdge } from './engine/geometry';
import { SHIP, nextToPirate, shipsLeft } from './engine/ships';
import { rulesOf, seaSlice } from './engine';

/** How far a ship plan looks (ships). */
const SHIP_REACH = 6;

/** Special VP a first settlement on `v` would bring (new island / bonus area). */
export function newLandVp(ctx: BotContext, v: VertexId): number {
  const { state, player } = ctx;
  const bonus = rulesOf(state).bonus;
  if (!bonus) return 0;
  const s = seaSlice(state);
  const mine = s.chits.filter((c) => c.player === player && c.area !== 'gift');
  if (bonus.cap !== undefined && mine.length >= bonus.cap) return 0;
  const home = s.home[player] ?? [];
  const fresh = areasAt(state, v).some((a) => !home.includes(a) && !mine.some((c) => c.area === a));
  // Setup settlements found home islands, they pay nothing.
  return fresh && state.phase.kind !== 'setup' ? bonus.vp : 0;
}

function shipEdgeFree(state: GameState, e: EdgeId): boolean {
  return (
    seaSlice(state).ships[e] === undefined &&
    state.pieces.roads[e] === undefined &&
    isShipEdge(state, e) &&
    !nextToPirate(state, e)
  );
}

/** Ship distance from the bot's buildings and free ship ends to vertices within SHIP_REACH. */
function shipDistance(ctx: BotContext): Map<VertexId, number> {
  return ctx.memo('sea:dist', () => {
    const { state, player } = ctx;
    const g = graph(state);
    const ships = seaSlice(state).ships;
    const dist = new Map<VertexId, number>();
    const queue: VertexId[] = [];
    const foreign = (v: VertexId) => {
      const b = state.pieces.buildings[v];
      return b !== undefined && b.owner !== player;
    };
    const start = (v: VertexId) => {
      if (dist.has(v) || foreign(v)) return;
      dist.set(v, 0);
      queue.push(v);
    };
    for (const [v, b] of Object.entries(state.pieces.buildings)) {
      if (b.owner === player) start(v as VertexId);
    }
    for (const [e, s] of Object.entries(ships) as [EdgeId, { owner: PlayerId }][]) {
      if (s.owner === player) for (const v of g.ends.get(e) ?? []) start(v);
    }
    for (let i = 0; i < queue.length; i++) {
      const v = queue[i] as VertexId;
      const d = dist.get(v) ?? 0;
      if (d >= SHIP_REACH) continue;
      for (const e of g.edgesAt.get(v) ?? []) {
        if (!shipEdgeFree(state, e)) continue;
        for (const w of g.ends.get(e) ?? []) {
          if (w === v || dist.has(w)) continue;
          dist.set(w, d + 1);
          if (!foreign(w)) queue.push(w);
        }
      }
    }
    return dist;
  });
}

interface SeaSpot {
  vertex: VertexId;
  ships: number;
  value: number;
}

/** Spots a ship route reaches (0 = at the end of a ship already), best first. */
function seaSpots(ctx: BotContext): SeaSpot[] {
  return ctx.memo('sea:spots', () => {
    const { state } = ctx;
    if (ctx.left('settlement') === 0) return [];
    const left = shipsLeft(state, ctx.player);
    const out: SeaSpot[] = [];
    for (const [v, d] of shipDistance(ctx)) {
      if (d > left) continue;
      if (!isVertexOpen(state, v) || !touchesLand(state, v)) continue;
      out.push({ vertex: v, ships: d, value: spotValue(ctx, v) });
    }
    return out.sort((a, b) => b.value - 12 * b.ships - (a.value - 12 * a.ships));
  });
}

function spotValue(ctx: BotContext, v: VertexId): number {
  return ctx.settlementValue(v) + 0.9 * VP * newLandVp(ctx, v);
}

/** Ship distance from `target` (over free ship edges). */
function distanceFrom(ctx: BotContext, target: VertexId): Map<VertexId, number> {
  return ctx.memo(`sea:from:${target}`, () => {
    const { state, player } = ctx;
    const g = graph(state);
    const dist = new Map<VertexId, number>([[target, 0]]);
    const queue: VertexId[] = [target];
    for (let i = 0; i < queue.length; i++) {
      const v = queue[i] as VertexId;
      const d = dist.get(v) ?? 0;
      if (d >= SHIP_REACH) continue;
      const b = state.pieces.buildings[v];
      if (v !== target && b !== undefined && b.owner !== player) continue;
      for (const e of g.edgesAt.get(v) ?? []) {
        const own = seaSlice(state).ships[e]?.owner === player;
        if (!own && !shipEdgeFree(state, e)) continue;
        for (const w of g.ends.get(e) ?? []) {
          if (w === v || dist.has(w)) continue;
          dist.set(w, d + 1);
          queue.push(w);
        }
      }
    }
    return dist;
  });
}

/** A new ship on `e`: a share of the best spot it brings closer, or the fog it may reveal. */
export function shipValue(ctx: BotContext, e: EdgeId): number {
  const ends = graph(ctx.state).ends.get(e) ?? [];
  let best = 0;
  for (const spot of seaSpots(ctx).slice(0, 4)) {
    const from = distanceFrom(ctx, spot.vertex);
    const after = Math.min(...ends.map((v) => from.get(v) ?? Infinity));
    if (after >= spot.ships) continue;
    const v = (spot.value - 12 * spot.ships) * (after === 0 ? 0.6 : 0.45 * 0.85 ** after);
    if (v > best) best = v;
  }
  const fog = (graph(ctx.state).sides.get(e) ?? []).some((h) => hexKind(ctx.state, h) === 'fog');
  return Math.max(best, fog ? 30 : -5);
}

/** Setup ship: toward the best spot within two ships. */
function setupShip(ctx: BotContext, e: EdgeId): number {
  const phase = ctx.state.phase;
  const from = phase.kind === 'setup' ? phase.lastSettlement : null;
  const g = graph(ctx.state);
  const far = (g.ends.get(e) ?? []).find((v) => v !== from);
  if (!far) return 0;
  let best = 0;
  for (const w of g.neighbors.get(far) ?? []) {
    if (w === from) continue;
    if (isVertexOpen(ctx.state, w) && touchesLand(ctx.state, w)) {
      best = Math.max(best, ctx.vertexValue(w) + 3 * newLandVp(ctx, w));
    }
  }
  // Same scale as the base setup road (setupRoad).
  return best;
}

function pirateHex(ctx: BotContext, h: HexId): number {
  const { state, player } = ctx;
  const g = graph(state);
  const ships = seaSlice(state).ships;
  let score = 0;
  for (const e of g.hexEdges.get(h) ?? []) {
    const owner = ships[e]?.owner;
    if (owner === undefined) continue;
    score += owner === player ? -8 : 3 * ctx.threat(owner) + (ctx.cards(owner) > 0 ? 2 : 0);
  }
  return score;
}

function bundle(x: unknown): ResourceBundle {
  return (x && typeof x === 'object' ? x : {}) as ResourceBundle;
}

export function seaScore(ctx: BotContext, action: Action): number | null {
  const a = action as Action & { edge?: EdgeId; hex?: HexId; victim?: PlayerId };
  switch (action.type) {
    case 'buildSettlement':
      if (action.type !== 'buildSettlement') return null;
      return (baseScore(ctx, action) ?? 0) + 0.9 * VP * newLandVp(ctx, action.vertex);
    case 'seafarers/buildShip':
      return a.edge
        ? shipValue(ctx, a.edge) - conflict(ctx, 'seafarers/ship', shipCost(ctx))
        : null;
    case 'seafarers/placeFreeShip':
      return a.edge ? shipValue(ctx, a.edge) + 30 : null;
    case 'seafarers/placeSetupShip':
      return a.edge ? setupShip(ctx, a.edge) : null;
    case 'seafarers/pickShip':
      return -30;
    case 'seafarers/cancelMove':
      return 0;
    case 'seafarers/moveShip':
      return a.edge ? shipValue(ctx, a.edge) : null;
    case 'seafarers/movePirate':
      return a.hex ? pirateHex(ctx, a.hex) : null;
    case 'seafarers/stealCard':
      return a.victim === undefined ? null : 10 * ctx.threat(a.victim) + ctx.cards(a.victim);
    case 'seafarers/stealCloth':
      return a.victim === undefined ? null : 10 * ctx.threat(a.victim) + 15;
    case 'seafarers/pickGold':
      return trade(ctx, {}, bundle((action as ExpansionAction)['resources']));
    case 'seafarers/placeHarbor':
      return 10 + ctx.rng.float();
    case 'seafarers/attackFortress':
      return 90;
    case 'seafarers/startWonder':
      return 1.2 * VP;
    case 'seafarers/buildWonder':
      return 1.5 * VP;
  }
  return null;
}

function shipCost(ctx: BotContext): ResourceCounts {
  return costOf(ctx.state, SHIP) ?? { brick: 0, lumber: 1, wool: 1, grain: 0, ore: 0 };
}

/**
 * The best spot a ship route reaches: its ships plus a settlement (a spot already at the end of
 * a ship is a plain settlement goal; the base plan only follows roads).
 */
export function seaGoals(ctx: BotContext): BotGoal[] {
  const spot = seaSpots(ctx)[0];
  if (!spot) return [];
  const ship = shipCost(ctx);
  const cost = { ...costOf(ctx.state, 'settlement') };
  for (const r of RESOURCES) cost[r] += ship[r] * spot.ships;
  const id = spot.ships === 0 ? 'settlement' : 'seafarers/ship';
  return [{ id, cost, value: spot.value - 8 * spot.ships }];
}
