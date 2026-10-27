/** #32: a steal's log line names the card only for thief and victim (`LogEntry.secret`). */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, RESOURCES, viewFor, type GameState } from './index';
import { moveRobberGame } from './fixtures';
import { describeCards, stealSecret } from './rules/text';

/** Blue (1) moves the robber next to a victim and steals. */
function afterSteal(): { s: GameState; thief: number; victim: number } {
  let s = moveRobberGame();
  for (const a of legalActions(s).filter((x) => x.type === 'moveRobber')) {
    const r = applyAction(s, a);
    if (r.ok && r.state.phase.kind === 'steal') {
      s = r.state;
      break;
    }
  }
  const steal = legalActions(s).find((a) => a.type === 'steal');
  if (steal?.type !== 'steal') throw new Error('no steal');
  const r = applyAction(s, steal);
  if (!r.ok) throw new Error(r.error);
  return { s: r.state, thief: 1, victim: steal.victim };
}

describe('steal log secrets (#32)', () => {
  it('public text names no card; the secret names it for thief and victim', () => {
    const { s, thief, victim } = afterSteal();
    const e = s.log.at(-1)!;
    expect(e.text).toMatch(/^Blue stole from \w+$/);
    expect(RESOURCES.some((r) => e.text.includes(r))).toBe(false);
    expect(e.secret).toHaveLength(1);
    expect(e.secret![0]!.to).toEqual([thief, victim]);
    const m = /^Blue stole 1 (\w+) from (\w+)$/.exec(e.secret![0]!.text);
    expect(m?.[2]).toBe(s.players[victim]!.name);
    const card = RESOURCES.find((r) => r === m?.[1]);
    // The card really moved: the thief's hand holds it.
    expect(s.players[thief]!.resources[card!]).toBeGreaterThan(0);
  });

  it('viewFor keeps the secret for thief and victim only', () => {
    const { s, thief, victim } = afterSteal();
    const last = (v: ReturnType<typeof viewFor>) => v.log.at(-1)!;
    expect(last(viewFor(s, thief)).secret).toEqual(s.log.at(-1)!.secret);
    expect(last(viewFor(s, victim)).secret).toEqual(s.log.at(-1)!.secret);
    const other = s.players.find((p) => p.id !== thief && p.id !== victim)!.id;
    expect(last(viewFor(s, other))).toEqual({ ...s.log.at(-1)!, secret: undefined });
    expect('secret' in last(viewFor(s, other))).toBe(false);
    expect('secret' in last(viewFor(s, 'spectator'))).toBe(false);
  });

  it('helpers', () => {
    expect(describeCards(['wool', 'ore', 'wool'])).toBe('2 wool, 1 ore');
    const s = moveRobberGame();
    expect(stealSecret(s, 1, 0, [null])).toEqual([]);
    expect(stealSecret(s, 1, 0, ['cloth'], ' (Bishop)')).toEqual([
      { to: [1, 0], text: 'Blue stole 1 cloth from Red (Bishop)' },
    ]);
  });
});
