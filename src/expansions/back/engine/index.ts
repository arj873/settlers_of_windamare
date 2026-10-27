/**
 * Barbarian Attack + Cities & Knights (catan.com 2025 sheet "Barbarian Attack — Combining with
 * Cities & Knights"; docs/rules/combos.md §10, engine status per rule). The Barbarian Attack
 * scenario with C&K's commodities, improvements, progress cards and knights, minus C&K's
 * barbarian ship and BA's own knights and development cards.
 *
 * Composition order (`before`): back, ck, tb. Where both modules hook the same point:
 * - onRoll: C&K's event die; a ship lands a T&B barbarian on the coastal hex of the production
 *   roll (ck's `shipSails` seam keeps the ship in port), before the production: a hex it conquers
 *   produces nothing (production hook), the landing itself follows in afterProduction;
 * - afterProduction: the landing, C&K's commodities (none from conquered hexes) + Aqueduct, then
 *   T&B's (nothing in BA);
 * - onSeven: discards (C&K hand sizes and walls), then BA's steal from any player (no robber;
 *   C&K's sleeping robber has nothing to sleep for: there is no barbarian ship).
 * Knights (knights.ts) stand on paths; the progress cards the sheet changes are in cards.ts.
 */
import { fail, isCurrent, log, ok } from '../../../engine/actions/common';
import { cloneJson } from '../../../engine/expansions/ext';
import { costOf } from '../../../engine/expansions/hooks';
import type { ExpansionModule, ExtHandler, ExtWrap } from '../../../engine/expansions/types';
import { isResource } from '../../../engine/resources';
import { cardsInHand } from '../../../engine/selectors';
import { topologyOf } from '../../../engine/topology';
import type {
  Action,
  ActionResult,
  EdgeId,
  GameState,
  HexId,
  Phase,
  PlayerId,
  ResourceCounts,
  VertexId,
} from '../../../engine/types';
import {
  ACTIVATE_ITEM,
  CK,
  KNIGHT_ITEM,
  PROGRESS_HAND_MAX,
  PROMOTE_ITEM,
  TRACKS,
  ckModule,
  ckSlice,
  isProgressCard,
  isTrack,
  metropolisVertices,
  payResources,
  phaseOf as ckPhaseOf,
  type Knight,
  type Track,
} from '../../ck/engine';
import {
  CASTLE,
  SC_BA,
  TB,
  baOf,
  barbariansOn,
  isConqueredBuilding,
  isConqueredHex,
  tbBoard,
  tbModule,
} from '../../tb/engine';
import { landBarbarians, setBarbarians } from '../../tb/engine/ba';
import { pn, rollTwo } from '../../tb/engine/common';
import {
  CHANGED_CARDS,
  OWN_CARDS,
  cardAction,
  cardBlocker,
  cardLegal,
  innerInventorHexes,
  merchantConquered,
  playOwnCard,
} from './cards';
import {
  activateBlocker,
  canSelect,
  castleKnights,
  displace,
  displaceTargets,
  endTurnPhase,
  expel,
  knightAt,
  knightEdges,
  moveKnight,
  moveTargets,
  promote,
  promoteBuildBlocker,
  recruitBlocker,
  recruitSpots,
} from './knights';
import {
  BACK,
  BACK_MODE,
  BACK_VP,
  asPhase,
  backSlice,
  phaseOf,
  type BackAction,
  type BackPhase,
  type BackSlice,
} from './state';

export * from './state';
export {
  ACTIVE_STEPS,
  DISPLACE_STEPS,
  INACTIVE_STEPS,
  castleKnights,
  displaceTargets,
  inSupply,
  knightAt,
  knightEdges,
  moveTargets,
  recruitSpots,
  stepsOf,
} from './knights';
export { CHANGED_CARDS, cardBlocker, innerInventorHexes, taxHexes } from './cards';

/** Prisoners returned for one VP token when the supply runs low (the sheet: 3). */
export const PRISONERS_PER_TOKEN = 3;

// ---------------------------------------------------------------------------------------------
// Barbarians: the event die's ship, improvements, the supply
// ---------------------------------------------------------------------------------------------

/**
 * "The number of barbarians is not limited. If you run out, return 3 prisoners to the supply
 * and take 1 VP token." Ours: as soon as fewer than a landing's 3 are left, players with 3+
 * prisoners (from the current player on) swap 3 for a token, until the supply has 3 again.
 */
export function refill(draft: GameState): void {
  const ba = baOf(draft);
  const s = backSlice(draft);
  const n = draft.players.length;
  for (let i = 0; i < n && ba.supply < 3; i++) {
    const p = (draft.turn.current + i) % n;
    while (ba.supply < 3 && (ba.prisoners[p] ?? 0) >= PRISONERS_PER_TOKEN) {
      ba.prisoners[p] = (ba.prisoners[p] ?? 0) - PRISONERS_PER_TOKEN;
      ba.supply += PRISONERS_PER_TOKEN;
      s.tokens[p] = (s.tokens[p] ?? 0) + 1;
      log(draft, p, `${pn(draft, p)} returned 3 prisoners for a victory point token`);
    }
  }
}

/** Coastal hexes one barbarian lands on for the number `n` (fewer than 3 there, supply left). */
export function landingHexes(state: GameState, n: number): HexId[] {
  let supply = baOf(state).supply;
  const out: HexId[] = [];
  for (const h of tbBoard(state).coast ?? []) {
    if (state.board.hexes[h]?.token !== n || barbariansOn(state, h) >= 3 || supply <= 0) continue;
    supply -= 1;
    out.push(h);
  }
  return out;
}

/** One barbarian on the coastal hex(es) numbered `n` (the ship face, an improvement). */
function landOn(draft: GameState, n: number, why: string): void {
  if (n === 7) return;
  const hexes = landingHexes(draft, n);
  for (const h of hexes) {
    baOf(draft).supply -= 1;
    setBarbarians(draft, h, barbariansOn(draft, h) + 1);
  }
  log(draft, null, `${why}: a barbarian lands on ${n}${hexes.length === 0 ? ' (no room)' : ''}`);
}

/** C&K rolled the ship this roll (the event die; Easy start rolls none: onRoll clears it). */
const shipRolled = (state: GameState): boolean => ckSlice(state).event === 'ship';

/** production hook: a hex the ship's barbarian conquers on this roll pays nothing. */
function shipConquers(state: GameState, roll: number, owed: ResourceCounts[], cityYield: number) {
  if (!shipRolled(state)) return;
  const t = topologyOf(state);
  for (const h of landingHexes(state, roll)) {
    const tile = state.board.hexes[h];
    if (!tile || barbariansOn(state, h) !== 2 || !isResource(tile.terrain)) continue;
    const r = tile.terrain;
    for (const v of t.hex[h]?.vertices ?? []) {
      const b = state.pieces.buildings[v];
      const hand = b && owed[b.owner];
      if (hand) hand[r] = Math.max(0, hand[r] - (b.kind === 'city' ? cityYield : 1));
    }
  }
}

/** Run `fn` with conquered hexes' numbers hidden: C&K pays no commodities from them. */
function withoutConquered<T>(draft: GameState, fn: () => T): T {
  const board = draft.board;
  const conquered = (tbBoard(draft).coast ?? []).filter((h) => isConqueredHex(draft, h));
  if (conquered.length === 0) return fn();
  const hexes = { ...board.hexes };
  for (const h of conquered) {
    const tile = hexes[h];
    if (tile) hexes[h] = { ...tile, token: null };
  }
  draft.board = { ...board, hexes };
  try {
    return fn();
  } finally {
    draft.board = board;
  }
}

// ---------------------------------------------------------------------------------------------
// Conquest and metropolises
// ---------------------------------------------------------------------------------------------

/** Every land hex around `v` is conquered (the castle never is): a building there would fall. */
export function surrounded(state: GameState, v: VertexId): boolean {
  const hexes = topologyOf(state).vertex[v]?.hexes ?? [];
  return (
    hexes.length > 0 &&
    hexes.every((h) => state.board.hexes[h]?.terrain !== CASTLE && isConqueredHex(state, h))
  );
}

/** A metropolis city is never conquered: T&B's conquest skips it (`BaSlice.safe`). */
function syncSafe(draft: GameState): void {
  const ba = baOf(draft);
  const safe = [...metropolisVertices(draft)].sort();
  if ((ba.safe ?? []).join() !== safe.join()) ba.safe = safe;
}

/** `p`'s metropolis of `t` stands among conquered hexes: no improvements on that track. */
export function trackCut(state: GameState, p: PlayerId, t: Track): boolean {
  const m = ckSlice(state).metropolis[t];
  return m !== null && m.owner === p && surrounded(state, m.vertex);
}

// ---------------------------------------------------------------------------------------------
// The 7: discards, then the roller robs any player (BA, C&K's cards)
// ---------------------------------------------------------------------------------------------

function stealPhase(draft: GameState): Phase {
  const p = draft.turn.current;
  const candidates = draft.players
    .map((x) => x.id)
    .filter((q) => q !== p && cardsInHand(draft, q) > 0);
  return candidates.length > 0 ? { kind: 'steal', candidates, resume: 'main' } : { kind: 'main' };
}

/** After a discard: once the 7's discards are all in, the roller robs (C&K and T&B leave main). */
function afterDiscard(draft: GameState, was: string, r: ActionResult): ActionResult {
  if (r.ok && was === 'discard' && draft.phase.kind !== 'discard') draft.phase = stealPhase(draft);
  return r;
}

// ---------------------------------------------------------------------------------------------
// Knight handlers
// ---------------------------------------------------------------------------------------------

const overHand = (state: GameState, p: PlayerId) =>
  (ckSlice(state).players[p]?.progress.length ?? 0) > PROGRESS_HAND_MAX;

const edgeOf = (a: Action): unknown => (a as unknown as { edge?: unknown }).edge;

const handlers: Record<`back/${string}`, ExtHandler> = {
  'back/recruit': (draft, a) => {
    const err = recruitBlocker(draft, a.player, edgeOf(a));
    if (err) return fail(err);
    payResources(draft, a.player, costOf(draft, KNIGHT_ITEM) as ResourceCounts);
    const knight: Knight = {
      owner: a.player,
      level: 1,
      active: false,
      activatedOn: null,
      promotedOn: null,
    };
    backSlice(draft).knights[edgeOf(a) as EdgeId] = knight;
    log(draft, a.player, `${pn(draft, a.player)} recruited a knight at the castle`);
    return ok(draft);
  },
  'back/activate': (draft, a) => {
    const err = activateBlocker(draft, a.player, edgeOf(a));
    if (err) return fail(err);
    payResources(draft, a.player, costOf(draft, ACTIVATE_ITEM) as ResourceCounts);
    const k = knightAt(draft, edgeOf(a) as EdgeId) as Knight;
    k.active = true;
    k.activatedOn = draft.turn.number;
    log(draft, a.player, `${pn(draft, a.player)} activated a knight`);
    return ok(draft);
  },
  'back/promote': (draft, a) => {
    const err = promoteBuildBlocker(draft, a.player, edgeOf(a));
    if (err) return fail(err);
    payResources(draft, a.player, costOf(draft, PROMOTE_ITEM) as ResourceCounts);
    promote(draft, edgeOf(a) as EdgeId);
    return ok(draft);
  },
  'back/startKnights': (draft, a) => {
    const err = startBlocker(draft, a.player, edgeOf(a));
    if (err) return fail(err);
    draft.phase = asPhase({ kind: 'back/knights', from: edgeOf(a) as EdgeId });
    log(draft, a.player, `${pn(draft, a.player)} ends the building: knight actions`);
    return ok(draft);
  },
  'back/selectKnight': (draft, a) => {
    const ph = phaseOf(draft) as BackPhase;
    if (ph.kind !== 'back/knights' || !isCurrent(draft, a.player))
      return fail('not moving knights');
    const e = edgeOf(a);
    if (typeof e !== 'string' || !canSelect(draft, a.player, e as EdgeId)) {
      return fail('that knight cannot act');
    }
    draft.phase = asPhase({ kind: 'back/knights', from: e as EdgeId });
    return ok(draft);
  },
  'back/moveKnight': (draft, a) => {
    const from = selected(draft, a.player);
    if (!from) return fail('pick a knight first');
    const e = edgeOf(a);
    if (typeof e !== 'string' || !moveTargets(draft, from).includes(e as EdgeId)) {
      return fail('the knight cannot reach that path');
    }
    moveKnight(draft, from, e as EdgeId);
    draft.phase = asPhase({ kind: 'back/knights', from: null });
    return ok(draft);
  },
  'back/displace': (draft, a) => {
    const from = selected(draft, a.player);
    if (!from) return fail('pick a knight first');
    const e = edgeOf(a);
    if (typeof e !== 'string' || !displaceTargets(draft, from).includes(e as EdgeId)) {
      return fail('that knight cannot be displaced from here');
    }
    const next = displace(draft, from, e as EdgeId);
    draft.phase = asPhase(next ?? { kind: 'back/knights', from: null });
    return ok(draft);
  },
  'back/relocate': (draft, a) => {
    const ph = phaseOf(draft) as BackPhase;
    if (ph.kind !== 'back/relocate') return fail('no knight to place');
    if (a.player !== ph.knight.owner) return fail('its owner places the knight');
    const e = edgeOf(a);
    if (typeof e !== 'string' || !ph.spots.includes(e as EdgeId) || knightAt(draft, e as EdgeId)) {
      return fail('put it on one of the nearest free paths');
    }
    backSlice(draft).knights[e as EdgeId] = ph.knight;
    log(draft, a.player, `${pn(draft, a.player)}'s knight retreated`);
    draft.phase = asPhase({ kind: 'back/knights', from: null });
    return ok(draft);
  },
  'back/intrigueHex': (draft, a) => cardAction(draft, a as never),
  'back/taxHex': (draft, a) => cardAction(draft, a as never),
  'back/deserterPlayer': (draft, a) => cardAction(draft, a as never),
  'back/deserterKnight': (draft, a) => cardAction(draft, a as never),
  'back/smithKnight': (draft, a) => cardAction(draft, a as never),
  'back/smithDone': (draft, a) => cardAction(draft, a as never),
};

function startBlocker(state: GameState, p: PlayerId, e: unknown): string | null {
  if (state.phase.kind !== 'main') return 'knights act at the end of your turn';
  const t = endTurnPhase(state, p);
  if (t) return t;
  if (overHand(state, p))
    return `play or discard progress cards down to ${PROGRESS_HAND_MAX} first`;
  if (typeof e !== 'string' || !canSelect(state, p, e as EdgeId)) return 'that knight cannot act';
  return null;
}

function selected(state: GameState, p: PlayerId): EdgeId | null {
  const ph = phaseOf(state) as BackPhase;
  if (ph.kind !== 'back/knights' || !isCurrent(state, p) || ph.from === null) return null;
  return knightAt(state, ph.from)?.owner === p ? ph.from : null;
}

// ---------------------------------------------------------------------------------------------
// Wraps of the composed modules' actions
// ---------------------------------------------------------------------------------------------

const PATHS_ONLY = 'in Barbarian Attack the knights stand on paths';
const CK_KNIGHT_ACTIONS = [
  'ck/buildKnight',
  'ck/selectKnight',
  'ck/activateKnight',
  'ck/promoteKnight',
  'ck/chaseRobber',
] as const;

const cardPhase = (state: GameState): string | null => {
  const ph = ckPhaseOf(state) as unknown as { kind: string; card?: string };
  return ph.kind === 'ck/card' ? (ph.card ?? null) : null;
};

/** A C&K hex choice the pair forbids: Invention on the coast, the Merchant on a conquered hex. */
function badHex(state: GameState, h: unknown): string | null {
  if (typeof h !== 'string') return null;
  const card = cardPhase(state);
  if (card === 'inventor' && !innerInventorHexes(state).includes(h as HexId)) {
    return 'Invention swaps the numbers in the island’s centre only';
  }
  if (card === 'merchant' && isConqueredHex(state, h as HexId)) {
    return 'the Merchant cannot stand on a conquered hex';
  }
  return null;
}

/** Medicine on a conquered settlement (a conquered settlement is never upgraded, BA). */
const badMedicine = (state: GameState, v: unknown): boolean =>
  cardPhase(state) === 'medicine' &&
  typeof v === 'string' &&
  isConqueredBuilding(state, v as VertexId);

const wraps: Record<`${string}/${string}`, ExtWrap> = {
  ...Object.fromEntries(CK_KNIGHT_ACTIONS.map((t) => [t, () => fail(PATHS_ONLY)])),

  'ck/play': (draft, action, next) => {
    const card = action['card'];
    if (!isProgressCard(card) || !CHANGED_CARDS.includes(card)) return next(draft, action);
    const err = cardBlocker(draft, action.player, card);
    if (err) return fail(err);
    if (!OWN_CARDS.includes(card)) return next(draft, action);
    playOwnCard(draft, action.player, card);
    return ok(draft);
  },

  'ck/pickHex': (draft, action, next) => {
    const err = badHex(draft, action['hex']);
    return err ? fail(err) : next(draft, action);
  },

  'ck/pickVertex': (draft, action, next) => {
    if (badMedicine(draft, action['vertex']))
      return fail('a conquered settlement cannot be upgraded');
    const medicine = cardPhase(draft) === 'medicine';
    if (medicine) refill(draft);
    const r = next(draft, action);
    // Medicine builds a city: the barbarians land as for any city (BA).
    if (r.ok && medicine && cardPhase(draft) !== 'medicine') landBarbarians(draft);
    return r;
  },

  'ck/improve': (draft, action, next) => {
    const t = action['track'];
    if (isTrack(t) && trackCut(draft, action.player, t)) {
      return fail('your metropolis of this track stands among conquered hexes');
    }
    const r = next(draft, action);
    // "Each time you build a city improvement, you must immediately roll the 2 production dice."
    if (r.ok) landOn(draft, rollTwo(draft), 'A city improvement');
    return r;
  },

  'ck/discard': (draft, action, next) => afterDiscard(draft, draft.phase.kind, next(draft, action)),
};

// ---------------------------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------------------------

function legal(state: GameState): Action[] {
  const p = state.turn.current;
  const out: Action[] = cardLegal(state);
  const add = (a: BackAction) => out.push(a as unknown as Action);
  const k = phaseOf(state).kind;
  if (k === 'main' || k === 'specialBuild') {
    for (const edge of recruitSpots(state)) {
      if (recruitBlocker(state, p, edge) === null) add({ type: 'back/recruit', player: p, edge });
    }
    for (const edge of knightEdges(state, p)) {
      if (activateBlocker(state, p, edge) === null) add({ type: 'back/activate', player: p, edge });
      if (promoteBuildBlocker(state, p, edge) === null) {
        add({ type: 'back/promote', player: p, edge });
      }
      if (startBlocker(state, p, edge) === null)
        add({ type: 'back/startKnights', player: p, edge });
    }
  }
  if (k === 'main') {
    for (const card of CHANGED_CARDS) {
      if (cardBlocker(state, p, card) === null) {
        out.push({ type: 'ck/play', player: p, card } as unknown as Action);
      }
    }
  }
  const ph = phaseOf(state) as BackPhase;
  if (ph.kind === 'back/knights') {
    for (const edge of knightEdges(state, p)) {
      if (edge !== ph.from && canSelect(state, p, edge)) {
        add({ type: 'back/selectKnight', player: p, edge });
      }
    }
    const from = selected(state, p);
    if (from) {
      for (const edge of moveTargets(state, from))
        add({ type: 'back/moveKnight', player: p, edge });
      for (const edge of displaceTargets(state, from)) {
        add({ type: 'back/displace', player: p, edge });
      }
    }
    if (castleKnights(state, p).length === 0) out.push({ type: 'endTurn', player: p });
  }
  if (ph.kind === 'back/relocate') {
    for (const edge of ph.spots) {
      if (!knightAt(state, edge)) add({ type: 'back/relocate', player: ph.knight.owner, edge });
    }
  }
  return out;
}

const keyOf = (a: Action) => JSON.stringify(a);

function filterLegal(state: GameState, actions: Action[]): Action[] {
  const seen = new Set<string>();
  return actions.filter((a) => {
    const x = a as unknown as Record<string, unknown>;
    switch (a.type) {
      case 'ck/buildKnight':
      case 'ck/selectKnight':
      case 'ck/activateKnight':
      case 'ck/promoteKnight':
      case 'ck/chaseRobber':
        return false;
      case 'ck/play': {
        const card = x['card'];
        if (!isProgressCard(card) || !CHANGED_CARDS.includes(card)) return true;
        if (seen.has(keyOf(a))) return false;
        seen.add(keyOf(a));
        return cardBlocker(state, a.player, card) === null;
      }
      case 'ck/pickHex':
        return badHex(state, x['hex']) === null;
      case 'ck/pickVertex':
        return !badMedicine(state, x['vertex']);
      case 'ck/improve':
        return !(isTrack(x['track']) && trackCut(state, a.player, x['track']));
      case 'endTurn':
        return state.phase.kind !== 'main' || castleKnights(state, a.player).length === 0;
      default:
        return true;
    }
  });
}

// ---------------------------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------------------------

export const backModule: ExpansionModule = {
  id: BACK,
  name: 'Barbarian Attack + Cities & Knights',
  requires: [CK, TB],
  before: [CK, TB],
  players: { min: 3, max: 6 },
  modes: [
    {
      id: BACK_MODE,
      name: 'Barbarian Attack + Cities & Knights',
      blurb: 'Barbarians land from the event die; C&K knights fight them on the paths',
      status: 'ready',
      expansions: [BACK],
      scenarios: [SC_BA],
      players: { min: 3, max: 6 },
      scenarioVp: { [SC_BA]: BACK_VP },
      // No robber in Barbarian Attack: nobody chases it before the roll.
      hideOptions: ['ck.knightErrant'],
    },
  ],

  validate(settings) {
    if (settings.scenario !== SC_BA) return 'Barbarian Attack + C&K plays the Barbarian Attack';
    return null;
  },

  init(draft) {
    const slice: BackSlice = {
      v: 1,
      knights: {},
      moved: [],
      tokens: draft.players.map(() => 0),
    };
    draft.ext[BACK] = slice;
  },
  cloneExt: (slice) => cloneJson(slice),

  actions: handlers,
  wraps,
  overrides: {
    // The landing after a settlement / city (T&B) may need the prisoners' refill first.
    buildSettlement: (draft, action, next) => {
      refill(draft);
      return next(draft, action);
    },
    buildCity: (draft, action, next) => {
      refill(draft);
      return next(draft, action);
    },
    discard: (draft, action, next) => afterDiscard(draft, draft.phase.kind, next(draft, action)),
    endTurn: (draft, action, next) => {
      const k = phaseOf(draft).kind;
      if ((k !== 'main' && k !== 'back/knights') || endTurnPhase(draft, action.player)) {
        return next(draft, action);
      }
      if (overHand(draft, action.player)) {
        return fail(`play or discard progress cards down to ${PROGRESS_HAND_MAX} first`);
      }
      if (castleKnights(draft, action.player).length > 0) {
        return fail('move your knights off the castle first');
      }
      expel(draft);
      refill(draft);
      draft.phase = { kind: 'main' };
      return next(draft, action);
    },
  },
  legal,
  filterLegal,
  changesRoads: [],

  actors(state) {
    const ph = phaseOf(state) as BackPhase;
    if (ph.kind === 'back/relocate') return [ph.knight.owner];
    if (ph.kind === 'back/deserter' && ph.victim !== null) return [ph.victim];
    return ph.kind.startsWith('back/') ? [state.turn.current] : undefined;
  },

  hooks: {
    onRoll(draft) {
      // C&K sets the face it rolls; Easy start rolls none (then no ship lands).
      ckSlice(draft).event = null;
      return undefined;
    },
    onSeven(draft, pending) {
      if (pending.some((n) => n > 0)) return { kind: 'discard', pending: [...pending] };
      return stealPhase(draft);
    },
    production(state, roll, owed, ctx) {
      shipConquers(state, roll, owed, ctx.cityYield);
    },
    afterProduction(draft, roll, paid) {
      if (shipRolled(draft)) landOn(draft, roll, 'The ship');
      const aqueduct = withoutConquered(draft, () =>
        ckModule.hooks?.afterProduction?.(draft, roll, paid),
      );
      tbModule.hooks?.afterProduction?.(draft, roll, paid);
      return aqueduct ?? { kind: 'main' };
    },
    victoryPoints(state, p) {
      const n = backSlice(state).tokens[p] ?? 0;
      return { public: n, parts: n > 0 ? [{ label: 'Prisoner tokens', vp: n }] : [] };
    },
    onStartTurn(draft) {
      backSlice(draft).moved = [];
    },
    afterAction(draft) {
      syncSafe(draft);
      merchantConquered(draft);
      if (baOf(draft).supply < 3) refill(draft);
    },
    statsCategory: (_state, action, p) => {
      switch (action.type) {
        case 'back/recruit':
        case 'back/activate':
        case 'back/promote':
          return { loss: 'build' };
        case 'back/taxHex':
          return p === action.player ? { gain: 'steal' } : { loss: 'stolen' };
        default:
          return undefined;
      }
    },
  },
};

/** Tracks of `p` whose improvements the conquered metropolis blocks (HUD). */
export const cutTracks = (state: GameState, p: PlayerId): Track[] =>
  TRACKS.filter((t) => trackCut(state, p, t));
