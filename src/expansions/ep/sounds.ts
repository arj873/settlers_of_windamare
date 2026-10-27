/** Explorers & Pirates sound effects (A1): a ship sailing (wind, waves, a ship's bell) and a new ship. */
import type { ExtensionSounds, SoundCue } from '../../audio/types';
import { NOTE, knock, noise, ting } from '../../audio/voices';
import type { GameState } from '../../engine';
import { EP, type EpSlice } from './engine/state';

const shipsOf = (s: GameState) => (s.ext[EP] as Partial<EpSlice> | undefined)?.ships ?? [];

export const epSounds: ExtensionSounds<GameState> = {
  recipes: {
    'ep/shipSail': {
      label: 'E&P: ship sails',
      vary: 40,
      voices: [
        noise(0, 0.8, {
          attack: 0.3,
          gain: 0.55,
          filter: { type: 'bandpass', freq: 400, to: 900, q: 0.7 },
        }),
        ting(NOTE.D6, 0.05, { gain: 0.12, dur: 0.9 }),
      ],
    },
    'ep/shipBuild': {
      label: 'E&P: build ship',
      vary: 30,
      voices: [
        knock(220, 0, { gain: 0.5 }),
        knock(280, 0.1, { gain: 0.32 }),
        noise(0.18, 0.4, {
          attack: 0.02,
          gain: 0.25,
          filter: { type: 'lowpass', freq: 2200, to: 400 },
        }),
      ],
    },
  },
  cues(prev, next, ctx) {
    const a = shipsOf(prev);
    const b = shipsOf(next);
    if (a === b) return [];
    const out: SoundCue[] = [];
    for (const ship of b) {
      const was = a.find((s) => s.id === ship.id);
      if (!was) out.push({ id: 'ep/shipBuild', level: ctx.levelOf(ship.owner) });
      else if (was.edge !== ship.edge)
        out.push({ id: 'ep/shipSail', level: ctx.levelOf(ship.owner) });
    }
    return out;
  },
};
