/**
 * Game-state invariants, checked by the simulator after every step (and usable from tests).
 * Pure: reads a GameState, returns a list of violations (empty = healthy). Never throws on a
 * malformed state; a broken state is exactly what this module exists to describe.
 */
import {
  AWARD_VP,
  DEV_CARD_TYPES,
  DICE_DECK_RESHUFFLE_AT,
  DICE_DECK_SIZE,
  EVENT_CARDS,
  setupPlacementOf,
  LARGEST_ARMY_MIN,
  LONGEST_ROAD_MIN,
  MAPS,
  PIECE_LIMITS,
  RESOURCES,
  actingPlayers,
  edgeVertices,
  isBoardEdge,
  isBoardVertex,
  isLandHex,
  isMapId,
  setupPlayerAt,
  supplyOf,
  topologyOf,
  vertexNeighbors,
  victoryPoints,
  type DevCardType,
  type EdgeId,
  type GameState,
  type PlayerId,
  type VertexId,
} from '../engine';

export type ViolationCode =
  | 'structure'
  | 'resource-conservation'
  | 'dev-conservation'
  | 'piece-limit'
  | 'board-id'
  | 'building-adjacent'
  | 'road-disconnected'
  | 'robber-position'
  | 'vp-mismatch'
  | 'award-holder'
  | 'award-mismatch'
  | 'winner'
  | 'phase-actor'
  | 'dice-deck';

export interface Violation {
  code: ViolationCode;
  message: string;
  player?: PlayerId;
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** Each vertex's incident on-board roads of `player`. */
function roadsByVertex(state: GameState, player: PlayerId): Map<VertexId, EdgeId[]> {
  const t = topologyOf(state);
  const byVertex = new Map<VertexId, EdgeId[]>();
  for (const [edge, owner] of Object.entries(state.pieces.roads) as [EdgeId, PlayerId][]) {
    if (owner !== player || !isBoardEdge(t, edge)) continue;
    for (const v of edgeVertices(t, edge)) {
      const list = byVertex.get(v);
      if (list) list.push(edge);
      else byVertex.set(v, [edge]);
    }
  }
  return byVertex;
}

/**
 * Longest continuous road of `player`; an opponent's building on a junction cuts the road.
 * Deliberately independent of the engine's rules/longestRoad.ts (a cross-check).
 */
export function longestRoadLength(state: GameState, player: PlayerId): number {
  const t = topologyOf(state);
  const byVertex = roadsByVertex(state, player);
  const used = new Set<EdgeId>();
  const walk = (at: VertexId): number => {
    let best = 0;
    for (const edge of byVertex.get(at) ?? []) {
      if (used.has(edge)) continue;
      const next = edgeVertices(t, edge).find((v) => v !== at);
      if (next === undefined) continue;
      used.add(edge);
      const blocked = (state.pieces.buildings[next]?.owner ?? player) !== player;
      best = Math.max(best, 1 + (blocked ? 0 : walk(next)));
      used.delete(edge);
    }
    return best;
  };
  let best = 0;
  for (const v of byVertex.keys()) best = Math.max(best, walk(v));
  return best;
}

export function checkInvariants(state: GameState): Violation[] {
  const out: Violation[] = [];
  const add = (code: ViolationCode, message: string, player?: PlayerId) =>
    out.push(player === undefined ? { code, message } : { code, message, player });
  const n = state.players.length;
  const validPlayer = (p: unknown): p is PlayerId => isCount(p) && p < n;

  // --- structure -----------------------------------------------------------------------------
  if (!isMapId(state.settings.map)) {
    add('structure', `unknown map ${String(state.settings.map)}`);
    return out; // every board check below needs the map's topology
  }
  const map = MAPS[state.settings.map];
  const t = topologyOf(state);
  const supply = supplyOf(state);
  if (n < map.minPlayers || n > map.maxPlayers) {
    add('structure', `map ${map.id} expects ${map.minPlayers}-${map.maxPlayers} players, got ${n}`);
  }
  state.players.forEach((p, i) => {
    if (p.id !== i) add('structure', `players[${i}].id is ${p.id}`, i);
  });
  if (!validPlayer(state.turn.current)) add('structure', `turn.current ${state.turn.current}`);

  // --- resources: bank + hands = the map's stock (19 / 24 / 29) each --------------------------
  for (const r of RESOURCES) {
    const counts = [state.bank[r], ...state.players.map((p) => p.resources[r])];
    if (!counts.every((c) => isCount(c))) {
      add('resource-conservation', `${r}: negative or fractional count in ${counts.join(',')}`);
      continue;
    }
    const total = counts.reduce((a, b) => a + b, 0);
    if (total !== supply.bankPerResource) {
      add(
        'resource-conservation',
        `${r}: bank + hands = ${total}, expected ${supply.bankPerResource}`,
      );
    }
  }

  // --- dev cards: deck + hands + played = the map's composition, exactly, per type ------------
  // Played knights live in knightsPlayed, played progress cards in progressCardsPlayed; VP cards
  // are never played.
  const played = (p: (typeof state.players)[number], t: DevCardType): number =>
    t === 'knight' ? p.knightsPlayed : t === 'victoryPoint' ? 0 : p.progressCardsPlayed[t];
  const heldCounts = state.players.flatMap((p) => [
    ...DEV_CARD_TYPES.map((t) => p.devCards[t]),
    ...DEV_CARD_TYPES.map((t) => p.newDevCards[t]),
    ...DEV_CARD_TYPES.map((t) => played(p, t)),
  ]);
  if (!heldCounts.every(isCount)) add('dev-conservation', 'negative or fractional dev card count');
  for (const t of DEV_CARD_TYPES) {
    const inDeck = state.devDeck.filter((c) => c === t).length;
    const held = state.players.reduce((s, p) => s + p.devCards[t] + p.newDevCards[t], 0);
    const out = state.players.reduce((s, p) => s + played(p, t), 0);
    const cap = supply.devDeck[t];
    if (inDeck + held + out !== cap) {
      add(
        'dev-conservation',
        `${t}: deck ${inDeck} + hands ${held} + played ${out} = ${inDeck + held + out}, expected ${cap}`,
      );
    }
  }
  if (state.devDeck.some((c) => !DEV_CARD_TYPES.includes(c))) {
    add('dev-conservation', 'unknown card type in devDeck');
  }
  // Cards bought this turn are merged on endTurn (special-build purchases go straight to
  // devCards), so only the current player can hold any.
  state.players.forEach((p) => {
    if (p.id !== state.turn.current && DEV_CARD_TYPES.some((t) => p.newDevCards[t] > 0)) {
      add('dev-conservation', `player ${p.id} holds this turn's dev cards off turn`, p.id);
    }
  });

  checkDiceDeck(state, add);
  checkEventDeck(state, add);

  // --- board ids, robber ---------------------------------------------------------------------
  const buildings = Object.entries(state.pieces.buildings) as [VertexId, { owner: PlayerId }][];
  const roads = Object.entries(state.pieces.roads) as [EdgeId, PlayerId][];
  for (const [v, b] of buildings) {
    if (!isBoardVertex(t, v)) add('board-id', `building on off-board vertex ${v}`);
    if (!validPlayer(b.owner)) add('structure', `building ${v} has owner ${b.owner}`);
  }
  for (const [e, owner] of roads) {
    if (!isBoardEdge(t, e)) add('board-id', `road on off-board edge ${e}`);
    if (!validPlayer(owner)) add('structure', `road ${e} has owner ${owner}`);
  }
  if (!isLandHex(t, state.robber)) add('robber-position', `robber on non-land hex ${state.robber}`);

  // --- piece limits --------------------------------------------------------------------------
  for (const p of state.players) {
    const mine = buildings.filter(([, b]) => b.owner === p.id);
    const counts = {
      road: roads.filter(([, o]) => o === p.id).length,
      settlement: mine.filter(([v]) => state.pieces.buildings[v]?.kind === 'settlement').length,
      city: mine.filter(([v]) => state.pieces.buildings[v]?.kind === 'city').length,
    };
    for (const kind of ['road', 'settlement', 'city'] as const) {
      if (counts[kind] > PIECE_LIMITS[kind]) {
        add(
          'piece-limit',
          `player ${p.id} has ${counts[kind]} ${kind}s (max ${PIECE_LIMITS[kind]})`,
          p.id,
        );
      }
    }
  }

  // --- distance rule (setup restriction 'anyVertex' lets setup buildings ignore it) ----------
  const place = setupPlacementOf(state.settings);
  const distanceRule =
    place.first.restriction !== 'anyVertex' && place.second.restriction !== 'anyVertex';
  for (const [v] of distanceRule ? buildings : []) {
    if (!isBoardVertex(t, v)) continue;
    for (const nb of vertexNeighbors(t, v)) {
      if (v < nb && state.pieces.buildings[nb])
        add('building-adjacent', `buildings on adjacent ${v} and ${nb}`);
    }
  }

  // --- every road touches its owner's network ------------------------------------------------
  // Lenient on purpose: a road may legitimately be cut off from the rest of the owner's network
  // by an opponent's later settlement, so we only require a neighbouring own road or own building.
  const roadsAt = state.players.map((p) => roadsByVertex(state, p.id));
  for (const [e, owner] of roads) {
    if (!isBoardEdge(t, e)) continue;
    const linked = edgeVertices(t, e).some(
      (v) =>
        state.pieces.buildings[v]?.owner === owner ||
        (roadsAt[owner]?.get(v) ?? []).some((e2) => e2 !== e),
    );
    if (!linked)
      add('road-disconnected', `road ${e} of player ${owner} touches nothing of theirs`, owner);
  }

  // --- awards ---------------------------------------------------------------------------------
  const { longestRoad, largestArmy } = state.awards;
  if (longestRoad !== null && !validPlayer(longestRoad))
    add('award-holder', `longestRoad holder ${longestRoad}`);
  if (largestArmy !== null && !validPlayer(largestArmy))
    add('award-holder', `largestArmy holder ${largestArmy}`);
  if (state.players.every((p) => validPlayer(p.id))) {
    const lengths = state.players.map((p) => longestRoadLength(state, p.id));
    const maxLen = Math.max(...lengths);
    const leaders = lengths.flatMap((l, p) => (l === maxLen ? [p] : []));
    if (maxLen < LONGEST_ROAD_MIN) {
      if (longestRoad !== null)
        add(
          'award-mismatch',
          `longestRoad held by ${longestRoad} but longest road is only ${maxLen}`,
        );
    } else if (leaders.length === 1 && longestRoad !== leaders[0]) {
      add(
        'award-mismatch',
        `longestRoad is ${String(longestRoad)} but player ${leaders[0]} has unique longest (${maxLen})`,
      );
    } else if (longestRoad !== null && lengths[longestRoad] !== maxLen) {
      add(
        'award-mismatch',
        `longestRoad holder ${longestRoad} has ${lengths[longestRoad]}, longest is ${maxLen}`,
      );
    }
    const knights = state.players.map((p) => p.knightsPlayed);
    const maxK = Math.max(...knights);
    const kLeaders = knights.flatMap((k, p) => (k === maxK ? [p] : []));
    if (maxK < LARGEST_ARMY_MIN) {
      if (largestArmy !== null)
        add('award-mismatch', `largestArmy held by ${largestArmy} with only ${maxK} knights`);
    } else if (kLeaders.length === 1 && largestArmy !== kLeaders[0]) {
      add(
        'award-mismatch',
        `largestArmy is ${String(largestArmy)} but player ${kLeaders[0]} has unique most knights (${maxK})`,
      );
    } else if (largestArmy !== null && knights[largestArmy] !== maxK) {
      add(
        'award-mismatch',
        `largestArmy holder ${largestArmy} has ${knights[largestArmy]} knights, most is ${maxK}`,
      );
    }
  }

  // --- victory points: recomputed from raw pieces, compared to the selector -------------------
  for (const p of state.players) {
    const mine = buildings.filter(([, b]) => b.owner === p.id);
    const vp =
      mine.reduce((s, [v]) => s + (state.pieces.buildings[v]?.kind === 'city' ? 2 : 1), 0) +
      (longestRoad === p.id ? AWARD_VP : 0) +
      (largestArmy === p.id ? AWARD_VP : 0) +
      p.devCards.victoryPoint +
      p.newDevCards.victoryPoint;
    const reported = victoryPoints(state, p.id);
    if (vp !== reported)
      add(
        'vp-mismatch',
        `player ${p.id}: recomputed ${vp} VP, victoryPoints() says ${reported}`,
        p.id,
      );
  }

  // --- winner / game over --------------------------------------------------------------------
  const over = state.phase.kind === 'gameOver';
  if (over !== (state.winner !== null)) {
    add('winner', `phase ${state.phase.kind} but winner = ${String(state.winner)}`);
  } else if (state.winner !== null) {
    if (!validPlayer(state.winner)) add('winner', `winner ${state.winner} is not a player`);
    else if (victoryPoints(state, state.winner) < state.settings.vpToWin) {
      add(
        'winner',
        `winner ${state.winner} has ${victoryPoints(state, state.winner)} VP < ${state.settings.vpToWin}`,
        state.winner,
      );
    }
  } else if (
    state.phase.kind !== 'specialBuild' &&
    validPlayer(state.turn.current) &&
    victoryPoints(state, state.turn.current) >= state.settings.vpToWin
  ) {
    // Contract: every successful action runs checkVictory for the current player (except in
    // the special building phase, where nobody can win).
    add(
      'winner',
      `current player ${state.turn.current} has ${victoryPoints(state, state.turn.current)} VP but game is not over`,
    );
  }

  checkPhase(state, add, validPlayer);
  return out;
}

function checkPhase(
  state: GameState,
  add: (code: ViolationCode, message: string, player?: PlayerId) => void,
  validPlayer: (p: unknown) => p is PlayerId,
): void {
  const phase = state.phase;
  const n = state.players.length;
  const hand = (p: PlayerId) =>
    RESOURCES.reduce((s, r) => s + (state.players[p]?.resources[r] ?? 0), 0);
  const setupPhase = phase.kind === 'setup' || phase.kind === 'mapVeto';
  if (setupPhase !== (state.turn.number === 0)) {
    add('phase-actor', `phase ${phase.kind} with turn.number ${state.turn.number}`);
  }
  const actors = actingPlayers(state);
  if (actors.some((p) => !validPlayer(p)))
    add('phase-actor', `acting players ${actors.join(',')} not valid`);
  if (phase.kind !== 'gameOver' && actors.length === 0)
    add('phase-actor', `no one can act in ${phase.kind}`);

  switch (phase.kind) {
    case 'setup': {
      if (!isCount(phase.index) || phase.index >= 2 * n) {
        add('phase-actor', `setup index ${phase.index} out of range`);
        break;
      }
      const expected = setupPlayerAt(phase.index, n, state.settings.startingPlayer);
      if (state.turn.current !== expected) {
        add(
          'phase-actor',
          `setup index ${phase.index}: current ${state.turn.current}, expected ${expected}`,
        );
      }
      const last = phase.lastSettlement;
      if (phase.step === 'road') {
        if (last === null || state.pieces.buildings[last]?.owner !== state.turn.current) {
          add(
            'phase-actor',
            `setup road step without the current player's lastSettlement (${String(last)})`,
          );
        }
      } else if (last !== null) {
        add('phase-actor', `setup settlement step but lastSettlement = ${last}`);
      }
      break;
    }
    case 'discard': {
      if (phase.pending.length !== n || !phase.pending.every(isCount)) {
        add('phase-actor', `discard.pending malformed: [${phase.pending.join(',')}]`);
        break;
      }
      if (phase.pending.every((c) => c === 0))
        add('phase-actor', 'discard phase with nothing pending');
      phase.pending.forEach((c, p) => {
        if (c > hand(p))
          add('phase-actor', `player ${p} must discard ${c} but holds ${hand(p)}`, p);
      });
      break;
    }
    case 'steal': {
      if (phase.candidates.length === 0) add('phase-actor', 'steal phase with no candidates');
      for (const c of phase.candidates) {
        if (!validPlayer(c) || c === state.turn.current)
          add('phase-actor', `bad steal candidate ${c}`);
        else if (hand(c) === 0) add('phase-actor', `steal candidate ${c} has no cards`, c);
      }
      break;
    }
    case 'roadBuilding':
      if (phase.remaining < 1 || phase.remaining > 2) {
        add('phase-actor', `roadBuilding.remaining = ${phase.remaining}`);
      }
      break;
    case 'mapVeto': {
      if (state.settings.mapSelection !== 'veto') add('phase-actor', 'mapVeto without veto');
      const left = phase.vetoed.filter((v) => v === null).length;
      if (phase.vetoed.length !== phase.candidates.length || left < 2)
        add('phase-actor', `mapVeto with ${left} maps left`);
      if (phase.order[phase.next] !== state.turn.current)
        add('phase-actor', `mapVeto: current ${state.turn.current}, expected order[${phase.next}]`);
      break;
    }
    case 'event': {
      if (!state.settings.eventCards) add('phase-actor', 'event phase without event cards');
      const seen = new Set<PlayerId>();
      for (const t of phase.tasks) {
        if (!validPlayer(t.player) || seen.has(t.player))
          add('phase-actor', `event task for player ${t.player} invalid or repeated`);
        seen.add(t.player);
        if (t.kind === 'steal' && t.targets.every((v) => hand(v) === 0))
          add('phase-actor', `event steal for ${t.player} without a victim holding cards`);
        if (t.kind === 'give' && hand(t.player) === 0)
          add('phase-actor', `event give for ${t.player} with an empty hand`);
      }
      if (phase.tasks.length === 0) add('phase-actor', 'event phase with no tasks');
      break;
    }
    case 'trade': {
      const o = phase.offer;
      if (o.from !== state.turn.current)
        add('phase-actor', `offer from ${o.from}, current is ${state.turn.current}`);
      if (o.responses.length !== n)
        add('phase-actor', `offer.responses has ${o.responses.length} entries`);
      else if (o.responses[o.from] !== null) add('phase-actor', 'offerer has a response entry');
      if (!RESOURCES.every((r) => isCount(o.give[r]) && isCount(o.want[r]))) {
        add('phase-actor', 'offer give/want malformed');
      }
      break;
    }
    case 'specialBuild':
      if (!state.settings.specialBuildPhase) add('phase-actor', 'specialBuild phase but SBP off');
      if (phase.builder !== state.turn.current)
        add('phase-actor', `specialBuild builder ${phase.builder}, current ${state.turn.current}`);
      if (!validPlayer(phase.owner) || phase.owner === phase.builder)
        add('phase-actor', `specialBuild owner ${phase.owner}, builder ${phase.builder}`);
      break;
    default:
      break;
  }
}

/**
 * Event cards: the deck holds distinct card ids (0..35), at least DICE_DECK_RESHUFFLE_AT after
 * the first draw; each damaged road belongs to its player. Without event cards: no such fields.
 */
function checkEventDeck(
  state: GameState,
  add: (code: ViolationCode, message: string, player?: PlayerId) => void,
): void {
  if (!state.settings.eventCards) {
    if (state.eventDeck !== undefined || state.damagedRoads !== undefined)
      add('dice-deck', 'event-card fields without event cards');
    return;
  }
  const deck = state.eventDeck;
  if (!Array.isArray(deck)) {
    add('dice-deck', 'eventDeck missing');
    return;
  }
  if (
    deck.some((c) => !isCount(c) || c >= EVENT_CARDS.length) ||
    new Set(deck).size !== deck.length
  ) {
    add('dice-deck', `eventDeck malformed: [${deck.join(',')}]`);
  } else if (state.dice !== null && deck.length < DICE_DECK_RESHUFFLE_AT) {
    add('dice-deck', `eventDeck has ${deck.length} cards after a draw`);
  }
  (state.damagedRoads ?? []).forEach((e, p) => {
    if (e !== null && state.pieces.roads[e] !== p)
      add('structure', `damaged road ${e} of player ${p} is not theirs`, p);
  });
}

/**
 * Balanced dice: the deck holds distinct cards 0..35, never the card just rolled, and after the
 * first roll at least DICE_DECK_RESHUFFLE_AT of them (empty is allowed for upgraded saves).
 * Without balanced dice it stays empty.
 */
function checkDiceDeck(
  state: GameState,
  add: (code: ViolationCode, message: string, player?: PlayerId) => void,
): void {
  const deck = state.diceDeck;
  if (!Array.isArray(deck)) {
    add('dice-deck', 'diceDeck missing');
    return;
  }
  if (!state.settings.balancedDice) {
    if (deck.length > 0)
      add('dice-deck', `diceDeck has ${deck.length} cards without balanced dice`);
    return;
  }
  if (deck.some((c) => !isCount(c) || c >= DICE_DECK_SIZE) || new Set(deck).size !== deck.length) {
    add('dice-deck', `diceDeck malformed: [${deck.join(',')}]`);
    return;
  }
  if (state.dice === null) {
    if (deck.length > 0) add('dice-deck', 'diceDeck filled before the first roll');
    return;
  }
  if (deck.length > 0 && (deck.length < DICE_DECK_RESHUFFLE_AT || deck.length >= DICE_DECK_SIZE))
    add('dice-deck', `diceDeck has ${deck.length} cards after a roll`);
  const last = (state.dice[0] - 1) * 6 + (state.dice[1] - 1);
  if (deck.includes(last)) add('dice-deck', `rolled card ${last} is still in the dice deck`);
}
