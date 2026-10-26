// @vitest-environment jsdom
/** B1: the bot difficulty picker on the setup screen and in the online lobby. */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_CONFIG, type RoomInfo } from '../net/protocol';
import { botLevelSelect } from './botLevel';
import { LobbyScreen, type LobbyActions } from './online/lobby';
import { lobbyView } from './online/lobbyModel';
import { buildConfig, defaultSetup, sanitizeSetup, type SetupStorage } from './setup/model';
import { SetupScreen } from './setup/screen';
import type { NewGameConfig } from './types';

class MemoryStorage implements SetupStorage {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

const choose = (sel: HTMLSelectElement, value: string) => {
  sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => document.body.replaceChildren());

describe('botLevelSelect', () => {
  it('lists Easy / Normal / Hard, defaults to Normal and reports a change', () => {
    const got: string[] = [];
    const sel = botLevelSelect(undefined, { seat: 2 }, (l) => got.push(l));
    expect([...sel.options].map((o) => [o.value, o.textContent])).toEqual([
      ['easy', 'Easy'],
      ['normal', 'Normal'],
      ['hard', 'Hard'],
    ]);
    expect(sel.value).toBe('normal');
    expect(sel.getAttribute('aria-label')).toBe('Seat 3 bot difficulty');
    choose(sel, 'hard');
    expect(got).toEqual(['hard']);
  });

  it('hidden: keeps its slot, disabled and out of the tab order', () => {
    const sel = botLevelSelect('easy', { seat: 0, hidden: true }, () => undefined);
    expect(sel.classList.contains('is-hidden')).toBe(true);
    expect(sel.disabled).toBe(true);
    expect(sel.getAttribute('tabindex')).toBe('-1');
  });
});

describe('setup screen: bot difficulty per seat', () => {
  it('a picker on every bot seat; the pick reaches the game config and is remembered', () => {
    const storage = new MemoryStorage();
    const started: NewGameConfig[] = [];
    const screen = new SetupScreen({ onStart: (c) => started.push(c), storage });
    document.body.append(screen.element);
    const sel = (i: number) =>
      screen.element.querySelector<HTMLSelectElement>(`[data-k="level-${i}"]`)!;
    expect(sel(0).disabled).toBe(true); // "You" is human
    expect([1, 2, 3].map((i) => sel(i).disabled)).toEqual([false, false, false]);
    expect(sel(1).value).toBe('normal');
    choose(sel(2), 'hard');
    choose(sel(3), 'easy');
    screen.element.querySelector<HTMLButtonElement>('[data-k="start"]')!.click();
    expect(started[0]!.players.map((p) => p.botLevel)).toEqual([
      undefined,
      undefined,
      'hard',
      'easy',
    ]);
    const again = new SetupScreen({ onStart: () => undefined, storage });
    expect(again.state.seats.map((s) => s.botLevel)).toEqual([
      undefined,
      undefined,
      'hard',
      'easy',
    ]);
  });

  it('a human seat sends no level; stored garbage falls back to the default', () => {
    const d = defaultSetup();
    d.seats[1] = { ...d.seats[1]!, controller: 'human', botLevel: 'hard' };
    expect(buildConfig(d).players[1]).not.toHaveProperty('botLevel');
    const raw = JSON.parse(JSON.stringify(defaultSetup())) as { seats: Record<string, unknown>[] };
    raw.seats[1]!['botLevel'] = 'expert';
    raw.seats[2]!['botLevel'] = 'easy';
    const s = sanitizeSetup(raw);
    expect(s.seats[1]!.botLevel).toBeUndefined();
    expect(s.seats[2]!.botLevel).toBe('easy');
  });
});

describe('lobby: bot difficulty per open seat', () => {
  function room(): RoomInfo {
    return {
      id: 'K3J9QX',
      phase: 'lobby',
      host: 'm1',
      config: DEFAULT_ROOM_CONFIG,
      seats: ['#d64541', '#3a7bd5', '#ecf0f1', '#f39c12'].map((color, index) => ({
        index,
        color,
        occupant: index === 0 ? 'm1' : null,
        status: index === 0 ? 'human' : 'bot',
        ...(index === 3 ? { botLevel: 'hard' as const } : {}),
      })),
      members: [
        { id: 'm1', name: 'Ann', connected: true, seat: 0 },
        { id: 'm2', name: 'Eve', connected: true, seat: null },
      ],
    };
  }

  it('the host picks a level on open seats; everyone sees it', () => {
    const v = lobbyView(room(), 'm1');
    expect(v.seats.map((s) => [s.botLevel, s.canSetLevel])).toEqual([
      ['normal', false],
      ['normal', true],
      ['normal', true],
      ['hard', true],
    ]);
    expect(lobbyView(room(), 'm2').seats.some((s) => s.canSetLevel)).toBe(false);

    const log: string[] = [];
    const actions = {
      setBotLevel: (seat: number, level: string) => log.push(`${seat}:${level}`),
    } as unknown as LobbyActions;
    const host = new LobbyScreen({
      roomId: 'K3J9QX',
      inviteUrl: 'http://x/?room=K3J9QX',
      actions,
      chat: document.createElement('div'),
    });
    host.update(room(), 'm1');
    const sel = host.element.querySelector<HTMLSelectElement>('[data-k="seat-level-3"]')!;
    expect(sel.value).toBe('hard');
    choose(sel, 'easy');
    expect(log).toEqual(['3:easy']);
    expect(host.element.querySelector('[data-k="seat-level-0"]')).toBeNull();

    const guest = new LobbyScreen({
      roomId: 'K3J9QX',
      inviteUrl: 'http://x/?room=K3J9QX',
      actions,
      chat: document.createElement('div'),
    });
    guest.update(room(), 'm2');
    expect(guest.element.querySelector('[data-k^="seat-level-"]')).toBeNull();
    expect(guest.element.textContent).toContain('Open — a Hard bot plays it');
  });
});
