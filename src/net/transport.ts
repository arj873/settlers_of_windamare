/**
 * What the room client (client.ts) needs from the outside world: a socket-like transport and a
 * clock. WebSocket + real timers in the browser (src/game/online), a loopback + fake clock in
 * tests (loopback.ts). Nothing here touches the DOM.
 */

/** Callbacks a transport calls. `onClose` is called exactly once per transport. */
export interface TransportHandlers {
  onOpen(): void;
  onMessage(text: string): void;
  /** `code`: WebSocket close code (1006 = dropped, 4000-4004 = CLOSE_CODES). */
  onClose(code: number, reason: string): void;
}

export interface Transport {
  send(text: string): void;
  /** Close from our side; `onClose` still follows. */
  close(): void;
}

/** Open one connection to the room. Every reconnect calls it again. */
export type Connect = (handlers: TransportHandlers) => Transport;

export type TimerHandle = unknown;

export interface Clock {
  /** Milliseconds; only differences matter. */
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

/** Where reconnect tokens and the nickname live (localStorage in the browser). */
export interface KeyStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** `localStorage['catan.mp.token.<roomId>']` (docs/MULTIPLAYER.md §7). */
export const tokenKey = (roomId: string): string => `catan.mp.token.${roomId}`;
export const NAME_KEY = 'catan.mp.name';

/** HTTP side of the room server: POST /api/rooms, GET /api/rooms/:code. */
export interface RoomApi {
  create(): Promise<{ roomId: string; hostToken: string }>;
  /** null = no such room. */
  check(roomId: string): Promise<{ phase?: string } | null>;
}

// Room codes as the M2 Worker makes them. TODO(M2 merge): import ROOM_CODE_ALPHABET,
// ROOM_CODE_LENGTH and normalizeRoomCode from ./api instead of mirroring them here.
/** 32 symbols: digits and capitals without 0, O, 1 and I. */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 6;

/** A typed or URL code in canonical form (trimmed, upper case), or null. */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/**
 * A typed code or a pasted invite link -> the canonical room code, or null. Accepts
 * `k3j9qx`, `…?room=K3J9QX`, `…/room/K3J9QX`.
 */
export function parseRoomCode(input: string): string | null {
  const s = input.trim();
  if (s === '') return null;
  const fromQuery = /[?&]room=([^&#\s]+)/.exec(s)?.[1];
  const fromPath = /\/room\/([^/?#\s]+)/.exec(s)?.[1];
  try {
    return normalizeRoomCode(decodeURIComponent(fromQuery ?? fromPath ?? s));
  } catch {
    return null;
  }
}
