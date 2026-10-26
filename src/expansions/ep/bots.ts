/**
 * Explorers & Pirates bots: invariants for the simulator and a `steer` that gives the random bot a
 * sense of E&P progress (docs/rules/explorers-pirates.md §9.7): build harbors, settlements,
 * settlers, ships and crews; then sail each ship towards what its cargo is for (land for a
 * settler, the Council for fish and spice, lairs and farms for crews, hauls, sacks or the
 * unexplored for an empty ship) and do the mission actions on the way.
 */
import type { BotExtension } from '../../bots/expansions';
import {
  costOf,
  RESOURCES,
  type Action,
  type EdgeId,
  type GameState,
  type HexId,
  type PlayerId,
  type Resource,
  type ResourceCounts,
  type Rng,
} from '../../engine';
import { A, inMovement, settlementSpot } from './engine/actions';
import { anchors, graph, isCoastal, shipEdges, touchesFog } from './engine/geometry';
import { cargoOnBoard, harborsLeft, harborsOf, isHarbor, shipById, shipsOf } from './engine/ships';
import { epSlice, ITEM, rulesOf, type Ship } from './engine/state';
import { checkEp } from './invariants';

/** Edges whose ends touch one of `hexes`' corners. */
function edgesAtHexes(state: GameState, hexes: readonly HexId[]): EdgeId[] {
  const g = graph(state);
  const out = new Set<EdgeId>();
  for (const h of hexes) {
    for (const v of g.hexVertices.get(h) ?? []) for (const e of g.edgesAt.get(v) ?? []) out.add(e);
  }
  return [...out];
}

/** Where a ship with this cargo wants to be (sea routes), best goal kind first. */
function goals(state: GameState, ship: Ship): EdgeId[] {
  const s = epSlice(state);
  const g = graph(state);
  const p = ship.owner;
  const routes = shipEdges(state);
  const keep = (es: Iterable<EdgeId>) => [...es].filter((e) => routes.has(e));
  if (ship.cargo.includes('settler')) {
    const spots = keep(
      g.edges.filter((e) =>
        (g.ends.get(e) ?? []).some(
          (v) => !state.pieces.buildings[v] && settlementSpot(state, p, v),
        ),
      ),
    );
    if (spots.length > 0) return spots;
  }
  if (ship.cargo.some((c) => c === 'fish' || c === 'spice')) {
    const at = anchors(state);
    return keep(at.flatMap((v) => g.edgesAt.get(v) ?? []));
  }
  if (ship.cargo.includes('crew')) {
    const lairs = (Object.keys(s.lairs) as HexId[]).filter((h) => {
      const l = s.lairs[h];
      return l !== undefined && !l.captured && l.crews.length < 3;
    });
    const farms = (Object.keys(s.spice) as HexId[]).filter((h) => !s.spice[h]?.crews.includes(p));
    const out = keep(edgesAtHexes(state, [...lairs, ...farms]));
    if (out.length > 0) return out;
  }
  if (ship.cargo.length === 0) {
    const sacks = (Object.keys(s.spice) as HexId[]).filter((h) => {
      const f = s.spice[h];
      return f !== undefined && f.crews.includes(p) && f.sacks.includes(p);
    });
    const loot = keep(edgesAtHexes(state, [...s.hauls, ...sacks]));
    if (loot.length > 0) return loot;
    const waiting = harborsOf(state, p).filter((v) => (s.harbors[v] ?? []).length > 0);
    const home = keep(waiting.flatMap((v) => g.edgesAt.get(v) ?? []));
    if (home.length > 0) return home;
  }
  return keep(g.edges.filter((e) => touchesFog(state, e)));
}

/** Steps from every sea route to the nearest goal (BFS over routes sharing a vertex). */
function distances(state: GameState, from: readonly EdgeId[]): Map<EdgeId, number> {
  const g = graph(state);
  const routes = shipEdges(state);
  const dist = new Map<EdgeId, number>(from.map((e) => [e, 0]));
  let frontier = [...from];
  while (frontier.length > 0) {
    const next: EdgeId[] = [];
    for (const e of frontier) {
      const d = dist.get(e) ?? 0;
      for (const v of g.ends.get(e) ?? []) {
        for (const o of g.edgesAt.get(v) ?? []) {
          if (!routes.has(o) || dist.has(o)) continue;
          dist.set(o, d + 1);
          next.push(o);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

const ofType = (options: readonly Action[], ...types: string[]) =>
  options.filter((a) => types.includes(a.type));

const shipOf = (state: GameState, a: Action): Ship | undefined =>
  shipById(epSlice(state), (a as { ship?: number }).ship ?? -1);

/** The cost of the next thing worth building. */
function wanted(state: GameState, p: PlayerId): ResourceCounts | undefined {
  const s = epSlice(state);
  const plain = Object.entries(state.pieces.buildings).some(
    ([v, b]) => b.owner === p && !isHarbor(state, v as never) && isCoastal(state, v as never),
  );
  if (plain && harborsLeft(state, p) > 0) return costOf(state, ITEM.harbor);
  if (cargoOnBoard(state, p, 'settler') === 0) return costOf(state, ITEM.settler);
  if (shipsOf(s, p).length < 2) return costOf(state, ITEM.ship);
  if (rulesOf(state).crews && cargoOnBoard(state, p, 'crew') < 3) return costOf(state, ITEM.crew);
  return costOf(state, 'settlement');
}

function steerAction(
  state: GameState,
  p: PlayerId,
  options: readonly Action[],
  rng: Rng,
): Action | null {
  const s = epSlice(state);
  const pick = (list: readonly Action[]) => (list.length > 0 ? rng.pick(list) : null);
  const first =
    pick(ofType(options, A.buildHarbor)) ??
    pick(ofType(options, 'buildSettlement')) ??
    (cargoOnBoard(state, p, 'settler') === 0 ? pick(ofType(options, A.buildSettler)) : null) ??
    (shipsOf(s, p).length < 2
      ? pick(ofType(options, A.buildShip).filter((a) => !('replace' in a)))
      : null) ??
    (rulesOf(state).crews && cargoOnBoard(state, p, 'crew') < 3
      ? pick(ofType(options, A.buildCrew))
      : null);
  if (first) return first;
  // Trade towards the next thing worth building: 3:1 or 2 gold for a missing card.
  const want = wanted(state, p);
  if (want) {
    const hand = state.players[p]?.resources;
    const missing = RESOURCES.filter((r) => (hand?.[r] ?? 0) < want[r]);
    const spare = (r: Resource) => (hand?.[r] ?? 0) - want[r] >= 3;
    const field = (a: Action, k: string) =>
      (a as unknown as Record<string, Resource>)[k] as Resource;
    const trade =
      pick(ofType(options, A.buyWithGold).filter((a) => missing.includes(field(a, 'resource')))) ??
      pick(
        ofType(options, 'bankTrade').filter(
          (a) => missing.includes(field(a, 'receive')) && spare(field(a, 'give')),
        ),
      );
    if (trade) return trade;
  }
  return rng.float() < 0.7 ? pick(ofType(options, A.startMovement)) : null;
}

function steerMovement(state: GameState, options: readonly Action[], rng: Rng): Action | null {
  const pick = (list: readonly Action[]) => (list.length > 0 ? rng.pick(list) : null);
  const now =
    pick(ofType(options, A.land, A.deliver, A.catchFish, A.loadSpice, A.dropCrew, A.chase)) ??
    pick(ofType(options, A.rollFish)) ??
    pick(
      ofType(options, A.load).filter((a) => {
        const c = (a as { cargo?: string }).cargo;
        return c === 'settler' || c === 'crew';
      }),
    );
  if (now) return now;
  const moves = ofType(options, A.moveShip);
  const ship = moves[0] ? shipOf(state, moves[0]) : undefined;
  if (ship) {
    const dist = distances(state, goals(state, ship));
    const here = dist.get(ship.edge) ?? Infinity;
    let best: Action[] = [];
    let bestD = here;
    for (const m of moves) {
      const d = dist.get((m as { edge: EdgeId }).edge) ?? Infinity;
      if (d < bestD) {
        bestD = d;
        best = [m];
      } else if (d === bestD && d < here) best.push(m);
    }
    if (best.length > 0) return rng.pick(best);
  }
  // Another ship with somewhere to go.
  const selects = ofType(options, A.selectShip).filter((a) => {
    const sh = shipOf(state, a);
    if (!sh) return false;
    return (distances(state, goals(state, sh)).get(sh.edge) ?? Infinity) > 0;
  });
  const sel = pick(selects);
  if (sel) return sel;
  return pick(ofType(options, 'endTurn'));
}

export const epBots: BotExtension = {
  id: 'ep',
  invariants: checkEp,
  // No robber (NO_ROBBER), no Longest Road / Largest Army: the module checks its own state.
  relax: ['robber-position', 'award-mismatch'],
  steer(state, player, options, rng) {
    if (state.phase.kind !== 'main' || state.turn.current !== player) return null;
    return inMovement(state)
      ? steerMovement(state, options, rng)
      : steerAction(state, player, options, rng);
  },
};
