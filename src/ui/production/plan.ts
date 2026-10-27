/**
 * Production animation (issue #29), the pure half: what the last state change produced, for
 * whom, from which hex, and when each flying card starts. No DOM here.
 *
 * Driven by the public log, so it works the same in hotseat, online (masked views) and every
 * expansion: after a "rolled N" line, the "X received 2 grain, 1 ore", "X caught 2 fish" and
 * "X took 1 ore (gold)" lines are what each player got. Card kinds are plain strings ('grain',
 * 'paper', 'gold', 'fish', 'oil' ...); the DOM half finds art for them.
 */
import {
  hasRobber,
  hexVertices,
  topologyOf,
  type GameState,
  type HexId,
  type LogEntry,
  type PlayerId,
} from '../../engine';

export interface PlanItem {
  /** Card kind as the log names it: a resource, a commodity, 'gold', 'fish', 'oil' ... */
  kind: string;
  count: number;
  /** Hex the cards fly from; null = from the dice (no producing hex found). */
  from: HexId | null;
}

export interface PlayerGain {
  player: PlayerId;
  items: PlanItem[];
}

export interface ProductionPlan {
  /** The roll the gains belong to (null: none found in the log). */
  roll: number | null;
  /** In log order; players who got nothing are absent. */
  gains: PlayerGain[];
  /** The robber's hex when it carries the rolled number next to a building (it paid nothing). */
  blocked: HexId | null;
}

const ROLLED = /\brolled (\d+)/;
/** "received 2 grain, 1 ore", "caught 2 fish", "took 1 ore, 1 wool (gold)" (after the name). */
const GAIN = /^ (received|caught|took) (.+?)(?: \(([^)]*)\))?$/;
const PART = /^(\d+|a|an) ([a-z]+)$/;
/** Cards that do not come from a hex of their own name (C&K commodities, T&B fish). */
const SOURCE_TERRAINS: Readonly<Record<string, readonly string[]>> = {
  paper: ['lumber'],
  cloth: ['wool'],
  coin: ['ore'],
  fish: ['tb/lake'],
};

const sameEntry = (a: LogEntry | undefined, b: LogEntry | undefined) =>
  !!a && !!b && a.turn === b.turn && a.player === b.player && a.text === b.text;

/**
 * The entries `next.log` gained over `prev.log`. The log keeps only its newest entries, so the
 * old tail is looked up in the new log instead of trusting the length. [] when the logs do not
 * belong together (a new game, a resumed one).
 */
export function newLogEntries(prev: readonly LogEntry[], next: readonly LogEntry[]): LogEntry[] {
  if (prev.length === 0) return [...next];
  const last = prev[prev.length - 1];
  for (let j = next.length - 1; j >= 0; j--) {
    if (!sameEntry(next[j], last)) continue;
    // Check a few entries before it too: the same text can repeat ("X rolled 8 (4+4)").
    let k = 1;
    while (k < 4 && j - k >= 0 && prev.length - 1 - k >= 0) {
      if (!sameEntry(next[j - k], prev[prev.length - 1 - k])) break;
      k++;
    }
    if (k === 4 || j - k < 0 || prev.length - 1 - k < 0) return next.slice(j + 1);
  }
  return [];
}

/** Parse the cards of one gain line ("2 grain, 1 ore"); null when it is not a card list. */
export function parseGain(text: string): { kind: string; count: number }[] | null {
  const out: { kind: string; count: number }[] = [];
  for (const part of text.split(/, | and /)) {
    const m = PART.exec(part);
    if (!m?.[1] || !m[2]) return null;
    const count = m[1] === 'a' || m[1] === 'an' ? 1 : Number(m[1]);
    if (count > 0) out.push({ kind: m[2], count });
  }
  return out.length > 0 ? out : null;
}

/** Index of the last "rolled N" entry of `log` (−1: none) and its number. */
function lastRoll(log: readonly LogEntry[]): { index: number; roll: number | null } {
  for (let i = log.length - 1; i >= 0; i--) {
    const m = ROLLED.exec(log[i]?.text ?? '');
    if (m?.[1]) return { index: i, roll: Number(m[1]) };
  }
  return { index: -1, roll: null };
}

/**
 * The production shown for the change `prev` → `next`: the gain lines among the new log entries
 * that belong to the current roll (same turn, after its "rolled" line). null when the change
 * produced nothing to show. `prev` null (first render, resume, joining a room): nothing.
 */
export function productionPlan(prev: GameState | null, next: GameState): ProductionPlan | null {
  if (!prev || prev.settings.seed !== next.settings.seed) return null;
  const fresh = newLogEntries(prev.log, next.log);
  if (fresh.length === 0) return null;
  const { index: rolledAt, roll } = lastRoll(next.log);
  if (rolledAt < 0) return null;
  const rolled = next.log[rolledAt];
  const firstFresh = next.log.length - fresh.length;
  const names = next.players.map((p) => p.name);

  const byPlayer = new Map<PlayerId, Map<string, PlanItem>>();
  for (let i = Math.max(firstFresh, rolledAt + 1); i < next.log.length; i++) {
    const e = next.log[i];
    if (!e || e.player === null || e.turn !== rolled?.turn) continue;
    const name = names[e.player];
    if (name === undefined || !e.text.startsWith(name)) continue;
    const m = GAIN.exec(e.text.slice(name.length));
    if (!m?.[1] || !m[2]) continue;
    // "took" is a gain only as a gold pick; other takes are steals, Monopoly, event cards.
    const why = m[3] ?? '';
    if (m[1] === 'took' && why !== 'gold') continue;
    const cards = parseGain(m[2]);
    if (!cards) continue;
    const items = byPlayer.get(e.player) ?? new Map<string, PlanItem>();
    byPlayer.set(e.player, items);
    for (const c of cards) {
      const have = items.get(c.kind);
      if (have) have.count += c.count;
      else {
        const from = sourceHex(next, roll, e.player, why === 'gold' ? 'gold' : c.kind);
        items.set(c.kind, { kind: c.kind, count: c.count, from });
      }
    }
  }

  // The robber's hex shows its bounce only on the roll itself (not on a later gold pick).
  const blocked = rolledAt >= firstFresh ? blockedHex(next, roll) : null;
  if (byPlayer.size === 0 && blocked === null) return null;
  return {
    roll,
    gains: [...byPlayer].map(([player, items]) => ({ player, items: [...items.values()] })),
    blocked,
  };
}

/** Hexes carrying `roll` next to a building of `player` (any player when null). */
function rollHexes(state: GameState, roll: number | null, player: PlayerId | null): HexId[] {
  if (roll === null) return [];
  const t = topologyOf(state);
  const out: HexId[] = [];
  for (const id of Object.keys(state.board.hexes) as HexId[]) {
    if (state.board.hexes[id]?.token !== roll) continue;
    const owners = hexVertices(t, id).map((v) => state.pieces.buildings[v]?.owner);
    if (owners.some((o) => o !== undefined && (player === null || o === player))) out.push(id);
  }
  return out;
}

const matches = (terrain: string, kind: string) =>
  terrain === kind ||
  terrain.split('/').some((part) => part === kind || part.startsWith(kind)) ||
  (SOURCE_TERRAINS[kind]?.includes(terrain) ?? false);

/**
 * The hex `kind` most likely came from: a hex with the rolled number next to `player`'s
 * building whose terrain matches the kind, else any such hex (not the robber's), else null.
 */
export function sourceHex(
  state: GameState,
  roll: number | null,
  player: PlayerId,
  kind: string,
): HexId | null {
  const robber = hasRobber(state.settings) ? state.robber : null;
  const hexes = rollHexes(state, roll, player).filter((h) => h !== robber);
  const terrain = (h: HexId) => state.board.hexes[h]?.terrain ?? '';
  return hexes.find((h) => matches(terrain(h), kind)) ?? hexes[0] ?? null;
}

/** The robber's hex when it carries the rolled number and touches a building. */
export function blockedHex(state: GameState, roll: number | null): HexId | null {
  if (roll === null || roll === 7 || !hasRobber(state.settings)) return null;
  return rollHexes(state, roll, null).includes(state.robber) ? state.robber : null;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface Flight {
  player: PlayerId;
  kind: string;
  from: HexId | null;
  /** ms after the start. */
  delay: number;
}

export interface Timeline {
  flights: Flight[];
  /** When each receiving player's badge pops (ms after the start), in plan order. */
  badges: { player: PlayerId; at: number }[];
  /** When the last card lands. */
  end: number;
}

/** One card's flight time (ms). */
export const FLIGHT_MS = 560;
/** Cards start at most this far apart; more cards share the same window. */
export const MAX_STAGGER_MS = 80;
/** All cards are in the air by this time, so the whole run stays near a second. */
export const LAUNCH_WINDOW_MS = 520;
/** At most this many cards per item and in total (a 6-card haul flies 3, the badge says 6). */
export const MAX_PER_ITEM = 3;
export const MAX_CARDS = 16;

/**
 * Flight start times: one card per gained card (capped), player after player, evenly staggered
 * inside LAUNCH_WINDOW_MS. `flights: false` (reduced motion, animations off): badges at once.
 */
export function timeline(plan: ProductionPlan, flights = true): Timeline {
  if (!flights)
    return { flights: [], badges: plan.gains.map((g) => ({ player: g.player, at: 0 })), end: 0 };
  const cards: Omit<Flight, 'delay'>[] = [];
  for (const g of plan.gains) {
    for (const it of g.items) {
      for (let i = 0; i < Math.min(it.count, MAX_PER_ITEM); i++) {
        if (cards.length < MAX_CARDS)
          cards.push({ player: g.player, kind: it.kind, from: it.from });
      }
    }
  }
  const step =
    cards.length > 1 ? Math.min(MAX_STAGGER_MS, LAUNCH_WINDOW_MS / (cards.length - 1)) : 0;
  const out = cards.map((c, i) => ({ ...c, delay: Math.round(i * step) }));
  const badges = plan.gains.map((g) => {
    const first = out.find((f) => f.player === g.player);
    return { player: g.player, at: first ? first.delay + FLIGHT_MS : 0 };
  });
  const end = out.length > 0 ? (out[out.length - 1]?.delay ?? 0) + FLIGHT_MS : 0;
  return { flights: out, badges, end };
}

// ---------------------------------------------------------------------------
// Coalescing
// ---------------------------------------------------------------------------

/** A roll arriving sooner than this after the previous one shows badges only (fast bots). */
export const RAPID_MS = 900;

/**
 * How each new plan plays, so fast bot turns never queue up a backlog: the caller always
 * replaces the running plan at once (there is no queue), and `next` says whether the new one
 * may fly: not within RAPID_MS of the previous plan, and never with `motion: false` (reduced
 * motion, animations off). Then it shows its badges only.
 */
export class Coalescer {
  private lastAt = -Infinity;

  next(now: number, motion: boolean): boolean {
    const rapid = now - this.lastAt < RAPID_MS;
    this.lastAt = now;
    return motion && !rapid;
  }
}
