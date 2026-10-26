/**
 * Barbarian Attack (docs/rules/traders-barbarians.md §2.5, §3.6, §4.8): every settlement or city
 * built lands up to 3 barbarians on the coast; 3 conquer a hex (no production, no building next
 * to it, buildings with only conquered hexes around give 0 VP and lose their harbour). Knights
 * enter through the BA development cards (bought and resolved at once), move at the end of the
 * turn and then expel barbarians; prisoners score 1 VP per 2. No robber: a 7 lets the roller
 * steal from any player.
 *
 * Choices made (§10): a card that cannot be resolved does nothing (Q10); Treason's destinations
 * are two different hexes, each different from its source (Q11); a knight may stay put (Q20).
 * 5-6 SBP details (knighthood moved after the step, re-checks after each step) are not modelled:
 * the expulsion runs once, at the end of the owner's turn.
 */
import { log } from '../../../engine/actions/common';
import { isBuildPhase } from '../../../engine/actions/build';
import { costOf } from '../../../engine/expansions/hooks';
import { hasResources } from '../../../engine/resources';
import { Rng } from '../../../engine/rng';
import { edgeNeighbors, hexEdges, topologyOf } from '../../../engine/topology';
import type {
  Action,
  EdgeId,
  GameState,
  HexId,
  PlayerId,
  ResourceCounts,
  VertexId,
} from '../../../engine/types';
import { addGold, payBank, pn, rollDie, rollTwo } from './common';
import { CONQUER_AT, isConqueredBuilding, isConqueredHex } from './conquest';
import { isLandPath } from './paths';
import {
  BA_BARBARIANS_34,
  BA_BARBARIANS_56,
  BA_CARD_ITEM,
  BA_DECK,
  KNIGHTS_PER_PLAYER,
  KNIGHT_LOSS_GOLD,
  KNIGHT_STEPS,
  KNIGHT_STEPS_GRAIN,
  PRISONER_CONSOLATION_GOLD,
  TREASON_GOLD,
  baOf,
  tbBoard,
  type BaCard,
  type BaSlice,
  type ResumeTo,
  type TbPhase,
} from './state';

export function initBa(state: GameState, rng: Rng): BaSlice {
  const coast = tbBoard(state).coast ?? [];
  const onHex: Record<HexId, number> = {};
  // One barbarian on a coastal "2" and one on a coastal "12".
  for (const n of [2, 12]) {
    const h = coast.find((x) => state.board.hexes[x]?.token === n);
    if (h) onHex[h] = 1;
  }
  const total = state.players.length > 4 ? BA_BARBARIANS_56 : BA_BARBARIANS_34;
  return {
    onHex,
    supply: total - Object.keys(onHex).length,
    prisoners: state.players.map(() => 0),
    knights: {},
    deck: rng.shuffle(BA_DECK.flatMap(([c, k]) => Array<BaCard>(k).fill(c))),
    discard: [],
    moved: [],
  };
}

const coastOf = (state: GameState): HexId[] => tbBoard(state).coast ?? [];
export const barbariansOn = (state: GameState, h: HexId): number => baOf(state).onHex[h] ?? 0;

function setBarbarians(draft: GameState, h: HexId, n: number): void {
  const s = baOf(draft);
  const was = s.onHex[h] ?? 0;
  if (n > 0) s.onHex[h] = n;
  else Reflect.deleteProperty(s.onHex, h);
  const name = draft.board.hexes[h]?.token ?? '?';
  if (was < CONQUER_AT && n >= CONQUER_AT)
    log(draft, null, `The barbarians conquered the ${name} hex`);
  if (was >= CONQUER_AT && n < CONQUER_AT) log(draft, null, `The ${name} hex is free again`);
}

/**
 * Barbarians land (after a settlement or city is built): up to three rolls, each not 7 and
 * different from the earlier ones; one barbarian on each coastal hex with that number, unless it
 * already holds 3. Stops when the supply is empty.
 */
export function landBarbarians(draft: GameState): void {
  const s = baOf(draft);
  const coast = coastOf(draft);
  const used: number[] = [];
  for (let i = 0; i < 3 && s.supply > 0; i++) {
    let n = 7;
    for (let tries = 0; tries < 200 && (n === 7 || used.includes(n)); tries++) n = rollTwo(draft);
    if (n === 7 || used.includes(n)) break;
    used.push(n);
    const hexes = coast.filter((h) => draft.board.hexes[h]?.token === n);
    let landed = 0;
    for (const h of hexes) {
      const k = s.onHex[h] ?? 0;
      if (k >= CONQUER_AT || s.supply <= 0) continue;
      s.supply -= 1;
      setBarbarians(draft, h, k + 1);
      landed += 1;
    }
    log(draft, null, `Barbarians land on ${n}${landed === 0 ? ' (no room)' : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Knights
// ---------------------------------------------------------------------------

const castleHexes = (state: GameState): HexId[] => tbBoard(state).castles ?? [];

export function isCastleEdge(state: GameState, e: EdgeId): boolean {
  const t = topologyOf(state);
  return castleHexes(state).some((h) => hexEdges(t, h).includes(e));
}

export const knightsOf = (state: GameState, p: PlayerId): EdgeId[] =>
  (Object.keys(baOf(state).knights) as EdgeId[]).filter((e) => baOf(state).knights[e] === p);

export const knightsLeft = (state: GameState, p: PlayerId): number =>
  KNIGHTS_PER_PLAYER - knightsOf(state, p).length;

/**
 * Free edges (no knight) for a new knight: the castle's (Knighthood) or any (Swift Knight).
 * Knights stay on land paths (a Seafarers map has sea board hexes: T&B + Seafarers).
 */
export function knightSpots(state: GameState, card: 'knighthood' | 'swiftKnight'): EdgeId[] {
  const s = baOf(state);
  const t = topologyOf(state);
  const pool = card === 'knighthood' ? castleHexes(state).flatMap((h) => hexEdges(t, h)) : t.edges;
  return [...new Set(pool)].filter((e) => s.knights[e] === undefined && isLandPath(state, e));
}

/** Edge distance (steps between land edges sharing a vertex) from `from`, up to `max`. */
function edgeDistances(state: GameState, from: EdgeId, max: number): Map<EdgeId, number> {
  const t = topologyOf(state);
  const dist = new Map<EdgeId, number>([[from, 0]]);
  let frontier = [from];
  for (let d = 1; d <= max; d++) {
    const next: EdgeId[] = [];
    for (const e of frontier) {
      for (const n of edgeNeighbors(t, e)) {
        if (dist.has(n) || !isLandPath(state, n)) continue;
        dist.set(n, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

/** Where the knight on `from` may move: free, not on the castle; with the steps it takes. */
export function knightTargets(state: GameState, from: EdgeId): Map<EdgeId, number> {
  const s = baOf(state);
  const grain = (state.players[s.knights[from] ?? -1]?.resources.grain ?? 0) > 0;
  return knightReach(state, from, grain ? KNIGHT_STEPS_GRAIN : KNIGHT_STEPS);
}

/** Free, non-castle paths within `max` steps of the knight on `from` (Fishing + BA: 2 fish = 5). */
export function knightReach(state: GameState, from: EdgeId, max: number): Map<EdgeId, number> {
  const s = baOf(state);
  const out = new Map<EdgeId, number>();
  for (const [e, d] of edgeDistances(state, from, max)) {
    if (d === 0 || s.knights[e] !== undefined || isCastleEdge(state, e)) continue;
    out.set(e, d);
  }
  return out;
}

/** May `p` pick up the knight on `e` now (own, not moved this turn, somewhere to go)? */
export function canSelectKnight(state: GameState, p: PlayerId, e: EdgeId): boolean {
  const s = baOf(state);
  return s.knights[e] === p && !s.moved.includes(e) && knightTargets(state, e).size > 0;
}

/** Knights of `p` that must still leave a castle edge before the turn can end. */
export function castleKnightsToMove(state: GameState, p: PlayerId): EdgeId[] {
  return knightsOf(state, p).filter((e) => isCastleEdge(state, e) && canSelectKnight(state, p, e));
}

export function moveKnight(draft: GameState, from: EdgeId, to: EdgeId): void {
  const s = baOf(draft);
  const owner = s.knights[from] as PlayerId;
  const d = knightTargets(draft, from).get(to) ?? 0;
  if (d > KNIGHT_STEPS) payBank(draft, owner, { grain: 1 });
  Reflect.deleteProperty(s.knights, from);
  s.knights[to] = owner;
  s.moved.push(to);
  log(
    draft,
    owner,
    `${pn(draft, owner)} moved a knight${d > KNIGHT_STEPS ? ' (paid 1 grain)' : ''}`,
  );
}

// ---------------------------------------------------------------------------
// Expelling the barbarians (end of turn)
// ---------------------------------------------------------------------------

/** Orientation family of an edge (parallel edges): the die picks one (1&4, 2&5, 3&6). */
const family = (e: EdgeId): string => e.slice(e.lastIndexOf(',') + 1);
const FAMILY_OF_DIE = ['SE', 'NE', 'E'] as const;

/** Players ranked by die rolls, ties re-rolled among the tied (highest first). */
function rankByDice(draft: GameState, players: PlayerId[]): PlayerId[] {
  if (players.length <= 1) return players;
  const rolls = new Map(players.map((p) => [p, rollDie(draft)]));
  const values = [...new Set(rolls.values())].sort((a, b) => b - a);
  return values.flatMap((v) =>
    rankByDice(
      draft,
      players.filter((p) => rolls.get(p) === v),
    ),
  );
}

function battle(draft: GameState, h: HexId): void {
  const s = baOf(draft);
  const t = topologyOf(draft);
  const barbarians = s.onHex[h] ?? 0;
  const edges = hexEdges(t, h).filter((e) => s.knights[e] !== undefined);
  if (barbarians === 0 || edges.length <= barbarians) return;
  const count = new Map<PlayerId, number>();
  for (const e of edges) {
    const o = s.knights[e] as PlayerId;
    count.set(o, (count.get(o) ?? 0) + 1);
  }
  const involved = [...count.keys()].sort((a, b) => a - b);
  log(
    draft,
    null,
    `The knights beat ${barbarians} barbarian${barbarians > 1 ? 's' : ''} on ${draft.board.hexes[h]?.token ?? '?'}`,
  );
  const give = (p: PlayerId, n: number) => {
    s.prisoners[p] = (s.prisoners[p] ?? 0) + n;
    log(draft, p, `${pn(draft, p)} took ${n} prisoner${n > 1 ? 's' : ''}`);
  };
  const console = (p: PlayerId) => {
    addGold(draft, p, PRISONER_CONSOLATION_GOLD);
    log(draft, p, `${pn(draft, p)} got ${PRISONER_CONSOLATION_GOLD} gold instead`);
  };
  if (involved.length === 1) {
    give(involved[0] as PlayerId, barbarians);
  } else if (barbarians < involved.length) {
    const ranked = rankByDice(draft, involved);
    ranked.forEach((p, i) => (i < barbarians ? give(p, 1) : console(p)));
  } else {
    for (const p of involved) give(p, 1);
    if (barbarians > involved.length) {
      const most = Math.max(...count.values());
      const top = involved.filter((p) => count.get(p) === most);
      const [winner, ...losers] = rankByDice(draft, top);
      if (winner !== undefined) give(winner, barbarians - involved.length);
      for (const p of losers) console(p);
    }
  }
  setBarbarians(draft, h, 0);
  // Knight losses: one die picks an orientation; involved knights on it go home (3 gold each).
  const fam = FAMILY_OF_DIE[rollDie(draft) % 3] as string;
  for (const e of edges) {
    if (family(e) !== fam) continue;
    const o = s.knights[e] as PlayerId;
    Reflect.deleteProperty(s.knights, e);
    addGold(draft, o, KNIGHT_LOSS_GOLD);
    log(draft, o, `${pn(draft, o)} lost a knight and got ${KNIGHT_LOSS_GOLD} gold`);
  }
}

/** Every coastal hex in check order: a victory where knights outnumber the barbarians. */
export function expelBarbarians(draft: GameState): void {
  for (const h of coastOf(draft)) battle(draft, h);
}

// ---------------------------------------------------------------------------
// Development cards (bought and resolved at once)
// ---------------------------------------------------------------------------

export function buyCardBlocker(state: GameState, p: PlayerId): string | null {
  if (!isBuildPhase(state)) return 'buy cards in the main or special building phase';
  if (state.turn.current !== p) return 'not your turn';
  const s = baOf(state);
  if (s.deck.length + s.discard.length === 0) return 'no development cards left';
  const hand = state.players[p]?.resources;
  const cost = costOf(state, BA_CARD_ITEM);
  if (!hand || !cost || !hasResources(hand, cost)) return 'cannot afford a development card';
  return null;
}

function drawCard(draft: GameState): BaCard | null {
  const s = baOf(draft);
  if (s.deck.length === 0 && s.discard.length > 0) {
    const rng = new Rng(draft.rng);
    s.deck = rng.shuffle(s.discard);
    s.discard = [];
    draft.rng = rng.state;
    log(draft, null, 'The development cards were reshuffled');
  }
  return s.deck.pop() ?? null;
}

const CARD_NAME: Readonly<Record<BaCard, string>> = {
  knighthood: 'Knighthood',
  swiftKnight: 'Swift Knight',
  treason: 'Treason',
  intrigue: 'Intrigue',
};

export const treasonSources = (state: GameState, used: readonly HexId[]): HexId[] =>
  coastOf(state).filter((h) => barbariansOn(state, h) > 0 && !used.includes(h));

export function treasonDests(
  state: GameState,
  from: HexId | 'supply',
  used: readonly HexId[],
): HexId[] {
  return coastOf(state).filter(
    (h) => h !== from && !used.includes(h) && barbariansOn(state, h) < CONQUER_AT,
  );
}

/** Pay for and resolve a card; returns the phase it opens (or null: back to the turn). */
export function buyCard(draft: GameState, p: PlayerId, cost: ResourceCounts): TbPhase | null {
  payBank(draft, p, cost);
  const s = baOf(draft);
  const resume: ResumeTo = draft.phase.kind === 'specialBuild' ? 'specialBuild' : 'main';
  for (let guard = 0; guard < 64; guard++) {
    const card = drawCard(draft);
    if (card === null) return null;
    s.discard.push(card);
    log(draft, p, `${pn(draft, p)} drew ${CARD_NAME[card]}`);
    switch (card) {
      case 'knighthood':
      case 'swiftKnight':
        if (knightsLeft(draft, p) > 0 && knightSpots(draft, card).length > 0) {
          return { kind: 'tb/placeKnight', card, resume };
        }
        log(draft, p, 'No knight can be placed');
        return null;
      case 'treason': {
        addGold(draft, p, TREASON_GOLD);
        const next = treasonStep(draft, {
          kind: 'tb/treason',
          left: 2,
          from: null,
          sources: [],
          dests: [],
          resume,
        });
        return next;
      }
      case 'intrigue':
        if (treasonSources(draft, []).length > 0) return { kind: 'tb/intrigue', resume };
        // No barbarian on the coast: discard it and draw again.
        break;
    }
  }
  return null;
}

/**
 * Advance a Treason card: pick a source (or take one from the supply when the coast has none
 * left to pick), then a destination. Returns the phase to stay in, or null when done.
 */
export function treasonStep(
  draft: GameState,
  phase: Extract<TbPhase, { kind: 'tb/treason' }>,
): TbPhase | null {
  const s = baOf(draft);
  if (phase.left <= 0) return null;
  if (phase.from === null) {
    if (treasonSources(draft, phase.sources).length > 0) return phase;
    if (s.supply <= 0) return null;
    phase.from = 'supply';
  }
  return treasonDests(draft, phase.from, phase.dests).length > 0 ? phase : null;
}

export function treasonMove(
  draft: GameState,
  phase: Extract<TbPhase, { kind: 'tb/treason' }>,
  to: HexId,
): void {
  const s = baOf(draft);
  const from = phase.from;
  if (from === 'supply') s.supply -= 1;
  else if (from !== null) {
    setBarbarians(draft, from, barbariansOn(draft, from) - 1);
    phase.sources.push(from);
  }
  setBarbarians(draft, to, barbariansOn(draft, to) + 1);
  phase.dests.push(to);
  phase.left -= 1;
  phase.from = null;
  log(draft, draft.turn.current, `${pn(draft, draft.turn.current)} moved a barbarian`);
}

export function takePrisoner(draft: GameState, p: PlayerId, h: HexId): void {
  const s = baOf(draft);
  setBarbarians(draft, h, barbariansOn(draft, h) - 1);
  s.prisoners[p] = (s.prisoners[p] ?? 0) + 1;
  log(draft, p, `${pn(draft, p)} took a barbarian prisoner`);
}

// ---------------------------------------------------------------------------
// Production, building bans, VP, harbours
// ---------------------------------------------------------------------------

/** Remove what conquered hexes would have paid (production hook). */
export function conqueredProduction(
  state: GameState,
  roll: number,
  owed: ResourceCounts[],
  cityYield: number,
): void {
  const t = topologyOf(state);
  for (const h of coastOf(state)) {
    const tile = state.board.hexes[h];
    if (!tile || tile.token !== roll || !isConqueredHex(state, h)) continue;
    const r = tile.terrain;
    if (r !== 'brick' && r !== 'lumber' && r !== 'wool' && r !== 'grain' && r !== 'ore') continue;
    for (const v of t.hex[h]?.vertices ?? []) {
      const b = state.pieces.buildings[v];
      const hand = b && owed[b.owner];
      if (hand) hand[r] = Math.max(0, hand[r] - (b.kind === 'city' ? cityYield : 1));
    }
  }
}

export const vertexNextToConquered = (state: GameState, v: VertexId): boolean =>
  (topologyOf(state).vertex[v]?.hexes ?? []).some((h) => isConqueredHex(state, h));
export const edgeNextToConquered = (state: GameState, e: EdgeId): boolean =>
  (topologyOf(state).edge[e]?.hexes ?? []).some((h) => isConqueredHex(state, h));

/** Prisoners (1 VP per 2) and conquered buildings (worth nothing: -1 / -2). */
export function baVictoryParts(state: GameState, p: PlayerId): { label: string; vp: number }[] {
  const out: { label: string; vp: number }[] = [];
  const prisoners = Math.floor((baOf(state).prisoners[p] ?? 0) / 2);
  if (prisoners > 0) out.push({ label: 'Prisoners', vp: prisoners });
  let lost = 0;
  for (const [v, b] of Object.entries(state.pieces.buildings) as [
    VertexId,
    { owner: number; kind: string },
  ][]) {
    if (b.owner === p && isConqueredBuilding(state, v)) lost += b.kind === 'city' ? 2 : 1;
  }
  if (lost > 0) out.push({ label: 'Conquered', vp: -lost });
  return out;
}

/** Harbour ratio without the harbours of conquered buildings. */
export function baTradeRatio(state: GameState, p: PlayerId, r: string): number {
  let ratio = 4;
  for (const port of state.board.ports) {
    const mine = port.vertices.some(
      (v) => state.pieces.buildings[v]?.owner === p && !isConqueredBuilding(state, v),
    );
    if (!mine) continue;
    if (port.kind === r) ratio = Math.min(ratio, 2);
    else if (port.kind === 'generic') ratio = Math.min(ratio, 3);
  }
  return ratio;
}

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

export function baLegal(state: GameState): Action[] {
  const p = state.turn.current;
  const s = baOf(state);
  const phase = state.phase as unknown as TbPhase | { kind: string };
  const out: Action[] = [];
  const act = (a: Record<string, unknown>) => out.push({ player: p, ...a } as unknown as Action);
  switch (phase.kind) {
    case 'main':
    case 'specialBuild':
      if (buyCardBlocker(state, p) === null) act({ type: 'tb/buyCard' });
      if (phase.kind === 'main' && state.turn.secondSettlerOf === undefined) {
        for (const e of knightsOf(state, p)) {
          if (canSelectKnight(state, p, e)) act({ type: 'tb/startKnights', edge: e });
        }
      }
      break;
    case 'tb/placeKnight': {
      const card = (phase as Extract<TbPhase, { kind: 'tb/placeKnight' }>).card;
      for (const e of knightSpots(state, card)) act({ type: 'tb/placeKnight', edge: e });
      break;
    }
    case 'tb/treason': {
      const t = phase as Extract<TbPhase, { kind: 'tb/treason' }>;
      const hexes =
        t.from === null ? treasonSources(state, t.sources) : treasonDests(state, t.from, t.dests);
      for (const h of hexes) act({ type: 'tb/treasonHex', hex: h });
      break;
    }
    case 'tb/intrigue':
      for (const h of treasonSources(state, [])) act({ type: 'tb/intrigueHex', hex: h });
      break;
    case 'tb/knights': {
      const from = (phase as Extract<TbPhase, { kind: 'tb/knights' }>).from;
      for (const e of knightsOf(state, p)) {
        if (e !== from && canSelectKnight(state, p, e)) act({ type: 'tb/selectKnight', edge: e });
      }
      if (from !== null && s.knights[from] === p) {
        for (const e of knightTargets(state, from).keys()) act({ type: 'tb/moveKnight', edge: e });
      }
      break;
    }
    default:
      break;
  }
  return out;
}
