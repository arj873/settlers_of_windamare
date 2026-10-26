/**
 * Traders & Barbarians invariants for the simulator. The random bot needs nothing else: it plays
 * `legalActions` (every T&B phase is finite: wagon MP run out, each knight moves once, every
 * player bids once, neutral builds are single steps).
 *
 * Relaxed base checks, re-checked here: 'robber-position' (the robber may be off the board:
 * Fishermen, Caravans, BA, T&B), 'dev-conservation' (Catan for Two turns Knights in for tokens;
 * the T&B deck's Swift Journeys live in the slice), 'award-mismatch' (camels double roads,
 * neutrals hold Longest Road, T&B has none: the hooked lengths are compared instead).
 */
import {
  DEV_CARD_TYPES,
  LONGEST_ROAD_MIN,
  NO_ROBBER,
  RESOURCES,
  isBoardEdge,
  isBoardVertex,
  isLandHex,
  longestRoadLengths,
  supplyOf,
  topologyOf,
  type Action,
  type DevCardType,
  type EdgeId,
  type GameState,
  type HexId,
  type PlayerId,
  type Rng,
  type VertexId,
} from '../../engine';
import type { BotExtension } from '../../bots/expansions';
import type { Violation } from '../../bots/invariants';
import {
  BA_BARBARIANS_34,
  BA_BARBARIANS_56,
  BRIDGES_PER_PLAYER,
  CAMELS_34,
  CAMELS_56,
  FISH_CAP,
  FISH_TOKENS_34,
  FISH_TOKENS_56,
  KNIGHTS_PER_PLAYER,
  MAX_LEVEL,
  NEUTRAL_ROADS,
  NEUTRAL_SETTLEMENTS,
  SWIFT_JOURNEYS,
  TB,
  TOKENS_START,
  TOKENS_SUPPLY,
  DELIVER_TO,
  has,
  plazaHex,
  stepCost,
  tradersOf,
  robberless,
  tbBoard,
  type TbSlice,
} from './engine';

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

function check(state: GameState): Violation[] {
  const out: Violation[] = [];
  const bad = (message: string, player?: PlayerId) =>
    out.push({
      code: 'expansion',
      message: `tb: ${message}`,
      ...(player === undefined ? {} : { player }),
    });
  const s = state.ext[TB] as TbSlice | undefined;
  const n = state.players.length;
  if (!s || s.v !== 1 || !Array.isArray(s.gold) || s.gold.length !== n) {
    return [{ code: 'expansion', message: 'tb: missing or malformed slice' }];
  }
  const t = topologyOf(state);

  // Robber: on a land hex, or off the board (never in BA / T&B).
  if (robberless(state)) {
    if (state.robber !== NO_ROBBER) bad(`robber on the board (${state.robber}) without a robber`);
  } else if (state.robber !== NO_ROBBER && !isLandHex(t, state.robber)) {
    out.push({ code: 'robber-position', message: `robber on non-land hex ${state.robber}` });
  }

  if (!s.gold.every(isCount)) bad(`negative gold ${String(s.gold)}`);
  if (s.goldBuys > 2) bad(`${s.goldBuys} gold purchases this turn`);

  // Development cards: deck + hands + played (+ knights turned in) = the supply.
  const supply = supplyOf(state);
  const played = (p: (typeof state.players)[number], c: DevCardType) =>
    c === 'knight' ? p.knightsPlayed : c === 'victoryPoint' ? 0 : p.progressCardsPlayed[c];
  for (const c of DEV_CARD_TYPES) {
    const deck = state.devDeck.filter((x) => x === c).length;
    const held = sum(state.players.map((p) => p.devCards[c] + p.newDevCards[c] + played(p, c)));
    const gone = c === 'knight' ? (s.two?.knightsDiscarded ?? 0) : 0;
    if (deck + held + gone !== supply.devDeck[c]) {
      out.push({
        code: 'dev-conservation',
        message: `${c}: ${deck}+${held}+${gone} ≠ ${supply.devDeck[c]}`,
      });
    }
  }

  // Longest Road with the hooked lengths (camels, neutrals; none in T&B).
  const lengths = longestRoadLengths(state);
  const max = Math.max(...lengths);
  const holder = state.awards.longestRoad;
  if (holder !== null && ((lengths[holder] ?? 0) < LONGEST_ROAD_MIN || lengths[holder] !== max)) {
    bad(`Longest Road held by ${holder} with ${lengths[holder]} (longest ${max})`);
  }
  if (has(state, 'traders') && holder !== null) bad('Longest Road in Traders & Barbarians');

  if (has(state, 'fish')) {
    const f = s.fish;
    if (!f) return [...out, { code: 'expansion', message: 'tb: no fish slice' }];
    const all = n > 4 ? [...FISH_TOKENS_34, ...FISH_TOKENS_56] : FISH_TOKENS_34;
    const tokens = [...f.pool, ...f.spent, ...f.hands.flat()].filter((x) => x !== 0);
    const boots = f.pool.filter((x) => x === 0).length + (f.boot === null ? 0 : 1);
    if (tokens.length !== all.length || sum(tokens) !== sum(all)) bad('fish tokens not conserved');
    if (boots !== 1) bad(`${boots} old boots`);
    f.hands.forEach((h, p) => {
      if (h.length > FISH_CAP) bad(`${h.length} fish tokens held`, p);
    });
  }

  if (has(state, 'rivers')) {
    const bridges = Object.entries(s.rivers?.bridges ?? {});
    const sites = new Set(tbBoard(state).bridgeSites ?? []);
    for (const [e, o] of bridges) {
      if (!sites.has(e as never)) bad(`bridge off a bridge site (${e})`);
      if (state.pieces.roads[e as never] !== o) bad(`bridge ${e} is not ${o}'s road piece`);
    }
    for (let p = 0; p < n; p++) {
      if (bridges.filter(([, o]) => o === p).length > BRIDGES_PER_PLAYER)
        bad('too many bridges', p);
    }
    for (const e of sites) {
      const o = state.pieces.roads[e];
      if (o !== undefined && s.rivers?.bridges[e] !== o) bad(`a plain road on bridge site ${e}`);
    }
  }

  if (has(state, 'caravans')) {
    const c = s.caravans;
    if (!c) return [...out, { code: 'expansion', message: 'tb: no caravans slice' }];
    const total = n > 4 ? CAMELS_56 : CAMELS_34;
    if (c.camels.length + c.left !== total)
      bad(`${c.camels.length} camels + ${c.left} left ≠ ${total}`);
    const edges = c.camels.map((x) => x.edge);
    if (new Set(edges).size !== edges.length) bad('two camels on one edge');
    if (!edges.every((e) => isBoardEdge(t, e))) bad('a camel off the board');
    if (state.board.hexes[state.robber]?.terrain === 'tb/oasis') bad('the robber is on the oasis');
  }

  if (has(state, 'ba')) {
    const b = s.ba;
    if (!b) return [...out, { code: 'expansion', message: 'tb: no ba slice' }];
    const onBoard = sum(Object.values(b.onHex));
    const total = n > 4 ? BA_BARBARIANS_56 : BA_BARBARIANS_34;
    if (onBoard + b.supply + sum(b.prisoners) !== total) {
      bad(`barbarians ${onBoard}+${b.supply}+${sum(b.prisoners)} ≠ ${total}`);
    }
    if (Object.values(b.onHex).some((k) => k < 1 || k > 3))
      bad('a hex with more than 3 barbarians');
    const coast = new Set(tbBoard(state).coast ?? []);
    if (Object.keys(b.onHex).some((h) => !coast.has(h as never))) bad('barbarians off the coast');
    for (let p = 0; p < n; p++) {
      if (Object.values(b.knights).filter((o) => o === p).length > KNIGHTS_PER_PLAYER)
        bad('too many knights', p);
    }
    if (!Object.keys(b.knights).every((e) => isBoardEdge(t, e))) bad('a knight off the board');
    if (state.awards.largestArmy !== null) bad('Largest Army in Barbarian Attack');
    if (state.devDeck.length > 0) bad('base development cards in Barbarian Attack');
  }

  if (has(state, 'traders')) {
    const tr = s.traders;
    if (!tr) return [...out, { code: 'expansion', message: 'tb: no traders slice' }];
    if (new Set(tr.barbarians).size !== 3 || !tr.barbarians.every((e) => isBoardEdge(t, e))) {
      bad(`barbarians on ${tr.barbarians.join(' ')}`);
    }
    tr.level.forEach((l, p) => {
      if (!Number.isInteger(l) || l < 1 || l > MAX_LEVEL) bad(`baggage train level ${l}`, p);
    });
    if (state.phase.kind !== 'setup') {
      tr.wagons.forEach((w, p) => {
        if (w === null || !isBoardVertex(t, w)) bad(`wagon at ${String(w)}`, p);
      });
    }
    const swift = tr.swift.deck + sum(tr.swift.held) + sum(tr.swift.fresh);
    if (swift > SWIFT_JOURNEYS || !isCount(tr.swift.deck)) bad(`swift journeys ${swift}`);
    if (!tr.delivered.every(isCount)) bad('negative deliveries');
    if (tr.move.mp < 0) bad(`negative movement points ${tr.move.mp}`);
  }

  if (s.two) {
    const two = s.two;
    if (n !== 2) bad('neutral players in a game for more than two');
    const tokens = sum(two.tokens) + two.supply;
    if (
      tokens !== 2 * TOKENS_START + TOKENS_SUPPLY ||
      !two.tokens.every(isCount) ||
      two.supply < 0
    ) {
      bad(`trade tokens ${two.tokens.join(',')} + ${two.supply}`);
    }
    two.neutrals.forEach((nt, i) => {
      if (nt.roads.length > NEUTRAL_ROADS || nt.settlements.length > NEUTRAL_SETTLEMENTS) {
        bad(`neutral ${i} over its piece limits`);
      }
      for (const e of nt.roads)
        if (state.pieces.roads[e] !== undefined) bad(`neutral road under a road ${e}`);
      for (const v of nt.settlements) {
        if (state.pieces.buildings[v] !== undefined)
          bad(`neutral settlement under a building ${v}`);
      }
    });
  }

  for (const r of RESOURCES) if (state.bank[r] < 0) bad(`negative bank ${r}`);
  checkStats(state, s, out);
  return out;
}

/**
 * The base stats check with Catan for Two's turned-in Knights counted as played, and stricter:
 * T&B hand changes never land in "other".
 */
function checkStats(state: GameState, s: TbSlice, out: Violation[]): void {
  const stats = state.stats;
  if (!stats?.complete || stats.players.length !== state.players.length) return;
  const add = (message: string, player: PlayerId) => out.push({ code: 'stats', message, player });
  state.players.forEach((p, i) => {
    const st = stats.players[i];
    if (!st) return;
    for (const r of RESOURCES) {
      const gained = sum(Object.values(st.gained).map((c) => c[r]));
      const lost = sum(Object.values(st.lost).map((c) => c[r]));
      if (gained - lost !== p.resources[r])
        add(`${r}: gained ${gained} − lost ${lost} ≠ hand ${p.resources[r]}`, i);
      if (st.gained.other[r] !== 0 || st.lost.other[r] !== 0)
        add(`${r}: unclassified hand change`, i);
    }
    // Knights turned in (Catan for Two) were played: they left knightsPlayed for the discard pile.
    const turnedIn = s.two && i < 2 ? turnedInBy(state, i) : 0;
    for (const t of DEV_CARD_TYPES) {
      const played =
        t === 'knight'
          ? p.knightsPlayed + turnedIn
          : t === 'victoryPoint'
            ? 0
            : p.progressCardsPlayed[t];
      if (st.devPlayed[t] !== played) add(`${t}: devPlayed ${st.devPlayed[t]} ≠ ${played}`, i);
      const held = p.devCards[t] + p.newDevCards[t] + played;
      if (st.devBought[t] !== held) add(`${t}: bought ${st.devBought[t]} ≠ ${held}`, i);
    }
  });
}

/** Knights `p` turned in for tokens. */
function turnedInBy(state: GameState, p: PlayerId): number {
  const two = (state.ext[TB] as TbSlice).two;
  if (!two) return 0;
  return two.knightsTurnedIn[p] ?? 0;
}

// ---------------------------------------------------------------------------
// Steering the random bot (BotExtension.steer): wagons drive to the plaza that wants their
// commodity; Barbarian Attack buys cards and sends knights to the barbarians.
// ---------------------------------------------------------------------------

const BUILDS = new Set([
  'buildRoad',
  'buildSettlement',
  'buildCity',
  'buyDevCard',
  'tb/upgradeWagon',
  'tb/buyCard',
]);

/** First step of a cheapest (MP) path from the wagon to any target plaza, or null. */
function wagonPath(state: GameState, p: PlayerId): { first: VertexId; cost: number } | null {
  const tr = tradersOf(state);
  const from = tr.wagons[p];
  if (!from) return null;
  const t = topologyOf(state);
  const held = tr.commodity[p] ?? null;
  const targets = new Set(
    (tbBoard(state).tradeHexes ?? [])
      .filter((h) => held === null || DELIVER_TO[held] === h.kind)
      .map((h) => `v:${h.hex.slice(2)},C` as VertexId),
  );
  targets.delete(from);
  const dist = new Map<VertexId, number>([[from, 0]]);
  const firstOf = new Map<VertexId, VertexId>();
  const queue: VertexId[] = [from];
  while (queue.length > 0) {
    queue.sort((a, b) => (dist.get(a) ?? 0) - (dist.get(b) ?? 0));
    const v = queue.shift() as VertexId;
    if (targets.has(v)) return { first: firstOf.get(v) as VertexId, cost: dist.get(v) ?? 0 };
    // Plazas end a move: do not route through them.
    if (v !== from && plazaHex(v) !== null) continue;
    for (const e of t.vertex[v]?.edges ?? []) {
      const w = (t.edge[e]?.vertices ?? []).find((x) => x !== v) as VertexId;
      const d = (dist.get(v) ?? 0) + stepCost(state, p, e).mp;
      if (d < (dist.get(w) ?? Infinity)) {
        dist.set(w, d);
        firstOf.set(w, v === from ? w : (firstOf.get(v) as VertexId));
        queue.push(w);
      }
    }
  }
  return null;
}

function steerWagon(state: GameState, p: PlayerId, options: readonly Action[]): Action | null {
  const k = state.phase.kind;
  const find = (type: string, f: (a: Action) => boolean = () => true) =>
    options.find((a) => a.type === type && f(a)) ?? null;
  if (k === 'main') {
    if (options.some((a) => BUILDS.has(a.type))) return null;
    const path = wagonPath(state, p);
    return path
      ? find('tb/startWagon', (a) => (a as { vertex?: string }).vertex === path.first)
      : null;
  }
  if (k === 'tb/wagon') {
    const path = wagonPath(state, p);
    if (path && path.cost > tradersOf(state).move.mp) {
      const grain = find('tb/wagonGrain');
      if (grain) return grain;
    }
    const step = path
      ? find('tb/wagonStep', (a) => (a as { vertex?: string }).vertex === path.first)
      : null;
    return step ?? find('tb/swiftJourney') ?? find('endTurn');
  }
  return null;
}

/** Edges of coastal hexes where knights do not yet outnumber the barbarians, most needed first. */
function knightNeeds(state: GameState): EdgeId[] {
  const s = (state.ext[TB] as TbSlice).ba;
  if (!s) return [];
  const t = topologyOf(state);
  const hexes = Object.entries(s.onHex)
    .map(([h, n]) => ({
      h: h as HexId,
      need:
        n + 1 - (t.hex[h as HexId]?.edges ?? []).filter((e) => s.knights[e] !== undefined).length,
    }))
    .filter((x) => x.need > 0)
    .sort((a, b) => b.need - a.need);
  return hexes.flatMap((x) => t.hex[x.h]?.edges ?? []);
}

function steerBa(
  state: GameState,
  _p: PlayerId,
  options: readonly Action[],
  rng: Rng,
): Action | null {
  const k = state.phase.kind;
  const edgeOf = (a: Action) => (a as { edge?: EdgeId }).edge;
  const needs = knightNeeds(state);
  const best = (type: string) => {
    for (const e of needs) {
      const a = options.find((x) => x.type === type && edgeOf(x) === e);
      if (a) return a;
    }
    return null;
  };
  if (k === 'main' || k === 'specialBuild') {
    const buy = options.find((a) => a.type === 'tb/buyCard');
    if (buy && rng.float() < 0.7) return buy;
    if (options.some((a) => BUILDS.has(a.type))) return null;
    const s = (state.ext[TB] as TbSlice).ba;
    const idle = options.filter(
      (a) => a.type === 'tb/startKnights' && !needs.includes(edgeOf(a) as EdgeId),
    );
    if (s && needs.length > 0 && idle.length > 0) return rng.pick(idle);
    return null;
  }
  if (k === 'tb/placeKnight') return best('tb/placeKnight');
  if (k === 'tb/knights')
    return best('tb/moveKnight') ?? options.find((a) => a.type === 'endTurn') ?? null;
  return null;
}

function steer(state: GameState, p: PlayerId, options: readonly Action[], rng: Rng): Action | null {
  if (has(state, 'traders')) return steerWagon(state, p, options);
  if (has(state, 'ba')) return steerBa(state, p, options, rng);
  return null;
}

export const tbBots: BotExtension = {
  id: TB,
  invariants: check,
  steer,
  relax: ['robber-position', 'dev-conservation', 'award-mismatch', 'stats'],
};
