// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createRandomBot } from '../../bots';
import { newGame, runGame } from '../../bots/runner';
import {
  emptyStats,
  statsOf,
  sumCounts,
  viewFor,
  type GameState,
  type GameStats,
} from '../../engine';
import { gameOverGame, midGame } from '../../engine/fixtures';
import { Hud } from '../hud';
import {
  awards,
  diceHistogram,
  formatDuration,
  luck,
  standings,
  STATS_TABS,
  total,
  vpSeries,
} from './model';

/** A real finished 4-player bot game (seeded; event cards optional). */
function finished(seed = 11, eventCards = false): GameState {
  const result = runGame({
    initial: newGame({ seed, players: 4, ...(eventCards ? { variants: { eventCards } } : {}) }),
    maxSteps: 8000,
    bot: createRandomBot({ progressBias: 0.5 }),
  });
  const s = result.finalState;
  if (s.phase.kind !== 'gameOver') throw new Error('bot game did not finish');
  return s;
}

const GAME = finished();

describe('stats model', () => {
  it('formatDuration: h:mm, unknown as a dash', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(42 * 60_000 + 59_000)).toBe('0:42');
    expect(formatDuration(96 * 60_000)).toBe('1:36');
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
  });

  it('standings: winner first, VP broken down into its parts', () => {
    // Red: settlement + 2 cities + Longest Road + 3 VP cards = 10.
    const rows = standings(gameOverGame());
    expect(rows[0]).toEqual({
      player: 0,
      total: 10,
      settlements: 1,
      cities: 2,
      vpCards: 3,
      longestRoad: true,
      largestArmy: false,
      other: 0,
    });
    for (const r of standings(GAME)) {
      expect(
        r.settlements + 2 * r.cities + r.vpCards + 2 * +r.longestRoad + 2 * +r.largestArmy,
      ).toBe(r.total);
    }
    expect(standings(GAME)[0]?.player).toBe(GAME.winner);
  });

  it('dice histogram: all rolls, expected counts sum to the same total', () => {
    const stats = statsOf(GAME);
    const bars = diceHistogram(stats);
    expect(bars.map((b) => b.total)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const rolls = bars.reduce((n, b) => n + b.count, 0);
    expect(rolls).toBeGreaterThan(20);
    expect(bars.reduce((n, b) => n + b.expected, 0)).toBeCloseTo(rolls);
    expect(bars[5]!.expected).toBeCloseTo(rolls / 6);
  });

  it('awards go to the leader (ties shared) and skip all-zero ones', () => {
    const stats: GameStats = emptyStats(3);
    stats.players[1]!.steals = 4;
    stats.players[2]!.steals = 4;
    stats.players[0]!.gained.production.ore = 5;
    stats.players[0]!.expected36 = 36 * 2;
    const list = awards(stats);
    expect(list.find((a) => a.id === 'thief')).toMatchObject({
      players: [1, 2],
      detail: '4 steals',
    });
    expect(list.find((a) => a.id === 'luckiest')).toMatchObject({ players: [0] });
    expect(luck(stats.players[0]!)).toBe(3);
    expect(list.find((a) => a.id === 'trader')).toBeUndefined();
    expect(list.find((a) => a.id === 'gained')).toMatchObject({ players: [0], detail: '5 cards' });
  });

  it('VP series: one point per recorded turn end, the last one the final score', () => {
    const stats = statsOf(GAME);
    const series = vpSeries(stats, 4);
    expect(series.turns[0]).toBe(0);
    expect(series.turns.at(-1)).toBe(GAME.turn.number);
    expect(series.vp[GAME.winner!]!.at(-1)).toBeGreaterThanOrEqual(GAME.settings.vpToWin);
  });
});

describe('stats panel in the HUD', () => {
  let root: HTMLElement;
  let hud: Hud;
  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.append(root);
    hud = new Hud(root);
  });
  const byText = (t: string) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(t));
  const open = (state: GameState, durationMs: number | null = 96 * 60_000 + 5_000) => {
    hud.render(state, { viewer: 0, legal: [], isBotTurn: false, gameDurationMs: durationMs });
    byText('Game stats')!.click();
  };
  const tab = (id: string) => root.querySelector<HTMLButtonElement>(`.gs-tab[data-tab="${id}"]`)!;

  it('the winner card offers "Game stats" only when stats exist', () => {
    hud.render(gameOverGame(), { viewer: 0, legal: [], isBotTurn: false });
    expect(root.querySelector('.winner')).not.toBeNull();
    expect(byText('Game stats')).toBeUndefined();
    hud.render(GAME, { viewer: 0, legal: [], isBotTurn: false });
    expect(byText('Game stats')).toBeDefined();
    expect(byText('New game')).toBeDefined();
  });

  it('header: title, winner with colour dot, turns, duration h:mm; five tabs', () => {
    open(GAME);
    const panel = root.querySelector('.gstats')!;
    expect(root.querySelector('.winner')).toBeNull();
    expect(panel.querySelector('h2')!.textContent).toBe('Game Statistics');
    const meta = panel.querySelector('.gs-meta')!.textContent!;
    expect(meta).toContain(`Winner: ${GAME.players[GAME.winner!]!.name}`);
    expect(meta).toContain(`Turns: ${GAME.turn.number}`);
    expect(meta).toContain('Duration: 1:36');
    expect(panel.querySelector('.gs-meta .gs-dot')).not.toBeNull();
    expect([...panel.querySelectorAll('.gs-tab')].map((t) => t.textContent)).toEqual(
      STATS_TABS.map((t) => t.label),
    );
    expect(tab('overview').getAttribute('aria-selected')).toBe('true');
  });

  it('unknown duration shows a dash', () => {
    open(GAME, null);
    expect(root.querySelector('.gs-meta')!.textContent).toContain('Duration: —');
  });

  it('Overview: standings with VP chips, awards', () => {
    open(GAME);
    const rows = [...root.querySelectorAll('.gs-stand')];
    expect(rows).toHaveLength(4);
    expect(rows[0]!.classList.contains('is-winner')).toBe(true);
    expect(rows[0]!.textContent).toContain(`${standings(GAME)[0]!.total} VP`);
    expect(root.querySelectorAll('.gs-award').length).toBeGreaterThan(2);
    expect(root.querySelector('[data-award="gained"]')).not.toBeNull();
  });

  it('Dice: 11 bars with expected markers, rolls per player', () => {
    open(GAME);
    tab('dice').click();
    expect(root.querySelector('.gs-body')!.getAttribute('data-tab')).toBe('dice');
    expect(root.querySelectorAll('.gs-bar')).toHaveLength(11);
    expect(root.querySelectorAll('.gs-expected')).toHaveLength(11);
    expect(root.querySelector('.gs-bar.is-seven title')!.textContent).toMatch(/^7: rolled \d+×/);
    expect(root.querySelector('.gs-table')!.textContent).toContain('Sevens');
    expect(root.querySelector('.gs-events')).toBeNull();
  });

  it('Dice with Event Cards lists the events drawn', () => {
    open(finished(5, true));
    tab('dice').click();
    expect(root.querySelectorAll('.gs-events li').length).toBeGreaterThan(0);
  });

  it('Resources: totals per player, a by-type table for the picked player', () => {
    open(GAME);
    tab('resources').click();
    const winner = GAME.winner!;
    const s = statsOf(GAME).players[winner]!;
    const detail = root.querySelector('.gs-res')!;
    const row = (label: string) =>
      [...detail.querySelectorAll('tr')].find(
        (tr) => tr.querySelector('th')?.textContent === label,
      );
    expect(row('Total gained')!.lastElementChild!.textContent).toBe(
      String(total(sumCounts(s.gained))),
    );
    expect(row('Production')).toBeDefined();
    expect(row('Final hand')!.lastElementChild!.textContent).toBe(
      String(total(GAME.players[winner]!.resources)),
    );
    // Pick another player.
    const other = (winner + 1) % 4;
    const picks = [...root.querySelectorAll<HTMLButtonElement>('.gs-pick')];
    picks[other]!.click();
    expect(root.querySelectorAll('.gs-pick')[other]!.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.gs-res caption')!.textContent).toContain(GAME.players[other]!.name);
  });

  it('Activity: a VP line per player with a legend, and the activity table', () => {
    open(GAME);
    tab('activity').click();
    expect(root.querySelectorAll('.gs-line-stroke')).toHaveLength(4);
    expect(root.querySelectorAll('.gs-figure-line .gs-legend .gs-who')).toHaveLength(4);
    const text = root.querySelector('.gs-body')!.textContent!;
    for (const label of [
      'Roads',
      'Settlements',
      'Cities',
      'Trade offers',
      'Robber moves',
      'Steals',
    ])
      expect(text).toContain(label);
    // Hover shows the tooltip.
    root.querySelector('.gs-line')!.dispatchEvent(new Event('pointerdown'));
    expect(root.querySelector<HTMLElement>('.gs-tip')!.hidden).toBe(false);
  });

  it('Dev Cards: bought / played tables, award history', () => {
    open(GAME);
    tab('dev').click();
    const text = root.querySelector('.gs-body')!.textContent!;
    expect(text).toContain('Bought');
    expect(text).toContain('Played');
    expect(text).toContain('Largest Army');
    expect(text).toContain('Knight');
  });

  it('collapses to a bar (board visible) and expands; Results goes back to the winner card', () => {
    open(GAME);
    root.querySelector<HTMLButtonElement>('.gs-collapse')!.click();
    expect(root.querySelector('.gs-dock .gstats.is-collapsed')).not.toBeNull();
    expect(root.querySelector('.gs-overlay')).toBeNull();
    expect(root.querySelector('.gs-tabs')).toBeNull();
    expect(root.querySelector('.gs-collapse')!.getAttribute('aria-expanded')).toBe('false');
    root.querySelector<HTMLButtonElement>('.gs-collapse')!.click();
    expect(root.querySelector('.gs-overlay .gs-tabs')).not.toBeNull();
    byText('Results')!.click();
    expect(root.querySelector('.winner')).not.toBeNull();
  });

  it('works on an online game-over view (spectator), and states without full stats say so', () => {
    open(viewFor(GAME, 'spectator'));
    expect(root.querySelectorAll('.gs-stand')).toHaveLength(4);
    byText('Results')!.click();

    const partial = { ...gameOverGame(), stats: { ...emptyStats(4, false, 12) } };
    hud.render(partial, { viewer: 0, legal: [], isBotTurn: false });
    byText('Game stats')!.click();
    expect(root.querySelector('.gs-note')!.textContent).toContain('from turn 12');
  });

  it('a new game resets the panel', () => {
    open(GAME);
    tab('dice').click();
    hud.render(midGame(), { viewer: 1, legal: [], isBotTurn: false });
    expect(root.querySelector('.gstats')).toBeNull();
    hud.render(GAME, { viewer: 0, legal: [], isBotTurn: false });
    expect(root.querySelector('.winner')).not.toBeNull();
  });
});
