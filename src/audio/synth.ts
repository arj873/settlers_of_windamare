/**
 * Plays a SoundRecipe on a Web Audio graph. Every voice gets its own gain envelope that starts
 * at 0, ramps linearly to the peak (at least MIN_ATTACK), decays exponentially to near silence
 * and ramps to exactly 0 before its source stops, so nothing clicks or pops.
 */
import type { FilterSpec, SoundRecipe, Voice } from './types';

/** Shortest attack (s): faster ramps click audibly on tones. */
export const MIN_ATTACK = 0.002;
const SILENT = 0.0001;
/** After the decay: final ramp to 0, then stop the source. */
const TAIL = 0.01;

/** The subset of BaseAudioContext the synth uses (tests pass a recording fake). */
export type SynthContext = Pick<
  BaseAudioContext,
  'createGain' | 'createOscillator' | 'createBufferSource' | 'createBiquadFilter'
>;

export interface PlayOptions {
  /** Context time to start at. */
  when: number;
  /** Gain multiplier (cue level × anything else). */
  gain: number;
  /** One second of white noise (`noiseBuffer`), needed by noise voices. */
  noise: AudioBuffer | null;
  /** Random number in [0, 1) for `vary` (injectable for tests). */
  random?: () => number;
}

/** Length of a recipe in seconds (until its last voice has stopped). */
export function recipeDuration(recipe: SoundRecipe): number {
  return Math.max(0, ...recipe.voices.map((v) => (v.at ?? 0) + voiceLength(v) + TAIL));
}

function voiceLength(v: Voice): number {
  return Math.max(v.dur, Math.max(v.attack ?? 0.005, MIN_ATTACK) + (v.hold ?? 0) + 0.01);
}

/** Schedule every voice of `recipe` into `dest`. Returns the number of voices started. */
export function playRecipe(
  ctx: SynthContext,
  dest: AudioNode,
  recipe: SoundRecipe,
  opts: PlayOptions,
): number {
  const random = opts.random ?? Math.random;
  const cents = recipe.vary ? (random() * 2 - 1) * recipe.vary : 0;
  const level = opts.gain * (recipe.gain ?? 1);
  let started = 0;
  for (const v of recipe.voices) {
    if (v.kind === 'noise' && !opts.noise) continue;
    const peak = (v.gain ?? 0.5) * level;
    if (!(peak > SILENT)) continue;
    playVoice(ctx, dest, v, opts.when + (v.at ?? 0), peak, cents, opts.noise, random);
    started++;
  }
  return started;
}

function playVoice(
  ctx: SynthContext,
  dest: AudioNode,
  v: Voice,
  t0: number,
  peak: number,
  cents: number,
  noise: AudioBuffer | null,
  random: () => number,
): void {
  const attack = Math.max(v.attack ?? 0.005, MIN_ATTACK);
  const hold = v.hold ?? 0;
  const end = t0 + voiceLength(v);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + attack);
  if (hold > 0) env.gain.setValueAtTime(peak, t0 + attack + hold);
  env.gain.exponentialRampToValueAtTime(SILENT, end);
  env.gain.linearRampToValueAtTime(0, end + TAIL);
  env.connect(dest);

  let input: AudioNode = env;
  if (v.filter) {
    const f = makeFilter(ctx, v.filter, t0, end, cents);
    f.connect(env);
    input = f;
  }

  const sources: AudioScheduledSourceNode[] = [];
  if (v.kind === 'noise') {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.connect(input);
    // From a random point of the buffer, so repeated bursts differ.
    src.start(t0, random() * 0.9);
    src.stop(end + TAIL * 2);
    sources.push(src);
  } else {
    const ratio = 2 ** (cents / 1200);
    const glideEnd = t0 + Math.min(v.glide ?? v.dur, v.dur);
    const partials: readonly (readonly [number, number])[] = [[1, 1], ...(v.partials ?? [])];
    for (const [mult, rel] of partials) {
      const osc = ctx.createOscillator();
      osc.type = mult === 1 ? (v.wave ?? 'sine') : 'sine';
      osc.frequency.setValueAtTime(v.freq * mult * ratio, t0);
      if (v.to) osc.frequency.exponentialRampToValueAtTime(v.to * mult * ratio, glideEnd);
      if (rel === 1) {
        osc.connect(input);
      } else {
        const g = ctx.createGain();
        g.gain.value = rel;
        osc.connect(g);
        g.connect(input);
      }
      osc.start(t0);
      osc.stop(end + TAIL * 2);
      sources.push(osc);
    }
  }
  // Free the graph once the last source has stopped.
  const last = sources[sources.length - 1];
  if (last) last.onended = () => env.disconnect();
}

function makeFilter(
  ctx: SynthContext,
  spec: FilterSpec,
  t0: number,
  end: number,
  cents: number,
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  const ratio = 2 ** (cents / 1200);
  f.type = spec.type;
  f.Q.value = spec.q ?? 1;
  f.frequency.setValueAtTime(spec.freq * ratio, t0);
  if (spec.to) f.frequency.exponentialRampToValueAtTime(spec.to * ratio, end);
  return f;
}

/** One second of white noise; voices loop it from a random point. */
export function noiseBuffer(ctx: Pick<BaseAudioContext, 'createBuffer' | 'sampleRate'>) {
  const len = Math.floor(ctx.sampleRate);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}
