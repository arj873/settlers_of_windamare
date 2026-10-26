/** The T&B module: modes, scenarios, VP targets, refused variant combinations. */
import { describe, expect, it } from 'vitest';
import { createGame } from '../../../engine/createGame';
import { modeById } from '../../../engine/expansions/registry';
import { players, tbGame } from './testkit';

const make = (scenario: string, n: number, opts: Record<string, unknown> = {}) =>
  createGame({ seed: 1, players: players(n), mode: 'tb', scenario: `tb/${scenario}`, ...opts });

describe('the T&B mode', () => {
  it('offers the five scenarios and the variants for 2-6 players', () => {
    const m = modeById('tb');
    expect(m?.scenarios).toEqual([
      'tb/fishermen',
      'tb/rivers',
      'tb/caravans',
      'tb/barbarianAttack',
      'tb/traders',
      'tb/variants',
    ]);
    expect(m?.players).toEqual({ min: 2, max: 6 });
  });

  it('VP targets: 10 / 10 / 12 / 12 / 13, Harbormaster +1', () => {
    expect(make('fishermen', 4).settings.vpToWin).toBe(10);
    expect(make('rivers', 4).settings.vpToWin).toBe(10);
    expect(make('caravans', 4).settings.vpToWin).toBe(12);
    expect(make('barbarianAttack', 4).settings.vpToWin).toBe(12);
    expect(make('traders', 4).settings.vpToWin).toBe(13);
    expect(make('caravans', 4, { options: { tb: { harbormaster: true } } }).settings.vpToWin).toBe(
      13,
    );
  });

  it('picks the 5-6 boards for 5-6 players', () => {
    expect(make('fishermen', 5).settings.map).toBe('tb/fish30');
    expect(make('traders', 6).settings.map).toBe('tb/traders37');
    expect(make('variants', 5).settings.map).toBe('base56');
    expect(make('rivers', 5).settings.specialBuildPhase).toBe(true);
  });

  it('Catan for Two: 2 players allowed, but not in Barbarian Attack', () => {
    expect(make('variants', 2).players).toHaveLength(2);
    expect(() => make('barbarianAttack', 2)).toThrow(/players/);
  });

  it('refuses the robber variants without a robber and the paired turn with end-of-turn steps', () => {
    expect(() => make('traders', 4, { robberMode: 'friendly' })).toThrow(/no robber/);
    expect(() => make('barbarianAttack', 4, { robberMode: 'none' })).toThrow(/no robber/);
    expect(() => make('caravans', 4, { secondSettler: true })).toThrow(/end-of-turn/);
    expect(make('fishermen', 4, { robberMode: 'friendly' }).settings.robberMode).toBe('friendly');
    expect(make('rivers', 4, { secondSettler: true }).settings.secondSettler).toBe(true);
  });

  it('combines with Event Cards', () => {
    const s = make('traders', 4, { eventCards: true });
    expect(s.settings.eventCards).toBe(true);
    expect(tbGame('fishermen', 4, { eventCards: true }).eventDeck).toBeDefined();
  });
});
