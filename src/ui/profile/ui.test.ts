// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_CONFIG, type RoomInfo } from '../../net/protocol';
import { ChatPanel } from '../online/chat';
import { HomeScreen } from '../online/home';
import { LobbyScreen, type LobbyActions } from '../online/lobby';
import { avatar } from '../widgets';
import { openProfileDialog, setStylePreview } from './dialog';
import { setSeatLooks } from './looks';
import { EMPTY_PROFILE, type Profile } from './model';
import { seatLookButton, withProfileLook, type SeatLookDraft } from './seatLook';
import { CENTER_CROP, cropRect, encodeAvatar, panCrop } from './upload';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const flush = () => new Promise((r) => setTimeout(r, 0));
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel) as T;

beforeEach(() => {
  document.body.replaceChildren();
  setStylePreview(() => Promise.resolve(PNG));
});
afterEach(() => {
  setSeatLooks([]);
  setStylePreview(null);
});

describe('avatar() with seat looks', () => {
  it('shows the seat picture with the colour ring; bots keep the bot', () => {
    setSeatLooks([{ avatar: 'fox' }, { avatar: PNG }, {}]);
    const fox = avatar({ id: 0, name: 'Ann', color: '#d64541' }, false, 34);
    expect(fox.classList.contains('has-pic')).toBe(true);
    expect(fox.querySelector('.avatar-pic svg')).not.toBeNull();
    expect(fox.style.getPropertyValue('--pc')).toBe('#d64541');
    const up = avatar({ id: 1, name: 'Bob', color: '#3a7bd5' }, false, 34);
    expect(up.querySelector<HTMLImageElement>('img.avatar-pic')!.src).toBe(PNG);
    const none = avatar({ id: 2, name: 'Cy', color: '#ecf0f1' }, false, 34);
    expect(none.classList.contains('has-pic')).toBe(false);
    const bot = avatar({ id: 0, name: 'Ann', color: '#d64541' }, true, 34);
    expect(bot.classList.contains('has-pic')).toBe(false);
    expect(bot.classList.contains('is-bot')).toBe(true);
    // Callers without an id (older code paths) get the plain icon.
    expect(avatar({ name: 'X', color: '#000' }, false, 20).classList.contains('has-pic')).toBe(
      false,
    );
  });

  it('never renders an unsafe ref', () => {
    setSeatLooks([{ avatar: 'https://evil.example/x.png' }]);
    const el = avatar({ id: 0, name: 'A', color: '#d64541' }, false, 34);
    expect(el.querySelector('img')).toBeNull();
    expect(el.classList.contains('has-pic')).toBe(false);
  });
});

describe('Profile dialog', () => {
  function open(profile: Profile = { ...EMPTY_PROFILE, name: 'Ann' }, extra = {}) {
    const saved: Profile[] = [];
    let cancelled = 0;
    const handle = openProfileDialog({
      profile,
      onSave: (p) => saved.push(p),
      onCancel: () => cancelled++,
      ...extra,
    });
    return { saved, handle, cancelled: () => cancelled };
  }

  it('picks a gallery picture and a piece style, saves with the nickname', async () => {
    const { saved } = open();
    await flush();
    // 18 gallery avatars + "none" + upload tile; 6 styles with previews.
    expect(document.querySelectorAll('[data-avatar]').length).toBe(19);
    expect(document.querySelectorAll('.pf-style').length).toBe(6);
    expect(document.querySelector('.pf-style img')).not.toBeNull();
    $('[data-avatar="owl"]').click();
    expect($('[data-avatar="owl"]').getAttribute('aria-checked')).toBe('true');
    $('[data-style="keep"]').click();
    $<HTMLInputElement>('[data-k="profile-name"]').value = ' Annie ';
    $('[data-k="profile-save"]').click();
    expect(saved).toEqual([{ name: 'Annie', avatar: 'owl', pieceStyle: 'keep' }]);
    expect(document.querySelector('.pf-scrim')).toBeNull();
  });

  it('needs a nickname; Escape cancels', () => {
    const r = open({ ...EMPTY_PROFILE });
    $('[data-k="profile-save"]').click();
    expect(r.saved).toEqual([]);
    expect($('.pf-status').textContent).toMatch(/nickname/);
    $('.pf-scrim').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(r.cancelled()).toBe(1);
    expect(document.querySelector('.pf-scrim')).toBeNull();
  });

  it('keeps an uploaded picture pickable and can clear the picture', () => {
    const { saved } = open({ name: 'A', avatar: PNG, pieceStyle: 'adobe' });
    expect($('[data-avatar="upload"]').getAttribute('aria-checked')).toBe('true');
    $('[data-avatar="fox"]').click();
    expect(document.querySelector('[data-avatar="upload"]')).not.toBeNull();
    $('[data-avatar="none"]').click();
    $('[data-k="profile-save"]').click();
    expect(saved[0]).toEqual({ name: 'A', avatar: null, pieceStyle: 'adobe' });
  });
});

describe('setup seats', () => {
  it('the look button opens a seat dialog; bot seats pick pieces only', () => {
    const looks: unknown[] = [];
    const human = seatLookButton(
      { name: 'Ann', color: '#d64541', controller: 'human', avatar: 'frog' },
      0,
      (l) => looks.push(l),
    );
    document.body.append(human);
    expect(human.querySelector('.avatar.has-pic')).not.toBeNull();
    human.click();
    expect(document.querySelector('[data-k="profile-name"]')).toBeNull();
    $('[data-style="pagoda"]').click();
    $('[data-k="profile-save"]').click();
    expect(looks).toEqual([{ avatar: 'frog', pieceStyle: 'pagoda' }]);

    const bot = seatLookButton({ name: 'Blue', color: '#3a7bd5', controller: 'bot' }, 1, () => 0);
    document.body.append(bot);
    expect(bot.querySelector('.avatar.is-bot')).not.toBeNull();
    bot.click();
    expect(document.querySelector('[data-avatar]')).toBeNull();
    expect(document.querySelectorAll('.pf-style').length).toBe(6);
  });

  it('seat 1 wears the profile unless it has its own look', () => {
    const seats: SeatLookDraft[] = [
      { name: 'You', color: '#d64541', controller: 'human' },
      { name: 'Blue', color: '#3a7bd5', controller: 'bot' },
    ];
    const p: Profile = { name: 'Ann', avatar: 'cat', pieceStyle: 'timber' };
    expect(withProfileLook(seats, p)[0]).toMatchObject({
      name: 'Ann',
      avatar: 'cat',
      pieceStyle: 'timber',
    });
    const own: SeatLookDraft[] = [{ ...seats[0]!, avatar: 'ox' }, seats[1]!];
    expect(withProfileLook(own, p)[0]!.avatar).toBe('ox');
    const bot: SeatLookDraft[] = [{ ...seats[0]!, controller: 'bot' }];
    expect(withProfileLook(bot, p)[0]!.avatar).toBeUndefined();
    expect(withProfileLook(seats, EMPTY_PROFILE)).toEqual(seats);
  });
});

describe('home, lobby and chat', () => {
  it('home: the Profile chip edits and saves the profile and fills the nickname', () => {
    let stored: Profile = { name: 'Ann', avatar: null, pieceStyle: 'classic' };
    const home = new HomeScreen({
      name: 'Ann',
      onOffline: () => undefined,
      onCreate: () => Promise.resolve(),
      onJoin: () => Promise.resolve(),
      profile: { load: () => stored, save: (p) => (stored = p) },
    });
    document.body.append(home.element);
    $('[data-k="profile"]').click();
    $('[data-avatar="bear"]').click();
    $<HTMLInputElement>('[data-k="profile-name"]').value = 'Anna';
    $('[data-k="profile-save"]').click();
    expect(stored).toEqual({ name: 'Anna', avatar: 'bear', pieceStyle: 'classic' });
    expect($<HTMLInputElement>('[data-k="nickname"]').value).toBe('Anna');
    expect($('[data-k="profile"] .avatar.has-pic')).not.toBeNull();
  });

  it('lobby: seat cards show pictures and piece styles; Profile chip for the viewer', () => {
    const room: RoomInfo = {
      id: 'K3J9QX',
      phase: 'lobby',
      host: 'm1',
      config: DEFAULT_ROOM_CONFIG,
      seats: ['#d64541', '#3a7bd5', '#ecf0f1'].map((color, index) => ({
        index,
        color,
        occupant: index === 0 ? 'm1' : index === 1 ? 'm2' : null,
        status: index < 2 ? 'human' : 'bot',
      })),
      members: [
        { id: 'm1', name: 'Ann', connected: true, seat: 0, avatar: 'owl', pieceStyle: 'keep' },
        { id: 'm2', name: 'Bob', connected: true, seat: 1, avatar: 'img:m2.1' },
      ],
    };
    let opened = 0;
    const noop = () => undefined;
    const actions: LobbyActions = {
      setName: noop,
      takeSeat: noop,
      leaveSeat: noop,
      setColor: noop,
      setBotLevel: noop,
      configure: noop,
      start: noop,
      leave: noop,
    };
    const lobby = new LobbyScreen({
      roomId: 'K3J9QX',
      inviteUrl: 'http://x/?room=K3J9QX',
      actions,
      chat: document.createElement('div'),
      avatarOf: (m) => (m === 'm1' ? 'owl' : m === 'm2' ? PNG : null),
      onProfile: () => opened++,
    });
    document.body.append(lobby.element);
    lobby.update(room, 'm1');
    const seat = (i: number) => lobby.element.querySelector(`[data-seat="${i}"]`)!;
    expect(seat(0).querySelector('.avatar.has-pic svg')).not.toBeNull();
    expect(seat(1).querySelector('img.avatar-pic')).not.toBeNull();
    expect(seat(2).querySelector('.has-pic')).toBeNull();
    expect(seat(0).querySelector('.pf-seat-style')!.textContent).toContain('Stone keep');
    expect(seat(1).querySelector('.pf-seat-style')!.textContent).toContain('Classic');
    lobby.element.querySelector<HTMLElement>('[data-k="profile"]')!.click();
    expect(opened).toBe(1);
  });

  it('chat lines carry the sender picture', () => {
    const chat = new ChatPanel({
      send: () => true,
      react: () => true,
      colorOf: () => '#d64541',
      avatarOf: (e) => (e.from === 'm1' ? 'fox' : null),
    });
    chat.setEntries([
      { id: 1, at: 0, from: 'm1', name: 'Ann', seat: 0, text: 'hi' },
      { id: 2, at: 0, from: 'm2', name: 'Bob', seat: null, text: 'yo' },
    ]);
    const rows = chat.element.querySelectorAll('.chat-row');
    expect(rows[0]!.querySelector('.avatar.has-pic')).not.toBeNull();
    expect(rows[1]!.querySelector('.avatar')).toBeNull();
  });
});

describe('upload helpers', () => {
  it('crops the largest centred square, zooms and pans inside the image', () => {
    expect(cropRect(400, 200, CENTER_CROP)).toEqual({ x: 100, y: 0, side: 200 });
    expect(cropRect(400, 200, { zoom: 2, cx: 0.5, cy: 0.5 })).toEqual({ x: 150, y: 50, side: 100 });
    // Clamped at the edges.
    expect(cropRect(400, 200, { zoom: 2, cx: 0, cy: 1 })).toEqual({ x: 0, y: 100, side: 100 });
    // Dragging right by the whole stage moves the square left by its side.
    const moved = panCrop(400, 200, { zoom: 2, cx: 0.5, cy: 0.5 }, 100, 0, 100);
    expect(cropRect(400, 200, moved).x).toBe(50);
    // Past the edge: no slack builds up.
    const far = panCrop(400, 200, CENTER_CROP, 10_000, 0, 100);
    expect(cropRect(400, 200, far).x).toBe(0);
  });

  it('encodes WebP, falls back to JPEG, steps quality down to fit', () => {
    const webp = (n: number) =>
      `data:image/webp;base64,UklGR${'A'.repeat(Math.ceil((n * 4) / 3 / 4) * 4 - 5)}`;
    const calls: string[] = [];
    const canvas = {
      toDataURL: (type?: string, q?: number) => {
        calls.push(`${type}@${q}`);
        // Only quality <= 0.6 fits 12 KB.
        return webp((q ?? 1) > 0.6 ? 20_000 : 9_000);
      },
    };
    const url = encodeAvatar(canvas);
    expect(url?.startsWith('data:image/webp;base64,')).toBe(true);
    expect(calls[calls.length - 1]).toBe('image/webp@0.6');
    // No WebP encoder (the browser returns PNG): JPEG instead.
    const jpeg = encodeAvatar({
      toDataURL: (type?: string) =>
        type === 'image/jpeg' ? 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' : PNG,
    });
    expect(jpeg).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    // Nothing fits / tainted canvas.
    expect(encodeAvatar({ toDataURL: () => webp(40_000) })).toBeNull();
    expect(
      encodeAvatar({
        toDataURL: () => {
          throw new Error('tainted');
        },
      }),
    ).toBeNull();
  });
});
