/** Seafarers sound effects (A1): a ship built (hammer + splash) and a ship moved (water). */
import type { ExtensionSounds, SoundCue } from '../../audio/types';
import { knock, noise, swish } from '../../audio/voices';
import type { GameState } from '../../engine';
import { SEAFARERS } from './engine/maps';
import type { SeaSlice } from './engine/state';

const shipsOf = (s: GameState) => (s.ext[SEAFARERS] as Partial<SeaSlice> | undefined)?.ships ?? {};

export const seafarersSounds: ExtensionSounds<GameState> = {
  recipes: {
    'seafarers/shipBuild': {
      label: 'Seafarers: build ship',
      vary: 30,
      voices: [
        knock(200, 0, { gain: 0.5 }),
        knock(260, 0.1, { gain: 0.35 }),
        noise(0.18, 0.45, {
          attack: 0.02,
          gain: 0.28,
          filter: { type: 'lowpass', freq: 2500, to: 400 },
        }),
      ],
    },
    'seafarers/shipMove': {
      label: 'Seafarers: move ship',
      vary: 50,
      voices: [
        swish(500, 1100, 0, 0.6, {
          gain: 0.6,
          filter: { type: 'bandpass', freq: 500, to: 1100, q: 0.8 },
        }),
        swish(1200, 600, 0.25, 0.5, { gain: 0.35 }),
      ],
    },
  },
  cues(prev, next, ctx) {
    const a = shipsOf(prev);
    const b = shipsOf(next);
    if (a === b) return [];
    const out: SoundCue[] = [];
    const owners = new Set([...Object.values(a), ...Object.values(b)].map((s) => s.owner));
    for (const p of owners) {
      const before = Object.keys(a).filter((e) => a[e as keyof typeof a]?.owner === p);
      const after = Object.keys(b).filter((e) => b[e as keyof typeof b]?.owner === p);
      if (after.length > before.length)
        out.push({ id: 'seafarers/shipBuild', level: ctx.levelOf(p) });
      else if (after.length === before.length && after.some((e) => !before.includes(e))) {
        out.push({ id: 'seafarers/shipMove', level: ctx.levelOf(p) });
      }
    }
    return out;
  },
};
