/**
 * Module hand cards (#cardinfo) in seeded bot games, every mode with cards in the hand: a card is
 * playable exactly when a legal action of its holder plays it, its line says so, and no refusal
 * falls back to the generic text.
 */
import { describe, expect, it } from 'vitest';
import { createRandomBot } from '../bots';
import { botSeedFor, newGame, randomSource, runGame, type GameSetup } from '../bots/runner';
import { legalActions, type Action, type GameState } from '../engine';
import { handCardLine, handCardsFor } from './expansions';

const GENERIC = /^Can't be played right now/;

/** The legal actions of `p` that play the module card `key`. */
function playsOf(legal: readonly Action[], p: number, key: string): Action[] {
  const own = legal.filter((a) => a.player === p);
  if (key === 'ck/alchemist') return own.filter((a) => a.type === 'ck/alchemist');
  if (key === 'tb/swift') return own.filter((a) => a.type === 'tb/swiftJourney');
  if (key.startsWith('ck/')) {
    const card = key.slice('ck/'.length);
    return own.filter((a) => a.type === 'ck/play' && (a as { card?: unknown }).card === card);
  }
  return [];
}

/** Checks every player's module cards in `state`; adds "key: first words of the line" to `seen`. */
function check(state: GameState, seen: Set<string>): void {
  const legal = legalActions(state);
  for (const p of state.players) {
    const view = { viewer: p.id, legal, isBotTurn: false };
    for (const card of handCardsFor(state, view, () => undefined)) {
      const line = handCardLine(state, view, card);
      if (card.kind === 'good') {
        expect(card.play, card.key).toBeNull();
        seen.add(card.key);
        continue;
      }
      expect(card.count, card.key).toBeGreaterThan(0);
      const plays = playsOf(legal, p.id, card.key);
      expect(card.play !== null, `${card.key} playable (${line})`).toBe(plays.length > 0);
      if (card.play && 'action' in card.play) expect(legal).toContain(card.play.action);
      expect(line, card.key).not.toBeNull();
      expect(line!.startsWith('Playable now'), `${card.key}: ${line}`).toBe(card.play !== null);
      expect(line, card.key).not.toMatch(GENERIC);
      expect(line, `${card.key} in ${state.phase.kind}`).not.toMatch(/the current step/);
      seen.add(`${card.key}: ${line!.split(/[.:(]/)[0]}`);
    }
  }
}

function play(setup: GameSetup, maxSteps: number, seen: Set<string>): void {
  const seed = setup.seed;
  const result = runGame({
    initial: newGame(setup),
    maxSteps,
    source: randomSource(createRandomBot({ progressBias: 0.5 }), botSeedFor(seed)),
    onStep: ({ state }) => check(state, seen),
  });
  expect(result.failure?.message ?? null).toBeNull();
}

describe('module hand cards in bot games (#cardinfo)', () => {
  it('C&K: progress cards are playable exactly when the engine says so', () => {
    const seen = new Set<string>();
    play({ seed: 2, players: 4, mode: 'ck', scenario: 'ck/classic' }, 2500, seen);
    play({ seed: 7, players: 3, mode: 'ck', scenario: 'ck/starter' }, 2500, seen);
    const lines = [...seen].join('\n');
    expect(lines).toMatch(/^ck\/\w+: Playable now$/m);
    expect(lines).toMatch(/^ck\/\w+: Not your turn$/m);
    expect(lines).toMatch(/^ck\/\w+: Roll the dice first$/m);
    expect(lines).toMatch(/^ck\/\w+: Not now$/m); // it would have no effect
    expect(seen).toContain('ck/alchemist: Playable now');
    expect(seen).toContain('ck/paper');
  }, 60_000);

  it('Seafarers + C&K, Barbarian Attack + C&K, E&P + C&K, T&B + C&K', () => {
    const seen = new Set<string>();
    play({ seed: 3, players: 4, mode: 'seafarers+ck' }, 2000, seen);
    play({ seed: 4, players: 4, mode: 'ba+ck' }, 2000, seen);
    play({ seed: 5, players: 4, mode: 'ep+ck' }, 2000, seen);
    play({ seed: 6, players: 4, mode: 'tb+ck' }, 2000, seen);
    expect([...seen].join('\n')).toMatch(/^ck\/\w+: Playable now$/m);
  }, 60_000);

  it('T&B: Swift Journey, coins, fish, the old boot, trade tokens', () => {
    const seen = new Set<string>();
    play({ seed: 8, players: 4, mode: 'tb', scenario: 'tb/traders' }, 3000, seen);
    play({ seed: 9, players: 4, mode: 'tb', scenario: 'tb/fishermen' }, 2000, seen);
    play({ seed: 10, players: 2, mode: 'tb', scenario: 'tb/variants' }, 1500, seen);
    for (const s of ['Playable now', 'Not your turn', 'Bought this turn']) {
      expect(seen).toContain(`tb/swift: ${s}`);
    }
    for (const k of ['tb/gold', 'tb/fish', 'tb/boot', 'tb/tokens']) expect(seen).toContain(k);
  }, 60_000);

  it('E&P gold, Oil Springs oil, Seafarers cloth', () => {
    const seen = new Set<string>();
    play({ seed: 11, players: 4, mode: 'ep', scenario: 'ep/full' }, 1500, seen);
    play({ seed: 12, players: 4, mode: 'oil' }, 1500, seen);
    play(
      { seed: 13, players: 4, mode: 'seafarers', scenario: 'seafarers/clothForCatan' },
      1500,
      seen,
    );
    expect(seen).toEqual(new Set(['ep/gold', 'oil/oil', 'seafarers/cloth']));
  }, 60_000);
});
