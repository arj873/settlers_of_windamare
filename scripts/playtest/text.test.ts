import { describe, expect, it } from 'vitest';
import { matchChoice, normalize, parseFlags, parseSeat, slugify } from './text';

describe('normalize', () => {
  it('drops emoji, punctuation and case', () => {
    expect(normalize('🎲 Roll dice!')).toBe('roll dice');
    expect(normalize('⚔️Knight ×1')).toBe('knight ×1');
    expect(normalize('  Give:   Brick 4:1 ')).toBe('give: brick 4:1');
  });
});

describe('matchChoice', () => {
  const bar = ['Roll dice', 'Road', 'Settlement', 'City', 'Buy card', 'Bank', 'Trade', 'End turn'];

  it('prefers an exact label over looser matches', () => {
    expect(matchChoice('Road', bar)).toEqual({ kind: 'one', index: 1, how: 'exact' });
    expect(matchChoice('end turn', bar)).toEqual({ kind: 'one', index: 7, how: 'exact' });
  });

  it('accepts word prefixes and substrings when they are unique', () => {
    expect(matchChoice('roll', bar)).toMatchObject({ kind: 'one', index: 0, how: 'fuzzy' });
    expect(matchChoice('settle', bar)).toMatchObject({ kind: 'one', index: 2 });
    expect(matchChoice('buy', bar)).toMatchObject({ kind: 'one', index: 4 });
  });

  it('never guesses between several fuzzy hits', () => {
    // "ro" prefixes both "Roll dice" and "Road".
    expect(matchChoice('ro', bar)).toEqual({ kind: 'many', indices: [0, 1] });
    expect(matchChoice('Trade', ['Seat2: Trade', 'Seat3: Trade'])).toEqual({
      kind: 'many',
      indices: [0, 1],
    });
  });

  it('breaks a tie with the preference (dialog controls over the action bar)', () => {
    const labels = ['Trade', 'Give: Brick 4:1', 'Trade'];
    const inDialog = [false, true, true];
    expect(matchChoice('Trade', labels, (i) => inDialog[i] === true)).toEqual({
      kind: 'one',
      index: 2,
      how: 'exact',
    });
  });

  it('prefers a label that starts with the query words', () => {
    // "knight" also prefixes a word of "Collapse Cities & Knights".
    const labels = ['Collapse Cities & Knights', 'Knight 2/2', 'Command'];
    expect(matchChoice('Knight', labels)).toMatchObject({ kind: 'one', index: 1 });
    expect(matchChoice('Ship 2', ['Ship 1 settler: Select', 'Ship 2 empty: Select'])).toMatchObject(
      { kind: 'one', index: 1 },
    );
  });

  it('reports no match', () => {
    expect(matchChoice('fly', bar)).toEqual({ kind: 'none' });
    expect(matchChoice('', bar)).toEqual({ kind: 'none' });
  });
});

describe('parseSeat', () => {
  it('reads 1-based seats up to the game size', () => {
    expect(parseSeat('1')).toBe(0);
    expect(parseSeat('Seat3')).toBe(2);
    expect(parseSeat('seat 2')).toBe(1);
    expect(parseSeat('4')).toBeNull();
    expect(parseSeat('6', 8)).toBe(5);
    expect(parseSeat('9', 8)).toBeNull();
    expect(parseSeat('0')).toBeNull();
    expect(parseSeat('x')).toBeNull();
  });
});

describe('slugify / parseFlags', () => {
  it('makes file-safe slugs', () => {
    expect(slugify("Robber can't move!")).toBe('robber-can-t-move');
    expect(slugify('!!!')).toBe('bug');
  });

  it('collects multi-word flag values', () => {
    const r = parseFlags(['a', '--title', 'Two', 'words', '--severity=minor', '--headed']);
    expect(r.positional).toEqual(['a']);
    expect(r.flags).toEqual({ title: 'Two words', severity: 'minor', headed: '' });
  });
});
