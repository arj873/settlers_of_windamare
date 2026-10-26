/**
 * What placing a piece sets off (docs/rules/seafarers.md §4.6-§4.9): fog discovery, Forgotten
 * Tribe gifts, Cloth for Catan village links, special VP for new islands, and free resource
 * choices (gold). Called from the module's handlers and its afterAction hook, on drafts.
 */
import { RESOURCES } from '../../../engine/constants';
import { log } from '../../../engine/actions/common';
import { playerName } from '../../../engine/rules/text';
import { isResource } from '../../../engine/resources';
import type {
  EdgeId,
  GameState,
  HexId,
  PlayerId,
  Port,
  PortKind,
  VertexId,
} from '../../../engine/types';
import { graph, hexKind } from './geometry';
import { mapKeyOf, seaBoard, specOf, type MapKey } from './maps';
import { blockedFor } from './ships';
import { rulesOf, seaSlice, type GoldPhase, type HarborPhase } from './state';

const keyOf = (state: GameState) => mapKeyOf(state.settings.map) as MapKey;
const name = (s: GameState, p: PlayerId) => playerName(s, p);

// ---------------------------------------------------------------------------------------------
// Free resource choices
// ---------------------------------------------------------------------------------------------

const bankTotal = (s: GameState) => RESOURCES.reduce((n, r) => n + s.bank[r], 0);

/**
 * `p` picks `n` free resources (gold field, discovered gold, fleet victory): opens a gold phase
 * that returns to the current phase, or adds to the open one.
 */
export function queueGold(draft: GameState, p: PlayerId, n: number): void {
  if (n <= 0 || bankTotal(draft) === 0) return;
  if (draft.phase.kind === 'seafarers/gold') {
    const ph = draft.phase as GoldPhase;
    ph.pending[p] = (ph.pending[p] ?? 0) + n;
    return;
  }
  const pending = draft.players.map(() => 0);
  pending[p] = n;
  const phase: GoldPhase = { kind: 'seafarers/gold', pending, then: { phase: draft.phase } };
  draft.phase = phase;
}

// ---------------------------------------------------------------------------------------------
// Fog (§4.7)
// ---------------------------------------------------------------------------------------------

/**
 * Discover every fog hex at a corner of `e`: turn the top hex of the stack (and a token for a
 * land hex) and reward the discoverer with 1 card of the hex (gold: 1 of their choice).
 */
export function discover(draft: GameState, p: PlayerId, e: EdgeId): void {
  const s = seaSlice(draft);
  if (!s.fog) return;
  const g = graph(draft);
  const fogHexes = new Set<HexId>();
  for (const v of g.ends.get(e) ?? []) {
    for (const h of g.hexesAt.get(v) ?? []) {
      if (draft.board.hexes[h]?.terrain === 'fog') fogHexes.add(h);
    }
  }
  for (const h of [...fogHexes].sort()) {
    const tile = draft.board.hexes[h];
    const terrain = s.fog.terrains.pop();
    if (!tile || terrain === undefined) continue;
    const land = terrain !== 'sea';
    const token = land && terrain !== 'desert' ? (s.fog.tokens.pop() ?? null) : null;
    draft.board = {
      ...draft.board,
      hexes: { ...draft.board.hexes, [h]: { ...tile, terrain, token } },
    };
    if (!land) {
      log(draft, p, `${name(draft, p)} discovered open sea`);
      continue;
    }
    log(draft, p, `${name(draft, p)} discovered ${terrain}${token === null ? '' : ` ${token}`}`);
    if (terrain === 'gold') queueGold(draft, p, 1);
    else if (isResource(terrain) && draft.bank[terrain] > 0) {
      const hand = draft.players[p]?.resources;
      if (hand) {
        hand[terrain] += 1;
        draft.bank[terrain] -= 1;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The Forgotten Tribe (§4.8)
// ---------------------------------------------------------------------------------------------

/** Take the gift on `e`, if any. */
export function collectGift(draft: GameState, p: PlayerId, e: EdgeId): void {
  const s = seaSlice(draft);
  const gift = s.gifts?.[e];
  if (!s.gifts || !gift) return;
  Reflect.deleteProperty(s.gifts, e);
  const pl = draft.players[p];
  if (!pl) return;
  if (gift.kind === 'chit') {
    s.chits.push({ player: p, vp: 1, area: 'gift' });
    log(draft, p, `${name(draft, p)} received a gift: 1 victory point`);
  } else if (gift.kind === 'dev') {
    // Like a bought card: not playable this turn (§4.8).
    pl.newDevCards[gift.card] += 1;
    log(draft, p, `${name(draft, p)} received a gift: a development card`);
  } else {
    s.harbors ??= draft.players.map(() => []);
    s.harbors[p] = [...(s.harbors[p] ?? []), gift.port];
    log(draft, p, `${name(draft, p)} received a gift: a harbor`);
    promptHarbor(draft, p);
  }
}

/**
 * Coast edges where `p` may put a harbour now (§4.8): land on one side and water on the other,
 * one corner on their settlement or city, not on or next to another harbour or a gift.
 */
export function harborSpots(state: GameState, p: PlayerId): EdgeId[] {
  const g = graph(state);
  const used = new Set<VertexId>();
  for (const port of state.board.ports) for (const v of port.vertices) used.add(v);
  const gifts = seaSlice(state).gifts ?? {};
  return g.edges.filter((e) => {
    const sides = g.sides.get(e) ?? [];
    const kinds = sides.map((h) => hexKind(state, h));
    if (!kinds.includes('land') || !(kinds.includes('sea') || kinds.includes('frame')))
      return false;
    if (gifts[e] !== undefined) return false;
    const ends = g.ends.get(e) ?? [];
    if (ends.some((v) => used.has(v))) return false;
    return ends.some((v) => state.pieces.buildings[v]?.owner === p);
  });
}

/** If `p` holds a harbour and has a place for it, they must place it now (placeHarbor phase). */
export function promptHarbor(draft: GameState, p: PlayerId): void {
  const held = seaSlice(draft).harbors?.[p] ?? [];
  if (held.length === 0 || draft.phase.kind === 'seafarers/placeHarbor') return;
  if (draft.phase.kind === 'gameOver' || harborSpots(draft, p).length === 0) return;
  const phase: HarborPhase = { kind: 'seafarers/placeHarbor', player: p, resume: draft.phase };
  draft.phase = phase;
}

/** Put `p`'s first held harbour on `e` (copy-on-write board). */
export function placeHarbor(draft: GameState, p: PlayerId, e: EdgeId): PortKind | null {
  const s = seaSlice(draft);
  const held = s.harbors?.[p] ?? [];
  const kind = held[0];
  if (kind === undefined || !s.harbors) return null;
  s.harbors[p] = held.slice(1);
  const g = graph(draft);
  const water = (g.sides.get(e) ?? []).find((h) => hexKind(draft, h) !== 'land') as HexId;
  const [a, b] = g.ends.get(e) as readonly [VertexId, VertexId];
  const port: Port = { kind, edge: e, vertices: [a, b], waterHex: water };
  draft.board = { ...draft.board, ports: [...draft.board.ports, port] };
  return kind;
}

// ---------------------------------------------------------------------------------------------
// Cloth for Catan (§4.9)
// ---------------------------------------------------------------------------------------------

/** Is `v` joined to one of `p`'s buildings by `p`'s ships (not through an opponent's building)? */
export function shipLinked(state: GameState, p: PlayerId, v: VertexId): boolean {
  const g = graph(state);
  const ships = seaSlice(state).ships;
  const seen = new Set<VertexId>([v]);
  const stack = [v];
  while (stack.length > 0) {
    const x = stack.pop() as VertexId;
    if (state.pieces.buildings[x]?.owner === p) return true;
    if (x !== v && blockedFor(state, x, p)) continue;
    for (const e of g.edgesAt.get(x) ?? []) {
      if (ships[e]?.owner !== p) continue;
      const [a, b] = g.ends.get(e) as readonly [VertexId, VertexId];
      const n = a === x ? b : a;
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return false;
}

/** New ship routes to villages: link the player and give them 1 cloth from that village. */
export function updateVillageLinks(draft: GameState): void {
  const cloth = seaSlice(draft).cloth;
  if (!cloth) return;
  for (const [v, village] of Object.entries(cloth.villages) as [
    VertexId,
    (typeof cloth.villages)[VertexId],
  ][]) {
    const links = cloth.links[v] ?? [];
    for (const pl of draft.players) {
      if (links.includes(pl.id) || !shipLinked(draft, pl.id, v)) continue;
      cloth.links[v] = [...(cloth.links[v] ?? []), pl.id];
      if (village.cloth > 0) {
        village.cloth -= 1;
        cloth.held[pl.id] = (cloth.held[pl.id] ?? 0) + 1;
      }
      log(draft, pl.id, `${name(draft, pl.id)} opened trade with a village (+1 cloth)`);
    }
  }
}

/** A roll of `roll`: every village with that number gives each linked player 1 cloth (§4.9). */
export function produceCloth(draft: GameState, roll: number): void {
  const cloth = seaSlice(draft).cloth;
  if (!cloth) return;
  for (const [v, village] of Object.entries(cloth.villages) as [
    VertexId,
    (typeof cloth.villages)[VertexId],
  ][]) {
    if (village.token !== roll || village.cloth === 0) continue;
    for (const p of cloth.links[v] ?? []) {
      if (village.cloth > 0) village.cloth -= 1;
      else if (cloth.supply > 0) cloth.supply -= 1;
      else continue;
      cloth.held[p] = (cloth.held[p] ?? 0) + 1;
      log(draft, p, `${name(draft, p)} received 1 cloth`);
    }
  }
}

/** Villages that still hold cloth. */
export function villagesWithCloth(state: GameState): number {
  const cloth = seaSlice(state).cloth;
  return cloth ? Object.values(cloth.villages).filter((v) => v.cloth > 0).length : 0;
}

// ---------------------------------------------------------------------------------------------
// Special VP for new land (§4.6)
// ---------------------------------------------------------------------------------------------

/** Bonus areas (or islands) a settlement on `v` touches. */
export function areasAt(state: GameState, v: VertexId): string[] {
  const area = seaBoard(state).area;
  const out: string[] = [];
  for (const h of graph(state).hexesAt.get(v) ?? []) {
    const a = area[h];
    if (a !== undefined && hexKind(state, h) === 'land' && !out.includes(a)) out.push(a);
  }
  return out;
}

/** Starting settlement on `v`: its islands become `p`'s home islands. */
export function recordHome(draft: GameState, p: PlayerId, v: VertexId): void {
  if (specOf(keyOf(draft)).bonus !== 'islands') return;
  const s = seaSlice(draft);
  const home = s.home[p] ?? [];
  s.home[p] = [...home, ...areasAt(draft, v).filter((a) => !home.includes(a))];
}

/** The first settlement of `p` on a bonus area / foreign island pays its special VP. */
export function awardNewLand(draft: GameState, p: PlayerId, v: VertexId): void {
  const bonus = rulesOf(draft).bonus;
  if (!bonus) return;
  const s = seaSlice(draft);
  const mine = s.chits.filter((c) => c.player === p && c.area !== 'gift');
  if (bonus.cap !== undefined && mine.length >= bonus.cap) return;
  const home = s.home[p] ?? [];
  const area = areasAt(draft, v).find((a) => !home.includes(a) && !mine.some((c) => c.area === a));
  if (area === undefined) return;
  s.chits.push({ player: p, vp: bonus.vp, area, vertex: v });
  log(draft, p, `${name(draft, p)} settled new land: +${bonus.vp} VP`);
}

/** Special VP of `p` (chits, cloth pairs). */
export function specialVp(state: GameState, p: PlayerId): number {
  const s = seaSlice(state);
  let vp = 0;
  for (const c of s.chits) if (c.player === p) vp += c.vp;
  if (s.cloth) vp += Math.floor((s.cloth.held[p] ?? 0) / 2);
  return vp;
}
