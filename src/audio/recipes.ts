/**
 * The base game's sounds, all synthesized (no files). Short, soft and mostly wooden / bell-like,
 * so they sit under the game instead of on top of it. Audition them with `?sfx=1`.
 */
import type { SoundRecipe } from './types';
import { NOTE as N, bell, horn, knock, noise, pluck, swish, thud, tick, ting } from './voices';

export type BaseSoundId =
  | 'dice'
  | 'seven'
  | 'yourTurn'
  | 'road'
  | 'settlement'
  | 'city'
  | 'devBuy'
  | 'devPlay'
  | 'robber'
  | 'steal'
  | 'discard'
  | 'tradeOffer'
  | 'tradeAccept'
  | 'tradeReject'
  | 'trade'
  | 'longestRoad'
  | 'largestArmy'
  | 'victory'
  | 'defeat'
  | 'chat'
  | 'timerWarn'
  | 'timerUrgent';

/** Dice rattle: bright clicks with shrinking gaps, then two dice landing. */
const RATTLE: [number, number, number][] = [
  // [time s, click Hz, gain]
  [0, 3200, 0.5],
  [0.045, 2600, 0.42],
  [0.1, 3800, 0.48],
  [0.14, 2900, 0.38],
  [0.21, 3400, 0.4],
  [0.27, 2500, 0.32],
  [0.36, 3000, 0.28],
];

export const BASE_SOUNDS: Readonly<Record<BaseSoundId, SoundRecipe>> = {
  dice: {
    label: 'Dice roll',
    vary: 60,
    voices: [
      ...RATTLE.flatMap(([t, f, g], i) => [
        tick(f, t, { gain: g }),
        ...(i % 2 === 0 ? [knock(1100 + i * 40, t, { gain: 0.14, dur: 0.05 })] : []),
      ]),
      // First die lands, second follows, a last little settle.
      thud(0.46, { freq: 170, to: 70, gain: 0.45 }),
      noise(0.46, 0.08, { gain: 0.3, filter: { type: 'lowpass', freq: 900 } }),
      knock(700, 0.53, { gain: 0.28 }),
      tick(1800, 0.53, { gain: 0.28 }),
      tick(2200, 0.6, { gain: 0.14 }),
    ],
  },
  seven: {
    label: 'Seven rolled (follows the dice)',
    voices: [
      horn(N.A3, 0.62, 0.4, { gain: 0.2 }),
      horn(N.F3, 0.86, 0.85, { gain: 0.2 }),
      { kind: 'tone', wave: 'sine', freq: N.F3 / 2, at: 0.86, dur: 0.85, attack: 0.03, gain: 0.2 },
    ],
  },
  yourTurn: {
    label: 'Your turn',
    voices: [
      bell(N.G5, 0, { gain: 0.3 }),
      bell(N.C6, 0.13, { gain: 0.34, dur: 1.4 }),
      { kind: 'tone', wave: 'sine', freq: N.C5, at: 0.13, dur: 0.9, attack: 0.05, gain: 0.1 },
    ],
  },
  road: {
    label: 'Build road',
    vary: 40,
    voices: [
      knock(320, 0, { dur: 0.1 }),
      tick(1800, 0, { gain: 0.25 }),
      knock(260, 0.07, { gain: 0.3 }),
    ],
  },
  settlement: {
    label: 'Build settlement',
    vary: 30,
    voices: [
      knock(240, 0, { gain: 0.6, dur: 0.14 }),
      tick(1500, 0, { gain: 0.28 }),
      knock(300, 0.08, { gain: 0.35 }),
      bell(N.E5, 0.13, { gain: 0.12, dur: 0.7 }),
    ],
  },
  city: {
    label: 'Build city',
    vary: 20,
    voices: [
      knock(180, 0, { gain: 0.7, dur: 0.18 }),
      noise(0, 0.09, { gain: 0.32, filter: { type: 'bandpass', freq: 1200, q: 1.5 } }),
      knock(220, 0.09, { gain: 0.45, dur: 0.15 }),
      bell(N.C5, 0.17, { gain: 0.13, dur: 0.9 }),
      bell(N.E5, 0.21, { gain: 0.12, dur: 0.9 }),
      bell(N.G5, 0.25, { gain: 0.12, dur: 1.0 }),
    ],
  },
  devBuy: {
    label: 'Buy development card',
    voices: [
      swish(900, 3500, 0, 0.2, { gain: 0.65 }),
      tick(4000, 0.18, { gain: 0.3 }),
      ting(N.G6, 0.2, { gain: 0.12 }),
    ],
  },
  devPlay: {
    label: 'Play development card',
    voices: [
      swish(2500, 1200, 0, 0.09, { gain: 0.5 }),
      tick(3500, 0.07, { gain: 0.4 }),
      pluck(N.A5, 0.09, { gain: 0.26, dur: 0.45 }),
      bell(N.E6, 0.15, { gain: 0.1, dur: 0.7 }),
    ],
  },
  robber: {
    label: 'Robber moved',
    voices: [
      thud(0, { freq: 120, to: 50, glide: 0.3, dur: 0.45, gain: 0.7 }),
      noise(0, 0.35, { attack: 0.01, gain: 0.3, filter: { type: 'lowpass', freq: 350 } }),
      horn(110, 0.05, 0.6, { to: 98, gain: 0.12, filter: { type: 'lowpass', freq: 500 } }),
    ],
  },
  steal: {
    label: 'Steal',
    voices: [
      swish(3200, 700, 0, 0.16, { gain: 0.6 }),
      {
        kind: 'tone',
        wave: 'triangle',
        freq: 900,
        to: 420,
        at: 0,
        dur: 0.16,
        attack: 0.005,
        gain: 0.16,
      },
      pluck(N.D4, 0.14, { gain: 0.22, dur: 0.3 }),
    ],
  },
  discard: {
    label: 'Discard',
    vary: 80,
    voices: [0, 0.06, 0.12].map((t, i) =>
      noise(t, 0.07, {
        attack: 0.01,
        gain: 0.6 - i * 0.1,
        filter: { type: 'bandpass', freq: 2600 - i * 300, to: 1500, q: 0.9 },
      }),
    ),
  },
  tradeOffer: {
    label: 'Trade offer received',
    voices: [pluck(N.D5, 0, { gain: 0.38 }), pluck(N.A5, 0.14, { gain: 0.4, dur: 0.55 })],
  },
  tradeAccept: {
    label: 'Trade offer accepted',
    voices: [
      pluck(N.C5, 0),
      pluck(N.E5, 0.08),
      pluck(N.G5, 0.16),
      bell(N.C6, 0.24, { gain: 0.18, dur: 0.9 }),
    ],
  },
  tradeReject: {
    label: 'Trade offer rejected',
    voices: [
      pluck(N.G4, 0, { gain: 0.32, dur: 0.3, filter: { type: 'lowpass', freq: 1200 } }),
      pluck(N.E4, 0.14, { gain: 0.3, dur: 0.5, filter: { type: 'lowpass', freq: 1100 } }),
    ],
  },
  trade: {
    label: 'Trade done (coins)',
    vary: 30,
    voices: [
      ting(2093, 0, { gain: 0.22 }),
      ting(2637, 0.07, { gain: 0.19 }),
      tick(5000, 0, { gain: 0.15 }),
    ],
  },
  longestRoad: {
    label: 'Longest Road gained',
    voices: [
      pluck(N.G4, 0),
      pluck(N.C5, 0.08),
      pluck(N.E5, 0.16),
      bell(N.G5, 0.24, { gain: 0.28, dur: 1.0 }),
    ],
  },
  largestArmy: {
    label: 'Largest Army gained',
    voices: [
      horn(N.C4, 0, 0.2, { gain: 0.2 }),
      horn(N.G4, 0.16, 0.2, { gain: 0.2 }),
      horn(N.C5, 0.32, 0.7, { gain: 0.2 }),
      thud(0, { gain: 0.4 }),
      thud(0.32, { gain: 0.45 }),
    ],
  },
  victory: {
    label: 'Victory fanfare',
    voices: [
      horn(N.G4, 0, 0.16, { gain: 0.18 }),
      horn(N.G4, 0.17, 0.16, { gain: 0.18 }),
      horn(N.G4, 0.34, 0.16, { gain: 0.18 }),
      horn(N.C5, 0.52, 1.6, { gain: 0.2, hold: 0.6 }),
      horn(N.E5, 0.52, 1.6, { gain: 0.11, hold: 0.6 }),
      horn(N.G5, 0.52, 1.6, { gain: 0.09, hold: 0.6 }),
      thud(0.52, { freq: 110, to: 60, dur: 0.5, gain: 0.5 }),
      bell(N.C6, 0.55, { gain: 0.12 }),
      bell(N.E6, 0.65, { gain: 0.1 }),
      bell(N.G6, 0.75, { gain: 0.08, dur: 1.4 }),
    ],
  },
  defeat: {
    label: 'Game over (you lost)',
    voices: [
      pluck(N.E4, 0, { gain: 0.3, dur: 0.7, filter: { type: 'lowpass', freq: 1400 } }),
      pluck(N.D4, 0.4, { gain: 0.28, dur: 0.7, filter: { type: 'lowpass', freq: 1300 } }),
      pluck(N.C4, 0.8, { gain: 0.3, dur: 1.5, filter: { type: 'lowpass', freq: 1200 } }),
      { kind: 'tone', wave: 'sine', freq: N.A3, at: 0.8, dur: 1.5, attack: 0.08, gain: 0.12 },
    ],
  },
  chat: {
    label: 'Chat message',
    voices: [
      {
        kind: 'tone',
        wave: 'sine',
        freq: 880,
        to: 1320,
        glide: 0.05,
        dur: 0.16,
        attack: 0.005,
        gain: 0.22,
      },
      { kind: 'tone', wave: 'sine', freq: 1320, at: 0.08, dur: 0.18, attack: 0.005, gain: 0.12 },
    ],
  },
  timerWarn: {
    label: 'Turn timer (last 10 s)',
    voices: [knock(1000, 0, { to: 800, gain: 0.32, dur: 0.06 }), tick(2500, 0, { gain: 0.18 })],
  },
  timerUrgent: {
    label: 'Turn timer (last 3 s)',
    voices: [
      knock(1400, 0, { to: 1100, gain: 0.4, dur: 0.07 }),
      tick(3000, 0, { gain: 0.2 }),
      ting(1760, 0, { gain: 0.1, dur: 0.3 }),
    ],
  },
};
