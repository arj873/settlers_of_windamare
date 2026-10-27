/** Traders & Barbarians sound effects (A1): a wagon rolling one step (wooden wheels, rumble). */
import type { ExtensionSounds, SoundCue } from '../../audio/types';
import { knock, noise } from '../../audio/voices';
import type { GameState } from '../../engine';
import { TB, type TbSlice } from './engine/state';

const wagonsOf = (s: GameState) =>
  (s.ext[TB] as Partial<TbSlice> | undefined)?.traders?.wagons ?? [];

export const tbSounds: ExtensionSounds<GameState> = {
  recipes: {
    'tb/wagonMove': {
      label: 'T&B: wagon moves',
      vary: 40,
      voices: [
        knock(150, 0, { gain: 0.42, dur: 0.1 }),
        knock(170, 0.11, { gain: 0.34, dur: 0.1 }),
        knock(150, 0.22, { gain: 0.28, dur: 0.1 }),
        noise(0, 0.35, { attack: 0.05, gain: 0.16, filter: { type: 'lowpass', freq: 600 } }),
      ],
    },
  },
  cues(prev, next, ctx) {
    const a = wagonsOf(prev);
    const b = wagonsOf(next);
    if (a === b) return [];
    const out: SoundCue[] = [];
    b.forEach((v, p) => {
      const was = a[p];
      if (v && was && v !== was) out.push({ id: 'tb/wagonMove', level: ctx.levelOf(p) });
    });
    return out;
  },
};
