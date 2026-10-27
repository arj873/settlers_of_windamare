/** A1: the expansion modules' sound cue hooks (C&K barbarians, ships, wagons). */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../engine';
import { midGame } from '../engine/fixtures';
import { cueContext, soundCues } from '../game/sounds';
import { HUD_EXTENSIONS, extensionSoundRecipes, extensionSounds } from '../ui/expansions';
import { ckSounds } from './ck/sounds';
import { epSounds } from './ep/sounds';
import { seafarersSounds } from './seafarers/sounds';
import { tbSounds } from './tb/sounds';

const withExt = (id: string, slice: unknown): GameState => ({ ...midGame(), ext: { [id]: slice } });
// Seat 1 plays here, seat 3 is a bot.
const ctx = cueContext({
  viewer: 1,
  local: [false, true, false, false],
  bots: [false, false, false, true],
});

describe('module sound hooks', () => {
  it('C&K: the barbarians sail closer, then attack', () => {
    const a = withExt('ck', { barbarian: 3, attacks: 0 });
    const b = withExt('ck', { barbarian: 4, attacks: 0 });
    const c = withExt('ck', { barbarian: 0, attacks: 1 });
    expect(ckSounds.cues!(a, b, ctx)).toEqual([{ id: 'ck/barbarianAdvance', level: 'normal' }]);
    expect(ckSounds.cues!(b, c, ctx)).toEqual([{ id: 'ck/barbarianAttack', level: 'high' }]);
    expect(ckSounds.cues!(a, a, ctx)).toEqual([]);
  });

  it('Seafarers: a ship built, a ship moved', () => {
    const a = withExt('seafarers', { ships: { 'e:0,0,E': { owner: 1 } } });
    const built = withExt('seafarers', {
      ships: { 'e:0,0,E': { owner: 1 }, 'e:1,0,E': { owner: 3 } },
    });
    const moved = withExt('seafarers', { ships: { 'e:0,0,SE': { owner: 1 } } });
    expect(seafarersSounds.cues!(a, built, ctx)).toEqual([
      { id: 'seafarers/shipBuild', level: 'low' },
    ]);
    expect(seafarersSounds.cues!(a, moved, ctx)).toEqual([
      { id: 'seafarers/shipMove', level: 'high' },
    ]);
  });

  it('E&P: a ship sails, a new ship', () => {
    const a = withExt('ep', { ships: [{ id: 1, owner: 1, edge: 'e:0,0,E', cargo: [] }] });
    const sailed = withExt('ep', { ships: [{ id: 1, owner: 1, edge: 'e:0,0,SE', cargo: [] }] });
    const built = withExt('ep', {
      ships: [
        { id: 1, owner: 1, edge: 'e:0,0,E', cargo: [] },
        { id: 2, owner: 0, edge: 'e:1,0,E', cargo: [] },
      ],
    });
    expect(epSounds.cues!(a, sailed, ctx)).toEqual([{ id: 'ep/shipSail', level: 'high' }]);
    expect(epSounds.cues!(a, built, ctx)).toEqual([{ id: 'ep/shipBuild', level: 'normal' }]);
  });

  it('T&B: a wagon moves', () => {
    const a = withExt('tb', { traders: { wagons: ['v:0,0,N', 'v:1,0,N', null, null] } });
    const b = withExt('tb', { traders: { wagons: ['v:0,0,N', 'v:1,0,S', null, null] } });
    expect(tbSounds.cues!(a, b, ctx)).toEqual([{ id: 'tb/wagonMove', level: 'high' }]);
    // A T&B game without wagons is silent.
    expect(tbSounds.cues!(withExt('tb', {}), withExt('tb', {}), ctx)).toEqual([]);
  });

  it('hooks run through soundCues for the active modules only', () => {
    const settings = {
      ...midGame().settings,
      expansions: ['ck'] as GameState['settings']['expansions'],
    };
    const a = { ...withExt('ck', { barbarian: 1, attacks: 0 }), settings };
    const b = { ...withExt('ck', { barbarian: 2, attacks: 0 }), settings };
    const seats = { viewer: 1, local: [false, true, false, false], bots: [] };
    expect(soundCues(a, b, seats, extensionSounds(b))).toEqual([
      { id: 'ck/barbarianAdvance', level: 'normal' },
    ]);
    expect(soundCues(a, b, seats, extensionSounds(midGame()))).toEqual([]);
  });

  it('every module recipe is registered under its module id', () => {
    const recipes = extensionSoundRecipes();
    for (const id of [
      'ck/barbarianAdvance',
      'ck/barbarianAttack',
      'seafarers/shipBuild',
      'seafarers/shipMove',
      'ep/shipSail',
      'tb/wagonMove',
    ]) {
      expect(recipes[id]).toBeDefined();
    }
    for (const x of HUD_EXTENSIONS) {
      for (const id of Object.keys(x.sounds?.recipes ?? {}))
        expect(id.startsWith(`${x.id}/`)).toBe(true);
    }
  });
});
