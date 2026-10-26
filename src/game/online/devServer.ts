/**
 * In-browser room server for development: one GameSession per room on LocalNet (RoomHost), on
 * real timers. Runs inside a SharedWorker (devWorker.ts) so several tabs share the rooms, or in
 * the page itself where SharedWorker is missing (one tab only). No backend needed.
 */
import { GameSession, type SessionOptions } from '../../net';
import { RoomHost, type Sink } from '../../net/loopback';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, type Clock } from '../../net/transport';

const ROOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomString(n: number, alphabet = ROOM_ALPHABET): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export const wallClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class DevServer {
  private readonly rooms = new Map<string, RoomHost>();

  constructor(
    private readonly clock: Clock = wallClock,
    private readonly opts: Partial<SessionOptions> = {},
  ) {}

  create(): { roomId: string; hostToken: string } {
    // Same code format as the Worker (6 symbols, no 0/O/1/I).
    const code = () => randomString(ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET);
    let roomId = code();
    while (this.rooms.has(roomId)) roomId = code();
    const { session, hostToken } = GameSession.create(
      roomId,
      this.clock.now(),
      {
        token: () => randomString(32, `${ROOM_ALPHABET}ABCDEFGHIJKLMNOPQRSTUVWXYZ`),
        seed: () => randomString(10),
      },
      this.opts,
    );
    this.rooms.set(roomId, new RoomHost(session, this.clock));
    return { roomId, hostToken };
  }

  check(roomId: string): { phase: string } | null {
    const room = this.rooms.get(roomId);
    return room ? { phase: room.session.phase } : null;
  }

  /** False if the room does not exist (the caller closes the connection with 4004). */
  attach(roomId: string, conn: string, sink: Sink): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.attach(conn, sink);
    return true;
  }

  frame(roomId: string, conn: string, text: string): void {
    this.rooms.get(roomId)?.frame(conn, text);
  }

  detach(roomId: string, conn: string): void {
    this.rooms.get(roomId)?.detach(conn);
  }

  /** Drop a connection as if the network failed. */
  cut(roomId: string, conn: string): void {
    this.rooms.get(roomId)?.cut(conn);
  }
}
