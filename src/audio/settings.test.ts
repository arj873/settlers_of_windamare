import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOUND,
  SOUND_KEY,
  isHeadless,
  loadSoundSettings,
  masterGain,
  saveSoundSettings,
} from './settings';
import { SoundEngine } from './engine';

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    map: m,
  };
}

const throwing = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

describe('sound settings persistence', () => {
  it('defaults: moderate volume, not muted', () => {
    expect(loadSoundSettings(null)).toEqual(DEFAULT_SOUND);
    expect(loadSoundSettings(memStore())).toEqual({ volume: 0.6, muted: false });
  });

  it('round-trips through storage', () => {
    const store = memStore();
    saveSoundSettings(store, { volume: 0.25, muted: true });
    expect(JSON.parse(store.map.get(SOUND_KEY)!)).toEqual({ volume: 0.25, muted: true });
    expect(loadSoundSettings(store)).toEqual({ volume: 0.25, muted: true });
  });

  it('survives corrupt values and throwing storage', () => {
    const store = memStore();
    store.setItem(SOUND_KEY, '{not json');
    expect(loadSoundSettings(store)).toEqual(DEFAULT_SOUND);
    store.setItem(SOUND_KEY, JSON.stringify({ volume: 7, muted: 'yes' }));
    expect(loadSoundSettings(store)).toEqual({ volume: 1, muted: false });
    store.setItem(SOUND_KEY, 'null');
    expect(loadSoundSettings(store)).toEqual(DEFAULT_SOUND);
    expect(loadSoundSettings(throwing)).toEqual(DEFAULT_SOUND);
    expect(() => saveSoundSettings(throwing, DEFAULT_SOUND)).not.toThrow();
  });

  it('master gain is perceptual and 0 when muted', () => {
    expect(masterGain({ volume: 0.5, muted: false })).toBeCloseTo(0.25);
    expect(masterGain({ volume: 1, muted: true })).toBe(0);
  });

  it('the engine saves every change and tells listeners', () => {
    const store = memStore();
    const engine = new SoundEngine({ storage: store, createContext: () => null });
    const seen: boolean[] = [];
    engine.onChange((s) => seen.push(s.muted));
    engine.setMuted(true);
    engine.setVolume(0.3);
    expect(seen).toEqual([true, true]);
    expect(loadSoundSettings(store)).toEqual({ volume: 0.3, muted: true });
    expect(new SoundEngine({ storage: store }).settings).toEqual({ volume: 0.3, muted: true });
  });

  it('without an AudioContext nothing plays (tests, old browsers)', () => {
    const engine = new SoundEngine({ storage: null, createContext: () => null });
    engine.unlock();
    expect(engine.play('dice')).toBe(false);
  });
});

describe('isHeadless', () => {
  it('mutes the playtest harness and automation', () => {
    expect(isHeadless('?debug=1', {})).toBe(true);
    expect(isHeadless('?mute=1', {})).toBe(true);
    expect(isHeadless('', { webdriver: true })).toBe(true);
    expect(isHeadless('?sfx=1', { webdriver: false })).toBe(false);
    expect(isHeadless('', undefined)).toBe(false);
  });
});
