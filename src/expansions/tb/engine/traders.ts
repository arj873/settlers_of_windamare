/**
 * Traders & Barbarians, the main scenario (docs/rules/traders-barbarians.md §2.6, §3.7, §4.7):
 * three trade hexes (castle, quarry, glassworks) with a plaza and spokes (F2 topology); each
 * player's wagon carries one commodity at a time to the trade hex that wants it, for gold and
 * 1 VP. Wagons move at the end of the turn on movement points (MP); roads make it cheaper, other
 * players' roads cost a toll, barbarians on paths slow it down. No robber: a 7 or a Knight moves a
 * barbarian (and steals from the road owner); no Longest Road; 2 and 12 are re-rolled.
 *
 * Choices made (§10): the first plaza visit only picks up a commodity (Q-initial destination);
 * toll is 1 gold per foreign road edge, paid when entering it (Q22); barbarians may stand on any
 * path, spokes and sea sides included (Q21); the T&B deck's Knight counts for Largest Army (Q13).
 */
import { isCurrent, log } from '../../../engine/actions/common';
import { isBuildPhase } from '../../../engine/actions/build';
import { isCentreVertex } from '../../../engine/hex';
import { hasResources } from '../../../engine/resources';
import { Rng } from '../../../engine/rng';
import type { Action, EdgeId, GameState, HexId, PlayerId, VertexId } from '../../../engine/types';
import { addGold, goldOf, payBank, pn, rollDie, stealResource } from './common';
import { TRADERS_BARBARIANS_19, TRADERS_BARBARIANS_37 } from './maps';
import { pathEdges, pathOther, pathsAt, routeOwner } from './paths';
import {
  BAGGAGE,
  BARBARIAN_MP,
  DELIVER_TO,
  MAX_LEVEL,
  NO_ROAD_MP,
  ROAD_MP,
  STACK_OF,
  START_GOLD,
  SWIFT_JOURNEYS,
  WAGON_GRAIN_MP,
  tbBoard,
  tbSlice,
  tradersOf,
  upgradeCost,
  type Commodity,
  type TbPhase,
  type TradeKind,
  type TradersSlice,
} from './state';

export function initTraders(state: GameState, rng: Rng): TradersSlice {
  const n = state.players.length;
  const big = n > 4;
  const stacks: Record<HexId, Commodity[]> = {};
  for (const t of tbBoard(state).tradeHexes ?? []) {
    const [a, b] = STACK_OF[t.kind];
    const [na, nb] = !big || t.kind === 'castle' ? [6, 6] : [4, 3];
    stacks[t.hex] = rng.shuffle([...Array<Commodity>(na).fill(a), ...Array<Commodity>(nb).fill(b)]);
  }
  return {
    wagons: state.players.map(() => null),
    level: state.players.map(() => 1),
    commodity: state.players.map(() => null),
    stacks,
    delivered: state.players.map(() => 0),
    barbarians: [
      ...(tbBoard(state).barbarians ?? (big ? TRADERS_BARBARIANS_37 : TRADERS_BARBARIANS_19)),
    ],
    swift: {
      deck: SWIFT_JOURNEYS,
      held: state.players.map(() => 0),
      fresh: state.players.map(() => 0),
    },
    move: freshMove(1),
  };
}

export const startGold = (n: number): number[] => Array<number>(n).fill(START_GOLD);

export function freshMove(level: number): TradersSlice['move'] {
  return {
    mp: BAGGAGE[level - 1]?.mp ?? 4,
    steps: 0,
    grain: false,
    over: false,
    moves: 0,
    tried: [],
  };
}

const tradeKindAt = (state: GameState, h: HexId): TradeKind | null =>
  (tbBoard(state).tradeHexes ?? []).find((t) => t.hex === h)?.kind ?? null;

/** The trade hex whose plaza is `v` (a centre vertex), or null. */
export function plazaHex(v: VertexId): HexId | null {
  if (!isCentreVertex(v)) return null;
  return `h:${v.slice(2, v.lastIndexOf(','))}` as HexId;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/**
 * Road owner on `e` for wagon purposes: a player, 'neutral', or null (none / damaged). A ship
 * counts like a road (T&B + Seafarers: 1 MP on your own, 1 MP + 1 gold to its owner otherwise).
 */
function roadOn(state: GameState, e: EdgeId): PlayerId | 'neutral' | null {
  const owner = state.pieces.roads[e];
  if (owner !== undefined) {
    // Earthquake: a damaged road counts as no road (2 MP).
    if (state.damagedRoads?.[owner] === e) return null;
    return owner;
  }
  const two = tbSlice(state).two;
  if (two?.neutrals.some((nt) => nt.roads.includes(e))) return 'neutral';
  return routeOwner(state, e);
}

/** MP and toll of entering edge `e` for `p`. */
export function stepCost(
  state: GameState,
  p: PlayerId,
  e: EdgeId,
): { mp: number; toll: PlayerId | 'neutral' | null } {
  const road = roadOn(state, e);
  const barbarian = tradersOf(state).barbarians.includes(e) ? BARBARIAN_MP : 0;
  if (road === null) return { mp: NO_ROAD_MP + barbarian, toll: null };
  return { mp: ROAD_MP + barbarian, toll: road === p ? null : road };
}

/** Vertices the wagon of `p` may move to next, with the edge used. */
export function wagonSteps(state: GameState, p: PlayerId): { vertex: VertexId; edge: EdgeId }[] {
  const s = tradersOf(state);
  const from = s.wagons[p];
  if (!from || s.move.over) return [];
  const out: { vertex: VertexId; edge: EdgeId }[] = [];
  for (const e of pathsAt(state, from)) {
    const c = stepCost(state, p, e);
    if (c.mp > s.move.mp) continue;
    if (c.toll !== null && goldOf(state, p) < 1) continue;
    out.push({ vertex: pathOther(state, e, from), edge: e });
  }
  return out;
}

export function wagonStepBlocker(
  state: GameState,
  p: PlayerId,
  v: unknown,
  start: boolean,
): string | null {
  const k = state.phase.kind;
  if (start ? k !== 'main' : k !== 'tb/wagon')
    return start ? 'move the wagon in the main phase' : 'not moving the wagon';
  if (!isCurrent(state, p) || state.turn.secondSettlerOf !== undefined) return 'not your turn';
  if (start && tradersOf(state).move.steps > 0) return 'the wagon already moved';
  if (!wagonSteps(state, p).some((x) => x.vertex === v)) return 'the wagon cannot go there';
  return null;
}

/** One step of the wagon; entering a plaza ends the move (deliver / pick up there). */
export function wagonStep(draft: GameState, p: PlayerId, to: VertexId): void {
  const s = tradersOf(draft);
  const step = wagonSteps(draft, p).find((x) => x.vertex === to);
  if (!step) return;
  const c = stepCost(draft, p, step.edge);
  s.move.mp -= c.mp;
  s.move.steps += 1;
  if (c.toll !== null) {
    addGold(draft, p, -1);
    if (c.toll !== 'neutral') addGold(draft, c.toll, 1);
    log(
      draft,
      p,
      `${pn(draft, p)} paid 1 gold toll${c.toll === 'neutral' ? '' : ` to ${pn(draft, c.toll)}`}`,
    );
  }
  s.wagons[p] = to;
  if (s.move.steps === 1) s.move.moves += 1;
  const hex = plazaHex(to);
  if (hex !== null) {
    s.move.over = true;
    s.move.mp = 0;
    visitPlaza(draft, p, hex);
  }
}

/** At a plaza: deliver the commodity it wants (1 VP + gold), then draw the next one there. */
export function visitPlaza(draft: GameState, p: PlayerId, hex: HexId): void {
  const s = tradersOf(draft);
  const kind = tradeKindAt(draft, hex);
  if (kind === null) return;
  const held = s.commodity[p] ?? null;
  if (held !== null && DELIVER_TO[held] === kind) {
    const gold = BAGGAGE[(s.level[p] ?? 1) - 1]?.gold ?? 1;
    s.delivered[p] = (s.delivered[p] ?? 0) + 1;
    s.commodity[p] = null;
    addGold(draft, p, gold);
    log(draft, p, `${pn(draft, p)} delivered ${held} to the ${kind} (+1 VP, ${gold} gold)`);
  }
  if ((s.commodity[p] ?? null) === null) {
    // An empty stack: draw from another trade hex's stack (T5-56; never happens with 3-4).
    const stack =
      (s.stacks[hex]?.length ?? 0) > 0
        ? s.stacks[hex]
        : Object.values(s.stacks).find((x) => x.length > 0);
    const next = stack?.pop() ?? null;
    s.commodity[p] = next;
    if (next !== null) log(draft, p, `${pn(draft, p)} loaded ${next} at the ${kind}`);
  }
}

export function grainBlocker(state: GameState, p: PlayerId): string | null {
  if (state.phase.kind !== 'tb/wagon') return 'buy movement while moving the wagon';
  if (!isCurrent(state, p)) return 'not your turn';
  const m = tradersOf(state).move;
  if (m.grain) return 'grain was paid for this move already';
  if (m.over) return 'the move is over';
  if ((state.players[p]?.resources.grain ?? 0) < 1) return 'needs 1 grain';
  return null;
}

export function payGrain(draft: GameState, p: PlayerId): void {
  const m = tradersOf(draft).move;
  payBank(draft, p, { grain: 1 });
  m.grain = true;
  m.mp += WAGON_GRAIN_MP;
  log(draft, p, `${pn(draft, p)} paid 1 grain for 2 more movement points`);
}

/** Barbarian paths next to the wagon that may be driven off now. */
export function driveOffTargets(state: GameState, p: PlayerId): EdgeId[] {
  if (state.phase.kind !== 'tb/wagon' || !isCurrent(state, p)) return [];
  const s = tradersOf(state);
  const at = s.wagons[p];
  if (!at || s.move.over || BAGGAGE[(s.level[p] ?? 1) - 1]?.driveOff == null) return [];
  return pathsAt(state, at).filter((e) => s.barbarians.includes(e) && !s.move.tried.includes(e));
}

/** Roll to drive a barbarian off: in range, its new path is picked next. Returns success. */
export function driveOff(draft: GameState, p: PlayerId, e: EdgeId): boolean {
  const s = tradersOf(draft);
  s.move.tried.push(e);
  const need = BAGGAGE[(s.level[p] ?? 1) - 1]?.driveOff ?? 7;
  const d = rollDie(draft);
  const ok = d >= need;
  log(
    draft,
    p,
    `${pn(draft, p)} rolled ${d} to drive off a barbarian: ${ok ? 'success' : 'failed'}`,
  );
  return ok;
}

export function swiftBlocker(state: GameState, p: PlayerId): string | null {
  if (state.phase.kind !== 'tb/wagon') return 'play Swift Journey after moving your wagon';
  if (!isCurrent(state, p)) return 'not your turn';
  if (state.turn.devCardPlayed) return 'already played a development card this turn';
  const s = tradersOf(state);
  if ((s.swift.held[p] ?? 0) < 1) return 'no playable Swift Journey';
  if (s.move.steps === 0) return 'move your wagon first';
  return null;
}

export function playSwift(draft: GameState, p: PlayerId): void {
  const s = tradersOf(draft);
  s.swift.held[p] = (s.swift.held[p] ?? 0) - 1;
  draft.turn.devCardPlayed = true;
  const moves = s.move.moves;
  s.move = { ...freshMove(s.level[p] ?? 1), moves, tried: s.move.tried };
  log(draft, p, `${pn(draft, p)} played Swift Journey: the wagon moves again`);
}

// ---------------------------------------------------------------------------
// Upgrades, barbarians, VP
// ---------------------------------------------------------------------------

export function upgradeBlocker(state: GameState, p: PlayerId): string | null {
  if (!isBuildPhase(state)) return 'upgrade in the main or special building phase';
  if (!isCurrent(state, p)) return 'not your turn';
  const level = tradersOf(state).level[p] ?? 1;
  if (level >= MAX_LEVEL) return 'the baggage train is at its best';
  const hand = state.players[p]?.resources;
  if (!hand || !hasResources(hand, upgradeCost(level + 1))) return 'cannot afford the upgrade';
  return null;
}

export function upgradeWagon(draft: GameState, p: PlayerId): void {
  const s = tradersOf(draft);
  const level = (s.level[p] ?? 1) + 1;
  payBank(draft, p, upgradeCost(level));
  s.level[p] = level;
  // The current move keeps its MP; the new card counts from the next move.
  log(
    draft,
    p,
    `${pn(draft, p)} upgraded the baggage train to ${level}${level === MAX_LEVEL ? ' (+1 VP)' : ''}`,
  );
}

/**
 * Paths a barbarian may move to: any path without a barbarian (`noRoad`: and without a road,
 * Catan for Two's token action). On a Seafarers map sea paths too (T&B + Seafarers).
 */
export function barbarianSpots(state: GameState, noRoad = false): EdgeId[] {
  const taken = new Set(tradersOf(state).barbarians);
  return pathEdges(state).filter(
    (e) => !taken.has(e) && !(noRoad && state.pieces.roads[e] !== undefined),
  );
}

/**
 * Move the barbarian on `from` to `to`; with `steal`, rob the road owner there (on a sea path:
 * the ship's owner, our reading of T&B + Seafarers).
 */
export function moveBarbarian(
  draft: GameState,
  p: PlayerId,
  from: EdgeId,
  to: EdgeId,
  steal: boolean,
): void {
  const s = tradersOf(draft);
  s.barbarians = s.barbarians.map((e) => (e === from ? to : e));
  log(draft, p, `${pn(draft, p)} moved a barbarian`);
  const owner = routeOwner(draft, to);
  if (steal && owner !== null && owner !== p) {
    const card = stealResource(draft, p, owner);
    log(draft, p, `${pn(draft, p)} stole from ${pn(draft, owner)}${card ? '' : ' (no cards)'}`);
  }
}

export function tradersVictoryParts(
  state: GameState,
  p: PlayerId,
): { label: string; vp: number }[] {
  const s = tradersOf(state);
  const out: { label: string; vp: number }[] = [];
  const d = s.delivered[p] ?? 0;
  if (d > 0) out.push({ label: 'Deliveries', vp: d });
  if ((s.level[p] ?? 1) >= MAX_LEVEL) out.push({ label: 'Baggage train', vp: 1 });
  return out;
}

/** Swift Journey from a development card purchase: a share of the draws equal to its share of the deck. */
export function drawsSwift(draft: GameState): boolean {
  const s = tradersOf(draft);
  if (s.swift.deck <= 0) return false;
  const rng = new Rng(draft.rng);
  const hit = rng.int(s.swift.deck + draft.devDeck.length) < s.swift.deck;
  draft.rng = rng.state;
  return hit;
}

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

export function tradersLegal(state: GameState): Action[] {
  const p = state.turn.current;
  const s = tradersOf(state);
  const phase = state.phase as unknown as TbPhase | { kind: string };
  const out: Action[] = [];
  const act = (a: Record<string, unknown>) => out.push({ player: p, ...a } as unknown as Action);
  switch (phase.kind) {
    case 'main':
    case 'specialBuild':
      if (upgradeBlocker(state, p) === null) act({ type: 'tb/upgradeWagon' });
      if (phase.kind === 'main' && state.turn.secondSettlerOf === undefined && s.move.steps === 0) {
        for (const x of wagonSteps(state, p)) act({ type: 'tb/startWagon', vertex: x.vertex });
      }
      break;
    case 'tb/wagon':
      for (const x of wagonSteps(state, p)) act({ type: 'tb/wagonStep', vertex: x.vertex });
      if (grainBlocker(state, p) === null) act({ type: 'tb/wagonGrain' });
      for (const e of driveOffTargets(state, p)) act({ type: 'tb/driveOff', edge: e });
      if (swiftBlocker(state, p) === null) act({ type: 'tb/swiftJourney' });
      break;
    case 'tb/barbarian': {
      const ph = phase as { from?: EdgeId | null; noRoad?: boolean };
      const from = ph.from ?? null;
      const edges = from === null ? s.barbarians : barbarianSpots(state, ph.noRoad === true);
      for (const e of edges) act({ type: 'tb/placeBarbarian', edge: e });
      break;
    }
    default:
      break;
  }
  return out;
}
