/**
 * Game statistics (UX2): `GameState.stats`, kept up to date by applyAction. Pure, deterministic.
 *
 * Stats are an IMMUTABLE value: every change builds a new GameStats that shares what did not
 * change, so `cloneState` shares `stats` between states like `board` (never mutate one).
 *
 * Two hooks run inside handlers, where the information exists:
 *   - recordRoll (turn.ts rollFor): who rolled what, the event card drawn, expected production;
 *   - recordProduction (rules/production.ts produce): what production paid and what the robber
 *     blocked.
 * Everything else is derived by `recordAction` after a successful handler, from the action and
 * a diff of the state before and after:
 *   - every change of a player's hand that production did not explain is classified by the
 *     action type (bank trade, player trade, steal, discard, build, ...). So, by construction,
 *     Σ gained − Σ lost = hand for every player (the sim checks it after every step);
 *   - counters (pieces built, dev cards bought / played, offers, trades, robber moves, steals);
 *   - award holder changes, and everyone's VP each time a turn ends (and at game over).
 *
 * Older saves have no stats: `statsOf` returns empty ones (complete: false, fromTurn = now), and
 * the first action stores them. No schema bump (optional field, like the V1 variant fields).
 */
import { DEV_CARD_TYPES, RESOURCES, tokenPips } from './constants';
import { namespaceOf } from './expansions/ext';
import { hookStatsCategory } from './expansions/hooks';
import { emptyDevCards, emptyResources, isResource } from './resources';
import { victoryPoints } from './selectors';
import { hexVertices, topologyOf } from './topology';
import type {
  Action,
  DevCardType,
  GainSource,
  GameState,
  GameStats,
  HexId,
  LossSink,
  PlayerId,
  PlayerStats,
  Resource,
  ResourceCounts,
} from './types';
import { hasRobber } from './variants';

export const GAIN_SOURCES: readonly GainSource[] = [
  'production',
  'setup',
  'trade',
  'bank',
  'steal',
  'devCard',
  'event',
  'other',
];
export const LOSS_SINKS: readonly LossSink[] = [
  'build',
  'buyDev',
  'trade',
  'bank',
  'stolen',
  'discard',
  'monopoly',
  'event',
  'other',
];
/** Dice totals 2..12 (index = total − 2 in `PlayerStats.rolls`). */
export const DICE_TOTALS: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const byKey = <K extends string, V>(keys: readonly K[], make: () => V) =>
  Object.fromEntries(keys.map((k) => [k, make()])) as Record<K, V>;

export function emptyPlayerStats(): PlayerStats {
  return {
    gained: byKey(GAIN_SOURCES, emptyResources),
    lost: byKey(LOSS_SINKS, emptyResources),
    blocked: emptyResources(),
    expected36: 0,
    rolls: DICE_TOTALS.map(() => 0),
    built: { road: 0, settlement: 0, city: 0 },
    freeRoads: 0,
    devBought: emptyDevCards(),
    devPlayed: emptyDevCards(),
    offersMade: 0,
    tradesAsOfferer: 0,
    tradesAsPartner: 0,
    bankTrades: 0,
    portTrades: 0,
    robberMoves: 0,
    steals: 0,
    robbed: 0,
    discards: 0,
  };
}

/** Fresh stats for `players` players (createGame: complete, from turn 0). */
export function emptyStats(players: number, complete = true, fromTurn = 0): GameStats {
  return {
    complete,
    fromTurn,
    players: Array.from({ length: players }, emptyPlayerStats),
    events: {},
    vpHistory: [],
    awardHistory: [],
  };
}

/** The stats of `state`; empty incomplete ones for a state from before stats existed. */
export function statsOf(state: GameState): GameStats {
  return state.stats ?? emptyStats(state.players.length, false, state.turn.number);
}

/** Total of a ResourceCounts-valued record (e.g. every source of `gained`). */
export function sumCounts(counts: Record<string, ResourceCounts>): ResourceCounts {
  const out = emptyResources();
  for (const c of Object.values(counts)) for (const r of RESOURCES) out[r] += c[r];
  return out;
}

const copyCounts = (c: ResourceCounts): ResourceCounts => ({ ...c });

function copyPlayerStats(p: PlayerStats): PlayerStats {
  return {
    ...p,
    gained: byKeyFrom(p.gained),
    lost: byKeyFrom(p.lost),
    blocked: copyCounts(p.blocked),
    rolls: [...p.rolls],
    built: { ...p.built },
    devBought: { ...p.devBought },
    devPlayed: { ...p.devPlayed },
  };
}

function byKeyFrom<K extends string>(rec: Record<K, ResourceCounts>): Record<K, ResourceCounts> {
  const out = {} as Record<K, ResourceCounts>;
  for (const k of Object.keys(rec) as K[]) out[k] = copyCounts(rec[k]);
  return out;
}

/**
 * Copy-on-write editor: `player(p)` copies that player's stats on first use; `done()` returns
 * the new GameStats (or the base itself if nothing was touched).
 */
class StatsEditor {
  private readonly copies = new Map<PlayerId, PlayerStats>();
  private top: GameStats | null = null;

  constructor(private readonly base: GameStats) {}

  player(p: PlayerId): PlayerStats {
    let s = this.copies.get(p);
    if (!s) {
      s = copyPlayerStats(this.base.players[p] ?? emptyPlayerStats());
      this.copies.set(p, s);
    }
    return s;
  }

  /** Top-level fields (events, histories) to replace. */
  edit(): GameStats {
    this.top ??= { ...this.base };
    return this.top;
  }

  done(): GameStats {
    if (!this.top && this.copies.size === 0) return this.base;
    const out = this.top ?? { ...this.base };
    if (this.copies.size > 0) {
      out.players = this.base.players.map((s, p) => this.copies.get(p) ?? s);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Hooks called by handlers on their draft
// ---------------------------------------------------------------------------

/** What a hex pays a building of `kind` on it. */
const yieldOf = (kind: 'settlement' | 'city', cityYield: number) =>
  kind === 'city' ? cityYield : 1;

/**
 * rollFor (turn.ts) after the dice / event card of `player`'s roll are set: count the total
 * (and the event), and add every player's expected production for one roll.
 */
export function recordRoll(draft: GameState, player: PlayerId): void {
  if (!draft.dice) return;
  const total = draft.dice[0] + draft.dice[1];
  const ed = new StatsEditor(statsOf(draft));
  const ps = ed.player(player);
  const i = total - 2;
  if (i >= 0 && i < ps.rolls.length) ps.rolls[i] = (ps.rolls[i] ?? 0) + 1;
  if (draft.settings.eventCards && draft.lastEvent) {
    const top = ed.edit();
    top.events = { ...top.events, [draft.lastEvent]: (top.events[draft.lastEvent] ?? 0) + 1 };
  }
  const t = topologyOf(draft);
  const blocked = hasRobber(draft.settings) ? draft.robber : null;
  const expected: number[] = draft.players.map(() => 0);
  for (const id of Object.keys(draft.board.hexes) as HexId[]) {
    const hex = draft.board.hexes[id];
    // Only resource terrains produce in the core (expansion terrains: their production hooks).
    if (!hex || hex.token === null || !isResource(hex.terrain) || id === blocked) continue;
    const pips = tokenPips(hex.token);
    for (const v of hexVertices(t, id)) {
      const b = draft.pieces.buildings[v];
      if (b) expected[b.owner] = (expected[b.owner] ?? 0) + pips * yieldOf(b.kind, 2);
    }
  }
  expected.forEach((e, p) => {
    if (e > 0) ed.player(p).expected36 += e;
  });
  draft.stats = ed.done();
}

/**
 * produce (rules/production.ts) after paying `paid` for `roll`: count it as production, and
 * count what the robber's hex would have paid (bank shortage ignored).
 */
export function recordProduction(
  draft: GameState,
  roll: number,
  paid: ResourceCounts[],
  cityYield: number,
): void {
  const ed = new StatsEditor(statsOf(draft));
  paid.forEach((gain, p) => {
    if (!RESOURCES.some((r) => gain[r] > 0)) return;
    const prod = ed.player(p).gained.production;
    for (const r of RESOURCES) prod[r] += gain[r];
  });
  const robberHex = hasRobber(draft.settings) ? draft.board.hexes[draft.robber] : undefined;
  if (robberHex && robberHex.token === roll && isResource(robberHex.terrain)) {
    const terrain = robberHex.terrain;
    for (const v of hexVertices(topologyOf(draft), robberHex.id)) {
      const b = draft.pieces.buildings[v];
      if (b) ed.player(b.owner).blocked[terrain] += yieldOf(b.kind, cityYield);
    }
  }
  draft.stats = ed.done();
}

// ---------------------------------------------------------------------------
// After a successful action (engine.ts)
// ---------------------------------------------------------------------------

/** Where a positive hand change of `p` caused by `action` came from. */
function gainSource(state: GameState, action: Action, p: PlayerId): GainSource {
  // An expansion may classify any action's hand changes (statsCategory hook).
  const ext = hookStatsCategory(state, action, p)?.gain;
  if (ext !== undefined) return ext;
  if (namespaceOf(action.type) !== null) return 'other';
  switch (action.type) {
    case 'placeSetupSettlement':
      return 'setup';
    case 'bankTrade':
      return 'bank';
    case 'confirmTrade':
      return 'trade';
    case 'steal':
    case 'eventSteal':
      return 'steal';
    case 'playYearOfPlenty':
    case 'playMonopoly':
      return p === action.player ? 'devCard' : 'other';
    case 'eventGain':
    case 'eventGive':
      return 'event';
    default:
      return 'other';
  }
}

/** Where a negative hand change of `p` caused by `action` went. */
function lossSink(state: GameState, action: Action, p: PlayerId): LossSink {
  const ext = hookStatsCategory(state, action, p)?.loss;
  if (ext !== undefined) return ext;
  if (namespaceOf(action.type) !== null) return 'other';
  switch (action.type) {
    case 'buildRoad':
    case 'buildSettlement':
    case 'buildCity':
    case 'repairRoad':
      return 'build';
    case 'buyDevCard':
      return 'buyDev';
    case 'bankTrade':
      return 'bank';
    case 'confirmTrade':
      return 'trade';
    case 'steal':
    case 'eventSteal':
      return 'stolen';
    case 'discard':
      return 'discard';
    case 'playMonopoly':
      return p === action.player ? 'other' : 'monopoly';
    case 'eventGive':
      return 'event';
    default:
      return 'other';
  }
}

const unplayed = (s: GameState, p: PlayerId, t: DevCardType) =>
  (s.players[p]?.devCards[t] ?? 0) + (s.players[p]?.newDevCards[t] ?? 0);

const PLAYED_CARD: Partial<Record<Action['type'], DevCardType>> = {
  playKnight: 'knight',
  playRoadBuilding: 'roadBuilding',
  playYearOfPlenty: 'yearOfPlenty',
  playMonopoly: 'monopoly',
};

/**
 * An expansion action (type '<id>/...'): count its base parts from the state diff, whoever they
 * belong to: pieces placed (a new road, settlement or city on the board), development cards
 * bought (more held + played) and played (knightsPlayed / progressCardsPlayed). Its hand changes
 * are classified 'other' (recordAction); expansion-only things (oil, crops ...) are not counted.
 */
function recordExpansionAction(prev: GameState, next: GameState, ed: StatsEditor): void {
  for (const [e, owner] of Object.entries(next.pieces.roads)) {
    if (prev.pieces.roads[e as keyof typeof prev.pieces.roads] !== owner) {
      ed.player(owner).built.road += 1;
    }
  }
  for (const [v, b] of Object.entries(next.pieces.buildings)) {
    const old = prev.pieces.buildings[v as keyof typeof prev.pieces.buildings];
    if (old?.owner === b.owner && old.kind === b.kind) continue;
    ed.player(b.owner).built[b.kind] += 1;
  }
  next.players.forEach((pl, p) => {
    const old = prev.players[p];
    if (!old) return;
    for (const t of DEV_CARD_TYPES) {
      const played = (s: typeof pl) =>
        t === 'knight' ? s.knightsPlayed : t === 'victoryPoint' ? 0 : s.progressCardsPlayed[t];
      const dPlayed = played(pl) - played(old);
      if (dPlayed > 0) ed.player(p).devPlayed[t] += dPlayed;
      const dHeld = unplayed(next, p, t) + played(pl) - unplayed(prev, p, t) - played(old);
      if (dHeld > 0) ed.player(p).devBought[t] += dHeld;
    }
  });
}

/**
 * Update `next.stats` for `action`, which took `prev` to `next` (next is applyAction's draft,
 * after awards and the victory check). The hooks above may already have replaced next.stats.
 */
export function recordAction(prev: GameState, next: GameState, action: Action): void {
  const before = statsOf(prev);
  const ed = new StatsEditor(next.stats ?? before);
  const prod = (s: GameStats, p: PlayerId, r: Resource) => s.players[p]?.gained.production[r] ?? 0;
  const during = next.stats ?? before;

  // Hand changes production does not explain.
  next.players.forEach((pl, p) => {
    const old = prev.players[p];
    if (!old) return;
    for (const r of RESOURCES) {
      const d = pl.resources[r] - old.resources[r] - (prod(during, p, r) - prod(before, p, r));
      if (d > 0) ed.player(p).gained[gainSource(prev, action, p)][r] += d;
      else if (d < 0) ed.player(p).lost[lossSink(prev, action, p)][r] -= d;
    }
  });

  const me = () => ed.player(action.player);
  switch (action.type) {
    case 'placeSetupSettlement': {
      const kind = next.pieces.buildings[action.vertex]?.kind ?? 'settlement';
      me().built[kind] += 1;
      break;
    }
    case 'placeSetupRoad':
    case 'buildRoad':
      me().built.road += 1;
      break;
    case 'placeFreeRoad':
      me().built.road += 1;
      me().freeRoads += 1;
      break;
    case 'buildSettlement':
      me().built.settlement += 1;
      break;
    case 'buildCity':
      me().built.city += 1;
      break;
    case 'buyDevCard': {
      const card = DEV_CARD_TYPES.find(
        (t) => unplayed(next, action.player, t) > unplayed(prev, action.player, t),
      );
      if (card) me().devBought[card] += 1;
      break;
    }
    case 'offerTrade':
      me().offersMade += 1;
      break;
    case 'confirmTrade':
      me().tradesAsOfferer += 1;
      ed.player(action.partner).tradesAsPartner += 1;
      break;
    case 'bankTrade': {
      const given =
        (prev.players[action.player]?.resources[action.give] ?? 0) -
        (next.players[action.player]?.resources[action.give] ?? 0);
      if (given >= 4) me().bankTrades += 1;
      else me().portTrades += 1;
      break;
    }
    case 'moveRobber':
      me().robberMoves += 1;
      break;
    case 'steal':
      me().steals += 1;
      ed.player(action.victim).robbed += 1;
      break;
    case 'eventSteal':
      if (action.victim !== null) {
        me().steals += 1;
        ed.player(action.victim).robbed += 1;
      }
      break;
    case 'discard':
      me().discards += 1;
      break;
    default: {
      const card = PLAYED_CARD[action.type];
      if (card) me().devPlayed[card] += 1;
      else if (namespaceOf(action.type) !== null) recordExpansionAction(prev, next, ed);
    }
  }

  const turn = next.turn.number;
  for (const award of ['longestRoad', 'largestArmy'] as const) {
    if (next.awards[award] === prev.awards[award]) continue;
    const top = ed.edit();
    top.awardHistory = [...top.awardHistory, { turn, award, player: next.awards[award] }];
  }

  // VP at the end of each turn (turn.number moved on) and at game over.
  // (A win right after an endTurn records both: the turn that ended and the final score.)
  const ends: number[] = [];
  if (next.turn.number > prev.turn.number) ends.push(prev.turn.number);
  if (next.phase.kind === 'gameOver' && !ends.includes(turn)) ends.push(turn);
  if (ends.length > 0) {
    const top = ed.edit();
    const vp = next.players.map((p) => victoryPoints(next, p.id));
    top.vpHistory = [...top.vpHistory, ...ends.map((t) => ({ turn: t, vp }))];
  }
  next.stats = ed.done();
}
