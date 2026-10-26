/**
 * HTTP API of the room server (M2, docs/MULTIPLAYER.md §18): paths, response shapes and room
 * codes. Shared by the Worker and the browser client. Pure: randomness comes in as bytes.
 *
 *   POST /api/rooms              -> 201 CreateRoomResponse
 *   GET  /api/rooms/:code        -> 200 RoomSummary | 404
 *   GET  /api/rooms/:code/ws     -> WebSocket upgrade (also /ws/:code)
 */
import type { RoomPhase } from './protocol';

/** 32 symbols: digits and capitals without 0, O, 1 and I (read aloud, typed from a phone). */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 6;

/** A fresh code from `ROOM_CODE_LENGTH` random bytes (32 symbols, so `byte & 31` is unbiased). */
export function roomCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < ROOM_CODE_LENGTH) throw new Error(`need ${ROOM_CODE_LENGTH} random bytes`);
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[(bytes[i] ?? 0) & 31];
  return code;
}

/** A user-typed or URL code in canonical form (trimmed, upper case), or null if it is not one. */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export const API_ROOMS = '/api/rooms';

export function roomApiPath(code: string): string {
  return `${API_ROOMS}/${code}`;
}

/** WebSocket path of a room (relative: the client picks ws: or wss: from location.protocol). */
export function roomSocketPath(code: string): string {
  return `${API_ROOMS}/${code}/ws`;
}

/** `POST /api/rooms`. Store `hostToken` as the room's reconnect token, then open the socket. */
export interface CreateRoomResponse {
  roomId: string;
  hostToken: string;
}

/** `GET /api/rooms/:code`: enough for a "join room" form, nothing private. */
export interface RoomSummary {
  roomId: string;
  phase: RoomPhase;
  seats: number;
  /** Seats with a human occupant. */
  taken: number;
  /** Members with an open socket. */
  connected: number;
}

/** Body of every non-2xx API response. */
export interface ApiError {
  error: string;
}
