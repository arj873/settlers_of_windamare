/**
 * Cities & Knights rules shared by the handlers and the legal generator: goods (resources +
 * commodities), knights, improvements, walls, progress card draws, the event die and the
 * barbarian attack, commodity production. docs/rules/cities-knights.md (CK-n).
 */
import { RESOURCES } from '../../../engine/constants';
import { log, resumePhase } from '../../../engine/actions/common';
import { startRobber } from '../../../engine/actions/robber';
import { continueRoll } from '../../../engine/actions/turn';
import { rollTwoDice } from '../../../engine/rules/dice';
import { costOf, pieceLimit } from '../../../engine/expansions/hooks';
import { Rng } from '../../../engine/rng';
import { hasResources, isResource, subtractResources } from '../../../engine/resources';
import { playerName } from '../../../engine/rules/text';
import { buildingsOf, cardsInHand, piecesLeft } from '../../../engine/selectors';
import { hexVertices, topologyOf, vertexHexes } from '../../../engine/topology';
import type {
  GameState,
  HexId,
  Phase,
  PlayerId,
  Resource,
  ResourceCounts,
  VertexId,
} from '../../../engine/types';
import { hasRobber, robberTargets } from '../../../engine/variants';
import { canPlaceKnightAt, foreignPieceAt, moveTargets, reachable } from './routes';
import {
  ABILITY_LEVEL,
  BARBARIAN_STEPS,
  CARD_NAMES,
  COMMODITIES,
  COMMODITY_OF,
  EVENT_DIE,
  KNIGHT_NAMES,
  MAX_LEVEL,
  METROPOLIS_LEVEL,
  PROGRESS_HAND_MAX,
  TRACK_COMMODITY,
  TRACKS,
  activeStrength,
  barbarianStrength,
  ckPlayer,
  CK,
  ckSlice,
  defenderStrength,
  isCommodity,
  isRobberActive,
  isVpCard,
  metropolisVertices,
  redDieDraws,
  MAX_KNIGHT_CANCELS,
  phaseOf,
  shipSails,
  type CkPhase,
  type Commodity,
  type CommodityBundle,
  type EventFace,
  type Good,
  type Knight,
  type KnightLevel,
  type ProgressCard,
  type Then,
  type Track,
} from './state';

export const KNIGHT_ITEM = 'ck/knight';
export const PROMOTE_ITEM = 'ck/promote';
export const ACTIVATE_ITEM = 'ck/activate';
export const WALL_ITEM = 'ck/wall';
export const MEDICINE_ITEM = 'ck/medicine';
/** pieceLimit kinds: 'ck/knight1' .. 'ck/knight3', 'ck/wall'. */
export const knightKind = (level: KnightLevel) => `ck/knight${level}`;

export const KNIGHT_COST: ResourceCounts = { brick: 0, lumber: 0, wool: 1, grain: 0, ore: 1 };
export const PROMOTE_COST: ResourceCounts = { brick: 0, lumber: 0, wool: 1, grain: 0, ore: 1 };
export const ACTIVATE_COST: ResourceCounts = { brick: 0, lumber: 0, wool: 0, grain: 1, ore: 0 };
export const WALL_COST: ResourceCounts = { brick: 2, lumber: 0, wool: 0, grain: 0, ore: 0 };
export const MEDICINE_COST: ResourceCounts = { brick: 0, lumber: 0, wool: 0, grain: 1, ore: 2 };

const pn = playerName;

// ---------------------------------------------------------------------------
// Goods
// ---------------------------------------------------------------------------

export function goodCount(state: GameState, p: PlayerId, g: Good): number {
  if (isCommodity(g)) return ckSlice(state).players[p]?.commodities[g] ?? 0;
  return state.players[p]?.resources[g] ?? 0;
}

export function bankCount(state: GameState, g: Good): number {
  return isCommodity(g) ? ckSlice(state).bank[g] : state.bank[g];
}

/** Move `n` cards of `g` between hands and the bank (no checks). */
export function moveGood(
  draft: GameState,
  from: PlayerId | 'bank',
  to: PlayerId | 'bank',
  g: Good,
  n = 1,
): void {
  const s = ckSlice(draft);
  const pile = (who: PlayerId | 'bank'): Record<string, number> | undefined => {
    if (who === 'bank') return isCommodity(g) ? s.bank : draft.bank;
    return isCommodity(g) ? s.players[who]?.commodities : draft.players[who]?.resources;
  };
  const a = pile(from);
  const b = pile(to);
  if (!a || !b) return;
  a[g] = (a[g] ?? 0) - n;
  b[g] = (b[g] ?? 0) + n;
}

/** Every card of `p`'s hand, one entry per card (resources first). */
export function handCards(state: GameState, p: PlayerId): Good[] {
  const out: Good[] = [];
  for (const r of RESOURCES) for (let i = 0; i < goodCount(state, p, r); i++) out.push(r);
  for (const c of COMMODITIES) for (let i = 0; i < goodCount(state, p, c); i++) out.push(c);
  return out;
}

export const cardsOf = (state: GameState, p: PlayerId): number => cardsInHand(state, p);

/** Take one random card from `victim` to `thief` (seeded RNG). Returns the card or null. */
export function stealRandom(draft: GameState, thief: PlayerId, victim: PlayerId): Good | null {
  const cards = handCards(draft, victim);
  if (cards.length === 0) return null;
  const rng = new Rng(draft.rng);
  const card = rng.pick(cards);
  draft.rng = rng.state;
  moveGood(draft, victim, thief, card);
  return card;
}

/** Validate a resource + commodity bundle (non-negative integers, known keys). */
export function isGoodsBundle(resources: unknown, commodities: unknown): boolean {
  const ok = (x: unknown, keys: readonly string[]) =>
    typeof x === 'object' &&
    x !== null &&
    !Array.isArray(x) &&
    Object.entries(x).every(
      ([k, v]) => keys.includes(k) && typeof v === 'number' && Number.isInteger(v) && v >= 0,
    );
  return ok(resources, RESOURCES) && ok(commodities, COMMODITIES);
}

export function holdsGoods(
  state: GameState,
  p: PlayerId,
  resources: Partial<ResourceCounts>,
  commodities: CommodityBundle,
): boolean {
  return (
    RESOURCES.every((r) => goodCount(state, p, r) >= (resources[r] ?? 0)) &&
    COMMODITIES.every((c) => goodCount(state, p, c) >= (commodities[c] ?? 0))
  );
}

export const bundleSize = (resources: Partial<ResourceCounts>, commodities: CommodityBundle) =>
  RESOURCES.reduce((n, r) => n + (resources[r] ?? 0), 0) +
  COMMODITIES.reduce((n, c) => n + (commodities[c] ?? 0), 0);

/** Move a whole bundle from `from` to `to`. */
export function moveBundle(
  draft: GameState,
  from: PlayerId,
  to: PlayerId | 'bank',
  resources: Partial<ResourceCounts>,
  commodities: CommodityBundle,
): void {
  for (const r of RESOURCES)
    if ((resources[r] ?? 0) > 0) moveGood(draft, from, to, r, resources[r]);
  for (const c of COMMODITIES) {
    if ((commodities[c] ?? 0) > 0) moveGood(draft, from, to, c, commodities[c]);
  }
}

/** Every way to choose `count` cards from `p`'s hand (resources + commodities), bounded. */
export function bundleOptions(
  state: GameState,
  p: PlayerId,
  count: number,
  limit = 400,
): { resources: Partial<ResourceCounts>; commodities: CommodityBundle }[] {
  const kinds: Good[] = [...RESOURCES, ...COMMODITIES];
  const have = kinds.map((g) => goodCount(state, p, g));
  const out: { resources: Partial<ResourceCounts>; commodities: CommodityBundle }[] = [];
  const pick: number[] = kinds.map(() => 0);
  const walk = (i: number, left: number): void => {
    if (out.length >= limit) return;
    if (i === kinds.length) {
      if (left === 0) {
        const resources: Partial<ResourceCounts> = {};
        const commodities: CommodityBundle = {};
        kinds.forEach((g, j) => {
          const n = pick[j] ?? 0;
          if (n === 0) return;
          if (isCommodity(g)) commodities[g] = n;
          else resources[g] = n;
        });
        out.push({ resources, commodities });
      }
      return;
    }
    const rest = have.slice(i + 1).reduce((a, b) => a + b, 0);
    const min = Math.max(0, left - rest);
    const max = Math.min(have[i] ?? 0, left);
    for (let k = max; k >= min; k--) {
      pick[i] = k;
      walk(i + 1, left - k);
    }
    pick[i] = 0;
  };
  walk(0, count);
  return out;
}

/** Pay a resource cost into the bank. */
export function payResources(draft: GameState, p: PlayerId, cost: ResourceCounts): void {
  const pl = draft.players[p];
  if (!pl) return;
  pl.resources = subtractResources(pl.resources, cost);
  for (const r of RESOURCES) draft.bank[r] += cost[r];
}

export function canAfford(state: GameState, p: PlayerId, item: string): boolean {
  const cost = costOf(state, item);
  const hand = state.players[p]?.resources;
  return cost !== undefined && hand !== undefined && hasResources(hand, cost);
}

// ---------------------------------------------------------------------------
// Turn / phase guards
// ---------------------------------------------------------------------------

/** Building (pieces, knights, walls, improvements) is allowed now for `p`? */
export function buildTurn(state: GameState, p: PlayerId): string | null {
  const k = state.phase.kind;
  if (k !== 'main' && k !== 'specialBuild') return 'can only build in the main phase';
  if (state.turn.current !== p) return 'not your turn';
  return null;
}

/** Main phase of `p`'s turn (trades, cards, knight actions). */
export function mainTurn(state: GameState, p: PlayerId): string | null {
  if (state.phase.kind !== 'main') return 'only after rolling, in the main phase';
  if (state.turn.current !== p) return 'not your turn';
  return null;
}

// ---------------------------------------------------------------------------
// Knights (§4.2)
// ---------------------------------------------------------------------------

export const knightsOnBoard = (state: GameState, p: PlayerId, level: KnightLevel): number =>
  Object.values(ckSlice(state).knights).filter((k) => k.owner === p && k.level === level).length;

export const knightsInSupply = (state: GameState, p: PlayerId, level: KnightLevel): number =>
  pieceLimit(state, p, knightKind(level)) - knightsOnBoard(state, p, level);

export function buildKnightBlocker(
  state: GameState,
  p: PlayerId,
  v: VertexId | null,
): string | null {
  const t = buildTurn(state, p);
  if (t) return t;
  if (knightsInSupply(state, p, 1) <= 0) return 'no basic knights left (promote one first)';
  if (!canAfford(state, p, KNIGHT_ITEM)) return 'a knight costs 1 wool and 1 ore';
  if (v !== null && !canPlaceKnightAt(state, p, v)) {
    return 'a knight goes on an empty spot on your road, linked to your buildings';
  }
  return null;
}

function ownKnight(state: GameState, p: PlayerId, v: VertexId): Knight | null {
  const k = ckSlice(state).knights[v];
  return k && k.owner === p ? k : null;
}

/**
 * Activating / promoting the knight on `v`: in a build phase, or with that knight selected
 * (phase ck/knight, the knight command dialog).
 */
function knightTurn(state: GameState, p: PlayerId, v: VertexId): string | null {
  const phase = phaseOf(state);
  if (phase.kind === 'ck/knight') {
    if (state.turn.current !== p) return 'not your turn';
    if (phase.resume === 'preRoll') return 'before the roll a knight can only chase the robber';
    return phase.vertex === v ? null : 'another knight is selected';
  }
  return buildTurn(state, p);
}

/** Option 'knightErrant' (S5 p.13): an active knight may chase the robber before the roll. */
export const knightErrantOn = (state: GameState): boolean =>
  state.settings.options[CK]?.['knightErrant'] === true;

/** Option 'easyStart' (S5 p.13): no event die and no 7 in each player's first two turns. */
export const easyStartOn = (state: GameState): boolean =>
  state.settings.options[CK]?.['easyStart'] === true;

export function activateBlocker(state: GameState, p: PlayerId, v: VertexId): string | null {
  const t = knightTurn(state, p, v);
  if (t) return t;
  const k = ownKnight(state, p, v);
  if (!k) return 'not your knight';
  if (k.active) return 'that knight is already active';
  if (!canAfford(state, p, ACTIVATE_ITEM)) return 'activating costs 1 grain';
  return null;
}

/** Can the knight on `v` be promoted (supply, Fortress, once per turn)? `free` = Smith. */
export function promoteBlocker(
  state: GameState,
  p: PlayerId,
  v: VertexId,
  free = false,
): string | null {
  const k = ownKnight(state, p, v);
  if (!k) return 'not your knight';
  if (k.level >= 3) return 'a mighty knight cannot be promoted';
  if (k.level === 2 && ckPlayer(state, p).improvements.politics < ABILITY_LEVEL) {
    return 'mighty knights need the Fortress (politics level 3)';
  }
  if (k.promotedOn === state.turn.number) return 'that knight was already promoted this turn';
  if (knightsInSupply(state, p, (k.level + 1) as KnightLevel) <= 0) {
    return `no ${KNIGHT_NAMES[(k.level + 1) as KnightLevel]} knights left`;
  }
  if (!free && !canAfford(state, p, PROMOTE_ITEM)) return 'promoting costs 1 wool and 1 ore';
  return null;
}

export function promoteBuildBlocker(state: GameState, p: PlayerId, v: VertexId): string | null {
  return knightTurn(state, p, v) ?? promoteBlocker(state, p, v);
}

export function promote(draft: GameState, v: VertexId): void {
  const k = ckSlice(draft).knights[v];
  if (!k) return;
  k.level = (k.level + 1) as KnightLevel;
  k.promotedOn = draft.turn.number;
  log(draft, k.owner, `${pn(draft, k.owner)} promoted a knight to ${KNIGHT_NAMES[k.level]}`);
}

/** Enemy knights the knight on `v` may displace: weaker, reachable by `p`'s route (CK-27). */
export function displaceTargets(state: GameState, p: PlayerId, v: VertexId): VertexId[] {
  const k = ownKnight(state, p, v);
  if (!k || k.level < 2) return [];
  const s = ckSlice(state);
  return [...reachable(state, p, v)].filter((w) => {
    const other = s.knights[w];
    return other !== undefined && other.owner !== p && other.level < k.level;
  });
}

/** Can the knight on `v` chase the robber away (§4.2.3)? */
export function canChase(state: GameState, p: PlayerId, v: VertexId): boolean {
  return (
    hasRobber(state.settings) &&
    isRobberActive(state) &&
    vertexHexes(topologyOf(state), v).includes(state.robber) &&
    robberTargets(state, p).length > 0
  );
}

/** Why the knight on `v` cannot act now (or null). */
export function knightActionBlocker(state: GameState, p: PlayerId, v: VertexId): string | null {
  const phase = phaseOf(state);
  const selected =
    phase.kind === 'ck/knight' && phase.vertex === v && phase.resume !== 'specialBuild';
  // Knight-Errant: before the roll, chasing the robber is the only action.
  const errant =
    (selected && phase.resume === 'preRoll') ||
    (!selected && state.phase.kind === 'preRoll' && knightErrantOn(state));
  if (!selected) {
    const m = errant ? (state.turn.current === p ? null : 'not your turn') : mainTurn(state, p);
    if (m) return m;
  } else if (state.turn.current !== p) return 'not your turn';
  const k = ownKnight(state, p, v);
  if (!k) return 'not your knight';
  if (errant) {
    if (!k.active) return 'only an active knight can act';
    return canChase(state, p, v) ? null : 'that knight cannot reach the robber';
  }
  if (!k.active) return 'only an active knight can act';
  if (k.activatedOn === state.turn.number) return 'a knight activated this turn cannot act yet';
  const can =
    moveTargets(state, p, v).length > 0 ||
    displaceTargets(state, p, v).length > 0 ||
    canChase(state, p, v);
  return can ? null : 'that knight has nowhere to go';
}

/**
 * Selecting the knight on `v` (the command dialog): something must be possible with it now,
 * an action (main phase), activating or promoting (main or special build).
 */
export function selectKnightBlocker(state: GameState, p: PlayerId, v: VertexId): string | null {
  if (state.phase.kind === 'preRoll' && knightErrantOn(state)) {
    if (ckSlice(state).turn.cancels >= MAX_KNIGHT_CANCELS)
      return 'no more knight commands this turn';
    return knightActionBlocker(state, p, v);
  }
  const t = buildTurn(state, p);
  if (t) return t;
  if (!ownKnight(state, p, v)) return 'not your knight';
  if (ckSlice(state).turn.cancels >= MAX_KNIGHT_CANCELS) return 'no more knight commands this turn';
  const can =
    (state.phase.kind === 'main' && knightActionBlocker(state, p, v) === null) ||
    activateBlocker(state, p, v) === null ||
    promoteBuildBlocker(state, p, v) === null;
  return can ? null : 'nothing to do with that knight now';
}

/** Place `knight` on `v` (a fresh copy). */
export function putKnight(draft: GameState, v: VertexId, knight: Knight): void {
  ckSlice(draft).knights[v] = { ...knight };
}

/**
 * The knight that stood on `from` was displaced: relocate it (one spot: there; none: back to
 * its owner's supply), or ask its owner to choose (phase).
 */
export function displaced(draft: GameState, knight: Knight, from: VertexId): CkPhase | null {
  const spots = moveTargets(draft, knight.owner, from);
  if (spots.length === 0) {
    log(
      draft,
      knight.owner,
      `${pn(draft, knight.owner)}'s knight had nowhere to go and was removed`,
    );
    return null;
  }
  if (spots.length === 1) {
    putKnight(draft, spots[0] as VertexId, knight);
    log(draft, knight.owner, `${pn(draft, knight.owner)}'s knight retreated`);
    return null;
  }
  return { kind: 'ck/relocate', player: knight.owner, from, knight };
}

// ---------------------------------------------------------------------------
// City walls (§4.1)
// ---------------------------------------------------------------------------

export const wallsOf = (state: GameState, p: PlayerId): number =>
  Object.values(ckSlice(state).walls).filter((o) => o === p).length;

export function wallSpotOk(state: GameState, p: PlayerId, v: VertexId): boolean {
  const b = state.pieces.buildings[v];
  return (
    b?.owner === p &&
    b.kind === 'city' &&
    ckSlice(state).walls[v] === undefined &&
    wallsOf(state, p) < pieceLimit(state, p, WALL_ITEM)
  );
}

export function wallBlocker(state: GameState, p: PlayerId, v: VertexId | null): string | null {
  const t = buildTurn(state, p);
  if (t) return t;
  if (wallsOf(state, p) >= pieceLimit(state, p, WALL_ITEM)) return 'no city walls left';
  if (!canAfford(state, p, WALL_ITEM)) return 'a city wall costs 2 brick';
  if (v !== null && !wallSpotOk(state, p, v)) return 'a wall goes under one of your cities';
  return null;
}

// ---------------------------------------------------------------------------
// City improvements and metropolises (§4.3, §4.4)
// ---------------------------------------------------------------------------

export const levelOf = (state: GameState, p: PlayerId, t: Track): number =>
  ckSlice(state).players[p]?.improvements[t] ?? 0;

/** Cities of `p` without a metropolis. */
export function freeCities(state: GameState, p: PlayerId): VertexId[] {
  const metro = metropolisVertices(state);
  return buildingsOf(state, p, 'city').filter((v) => !metro.has(v));
}

/** Would `p` reaching `level` in `t` take (or claim) that track's metropolis? */
export function winsMetropolis(state: GameState, p: PlayerId, t: Track, level: number): boolean {
  if (level < METROPOLIS_LEVEL) return false;
  const m = ckSlice(state).metropolis[t];
  if (m === null) return true;
  if (m.owner === p) return false;
  return level === MAX_LEVEL && levelOf(state, m.owner, t) < MAX_LEVEL;
}

/** Commodities the next level of `t` costs `p` now (Crane included, CK-40). */
export function improvementCost(state: GameState, p: PlayerId, t: Track): number {
  const next = levelOf(state, p, t) + 1;
  return Math.max(0, next - (ckSlice(state).turn.cranes > 0 ? 1 : 0));
}

export function improveBlocker(state: GameState, p: PlayerId, t: Track): string | null {
  const b = buildTurn(state, p);
  if (b) return b;
  const level = levelOf(state, p, t);
  if (level >= MAX_LEVEL) return 'this track is complete';
  if (buildingsOf(state, p, 'city').length === 0) return 'you need a city to improve it';
  const c = TRACK_COMMODITY[t];
  const cost = improvementCost(state, p, t);
  if (goodCount(state, p, c) < cost) return `needs ${cost} ${c}`;
  if (winsMetropolis(state, p, t, level + 1) && freeCities(state, p).length === 0) {
    return 'you need a city without a metropolis for it';
  }
  return null;
}

/** Give `p` the metropolis of `t` on `v` (taking it from its old owner). */
export function placeMetropolis(draft: GameState, p: PlayerId, t: Track, v: VertexId): void {
  const s = ckSlice(draft);
  const old = s.metropolis[t];
  s.metropolis[t] = { owner: p, vertex: v };
  if (old && old.owner !== p) {
    log(draft, p, `${pn(draft, p)} took the ${t} metropolis from ${pn(draft, old.owner)}`);
  } else {
    log(draft, p, `${pn(draft, p)} built the ${t} metropolis`);
  }
}

/**
 * After `p` reached `level` in `t`: claim the metropolis if due (one free city: at once; else a
 * placement phase). Returns the phase to enter, or null.
 */
export function claimMetropolis(
  draft: GameState,
  p: PlayerId,
  t: Track,
  level: number,
): CkPhase | null {
  if (!winsMetropolis(draft, p, t, level)) return null;
  const free = freeCities(draft, p);
  if (free.length === 1) {
    placeMetropolis(draft, p, t, free[0] as VertexId);
    return null;
  }
  if (free.length === 0) return null;
  return {
    kind: 'ck/metropolis',
    track: t,
    player: p,
    resume: draft.phase.kind === 'specialBuild' ? 'specialBuild' : 'main',
  };
}

export function resumeAfterMetropolis(draft: GameState, resume: 'main' | 'specialBuild'): Phase {
  return resumePhase(draft, resume);
}

// ---------------------------------------------------------------------------
// Progress cards (§3.2)
// ---------------------------------------------------------------------------

/** Draw the top card of `t`'s stack for `p` (a VP card is laid out at once). */
export function drawProgress(draft: GameState, p: PlayerId, t: Track): ProgressCard | null {
  const s = ckSlice(draft);
  const card = s.decks[t].pop();
  const pl = s.players[p];
  if (card === undefined || !pl) return null;
  if (isVpCard(card)) {
    pl.vpCards.push(card);
    log(draft, p, `${pn(draft, p)} drew the ${CARD_NAMES[card]} (1 victory point)`);
  } else {
    pl.progress.push(card);
    log(draft, p, `${pn(draft, p)} drew a ${t} progress card`);
  }
  return card;
}

/** Put a played or discarded card under its stack (FAQ Q103). */
export function returnCard(draft: GameState, t: Track, card: ProgressCard): void {
  ckSlice(draft).decks[t].unshift(card);
}

/** Players other than the current one holding more than the hand limit, clockwise. */
export function overProgressLimit(state: GameState): PlayerId[] {
  const n = state.players.length;
  const out: PlayerId[] = [];
  for (let i = 1; i < n; i++) {
    const p = (state.turn.current + i) % n;
    if ((ckSlice(state).players[p]?.progress.length ?? 0) > PROGRESS_HAND_MAX) out.push(p);
  }
  return out;
}

/** An interrupt is over: discards owed out of turn first, then the roll goes on (or main). */
export function proceed(draft: GameState, then: Then): void {
  const over = overProgressLimit(draft);
  if (over.length > 0) {
    draft.phase = { kind: 'ck/progressDiscard', queue: over, then } as Phase;
    return;
  }
  if (then === 'roll') continueRoll(draft);
  else draft.phase = { kind: 'main' };
}

/** Same as proceed, as an onRoll result: the phase to interrupt with, or undefined. */
function interruptFor(draft: GameState): Phase | undefined {
  const over = overProgressLimit(draft);
  return over.length > 0
    ? ({ kind: 'ck/progressDiscard', queue: over, then: 'roll' } as Phase)
    : undefined;
}

// ---------------------------------------------------------------------------
// The event die and the barbarians (§3.1–3.4)
// ---------------------------------------------------------------------------

const FACE_TEXT: Readonly<Record<EventFace, string>> = {
  ship: 'the barbarian ship',
  trade: 'the yellow (trade) gate',
  politics: 'the blue (politics) gate',
  science: 'the green (science) gate',
};

/** Clockwise from the current player (the roller). */
export function fromRoller(state: GameState): PlayerId[] {
  const n = state.players.length;
  return state.players.map((_, i) => (state.turn.current + i) % n);
}

/**
 * onRoll: the event die, except in a player's first two turns with Easy start (S5 p.13): then
 * no event die, and a rolled 7 is rolled again (an Alchemist's 7 stays).
 */
export function rollStep(draft: GameState, roll: number): Phase | undefined {
  const s = ckSlice(draft);
  if (!easyStartOn(draft) || (s.turns[draft.turn.current] ?? 0) > 2) return eventDieStep(draft);
  if (roll === 7 && !s.turn.alchemist) {
    let dice = draft.dice ?? [3, 4];
    while (dice[0] + dice[1] === 7) dice = rollTwoDice(draft).dice;
    draft.dice = dice;
    log(
      draft,
      draft.turn.current,
      `Easy start: the 7 is rolled again: ${dice[0] + dice[1]} (${dice[0]}+${dice[1]})`,
    );
  }
  log(draft, null, 'Easy start: no event die in a player’s first two turns');
  return undefined;
}

/**
 * Roll the event die and resolve it (onRoll; also after an Alchemist): a ship step (maybe the
 * attack), or the progress draws of the gate's colour. Returns an interrupting phase or undefined.
 */
export function eventDieStep(draft: GameState): Phase | undefined {
  const s = ckSlice(draft);
  const rng = new Rng(draft.rng);
  const face = rng.pick(EVENT_DIE);
  draft.rng = rng.state;
  s.event = face;
  log(draft, draft.turn.current, `The event die shows ${FACE_TEXT[face]}`);
  if (face === 'ship') {
    if (!shipSails(draft)) return undefined;
    s.barbarian += 1;
    if (s.barbarian >= BARBARIAN_STEPS) return attack(draft);
    log(draft, null, `The barbarians sail closer (${s.barbarian}/${BARBARIAN_STEPS})`);
    return undefined;
  }
  const red = draft.dice?.[1] ?? 0;
  for (const p of fromRoller(draft)) {
    if (red <= redDieDraws(levelOf(draft, p, face))) drawProgress(draft, p, face);
  }
  return interruptFor(draft);
}

/** Cities `p` could lose to the barbarians (no metropolis on them, CK-17). */
export const pillageable = (state: GameState, p: PlayerId): VertexId[] => freeCities(state, p);

/** Pillage the city on `v`: it becomes a settlement and loses its wall (§3.3). */
export function pillage(draft: GameState, v: VertexId): void {
  const b = draft.pieces.buildings[v];
  if (!b) return;
  draft.pieces.buildings[v] = { owner: b.owner, kind: 'settlement' };
  const s = ckSlice(draft);
  const walled = s.walls[v] !== undefined;
  Reflect.deleteProperty(s.walls, v);
  log(
    draft,
    b.owner,
    `The barbarians pillaged a city of ${pn(draft, b.owner)}${walled ? ' (its wall is lost)' : ''}`,
  );
}

/** The barbarians land (§3.3): strengths, pillage or Defender, reset. */
function attack(draft: GameState): Phase | undefined {
  const s = ckSlice(draft);
  const barbarians = barbarianStrength(draft);
  const knights = defenderStrength(draft);
  log(draft, null, `The barbarians attack! Barbarians ${barbarians}, knights of Catan ${knights}`);
  const order = fromRoller(draft);
  const strength = (p: PlayerId) => activeStrength(draft, p);
  let next: Phase | undefined;

  if (barbarians > knights) {
    // The weakest players with a city to lose each lose one (CK-16, CK-17).
    const candidates = order.filter((p) => pillageable(draft, p).length > 0);
    const low = Math.min(...candidates.map(strength));
    const losers = candidates.filter((p) => strength(p) === low);
    if (losers.length === 0) log(draft, null, 'The barbarians win, but find no city to pillage');
    const choosing: PlayerId[] = [];
    for (const p of losers) {
      const cities = pillageable(draft, p);
      if (cities.length === 1) pillage(draft, cities[0] as VertexId);
      else choosing.push(p);
    }
    if (choosing.length > 0) next = { kind: 'ck/pillage', queue: choosing } as Phase;
  } else {
    const best = Math.max(...order.map(strength));
    const top = order.filter((p) => strength(p) === best);
    if (best <= 0) {
      log(draft, null, 'The barbarians are driven off, but nobody defended (CK-33)');
    } else if (top.length === 1) {
      const p = top[0] as PlayerId;
      const pl = s.players[p];
      if (pl) pl.defender += 1;
      log(draft, p, `${pn(draft, p)} is the Defender of Catan (1 victory point)`);
    } else {
      log(draft, null, 'The defenders tie: each of them draws a progress card');
      const queue = top.filter(() => TRACKS.some((t) => s.decks[t].length > 0));
      if (queue.length > 0) next = { kind: 'ck/defender', queue } as Phase;
    }
  }

  // Always: the ship goes back, every knight is deactivated (CK-11, CK-22).
  s.barbarian = 0;
  s.attacks += 1;
  for (const k of Object.values(s.knights)) k.active = false;
  if (s.attacks === 1 && hasRobber(draft.settings)) {
    log(draft, null, 'The robber wakes up: from now on he can be moved');
  }
  return next ?? interruptFor(draft);
}

/** The next defender-tie or pillage step is done; continue the attack's queue or the roll. */
export function afterQueueStep(
  draft: GameState,
  queue: PlayerId[],
  kind: 'ck/pillage' | 'ck/defender',
) {
  const rest = queue.slice(1);
  if (kind === 'ck/defender') {
    const s = ckSlice(draft);
    const left = rest.filter(() => TRACKS.some((t) => s.decks[t].length > 0));
    if (left.length > 0) {
      draft.phase = { kind, queue: left } as Phase;
      return;
    }
  } else if (rest.length > 0) {
    draft.phase = { kind, queue: rest } as Phase;
    return;
  }
  proceed(draft, 'roll');
}

// ---------------------------------------------------------------------------
// Production (§1.5, §3.5)
// ---------------------------------------------------------------------------

/** Cards per city this roll: 2, or 1 under the Epidemic event card. */
export const cityYieldOf = (state: GameState): number =>
  state.settings.eventCards && state.lastEvent === 'epidemic' ? 1 : 2;

/** For each city on a forest / pasture / mountains hex that produces: [owner, hex terrain]. */
function commodityCities(
  state: GameState,
  roll: number,
  blocked: HexId | null,
): [PlayerId, Resource][] {
  const t = topologyOf(state);
  const out: [PlayerId, Resource][] = [];
  for (const id of Object.keys(state.board.hexes) as HexId[]) {
    const hex = state.board.hexes[id];
    if (!hex || hex.token !== roll || id === blocked || !isResource(hex.terrain)) continue;
    if (COMMODITY_OF[hex.terrain] === undefined) continue;
    for (const v of hexVertices(t, id)) {
      const b = state.pieces.buildings[v];
      if (b?.kind === 'city') out.push([b.owner, hex.terrain]);
    }
  }
  return out;
}

/** production hook: a city's second card on forest / pasture / mountains is a commodity. */
export function commodityProduction(
  state: GameState,
  roll: number,
  owed: ResourceCounts[],
  ctx: { cityYield: number; blocked: HexId | null },
): void {
  if (ctx.cityYield < 2) return;
  for (const [p, r] of commodityCities(state, roll, ctx.blocked)) {
    const hand = owed[p];
    if (hand && hand[r] > 0) hand[r] -= 1;
  }
}

/**
 * afterProduction hook: pay the commodities (bank shortage per type, as for resources), then the
 * Aqueduct for science level 3+ players who received nothing (§3.5).
 */
export function payCommodities(
  draft: GameState,
  roll: number,
  paid: readonly ResourceCounts[],
): Phase | undefined {
  const s = ckSlice(draft);
  const blocked = hasRobber(draft.settings) ? draft.robber : null;
  const owed = draft.players.map(
    () => ({ paper: 0, cloth: 0, coin: 0 }) as Record<Commodity, number>,
  );
  if (cityYieldOf(draft) >= 2) {
    for (const [p, r] of commodityCities(draft, roll, blocked)) {
      const c = COMMODITY_OF[r] as Commodity;
      const o = owed[p];
      if (o) o[c] += 1;
    }
  }
  for (const c of COMMODITIES) {
    const total = owed.reduce((n, o) => n + o[c], 0);
    if (total <= s.bank[c]) continue;
    const who = owed.filter((o) => o[c] > 0);
    if (who.length === 1 && who[0]) who[0][c] = s.bank[c];
    else for (const o of owed) o[c] = 0;
  }
  const got = draft.players.map(() => 0);
  owed.forEach((o, p) => {
    const parts: string[] = [];
    for (const c of COMMODITIES) {
      if (o[c] <= 0) continue;
      moveGood(draft, 'bank', p, c, o[c]);
      parts.push(`${o[c]} ${c}`);
      got[p] = (got[p] ?? 0) + o[c];
    }
    if (parts.length > 0) log(draft, p, `${pn(draft, p)} received ${parts.join(', ')}`);
  });

  // Aqueduct: nothing at all from this roll -> 1 resource of choice (Q4).
  const bankHas = RESOURCES.some((r) => draft.bank[r] > 0);
  const queue = fromRoller(draft).filter((p) => {
    const res = paid[p];
    const resources = res ? RESOURCES.reduce((n, r) => n + res[r], 0) : 0;
    return (
      bankHas && levelOf(draft, p, 'science') >= ABILITY_LEVEL && resources + (got[p] ?? 0) === 0
    );
  });
  return queue.length > 0 ? ({ kind: 'ck/aqueduct', queue } as Phase) : undefined;
}

// ---------------------------------------------------------------------------
// The 7 and the robber (§3.6, CK-30)
// ---------------------------------------------------------------------------

/** All discards of a 7 are done: the robber moves (once awake), else back to main. */
export function finishDiscards(draft: GameState): void {
  if (isRobberActive(draft)) startRobber(draft, 'main');
  else draft.phase = { kind: 'main' };
}

// ---------------------------------------------------------------------------
// Pieces after a pillage (FAQ Q15)
// ---------------------------------------------------------------------------

/**
 * A pillaged city with no settlement piece left lies on its side as a settlement (FAQ Q15): the
 * player then owns one more settlement and one city piece fewer.
 */
export function pillageOverflow(state: GameState, p: PlayerId): number {
  return Math.max(0, buildingsOf(state, p, 'settlement').length - settlementPieces(state, p));
}

/** True while `settlementPieces` asks the pieceLimit chain without C&K's own adjustment. */
let measuring = false;
export const measuringPieces = (): boolean => measuring;

/**
 * Settlement pieces `p` owns before a pillage: the base 5 plus what other modules give (E&P + C&K:
 * a harbor settlement hands its settlement piece back, so harbors are not settlement pieces).
 */
export function settlementPieces(state: GameState, p: PlayerId): number {
  measuring = true;
  try {
    return pieceLimit(state, p, 'settlement');
  } finally {
    measuring = false;
  }
}

export const roadsLeft = (state: GameState, p: PlayerId): number => piecesLeft(state, p).road;

export { foreignPieceAt };
