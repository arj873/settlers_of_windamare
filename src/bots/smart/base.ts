/**
 * Base-game action scores for the smart bots (scale: context.ts). Returns null for an action it
 * has no opinion on (expansion actions; the bot falls back to a random pick among those).
 */
import {
  RESOURCES,
  costOf,
  isVertexOpen,
  subtractResources,
  addResources,
  touchesLand,
  type Action,
  type BaseAction,
  type EdgeId,
  type HexId,
  type PlayerId,
  type Resource,
  type ResourceBundle,
  type ResourceCounts,
  type VertexId,
} from '../../engine';
import { hexPips, hexResource, VP, type BotContext } from './context';

export const ROLL = 50;

export function baseScore(ctx: BotContext, action: Action): number | null {
  const a = action as BaseAction;
  switch (a.type) {
    case 'placeSetupSettlement':
      return setupSettlement(ctx, a.vertex);
    case 'placeSetupRoad':
      return setupRoad(ctx, a.edge);
    case 'rollDice':
      return ROLL;
    case 'endTurn':
    case 'passSpecialBuild':
      return 0;
    case 'buildCity':
      return ctx.cityValue(a.vertex) - conflict(ctx, 'city', costOf(ctx.state, 'city'));
    case 'buildSettlement':
      return (
        ctx.settlementValue(a.vertex) - conflict(ctx, 'settlement', costOf(ctx.state, 'settlement'))
      );
    case 'buildRoad':
      return roadScore(ctx, a.edge) - conflict(ctx, 'settlement', costOf(ctx.state, 'road'));
    case 'placeFreeRoad':
      return roadScore(ctx, a.edge) + 30;
    case 'buyDevCard':
      return ctx.devValue() - conflict(ctx, 'devCard', costOf(ctx.state, 'devCard'));
    case 'playKnight':
      return knight(ctx);
    case 'playRoadBuilding':
      return roadBuilding(ctx);
    case 'playYearOfPlenty':
      return yearOfPlenty(ctx, a.resources);
    case 'playMonopoly':
      return monopoly(ctx, a.resource);
    case 'discard':
      return ctx.handScore(subtractResources(ctx.hand, a.resources));
    case 'moveRobber':
      return robberHex(ctx, a.hex);
    case 'steal':
      return victim(ctx, a.victim);
    case 'bankTrade':
      return trade(ctx, { [a.give]: ctx.ratio(a.give) }, { [a.receive]: 1 }) - 1;
    case 'offerTrade':
      return ctx.params.offers ? 0.6 * trade(ctx, a.give, a.want) - 3 : -10;
    case 'acceptTrade':
      return accept(ctx);
    case 'rejectTrade':
      return 0;
    case 'confirmTrade':
      return 40 - 10 * ctx.threat(a.partner);
    case 'cancelTrade':
      return -5;
    case 'vetoMap':
      return ctx.rng.float();
    case 'eventGain':
      return trade(ctx, {}, { [a.resource]: 1 });
    case 'eventGive':
      return trade(ctx, { [a.resource]: 1 }, {}) - 5 * ctx.threat(a.to);
    case 'eventSteal':
      return a.victim === null ? 0 : victim(ctx, a.victim);
    case 'eventDamageRoad':
      return -roadScore(ctx, a.edge);
    case 'repairRoad':
      return 40;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Initial placement: weighted pips, resource and number spread, ports, and what round 1 lacks. */
export function setupSettlement(ctx: BotContext, v: VertexId): number {
  const { state, player } = ctx;
  const res = ctx.vertexResources(v);
  const have = new Set<string>();
  for (const [u, b] of Object.entries(state.pieces.buildings)) {
    if (b?.owner === player) for (const r of ctx.vertexResources(u as VertexId)) have.add(r);
  }
  let score = ctx.vertexValue(v);
  const kinds = new Set(res);
  score += 1.2 * kinds.size;
  for (const r of kinds) if (!have.has(r)) score += have.size > 0 ? 1.6 : 0;
  // Brick and lumber early: a start without either cannot expand.
  if (have.size > 0 && !have.has('brick') && !have.has('lumber')) {
    if (kinds.has('brick') || kinds.has('lumber')) score += 2;
  }
  const numbers = new Set(
    (ctx.topo.vertex[v]?.hexes ?? []).map((h) => state.board.hexes[h]?.token).filter((t) => t),
  );
  score += 0.3 * numbers.size;
  const port = state.board.ports.find((p) => p.vertices.includes(v));
  if (port) {
    if (port.kind === 'generic') score += 0.8;
    else {
      let pips = 0;
      for (const h of ctx.topo.vertex[v]?.hexes ?? []) {
        if (hexResource(state, h) === port.kind) pips += hexPips(state, h);
      }
      score += pips >= 4 ? 1.5 : 0.3;
    }
  }
  // A few spots further out keep the second settlement and the first roads useful.
  return score * 10 + 0.5 * futureSpots(ctx, v);
}

/** Open vertices two roads from `v`, by value: room to grow. */
function futureSpots(ctx: BotContext, v: VertexId): number {
  let best = 0;
  for (const w of twoAway(ctx, v)) {
    if (isVertexOpen(ctx.state, w) && touchesLand(ctx.state, w)) {
      best = Math.max(best, ctx.vertexValue(w));
    }
  }
  return best;
}

function twoAway(ctx: BotContext, v: VertexId): VertexId[] {
  const out = new Set<VertexId>();
  for (const n1 of ctx.topo.vertex[v]?.vertices ?? []) {
    for (const n2 of ctx.topo.vertex[n1]?.vertices ?? []) if (n2 !== v) out.add(n2);
  }
  return [...out];
}

/** A setup road toward the best open spot it leads to. */
export function setupRoad(ctx: BotContext, e: EdgeId): number {
  const phase = ctx.state.phase;
  const from = phase.kind === 'setup' ? phase.lastSettlement : null;
  const ends = ctx.topo.edge[e]?.vertices ?? [];
  const far = ends.find((v) => v !== from) ?? ends[0];
  if (!far) return 0;
  let best = 0;
  for (const w of ctx.topo.vertex[far]?.vertices ?? []) {
    if (w === from) continue;
    if (isVertexOpen(ctx.state, w) && touchesLand(ctx.state, w)) {
      best = Math.max(best, ctx.vertexValue(w) + 0.3 * ctx.portValue(w));
    }
  }
  return best + 0.1 * ctx.vertexValue(far);
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/**
 * What spending `cost` on something other than the bot's target costs it: the target's value
 * times how much further away it gets. Building the target itself costs nothing.
 */
export function conflict(ctx: BotContext, id: string, cost: ResourceBundle): number {
  const t = ctx.target();
  if (!t || t.id === id) return 0;
  const after = subtractResources(ctx.hand, cost);
  const delta = ctx.distance(t.cost, after) - ctx.distance(t.cost);
  return delta > 0 ? 0.35 * t.value * delta : 0;
}

function roadScore(ctx: BotContext, e: EdgeId): number {
  const toSpot = ctx.roadToSpotValue(e);
  const lr = ctx.longestRoadValue(e);
  const roadsLeft = ctx.left('road');
  // A road that leads nowhere: only to burn cards before a 7 or when nothing else is left to do.
  const idle = roadsLeft > 3 && totalCards(ctx.hand) > 7 ? 4 : -4;
  return Math.max(toSpot, lr, idle);
}

function totalCards(hand: ResourceCounts): number {
  return RESOURCES.reduce((s, r) => s + hand[r], 0);
}

// ---------------------------------------------------------------------------
// Dev cards
// ---------------------------------------------------------------------------

function knight(ctx: BotContext): number {
  const { state, player } = ctx;
  const blocked = (ctx.topo.hex[state.robber]?.vertices ?? []).some(
    (v) => state.pieces.buildings[v]?.owner === player,
  );
  const army = ctx.knightsToArmy() === 1 ? 2 * VP * 0.8 : 0;
  if (state.phase.kind === 'preRoll') {
    if (blocked) return ROLL + 30 + hexPips(state, state.robber) * 3;
    return army > 0 ? ROLL + 20 : ROLL - 20;
  }
  return Math.max(army, blocked ? 45 : 25);
}

function roadBuilding(ctx: BotContext): number {
  if (ctx.left('road') === 0) return -10;
  const spot = ctx.spots().find((s) => s.roads > 0 && s.roads <= 2);
  if (spot) return 70;
  return ctx.params.longestRoad ? 20 : 10;
}

function yearOfPlenty(ctx: BotContext, picks: readonly [Resource, Resource]): number {
  const gain: ResourceCounts = addResources(addResources(ctx.hand, { [picks[0]]: 1 }), {
    [picks[1]]: 1,
  });
  const delta = ctx.handScore(gain) - ctx.handScore(ctx.hand);
  // Hold it until it completes something: the most valuable goal it completes.
  let completes = 0;
  for (const g of ctx.goals()) {
    if (ctx.distance(g.cost, gain) === 0 && ctx.distance(g.cost) > 0) {
      completes = Math.max(completes, g.value);
    }
  }
  if (completes > 0) return 40 + 0.5 * completes + delta;
  return ctx.vp(ctx.player) >= ctx.vpToWin - 3 ? delta * 0.3 : -5;
}

function monopoly(ctx: BotContext, r: Resource): number {
  // Expected haul from public information: each hand split like its owner's production.
  let haul = 0;
  for (let p = 0; p < ctx.n; p++) {
    if (p === ctx.player) continue;
    const prod = ctx.production(p);
    const total = RESOURCES.reduce((s, x) => s + prod[x], 0);
    if (total > 0) haul += (ctx.cards(p) * prod[r]) / total;
  }
  const t = ctx.target();
  const need = t ? Math.max(0, t.cost[r] - ctx.hand[r]) : 0;
  if (haul < 2.5 || (need === 0 && haul < 4)) return -5;
  return 20 + 8 * Math.min(haul, 6) + 10 * Math.min(need, haul);
}

// ---------------------------------------------------------------------------
// Robber
// ---------------------------------------------------------------------------

export function robberHex(ctx: BotContext, h: HexId): number {
  const { state, player } = ctx;
  const pips = hexPips(state, h);
  let score = 0;
  let mine = false;
  let victims = 0;
  for (const v of ctx.topo.hex[h]?.vertices ?? []) {
    const b = state.pieces.buildings[v];
    if (!b) continue;
    const mult = b.kind === 'city' ? 2 : 1;
    if (b.owner === player) {
      mine = true;
      score -= pips * mult * 3;
    } else {
      score += pips * mult * ctx.threat(b.owner);
      if (ctx.cards(b.owner) > 0) victims += 1;
    }
  }
  if (mine) score -= 60;
  return score + (victims > 0 ? 4 : 0) - (pips === 0 ? 2 : 0);
}

function victim(ctx: BotContext, p: PlayerId): number {
  return 10 * ctx.threat(p) + Math.min(ctx.cards(p), 8);
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

/** How much better the bot's hand gets by giving `give` for `get`. */
export function trade(ctx: BotContext, give: ResourceBundle, get: ResourceBundle): number {
  for (const r of RESOURCES) if ((give[r] ?? 0) > ctx.hand[r]) return -100;
  const after = addResources(subtractResources(ctx.hand, give), get);
  return ctx.handScore(after) - ctx.handScore(ctx.hand);
}

/** Answer to another player's offer: accept when it helps and does not feed a leader. */
function accept(ctx: BotContext): number {
  const phase = ctx.state.phase;
  if (phase.kind !== 'trade') return -1;
  const { from, give, want } = phase.offer;
  if (ctx.params.guardLeader && ctx.dangerous(from)) return -50;
  // The offerer's `give` comes to us; we hand over `want`.
  const gain = trade(ctx, want, give);
  return gain - 4 - (ctx.params.guardLeader ? 2 * ctx.threat(from) : 0);
}
