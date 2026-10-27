/**
 * Barbarian Attack + C&K knights (docs/rules/combos.md §10): C&K's knights (levels, activation,
 * promotion, C&K's costs and piece limits) standing on paths as in Barbarian Attack. Recruited on
 * a free castle edge; their actions come at the end of the turn: an active knight moves up to 5
 * paths (and is laid down), an inactive one up to 3, along any path (T&B FAQ 5: past every
 * piece); an active knight may displace a weaker opponent knight within 3 paths. Then the
 * barbarians are expelled with the knights' strength (basic 1, strong 2, mighty 3).
 */
import { log } from '../../../engine/actions/common';
import { hexEdges, topologyOf } from '../../../engine/topology';
import type { EdgeId, GameState, HexId, PlayerId } from '../../../engine/types';
import {
  ABILITY_LEVEL,
  ACTIVATE_ITEM,
  KNIGHT_ITEM,
  KNIGHT_NAMES,
  KNIGHTS_PER_LEVEL,
  PROMOTE_ITEM,
  buildTurn,
  canAfford,
  ckPlayer,
  type Knight,
  type KnightLevel,
} from '../../ck/engine';
import {
  KNIGHT_LOSS_GOLD,
  PRISONER_CONSOLATION_GOLD,
  baOf,
  barbariansOn,
  isCastleEdge,
  tbBoard,
} from '../../tb/engine';
import { edgeDistances, rankByDice, rollLossFamily, setBarbarians } from '../../tb/engine/ba';
import { addGold, pn } from '../../tb/engine/common';
import { isLandPath } from '../../tb/engine/paths';
import { type BackPhase, backSlice, phaseOf } from './state';

/** Paths an active / inactive knight may move at the end of the turn; a displacement's reach. */
export const ACTIVE_STEPS = 5;
export const INACTIVE_STEPS = 3;
export const DISPLACE_STEPS = 3;

export const knightAt = (state: GameState, e: EdgeId): Knight | undefined =>
  backSlice(state).knights[e];

export const knightEdges = (state: GameState, p: PlayerId): EdgeId[] =>
  (Object.keys(backSlice(state).knights) as EdgeId[]).filter(
    (e) => knightAt(state, e)?.owner === p,
  );

const onBoard = (state: GameState, p: PlayerId, level: KnightLevel): number =>
  Object.values(backSlice(state).knights).filter((k) => k.owner === p && k.level === level).length;

/** Knights of `level` still in `p`'s supply (C&K: 2 of each level). */
export const inSupply = (state: GameState, p: PlayerId, level: KnightLevel): number =>
  KNIGHTS_PER_LEVEL - onBoard(state, p, level);

// ---------------------------------------------------------------------------------------------
// Recruit, activate, promote (Action phase or special building phase, C&K's costs)
// ---------------------------------------------------------------------------------------------

/** Free castle edges: where a recruited knight goes. */
export function recruitSpots(state: GameState): EdgeId[] {
  const t = topologyOf(state);
  const castles = tbBoard(state).castles ?? [];
  const edges = new Set(castles.flatMap((h) => hexEdges(t, h)));
  return [...edges].filter((e) => knightAt(state, e) === undefined && isLandPath(state, e)).sort();
}

export function recruitBlocker(state: GameState, p: PlayerId, e: unknown): string | null {
  const t = buildTurn(state, p);
  if (t) return t;
  if (inSupply(state, p, 1) <= 0) return 'no basic knights left (promote one first)';
  if (!canAfford(state, p, KNIGHT_ITEM)) return 'a knight costs 1 sheep and 1 ore';
  if (typeof e !== 'string' || !recruitSpots(state).includes(e as EdgeId)) {
    return 'a new knight goes on a free edge of the castle';
  }
  return null;
}

function ownKnight(state: GameState, p: PlayerId, e: unknown): Knight | null {
  if (typeof e !== 'string') return null;
  const k = knightAt(state, e as EdgeId);
  return k && k.owner === p ? k : null;
}

export function activateBlocker(state: GameState, p: PlayerId, e: unknown): string | null {
  const t = buildTurn(state, p);
  if (t) return t;
  const k = ownKnight(state, p, e);
  if (!k) return 'not your knight';
  if (k.active) return 'that knight is already active';
  return canAfford(state, p, ACTIVATE_ITEM) ? null : 'activating costs 1 wheat';
}

/** Can `p` promote the knight on `e` (C&K: supply, the Fortress for mighty, once a turn)? */
export function promoteBlocker(state: GameState, p: PlayerId, e: unknown, free = false) {
  const k = ownKnight(state, p, e);
  if (!k) return 'not your knight';
  if (k.level >= 3) return 'a mighty knight cannot be promoted';
  if (k.level === 2 && ckPlayer(state, p).improvements.politics < ABILITY_LEVEL) {
    return 'mighty knights need the Fortress (politics level 3)';
  }
  if (k.promotedOn === state.turn.number) return 'that knight was already promoted this turn';
  const next = (k.level + 1) as KnightLevel;
  if (inSupply(state, p, next) <= 0) return `no ${KNIGHT_NAMES[next]} knights left`;
  if (!free && !canAfford(state, p, PROMOTE_ITEM)) return 'promoting costs 1 sheep and 1 ore';
  return null;
}

export const promoteBuildBlocker = (state: GameState, p: PlayerId, e: unknown) =>
  buildTurn(state, p) ?? promoteBlocker(state, p, e);

export function promote(draft: GameState, e: EdgeId): void {
  const k = backSlice(draft).knights[e];
  if (!k) return;
  k.level = (k.level + 1) as KnightLevel;
  k.promotedOn = draft.turn.number;
  log(draft, k.owner, `${pn(draft, k.owner)} promoted a knight to ${KNIGHT_NAMES[k.level]}`);
}

// ---------------------------------------------------------------------------------------------
// End of turn: move and displace
// ---------------------------------------------------------------------------------------------

/** The end-of-turn knight phase may run for `p` now (own turn, not a special build step). */
export function endTurnPhase(state: GameState, p: PlayerId): string | null {
  const k = phaseOf(state).kind;
  if (k !== 'main' && k !== 'back/knights') return 'knights act at the end of your turn';
  if (state.turn.current !== p || state.turn.secondSettlerOf !== undefined) return 'not your turn';
  return null;
}

/**
 * How far the knight on `e` may move now: active 5 (not on the turn it was activated: C&K, a
 * fresh knight cannot act yet), inactive 3; 0 = it stays (moved already this turn).
 */
export function stepsOf(state: GameState, e: EdgeId): number {
  const k = knightAt(state, e);
  if (!k || backSlice(state).moved.includes(e)) return 0;
  if (!k.active) return INACTIVE_STEPS;
  return k.activatedOn === state.turn.number ? 0 : ACTIVE_STEPS;
}

/** Free paths (no knight, not on a castle) within `max` paths of `from`, with their distance. */
function freePaths(state: GameState, from: EdgeId, max: number): Map<EdgeId, number> {
  const out = new Map<EdgeId, number>();
  for (const [e, d] of edgeDistances(state, from, max)) {
    if (d > 0 && knightAt(state, e) === undefined && !isCastleEdge(state, e)) out.set(e, d);
  }
  return out;
}

export const moveTargets = (state: GameState, from: EdgeId): EdgeId[] =>
  [...freePaths(state, from, stepsOf(state, from)).keys()].sort();

/** Opponent knights the knight on `from` may displace: weaker, within 3 paths; active knights only. */
export function displaceTargets(state: GameState, from: EdgeId): EdgeId[] {
  const k = knightAt(state, from);
  if (!k || !k.active || stepsOf(state, from) === 0) return [];
  const out: EdgeId[] = [];
  for (const [e, d] of edgeDistances(state, from, DISPLACE_STEPS)) {
    const o = knightAt(state, e);
    if (d > 0 && o && o.owner !== k.owner && o.level < k.level) out.push(e);
  }
  return out.sort();
}

/** May `p` pick up the knight on `e` now (own, has somewhere to go or someone to displace)? */
export function canSelect(state: GameState, p: PlayerId, e: EdgeId): boolean {
  return (
    knightAt(state, e)?.owner === p &&
    (moveTargets(state, e).length > 0 || displaceTargets(state, e).length > 0)
  );
}

/** `p`'s knights on a castle edge that must still leave it (BA: none ends a turn there). */
export const castleKnights = (state: GameState, p: PlayerId): EdgeId[] =>
  knightEdges(state, p).filter((e) => isCastleEdge(state, e) && moveTargets(state, e).length > 0);

function place(draft: GameState, from: EdgeId, to: EdgeId, k: Knight): void {
  const s = backSlice(draft);
  Reflect.deleteProperty(s.knights, from);
  s.knights[to] = k;
  s.moved.push(to);
}

export function moveKnight(draft: GameState, from: EdgeId, to: EdgeId): void {
  const k = knightAt(draft, from);
  if (!k) return;
  const was = k.active;
  k.active = false;
  place(draft, from, to, k);
  log(draft, k.owner, `${pn(draft, k.owner)} moved a knight${was ? ' (now inactive)' : ''}`);
}

/**
 * The nearest free paths to `e` (T&B FAQ 2: the owner of a displaced knight places it on the next
 * free path); none within reach: back to the supply.
 */
export function relocationSpots(state: GameState, e: EdgeId): EdgeId[] {
  const free = freePaths(state, e, 12);
  const best = Math.min(...free.values());
  return [...free]
    .filter(([, d]) => d === best)
    .map(([x]) => x)
    .sort();
}

/** The knight on `from` displaces the one on `to`: both lie down; returns the relocation step. */
export function displace(draft: GameState, from: EdgeId, to: EdgeId): BackPhase | null {
  const s = backSlice(draft);
  const k = s.knights[from];
  const victim = s.knights[to];
  if (!k || !victim) return null;
  Reflect.deleteProperty(s.knights, to);
  k.active = false;
  place(draft, from, to, k);
  const out: Knight = { ...victim, active: false };
  log(
    draft,
    k.owner,
    `${pn(draft, k.owner)}'s knight displaced a knight of ${pn(draft, out.owner)}`,
  );
  const spots = relocationSpots(draft, to);
  if (spots.length === 0) {
    log(draft, out.owner, `${pn(draft, out.owner)}'s knight had nowhere to go and was removed`);
    return null;
  }
  if (spots.length === 1) {
    s.knights[spots[0] as EdgeId] = out;
    return null;
  }
  return { kind: 'back/relocate', knight: out, spots };
}

// ---------------------------------------------------------------------------------------------
// Expelling the barbarians (end of turn, after the knights moved: T&B FAQ 9)
// ---------------------------------------------------------------------------------------------

const strengthOf = (k: Knight): number => k.level;

/**
 * A lost knight steps down a level (mighty → strong → basic, using what the supply has) or goes
 * back to the supply; its owner gets 3 gold either way.
 */
function wound(draft: GameState, e: EdgeId): void {
  const s = backSlice(draft);
  const k = s.knights[e];
  if (!k) return;
  const levels = ([3, 2, 1] as const).filter((l) => l < k.level && inSupply(draft, k.owner, l) > 0);
  const to = levels[0];
  if (to === undefined) Reflect.deleteProperty(s.knights, e);
  else k.level = to;
  addGold(draft, k.owner, KNIGHT_LOSS_GOLD);
  log(
    draft,
    k.owner,
    `${pn(draft, k.owner)}'s knight ${to === undefined ? 'was lost' : `became ${KNIGHT_NAMES[to]}`} (+${KNIGHT_LOSS_GOLD} gold)`,
  );
}

/** One coastal hex: a victory when the active knights' strength beats the barbarians. */
function battle(draft: GameState, h: HexId, wounded: Set<EdgeId>): void {
  const s = backSlice(draft);
  const ba = baOf(draft);
  const barbarians = barbariansOn(draft, h);
  const fighters = hexEdges(topologyOf(draft), h).filter(
    (e) => s.knights[e]?.active === true && !wounded.has(e),
  );
  const strength = new Map<PlayerId, number>();
  for (const e of fighters) {
    const k = s.knights[e] as Knight;
    strength.set(k.owner, (strength.get(k.owner) ?? 0) + strengthOf(k));
  }
  const total = [...strength.values()].reduce((a, b) => a + b, 0);
  if (barbarians === 0 || total <= barbarians) return;
  log(
    draft,
    null,
    `The knights (${total}) beat ${barbarians} barbarian${barbarians > 1 ? 's' : ''} on ${draft.board.hexes[h]?.token ?? '?'}`,
  );

  const give = (p: PlayerId, n: number) => {
    ba.prisoners[p] = (ba.prisoners[p] ?? 0) + n;
    log(draft, p, `${pn(draft, p)} took ${n} prisoner${n > 1 ? 's' : ''}`);
  };
  const consolation = (p: PlayerId) => {
    addGold(draft, p, PRISONER_CONSOLATION_GOLD);
    log(draft, p, `${pn(draft, p)} got ${PRISONER_CONSOLATION_GOLD} gold instead`);
  };
  const involved = [...strength.keys()].sort((a, b) => a - b);
  if (involved.length === 1) give(involved[0] as PlayerId, barbarians);
  else if (barbarians < involved.length) {
    rankByDice(draft, involved).forEach((p, i) => (i < barbarians ? give(p, 1) : consolation(p)));
  } else {
    for (const p of involved) give(p, 1);
    if (barbarians > involved.length) {
      // The rest goes to the highest total strength (the sheet); a tie is rolled for (BA).
      const most = Math.max(...strength.values());
      const top = involved.filter((p) => strength.get(p) === most);
      const [winner, ...losers] = rankByDice(draft, top);
      if (winner !== undefined) give(winner, barbarians - involved.length);
      for (const p of losers) consolation(p);
    }
  }
  setBarbarians(draft, h, 0);
  const lost = rollLossFamily(draft);
  for (const e of fighters) {
    if (!lost(e)) continue;
    wounded.add(e);
    wound(draft, e);
  }
}

/** Every coastal hex in BA's check order; a wounded knight fights no second battle (FAQ 8). */
export function expel(draft: GameState): void {
  const wounded = new Set<EdgeId>();
  for (const h of tbBoard(draft).coast ?? []) battle(draft, h, wounded);
}
