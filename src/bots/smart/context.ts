/**
 * What a smart bot knows when it decides: the game seen from its own seat. It reads public
 * information plus its own hand only (other hands through `handCount`), so it decides the same on
 * a full state and on `viewFor(state, player)` (smart.test.ts checks it). Board and plan
 * evaluations are cached for the one decision a context lives for.
 *
 * Score scale (shared with the modules' `BotExtension.score`): 100 ≈ one VP gained now; ending
 * the turn is 0; a roll is 50. Production is worth PIP_VALUE per pip (a 12-pip city ≈ 170).
 */
import {
  LARGEST_ARMY_MIN,
  LONGEST_ROAD_MIN,
  RESOURCES,
  bankTradeRatio,
  buildingsOf,
  costOf,
  edgeTouchesLand,
  handCount,
  isResource,
  isVertexOpen,
  longestRoadLength,
  piecesLeft,
  portsOf,
  publicVictoryPoints,
  roadsOf,
  tokenPips,
  topologyOf,
  touchesLand,
  victoryPoints,
  type EdgeId,
  type GameState,
  type HexId,
  type PlayerId,
  type Resource,
  type ResourceCounts,
  type Rng,
  type Topology,
  type VertexId,
} from '../../engine';
import type { BotExtension } from '../expansions';

export const PIP_VALUE = 6;
/** One VP gained now. */
export const VP = 100;

export interface SmartParams {
  /** Relative score noise per option (0 = always the best option). */
  noise: number;
  /** Race for Longest Road (roads that extend the longest trail when the award is near). */
  longestRoad: boolean;
  /** Refuse trades that help a player close to winning, and confirm with the weakest accepter. */
  guardLeader: boolean;
  /** Offer player trades at all. */
  offers: boolean;
  /** Plan with production rates (rounds to afford a goal) instead of missing cards only. */
  rates: boolean;
  /** Tuning knobs (bench experiments); absent = the defaults below. */
  dev?: number;
  overLimit?: number;
}

/** Something a bot saves for. Modules add their own (BotExtension.goals). */
export interface BotGoal {
  /** 'city' | 'settlement' | 'devCard' | 'road', or '<module>/<name>'. */
  id: string;
  /** Resource cards it costs (settlement goals include the roads leading to the spot). */
  cost: ResourceCounts;
  /** Score-scale value once built (see the header). */
  value: number;
}

export interface Spot {
  vertex: VertexId;
  /** Roads still needed to reach it (0 = buildable now). */
  roads: number;
  value: number;
}

const ZERO: ResourceCounts = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
/** How far a road plan looks (roads). */
const REACH = 4;

/** Terrain → the resource it yields; gold counts as the most wanted one. */
export function hexResource(state: GameState, h: HexId): Resource | 'gold' | null {
  const t = state.board.hexes[h]?.terrain;
  if (t === undefined) return null;
  if (isResource(t)) return t;
  return t === 'gold' ? 'gold' : null;
}

export function hexPips(state: GameState, h: HexId): number {
  const tok = state.board.hexes[h]?.token;
  return typeof tok === 'number' ? tokenPips(tok) : 0;
}

export class BotContext {
  readonly topo: Topology;
  readonly n: number;
  readonly hand: ResourceCounts;
  private readonly cache = new Map<string, unknown>();

  constructor(
    readonly state: GameState,
    readonly player: PlayerId,
    readonly params: SmartParams,
    readonly rng: Rng,
    readonly extensions: readonly BotExtension[] = [],
  ) {
    this.topo = topologyOf(state);
    this.n = state.players.length;
    this.hand = state.players[player]?.resources ?? ZERO;
  }

  /** Memoize `f` under `key` for this decision. */
  memo<T>(key: string, f: () => T): T {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const v = f();
    this.cache.set(key, v);
    return v;
  }

  // -------------------------------------------------------------------------
  // Players
  // -------------------------------------------------------------------------

  /** VP as this bot sees them: its own in full, others' public ones. */
  vp(p: PlayerId): number {
    return this.memo(`vp:${p}`, () =>
      p === this.player ? victoryPoints(this.state, p) : publicVictoryPoints(this.state, p),
    );
  }

  get vpToWin(): number {
    return this.state.settings.vpToWin;
  }

  /** The opponent with the most (visible) VP, null if nobody leads the bot. */
  get leader(): PlayerId | null {
    return this.memo('leader', () => {
      let best: PlayerId | null = null;
      for (let p = 0; p < this.n; p++) {
        if (p === this.player) continue;
        if (best === null || this.vp(p) > this.vp(best)) best = p;
      }
      return best;
    });
  }

  /** How dangerous `p` is (≥ 1): VP, lead over the bot, closeness to winning. */
  threat(p: PlayerId): number {
    if (p === this.player) return 0;
    const vp = this.vp(p);
    const lead = Math.max(0, vp - this.vp(this.player));
    return 1 + 0.15 * vp + 0.35 * lead + (vp >= this.vpToWin - 2 ? 1.5 : 0);
  }

  /** `p` is close enough to winning that feeding them is a mistake. */
  dangerous(p: PlayerId): boolean {
    const vp = this.vp(p);
    return vp >= this.vpToWin - 2 || vp >= this.vp(this.player) + 3;
  }

  cards(p: PlayerId): number {
    return handCount(this.state, p);
  }

  /** The bot's unplaced pieces of a kind. */
  left(kind: 'road' | 'settlement' | 'city'): number {
    return this.memo('left', () => piecesLeft(this.state, this.player))[kind];
  }

  // -------------------------------------------------------------------------
  // Board values
  // -------------------------------------------------------------------------

  /** Pips on the board per resource (for scarcity). */
  get boardPips(): ResourceCounts {
    return this.memo('boardPips', () => {
      const out = { ...ZERO };
      for (const h of this.topo.landHexes) {
        const r = hexResource(this.state, h);
        if (r && r !== 'gold') out[r] += hexPips(this.state, h);
      }
      return out;
    });
  }

  /** How much the bot wants a resource card (≈ 1): game stage, scarcity, its own production. */
  weight(r: Resource): number {
    return this.memo(`w:${r}`, () => {
      const vp = this.vp(this.player);
      const early = vp < 5;
      const stage: Record<Resource, number> = early
        ? { brick: 1.15, lumber: 1.15, wool: 0.85, grain: 1.0, ore: 0.9 }
        : { brick: 0.85, lumber: 0.85, wool: 0.85, grain: 1.15, ore: 1.2 };
      const pips = this.boardPips;
      const total = RESOURCES.reduce((s, x) => s + pips[x], 0);
      const avg = total / RESOURCES.length || 1;
      const scarcity = pips[r] > 0 ? Math.min(1.4, Math.max(0.75, (avg / pips[r]) ** 0.4)) : 1.4;
      return stage[r] * scarcity;
    });
  }

  /** Value of one pip of a hex's yield (gold = the best resource). */
  private yieldWeight(r: Resource | 'gold'): number {
    if (r !== 'gold') return this.weight(r);
    return Math.max(...RESOURCES.map((x) => this.weight(x))) * 1.1;
  }

  /** Weighted pips around a vertex (the robber's hex counts less). */
  vertexValue(v: VertexId): number {
    return this.memo(`vv:${v}`, () => {
      let sum = 0;
      for (const h of this.topo.vertex[v]?.hexes ?? []) {
        const r = hexResource(this.state, h);
        if (!r) continue;
        const pips = hexPips(this.state, h);
        sum += pips * this.yieldWeight(r) * (h === this.state.robber ? 0.6 : 1);
      }
      return sum;
    });
  }

  /** Resources (and gold) a vertex touches. */
  vertexResources(v: VertexId): (Resource | 'gold')[] {
    const out: (Resource | 'gold')[] = [];
    for (const h of this.topo.vertex[v]?.hexes ?? []) {
      const r = hexResource(this.state, h);
      if (r && hexPips(this.state, h) > 0) out.push(r);
    }
    return out;
  }

  /** Pips per resource `p` collects (cities twice, the robber's hex not at all). */
  production(p: PlayerId): ResourceCounts {
    return this.memo(`prod:${p}`, () => {
      const out = { ...ZERO };
      for (const [v, b] of Object.entries(this.state.pieces.buildings)) {
        if (!b || b.owner !== p) continue;
        const mult = b.kind === 'city' ? 2 : 1;
        for (const h of this.topo.vertex[v as VertexId]?.hexes ?? []) {
          if (h === this.state.robber) continue;
          const r = hexResource(this.state, h);
          const pips = hexPips(this.state, h) * mult;
          if (r === 'gold') for (const x of RESOURCES) out[x] += pips / RESOURCES.length;
          else if (r) out[r] += pips;
        }
      }
      return out;
    });
  }

  /** Expected cards of `r` per round (every player rolls once). */
  rate(r: Resource): number {
    return (this.production(this.player)[r] / 36) * this.n;
  }

  ratio(r: Resource): number {
    return this.memo(`ratio:${r}`, () => bankTradeRatio(this.state, this.player, r));
  }

  // -------------------------------------------------------------------------
  // Hands and goals
  // -------------------------------------------------------------------------

  /**
   * Cards still missing for `cost` with `hand`: a card the bank can supply from the surplus
   * (at the bot's ratio) counts half, since the trade costs cards too.
   */
  distance(cost: ResourceCounts, hand: ResourceCounts = this.hand): number {
    let missing = 0;
    let tradeable = 0;
    for (const r of RESOURCES) {
      const d = cost[r] - hand[r];
      if (d > 0) missing += d;
      else tradeable += Math.floor(-d / this.ratio(r));
    }
    const viaBank = Math.min(missing, tradeable);
    return missing - viaBank + 0.5 * viaBank;
  }

  /** Rounds until `cost` is affordable from production (+ trades), ~0 when affordable now. */
  rounds(cost: ResourceCounts, hand: ResourceCounts = this.hand): number {
    if (!this.params.rates) return this.distance(cost, hand);
    let missing = 0;
    let tradeable = 0;
    let rounds = 0;
    for (const r of RESOURCES) {
      const d = cost[r] - hand[r];
      if (d > 0) {
        missing += d;
        rounds += d / (this.rate(r) + 0.35);
      } else tradeable += Math.floor(-d / this.ratio(r));
    }
    if (missing === 0) return 0;
    // Surplus trades cover part of it.
    const share = Math.min(missing, tradeable) / missing;
    return rounds * (1 - share) + 0.5 * Math.min(missing, tradeable);
  }

  /** Goals the bot could save for: the base ones plus every module's. */
  goals(): BotGoal[] {
    return this.memo('goals', () => {
      const out: BotGoal[] = [];
      const state = this.state;
      if (this.left('city') > 0) {
        const best = this.bestCitySpot();
        if (best) out.push({ id: 'city', cost: costOf(state, 'city'), value: best.value });
      }
      const spot = this.bestSpot();
      if (spot) {
        const road = costOf(state, 'road');
        const cost = { ...costOf(state, 'settlement') };
        for (const r of RESOURCES) cost[r] += road[r] * spot.roads;
        out.push({ id: 'settlement', cost, value: spot.value - 8 * spot.roads });
      }
      if (this.canBuyDev())
        out.push({ id: 'devCard', cost: costOf(state, 'devCard'), value: this.devValue() });
      for (const x of this.extensions) out.push(...(x.goals?.(this) ?? []));
      return out;
    });
  }

  /** Goals by how attractive they are now (value discounted by the rounds to afford them). */
  rankedGoals(): BotGoal[] {
    return this.memo('ranked', () =>
      this.goals()
        .map((g) => ({ g, k: g.value * 0.8 ** this.rounds(g.cost) }))
        .sort((a, b) => b.k - a.k)
        .map((x) => x.g),
    );
  }

  /** The goal the bot saves for, null if it has none. */
  target(): BotGoal | null {
    return this.rankedGoals()[0] ?? null;
  }

  /**
   * How good a hand is for the bot's plans: closeness to its best goals (each discounted 0.75 per
   * missing card), plus a little per card held. Trades and discards compare hands with this.
   */
  handScore(hand: ResourceCounts): number {
    const goals = this.rankedGoals().slice(0, 3);
    let best = 0;
    let second = 0;
    for (const g of goals) {
      const v = g.value * 0.75 ** this.distance(g.cost, hand);
      if (v > best) [best, second] = [v, best];
      else if (v > second) second = v;
    }
    let cards = 0;
    let count = 0;
    for (const r of RESOURCES) {
      cards += hand[r] * this.weight(r);
      count += hand[r];
    }
    // Cards above the discard limit are half lost on a 7.
    const over = Math.max(0, count - this.state.settings.discardLimit);
    return best + 0.3 * second + 2 * cards - (this.params.overLimit ?? 0) * over;
  }

  // -------------------------------------------------------------------------
  // Buildings and roads
  // -------------------------------------------------------------------------

  /** Value of a settlement on `v` for this bot. */
  settlementValue(v: VertexId): number {
    return this.memo(`sv:${v}`, () => {
      const prod = this.production(this.player);
      let value = VP + PIP_VALUE * this.vertexValue(v);
      // New resource types.
      for (const r of new Set(this.vertexResources(v))) {
        if (r !== 'gold' && prod[r] === 0) value += 10;
      }
      value += this.portValue(v);
      return value;
    });
  }

  /** A port on `v` the bot does not have yet: generic 3:1, or 2:1 of something it produces. */
  portValue(v: VertexId): number {
    const port = this.state.board.ports.find((p) => p.vertices.includes(v));
    if (!port) return 0;
    const have = portsOf(this.state, this.player);
    if (have.includes(port.kind)) return 0;
    if (port.kind === 'generic') return have.length === 0 ? 10 : 4;
    return Math.min(30, 2.5 * this.production(this.player)[port.kind]);
  }

  cityValue(v: VertexId): number {
    let value = VP + PIP_VALUE * this.vertexValue(v);
    if (this.left('settlement') === 0) value += 15;
    return value;
  }

  bestCitySpot(): Spot | null {
    return this.memo('bestCity', () => {
      let best: Spot | null = null;
      for (const v of buildingsOf(this.state, this.player, 'settlement')) {
        const value = this.cityValue(v);
        if (!best || value > best.value) best = { vertex: v, roads: 0, value };
      }
      return best;
    });
  }

  /**
   * Distance in roads from the bot's network to every vertex within REACH (0 = on the network).
   * Opponents' buildings stop a route; so do edges a road cannot take.
   */
  networkDistance(): Map<VertexId, number> {
    return this.memo('netDist', () => {
      const { state, player, topo } = this;
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
      for (const v of buildingsOf(state, player)) start(v);
      for (const e of roadsOf(state, player))
        for (const v of topo.edge[e]?.vertices ?? []) start(v);
      for (let i = 0; i < queue.length; i++) {
        const v = queue[i] as VertexId;
        const d = dist.get(v) ?? 0;
        if (d >= REACH) continue;
        for (const e of topo.vertex[v]?.edges ?? []) {
          if (!this.roadEdge(e)) continue;
          for (const w of topo.edge[e]?.vertices ?? []) {
            if (w === v || dist.has(w)) continue;
            dist.set(w, d + 1);
            if (!foreign(w)) queue.push(w);
          }
        }
      }
      return dist;
    });
  }

  /** An empty edge a road could take (land, not blocked by an expansion as far as the bot knows). */
  roadEdge(e: EdgeId): boolean {
    return this.state.pieces.roads[e] === undefined && edgeTouchesLand(this.state, e);
  }

  /** Open settlement spots within reach, best first. */
  spots(): Spot[] {
    return this.memo('spots', () => {
      if (this.left('settlement') === 0) return [];
      const out: Spot[] = [];
      for (const [v, d] of this.networkDistance()) {
        if (!isVertexOpen(this.state, v) || !touchesLand(this.state, v)) continue;
        if (d > 0 && this.left('road') < d) continue;
        out.push({ vertex: v, roads: d, value: this.settlementValue(v) });
      }
      return out.sort((a, b) => b.value - 12 * b.roads - (a.value - 12 * a.roads));
    });
  }

  bestSpot(): Spot | null {
    return this.spots()[0] ?? null;
  }

  /** Road distance from `target` to every vertex within REACH, over edges a road could take. */
  private distanceFrom(target: VertexId): Map<VertexId, number> {
    return this.memo(`from:${target}`, () => {
      const { state, player, topo } = this;
      const dist = new Map<VertexId, number>([[target, 0]]);
      const queue: VertexId[] = [target];
      for (let i = 0; i < queue.length; i++) {
        const v = queue[i] as VertexId;
        const d = dist.get(v) ?? 0;
        if (d >= REACH) continue;
        const b = state.pieces.buildings[v];
        if (v !== target && b !== undefined && b.owner !== player) continue;
        for (const e of topo.vertex[v]?.edges ?? []) {
          if (state.pieces.roads[e] !== undefined && state.pieces.roads[e] !== player) continue;
          if (!edgeTouchesLand(state, e)) continue;
          for (const w of topo.edge[e]?.vertices ?? []) {
            if (w === v || dist.has(w)) continue;
            dist.set(w, d + 1);
            queue.push(w);
          }
        }
      }
      return dist;
    });
  }

  /**
   * How much a new road on `e` is worth for reaching settlement spots: a share of the best spot
   * it brings closer (more when it is the last road before it). 0 when it leads nowhere.
   */
  roadToSpotValue(e: EdgeId): number {
    const ends = this.topo.edge[e]?.vertices ?? [];
    let best = 0;
    for (const spot of this.spots().slice(0, 4)) {
      if (spot.roads === 0) continue;
      const from = this.distanceFrom(spot.vertex);
      const after = Math.min(...ends.map((v) => from.get(v) ?? Infinity));
      if (after >= spot.roads) continue;
      const v = (spot.value - 12 * spot.roads) * (after === 0 ? 0.6 : 0.45 * 0.85 ** after);
      if (v > best) best = v;
    }
    return best;
  }

  /** Longest Road: what a road on `e` adds (the award's VP when it takes or secures it). */
  longestRoadValue(e: EdgeId): number {
    if (!this.params.longestRoad) return 0;
    const { state, player } = this;
    const mine = this.memo('lr', () => longestRoadLength(state, player));
    const holder = state.awards.longestRoad;
    const best = this.memo('lrBest', () => {
      let m = 0;
      for (let p = 0; p < this.n; p++)
        if (p !== player) m = Math.max(m, longestRoadLength(state, p));
      return m;
    });
    if (holder === player && mine > best + 1) return 0;
    if (mine + 2 < Math.max(best, LONGEST_ROAD_MIN - 1)) return 0;
    const after = longestRoadLength(
      { ...state, pieces: { ...state.pieces, roads: { ...state.pieces.roads, [e]: player } } },
      player,
    );
    if (after <= mine) return 0;
    const takes = after >= LONGEST_ROAD_MIN && after > best;
    if (takes && holder !== player) return 2 * VP * 0.9;
    if (holder === player) return 40;
    return 25;
  }

  // -------------------------------------------------------------------------
  // Dev cards
  // -------------------------------------------------------------------------

  canBuyDev(): boolean {
    return this.state.devDeck.length > 0;
  }

  /** Knights the bot needs to take Largest Army next (0 = it holds it). */
  knightsToArmy(): number {
    const { state, player } = this;
    if (state.awards.largestArmy === player) return 0;
    const mine = state.players[player]?.knightsPlayed ?? 0;
    let top = LARGEST_ARMY_MIN - 1;
    for (const p of state.players) if (p.id !== player) top = Math.max(top, p.knightsPlayed);
    return top + 1 - mine;
  }

  devValue(): number {
    const toArmy = this.knightsToArmy();
    return (this.params.dev ?? 85) + (toArmy > 0 && toArmy <= 2 ? 25 : 0);
  }
}
