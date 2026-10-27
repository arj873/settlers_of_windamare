/** PR1: the `setProfile` message (picture + piece style), its checks, rate limit and delivery. */
import { describe, expect, it } from 'vitest';
import { AVATAR_LIMITS, AVATAR_MAX_CHARS } from '../ui/profile/model';
import { LIMITS, parseClientMessage, PROTOCOL_VERSION, RATE_LIMITS } from './protocol';
import { GameSession } from './session';
import { fakeDeps, LocalNet } from './testHarness';
import { RoomClient } from './client';
import { FakeClock, hostConnect, RoomHost } from './loopback';

const v = PROTOCOL_VERSION;

/** A data URL of `bytes` bytes that starts with the format's real signature. */
function picture(type: 'webp' | 'jpeg' | 'png', bytes: number): string {
  const head = {
    webp: Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'latin1'),
    jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  }[type];
  const body = Buffer.alloc(Math.max(0, bytes - head.length), 7);
  return `data:image/${type};base64,${Buffer.concat([head, body]).toString('base64')}`;
}

function parse(avatar: unknown, pieceStyle: unknown = 'classic') {
  return parseClientMessage(JSON.stringify({ v, type: 'setProfile', avatar, pieceStyle }));
}

describe('setProfile validation', () => {
  it('accepts gallery ids, null and small webp / jpeg / png pictures', () => {
    expect(parse('fox').ok).toBe(true);
    expect(parse(null, 'pagoda').ok).toBe(true);
    for (const t of ['webp', 'jpeg', 'png'] as const) {
      expect(parse(picture(t, 9000)).ok, t).toBe(true);
    }
  });

  it('accepts a picture of exactly the limit, rejects one byte more', () => {
    expect(parse(picture('webp', AVATAR_LIMITS.maxBytes)).ok).toBe(true);
    const r = parse(picture('webp', AVATAR_LIMITS.maxBytes + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/larger/);
  });

  it('the largest accepted message fits the frame limit', () => {
    const msg = JSON.stringify({
      v,
      type: 'setProfile',
      avatar: picture('webp', AVATAR_LIMITS.maxBytes),
      pieceStyle: 'longhouse',
    });
    expect(msg.length).toBeLessThanOrEqual(LIMITS.messageChars);
    expect(AVATAR_MAX_CHARS).toBeLessThan(LIMITS.messageChars);
  });

  it.each([
    ['remote url', 'https://example.com/me.png'],
    ['protocol-relative url', '//example.com/me.png'],
    ['svg (scriptable)', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['gif', 'data:image/gif;base64,R0lGODlhAQABAAAAACw='],
    ['not base64', 'data:image/png,hello'],
    ['html', 'data:text/html;base64,PGgxPmhpPC9oMT4='],
    ['bad base64 chars', 'data:image/png;base64,iVBORw0KGgo<script>'],
    ['bad padding length', 'data:image/png;base64,iVBORw0KGgoAA'],
    ['png label, jpeg bytes', picture('jpeg', 100).replace('image/jpeg', 'image/png')],
    ['empty payload', 'data:image/webp;base64,'],
    ['unknown gallery id', 'dragon'],
    ['a number', 42],
    ['an object', { id: 'fox' }],
  ])('rejects %s', (_label, avatar) => {
    const r = parse(avatar);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_message');
  });

  it('rejects unknown piece styles and extra size', () => {
    expect(parse('fox', 'castle').ok).toBe(false);
    const noStyle = JSON.stringify({ v, type: 'setProfile', avatar: 'fox' });
    expect(parseClientMessage(noStyle).ok).toBe(false);
    const huge = JSON.stringify({ v, type: 'setProfile', avatar: 'x'.repeat(30_000) });
    expect(parseClientMessage(huge)).toMatchObject({ ok: false, code: 'bad_message' });
  });
});

function lobby() {
  const { session, hostToken } = GameSession.create('room1', 1000, fakeDeps());
  const net = new LocalNet(session, 1000);
  net.connect('ann');
  net.send('ann', { type: 'hello', token: hostToken, name: 'Ann' });
  net.connect('bob');
  net.send('bob', { type: 'hello', token: null, name: 'Bob' });
  return { session, net };
}

describe('setProfile in a room', () => {
  it('stores the profile with the member and tells everyone', () => {
    const { net } = lobby();
    net.send('bob', { type: 'setProfile', avatar: 'owl', pieceStyle: 'keep' });
    const bob = net.last('ann', 'room')!.room.members.find((m) => m.name === 'Bob')!;
    expect(bob).toMatchObject({ avatar: 'owl', pieceStyle: 'keep' });
    // Back to none.
    net.send('bob', { type: 'setProfile', avatar: null, pieceStyle: 'classic' });
    const again = net.last('ann', 'room')!.room.members.find((m) => m.name === 'Bob')!;
    expect(again.avatar).toBeUndefined();
    expect(again.pieceStyle).toBe('classic');
  });

  it('pictures go out once by key, not in every room update', () => {
    const { net } = lobby();
    const pic = picture('webp', 8000);
    net.send('bob', { type: 'setProfile', avatar: pic, pieceStyle: 'adobe' });
    const key = net.last('ann', 'room')!.room.members.find((m) => m.name === 'Bob')!.avatar!;
    expect(key).toMatch(/^img:m2\.1$/);
    expect(net.last('ann', 'avatars')!.images).toEqual({ [key]: pic });
    expect(JSON.stringify(net.last('ann', 'room')).length).toBeLessThan(2000);
    // The same picture again: no new key, no re-send.
    net.clear('ann');
    net.send('bob', { type: 'setProfile', avatar: pic, pieceStyle: 'pagoda' });
    expect(net.last('ann', 'avatars')).toBeUndefined();
    expect(net.last('ann', 'room')!.room.members[1]!.avatar).toBe(key);
    // A newcomer gets every picture right after the welcome.
    net.connect('cy');
    net.send('cy', { type: 'hello', token: null, name: 'Cy' });
    const box = net.inbox.get('cy')!.map((m) => m.type);
    expect(box.indexOf('avatars')).toBe(box.indexOf('welcome') + 1);
    expect(net.last('cy', 'avatars')!.images[key]).toBe(pic);
    // A new picture gets a new key.
    net.send('bob', { type: 'setProfile', avatar: picture('png', 500), pieceStyle: 'pagoda' });
    expect(net.last('cy', 'room')!.room.members[1]!.avatar).toBe('img:m2.2');
  });

  it('is rate limited (burst, then one per 5 s)', () => {
    const { net } = lobby();
    const { burst, perSec } = RATE_LIMITS.profile;
    for (let i = 0; i < burst; i++) {
      net.send('bob', { type: 'setProfile', avatar: 'fox', pieceStyle: 'classic' });
    }
    expect(net.last('bob', 'error')).toBeUndefined();
    net.send('bob', { type: 'setProfile', avatar: 'owl', pieceStyle: 'classic' });
    expect(net.last('bob', 'error')).toMatchObject({ code: 'rate_limited', ref: 'setProfile' });
    net.clear('bob');
    net.advance(1000 / perSec);
    net.send('bob', { type: 'setProfile', avatar: 'owl', pieceStyle: 'classic' });
    expect(net.last('bob', 'error')).toBeUndefined();
    // Profile spam does not use up the lobby bucket.
    net.send('bob', { type: 'takeSeat', seat: 1 });
    expect(net.last('bob', 'error')).toBeUndefined();
  });

  it('caps uploaded pictures per room; gallery avatars stay unlimited', () => {
    const { session, hostToken } = GameSession.create('room2', 1000, fakeDeps());
    const net = new LocalNet(session, 1000);
    net.connect('c0');
    net.send('c0', { type: 'hello', token: hostToken, name: 'P0' });
    for (let i = 1; i <= LIMITS.avatarImages; i++) {
      net.connect(`c${i}`);
      net.send(`c${i}`, { type: 'hello', token: null, name: `P${i}` });
    }
    for (let i = 0; i < LIMITS.avatarImages; i++) {
      net.send(`c${i}`, {
        type: 'setProfile',
        avatar: picture('jpeg', 300 + i),
        pieceStyle: 'keep',
      });
      expect(net.last(`c${i}`, 'error')).toBeUndefined();
    }
    const last = `c${LIMITS.avatarImages}`;
    net.send(last, { type: 'setProfile', avatar: picture('jpeg', 999), pieceStyle: 'keep' });
    expect(net.last(last, 'error')?.message).toMatch(/too many uploaded pictures/);
    net.send(last, { type: 'setProfile', avatar: 'frog', pieceStyle: 'keep' });
    expect(net.messages(last, 'error')).toHaveLength(1);
  });

  it('survives a snapshot and is allowed during the game', () => {
    const { session, net } = lobby();
    net.send('ann', { type: 'setProfile', avatar: picture('webp', 600), pieceStyle: 'timber' });
    const restored = GameSession.restore(
      JSON.parse(JSON.stringify(session.snapshot())),
      fakeDeps(),
    );
    const ann = restored.room().members[0]!;
    expect(ann).toMatchObject({ avatar: 'img:m1.1', pieceStyle: 'timber' });
    net.send('ann', { type: 'takeSeat', seat: 0 });
    net.send('ann', { type: 'start' });
    net.send('ann', { type: 'setProfile', avatar: 'bear', pieceStyle: 'timber' });
    expect(net.last('ann', 'error')).toBeUndefined();
    expect(net.last('bob', 'room')!.room.members[0]!.avatar).toBe('bear');
  });

  it('a member can only change their own profile', () => {
    const { net } = lobby();
    // There is no member field: the server applies it to the sender.
    net.sendRaw('ann', {
      v,
      type: 'setProfile',
      member: 'm2',
      avatar: 'wolf',
      pieceStyle: 'keep',
    });
    const members = net.last('bob', 'room')!.room.members;
    expect(members[1]!.avatar).toBeUndefined();
    expect(members[0]!.avatar).toBe('wolf');
  });
});

describe('RoomClient profile', () => {
  it('sends the profile once welcomed and resolves uploaded pictures', () => {
    const clock = new FakeClock(1000);
    const { session } = GameSession.create('room3', clock.now(), fakeDeps());
    const host = new RoomHost(session, clock);
    const pic = picture('png', 400);
    const client = new RoomClient({
      roomId: 'room3',
      connect: hostConnect(host, clock),
      clock,
      name: 'Dee',
      profile: { avatar: pic, pieceStyle: 'pagoda' },
      pingMs: 0,
    });
    let avatarEvents = 0;
    client.on((e) => {
      if (e.type === 'avatars') avatarEvents++;
    });
    client.start();
    clock.advance(10);
    expect(client.status).toBe('open');
    expect(client.me?.pieceStyle).toBe('pagoda');
    expect(client.avatarOf(client.me?.id)).toBe(pic);
    expect(avatarEvents).toBe(1);
    client.setProfile({ avatar: 'ox', pieceStyle: 'adobe' });
    clock.advance(10);
    expect(client.avatarOf(client.me?.id)).toBe('ox');
    expect(client.avatarOf('m99')).toBeNull();
  });
});
