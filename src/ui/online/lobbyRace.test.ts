// @vitest-environment jsdom
/**
 * The host's lobby screen wired to a real GameSession (LocalNet, fake timers): whatever the host's
 * settings show when they press Start is what the game uses, and a player joining never undoes a
 * host edit (nor a host edit a join). Regression for room 823DDM (Points to win 12 -> game at 10).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ROOM_CONFIG,
  grownConfig,
  type ClientMessage,
  type RoomConfig,
  type RoomInfo,
} from '../../net/protocol';
import { GameSession } from '../../net/session';
import { fakeDeps, LocalNet } from '../../net/testHarness';
import { diffConfig, rebaseConfig, RoomConfigPanel, sameData } from './configPanel';
import { LobbyScreen, type LobbyActions } from './lobby';

type Body = ClientMessage extends infer M
  ? M extends ClientMessage
    ? Omit<M, 'v'>
    : never
  : never;

/**
 * Host + `others` joined. `hostSees` controls delivery to the host's screen: when false, room
 * updates queue up (they are "on the wire") until `deliver()`.
 */
function table(others: string[]) {
  const { session, hostToken } = GameSession.create('R1', 0, fakeDeps(), { botDelayMs: 0 });
  const net = new LocalNet(session, 0);
  net.connect('host');
  net.send('host', { type: 'hello', token: hostToken, name: 'Host' });
  const sent: Body[] = [];
  let hostSees = true;
  let shown = 0;
  const send = (body: Body) => {
    net.now = Date.now();
    sent.push(body);
    net.send('host', body);
    if (hostSees) deliver();
  };
  const actions: LobbyActions = {
    setName: (name) => send({ type: 'setName', name }),
    takeSeat: (seat) => send({ type: 'takeSeat', seat }),
    leaveSeat: () => send({ type: 'leaveSeat' }),
    setColor: (color) => send({ type: 'setColor', color }),
    setBotLevel: (seat, level) => send({ type: 'setBotLevel', seat, level }),
    configure: (config, seats) =>
      send(
        seats === undefined ? { type: 'configure', config } : { type: 'configure', config, seats },
      ),
    start: (config?: RoomConfig) => send(config ? { type: 'start', config } : { type: 'start' }),
    leave: () => undefined,
  };
  const lobby = new LobbyScreen({
    roomId: 'R1',
    inviteUrl: 'https://x/#/room/R1',
    actions,
    chat: document.createElement('div'),
  });
  document.body.append(lobby.element);
  /** Hand the host's screen every room message it has not seen yet (and server errors). */
  function deliver() {
    const box = net.inbox.get('host') ?? [];
    for (; shown < box.length; shown++) {
      const m = box[shown]!;
      if (m.type === 'room') lobby.update(m.room, 'm1');
      if (m.type === 'error') lobby.serverError(m.code, m.ref);
    }
  }
  deliver();
  const join = (name: string) => {
    net.now = Date.now();
    net.connect(name);
    net.send(name, { type: 'hello', token: null, name });
    if (hostSees) deliver();
  };
  for (const n of others) join(n);
  const room = (): RoomInfo => net.last('host', 'room')!.room;
  const game = () => net.last('host', 'game');
  const vpInput = () => lobby.element.querySelector<HTMLInputElement>('input[data-k="vp"]')!;
  const vpShown = () => Number(lobby.element.querySelector('[data-v="vp"]')!.textContent);
  /** Drag the Points to win slider to `v` (one input event). */
  const setVp = (v: number) => {
    const el = vpInput();
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const start = () =>
    lobby.element.querySelector<HTMLButtonElement>('[data-k="lobby-start"]')!.click();
  return {
    net,
    lobby,
    sent,
    join,
    room,
    game,
    setVp,
    vpShown,
    start,
    deliver,
    hold: (on: boolean) => {
      hostSees = !on;
      if (!on) deliver();
    },
  };
}

const vpOfGame = (t: ReturnType<typeof table>) => t.game()?.view.settings.vpToWin;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  document.body.replaceChildren();
});
afterEach(() => vi.useRealTimers());

describe('lobby: the host edit reaches the game (823DDM)', () => {
  it('Start pressed during the debounce uses the value on screen', () => {
    const t = table(['B', 'C', 'D']);
    t.setVp(12);
    vi.advanceTimersByTime(50);
    t.start();
    vi.advanceTimersByTime(1000);
    expect(t.room().phase).toBe('playing');
    expect(vpOfGame(t)).toBe(12);
  });

  it('a 5th player joining while the edit is pending keeps both the seat and the 12', () => {
    const t = table(['B', 'C', 'D']);
    t.setVp(12);
    vi.advanceTimersByTime(100);
    t.join('John'); // grows the room to 5 seats (base -> base56), host sees it mid-debounce
    expect(t.room().seats).toHaveLength(5);
    vi.advanceTimersByTime(400);
    expect(t.room().seats).toHaveLength(5);
    expect(t.room().seats[4]!.occupant).not.toBeNull();
    expect(t.room().config.vpToWin).toBe(12);
    expect(t.room().config.map).toBe('base56');
    expect(t.vpShown()).toBe(12);
    vi.advanceTimersByTime(1000);
    t.start();
    expect(vpOfGame(t)).toBe(12);
    expect(t.game()!.view.players).toHaveLength(5);
  });

  it('a join that reaches the server before the host edit (crossed on the wire)', () => {
    const t = table(['B', 'C', 'D']);
    t.hold(true); // the host's screen is behind the server
    t.setVp(12);
    t.join('John');
    vi.advanceTimersByTime(300); // the edit (built on 4 seats) leaves now: refused, seats changed
    expect(t.net.last('host', 'error')?.code).toBe('stale_state');
    t.hold(false); // the host sees the 5th seat and the refusal
    expect(t.vpShown()).toBe(12);
    vi.advanceTimersByTime(300); // sent again on 5 seats
    expect(t.room().seats).toHaveLength(5);
    expect(t.room().seats[4]!.occupant).not.toBeNull();
    expect(t.room().config.vpToWin).toBe(12);
    expect(t.vpShown()).toBe(12);
    t.start();
    expect(vpOfGame(t)).toBe(12);
  });

  it('Start right after a join the host has not seen yet: never a game the screen did not show', () => {
    const t = table(['B', 'C', 'D']);
    t.setVp(12);
    vi.advanceTimersByTime(300);
    t.hold(true);
    t.join('John');
    t.start(); // the host's screen still shows 4 seats: no game the screen did not show
    expect(t.net.last('host', 'error')).toMatchObject({ code: 'stale_state', ref: 'start' });
    t.hold(false);
    expect(t.room().phase).toBe('lobby');
    expect(t.vpShown()).toBe(12);
    vi.advanceTimersByTime(2000);
    t.start(); // they look again and press Start
    expect(vpOfGame(t)).toBe(12);
    expect(t.game()!.view.players).toHaveLength(5);
  });

  it('an edit sent right before Start (no join): one game at the value shown', () => {
    for (const wait of [0, 100, 249, 251, 400, 1500, 3000]) {
      document.body.replaceChildren();
      const t = table(['B', 'C', 'D']);
      t.setVp(11);
      vi.advanceTimersByTime(30);
      t.setVp(12);
      vi.advanceTimersByTime(wait);
      t.start();
      vi.advanceTimersByTime(5000);
      expect(vpOfGame(t), `Start ${wait} ms after the edit`).toBe(12);
      // Nothing is sent after the start.
      const afterStart = t.sent.slice(t.sent.findIndex((b) => b.type === 'start') + 1);
      expect(afterStart).toEqual([]);
    }
  });

  it('Add bot during the debounce keeps the pending edit', () => {
    const t = table(['B']);
    t.setVp(12);
    vi.advanceTimersByTime(50);
    t.lobby.element.querySelector<HTMLButtonElement>('[data-k="add-bot"]')!.click();
    vi.advanceTimersByTime(1000);
    expect(t.room().seats).toHaveLength(5);
    expect(t.room().config.vpToWin).toBe(12);
    expect(t.vpShown()).toBe(12);
  });

  it('a rate-limited edit is sent again instead of being lost', () => {
    const t = table(['B', 'C', 'D']);
    // Burn the host's lobby budget (burst 10).
    for (let i = 0; i < 12; i++)
      t.net.send('host', { type: 'setBotLevel', seat: 3, level: 'easy' });
    t.deliver();
    t.setVp(12);
    vi.advanceTimersByTime(300);
    expect(t.vpShown()).toBe(12);
    vi.advanceTimersByTime(5000);
    expect(t.room().config.vpToWin).toBe(12);
    t.start();
    expect(vpOfGame(t)).toBe(12);
  });

  it('leaving the lobby screen sends the pending edit', () => {
    const t = table(['B']);
    t.setVp(13);
    t.lobby.destroy();
    vi.advanceTimersByTime(1000);
    expect(t.room().config.vpToWin).toBe(13);
  });
});

describe('RoomConfigPanel: host edits over room updates', () => {
  const base = { ...DEFAULT_ROOM_CONFIG, turnTimerSec: 60 };
  const grown = grownConfig(base)!;

  function panel() {
    const sent: { config: RoomConfig; seats: number }[] = [];
    const p = new RoomConfigPanel({
      config: base,
      editable: true,
      onChange: (config, seats) => sent.push({ config, seats }),
      debounceMs: 250,
      retryMs: 1000,
    });
    document.body.append(p.element);
    const setVp = (v: number) => {
      const el = p.element.querySelector<HTMLInputElement>('input[data-k="vp"]')!;
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const vpShown = () => Number(p.element.querySelector('[data-v="vp"]')!.textContent);
    return { p, sent, setVp, vpShown };
  }

  it('diff and rebase: the host fields win, the seats (and board) follow the server', () => {
    const patch = diffConfig(base, { ...base, vpToWin: 12 });
    expect(patch).toEqual({ vpToWin: 12 });
    expect(rebaseConfig(patch, grown)).toEqual({ ...grown, vpToWin: 12 });
    // The host picked the 3-4 player board, then a 5th seat came: the board follows the seats.
    const board = rebaseConfig({ map: 'base' }, { ...grown, map: 'base56' });
    expect(board).toMatchObject({ map: 'base56', seatCount: 5 });
    // Removed keys stay removed.
    const withV = { ...base, variants: { rushMode: true } };
    expect(rebaseConfig(diffConfig(withV, base), withV)).toEqual(base);
    expect(sameData({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(sameData({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('a room update during the debounce: shown and sent on the new seats', () => {
    const { p, sent, setVp, vpShown } = panel();
    setVp(12);
    vi.advanceTimersByTime(100);
    p.update(grown, true); // a 5th player joined
    expect(vpShown()).toBe(12);
    expect(p.current()).toEqual({ ...grown, vpToWin: 12 });
    vi.advanceTimersByTime(250);
    expect(sent).toEqual([{ config: { ...grown, vpToWin: 12 }, seats: 5 }]);
    p.update({ ...grown, vpToWin: 12 }, true); // the echo
    expect(p.unconfirmed).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(1);
  });

  it('a stale echo does not undo the edit; an unconfirmed edit is sent again', () => {
    const { p, sent, setVp, vpShown } = panel();
    setVp(12);
    vi.advanceTimersByTime(300);
    expect(sent).toHaveLength(1);
    p.update({ ...base }, true); // an older room update (e.g. a name change) still at 10
    expect(vpShown()).toBe(12);
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(2);
    p.update({ ...base, vpToWin: 12 }, true);
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(2);
  });

  it('refusals: too fast and stale seats retry, a bad config reverts to the server', () => {
    const { p, sent, setVp, vpShown } = panel();
    setVp(12);
    vi.advanceTimersByTime(300);
    p.serverError('rate_limited', 'configure');
    vi.advanceTimersByTime(999);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(2);
    p.serverError('stale_state', 'configure');
    vi.advanceTimersByTime(250);
    expect(sent).toHaveLength(3);
    p.serverError('bad_config', 'configure');
    expect(vpShown()).toBe(10);
    expect(p.unconfirmed).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(3);
  });

  it('gives up after a few unanswered sends and shows the room', () => {
    const { p, sent, setVp, vpShown } = panel();
    setVp(12);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1000);
      p.update({ ...base }, true);
    }
    expect(sent.length).toBeLessThanOrEqual(6);
    expect(vpShown()).toBe(10);
    expect(p.unconfirmed).toBe(false);
  });

  it('Start and seat buttons take the pending edit with them; losing the host role drops it', () => {
    const { p, sent, setVp } = panel();
    setVp(12);
    expect(p.takeForStart()).toEqual({ ...base, vpToWin: 12 });
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
    setVp(13);
    expect(p.withSeats(5)).toMatchObject({ seatCount: 5, map: 'base56', vpToWin: 13 });
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
    setVp(14);
    p.update(base, false);
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
    expect(p.element.querySelector('[data-v="vp"]')!.textContent).toBe('10');
  });
});
