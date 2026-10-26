/**
 * Cities & Knights invariants for the simulator: commodities and progress cards are conserved,
 * knights / walls / metropolises respect their limits and sit where the rules put them, the
 * barbarians and the sleeping robber behave, Longest Road counts knights as blockers (the base
 * cross-check does not know them, so 'award-mismatch' is relaxed and re-checked here), and the
 * C&K victory points add up. The random bot needs nothing else: it plays `legalActions`.
 */
import {
  LONGEST_ROAD_MIN,
  buildingsOf,
  hasRobber,
  vertexInfo,
  isLandHex,
  longestRoadLengths,
  topologyOf,
  type GameState,
  type PlayerId,
  type VertexId,
} from '../../engine';
import type { BotExtension } from '../../bots/expansions';
import type { Violation } from '../../bots/invariants';
import {
  BARBARIAN_STEPS,
  CK,
  COMMODITIES,
  DECKS,
  KNIGHT_LEVELS,
  KNIGHTS_PER_LEVEL,
  MAX_LEVEL,
  METROPOLIS_LEVEL,
  PROGRESS_HAND_MAX,
  PROGRESS_CARDS,
  TRACKS,
  WALLS_PER_PLAYER,
  ckModule,
  ckVictoryPoints,
  commoditySupply,
  phaseOf,
  type CkSlice,
  type ProgressCard,
} from './engine';

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

function check(state: GameState): Violation[] {
  const out: Violation[] = [];
  const bad = (message: string, player?: PlayerId) =>
    out.push({
      code: 'expansion',
      message: `ck: ${message}`,
      ...(player === undefined ? {} : { player }),
    });
  const s = state.ext[CK] as CkSlice | undefined;
  const n = state.players.length;
  if (!s || s.v !== 1 || !Array.isArray(s.players) || s.players.length !== n) {
    return [{ code: 'expansion', message: 'ck: missing or malformed slice' }];
  }
  const t = topologyOf(state);

  // Commodities: supply + hands = 12 (18) of each.
  const supply = commoditySupply(n);
  for (const c of COMMODITIES) {
    const counts = [s.bank[c], ...s.players.map((p) => p.commodities[c])];
    if (!counts.every(isCount)) bad(`${c}: negative or fractional count`);
    const total = counts.reduce((a, b) => a + b, 0);
    if (total !== supply) bad(`${c}: supply + hands = ${total}, expected ${supply}`);
  }

  // Progress cards: stacks + hands + laid-out VP cards = the 54 cards, per card.
  const count = new Map<ProgressCard, number>();
  const add = (c: ProgressCard) => count.set(c, (count.get(c) ?? 0) + 1);
  for (const tr of TRACKS) for (const c of s.decks[tr]) add(c);
  for (const p of s.players) [...p.progress, ...p.vpCards].forEach(add);
  for (const tr of TRACKS) {
    for (const [c, k] of DECKS[tr]) {
      if ((count.get(c) ?? 0) !== k) bad(`${c}: ${count.get(c) ?? 0} cards, expected ${k}`);
    }
  }
  for (const c of count.keys()) if (!PROGRESS_CARDS.includes(c)) bad(`unknown card ${c}`);
  for (const tr of TRACKS) {
    if (s.decks[tr].some((c) => !DECKS[tr].some(([x]) => x === c)))
      bad(`a foreign card in the ${tr} stack`);
  }

  // Progress hand limit out of turn (a discard phase may be pending).
  const phase = phaseOf(state);
  // (A VP card drawn on the roll can end the game before the others discard.)
  const discarding =
    phase.kind === 'ck/progressDiscard' ||
    phase.kind === 'ck/defender' ||
    phase.kind === 'gameOver';
  s.players.forEach((p, i) => {
    if (i !== state.turn.current && !discarding && p.progress.length > PROGRESS_HAND_MAX) {
      bad(`player ${i} holds ${p.progress.length} progress cards out of turn`, i);
    }
    if (p.vpCards.some((c) => c !== 'printer' && c !== 'constitution'))
      bad('a non-VP card laid out', i);
    for (const tr of TRACKS) {
      const lvl = p.improvements[tr];
      if (!isCount(lvl) || lvl > MAX_LEVEL) bad(`player ${i} ${tr} level ${lvl}`, i);
    }
    if (!isCount(p.defender)) bad(`player ${i} defender count ${p.defender}`, i);
  });

  // Knights: on empty board vertices, at most 2 per level per player.
  const perLevel = new Map<string, number>();
  for (const [v, k] of Object.entries(s.knights) as [VertexId, (typeof s.knights)[VertexId]][]) {
    if (!k) continue;
    // (Seafarers + C&K: an active knight may stand on a sea vertex, on its owner's ship.)
    if (!vertexInfo(t, v)) bad(`knight on off-board vertex ${v}`);
    if (state.pieces.buildings[v]) bad(`knight and building on ${v}`);
    if (!KNIGHT_LEVELS.includes(k.level)) bad(`knight level ${k.level}`);
    const key = `${k.owner}:${k.level}`;
    perLevel.set(key, (perLevel.get(key) ?? 0) + 1);
  }
  for (const [key, c] of perLevel) {
    if (c > KNIGHTS_PER_LEVEL) bad(`${c} knights of player:level ${key}`);
  }

  // Walls under own cities, at most 3 each.
  const walls = new Map<PlayerId, number>();
  for (const [v, owner] of Object.entries(s.walls) as [VertexId, PlayerId][]) {
    const b = state.pieces.buildings[v];
    if (b?.kind !== 'city' || b.owner !== owner) bad(`wall on ${v} without a city of ${owner}`);
    walls.set(owner, (walls.get(owner) ?? 0) + 1);
  }
  for (const [p, c] of walls) if (c > WALLS_PER_PLAYER) bad(`player ${p} has ${c} walls`, p);

  // Metropolises: on distinct cities of their owner, who reached level 4.
  const seen = new Set<VertexId>();
  for (const tr of TRACKS) {
    const m = s.metropolis[tr];
    if (!m) continue;
    const b = state.pieces.buildings[m.vertex];
    if (b?.kind !== 'city' || b.owner !== m.owner)
      bad(`${tr} metropolis on ${m.vertex} without a city`);
    if (seen.has(m.vertex)) bad(`two metropolises on ${m.vertex}`);
    seen.add(m.vertex);
    if ((s.players[m.owner]?.improvements[tr] ?? 0) < METROPOLIS_LEVEL) {
      bad(`${tr} metropolis held below level ${METROPOLIS_LEVEL}`, m.owner);
    }
  }

  // Barbarians and the sleeping robber (CK-30).
  if (!isCount(s.barbarian) || s.barbarian >= BARBARIAN_STEPS)
    bad(`barbarian position ${s.barbarian}`);
  if (!isCount(s.attacks)) bad(`attacks ${s.attacks}`);
  if (
    s.attacks === 0 &&
    hasRobber(state.settings) &&
    state.board.hexes[state.robber]?.terrain !== 'desert'
  ) {
    bad('the robber moved before the first barbarian attack');
  }
  if (s.merchant && !isLandHex(t, s.merchant.hex)) bad(`merchant on ${s.merchant.hex}`);

  // Longest Road, knights included as blockers.
  const lengths = longestRoadLengths(state);
  const max = Math.max(...lengths);
  const leaders = lengths.flatMap((l, p) => (l === max ? [p] : []));
  const holder = state.awards.longestRoad;
  if (max < LONGEST_ROAD_MIN && holder !== null) bad(`Longest Road held with only ${max}`);
  if (max >= LONGEST_ROAD_MIN && leaders.length === 1 && holder !== leaders[0]) {
    bad(`Longest Road is ${String(holder)}, player ${leaders[0]} has the unique longest (${max})`);
  }
  if (holder !== null && lengths[holder] !== max)
    bad(`Longest Road holder ${holder} is not the longest`);
  if (state.awards.largestArmy !== null) bad('Largest Army exists in Cities & Knights');

  // VP: the C&K hook equals the slice's own count (other modules may add their own VP).
  for (let p = 0; p < n; p++) {
    if (ckModule.hooks?.victoryPoints?.(state, p).public !== ckVictoryPoints(state, p))
      bad('C&K VP mismatch', p);
    if (buildingsOf(state, p).length === 0 && state.phase.kind !== 'setup')
      bad('player without buildings', p);
  }
  return out;
}

export const ckBots: BotExtension = {
  id: CK,
  invariants: check,
  // Knights break roads: the base Longest Road cross-check does not know them (checked above).
  relax: ['award-mismatch'],
};
