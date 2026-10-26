/**
 * Tab side of the dev server: talks to the SharedWorker (devWorker.ts) so tabs share rooms. Where
 * SharedWorker is missing (e.g. Chrome on Android), the DevServer runs in this page instead and
 * only this tab can join.
 */
import type { Connect, RoomApi, Sink } from '../../net';
import type { Backend } from './backend';
import { DevServer } from './devServer';
import type { TabToWorker, WorkerToTab } from './devWire';

function sinkConnect(
  open: (
    conn: string,
    sink: Sink,
  ) => {
    send(text: string): void;
    close(): void;
  },
): Connect {
  return (h) => {
    const conn = crypto.randomUUID();
    let closed = false;
    const link = open(conn, {
      message: (text) => {
        if (!closed) h.onMessage(text);
      },
      close: (code, reason) => {
        if (closed) return;
        closed = true;
        h.onClose(code, reason);
      },
    });
    setTimeout(() => {
      if (!closed) h.onOpen();
    }, 0);
    return {
      send: (text) => {
        if (!closed) link.send(text);
      },
      close: () => {
        if (closed) return;
        link.close();
        closed = true;
        setTimeout(() => h.onClose(1000, 'closed'), 0);
      },
    };
  };
}

function inPageBackend(): Backend {
  const server = new DevServer();
  const api: RoomApi = {
    create: () => Promise.resolve(server.create()),
    check: (roomId) => Promise.resolve(server.check(roomId)),
  };
  return {
    kind: 'local',
    api,
    connect: (roomId) =>
      sinkConnect((conn, sink) => {
        if (!server.attach(roomId, conn, sink)) {
          setTimeout(() => sink.close(4004, 'no such room'), 0);
        }
        return {
          send: (text) => server.frame(roomId, conn, text),
          close: () => server.detach(roomId, conn),
        };
      }),
  };
}

function workerBackend(): Backend {
  const worker = new SharedWorker(new URL('./devWorker.ts', import.meta.url), {
    type: 'module',
    name: 'windamere-dev-server',
  });
  const port = worker.port;
  const sinks = new Map<string, Sink>();
  const replies = new Map<number, (v: unknown) => void>();
  let nextId = 0;
  const post = (m: TabToWorker) => port.postMessage(m);
  port.onmessage = (e: MessageEvent<WorkerToTab>) => {
    const m = e.data;
    if (m.t === 'reply') {
      replies.get(m.id)?.(m.result);
      replies.delete(m.id);
    } else if (m.t === 'msg') {
      sinks.get(m.conn)?.message(m.text);
    } else {
      const sink = sinks.get(m.conn);
      sinks.delete(m.conn);
      sink?.close(m.code, m.reason);
    }
  };
  port.start();
  // Tell the worker this tab's sockets are gone (it cannot see tabs close).
  addEventListener('pagehide', () => {
    for (const conn of sinks.keys()) post({ t: 'close', conn });
    sinks.clear();
  });
  const call = <T>(m: (id: number) => TabToWorker): Promise<T> =>
    new Promise((resolve) => {
      const id = ++nextId;
      replies.set(id, (v) => resolve(v as T));
      post(m(id));
    });
  return {
    kind: 'local',
    api: {
      create: () => call((id) => ({ t: 'create', id })),
      check: (room) => call((id) => ({ t: 'check', id, room })),
    },
    connect: (room) =>
      sinkConnect((conn, sink) => {
        sinks.set(conn, sink);
        post({ t: 'open', room, conn });
        return {
          send: (text) => post({ t: 'send', conn, text }),
          close: () => {
            sinks.delete(conn);
            post({ t: 'close', conn });
          },
        };
      }),
  };
}

let shared: Backend | null = null;

export function localBackend(): Backend {
  shared ??= typeof SharedWorker === 'function' ? workerBackend() : inPageBackend();
  return shared;
}
