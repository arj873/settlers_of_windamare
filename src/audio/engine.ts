/**
 * SoundEngine: the browser side of sound effects. Holds the recipe registry and the settings,
 * creates the AudioContext on the first user gesture (autoplay rules) and plays recipes through
 * master gain → gentle compressor → speakers. Without Web Audio (tests, old browsers), while
 * suppressed (headless) or muted, `play` does nothing.
 */
import { BASE_SOUNDS } from './recipes';
import { loadSoundSettings, masterGain, saveSoundSettings, type SoundSettings } from './settings';
import { noiseBuffer, playRecipe, recipeDuration } from './synth';
import type { SoundRecipe } from './types';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export interface SoundEngineOptions {
  storage: Store | null;
  /** Creates the context on unlock; default `new AudioContext()` when available. */
  createContext?: () => AudioContext | null;
}

/** Most sounds playing at once before new ones are skipped (keeps CPU and the mix sane). */
const MAX_LIVE = 6;

export class SoundEngine {
  private readonly storage: Store | null;
  private readonly createContext: () => AudioContext | null;
  private readonly registry = new Map<string, SoundRecipe>();
  private readonly listeners = new Set<(s: SoundSettings) => void>();
  private current: SoundSettings;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private suppressedFlag = false;
  /** End times of sounds still playing. */
  private live: number[] = [];

  constructor(opts: SoundEngineOptions) {
    this.storage = opts.storage;
    this.createContext = opts.createContext ?? defaultContext;
    this.current = loadSoundSettings(this.storage);
    this.register(BASE_SOUNDS);
  }

  // --- registry -------------------------------------------------------------

  /** Add (or replace) recipes by id; expansion modules use `<id>/<name>`. */
  register(recipes: Readonly<Record<string, SoundRecipe>>): void {
    for (const [id, r] of Object.entries(recipes)) this.registry.set(id, r);
  }

  /** Every registered recipe, in registration order (audition panel). */
  recipes(): [string, SoundRecipe][] {
    return [...this.registry];
  }

  // --- settings -------------------------------------------------------------

  get settings(): SoundSettings {
    return { ...this.current };
  }

  setVolume(volume: number): void {
    this.update({ ...this.current, volume: Math.min(1, Math.max(0, volume)) });
  }

  setMuted(muted: boolean): void {
    this.update({ ...this.current, muted });
  }

  /** Called with the new settings after every change; returns an unsubscribe. */
  onChange(fn: (s: SoundSettings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Headless pages (playtest harness, automation): never play, whatever the settings. */
  suppress(on: boolean): void {
    this.suppressedFlag = on;
  }

  get suppressed(): boolean {
    return this.suppressedFlag;
  }

  private update(s: SoundSettings): void {
    this.current = s;
    saveSoundSettings(this.storage, s);
    if (this.master && this.ctx) {
      // Short ramp: a volume change mid-sound must not click.
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(masterGain(s), t + 0.05);
    }
    for (const fn of this.listeners) fn(this.settings);
  }

  // --- context --------------------------------------------------------------

  /** Create / resume the AudioContext. Call from a user gesture. */
  unlock(): void {
    if (this.suppressedFlag) return;
    if (!this.ctx) {
      const ctx = this.createContext();
      if (!ctx) return;
      const master = ctx.createGain();
      master.gain.value = masterGain(this.current);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      master.connect(comp);
      comp.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      this.noise = noiseBuffer(ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  /**
   * Unlock on pointer / key gestures anywhere on the page. The listeners stay: `unlock` is cheap
   * once the context exists and resumes it if the browser suspended it again (mobile Safari).
   */
  installUnlock(target: Pick<EventTarget, 'addEventListener'>): void {
    for (const e of ['pointerdown', 'keydown', 'touchend']) {
      target.addEventListener(e, () => this.unlock(), { capture: true, passive: true });
    }
  }

  // --- playing --------------------------------------------------------------

  /** Play recipe `id` at `gain` (cue level). False when nothing was played. */
  play(id: string, gain = 1): boolean {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.suppressedFlag || masterGain(this.current) === 0) return false;
    if (ctx.state !== 'running') return false;
    const recipe = this.registry.get(id);
    if (!recipe) return false;
    const now = ctx.currentTime;
    this.live = this.live.filter((end) => end > now);
    if (this.live.length >= MAX_LIVE) return false;
    playRecipe(ctx, master, recipe, { when: now + 0.01, gain, noise: this.noise });
    this.live.push(now + 0.01 + recipeDuration(recipe));
    return true;
  }
}

function defaultContext(): AudioContext | null {
  const Ctor =
    typeof AudioContext !== 'undefined'
      ? AudioContext
      : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}
