/**
 * Game notices: short messages about what just happened that the player might have missed,
 * derived from two consecutive states (hotseat) or views (online). Pure, no DOM.
 *
 *  - `steal` (#32): a private log text naming the viewer ("You stole 1 wool from Blue",
 *    "Red stole 1 wool from you"). Views carry only the viewer's own (`viewFor`).
 *  - `award` (#36): Longest Road / Largest Army changed hands (the expansions' names too:
 *    Longest Trade Route), and expansion titles their logs announce (C&K metropolis, Defender of
 *    Catan, T&B Harbormaster).
 *
 * Controllers show them (toast / banner) and pass each one to `onGameNotice` listeners, the
 * generic hook for anything else that reacts (sounds).
 */
import { longestRoadName, type GameState, type LogEntry, type PlayerId } from '../engine';
import { parseLogText, secretText, tokensText, youTokens } from '../ui/log';
import { appendedLog } from './logic';

export type AwardId = 'longestRoad' | 'largestArmy' | 'other';

export type GameNotice =
  | { kind: 'steal'; text: string }
  | {
      kind: 'award';
      award: AwardId;
      /** "Longest Road", "Longest Trade Route", "science metropolis"... */
      label: string;
      /** Who gained it (null: nobody holds it any more). */
      to: PlayerId | null;
      /** Who had it before, when known. */
      from: PlayerId | null;
      /** Ready to show, the viewer as "You" / "you". */
      text: string;
    };

/** Shows a notice; `state` is the state (view) it describes, `viewer` the reader (null: none). */
export type NoticeSink = (n: GameNotice, state: GameState, viewer: PlayerId | null) => void;

type Listener = (n: GameNotice) => void;
const listeners = new Set<Listener>();

/** Subscribe to every notice either controller shows (e.g. play a sound). Returns an unsubscribe. */
export function onGameNotice(fn: Listener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function emitGameNotice(n: GameNotice): void {
  for (const fn of listeners) fn(n);
}

/** Expansion titles announced in the log: [pattern, award label from the match]. */
const LOG_TITLES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/ took the (\w+) metropolis from /, (m) => `${m[1]} metropolis`],
  [/ built the (\w+) metropolis$/, (m) => `${m[1]} metropolis`],
  [/ is the Defender of Catan\b/, () => 'Defender of Catan'],
  [/ became Harbormaster$/, () => 'Harbormaster'],
];

/** `text` with the viewer's name as "You" (first word) / "you". */
function personal(text: string, state: GameState, viewer: PlayerId | null): string {
  const tokens = parseLogText(text, state.players);
  return tokensText(
    viewer === null || viewer < 0 ? tokens : youTokens(tokens, viewer),
    state.players,
  );
}

function awardNotices(prev: GameState, next: GameState, viewer: PlayerId | null): GameNotice[] {
  const out: GameNotice[] = [];
  const name = (p: PlayerId) => next.players[p]?.name ?? `Player ${p}`;
  const awards: [Exclude<AwardId, 'other'>, string][] = [
    ['longestRoad', longestRoadName(next)],
    ['largestArmy', 'Largest Army'],
  ];
  for (const [award, label] of awards) {
    const from = prev.awards[award];
    const to = next.awards[award];
    if (from === to) continue;
    const text =
      to === null
        ? `${name(from as PlayerId)} lost ${label}; nobody holds it`
        : `${name(to)} took ${label}${from === null ? '' : ` from ${name(from)}`}`;
    out.push({ kind: 'award', award, label, to, from, text: personal(text, next, viewer) });
  }
  return out;
}

function titleNotice(e: LogEntry, state: GameState, viewer: PlayerId | null): GameNotice | null {
  if (e.player === null) return null;
  for (const [re, label] of LOG_TITLES) {
    const m = re.exec(e.text);
    if (!m) continue;
    const named = parseLogText(e.text, state.players).flatMap((t) =>
      t.kind === 'player' && t.id !== e.player ? [t.id] : [],
    );
    return {
      kind: 'award',
      award: 'other',
      label: label(m),
      to: e.player,
      from: named[0] ?? null,
      text: personal(e.text, state, viewer),
    };
  }
  return null;
}

/**
 * What `viewer` should be told about the change from `prev` to `next` (any number of actions
 * apart: bot batches). `viewer` null / negative = a spectator (awards only).
 */
export function gameNotices(
  prev: GameState,
  next: GameState,
  viewer: PlayerId | null,
): GameNotice[] {
  // Same state, or another game (a rematch): nothing to tell.
  if (prev === next || next.turn.number < prev.turn.number) return [];
  const out: GameNotice[] = [];
  for (const e of appendedLog(prev, next)) {
    const secret = secretText(e, viewer);
    if (secret !== null) out.push({ kind: 'steal', text: personal(secret, next, viewer) });
    const title = titleNotice(e, next, viewer);
    if (title) out.push(title);
  }
  return [...out, ...awardNotices(prev, next, viewer)];
}
