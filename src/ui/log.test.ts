import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../engine';
import { groupLog, parseLogText, secretText, tokensText, youTokens, type LogToken } from './log';

const players = [
  { id: 0, name: 'Red' },
  { id: 1, name: 'Blue Bot' },
  { id: 2, name: 'Blue' },
];

/** Compact form for assertions. */
const show = (tokens: LogToken[]) =>
  tokens
    .map((t) => {
      switch (t.kind) {
        case 'text':
          return t.text;
        case 'player':
          return `<P${t.id}>`;
        case 'resource':
          return `[${t.count} ${t.resource}]`;
        case 'dice':
          return t.faces ? `[dice ${t.total}=${t.faces.join('+')}]` : `[dice ${t.total}]`;
        case 'piece':
          return `[${t.piece}]`;
        case 'dev':
          return `[dev ${t.card ?? '?'}]`;
        case 'robber':
          return '[robber]';
        case 'award':
          return `[${t.award}]`;
      }
    })
    .join('');

describe('parseLogText', () => {
  it('turns names, rolls and pieces into tokens', () => {
    expect(show(parseLogText('Red rolled 8 (3+5)', players))).toBe('<P0> rolled [dice 8=3+5]');
    // Logs from before T14 (old saves) have no faces.
    expect(show(parseLogText('Red rolled 8', players))).toBe('<P0> rolled [dice 8]');
    expect(show(parseLogText('Red built a city', players))).toBe('<P0> built [city]');
    expect(show(parseLogText('Red placed a free road', players))).toBe('<P0> placed free [road]');
    expect(show(parseLogText('Red moved the robber', players))).toBe('<P0> moved [robber]');
  });

  it('prefers the longest player name', () => {
    expect(show(parseLogText('Blue Bot stole from Blue', players))).toBe('<P1> stole from <P2>');
  });

  it('renders resource lists as adjacent icons', () => {
    expect(show(parseLogText('Red discarded 1 brick, 2 wool', players))).toBe(
      '<P0> discarded [1 brick][2 wool]',
    );
    expect(show(parseLogText('Red traded 4 ore for 1 grain with the bank', players))).toBe(
      '<P0> traded [4 ore] for [1 grain] with the bank',
    );
    expect(show(parseLogText('Red took brick and ore', players))).toBe(
      '<P0> took [1 brick] and [1 ore]',
    );
  });

  it('marks development cards and awards', () => {
    expect(show(parseLogText('Red bought a development card', players))).toBe(
      '<P0> bought [dev ?]',
    );
    expect(show(parseLogText('Red played a Knight', players))).toBe(
      '<P0> played [dev knight] Knight',
    );
    expect(show(parseLogText('Red played a knight', players))).toBe(
      '<P0> played [dev knight] Knight',
    );
    expect(show(parseLogText('Red played Year of Plenty', players))).toBe(
      '<P0> played [dev yearOfPlenty] Year of Plenty',
    );
    expect(show(parseLogText('Red took Longest Road', players))).toBe(
      '<P0> took [longestRoad] Longest Road',
    );
  });

  it('keeps unknown text and does not match inside words', () => {
    expect(show(parseLogText('Setup complete', players))).toBe('Setup complete');
    expect(show(parseLogText('Redwood orebody', players))).toBe('Redwood orebody');
  });

  it('treats names as plain strings, not patterns', () => {
    const odd = [{ id: 0, name: 'a.b (x)' }];
    expect(show(parseLogText('a.b (x) rolled 3', odd))).toBe('<P0> rolled [dice 3]');
  });
});

describe('groupLog', () => {
  const log: LogEntry[] = [
    { turn: 0, player: null, text: 'Game created (beginner board, seed 1)' },
    { turn: 0, player: 0, text: 'Red placed a settlement' },
    { turn: 0, player: 0, text: 'Red placed a road' },
    { turn: 0, player: 2, text: 'Blue placed a settlement' },
    { turn: 1, player: 0, text: 'Red rolled 6' },
    { turn: 1, player: 0, text: 'Red received 1 wool' },
    { turn: 1, player: 2, text: 'Blue received 2 brick' },
    { turn: 1, player: 0, text: 'Red ended the turn' },
    { turn: 2, player: 2, text: 'Blue rolled 7' },
  ];

  it('splits per turn and per setup player', () => {
    const groups = groupLog(log, players);
    expect(groups.map((g) => [g.turn, g.key])).toEqual([
      [0, 0],
      [0, 3],
      [1, 4],
      [2, 8],
    ]);
  });

  it('folds received lines after a roll into one production block', () => {
    const turn1 = groupLog(log, players)[2]!;
    expect(turn1.items.map((i) => i.kind)).toEqual(['line', 'production', 'line']);
    const prod = turn1.items[1]!;
    expect(prod.kind === 'production' && prod.rows.map((r) => [r.player, show(r.tokens)])).toEqual([
      [0, '[1 wool]'],
      [2, '[2 brick]'],
    ]);
  });

  it('does not fold a received line that does not follow a roll', () => {
    const items = groupLog([{ turn: 3, player: 0, text: 'Red received 1 ore' }], players)[0]!.items;
    expect(items[0]!.kind).toBe('line');
  });
});

describe('resource words in log texts (#47)', () => {
  it('reads the new names and lines saved before the rename', () => {
    const kinds = (t: string) =>
      parseLogText(t, players).flatMap((x) =>
        x.kind === 'resource' ? [[x.resource, x.count]] : [],
      );
    expect(kinds('Red received 2 sheep, 1 wheat')).toEqual([
      ['wool', 2],
      ['grain', 1],
    ]);
    expect(kinds('Red received 2 wool, 1 grain')).toEqual([
      ['wool', 2],
      ['grain', 1],
    ]);
    expect(kinds('Red harvested wheat (+1 food)')).toEqual([]);
  });
});

describe('private steal texts (#32)', () => {
  const entry: LogEntry = {
    turn: 4,
    player: 0,
    text: 'Red stole from Blue',
    secret: [{ to: [0, 2], text: 'Red stole 1 sheep from Blue' }],
  };
  const line = (viewer: number | null) => {
    const item = groupLog([entry], players, viewer)[0]!.items[0]!;
    if (item.kind !== 'line') throw new Error('not a line');
    return item;
  };
  it('thief and victim read the card, their own name as You / you', () => {
    expect(show(line(0).tokens)).toBe('You stole [1 wool] from <P2>');
    expect(line(0).secret).toBe(true);
    expect(show(line(2).tokens)).toBe('<P0> stole [1 wool] from you');
  });
  it('everyone else reads the public text', () => {
    expect(show(line(1).tokens)).toBe('<P0> stole from <P2>');
    expect(line(1).secret).toBeUndefined();
    expect(show(line(null).tokens)).toBe('<P0> stole from <P2>');
    expect(secretText(entry, -1)).toBeNull();
  });
  it('tokensText spells tokens out for a toast', () => {
    expect(tokensText(youTokens(parseLogText(entry.secret![0]!.text, players), 2), players)).toBe(
      'Red stole 1 sheep from you',
    );
  });
});
