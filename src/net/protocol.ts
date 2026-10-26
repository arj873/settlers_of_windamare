/**
 * Online multiplayer wire protocol (docs/MULTIPLAYER.md). Shared by the room server (M2) and the
 * browser client (M3). Every message is one JSON object with `v` (PROTOCOL_VERSION) and `type`.
 *
 * Client messages are untrusted: the server runs `parseClientMessage` on every frame and the
 * engine's `applyAction` on every intent. Server messages are trusted by the client and only get
 * a shallow check (`parseServerMessage`).
 */
import {
  MAP_IDS,
  MAPS,
  RESOURCES,
  type Action,
  type ActionType,
  type EdgeId,
  type GameView,
  type HexId,
  type MapId,
  type PlayerId,
  type Resource,
  type ResourceBundle,
  type VertexId,
} from '../engine';
import type { SlotKind } from '../game/turnTimer';
import type { NewGameConfig } from '../ui/types';
import { NAME_MAX, SEAT_COLORS, TIMER_STEPS } from '../ui/setup/model';
import {
  arrayOf,
  bool,
  field,
  int,
  Invalid,
  isRecord,
  nullable,
  oneOf,
  onlyKeys,
  optional,
  record,
  str,
  type Check,
} from './guard';

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const LIMITS = {
  /** Raw frame size (characters) the server accepts before parsing. */
  messageChars: 8_000,
  /** Nickname length (same as the hotseat setup screen). */
  name: NAME_MAX,
  /** Chat message length. */
  chat: 280,
  /** Chat entries kept and sent on join. */
  chatHistory: 100,
  /** Members per room (seated + spectators, connected or not). */
  members: 32,
  /** Reconnect token length bounds. */
  tokenMin: 16,
  tokenMax: 128,
} as const;

/** Token buckets per member: `burst` messages at once, refilled at `perSec`. */
export const RATE_LIMITS = {
  chat: { burst: 5, perSec: 0.5 },
  react: { burst: 6, perSec: 1 },
  intent: { burst: 20, perSec: 10 },
  /** Lobby and host operations (setName, takeSeat, configure, ...). */
  lobby: { burst: 10, perSec: 2 },
} as const;
export type RateKind = keyof typeof RATE_LIMITS;

/** Quick reactions: ids, not raw emoji (the client draws them). */
export const REACTIONS = [
  'thumbsUp',
  'laugh',
  'wow',
  'sad',
  'angry',
  'clap',
  'think',
  'gg',
] as const;
export type Reaction = (typeof REACTIONS)[number];

/** Seat colours players may pick (the setup screen's palette). */
export const ROOM_COLORS: readonly string[] = SEAT_COLORS.map((c) => c.color);

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** Public member id (`m1`, `m2`, ...). The secret is the token, never sent to anyone else. */
export type MemberId = string;

export type RoomPhase = 'lobby' | 'playing' | 'over';

/**
 * Game options the host picks in the lobby: the hotseat NewGameConfig (stage 2) without the
 * per-seat list (seats come from the lobby) and without the seed (the server draws it).
 */
export type RoomConfig = Omit<NewGameConfig, 'players' | 'seed'> & {
  /** Seats at the table, within the map's player range. Empty seats become bots at start. */
  seatCount: number;
};

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  mode: 'base',
  map: 'baseRandom',
  seatCount: 4,
  rules: { balancedDice: false, hideBankCards: false },
  turnTimerSec: 90,
  vpToWin: 10,
  discardLimit: 7,
};

/**
 * Who plays a seat. In the lobby: 'human' (taken) or 'bot' (open, a bot plays it if nobody takes
 * it). In a game: 'human' (connected), 'away' (disconnected, grace period running, the human
 * still owns the turn), 'bot' (open seat, or the grace ran out: a bot plays until they return).
 */
export type SeatStatus = 'human' | 'away' | 'bot';

export interface SeatInfo {
  index: PlayerId;
  color: string;
  /** Member who owns the seat (also while a bot plays it for them). */
  occupant: MemberId | null;
  status: SeatStatus;
}

export interface MemberInfo {
  id: MemberId;
  name: string;
  connected: boolean;
  /** Seat index, or null for a spectator. */
  seat: PlayerId | null;
}

export interface RoomInfo {
  id: string;
  phase: RoomPhase;
  host: MemberId | null;
  config: RoomConfig;
  seats: SeatInfo[];
  members: MemberInfo[];
}

export interface ChatEntry {
  /** Increasing per room. */
  id: number;
  /** Server time (ms since epoch). */
  at: number;
  /** null = system message (joined, timed out, bot took over, game won...). */
  from: MemberId | null;
  name: string;
  seat: PlayerId | null;
  text: string;
}

/** The turn clock (settings.turnTimerSec), counted down locally from when the message arrives. */
export interface TimerInfo {
  player: PlayerId;
  kind: SlotKind;
  remainingMs: number;
  totalMs: number;
}

export type ErrorCode =
  | 'bad_message'
  | 'version_mismatch'
  | 'not_joined'
  | 'rate_limited'
  | 'room_full'
  | 'not_host'
  | 'wrong_phase'
  | 'name_required'
  | 'bad_seat'
  | 'seat_taken'
  | 'color_taken'
  | 'not_seated'
  | 'bad_config'
  | 'not_your_seat'
  | 'stale_state'
  | 'illegal_action'
  | 'kicked'
  | 'replaced'
  | 'room_expired';

/** Errors after which the server closes the socket (with CLOSE_CODES[code]). */
export const FATAL_ERRORS: readonly ErrorCode[] = [
  'version_mismatch',
  'room_full',
  'kicked',
  'replaced',
  'room_expired',
];

/** WebSocket close codes (4000-4999 are free for applications). */
export const CLOSE_CODES: Partial<Record<ErrorCode, number>> = {
  version_mismatch: 4000,
  room_full: 4001,
  kicked: 4002,
  replaced: 4003,
  room_expired: 4004,
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

type V = { v: typeof PROTOCOL_VERSION };

export type ClientMessage = V &
  (
    | {
        type: 'hello';
        /** Reconnect token from localStorage (null on the first visit). */
        token: string | null;
        /** Optional nickname to set right away. */
        name?: string;
      }
    | { type: 'setName'; name: string }
    | { type: 'takeSeat'; seat: PlayerId }
    | { type: 'leaveSeat' }
    | { type: 'setColor'; color: string }
    /** Host, lobby. */
    | { type: 'configure'; config: RoomConfig }
    /** Host. Removes a member; their token stops working. */
    | { type: 'kick'; member: MemberId }
    /** Host, lobby. */
    | { type: 'start' }
    /** Host, after game over: back to the lobby with the same seats. */
    | { type: 'rematch' }
    /** A game action. `action.player` must be the sender's seat. `seq` = last game seq seen. */
    | { type: 'intent'; action: Action; seq?: number }
    | { type: 'chat'; text: string }
    | { type: 'react'; reaction: Reaction }
    /** Resend room + game (e.g. after the tab was in the background). */
    | { type: 'sync' }
  );

export type ClientMessageType = ClientMessage['type'];

export type ServerMessage = V &
  (
    | {
        type: 'welcome';
        /** Store `token` in localStorage under the room id (reconnect). */
        you: { member: MemberId; token: string };
        room: RoomInfo;
        chat: ChatEntry[];
      }
    | { type: 'room'; room: RoomInfo }
    | {
        type: 'game';
        /** Increases with every state change; echo it in `intent.seq`. */
        seq: number;
        /** The recipient's view (engine/view.ts). */
        view: GameView;
        /** The recipient's legal actions, computed by the server from the full state. */
        legal: Action[];
        timer: TimerInfo | null;
      }
    | { type: 'chat'; entry: ChatEntry }
    | { type: 'reaction'; member: MemberId; seat: PlayerId | null; reaction: Reaction }
    | {
        type: 'error';
        code: ErrorCode;
        message: string;
        /** Type of the client message that caused it. */
        ref?: ClientMessageType;
      }
  );

export type ServerMessageType = ServerMessage['type'];

/** Client -> server ping frame. Not JSON: the Durable Object answers it without waking. */
export const PING = 'ping';
export const PONG = 'pong';

// ---------------------------------------------------------------------------
// Validation: client messages
// ---------------------------------------------------------------------------

export type Parsed<T> = { ok: true; msg: T } | { ok: false; code: ErrorCode; message: string };

const PLAYER_ID = int(0, 7);
const COORD = '-?\\d{1,2}';
const HEX = str(16, { pattern: new RegExp(`^h:${COORD},${COORD}$`) }) as Check<HexId>;
const VERTEX = str(16, { pattern: new RegExp(`^v:${COORD},${COORD},(N|S)$`) }) as Check<VertexId>;
const EDGE = str(16, { pattern: new RegExp(`^e:${COORD},${COORD},(NE|E|SE)$`) }) as Check<EdgeId>;
const RESOURCE = oneOf(RESOURCES);

const BUNDLE: Check<ResourceBundle> = (x, path) => {
  const o = record(x, path);
  onlyKeys(o, RESOURCES, path);
  const out: ResourceBundle = {};
  for (const r of RESOURCES) {
    const n = optional(o, r, int(0, 99), path);
    if (n !== undefined) out[r] = n;
  }
  return out;
};

type ActionParsers = {
  [T in ActionType]: (o: Record<string, unknown>, player: PlayerId, p: string) => Action;
};

/** Per type: the payload fields (the `player` and `type` are handled by parseAction). */
const ACTIONS: ActionParsers = {
  placeSetupSettlement: (o, player, p) => ({
    type: 'placeSetupSettlement',
    player,
    vertex: field(o, 'vertex', VERTEX, p),
  }),
  placeSetupRoad: (o, player, p) => ({
    type: 'placeSetupRoad',
    player,
    edge: field(o, 'edge', EDGE, p),
  }),
  rollDice: (_o, player) => ({ type: 'rollDice', player }),
  endTurn: (_o, player) => ({ type: 'endTurn', player }),
  passSpecialBuild: (_o, player) => ({ type: 'passSpecialBuild', player }),
  buildRoad: (o, player, p) => ({ type: 'buildRoad', player, edge: field(o, 'edge', EDGE, p) }),
  buildSettlement: (o, player, p) => ({
    type: 'buildSettlement',
    player,
    vertex: field(o, 'vertex', VERTEX, p),
  }),
  buildCity: (o, player, p) => ({
    type: 'buildCity',
    player,
    vertex: field(o, 'vertex', VERTEX, p),
  }),
  discard: (o, player, p) => ({
    type: 'discard',
    player,
    resources: field(o, 'resources', BUNDLE, p),
  }),
  moveRobber: (o, player, p) => ({ type: 'moveRobber', player, hex: field(o, 'hex', HEX, p) }),
  steal: (o, player, p) => ({ type: 'steal', player, victim: field(o, 'victim', PLAYER_ID, p) }),
  buyDevCard: (_o, player) => ({ type: 'buyDevCard', player }),
  playKnight: (_o, player) => ({ type: 'playKnight', player }),
  playRoadBuilding: (_o, player) => ({ type: 'playRoadBuilding', player }),
  placeFreeRoad: (o, player, p) => ({
    type: 'placeFreeRoad',
    player,
    edge: field(o, 'edge', EDGE, p),
  }),
  playYearOfPlenty: (o, player, p) => {
    const pair = field(o, 'resources', arrayOf(RESOURCE, 2), p);
    if (pair.length !== 2) throw new Invalid(`${p}.resources`, 'expected 2 resources');
    return { type: 'playYearOfPlenty', player, resources: pair as [Resource, Resource] };
  },
  playMonopoly: (o, player, p) => ({
    type: 'playMonopoly',
    player,
    resource: field(o, 'resource', RESOURCE, p),
  }),
  bankTrade: (o, player, p) => ({
    type: 'bankTrade',
    player,
    give: field(o, 'give', RESOURCE, p),
    receive: field(o, 'receive', RESOURCE, p),
  }),
  offerTrade: (o, player, p) => ({
    type: 'offerTrade',
    player,
    give: field(o, 'give', BUNDLE, p),
    want: field(o, 'want', BUNDLE, p),
    to: field(o, 'to', arrayOf(PLAYER_ID, 7), p),
  }),
  acceptTrade: (_o, player) => ({ type: 'acceptTrade', player }),
  rejectTrade: (_o, player) => ({ type: 'rejectTrade', player }),
  cancelTrade: (_o, player) => ({ type: 'cancelTrade', player }),
  confirmTrade: (o, player, p) => ({
    type: 'confirmTrade',
    player,
    partner: field(o, 'partner', PLAYER_ID, p),
  }),
};

const ACTION_TYPES = Object.keys(ACTIONS) as ActionType[];

/** Structural check of an engine Action (the rules are applyAction's job). */
export const parseAction: Check<Action> = (x, path) => {
  const o = record(x, path);
  const type = field(o, 'type', oneOf(ACTION_TYPES), path);
  const player = field(o, 'player', PLAYER_ID, path);
  return ACTIONS[type](o, player, path);
};

const NAME = str(LIMITS.name * 4); // trimmed + clipped by the server (cleanName)
const TOKEN = str(LIMITS.tokenMax, { min: LIMITS.tokenMin, pattern: /^[A-Za-z0-9_-]+$/ });

export const parseRoomConfig: Check<RoomConfig> = (x, path) => {
  const o = record(x, path);
  const map = field(o, 'map', oneOf(MAP_IDS), path) as MapId;
  const def = MAPS[map];
  const rules = record(o.rules, `${path}.rules`);
  const timer = field(o, 'turnTimerSec', nullable(int(1, 3600)), path);
  if (timer !== null && !TIMER_STEPS.includes(timer)) {
    throw new Invalid(`${path}.turnTimerSec`, `expected one of ${TIMER_STEPS.join(', ')}`);
  }
  return {
    mode: field(o, 'mode', oneOf(['base'] as const), path),
    map,
    seatCount: field(o, 'seatCount', int(def.minPlayers, def.maxPlayers), path),
    rules: {
      balancedDice: field(rules, 'balancedDice', bool, `${path}.rules`),
      hideBankCards: field(rules, 'hideBankCards', bool, `${path}.rules`),
    },
    turnTimerSec: timer,
    vpToWin: field(o, 'vpToWin', int(3, 20), path),
    discardLimit: field(o, 'discardLimit', int(5, 20), path),
  };
};

type ClientParsers = {
  [T in ClientMessageType]: (
    o: Record<string, unknown>,
    p: string,
  ) => Extract<ClientMessage, { type: T }>;
};

const v = PROTOCOL_VERSION;
const CLIENT: ClientParsers = {
  hello: (o, p) => {
    const name = optional(o, 'name', NAME, p);
    return {
      v,
      type: 'hello',
      token: field(o, 'token', nullable(TOKEN), p),
      ...(name === undefined ? {} : { name }),
    };
  },
  setName: (o, p) => ({ v, type: 'setName', name: field(o, 'name', NAME, p) }),
  takeSeat: (o, p) => ({ v, type: 'takeSeat', seat: field(o, 'seat', PLAYER_ID, p) }),
  leaveSeat: () => ({ v, type: 'leaveSeat' }),
  setColor: (o, p) => ({ v, type: 'setColor', color: field(o, 'color', oneOf(ROOM_COLORS), p) }),
  configure: (o, p) => ({ v, type: 'configure', config: field(o, 'config', parseRoomConfig, p) }),
  kick: (o, p) => ({ v, type: 'kick', member: field(o, 'member', str(16), p) }),
  start: () => ({ v, type: 'start' }),
  rematch: () => ({ v, type: 'rematch' }),
  intent: (o, p) => {
    const seq = optional(o, 'seq', int(0, Number.MAX_SAFE_INTEGER), p);
    return {
      v,
      type: 'intent',
      action: field(o, 'action', parseAction, p),
      ...(seq === undefined ? {} : { seq }),
    };
  },
  chat: (o, p) => ({ v, type: 'chat', text: field(o, 'text', str(LIMITS.chat * 2), p) }),
  react: (o, p) => ({ v, type: 'react', reaction: field(o, 'reaction', oneOf(REACTIONS), p) }),
  sync: () => ({ v, type: 'sync' }),
};

const CLIENT_TYPES = Object.keys(CLIENT) as ClientMessageType[];

/**
 * Validate one client frame: a JSON string (size-checked first) or an already parsed value.
 * On success the message is rebuilt from known fields only.
 */
export function parseClientMessage(raw: unknown): Parsed<ClientMessage> {
  let x = raw;
  if (typeof raw === 'string') {
    if (raw.length > LIMITS.messageChars) {
      return {
        ok: false,
        code: 'bad_message',
        message: `message longer than ${LIMITS.messageChars}`,
      };
    }
    try {
      x = JSON.parse(raw);
    } catch {
      return { ok: false, code: 'bad_message', message: 'not JSON' };
    }
  }
  if (!isRecord(x)) return { ok: false, code: 'bad_message', message: 'expected an object' };
  if (x.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: 'version_mismatch',
      message: `server speaks protocol v${PROTOCOL_VERSION}, got ${JSON.stringify(x.v) ?? 'none'}; reload the page`,
    };
  }
  try {
    const type = field(x, 'type', oneOf(CLIENT_TYPES), 'msg');
    return { ok: true, msg: CLIENT[type](x, 'msg') };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, code: 'bad_message', message: e.message };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Validation: server messages (trusted source; shallow check only)
// ---------------------------------------------------------------------------

const SERVER_TYPES: readonly ServerMessageType[] = [
  'welcome',
  'room',
  'game',
  'chat',
  'reaction',
  'error',
];

/** Client side: JSON + version + known type. The payload is trusted (it comes from our server). */
export function parseServerMessage(raw: string): Parsed<ServerMessage> {
  let x: unknown;
  try {
    x = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'bad_message', message: 'not JSON' };
  }
  if (!isRecord(x)) return { ok: false, code: 'bad_message', message: 'expected an object' };
  if (x.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: 'version_mismatch',
      message: 'protocol version changed; reload the page',
    };
  }
  if (!SERVER_TYPES.includes(x.type as ServerMessageType)) {
    return { ok: false, code: 'bad_message', message: `unknown type ${String(x.type)}` };
  }
  return { ok: true, msg: x as ServerMessage };
}

/**
 * Trim, collapse whitespace, drop control and bidi-override characters, clip to `max` code
 * points (an emoji is never cut in half).
 */
export function cleanText(s: string, max: number): string {
  const flat = Array.from(s)
    .map((ch) => (isStripped(ch.codePointAt(0) ?? 0) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(flat).slice(0, max).join('').trim();
}

/** C0/C1 controls, zero-width and bidi controls, line/paragraph separators, BOM. */
function isStripped(c: number): boolean {
  return (
    c <= 0x1f ||
    (c >= 0x7f && c <= 0x9f) ||
    (c >= 0x200b && c <= 0x200f) ||
    (c >= 0x2028 && c <= 0x202e) ||
    (c >= 0x2066 && c <= 0x2069) ||
    c === 0xfeff
  );
}
