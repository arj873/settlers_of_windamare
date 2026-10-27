/** C&K sound effects (A1): the barbarian ship sailing closer and the attack. */
import type { ExtensionSounds, SoundCue } from '../../audio/types';
import { NOTE, horn, noise, thud } from '../../audio/voices';
import type { GameState } from '../../engine';
import { CK, type CkSlice } from './engine/state';

const slice = (s: GameState) => s.ext[CK] as Partial<CkSlice> | undefined;

/** War drum: low thump with a soft skin rattle. */
const drum = (at: number, gain: number) => [
  thud(at, { freq: 95, to: 55, glide: 0.2, dur: 0.38, gain }),
  noise(at, 0.2, { gain: gain * 0.4, filter: { type: 'lowpass', freq: 260 } }),
];

export const ckSounds: ExtensionSounds<GameState> = {
  recipes: {
    'ck/barbarianAdvance': {
      label: 'C&K: barbarians sail closer',
      voices: [...drum(0, 0.65), ...drum(0.28, 0.5)],
    },
    'ck/barbarianAttack': {
      label: 'C&K: barbarian attack',
      voices: [
        horn(NOTE.D3, 0, 1.2, { attack: 0.25, hold: 0.4, gain: 0.22 }),
        horn(NOTE.A3, 0.06, 1.1, { attack: 0.25, hold: 0.35, gain: 0.1 }),
        ...drum(0, 0.6),
        ...drum(0.3, 0.5),
        ...drum(0.6, 0.55),
        ...drum(0.9, 0.7),
      ],
    },
  },
  cues(prev, next) {
    const a = slice(prev);
    const b = slice(next);
    if (!a || !b) return [];
    const out: SoundCue[] = [];
    if ((b.attacks ?? 0) > (a.attacks ?? 0)) out.push({ id: 'ck/barbarianAttack', level: 'high' });
    else if ((b.barbarian ?? 0) > (a.barbarian ?? 0)) {
      out.push({ id: 'ck/barbarianAdvance', level: 'normal' });
    }
    return out;
  },
};
