/**
 * Game Events panel model: turns the engine's plain-text log into icon tokens and groups it per
 * turn, folding the "X received …" lines after a roll into one production summary. No DOM here.
 * The engine log format is not a contract, so anything unrecognised simply stays text.
 */
import {
  RESOURCES,
  type DevCardType,
  type LogEntry,
  type Player,
  type PlayerId,
  type Resource,
} from '../engine';

export type PieceKind = 'road' | 'settlement' | 'city';
export type AwardKind = 'longestRoad' | 'largestArmy';

export type LogToken =
  | { kind: 'text'; text: string }
  | { kind: 'player'; id: PlayerId }
  | { kind: 'resource'; resource: Resource; count: number }
  /** `faces` from "rolled 8 (3+5)" (T14+); null in older logs ("rolled 8"). */
  | { kind: 'dice'; total: number; faces: [number, number] | null }
  | { kind: 'piece'; piece: PieceKind }
  /** `card: null` = a face-down development card (bought). */
  | { kind: 'dev'; card: DevCardType | null }
  | { kind: 'robber' }
  | { kind: 'award'; award: AwardKind };

export interface LogLine {
  kind: 'line';
  player: PlayerId | null;
  tokens: LogToken[];
  /** Index into `state.log`. */
  index: number;
  /** #32: the viewer reads the entry's private text (e.g. which card a steal took). */
  secret?: true;
}

export interface ProductionBlock {
  kind: 'production';
  rows: { player: PlayerId; tokens: LogToken[] }[];
}

export interface LogGroup {
  /** Stable key: first log index of the group. */
  key: number;
  turn: number;
  items: (LogLine | ProductionBlock)[];
}

/** Played-card names as the log writes them (lower-cased for lookup) → card and display label. */
const DEV_BY_NAME: Record<string, [DevCardType, string]> = {
  'a knight': ['knight', 'Knight'],
  'road building': ['roadBuilding', 'Road Building'],
  'year of plenty': ['yearOfPlenty', 'Year of Plenty'],
  monopoly: ['monopoly', 'Monopoly'],
};

const RES = RESOURCES.join('|');
/** Keyword patterns, tried in this order at each position (after player names). */
const PATTERNS: [RegExp, (m: RegExpExecArray) => LogToken[]][] = [
  [
    /rolled (\d+)(?: \(([1-6])\+([1-6])\))?/y,
    (m) => [
      { kind: 'text', text: 'rolled ' },
      {
        kind: 'dice',
        total: Number(m[1]),
        faces: m[2] && m[3] ? [Number(m[2]), Number(m[3])] : null,
      },
    ],
  ],
  [
    new RegExp(`(\\d+) (${RES})\\b`, 'y'),
    (m) => [{ kind: 'resource', resource: m[2] as Resource, count: Number(m[1]) }],
  ],
  [
    new RegExp(`\\b(${RES})\\b`, 'y'),
    (m) => [{ kind: 'resource', resource: m[1] as Resource, count: 1 }],
  ],
  [
    /\ba (free )?(road|settlement|city)\b/y,
    (m) => [
      ...(m[1] ? [{ kind: 'text', text: 'free ' } as const] : []),
      { kind: 'piece', piece: m[2] as PieceKind },
    ],
  ],
  [/\ba development card\b/y, () => [{ kind: 'dev', card: null }]],
  [
    /\b(a knight|road building|year of plenty|monopoly)\b/iy,
    (m) => {
      const [card, label] = DEV_BY_NAME[(m[1] ?? '').toLowerCase()] ?? [null, m[0]];
      return [
        { kind: 'dev', card },
        { kind: 'text', text: ` ${label}` },
      ];
    },
  ],
  [/\bthe robber\b/y, () => [{ kind: 'robber' }]],
  [
    /Longest (?:Road|Trade Route)/y,
    (m) => [
      { kind: 'award', award: 'longestRoad' },
      { kind: 'text', text: ` ${m[0]}` },
    ],
  ],
  [
    /Largest Army/y,
    () => [
      { kind: 'award', award: 'largestArmy' },
      { kind: 'text', text: ' Largest Army' },
    ],
  ],
];

/** Split one log text into tokens. Player names (user input) match first, longest name wins. */
export function parseLogText(
  text: string,
  players: readonly Pick<Player, 'id' | 'name'>[],
): LogToken[] {
  const named = players
    .filter((p) => p.name.length > 0)
    .slice()
    .sort((a, b) => b.name.length - a.name.length);
  const out: LogToken[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ kind: 'text', text: buf });
    buf = '';
  };
  let i = 0;
  outer: while (i < text.length) {
    for (const p of named) {
      if (text.startsWith(p.name, i) && !/\w/.test(text[i + p.name.length] ?? '')) {
        flush();
        out.push({ kind: 'player', id: p.id });
        i += p.name.length;
        continue outer;
      }
    }
    // Patterns starting with \b only match at a word start.
    if (!/\w/.test(text[i - 1] ?? '')) {
      for (const [re, make] of PATTERNS) {
        re.lastIndex = i;
        const m = re.exec(text);
        if (m) {
          flush();
          out.push(...make(m));
          i += m[0].length;
          continue outer;
        }
      }
    }
    buf += text[i];
    i++;
  }
  flush();
  return joinResources(out);
}

/** "1 brick, 2 wool" → icons side by side: drop the ", " text between two resource tokens. */
function joinResources(tokens: LogToken[]): LogToken[] {
  return tokens.filter((t, i) => {
    if (t.kind !== 'text' || !/^\s*,\s*$/.test(t.text)) return true;
    return !(tokens[i - 1]?.kind === 'resource' && tokens[i + 1]?.kind === 'resource');
  });
}

const RECEIVED = ' received ';

/** #32: the private text `viewer` may read for `e` (`LogEntry.secret`), or null. */
export function secretText(e: LogEntry, viewer: PlayerId | null): string | null {
  if (viewer === null || viewer < 0) return null;
  return e.secret?.find((s) => s.to.includes(viewer))?.text ?? null;
}

/** The viewer's name in a private text reads "You" / "you" ("You stole 1 wool from Blue"). */
export function youTokens(tokens: readonly LogToken[], viewer: PlayerId): LogToken[] {
  return tokens.map((t, i) =>
    t.kind === 'player' && t.id === viewer ? { kind: 'text', text: i === 0 ? 'You' : 'you' } : t,
  );
}

/** Plain text of tokens (toasts): players by name, resources as "1 wool". */
export function tokensText(
  tokens: readonly LogToken[],
  players: readonly Pick<Player, 'id' | 'name'>[],
): string {
  return tokens
    .map((t) => {
      switch (t.kind) {
        case 'text':
          return t.text;
        case 'player':
          return players.find((p) => p.id === t.id)?.name ?? '';
        case 'resource':
          return `${t.count} ${t.resource}`;
        case 'dice':
          return String(t.total);
        case 'piece':
          return `a ${t.piece}`;
        case 'robber':
          return 'the robber';
        default:
          // Award and dev card icons: their label follows as text.
          return '';
      }
    })
    .join('')
    .replace(/ {2,}/g, ' ');
}

/**
 * Group the log per turn (setup: per placing player) and fold the "received" lines that follow a
 * roll into one production block. With a `viewer`, entries with a private text for them read it
 * (#32), their own name as "You".
 */
export function groupLog(
  log: readonly LogEntry[],
  players: readonly Pick<Player, 'id' | 'name'>[],
  viewer: PlayerId | null = null,
): LogGroup[] {
  const groups: LogGroup[] = [];
  let g: LogGroup | undefined;
  let groupPlayer: PlayerId | null = null;
  let afterRoll = false;

  for (const [index, e] of log.entries()) {
    if (
      !g ||
      e.turn !== g.turn ||
      (e.turn === 0 && e.player !== null && groupPlayer !== null && e.player !== groupPlayer)
    ) {
      g = { key: index, turn: e.turn, items: [] };
      groups.push(g);
      groupPlayer = null;
      afterRoll = false;
    }
    if (groupPlayer === null && e.player !== null) groupPlayer = e.player;

    const name = players.find((p) => p.id === e.player)?.name;
    const rest = name !== undefined && e.text.startsWith(name) ? e.text.slice(name.length) : '';
    if (afterRoll && e.player !== null && rest.startsWith(RECEIVED)) {
      const last = g.items[g.items.length - 1];
      const block: ProductionBlock =
        last?.kind === 'production' ? last : { kind: 'production', rows: [] };
      if (block !== last) g.items.push(block);
      block.rows.push({
        player: e.player,
        tokens: parseLogText(rest.slice(RECEIVED.length), players),
      });
      continue;
    }
    const secret = secretText(e, viewer);
    if (secret !== null && viewer !== null) {
      const tokens = youTokens(parseLogText(secret, players), viewer);
      afterRoll = false;
      g.items.push({ kind: 'line', player: e.player, tokens, index, secret: true });
      continue;
    }
    const tokens = parseLogText(e.text, players);
    afterRoll = tokens.some((t) => t.kind === 'dice');
    g.items.push({ kind: 'line', player: e.player, tokens, index });
  }
  return groups;
}
