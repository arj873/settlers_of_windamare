/**
 * Where the room server lives. Production: the Cloudflare Worker (POST /api/rooms,
 * GET /api/rooms/:code, WebSocket /api/rooms/:code/ws). Dev: a GameSession in the browser
 * (devServer.ts), picked by `?server=local` or by default under `pnpm dev`.
 */
import {
  API_ROOMS,
  roomApiPath,
  roomSocketPath,
  type CreateRoomResponse,
  type RoomSummary,
} from '../../net/api';
import type { Clock, Connect, KeyStore, RoomApi } from '../../net/transport';

export interface Backend {
  kind: 'remote' | 'local';
  api: RoomApi;
  connect(roomId: string): Connect;
}

export const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** localStorage, every access guarded (private mode, blocked storage). */
export const browserKeyStore: KeyStore = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* not remembered */
    }
  },
};

/** sessionStorage: per tab, survives a reload. */
export const tabKeyStore: KeyStore = {
  get(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* not remembered */
    }
  },
};

/**
 * Where reconnect tokens live. The dev server's rooms are shared by this browser's tabs, so each
 * tab keeps its own token there (two tabs = two players); real rooms use localStorage (two tabs =
 * the same player, the newer one takes over).
 */
export function tokenStoreFor(kind: Backend['kind']): KeyStore {
  return kind === 'local' ? tabKeyStore : browserKeyStore;
}

/** One WebSocket per call. `onClose` fires once, also when the socket never opened. */
export function webSocketConnect(url: string): Connect {
  return (h) => {
    let done = false;
    const finish = (code: number, reason: string) => {
      if (done) return;
      done = true;
      h.onClose(code, reason);
    };
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      setTimeout(() => finish(1006, e instanceof Error ? e.message : 'bad url'), 0);
      return { send: () => undefined, close: () => finish(1000, 'closed') };
    }
    ws.onopen = () => h.onOpen();
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') h.onMessage(e.data);
    };
    ws.onclose = (e) => finish(e.code, e.reason);
    return {
      send: (text) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(text);
      },
      close: () => {
        try {
          ws.close(1000, 'bye');
        } catch {
          /* already closed */
        }
      },
    };
  };
}

async function json(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** The Worker's HTTP API under `origin` (no trailing slash). */
export function httpRoomApi(origin: string): RoomApi {
  return {
    async create() {
      const res = await fetch(`${origin}${API_ROOMS}`, { method: 'POST' });
      if (!res.ok) throw new Error(`Could not create a room (HTTP ${res.status})`);
      const body = (await json(res)) as Partial<CreateRoomResponse> | null;
      if (typeof body?.roomId !== 'string' || typeof body.hostToken !== 'string') {
        throw new Error('The server sent an unexpected reply');
      }
      return { roomId: body.roomId, hostToken: body.hostToken };
    },
    async check(roomId) {
      const res = await fetch(`${origin}${roomApiPath(encodeURIComponent(roomId))}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Could not reach the server (HTTP ${res.status})`);
      const body = (await json(res)) as Partial<RoomSummary> | null;
      // A 200 without a usable body still means the room exists; assume the lobby.
      return { phase: body?.phase ?? 'lobby' };
    },
  };
}

export function remoteBackend(origin: string): Backend {
  const wsOrigin = origin.replace(/^http/, 'ws');
  return {
    kind: 'remote',
    api: httpRoomApi(origin),
    connect: (roomId) =>
      webSocketConnect(`${wsOrigin}${roomSocketPath(encodeURIComponent(roomId))}`),
  };
}

/**
 * `?server=local|remote` wins; otherwise local under `pnpm dev` (unless VITE_ROOM_SERVER is
 * set), remote in builds. VITE_ROOM_SERVER = origin of the Worker (default: this page's).
 */
export function backendKind(search: string): Backend['kind'] {
  const p = new URLSearchParams(search).get('server');
  if (p === 'local' || p === 'remote') return p;
  return import.meta.env.DEV && !import.meta.env.VITE_ROOM_SERVER ? 'local' : 'remote';
}

export async function pickBackend(search: string): Promise<Backend> {
  if (backendKind(search) === 'local') {
    const { localBackend } = await import('./devBackend');
    return localBackend();
  }
  const origin = (import.meta.env.VITE_ROOM_SERVER as string | undefined) ?? location.origin;
  return remoteBackend(origin.replace(/\/$/, ''));
}
