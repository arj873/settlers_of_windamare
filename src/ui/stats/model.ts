/**
 * Game statistics screen (UX2): pure derivations from `GameState.stats` for the panel
 * (`panel.ts`). No DOM. Works on a full state or a game-over view (both carry the stats).
 */
import {
  AWARD_VP,
  buildingsOf,
  DEV_CARD_TYPES,
  DICE_TOTALS,
  expansionVpSources,
  RESOURCES,
  statsOf,
  sumCounts,
  victoryPoints,
  type DevCardType,
  type GainSource,
  type GameState,
  type GameStats,
  type LossSink,
  type PlayerId,
  type PlayerStats,
  type ResourceCounts,
} from '../../engine';

export type StatsTab = 'overview' | 'dice' | 'resources' | 'activity' | 'dev';

export const STATS_TABS: readonly { id: StatsTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'dice', label: 'Dice' },
  { id: 'resources', label: 'Resources' },
  { id: 'activity', label: 'Activity' },
  { id: 'dev', label: 'Dev Cards' },
];

/** Rows of the per-player resource table, in display order ('other' never shows). */
export const GAIN_LABEL: Partial<Record<GainSource, string>> = {
  production: 'Production',
  setup: 'Starting resources',
  trade: 'Player trades',
  bank: 'Bank / harbor trades',
  steal: 'Stolen by them',
  devCard: 'Dev cards',
  event: 'Events',
};
export const LOSS_LABEL: Partial<Record<LossSink, string>> = {
  build: 'Spent on building',
  buyDev: 'Spent on dev cards',
  trade: 'Player trades',
  bank: 'Bank / harbor trades',
  stolen: 'Stolen from them',
  discard: 'Discarded on 7s',
  monopoly: 'Taken by Monopoly',
  event: 'Given away (events)',
};

export const total = (c: ResourceCounts): number => RESOURCES.reduce((n, r) => n + c[r], 0);

/** "< 1 min", "42 min", "1 h 36 min". null → "—". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return '< 1 min';
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}

export interface VpBreakdown {
  player: PlayerId;
  total: number;
  settlements: number;
  /** Cities (each worth 2). */
  cities: number;
  vpCards: number;
  longestRoad: boolean;
  largestArmy: boolean;
  /** Named expansion VP (the modules' vpSources hook), e.g. "New islands". */
  extra: { label: string; vp: number }[];
  /** VP from anything else (expansions / variants); 0 in the base game. */
  other: number;
}

/** Final standings, best first (ties by seat), with where each player's VP came from. */
export function standings(state: GameState): VpBreakdown[] {
  return state.players
    .map((p): VpBreakdown => {
      const settlements = buildingsOf(state, p.id, 'settlement').length;
      const cities = buildingsOf(state, p.id, 'city').length;
      const vpCards = p.devCards.victoryPoint + p.newDevCards.victoryPoint;
      const longestRoad = state.awards.longestRoad === p.id;
      const largestArmy = state.awards.largestArmy === p.id;
      const total = victoryPoints(state, p.id);
      const extra = expansionVpSources(state, p.id).filter((x) => x.vp !== 0);
      const known =
        settlements +
        2 * cities +
        vpCards +
        (longestRoad ? AWARD_VP : 0) +
        (largestArmy ? AWARD_VP : 0) +
        extra.reduce((n, x) => n + x.vp, 0);
      return {
        player: p.id,
        total,
        settlements,
        cities,
        vpCards,
        longestRoad,
        largestArmy,
        extra,
        other: total - known,
      };
    })
    .sort(
      (a, b) =>
        b.total - a.total ||
        Number(b.player === state.winner) - Number(a.player === state.winner) ||
        a.player - b.player,
    );
}

/** Production received minus expected production (cards), per player. */
export function luck(ps: PlayerStats): number {
  return total(ps.gained.production) - ps.expected36 / 36;
}

export interface Award {
  id: string;
  title: string;
  /** Tied winners all get it. */
  players: PlayerId[];
  detail: string;
}

/** The players with the highest `score` (> 0), or [] if nobody scored. */
function leaders(stats: GameStats, score: (s: PlayerStats) => number, min = 0): PlayerId[] {
  const scores = stats.players.map(score);
  const best = Math.max(...scores);
  if (!(best > min)) return [];
  return scores.flatMap((s, p) => (s === best ? [p] : []));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;

/** Headline awards; an award nobody earned (all 0) is left out. */
export function awards(stats: GameStats): Award[] {
  const out: Award[] = [];
  const add = (
    id: string,
    title: string,
    score: (s: PlayerStats) => number,
    detail: (v: number) => string,
    min = 0,
  ) => {
    const players = leaders(stats, score, min);
    const first = players[0];
    if (first === undefined) return;
    const s = stats.players[first];
    if (s) out.push({ id, title, players, detail: detail(score(s)) });
  };
  add(
    'gained',
    'Most resources gained',
    (s) => total(sumCounts(s.gained)),
    (v) => plural(v, 'card'),
  );
  add('luckiest', 'Luckiest', luck, (v) => `${signed(v)} cards vs expected production`, 0);
  add(
    'unluckiest',
    'Unluckiest',
    (s) => -luck(s),
    (v) => `${signed(-v)} cards vs expected`,
    0,
  );
  add(
    'robbed',
    'Most robbed',
    (s) => total(s.lost.stolen) + total(s.lost.monopoly),
    (v) => `lost ${plural(v, 'card')} to steals and Monopoly`,
  );
  add(
    'blocked',
    'Robber’s favourite',
    (s) => total(s.blocked),
    (v) => `${plural(v, 'card')} blocked by the robber`,
  );
  add(
    'thief',
    'Master thief',
    (s) => s.steals,
    (v) => plural(v, 'steal'),
  );
  add(
    'trader',
    'Top trader',
    (s) => s.tradesAsOfferer + s.tradesAsPartner + s.bankTrades + s.portTrades,
    (v) => plural(v, 'trade'),
  );
  add(
    'builder',
    'Master builder',
    (s) => s.built.road + s.built.settlement + s.built.city,
    (v) => `${plural(v, 'piece')} placed`,
  );
  return out;
}

/** Probability of each total 2..12 with two dice. */
export const DICE_P: readonly number[] = DICE_TOTALS.map((t) => (6 - Math.abs(7 - t)) / 36);

export interface DiceBar {
  total: number;
  count: number;
  /** count expected from fair dice over the same number of rolls. */
  expected: number;
}

export function rollsOf(ps: PlayerStats): number {
  return ps.rolls.reduce((a, b) => a + b, 0);
}

/** All players' rolls per total, with the expected counts. */
export function diceHistogram(stats: GameStats): DiceBar[] {
  const counts = DICE_TOTALS.map((_, i) =>
    stats.players.reduce((n, p) => n + (p.rolls[i] ?? 0), 0),
  );
  const n = counts.reduce((a, b) => a + b, 0);
  return DICE_TOTALS.map((t, i) => ({
    total: t,
    count: counts[i] ?? 0,
    expected: n * (DICE_P[i] ?? 0),
  }));
}

export const sevensOf = (ps: PlayerStats): number => ps.rolls[5] ?? 0;

/** VP per player over turns: the recorded end-of-turn snapshots. */
export interface VpSeries {
  turns: number[];
  /** vp[p][i] = player p's VP at turns[i]. */
  vp: number[][];
  max: number;
}

export function vpSeries(stats: GameStats, players: number): VpSeries {
  const turns = stats.vpHistory.map((e) => e.turn);
  const vp = Array.from({ length: players }, (_, p) => stats.vpHistory.map((e) => e.vp[p] ?? 0));
  const max = Math.max(1, ...vp.flat());
  return { turns, vp, max };
}

/** Dev cards bought / played per type and player. */
export function devRows(
  stats: GameStats,
): { type: DevCardType; bought: number[]; played: number[] }[] {
  return DEV_CARD_TYPES.map((type) => ({
    type,
    bought: stats.players.map((p) => p.devBought[type]),
    played: stats.players.map((p) => p.devPlayed[type]),
  }));
}

/** The data the panel needs, or null when the state has no stats to show. */
export function statsFor(state: GameState): GameStats | null {
  return state.stats ? statsOf(state) : null;
}
