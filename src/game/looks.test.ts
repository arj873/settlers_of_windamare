/** PR1: seat looks (picture + piece style) through the hotseat controller, saves and online seats. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_CONFIG, type RoomInfo } from '../net/protocol';
import { buildConfig, defaultSetup, sanitizeSetup } from '../ui/setup/model';
import type { SeatLook } from '../ui/profile/model';
import { GameController, type BoardLike, type HudLike } from './controller';
import { roomLooks } from './online/netController';
import { loadSession, type KeyValueStore } from './persist';

const board: BoardLike = {
  render: () => undefined,
  setHighlights: () => undefined,
  on: () => () => undefined,
};
const hud: HudLike = {
  render: () => undefined,
  on: () => undefined,
  isCovered: () => false,
  setTurnTimer: () => undefined,
};

function memStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

function setupWithLooks() {
  const d = defaultSetup(4);
  d.seats[0] = { ...d.seats[0]!, avatar: 'fox', pieceStyle: 'keep' };
  d.seats[2] = { ...d.seats[2]!, pieceStyle: 'pagoda' };
  return d;
}

describe('hotseat looks', () => {
  it('setup seats -> config -> controller -> board/HUD sink, and into the save', () => {
    const cfg = buildConfig(setupWithLooks());
    expect(cfg.players[0]).toMatchObject({ avatar: 'fox', pieceStyle: 'keep' });
    expect(cfg.players[1]).not.toHaveProperty('avatar');
    const seen: (readonly SeatLook[])[] = [];
    const storage = memStore();
    const c = new GameController({ board, hud, storage, speed: 0, onLooks: (l) => seen.push(l) });
    c.newGame({ ...cfg, seed: 'looks' });
    expect(seen.at(-1)).toEqual([
      { avatar: 'fox', pieceStyle: 'keep' },
      {},
      { pieceStyle: 'pagoda' },
      {},
    ]);
    const saved = loadSession(storage);
    expect(saved?.looks?.[0]).toEqual({ avatar: 'fox', pieceStyle: 'keep' });
    // Resume restores them.
    const seen2: (readonly SeatLook[])[] = [];
    const c2 = new GameController({ board, hud, speed: 0, onLooks: (l) => seen2.push(l) });
    c2.resume(saved!);
    expect(seen2.at(-1)?.[2]).toEqual({ pieceStyle: 'pagoda' });
    c.destroy();
    c2.destroy();
  });

  it('looks follow the players when the turn order is shuffled', () => {
    const cfg = buildConfig(setupWithLooks());
    let looks: readonly SeatLook[] = [];
    const c = new GameController({ board, hud, speed: 0, onLooks: (l) => (looks = l) });
    c.newGame({ ...cfg, seed: 'shuffle-7', variants: { randomTurnOrder: true } });
    const order = c.state!.settings.seatOrder!;
    order.forEach((from, seat) => {
      const want = cfg.players[from]!;
      expect(looks[seat]?.pieceStyle).toBe(want.pieceStyle);
      expect(c.state!.players[seat]!.name).toBe(want.name);
    });
    c.destroy();
  });

  it('a saved setup keeps valid looks only', () => {
    const d = sanitizeSetup({
      seats: [
        { name: 'A', color: '#d64541', controller: 'human', avatar: 'owl', pieceStyle: 'adobe' },
        { name: 'B', color: '#3a7bd5', controller: 'bot', avatar: 'http://x', pieceStyle: 'nope' },
        { name: 'C', color: '#ecf0f1', controller: 'bot' },
      ],
    });
    expect(d.seats[0]).toMatchObject({ avatar: 'owl', pieceStyle: 'adobe' });
    expect(d.seats[1]).not.toHaveProperty('avatar');
    expect(d.seats[1]).not.toHaveProperty('pieceStyle');
  });
});

describe('online looks', () => {
  it('each seat wears its occupant profile; open seats none', () => {
    const room: RoomInfo = {
      id: 'R',
      phase: 'playing',
      host: 'm1',
      config: DEFAULT_ROOM_CONFIG,
      seats: [0, 1, 2].map((index) => ({
        index,
        color: '#d64541',
        occupant: index === 0 ? 'm2' : index === 1 ? 'm1' : null,
        status: index < 2 ? 'human' : 'bot',
      })),
      members: [
        { id: 'm1', name: 'A', connected: true, seat: 1, avatar: 'img:m1.1', pieceStyle: 'timber' },
        { id: 'm2', name: 'B', connected: true, seat: 0, avatar: 'wolf' },
      ],
    };
    const pics: Record<string, string> = { m1: 'data:image/png;base64,iVBORw0KGgo=', m2: 'wolf' };
    expect(roomLooks(room, (m) => pics[m] ?? null, 3)).toEqual([
      { avatar: 'wolf' },
      { avatar: pics.m1, pieceStyle: 'timber' },
      {},
    ]);
    expect(roomLooks(null, () => null, 2)).toEqual([{}, {}]);
  });
});
