import { describe, expect, it } from 'vitest';
import { NAME_KEY, type KeyStore } from '../../net/transport';
import { NAME_MAX } from '../setup/model';
import {
  AVATAR_IDS,
  avatarError,
  cleanLooks,
  EMPTY_PROFILE,
  loadProfile,
  PIECE_STYLE_IDS,
  pieceStyleOr,
  PROFILE_KEY,
  PROFILE_NAME_MAX,
  saveProfile,
} from './model';

function memStore(init: Record<string, string> = {}): KeyStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
}

const throwing: KeyStore = {
  get: () => {
    throw new Error('SecurityError');
  },
  set: () => {
    throw new Error('QuotaExceededError');
  },
};

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

describe('profile persistence', () => {
  it('round-trips name, picture and piece style', () => {
    const s = memStore();
    expect(saveProfile(s, { name: '  Ann  ', avatar: PNG, pieceStyle: 'pagoda' })).toBe(true);
    expect(loadProfile(s)).toEqual({ name: 'Ann', avatar: PNG, pieceStyle: 'pagoda' });
    // The nickname is shared with the online screens.
    expect(s.data.get(NAME_KEY)).toBe('Ann');
  });

  it('defaults, and falls back to the remembered online nickname', () => {
    expect(loadProfile(memStore())).toEqual(EMPTY_PROFILE);
    expect(loadProfile(null)).toEqual(EMPTY_PROFILE);
    expect(loadProfile(memStore({ [NAME_KEY]: 'Bob' })).name).toBe('Bob');
  });

  it('drops bad or tampered fields', () => {
    const s = memStore({
      [PROFILE_KEY]: JSON.stringify({
        name: 'x'.repeat(50),
        avatar: 'https://evil.example/a.png',
        pieceStyle: 'castle',
      }),
    });
    expect(loadProfile(s)).toEqual({
      name: 'x'.repeat(PROFILE_NAME_MAX),
      avatar: null,
      pieceStyle: 'classic',
    });
    expect(loadProfile(memStore({ [PROFILE_KEY]: '{not json' }))).toEqual(EMPTY_PROFILE);
    expect(loadProfile(memStore({ [PROFILE_KEY]: '[1,2]' }))).toEqual(EMPTY_PROFILE);
    // Saving never stores an unsafe picture either.
    const t = memStore();
    saveProfile(t, { name: 'A', avatar: 'javascript:alert(1)', pieceStyle: 'keep' });
    expect(loadProfile(t).avatar).toBeNull();
  });

  it('survives a storage that throws (private mode, quota)', () => {
    expect(loadProfile(throwing)).toEqual(EMPTY_PROFILE);
    expect(saveProfile(throwing, { name: 'A', avatar: null, pieceStyle: 'classic' })).toBe(false);
    expect(saveProfile(null, EMPTY_PROFILE)).toBe(false);
  });

  it('uses the setup screen name length', () => {
    expect(PROFILE_NAME_MAX).toBe(NAME_MAX);
  });
});

describe('avatar refs and looks', () => {
  it('gallery ids and safe pictures only', () => {
    for (const id of AVATAR_IDS) expect(avatarError(id)).toBeNull();
    expect(avatarError(PNG)).toBeNull();
    expect(avatarError('data:image/png;base64,/9j/4AAQ')).toMatch(/not a png/);
    expect(avatarError('data:image/svg+xml;base64,PHN2Zz4=')).not.toBeNull();
    expect(avatarError(null)).not.toBeNull();
    expect(AVATAR_IDS.length).toBeGreaterThanOrEqual(16);
    expect(PIECE_STYLE_IDS.length).toBeGreaterThanOrEqual(5);
  });

  it('cleanLooks keeps good entries, pads and drops the rest', () => {
    expect(
      cleanLooks(
        [{ avatar: 'fox', pieceStyle: 'keep' }, { avatar: 'nope', pieceStyle: 'x' }, null, 5],
        5,
      ),
    ).toEqual([{ avatar: 'fox', pieceStyle: 'keep' }, {}, {}, {}, {}]);
    expect(cleanLooks(undefined, 2)).toEqual([{}, {}]);
    expect(pieceStyleOr('adobe')).toBe('adobe');
    expect(pieceStyleOr(7)).toBe('classic');
  });
});
