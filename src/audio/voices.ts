/**
 * Voice building blocks for sound recipes (base sounds and expansion modules). Each returns one
 * voice with gentle defaults: soft attacks, exponential decays, filtered bright waves.
 */
import type { NoiseVoice, ToneVoice } from './types';

type ToneOpts = Partial<Omit<ToneVoice, 'kind'>>;
type NoiseOpts = Partial<Omit<NoiseVoice, 'kind'>>;

/** Equal-tempered note frequencies (A4 = 440 Hz). */
export const NOTE = {
  D3: 146.83,
  F3: 174.61,
  G3: 196.0,
  A3: 220.0,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.0,
  A4: 440.0,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880.0,
  C6: 1046.5,
  D6: 1174.66,
  E6: 1318.51,
  G6: 1567.98,
} as const;

/** A struck bell / chime: sine with a few soft harmonics, long decay. */
export function bell(freq: number, at = 0, o: ToneOpts = {}): ToneVoice {
  return {
    kind: 'tone',
    wave: 'sine',
    freq,
    at,
    dur: 1.1,
    attack: 0.004,
    gain: 0.35,
    partials: [
      [2, 0.3],
      [3, 0.1],
      [4.07, 0.05],
    ],
    ...o,
  };
}

/** Small metal (coins, ship bell): inharmonic partials, short. */
export function ting(freq: number, at = 0, o: ToneOpts = {}): ToneVoice {
  return bell(freq, at, {
    dur: 0.4,
    gain: 0.15,
    partials: [
      [2.76, 0.35],
      [5.4, 0.1],
    ],
    ...o,
  });
}

/** A plucked note: triangle through a lowpass, medium decay. */
export function pluck(freq: number, at = 0, o: ToneOpts = {}): ToneVoice {
  return {
    kind: 'tone',
    wave: 'triangle',
    freq,
    at,
    dur: 0.4,
    attack: 0.004,
    gain: 0.4,
    filter: { type: 'lowpass', freq: Math.min(freq * 4, 9000) },
    ...o,
  };
}

/** A wooden knock: short triangle dropping in pitch. */
export function knock(freq: number, at = 0, o: ToneOpts = {}): ToneVoice {
  return {
    kind: 'tone',
    wave: 'triangle',
    freq,
    to: freq * 0.55,
    glide: 0.06,
    at,
    dur: 0.12,
    attack: 0.003,
    gain: 0.55,
    ...o,
  };
}

/** A soft low thump (dice landing, drums, the robber): sine sweeping down. */
export function thud(at = 0, o: ToneOpts = {}): ToneVoice {
  return {
    kind: 'tone',
    wave: 'sine',
    freq: 150,
    to: 55,
    glide: 0.12,
    at,
    dur: 0.22,
    attack: 0.004,
    gain: 0.65,
    ...o,
  };
}

/** A brass-like note: sawtooth through a low lowpass (mellow, never buzzy). */
export function horn(freq: number, at: number, dur: number, o: ToneOpts = {}): ToneVoice {
  return {
    kind: 'tone',
    wave: 'sawtooth',
    freq,
    at,
    dur,
    attack: 0.04,
    hold: Math.max(0, dur * 0.35),
    gain: 0.16,
    filter: { type: 'lowpass', freq: Math.min(freq * 3, 2400), q: 0.7 },
    ...o,
  };
}

/** A filtered noise burst. */
export function noise(at: number, dur: number, o: NoiseOpts = {}): NoiseVoice {
  return { kind: 'noise', at, dur, attack: 0.003, gain: 0.3, ...o };
}

/** A tiny bright click (a die hitting the table, a card edge). */
export function tick(freq: number, at = 0, o: NoiseOpts = {}): NoiseVoice {
  return noise(at, 0.035, {
    attack: 0.002,
    gain: 0.45,
    filter: { type: 'bandpass', freq, q: 3 },
    ...o,
  });
}

/** Air moving: band-passed noise sweeping `from` → `to` Hz, slow attack. */
export function swish(from: number, to: number, at: number, dur: number, o: NoiseOpts = {}) {
  return noise(at, dur, {
    attack: dur * 0.35,
    gain: 0.32,
    filter: { type: 'bandpass', freq: from, to, q: 1.2 },
    ...o,
  });
}
