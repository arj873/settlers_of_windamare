/**
 * Hook runners: the only way core rules call expansion hooks (docs/EXPANSIONS.md §5). Every
 * runner is a no-op for base games (no active modules), so base behaviour is unchanged.
 * Expansions use the value helpers too (costOf, pieceLimit, ...), never the raw constants.
 */
import { COSTS, PIECE_LIMITS } from '../constants';
import type {
  Action,
  BuildingKind,
  EdgeId,
  GainSource,
  GameState,
  LossSink,
  Phase,
  PlayerId,
  Resource,
  ResourceCounts,
  Terrain,
  VertexId,
} from '../types';
import { activeModules, expansionById } from './registry';
import { namespaceOf } from './ext';
import type { ProductionContext, SetupOrder, Supply, VictoryPointPart } from './types';

type State = Pick<GameState, 'settings'>;

export type BaseCostItem = keyof typeof COSTS;
export type BasePieceKind = keyof typeof PIECE_LIMITS;

/** Cost of a base item (with expansion changes) or of a module item ('<id>/ship'). */
export function costOf(state: GameState, item: BaseCostItem): ResourceCounts;
export function costOf(state: GameState, item: string): ResourceCounts | undefined;
export function costOf(state: GameState, item: string): ResourceCounts | undefined {
  let cost: ResourceCounts | undefined = Object.hasOwn(COSTS, item)
    ? COSTS[item as BaseCostItem]
    : undefined;
  for (const m of activeModules(state)) {
    const f = m.hooks?.cost;
    if (f) cost = f(state, item, cost);
  }
  return cost;
}

/** Pieces of `kind` a player owns in total (placed + in supply). */
export function pieceLimit(state: GameState, player: PlayerId, kind: string): number {
  let n = Object.hasOwn(PIECE_LIMITS, kind) ? PIECE_LIMITS[kind as BasePieceKind] : 0;
  for (const m of activeModules(state)) {
    const f = m.hooks?.pieceLimit;
    if (f) n = f(state, player, kind, n);
  }
  return n;
}

/** Building of setup step `index`: the first module's setupBuilding, else `base` (settings). */
export function setupBuildingKind(
  state: GameState,
  index: number,
  base: BuildingKind = 'settlement',
): BuildingKind {
  for (const m of activeModules(state)) {
    const k = m.hooks?.setupBuilding?.(state, index);
    if (k !== undefined) return k;
  }
  return base;
}

export function hookRollDice(draft: GameState): [number, number] | undefined {
  for (const m of activeModules(draft)) {
    const d = m.hooks?.rollDice?.(draft);
    if (d !== undefined) return d;
  }
  return undefined;
}

/** Runs every onRoll hook; returns the first interrupting phase (all hooks still run). */
export function runOnRoll(draft: GameState, roll: number): Phase | undefined {
  let phase: Phase | undefined;
  for (const m of activeModules(draft)) {
    const p = m.hooks?.onRoll?.(draft, roll);
    if (p && !phase) phase = p;
  }
  return phase;
}

export function blocksRoute(state: GameState, v: VertexId, player: PlayerId): boolean {
  for (const m of activeModules(state)) if (m.hooks?.blocksRoute?.(state, v, player)) return true;
  return false;
}

export function hasRouteBlockers(state: State): boolean {
  return activeModules(state).some((m) => m.hooks?.blocksRoute !== undefined);
}

export function hookHandSize(state: GameState, player: PlayerId, base: number): number {
  let n = base;
  for (const m of activeModules(state)) {
    const f = m.hooks?.handSize;
    if (f) n = f(state, player, n);
  }
  return n;
}

export function hookDiscardLimit(state: GameState, player: PlayerId, base: number): number {
  let n = base;
  for (const m of activeModules(state)) {
    const f = m.hooks?.discardLimit;
    if (f) n = f(state, player, n);
  }
  return n;
}

export function hookSupply(state: State, base: Supply): Supply {
  let s = base;
  for (const m of activeModules(state)) {
    const f = m.hooks?.supply;
    if (f) s = f(state, s);
  }
  return s;
}

export function hookSevenPhase(draft: GameState, pending: readonly number[]): Phase | undefined {
  for (const m of activeModules(draft)) {
    const p = m.hooks?.onSeven?.(draft, pending);
    if (p !== undefined) return p;
  }
  return undefined;
}

export function runProductionHooks(
  state: GameState,
  roll: number,
  owed: ResourceCounts[],
  ctx: ProductionContext,
): void {
  for (const m of activeModules(state)) m.hooks?.production?.(state, roll, owed, ctx);
}

export function hookAfterProduction(
  draft: GameState,
  roll: number,
  paid: readonly ResourceCounts[] = [],
): Phase | undefined {
  for (const m of activeModules(draft)) {
    const p = m.hooks?.afterProduction?.(draft, roll, paid);
    if (p !== undefined) return p;
  }
  return undefined;
}

export function vertexBlocked(state: GameState, v: VertexId): boolean {
  for (const m of activeModules(state)) if (m.hooks?.vertexBlocked?.(state, v)) return true;
  return false;
}

export function edgeBlocked(state: GameState, e: EdgeId): boolean {
  for (const m of activeModules(state)) if (m.hooks?.edgeBlocked?.(state, e)) return true;
  return false;
}

/** VP from expansions (the base sources are counted by selectors.ts). */
export function expansionVictoryPoints(
  state: GameState,
  player: PlayerId,
): { public: number; hidden: number } {
  const out = { public: 0, hidden: 0 };
  for (const m of activeModules(state)) {
    const vp = m.hooks?.victoryPoints?.(state, player);
    if (vp) {
      out.public += vp.public;
      out.hidden += vp.hidden ?? 0;
    }
  }
  return out;
}

export function hookTradeRatio(
  state: GameState,
  player: PlayerId,
  resource: Resource,
  base: number,
): number {
  let n = base;
  for (const m of activeModules(state)) {
    const f = m.hooks?.bankTradeRatio;
    if (f) n = f(state, player, resource, n);
  }
  return n;
}

export function hookRoadLength(state: GameState, player: PlayerId, base: number): number {
  let n = base;
  for (const m of activeModules(state)) {
    const f = m.hooks?.roadLength;
    if (f) n = f(state, player, n);
  }
  return n;
}

export function hasRoadLengthHook(state: State): boolean {
  return activeModules(state).some((m) => m.hooks?.roadLength !== undefined);
}

export function hookArmySize(state: GameState, player: PlayerId, base: number): number {
  let n = base;
  for (const m of activeModules(state)) {
    const f = m.hooks?.armySize;
    if (f) n = f(state, player, n);
  }
  return n;
}

export function hookSetupOrder(state: GameState): SetupOrder | undefined {
  for (const m of activeModules(state)) {
    const o = m.hooks?.setupOrder?.(state);
    if (o !== undefined) return o;
  }
  return undefined;
}

export function runOnEndTurn(draft: GameState, player: PlayerId): void {
  for (const m of activeModules(draft)) m.hooks?.onEndTurn?.(draft, player);
}

export function runOnStartTurn(draft: GameState, player: PlayerId): void {
  for (const m of activeModules(draft)) m.hooks?.onStartTurn?.(draft, player);
}

export function runAfterAction(draft: GameState, action: Action): void {
  for (const m of activeModules(draft)) m.hooks?.afterAction?.(draft, action);
}

/** A module's own win test for `player` (`wins` hook), or undefined for the VP target. */
export function hookWins(state: GameState, player: PlayerId): boolean | undefined {
  for (const m of activeModules(state)) {
    const w = m.hooks?.wins?.(state, player);
    if (w !== undefined) return w;
  }
  return undefined;
}

/** The named parts of the expansions' VP (statistics screen chips), in module order. */
export function expansionVictoryParts(state: GameState, player: PlayerId): VictoryPointPart[] {
  return activeModules(state).flatMap((m) => m.hooks?.victoryPoints?.(state, player).parts ?? []);
}

/** Stats category of a hand change made by an action (statsCategory hook), or undefined. */
export function hookStatsCategory(
  state: GameState,
  action: Action,
  player: PlayerId,
): { gain?: GainSource; loss?: LossSink } | undefined {
  for (const m of activeModules(state)) {
    const c = m.hooks?.statsCategory?.(state, action, player);
    if (c !== undefined) return c;
  }
  return undefined;
}

/** Does an active module take over the victory check (`deferVictory`)? */
export function victoryDeferred(state: GameState): boolean {
  for (const m of activeModules(state)) if (m.hooks?.deferVictory?.(state)) return true;
  return false;
}

/**
 * What a terrain is for the core rules: resources, desert and gold are land; 'sea' is sea; 'fog'
 * is fog; a namespaced terrain is whatever its module declares (unknown = land).
 */
export function terrainKind(t: Terrain): 'land' | 'sea' | 'fog' {
  if (t === 'sea' || t === 'fog') return t;
  const ns = namespaceOf(t);
  if (ns === null) return 'land';
  return expansionById(ns)?.terrains?.[t]?.kind ?? 'land';
}

/** Acting players in an expansion phase (from its module), or undefined to use the default. */
export function expansionActors(state: GameState): PlayerId[] | undefined {
  const ns = namespaceOf(state.phase.kind);
  if (ns === null) return undefined;
  for (const m of activeModules(state)) {
    const a = m.actors?.(state);
    if (a !== undefined) return a;
  }
  return undefined;
}

/** Does a successful `type` action of a module change road lengths / vertex occupancy? */
export function moduleChangesRoads(state: State, type: string): boolean {
  return activeModules(state).some((m) => m.changesRoads?.includes(type as never) === true);
}
