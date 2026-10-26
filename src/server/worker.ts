/**
 * Cloudflare Worker entry (wrangler.jsonc `main`). Thin adapters only; the logic lives in
 * router.ts (HTTP routes) and room.ts (the room Durable Object), which are platform-free.
 *
 *   /api/*, /ws/*  -> router (run_worker_first)      everything else -> static assets (dist/)
 *   one Durable Object `Room` per room code (idFromName), WebSocket Hibernation API
 */
import type {
  DurableObjectNamespace,
  DurableObjectState,
  Fetcher,
  WebSocket as CfWebSocket,
} from '@cloudflare/workers-types/index.ts';
import { PING, PONG } from '../net/protocol';
import { parseOrigins } from './origin';
import { RoomCore, roomFetch, sessionDeps, sessionOptionsFrom, type RoomSocket } from './room';
import { createRouter, type Router } from './router';

export interface Env {
  ROOMS: DurableObjectNamespace;
  ASSETS?: Fetcher;
  /** Extra allowed origins, comma separated (same host and loopback are always allowed). */
  ALLOWED_ORIGINS?: string;
  /** Dev/test overrides of SessionOptions (see sessionOptionsFrom). */
  BOT_DELAY_MS?: string;
  GRACE_MS?: string;
}

/** Workers runtime globals that the DOM lib does not declare. */
const runtime = globalThis as unknown as {
  WebSocketPair: new () => { 0: CfWebSocket; 1: CfWebSocket };
  WebSocketRequestResponsePair: new (request: string, response: string) => never;
};

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

let router: Router | null = null;

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const assets = env.ASSETS;
    router ??= createRouter({
      room: (code) => {
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        return { fetch: (r) => stub.fetch(r as never) as unknown as Promise<Response> };
      },
      assets: assets
        ? { fetch: (r) => assets.fetch(r as never) as unknown as Promise<Response> }
        : null,
      allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
      randomBytes,
      now: () => Date.now(),
    });
    return router(request);
  },
};

/** Kept in the socket attachment, so it survives hibernation (max 2 KB). */
interface Attachment {
  conn: string;
  ip: string;
  at: number;
  joined: boolean;
}

function socketOf(ws: CfWebSocket): RoomSocket | null {
  const a = ws.deserializeAttachment() as Attachment | null;
  if (!a) return null;
  return {
    conn: a.conn,
    ip: a.ip,
    openedAt: a.at,
    joined: a.joined,
    markJoined: () => ws.serializeAttachment({ ...a, joined: true } satisfies Attachment),
    send: (text) => {
      try {
        ws.send(text);
      } catch {
        // already closing; the close event follows
      }
    },
    close: (code, reason) => {
      try {
        ws.close(code, reason);
      } catch {
        // already closed
      }
    },
  };
}

/** The room Durable Object. All state lives in RoomCore + storage; this only adapts events. */
export class Room {
  private core: RoomCore | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    env: Env,
  ) {
    // Keep-alive pings are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new runtime.WebSocketRequestResponsePair(PING, PONG));
    void ctx.blockConcurrencyWhile(async () => {
      this.core = await RoomCore.load({
        storage: {
          load: () => ctx.storage.get<string>('session'),
          save: (text) => ctx.storage.put('session', text),
          clear: async () => {
            await ctx.storage.deleteAlarm();
            await ctx.storage.deleteAll();
          },
          getAlarm: () => ctx.storage.getAlarm(),
          setAlarm: (at) => (at === null ? ctx.storage.deleteAlarm() : ctx.storage.setAlarm(at)),
        },
        sockets: () =>
          ctx.getWebSockets().flatMap((ws) => {
            const s = socketOf(ws);
            return s ? [s] : [];
          }),
        now: () => Date.now(),
        deps: sessionDeps(randomBytes),
        options: sessionOptionsFrom(env as unknown as Record<string, unknown>),
        log: (message, error) => console.error(message, error),
      });
    });
  }

  private get room(): RoomCore {
    if (!this.core) throw new Error('room not loaded'); // blockConcurrencyWhile guarantees it
    return this.core;
  }

  fetch(request: Request): Promise<Response> {
    return roomFetch(this.room, request, async (ip) => {
      const pair = new runtime.WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      const attachment: Attachment = {
        conn: crypto.randomUUID(),
        ip,
        at: Date.now(),
        joined: false,
      };
      server.serializeAttachment(attachment);
      this.ctx.acceptWebSocket(server);
      const socket = socketOf(server);
      if (socket) await this.room.opened(socket);
      return new Response(null, { status: 101, webSocket: client } as ResponseInit);
    });
  }

  async webSocketMessage(ws: CfWebSocket, data: string | ArrayBuffer): Promise<void> {
    const socket = socketOf(ws);
    if (socket) await this.room.message(socket, data);
  }

  async webSocketClose(ws: CfWebSocket): Promise<void> {
    try {
      ws.close(1000, 'bye'); // complete the closing handshake
    } catch {
      // the runtime already did
    }
    const socket = socketOf(ws);
    if (socket) await this.room.closed(socket.conn);
  }

  async webSocketError(ws: CfWebSocket): Promise<void> {
    const socket = socketOf(ws);
    if (socket) await this.room.closed(socket.conn);
  }

  async alarm(): Promise<void> {
    await this.room.alarm();
  }
}
