// @vitest-environment jsdom
/** A1: the sound settings widget (HUD menu, setup footer) and the audition panel. */
import { describe, expect, it } from 'vitest';
import { BASE_SOUNDS, SOUND_KEY, SoundEngine, loadSoundSettings } from '../audio';
import { sfxPanel } from './sfxPanel';
import { soundControl } from './sound';

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

function rig() {
  const store = memStore();
  const engine = new SoundEngine({ storage: store, createContext: () => null });
  const el = soundControl({ engine });
  const mute = el.querySelector<HTMLButtonElement>('[data-k="mute"]')!;
  const slider = el.querySelector<HTMLInputElement>('[data-k="volume"]')!;
  return { store, engine, el, mute, slider };
}

describe('soundControl', () => {
  it('shows the saved settings', () => {
    const { slider, mute } = rig();
    expect(slider.value).toBe('60');
    expect(mute.getAttribute('aria-pressed')).toBe('false');
  });

  it('mute toggles and is saved', () => {
    const { store, engine, mute, slider } = rig();
    mute.click();
    expect(engine.settings.muted).toBe(true);
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    expect(slider.disabled).toBe(true);
    expect(loadSoundSettings(store).muted).toBe(true);
    mute.click();
    expect(engine.settings.muted).toBe(false);
    expect(store.getItem(SOUND_KEY)).toContain('"muted":false');
  });

  it('the slider sets and saves the volume', () => {
    const { store, engine, slider } = rig();
    slider.value = '25';
    slider.dispatchEvent(new Event('input'));
    expect(engine.settings.volume).toBeCloseTo(0.25);
    expect(loadSoundSettings(store).volume).toBeCloseTo(0.25);
  });

  it('unmuting at volume 0 brings the volume back', () => {
    const { engine, mute, slider } = rig();
    engine.setVolume(0);
    engine.setMuted(true);
    mute.click();
    expect(engine.settings).toEqual({ volume: 0.6, muted: false });
    expect(slider.value).toBe('60');
  });
});

describe('sfxPanel', () => {
  it('has one button per registered sound', () => {
    const engine = new SoundEngine({ storage: null, createContext: () => null });
    engine.register({ 'x/test': { label: 'Test', voices: [{ kind: 'noise', dur: 0.1 }] } });
    const panel = sfxPanel(engine);
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('[data-sfx]')];
    expect(buttons.map((b) => b.dataset.sfx)).toEqual([...Object.keys(BASE_SOUNDS), 'x/test']);
    expect(() => buttons[0]!.click()).not.toThrow();
  });
});
