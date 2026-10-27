/**
 * Player profile (PR1): nickname, profile picture and piece style. Pure data and checks, no DOM,
 * no Pixi: the room server imports it to validate `setProfile` (src/net/protocol.ts).
 *
 * Everything here is cosmetic. It never reaches the engine and never changes a rule.
 */
import type { KeyStore } from '../../net/transport';
import { NAME_KEY } from '../../net/transport';

/** Nickname length: the setup screen's NAME_MAX (not imported: setup/model imports this file). */
export const PROFILE_NAME_MAX = 16;
const NAME_MAX = PROFILE_NAME_MAX;

// ---------------------------------------------------------------------------
// Piece styles (drawn by src/render/pieceStyles.ts)
// ---------------------------------------------------------------------------

export const PIECE_STYLE_IDS = [
  'classic',
  'timber',
  'longhouse',
  'keep',
  'adobe',
  'pagoda',
] as const;
export type PieceStyleId = (typeof PIECE_STYLE_IDS)[number];
export const DEFAULT_PIECE_STYLE: PieceStyleId = 'classic';

export const PIECE_STYLE_LABEL: Record<PieceStyleId, string> = {
  classic: 'Classic',
  timber: 'Timber',
  longhouse: 'Longhouse',
  keep: 'Stone keep',
  adobe: 'Adobe',
  pagoda: 'Pagoda',
};

export function isPieceStyle(x: unknown): x is PieceStyleId {
  return typeof x === 'string' && (PIECE_STYLE_IDS as readonly string[]).includes(x);
}

/** A known style id, else Classic (older saves, other versions, bad input). */
export function pieceStyleOr(x: unknown): PieceStyleId {
  return isPieceStyle(x) ? x : DEFAULT_PIECE_STYLE;
}

// ---------------------------------------------------------------------------
// Avatars: a gallery id (src/ui/profile/gallery.ts) or an uploaded picture (a data URL)
// ---------------------------------------------------------------------------

export const AVATAR_IDS = [
  'fox',
  'owl',
  'bear',
  'wolf',
  'stag',
  'boar',
  'hare',
  'raven',
  'sheep',
  'ox',
  'cat',
  'frog',
  'knight',
  'farmer',
  'miner',
  'sailor',
  'merchant',
  'wizard',
] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

/**
 * What a profile stores as its picture: an AvatarId, or `data:image/<webp|jpeg|png>;base64,...`.
 * null = none (the generic person icon).
 */
export type AvatarRef = string;

export const AVATAR_LIMITS = {
  /** Uploads are cropped to a square and resized to this many px. */
  size: 96,
  /** The encoder steps quality down until the file fits this (bytes). */
  targetBytes: 12 * 1024,
  /** The server refuses larger pictures (decoded bytes). */
  maxBytes: 16 * 1024,
} as const;

/** Longest data URL the server accepts: the base64 of maxBytes plus the longest prefix. */
export const AVATAR_MAX_CHARS =
  'data:image/webp;base64,'.length + Math.ceil(AVATAR_LIMITS.maxBytes / 3) * 4;

const DATA_URL = /^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/]*={0,2})$/;

export function isAvatarId(x: unknown): x is AvatarId {
  return typeof x === 'string' && (AVATAR_IDS as readonly string[]).includes(x);
}

export function isImageAvatar(ref: string): boolean {
  return ref.startsWith('data:');
}

/** Decoded size of a base64 payload. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

/**
 * Why `x` is not an acceptable avatar, or null if it is. Gallery ids by name; pictures only as
 * base64 data URLs of WebP, JPEG or PNG, at most AVATAR_LIMITS.maxBytes, with a matching file
 * signature. Never a remote URL.
 */
export function avatarError(x: unknown): string | null {
  if (typeof x !== 'string') return 'expected a string';
  if (!x.startsWith('data:')) return isAvatarId(x) ? null : 'unknown avatar';
  if (x.length > AVATAR_MAX_CHARS) return `picture larger than ${AVATAR_LIMITS.maxBytes} bytes`;
  const m = DATA_URL.exec(x);
  if (!m) return 'pictures must be data:image/webp, jpeg or png in base64';
  const [, type, b64 = ''] = m;
  if (b64.length === 0 || b64.length % 4 !== 0) return 'bad base64';
  if (base64Bytes(b64) > AVATAR_LIMITS.maxBytes) {
    return `picture larger than ${AVATAR_LIMITS.maxBytes} bytes`;
  }
  if (!b64.startsWith(SIGNATURE[type as keyof typeof SIGNATURE])) {
    return `not a ${type} picture`;
  }
  return null;
}

/** The base64 of each format's first bytes (RIFF, FF D8 FF, 89 PNG). */
const SIGNATURE = { webp: 'UklGR', jpeg: '/9j/', png: 'iVBORw0KGgo' } as const;

// ---------------------------------------------------------------------------
// The local profile (localStorage)
// ---------------------------------------------------------------------------

export interface Profile {
  /** Nickname (also the online name, NAME_KEY). '' = not set. */
  name: string;
  avatar: AvatarRef | null;
  pieceStyle: PieceStyleId;
}

export const PROFILE_KEY = 'catan.profile.v1';

export const EMPTY_PROFILE: Profile = { name: '', avatar: null, pieceStyle: DEFAULT_PIECE_STYLE };

function safeGet(store: KeyStore | null, key: string): string | null {
  try {
    return store?.get(key) ?? null;
  } catch {
    return null;
  }
}

/** The saved profile; a bad or missing entry gives defaults (the name falls back to NAME_KEY). */
export function loadProfile(store: KeyStore | null): Profile {
  const fallbackName = safeGet(store, NAME_KEY) ?? '';
  const raw = safeGet(store, PROFILE_KEY);
  let o: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      o = parsed as Record<string, unknown>;
    }
  } catch {
    /* defaults */
  }
  const name = typeof o.name === 'string' ? o.name.slice(0, NAME_MAX) : '';
  return {
    name: name || fallbackName.slice(0, NAME_MAX),
    avatar: avatarError(o.avatar) === null ? (o.avatar as string) : null,
    pieceStyle: pieceStyleOr(o.pieceStyle),
  };
}

/** Save the profile (and the nickname under NAME_KEY). False if storage refused it. */
export function saveProfile(store: KeyStore | null, p: Profile): boolean {
  if (!store) return false;
  try {
    const clean: Profile = {
      name: p.name.trim().slice(0, NAME_MAX),
      avatar: p.avatar !== null && avatarError(p.avatar) === null ? p.avatar : null,
      pieceStyle: pieceStyleOr(p.pieceStyle),
    };
    store.set(PROFILE_KEY, JSON.stringify(clean));
    if (clean.name) store.set(NAME_KEY, clean.name);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Seat looks: what the board and the HUD show per player (index = PlayerId)
// ---------------------------------------------------------------------------

export interface SeatLook {
  /** null/absent = the generic person (or bot) icon. */
  avatar?: AvatarRef | null;
  /** Absent = Classic. */
  pieceStyle?: PieceStyleId;
}

/** A clean copy of saved/received looks (bad entries dropped). */
export function cleanLooks(x: unknown, count: number): SeatLook[] {
  const list = Array.isArray(x) ? x : [];
  return Array.from({ length: count }, (_, i) => {
    const o: unknown = list[i];
    if (!o || typeof o !== 'object') return {};
    const r = o as Record<string, unknown>;
    const look: SeatLook = {};
    if (typeof r.avatar === 'string' && avatarError(r.avatar) === null) look.avatar = r.avatar;
    if (isPieceStyle(r.pieceStyle)) look.pieceStyle = r.pieceStyle;
    return look;
  });
}
