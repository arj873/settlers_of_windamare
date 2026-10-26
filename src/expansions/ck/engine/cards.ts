/**
 * Progress cards (§4.6): when each can be played (it must be able to have an effect, CK-53),
 * what it does at once, and the steps of the ones that need choices (phase `ck/card`).
 */
import { RESOURCES } from '../../../engine/constants';
import { log } from '../../../engine/actions/common';
import { stealCandidates } from '../../../engine/actions/robber';
import { terrainKind } from '../../../engine/expansions/hooks';
import { hasResources, isResource } from '../../../engine/resources';
import { canPlaceRoad } from '../../../engine/rules/placement';
import { playerName } from '../../../engine/rules/text';
import { buildingsOf, piecesLeft, publicVictoryPoints } from '../../../engine/selectors';
import { topologyOf, vertexHexes } from '../../../engine/topology';
import type { EdgeId, GameState, HexId, Phase, PlayerId, VertexId } from '../../../engine/types';
import { hasRobber, roadsBlocked, robberTargets } from '../../../engine/variants';
import { canPlaceKnightAt, isOpenRoad, touchesRoad } from './routes';
import {
  cardsOf,
  displaced,
  goodCount,
  knightsInSupply,
  levelOf,
  mainTurn,
  moveGood,
  promoteBlocker,
  returnCard,
  stealRandom,
  wallSpotOk,
  MEDICINE_COST,
  payResources,
} from './rules';
import {
  CARD_NAMES,
  CARD_TRACK,
  COMMODITIES,
  MAX_LEVEL,
  TRACKS,
  ckPlayer,
  ckSlice,
  isRobberActive,
  isVpCard,
  type CardPhase,
  type Good,
  type Knight,
  type KnightLevel,
  type ProgressCard,
} from './state';

const pn = playerName;
const opponents = (state: GameState, p: PlayerId): PlayerId[] => {
  const n = state.players.length;
  return Array.from({ length: n - 1 }, (_, i) => (p + 1 + i) % n);
};

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

/** Hexes whose token the Inventor may move: not 2, 6, 8 or 12 (and not the desert). */
export function inventorHexes(state: GameState): HexId[] {
  return (Object.keys(state.board.hexes) as HexId[])
    .filter((h) => {
      const tok = state.board.hexes[h]?.token;
      return typeof tok === 'number' && ![2, 6, 8, 12].includes(tok);
    })
    .sort();
}

/** Hexes of `terrain` next to at least one of `p`'s buildings (Irrigation / Mining). */
export function hexesNextTo(state: GameState, p: PlayerId, terrain: 'grain' | 'ore'): HexId[] {
  const t = topologyOf(state);
  const out = new Set<HexId>();
  for (const v of buildingsOf(state, p)) {
    for (const h of vertexHexes(t, v)) {
      if (state.board.hexes[h]?.terrain === terrain) out.add(h);
    }
  }
  return [...out].sort();
}

/** Land hexes next to `p`'s buildings (Merchant). */
export function merchantHexes(state: GameState, p: PlayerId): HexId[] {
  const t = topologyOf(state);
  const out = new Set<HexId>();
  for (const v of buildingsOf(state, p)) {
    for (const h of vertexHexes(t, v)) {
      const tile = state.board.hexes[h];
      if (tile && terrainKind(tile.terrain) === 'land' && tile.terrain !== 'gold') out.add(h);
    }
  }
  return [...out].sort();
}

/** Opponents' knights on spots touched by `p`'s roads (Intrigue). */
export function intrigueTargets(state: GameState, p: PlayerId): VertexId[] {
  return (Object.entries(ckSlice(state).knights) as [VertexId, Knight][])
    .filter(([v, k]) => k.owner !== p && touchesRoad(state, p, v))
    .map(([v]) => v);
}

/** Every open road (Diplomat), any owner. */
export function openRoads(state: GameState): EdgeId[] {
  return (Object.keys(state.pieces.roads) as EdgeId[]).filter((e) => isOpenRoad(state, e));
}

/** `state` without the road on `e` (the Diplomat re-placing own road). */
function withoutRoad(state: GameState, e: EdgeId): GameState {
  const roads = { ...state.pieces.roads };
  Reflect.deleteProperty(roads, e);
  return { ...state, pieces: { ...state.pieces, roads } };
}

/** Where `p` may put the road the Diplomat took away (not back on the same edge). */
export function diplomatSpots(state: GameState, p: PlayerId, removed: EdgeId): EdgeId[] {
  if (roadsBlocked(state, p)) return [];
  const s = withoutRoad(state, removed);
  return topologyOf(state).edges.filter((e) => e !== removed && canPlaceRoad(s, p, e));
}

/** Can `p` place any road now (Road Building)? */
export function canPlaceAnyRoad(state: GameState, p: PlayerId): boolean {
  if (piecesLeft(state, p).road < 1 || roadsBlocked(state, p)) return false;
  return topologyOf(state).edges.some((e) => canPlaceRoad(state, p, e));
}

/** Knights `p` may promote for free (Smith), not ones already promoted by this card. */
export function smithTargets(
  state: GameState,
  p: PlayerId,
  done: readonly VertexId[] = [],
): VertexId[] {
  return (Object.keys(ckSlice(state).knights) as VertexId[]).filter(
    (v) => !done.includes(v) && promoteBlocker(state, p, v, true) === null,
  );
}

/** Players with strictly more VP than `p` and at least one card (Wedding, Master Merchant). */
export function richerWithCards(state: GameState, p: PlayerId): PlayerId[] {
  const mine = publicVictoryPoints(state, p);
  return opponents(state, p).filter(
    (q) => publicVictoryPoints(state, q) > mine && cardsOf(state, q) > 0,
  );
}

/** Saboteur: other players with at least as many VP, and how many cards each discards. */
export function sabotagePending(state: GameState, p: PlayerId): number[] {
  const mine = publicVictoryPoints(state, p);
  return state.players.map((q) =>
    q.id !== p && publicVictoryPoints(state, q.id) >= mine
      ? Math.floor(cardsOf(state, q.id) / 2)
      : 0,
  );
}

/** Deserter: the level `p` may place for a removed knight of `level` (same, else basic). */
export function deserterLevel(
  state: GameState,
  p: PlayerId,
  level: KnightLevel,
): KnightLevel | null {
  if (knightsInSupply(state, p, level) > 0) return level;
  if (knightsInSupply(state, p, 1) > 0) return 1;
  return null;
}

export const deserterSpots = (state: GameState, p: PlayerId): VertexId[] =>
  topologyOf(state).vertices.filter((v) => canPlaceKnightAt(state, p, v));

// ---------------------------------------------------------------------------
// Playability
// ---------------------------------------------------------------------------

/** Why `p` cannot play `card` now, or null. */
export function playBlocker(state: GameState, p: PlayerId, card: ProgressCard): string | null {
  if (isVpCard(card)) return 'victory point cards are revealed, never played';
  if (card === 'alchemist') return 'play the Alchemist before rolling';
  const m = mainTurn(state, p);
  if (m) return m;
  if (!ckPlayer(state, p).progress.includes(card)) return `you have no ${CARD_NAMES[card]}`;
  return effectBlocker(state, p, card);
}

/** Why `card` could have no effect for `p` now (CK-53), or null. */
export function effectBlocker(state: GameState, p: PlayerId, card: ProgressCard): string | null {
  const s = ckSlice(state);
  const knights = Object.entries(s.knights) as [VertexId, Knight][];
  switch (card) {
    case 'crane':
      return buildingsOf(state, p, 'city').length > 0 &&
        TRACKS.some((t) => levelOf(state, p, t) < MAX_LEVEL)
        ? null
        : 'no city improvement to buy';
    case 'engineer':
      return buildingsOf(state, p, 'city').some((v) => wallSpotOk(state, p, v))
        ? null
        : 'no city can take a wall';
    case 'inventor':
      return inventorHexes(state).length >= 2 ? null : 'no tokens to swap';
    case 'irrigation':
      return hexesNextTo(state, p, 'grain').length > 0 && state.bank.grain > 0
        ? null
        : 'no fields next to your buildings';
    case 'mining':
      return hexesNextTo(state, p, 'ore').length > 0 && state.bank.ore > 0
        ? null
        : 'no mountains next to your buildings';
    case 'medicine': {
      const hand = state.players[p]?.resources;
      if (buildingsOf(state, p, 'settlement').length === 0) return 'no settlement to upgrade';
      if (piecesLeft(state, p).city <= 0) return 'no cities left';
      return hand && hasResources(hand, MEDICINE_COST) ? null : 'needs 2 ore and 1 grain';
    }
    case 'roadBuilding':
      return canPlaceAnyRoad(state, p) ? null : 'no road can be placed';
    case 'smith':
      return smithTargets(state, p).length > 0 ? null : 'no knight can be promoted';
    case 'bishop':
      if (!hasRobber(state.settings)) return 'there is no robber';
      if (!isRobberActive(state)) return 'the robber sleeps until the first barbarian attack';
      return robberTargets(state, p).length > 0 ? null : 'the robber cannot move';
    case 'deserter':
      return knights.some(([, k]) => k.owner !== p) ? null : 'no opponent has a knight';
    case 'diplomat':
      return openRoads(state).length > 0 ? null : 'there is no open road';
    case 'intrigue':
      return intrigueTargets(state, p).length > 0 ? null : 'no opponent knight on your roads';
    case 'saboteur':
      return sabotagePending(state, p).some((n) => n > 0)
        ? null
        : 'nobody with as many points would discard';
    case 'spy':
      return opponents(state, p).some((q) => (s.players[q]?.progress.length ?? 0) > 0)
        ? null
        : 'no opponent holds progress cards';
    case 'warlord':
      return knights.some(([, k]) => k.owner === p && !k.active) ? null : 'no inactive knight';
    case 'wedding':
    case 'masterMerchant':
      return richerWithCards(state, p).length > 0 ? null : 'nobody with more points has cards';
    case 'commercialHarbor':
      return RESOURCES.some((r) => goodCount(state, p, r) > 0) &&
        opponents(state, p).some((q) => COMMODITIES.some((c) => goodCount(state, q, c) > 0))
        ? null
        : 'no resource to offer, or nobody holds a commodity';
    case 'merchant':
      return merchantHexes(state, p).length > 0 ? null : 'no hex next to your buildings';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Playing a card
// ---------------------------------------------------------------------------

/** Spend `card` from `p`'s hand (under its stack) and log it. */
export function spendCard(draft: GameState, p: PlayerId, card: ProgressCard): void {
  const pl = ckPlayer(draft, p);
  const i = pl.progress.indexOf(card);
  if (i >= 0) pl.progress.splice(i, 1);
  returnCard(draft, CARD_TRACK[card], card);
  log(draft, p, `${pn(draft, p)} played ${CARD_NAMES[card]}`);
}

/** Take up to `per` cards of `g` from every opponent (Monopolies). */
function monopoly(draft: GameState, p: PlayerId, g: Good, per: number): void {
  let taken = 0;
  for (const q of opponents(draft, p)) {
    const n = Math.min(per, goodCount(draft, q, g));
    if (n > 0) moveGood(draft, q, p, g, n);
    taken += n;
  }
  log(draft, p, `${pn(draft, p)} took ${taken} ${g}`);
}

/** Take 2 per matching hex from the bank (Irrigation, Mining; shortage: what remains). */
function harvest(draft: GameState, p: PlayerId, r: 'grain' | 'ore'): void {
  const want = 2 * hexesNextTo(draft, p, r).length;
  const n = Math.min(want, draft.bank[r]);
  if (n > 0) moveGood(draft, 'bank', p, r, n);
  log(draft, p, `${pn(draft, p)} took ${n} ${r}`);
}

/**
 * Resolve `card` played by `p` (already validated): an immediate effect (returns null, the game
 * stays in main), or the phase that asks for the card's choices.
 */
export function startCard(draft: GameState, p: PlayerId, card: ProgressCard): Phase | null {
  spendCard(draft, p, card);
  const s = ckSlice(draft);
  switch (card) {
    case 'crane':
      s.turn.cranes += 1;
      return null;
    case 'irrigation':
      harvest(draft, p, 'grain');
      return null;
    case 'mining':
      harvest(draft, p, 'ore');
      return null;
    case 'warlord':
      for (const k of Object.values(s.knights)) {
        if (k.owner === p && !k.active) {
          k.active = true;
          k.activatedOn = draft.turn.number;
        }
      }
      log(draft, p, `${pn(draft, p)} activated all their knights`);
      return null;
    case 'roadBuilding':
      return {
        kind: 'roadBuilding',
        remaining: Math.min(2, piecesLeft(draft, p).road),
        resume: 'main',
      };
    case 'saboteur':
      return { kind: 'ck/sabotage', pending: sabotagePending(draft, p) } as Phase;
    case 'wedding': {
      const givers = new Set(richerWithCards(draft, p));
      const pending = draft.players.map((q) =>
        givers.has(q.id) ? Math.min(2, cardsOf(draft, q.id)) : 0,
      );
      return { kind: 'ck/wedding', pending, to: p } as Phase;
    }
    case 'inventor':
      return { kind: 'ck/card', card, first: null } as Phase;
    case 'smith':
      return { kind: 'ck/card', card, left: 2, done: [] } as Phase;
    case 'deserter':
      return { kind: 'ck/card', card, victim: null, removed: null } as Phase;
    case 'diplomat':
      return { kind: 'ck/card', card, removed: null } as Phase;
    case 'spy':
      return { kind: 'ck/card', card, victim: null } as Phase;
    case 'masterMerchant':
      return { kind: 'ck/card', card, victim: null, left: 2 } as Phase;
    case 'commercialHarbor':
      return { kind: 'ck/card', card, queue: harborQueue(draft, p, []), offered: null } as Phase;
    case 'engineer':
    case 'medicine':
    case 'bishop':
    case 'intrigue':
    case 'merchant':
    case 'merchantFleet':
    case 'resourceMonopoly':
    case 'tradeMonopoly':
      return { kind: 'ck/card', card } as Phase;
    default:
      return null;
  }
}

/** Commercial Harbor: opponents not yet asked who hold a commodity, clockwise. */
export function harborQueue(state: GameState, p: PlayerId, asked: readonly PlayerId[]): PlayerId[] {
  return opponents(state, p).filter(
    (q) => !asked.includes(q) && COMMODITIES.some((c) => goodCount(state, q, c) > 0),
  );
}

/** Who answers the current card phase. */
export function cardActor(state: GameState, phase: CardPhase): PlayerId {
  if (phase.card === 'deserter' && phase.victim !== null && phase.removed === null) {
    return phase.victim;
  }
  if (phase.card === 'commercialHarbor' && phase.offered !== null) {
    return phase.queue[0] ?? state.turn.current;
  }
  return state.turn.current;
}

// ---------------------------------------------------------------------------
// Card steps (choices), validated by the caller against cardOptions
// ---------------------------------------------------------------------------

export type CardChoice =
  | { kind: 'vertex'; id: VertexId }
  | { kind: 'edge'; id: EdgeId }
  | { kind: 'hex'; id: HexId }
  | { kind: 'player'; id: PlayerId }
  | { kind: 'good'; id: Good }
  | { kind: 'card'; id: ProgressCard }
  | { kind: 'done' };

/** Every choice the card phase offers now (to its actor). */
export function cardOptions(state: GameState, phase: CardPhase): CardChoice[] {
  const p = state.turn.current;
  const s = ckSlice(state);
  const v = (ids: readonly VertexId[]) => ids.map((id): CardChoice => ({ kind: 'vertex', id }));
  const g = (ids: readonly Good[]) => ids.map((id): CardChoice => ({ kind: 'good', id }));
  switch (phase.card) {
    case 'inventor':
      return inventorHexes(state)
        .filter((h) => h !== phase.first)
        .map((id) => ({ kind: 'hex', id }));
    case 'engineer':
      return v(buildingsOf(state, p, 'city').filter((x) => wallSpotOk(state, p, x)));
    case 'medicine':
      return v(buildingsOf(state, p, 'settlement'));
    case 'smith':
      return [...v(smithTargets(state, p, phase.done)), { kind: 'done' }];
    case 'bishop':
      return robberTargets(state, p).map((id) => ({ kind: 'hex', id }));
    case 'intrigue':
      return v(intrigueTargets(state, p));
    case 'merchant':
      return merchantHexes(state, p).map((id) => ({ kind: 'hex', id }));
    case 'merchantFleet':
      return g([...RESOURCES, ...COMMODITIES]);
    case 'resourceMonopoly':
      return g(RESOURCES);
    case 'tradeMonopoly':
      return g(COMMODITIES);
    case 'deserter': {
      if (phase.victim === null) {
        const owners = new Set(Object.values(s.knights).map((k) => k.owner));
        return opponents(state, p)
          .filter((q) => owners.has(q))
          .map((id) => ({ kind: 'player', id }));
      }
      if (phase.removed === null) {
        const victim = phase.victim;
        return v(
          (Object.keys(s.knights) as VertexId[]).filter((x) => s.knights[x]?.owner === victim),
        );
      }
      return [...v(deserterSpots(state, p)), { kind: 'done' }];
    }
    case 'diplomat':
      if (phase.removed === null) return openRoads(state).map((id) => ({ kind: 'edge', id }));
      return [
        ...diplomatSpots(state, p, phase.removed).map((id): CardChoice => ({ kind: 'edge', id })),
        { kind: 'done' },
      ];
    case 'spy': {
      if (phase.victim === null) {
        return opponents(state, p)
          .filter((q) => (s.players[q]?.progress.length ?? 0) > 0)
          .map((id) => ({ kind: 'player', id }));
      }
      const cards = [...new Set(s.players[phase.victim]?.progress ?? [])].sort();
      return cards.map((id) => ({ kind: 'card', id }));
    }
    case 'masterMerchant': {
      if (phase.victim === null)
        return richerWithCards(state, p).map((id) => ({ kind: 'player', id }));
      const victim = phase.victim;
      return g([...RESOURCES, ...COMMODITIES].filter((x) => goodCount(state, victim, x) > 0));
    }
    case 'commercialHarbor': {
      if (phase.offered === null) {
        return [...g(RESOURCES.filter((r) => goodCount(state, p, r) > 0)), { kind: 'done' }];
      }
      const q = phase.queue[0];
      return q === undefined ? [] : g(COMMODITIES.filter((c) => goodCount(state, q, c) > 0));
    }
  }
}

export const sameChoice = (a: CardChoice, b: CardChoice): boolean =>
  a.kind === b.kind &&
  (a.kind === 'done' || (a as { id: unknown }).id === (b as { id: unknown }).id);

/** Apply a validated choice. Sets the next phase (or main). */
export function applyCardChoice(draft: GameState, phase: CardPhase, choice: CardChoice): void {
  const p = draft.turn.current;
  const s = ckSlice(draft);
  const main = () => {
    draft.phase = { kind: 'main' };
  };
  const stay = (next: CardPhase) => {
    draft.phase = next as Phase;
  };
  switch (phase.card) {
    case 'inventor': {
      if (choice.kind !== 'hex') return;
      if (phase.first === null) return stay({ ...phase, first: choice.id });
      const a = draft.board.hexes[phase.first];
      const b = draft.board.hexes[choice.id];
      if (!a || !b) return main();
      draft.board = {
        ...draft.board,
        hexes: {
          ...draft.board.hexes,
          [a.id]: { ...a, token: b.token },
          [b.id]: { ...b, token: a.token },
        },
      };
      log(draft, p, `${pn(draft, p)} swapped the ${a.token} and the ${b.token}`);
      return main();
    }
    case 'engineer':
      if (choice.kind !== 'vertex') return;
      s.walls[choice.id] = p;
      log(draft, p, `${pn(draft, p)} built a city wall for free`);
      return main();
    case 'medicine':
      if (choice.kind !== 'vertex') return;
      payResources(draft, p, MEDICINE_COST);
      draft.pieces.buildings[choice.id] = { owner: p, kind: 'city' };
      log(draft, p, `${pn(draft, p)} built a city for 2 ore and 1 grain`);
      return main();
    case 'smith': {
      if (choice.kind === 'done') return main();
      if (choice.kind !== 'vertex') return;
      const k = s.knights[choice.id];
      if (!k) return main();
      k.level = (k.level + 1) as KnightLevel;
      k.promotedOn = draft.turn.number;
      log(draft, p, `${pn(draft, p)} promoted a knight for free`);
      const done = [...phase.done, choice.id];
      const left = phase.left - 1;
      return left > 0 && smithTargets(draft, p, done).length > 0
        ? stay({ ...phase, left, done })
        : main();
    }
    case 'bishop': {
      if (choice.kind !== 'hex') return;
      draft.robber = choice.id;
      log(draft, p, `${pn(draft, p)} moved the robber`);
      for (const q of stealCandidates(draft, p, choice.id)) {
        if (stealRandom(draft, p, q) !== null) {
          log(draft, p, `${pn(draft, p)} stole from ${pn(draft, q)}`);
        }
      }
      return main();
    }
    case 'intrigue': {
      if (choice.kind !== 'vertex') return;
      const k = s.knights[choice.id];
      if (!k) return main();
      Reflect.deleteProperty(s.knights, choice.id);
      log(draft, p, `${pn(draft, p)} drove off a knight of ${pn(draft, k.owner)}`);
      draft.phase = (displaced(draft, k, choice.id) as Phase | null) ?? { kind: 'main' };
      return;
    }
    case 'merchant': {
      if (choice.kind !== 'hex') return;
      const old = s.merchant?.owner;
      s.merchant = { hex: choice.id, owner: p };
      log(
        draft,
        p,
        old !== undefined && old !== p
          ? `${pn(draft, p)} took the merchant from ${pn(draft, old)}`
          : `${pn(draft, p)} placed the merchant`,
      );
      return main();
    }
    case 'merchantFleet':
      if (choice.kind !== 'good') return;
      if (!s.turn.fleet.includes(choice.id)) s.turn.fleet.push(choice.id);
      log(draft, p, `${pn(draft, p)} may trade ${choice.id} 2:1 this turn`);
      return main();
    case 'resourceMonopoly':
      if (choice.kind !== 'good') return;
      monopoly(draft, p, choice.id, 2);
      return main();
    case 'tradeMonopoly':
      if (choice.kind !== 'good') return;
      monopoly(draft, p, choice.id, 1);
      return main();
    case 'deserter': {
      if (phase.victim === null) {
        if (choice.kind !== 'player') return;
        return stay({ ...phase, victim: choice.id });
      }
      if (phase.removed === null) {
        if (choice.kind !== 'vertex') return;
        const k = s.knights[choice.id];
        if (!k) return main();
        Reflect.deleteProperty(s.knights, choice.id);
        log(draft, phase.victim, `${pn(draft, phase.victim)}'s knight deserted`);
        const level = deserterLevel(draft, p, k.level);
        if (level === null || deserterSpots(draft, p).length === 0) return main();
        return stay({ ...phase, removed: { ...k, owner: p, level } });
      }
      if (choice.kind === 'done') return main();
      if (choice.kind !== 'vertex') return;
      const k = phase.removed;
      // An active deserter may act at once (FAQ Q83).
      s.knights[choice.id] = { ...k, owner: p, activatedOn: null, promotedOn: null };
      log(draft, p, `${pn(draft, p)} placed the deserter`);
      return main();
    }
    case 'diplomat': {
      if (phase.removed === null) {
        if (choice.kind !== 'edge') return;
        const owner = draft.pieces.roads[choice.id];
        if (owner === undefined) return main();
        if (owner !== p) {
          Reflect.deleteProperty(draft.pieces.roads, choice.id);
          log(draft, p, `${pn(draft, p)} removed a road of ${pn(draft, owner)}`);
          return main();
        }
        // Own road: it stays put until it is re-placed (or not), so Longest Road is
        // recomputed only once the move is complete (FAQ Q88).
        return stay({ ...phase, removed: choice.id });
      }
      Reflect.deleteProperty(draft.pieces.roads, phase.removed);
      if (choice.kind === 'edge') {
        draft.pieces.roads[choice.id] = p;
        log(draft, p, `${pn(draft, p)} moved one of their roads`);
      } else {
        log(draft, p, `${pn(draft, p)} removed one of their roads`);
      }
      return main();
    }
    case 'spy': {
      if (phase.victim === null) {
        if (choice.kind !== 'player') return;
        return stay({ ...phase, victim: choice.id });
      }
      if (choice.kind !== 'card') return;
      const from = ckPlayer(draft, phase.victim).progress;
      const i = from.indexOf(choice.id);
      if (i >= 0) from.splice(i, 1);
      ckPlayer(draft, p).progress.push(choice.id);
      log(draft, p, `${pn(draft, p)} took a progress card from ${pn(draft, phase.victim)}`);
      return main();
    }
    case 'masterMerchant': {
      if (phase.victim === null) {
        if (choice.kind !== 'player') return;
        return stay({ ...phase, victim: choice.id });
      }
      if (choice.kind !== 'good') return;
      moveGood(draft, phase.victim, p, choice.id);
      log(draft, p, `${pn(draft, p)} took a card from ${pn(draft, phase.victim)}`);
      const left = phase.left - 1;
      return left > 0 && cardsOf(draft, phase.victim) > 0 ? stay({ ...phase, left }) : main();
    }
    case 'commercialHarbor': {
      const q = phase.queue[0];
      if (phase.offered === null) {
        if (choice.kind !== 'good' || q === undefined || !isResource(choice.id)) return main();
        return stay({ ...phase, offered: choice.id });
      }
      if (choice.kind !== 'good' || q === undefined) return;
      moveGood(draft, p, q, phase.offered);
      moveGood(draft, q, p, choice.id);
      log(draft, p, `${pn(draft, p)} traded a resource for a commodity with ${pn(draft, q)}`);
      const queue = phase.queue
        .slice(1)
        .filter((x) => COMMODITIES.some((c) => goodCount(draft, x, c) > 0));
      return queue.length > 0 && RESOURCES.some((r) => goodCount(draft, p, r) > 0)
        ? stay({ ...phase, queue, offered: null })
        : main();
    }
  }
}
