/** Messages between a tab and the dev-server SharedWorker (devWorker.ts / devBackend.ts). */

export type TabToWorker =
  | { t: 'create'; id: number }
  | { t: 'check'; id: number; room: string }
  | { t: 'open'; room: string; conn: string }
  | { t: 'send'; conn: string; text: string }
  | { t: 'close'; conn: string };

export type WorkerToTab =
  | { t: 'reply'; id: number; result: unknown }
  | { t: 'msg'; conn: string; text: string }
  | { t: 'closed'; conn: string; code: number; reason: string };

/** The client pings every 25 s; a connection silent for this long belongs to a dead tab. */
export const DEV_IDLE_MS = 70_000;
