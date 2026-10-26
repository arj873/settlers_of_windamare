import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../../src/engine';
import { freshGame, midGame } from '../../src/engine/fixtures';
import { formatControls, formatLogEntry, formatStatus, legalKinds, uiMismatches } from './format';
import type { Snapshot, UiScan } from './protocol';

const UI: UiScan = {
  cover: null,
  screen: null,
  winnerText: null,
  hint: 'Your turn — build, trade or end your turn',
  dialogTitle: null,
  dialogText: [],
  controls: [
    { id: 'b1', label: 'Road', enabled: true, on: false, inDialog: false },
    { id: 'b2', label: 'City', enabled: false, on: false, inDialog: false },
  ],
  steppers: [],
  toasts: [],
  hand: null,
  panels: [],
  diceTotal: null,
};

const snap = (state: GameState, viewer: number, ui: Partial<UiScan> = {}): Snapshot => ({
  state,
  viewer,
  legal: legalActions(state),
  targets: [],
  ui: { ...UI, ...ui },
  consoleCount: 0,
});

describe('formatStatus', () => {
  it('shows the acting seat its task, hand, prompt and buttons', () => {
    const s = midGame();
    const out = formatStatus(snap(s, 1), 1, 0);
    expect(out).toMatch(/^== Blue \(seat 2\) \| turn 12 \| phase main/);
    expect(out).toContain('YOU MUST: Your turn');
    expect(out).toContain('Prompt: "Your turn');
    expect(out).toContain('Buttons: [Road]');
    expect(out).toContain('Disabled: [City]');
    expect(out).toContain('Log (last 8):');
  });

  it('hides the screen (and its secrets) from a seat that is not viewing', () => {
    const out = formatStatus(snap(midGame(), 1), 0, 2);
    expect(out).toContain('NOT YOUR MOMENT: screen is with Blue');
    expect(out).not.toContain('Buttons:');
    expect(out).not.toContain('Prompt:');
    expect(out).toContain('Console: 2 new');
  });

  it('tells a covered seat to pass', () => {
    const out = formatStatus(snap(freshGame(3), 0, { cover: 'Pass to Red' }), 0, 0);
    expect(out).toContain('run `pass` first');
    expect(out).not.toContain('Buttons:');
  });
});

describe('helpers', () => {
  it('summarises legal action kinds for one seat', () => {
    const s = freshGame(3);
    expect(legalKinds(legalActions(s), 0)).toBe('placeSetupSettlement x54');
    expect(legalKinds(legalActions(s), 1)).toBe('none');
  });

  it('does not repeat a name the log text already has', () => {
    const s = freshGame(3);
    expect(formatLogEntry(s, { turn: 2, player: 0, text: 'Red rolled 8' })).toBe(
      '  T2 Red rolled 8',
    );
    expect(formatLogEntry(s, { turn: 0, player: 1, text: 'placed a road' })).toBe(
      '  Setup Blue: placed a road',
    );
  });

  it('flags HUD numbers that disagree with the engine', () => {
    const s = midGame();
    const me = s.players[1];
    if (!me) throw new Error('fixture');
    const hand = { ...me.resources, brick: me.resources.brick + 1 };
    const bad = uiMismatches(s, { ...UI, hand, diceTotal: 3 }, 1);
    expect(bad[0]).toContain(`HUD hand shows brick ${hand.brick}`);
    expect(bad.some((m) => m.startsWith('dice show 3'))).toBe(true);
    expect(uiMismatches(s, { ...UI, hand: { ...me.resources } }, 1)).toEqual([]);
  });

  it('lists dialog controls and steppers before the bar', () => {
    const lines = formatControls({
      ...UI,
      dialogTitle: 'Discard 4 cards',
      steppers: [
        { label: 'Brick', value: 1, decId: 's1', incId: 's2', canDec: true, canInc: true },
      ],
      controls: [
        ...UI.controls,
        { id: 'b3', label: 'Discard', enabled: false, on: false, inDialog: true },
      ],
    });
    expect(lines[0]).toBe('Dialog "Discard 4 cards"');
    expect(lines.join('\n')).toContain('steppers (use `set <label> <n>`): Brick=1');
    expect(lines.join('\n')).toContain('disabled: [Discard]');
  });
});
