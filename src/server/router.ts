/**
 * The Worker's HTTP routes (docs/MULTIPLAYER.md §18). Platform-free: the Durable Object
 * namespace, the static assets and the randomness come in through `RouterDeps`, so tests drive
 * it with fakes. The Worker talks to a room's Durable Object over `ROOM_URL` (internal only).
 */
import {
  API_ROOMS,
  normalizeRoomCode,
  roomCodeFromBytes,
  ROOM_CODE_LENGTH,
  type ApiError,
} from '../net/api';
import { RateLimiter, SERVER_LIMITS } from './limits';
import { originAllowed } from './origin';

/** Base URL of requests from the Worker to a room object (never reachable from outside). */
export const ROOM_URL = 'https://room.internal';
/** Header carrying the client IP to the room object (set by the Worker, never trusted from outside). */
export const IP_HEADER = 'x-room-client-ip';

export interface RoomStub {
  fetch(request: Request): Promise<Response>;
}

export interface RouterDeps {
  /** The room object for a canonical code (idFromName(code)). */
  room(code: string): RoomStub;
  /** Static assets (Workers Static Assets binding), or null. */
  assets: { fetch(request: Request): Promise<Response> } | null;
  /** Extra allowed origins (ALLOWED_ORIGINS var). */
  allowedOrigins: readonly string[];
  randomBytes(n: number): Uint8Array;
  now(): number;
}

export type Router = (request: Request) => Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function apiError(status: number, error: string): Response {
  return json({ error } satisfies ApiError, status);
}

const ROOM_PATH = new RegExp(`^${API_ROOMS}/([^/]{1,32})(/ws)?/?$`);
const WS_ALIAS = /^\/ws\/([^/]{1,32})\/?$/;

/** Per-isolate limits: they slow one client down, not a distributed attack (see HOSTING.md). */
export function createRouter(deps: RouterDeps): Router {
  const createLimit = new RateLimiter(SERVER_LIMITS.create);
  const lookupLimit = new RateLimiter(SERVER_LIMITS.lookup);

  return async (request) => {
    const url = new URL(request.url);
    const path = url.pathname;
    const isApi = path === API_ROOMS || path.startsWith(`${API_ROOMS}/`) || WS_ALIAS.test(path);
    if (!isApi) {
      if (path.startsWith('/api/')) return apiError(404, 'no such endpoint');
      return deps.assets ? deps.assets.fetch(request) : new Response('Not found', { status: 404 });
    }
    if (!originAllowed(request.headers.get('origin'), url, deps.allowedOrigins)) {
      return apiError(403, 'origin not allowed');
    }
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const now = deps.now();

    if (path === API_ROOMS || path === `${API_ROOMS}/`) {
      if (request.method !== 'POST') return apiError(405, 'use POST to create a room');
      if (!createLimit.take(ip, now)) return apiError(429, 'too many rooms created, wait a minute');
      return createRoom(deps);
    }

    const alias = WS_ALIAS.exec(path);
    const m = alias ?? ROOM_PATH.exec(path);
    const ws = alias !== null || m?.[2] === '/ws';
    const code = m?.[1] === undefined ? null : normalizeRoomCode(m[1]);
    if (code === null) return apiError(404, 'no such room');
    if (request.method !== 'GET') return apiError(405, 'use GET');
    if (!lookupLimit.take(ip, now)) return apiError(429, 'too many requests, slow down');

    if (!ws) return deps.room(code).fetch(new Request(`${ROOM_URL}/info`));
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return apiError(426, 'expected a WebSocket upgrade');
    }
    const headers = new Headers(request.headers);
    headers.set(IP_HEADER, ip);
    return deps.room(code).fetch(new Request(`${ROOM_URL}/ws`, { headers }));
  };
}

/** A fresh code; on the rare collision with a live room, another one. */
async function createRoom(deps: RouterDeps): Promise<Response> {
  for (let i = 0; i < SERVER_LIMITS.createAttempts; i++) {
    const code = roomCodeFromBytes(deps.randomBytes(ROOM_CODE_LENGTH));
    const res = await deps.room(code).fetch(
      new Request(`${ROOM_URL}/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId: code }),
      }),
    );
    if (res.status !== 409) return res;
  }
  return apiError(503, 'could not find a free room code, try again');
}
