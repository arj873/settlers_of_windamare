/**
 * Sound effects (A1): cue and recipe types. Every sound is synthesized with the Web Audio API
 * from a small declarative recipe (no audio files). No DOM, no engine imports: the game mapping
 * (src/game/sounds.ts), the UI and expansion modules all share these.
 */

/** How prominent a cue is: `high` = you / affects you, `normal` = others, `low` = bots. */
export type CueLevel = 'high' | 'normal' | 'low';

/** Gain multiplier per level. */
export const LEVEL_GAIN: Readonly<Record<CueLevel, number>> = { high: 1, normal: 0.6, low: 0.32 };

/** A sound to play: a recipe id (base ids below, modules use `<expansionId>/<name>`). */
export interface SoundCue {
  id: string;
  level: CueLevel;
}

export interface FilterSpec {
  type: 'lowpass' | 'highpass' | 'bandpass';
  /** Cutoff / centre frequency in Hz. */
  freq: number;
  /** Sweep the cutoff to this frequency over the voice (exponential). */
  to?: number;
  /** Resonance (Q), default 1. */
  q?: number;
}

interface VoiceBase {
  /** Start, seconds after the sound starts (default 0). */
  at?: number;
  /** Peak gain 0..1 (default 0.5) before the recipe gain and the level. */
  gain?: number;
  /** Seconds from silence to the peak (linear; at least MIN_ATTACK, so nothing clicks). */
  attack?: number;
  /** Seconds held at the peak before the decay starts (default 0). */
  hold?: number;
  /** Total length in seconds: attack + hold + exponential decay to silence. */
  dur: number;
  filter?: FilterSpec;
}

/** An oscillator, with optional pitch glide and harmonic partials sharing its envelope. */
export interface ToneVoice extends VoiceBase {
  kind: 'tone';
  /** Default 'sine'. Keep 'square' / 'sawtooth' quiet and filtered. */
  wave?: 'sine' | 'triangle' | 'sawtooth' | 'square';
  /** Frequency in Hz. */
  freq: number;
  /** Glide to this frequency (exponential) over `glide` seconds (default the whole voice). */
  to?: number;
  glide?: number;
  /** Extra sine partials: [frequency ratio, gain relative to the voice]. Bells, metal. */
  partials?: readonly (readonly [number, number])[];
}

/** White noise through an optional filter: rattles, swishes, thumps, water. */
export interface NoiseVoice extends VoiceBase {
  kind: 'noise';
}

export type Voice = ToneVoice | NoiseVoice;

export interface SoundRecipe {
  /** Name in the audition panel (`?sfx=1`). */
  label: string;
  /** Overall gain of the recipe (default 1). */
  gain?: number;
  /** Random detune per play, ± cents (tones and noise filters): repeats sound less mechanical. */
  vary?: number;
  voices: readonly Voice[];
}

/** What the game mapping offers a module's cue hook. */
export interface CueContext {
  /** The seat this screen shows (null = spectator / nobody). */
  viewer: number | null;
  /** Is this seat played on this screen (hotseat humans, or the online seat)? */
  isLocal(player: number): boolean;
  /** The level for something `actor` did (null = nobody / the game): local high, bot low. */
  levelOf(actor: number | null): CueLevel;
}

/**
 * An expansion module's sounds (HudExtension.sounds): recipes registered under namespaced ids
 * and a hook deriving cues from one state change, like the base mapping. `S` is GameState.
 */
export interface ExtensionSounds<S> {
  recipes?: Readonly<Record<string, SoundRecipe>>;
  cues?(prev: S, next: S, ctx: CueContext): SoundCue[];
}
