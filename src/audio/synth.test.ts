import { describe, expect, it } from 'vitest';
import { BASE_SOUNDS } from './recipes';
import { MIN_ATTACK, playRecipe, recipeDuration, type SynthContext } from './synth';
import type { SoundRecipe } from './types';
import { ckSounds } from '../expansions/ck/sounds';
import { seafarersSounds } from '../expansions/seafarers/sounds';
import { epSounds } from '../expansions/ep/sounds';
import { tbSounds } from '../expansions/tb/sounds';

const ALL: [string, SoundRecipe][] = Object.entries({
  ...BASE_SOUNDS,
  ...ckSounds.recipes,
  ...seafarersSounds.recipes,
  ...epSounds.recipes,
  ...tbSounds.recipes,
});

type Event = [kind: 'set' | 'lin' | 'exp', value: number, time: number];

class Param {
  value = 0;
  events: Event[] = [];
  setValueAtTime(v: number, t: number) {
    this.events.push(['set', v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(['lin', v, t]);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push(['exp', v, t]);
  }
}

/** A recording stand-in for the Web Audio nodes the synth creates. */
function fakeContext() {
  const gains: { gain: Param }[] = [];
  const sources: { start: number; stop: number }[] = [];
  const node = () => ({ connect: () => undefined, disconnect: () => undefined });
  const source = () => {
    const rec = { start: NaN, stop: NaN };
    sources.push(rec);
    return {
      ...node(),
      start: (t: number) => void (rec.start = t),
      stop: (t: number) => void (rec.stop = t),
      onended: null,
    };
  };
  const ctx = {
    createGain: () => {
      const g = { ...node(), gain: new Param() };
      gains.push(g);
      return g;
    },
    createOscillator: () => ({
      ...source(),
      type: 'sine',
      frequency: new Param(),
      detune: new Param(),
    }),
    createBufferSource: () => ({ ...source(), buffer: null, loop: false }),
    createBiquadFilter: () => ({
      ...node(),
      type: 'lowpass',
      Q: new Param(),
      frequency: new Param(),
    }),
  };
  return { ctx: ctx as unknown as SynthContext, gains, sources };
}

describe('sound recipes', () => {
  it.each(ALL)('%s is gentle: soft attacks, sane gains, short', (_id, r) => {
    expect(r.label.length).toBeGreaterThan(0);
    expect(r.voices.length).toBeGreaterThan(0);
    expect(recipeDuration(r)).toBeLessThanOrEqual(3);
    for (const v of r.voices) {
      expect(v.dur).toBeGreaterThan(0);
      expect(v.gain ?? 0.5).toBeGreaterThan(0);
      expect(v.gain ?? 0.5).toBeLessThanOrEqual(0.8);
      expect(v.attack ?? 0.005).toBeGreaterThanOrEqual(MIN_ATTACK);
      if (v.kind === 'tone') {
        expect(v.attack ?? 0.005).toBeGreaterThanOrEqual(0.003);
        expect(v.freq).toBeGreaterThanOrEqual(40);
        expect(v.freq).toBeLessThanOrEqual(8000);
        if (v.wave === 'square' || v.wave === 'sawtooth') {
          // Bright waves only quiet and through a lowpass: no harsh buzz.
          expect(v.gain ?? 0.5).toBeLessThanOrEqual(0.25);
          expect(v.filter?.type).toBe('lowpass');
        }
      }
    }
  });

  it('module recipes are namespaced', () => {
    for (const [id] of ALL) {
      if (!(id in BASE_SOUNDS)) expect(id).toMatch(/^[a-z]+\/[a-zA-Z]+$/);
    }
  });
});

describe('playRecipe', () => {
  it.each(ALL)('%s: every envelope starts and ends at 0, sources stop after it', (_id, r) => {
    const { ctx, gains, sources } = fakeContext();
    const noise = {} as AudioBuffer;
    const n = playRecipe(ctx, {} as AudioNode, r, { when: 1, gain: 1, noise, random: () => 0.5 });
    expect(n).toBe(r.voices.length);
    const envelopes = gains.filter((g) => g.gain.events.length > 0);
    expect(envelopes).toHaveLength(r.voices.length);
    const lastStop = Math.max(...sources.map((s) => s.stop));
    for (const { gain } of envelopes) {
      const ev = gain.events;
      const [first] = ev;
      const last = ev[ev.length - 1]!;
      expect(first![0]).toBe('set');
      expect(first![1]).toBe(0);
      expect(last[0]).toBe('lin');
      expect(last[1]).toBe(0);
      for (let i = 1; i < ev.length; i++) expect(ev[i]![2]).toBeGreaterThanOrEqual(ev[i - 1]![2]);
      // The attack is a ramp, never a jump.
      expect(ev[1]![0]).toBe('lin');
      expect(ev[1]![2] - first![2]).toBeGreaterThanOrEqual(MIN_ATTACK - 1e-9);
      for (const e of ev) if (e[0] === 'exp') expect(e[1]).toBeGreaterThan(0);
      expect(Math.max(...ev.map((e) => e[1]))).toBeLessThanOrEqual(1);
      expect(lastStop).toBeGreaterThan(last[2]);
    }
    for (const s of sources) {
      expect(s.start).toBeGreaterThanOrEqual(1);
      expect(s.stop).toBeGreaterThan(s.start);
    }
  });

  it('scales by the gain and skips noise voices without a buffer', () => {
    const r: SoundRecipe = {
      label: 't',
      voices: [
        { kind: 'tone', freq: 440, dur: 0.2, gain: 0.5 },
        { kind: 'noise', dur: 0.2 },
      ],
    };
    const { ctx, gains } = fakeContext();
    expect(playRecipe(ctx, {} as AudioNode, r, { when: 0, gain: 0.5, noise: null })).toBe(1);
    expect(gains[0]!.gain.events[1]).toEqual(['lin', 0.25, 0.005]);
  });
});
