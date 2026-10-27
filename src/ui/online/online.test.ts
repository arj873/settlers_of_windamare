// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { viewFor } from '../../engine';
import { discardGame, midGame } from '../../engine/fixtures';
import { DEFAULT_ROOM_CONFIG, roomConfigError, type RoomInfo } from '../../net/protocol';
import { Hud } from '../hud';
import { ChatPanel } from './chat';
import { configOf, draftOf, RoomConfigPanel, withSeatCount } from './configPanel';
import { HomeScreen } from './home';
import { LobbyScreen, type LobbyActions } from './lobby';
import { configSummary, inviteUrl, lobbyView, seatRange } from './lobbyModel';

const COLORS = ['#d64541', '#3a7bd5', '#ecf0f1', '#f39c12'];

function room(over: Partial<RoomInfo> = {}): RoomInfo {
  return {
    id: 'K3J9QX',
    phase: 'lobby',
    host: 'm1',
    config: DEFAULT_ROOM_CONFIG,
    seats: COLORS.map((color, index) => ({
      index,
      color,
      occupant: index === 0 ? 'm1' : index === 1 ? 'm2' : null,
      status: index < 2 ? 'human' : 'bot',
    })),
    members: [
      { id: 'm1', name: 'Ann', connected: true, seat: 0 },
      { id: 'm2', name: 'Bob', connected: false, seat: 1 },
      { id: 'm3', name: 'Eve', connected: true, seat: null },
    ],
    ...over,
  };
}

beforeEach(() => document.body.replaceChildren());

describe('lobbyView', () => {
  it('host: seats, remove on the last open seat only, add seat, start', () => {
    const v = lobbyView(room(), 'm1');
    expect(v.isHost).toBe(true);
    expect(v.seats.map((s) => s.name)).toEqual(['Ann', 'Bob', null, null]);
    expect(v.seats[1]!.isAway).toBe(true);
    expect(v.seats.map((s) => s.canRemove)).toEqual([false, false, false, true]);
    expect(v.seats.map((s) => s.canSit)).toEqual([false, false, true, true]);
    expect(v.seats[0]!.isMine && v.seats[0]!.canStand).toBe(true);
    // Own seat: own colour + the two free ones.
    expect(v.seats[0]!.colors).toEqual(['#d64541', '#3fae6a', '#9b59b6', '#9c6b43', '#ec7fb5']);
    expect(v.seats[0]!.colors).not.toContain('#3a7bd5');
    expect(v.canAddSeat).toBe(true);
    expect(v.startBlocked).toBeNull();
    expect(v.spectators.map((m) => m.name)).toEqual(['Eve']);
  });

  it('no removing below the map minimum; guests cannot start', () => {
    const three = room({
      config: { ...DEFAULT_ROOM_CONFIG, seatCount: 3 },
      seats: room().seats.slice(0, 3),
    });
    expect(lobbyView(three, 'm1').seats.some((s) => s.canRemove)).toBe(false);
    const guest = lobbyView(room(), 'm3');
    expect(guest.isHost).toBe(false);
    expect(guest.startBlocked).toBe('Only the host can start');
    expect(guest.seats.every((s) => !s.canRemove)).toBe(true);
    expect(guest.hostName).toBe('Ann');
  });

  it('start needs someone seated; no nickname, no sitting', () => {
    const empty = room({
      seats: room().seats.map((s) => ({ ...s, occupant: null, status: 'bot' as const })),
      members: [{ id: 'm1', name: '', connected: true, seat: null }],
    });
    const v = lobbyView(empty, 'm1');
    expect(v.startBlocked).toMatch(/take a seat/);
    expect(v.seats.every((s) => !s.canSit)).toBe(true);
  });

  it('summary and invite link', () => {
    expect(configSummary({ ...DEFAULT_ROOM_CONFIG, turnTimerSec: 120 })).toBe(
      'Base Random · 4 seats · 10 VP · 2 min timer',
    );
    expect(inviteUrl('http://h:5173/?foo=1#x', 'K3J9QX')).toBe('http://h:5173/?room=K3J9QX');
    expect(inviteUrl('http://h/app/?server=local', 'K3J9QX')).toBe(
      'http://h/app/?room=K3J9QX&server=local',
    );
  });
});

describe('config bridge (wrapped setup screen)', () => {
  it('round-trips a room config through the setup draft', () => {
    const cfg = { ...DEFAULT_ROOM_CONFIG, turnTimerSec: 60, vpToWin: 12, discardLimit: 9 };
    expect(configOf(draftOf(cfg))).toEqual(cfg);
    const rules = { ...cfg, rules: { balancedDice: true, hideBankCards: true } };
    expect(configOf(draftOf(rules))).toEqual(rules);
  });

  it('round-trips expansion modes, scenarios, options and variants', () => {
    const ck = {
      ...DEFAULT_ROOM_CONFIG,
      mode: 'ck',
      scenario: 'ck/starter',
      options: { ck: { easyStart: true, knightErrant: false } },
      vpToWin: 13,
    };
    expect(configOf(draftOf(ck))).toEqual(ck);
    const sea = {
      ...DEFAULT_ROOM_CONFIG,
      mode: 'seafarers',
      scenario: 'seafarers/fogIslands',
      // The (unused) base map follows the seat count, like on the setup screen.
      map: 'base56' as const,
      seatCount: 5,
      vpToWin: 12,
      options: configOf(draftOf({ ...DEFAULT_ROOM_CONFIG, mode: 'seafarers' })).options,
    };
    expect(configOf(draftOf(sea))).toEqual(sea);
    const variants = {
      ...DEFAULT_ROOM_CONFIG,
      turnTimerSec: null,
      variants: {
        robberMode: 'friendly' as const,
        eventCards: true,
        rushMode: true,
        mapRules: { allowRedTouch: true },
        timer: { preset: 'custom' as const, bankSec: 600, incrementSec: 5 },
      },
    };
    expect(configOf(draftOf(variants))).toEqual(variants);
    // Every round-tripped config passes the server's checks.
    for (const c of [ck, sea, variants]) expect(roomConfigError(configOf(draftOf(c)))).toBeNull();
  });

  it('expansion seat ranges and summary come from the mode and scenario', () => {
    expect(seatRange({ ...DEFAULT_ROOM_CONFIG, mode: 'ck' })).toEqual({ min: 3, max: 6 });
    expect(seatRange(DEFAULT_ROOM_CONFIG)).toEqual({ min: 3, max: 8 });
    const sea = { ...DEFAULT_ROOM_CONFIG, mode: 'seafarers', scenario: 'seafarers/fogIslands' };
    expect(configSummary(sea)).toMatch(/^Seafarers: The Fog Islands · 4 seats/);
    expect(withSeatCount({ ...DEFAULT_ROOM_CONFIG, mode: 'ck' }, 9).seatCount).toBe(6);
  });

  it('a 5th seat switches to the 5-6 player map, like the setup screen', () => {
    const five = withSeatCount(DEFAULT_ROOM_CONFIG, 5);
    expect(five.seatCount).toBe(5);
    expect(five.map).toBe('base56');
    expect(withSeatCount(five, 4).seatCount).toBe(4);
  });

  it('host edits in the setup screen become configure calls; guests are read-only', async () => {
    const sent: unknown[] = [];
    const panel = new RoomConfigPanel({
      config: DEFAULT_ROOM_CONFIG,
      editable: true,
      onChange: (c) => sent.push(c),
      debounceMs: 0,
    });
    document.body.append(panel.element);
    const balanced = panel.element.querySelector<HTMLButtonElement>(
      '[data-k="rule-balancedDice"]',
    )!;
    balanced.click();
    await new Promise((r) => setTimeout(r, 5));
    expect(sent).toEqual([
      { ...DEFAULT_ROOM_CONFIG, rules: { balancedDice: true, hideBankCards: false } },
    ]);
    // The seats section and footer of the setup screen are hidden by CSS, not removed.
    expect(panel.element.querySelector('[data-k="start"]')).not.toBeNull();

    panel.update(DEFAULT_ROOM_CONFIG, false);
    expect(panel.element.hasAttribute('inert')).toBe(true);
    expect(panel.element.classList.contains('is-readonly')).toBe(true);
    panel.element.querySelector<HTMLButtonElement>('[data-k="timer-inc"]')!.click();
    await new Promise((r) => setTimeout(r, 5));
    expect(sent).toHaveLength(1);
    // A guest sees the host's change.
    panel.update({ ...DEFAULT_ROOM_CONFIG, vpToWin: 14 }, false);
    expect(panel.element.querySelector('[data-v="vp"]')!.textContent).toBe('14');
  });
});

function actionsLog() {
  const log: string[] = [];
  const actions: LobbyActions = {
    setName: (n) => log.push(`name:${n}`),
    takeSeat: (s) => log.push(`sit:${s}`),
    leaveSeat: () => log.push('stand'),
    setColor: (c) => log.push(`color:${c}`),
    setBotLevel: (seat, level) => log.push(`level:${seat}:${level}`),
    configure: (c) => log.push(`seats:${c.seatCount}`),
    start: () => log.push('start'),
    leave: () => log.push('leave'),
  };
  return { log, actions };
}

describe('LobbyScreen', () => {
  const click = (root: HTMLElement, k: string) =>
    root.querySelector<HTMLButtonElement>(`[data-k="${k}"]`)!.click();

  it('host view: invite link, seats, add/remove bot, start', () => {
    const { log, actions } = actionsLog();
    const lobby = new LobbyScreen({
      roomId: 'K3J9QX',
      inviteUrl: 'http://x/?room=K3J9QX',
      actions,
      chat: document.createElement('div'),
      copy: () => Promise.resolve(),
    });
    document.body.append(lobby.element);
    lobby.update(room(), 'm1');
    const el = lobby.element;
    expect(el.querySelector<HTMLInputElement>('[data-k="invite"]')!.value).toBe(
      'http://x/?room=K3J9QX',
    );
    expect(el.querySelectorAll('.ol-seat[data-seat]')).toHaveLength(4);
    expect(el.textContent).toContain('Orange Bot');
    expect(el.querySelector('.ol-seat[data-seat="1"]')!.classList.contains('is-away')).toBe(true);
    click(el, 'add-bot');
    click(el, 'remove-bot');
    click(el, 'stand');
    click(el, 'lobby-start');
    expect(log).toEqual(['seats:5', 'seats:3', 'stand', 'start']);
    expect(el.querySelector('.ol-config')!.hasAttribute('inert')).toBe(false);
  });

  it('guest view: sit, nickname, waiting for host, settings read-only', () => {
    const { log, actions } = actionsLog();
    const lobby = new LobbyScreen({
      roomId: 'K3J9QX',
      inviteUrl: 'http://x/?room=K3J9QX',
      actions,
      chat: document.createElement('div'),
    });
    document.body.append(lobby.element);
    lobby.update(room(), 'm3');
    const el = lobby.element;
    expect(el.querySelector('[data-k="lobby-start"]')).toBeNull();
    expect(el.textContent).toContain('Waiting for Ann to start');
    expect(el.querySelector('.ol-config')!.hasAttribute('inert')).toBe(true);
    expect(el.querySelector('[data-k="add-bot"]')).toBeNull();
    click(el, 'sit-2');
    const name = el.querySelector<HTMLInputElement>('[data-k="nickname"]')!;
    expect(name.value).toBe('Eve');
    name.value = 'Evie';
    name.dispatchEvent(new Event('change'));
    expect(log).toEqual(['sit:2', 'name:Evie']);
  });
});

describe('ChatPanel', () => {
  it('renders entries as text, sends on Enter, dedupes by id', () => {
    const sent: string[] = [];
    const chat = new ChatPanel({
      send: (t) => (sent.push(t), true),
      react: () => true,
      colorOf: (e) => (e.seat === 0 ? '#d64541' : null),
    });
    document.body.append(chat.element);
    chat.setEntries([
      { id: 1, at: 0, from: null, name: '', seat: null, text: 'Ann joined the room' },
    ]);
    const evil = {
      id: 2,
      at: 0,
      from: 'm1',
      name: 'Ann',
      seat: 0,
      text: '<img src=x onerror=alert(1)>',
    };
    chat.add(evil);
    chat.add(evil);
    const rows = chat.element.querySelectorAll('.chat-row');
    expect(rows).toHaveLength(2);
    expect(rows[1]!.querySelector('img')).toBeNull();
    expect(rows[1]!.textContent).toContain('<img');
    const input = chat.element.querySelector<HTMLInputElement>('.chat-input')!;
    input.value = '  hello ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(sent).toEqual(['hello']);
    expect(input.value).toBe('');
    chat.setEnabled(false, 'Pick a nickname to chat.');
    expect(input.disabled).toBe(true);
    expect(chat.element.textContent).toContain('Pick a nickname');
  });
});

describe('HomeScreen', () => {
  it('needs a nickname; joins a typed code or link', async () => {
    const calls: string[] = [];
    const home = new HomeScreen({
      name: '',
      onOffline: () => calls.push('offline'),
      onCreate: (n) => (calls.push(`create:${n}`), Promise.resolve()),
      onJoin: (c, n) => (calls.push(`join:${c}:${n}`), Promise.resolve()),
    });
    document.body.append(home.element);
    const el = home.element;
    const k = (s: string) => el.querySelector<HTMLElement>(`[data-k="${s}"]`)!;
    (k('create') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(el.textContent).toContain('Pick a nickname first');
    (k('nickname') as HTMLInputElement).value = 'Ann';
    (k('code') as HTMLInputElement).value = 'http://x/?room=k3j9qx';
    (k('join') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    (k('offline') as HTMLButtonElement).click();
    expect(calls).toEqual(['join:K3J9QX:Ann', 'offline']);
  });

  it('shows server failures inline', async () => {
    const home = new HomeScreen({
      name: 'Ann',
      onOffline: () => undefined,
      onCreate: () => Promise.reject(new Error('Could not create a room (HTTP 503)')),
      onJoin: () => Promise.resolve(),
    });
    document.body.append(home.element);
    home.element.querySelector<HTMLButtonElement>('[data-k="create"]')!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(home.element.querySelector('.ol-error')!.textContent).toContain('HTTP 503');
  });
});

describe('Hud online bits', () => {
  let root: HTMLElement;
  let hud: Hud;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    hud = new Hud(root);
  });

  it('spectator: no hand bar, no buttons, no dialogs, a Spectating pill', () => {
    const s = viewFor(discardGame(), 'spectator');
    hud.render(s, { viewer: -1, legal: [], isBotTurn: false, spectator: true });
    // No hand; only the read-only price list (#35), every card disabled.
    const bottom = root.querySelector('.hud-bottom')!;
    expect(bottom.querySelector('.hand')).toBeNull();
    expect([...bottom.children].map((c) => c.className)).toEqual(['build-bar wood is-costs']);
    expect(bottom.querySelectorAll('button:not([disabled])')).toHaveLength(0);
    expect(root.querySelector('.btn-roll')).toBeNull();
    expect(root.querySelector('.hud-dialog-layer')!.childElementCount).toBe(0);
    expect(root.querySelector('.spectate-pill')!.textContent).toContain('Spectating');
    expect(root.querySelector('.dice')).not.toBeNull();
    expect(root.textContent).not.toContain('Your turn');
  });

  it('away players get an icon; session actions replace New game; chat section persists', () => {
    const s = midGame();
    const left: string[] = [];
    hud.setSessionActions([{ label: 'Leave room', onClick: () => left.push('x') }]);
    const panel = document.createElement('div');
    const input = document.createElement('input');
    panel.append(input);
    hud.setChat(panel);
    hud.render(s, { viewer: 0, legal: [], isBotTurn: false, away: [false, true, false, false] });
    const bars = root.querySelectorAll('.pp');
    expect(bars[1]!.classList.contains('is-away')).toBe(true);
    expect(bars[1]!.querySelector('.pp-away')).not.toBeNull();
    expect(bars[0]!.querySelector('.pp-away')).toBeNull();
    root.querySelector<HTMLButtonElement>('.menu-btn')!.click();
    const items = [...root.querySelectorAll('.menu-item')].map((b) => b.textContent);
    expect(items).toContain('Leave room');
    expect(items).not.toContain('New game');
    [...root.querySelectorAll<HTMLButtonElement>('.menu-item')]
      .find((b) => b.textContent === 'Leave room')!
      .click();
    expect(left).toEqual(['x']);
    // Re-rendering keeps the same chat node (typing survives).
    hud.render(s, { viewer: 0, legal: [], isBotTurn: false });
    expect(root.querySelector('.sec-chat input')).toBe(input);
  });
});
