/**
 * What the room client (client.ts) needs from the outside world: a socket-like transport and a
 * clock. WebSocket + real timers in the browser (src/game/online), a loopback + fake clock in
 * tests (loopback.ts). Nothing here touches the DOM.
 */
import { normalizeRoomCode, type CreateRoomResponse, type RoomSummary } from './api';

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

/** HTTP side of the room server (shapes in ./api): POST /api/rooms, GET /api/rooms/:code. */
export interface RoomApi {
  create(): Promise<CreateRoomResponse>;
  /** null = no such room. */
  check(roomId: string): Promise<Pick<RoomSummary, 'phase'> | null>;
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
