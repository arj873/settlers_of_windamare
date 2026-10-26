/** Cities & Knights smart-bot strategy (strategy.ts): knights vs barbarians, improvements, cards. */
import { describe, expect, it } from 'vitest';
import { Rng, legalActions, type Action, type GameState, type PlayerId } from '../../engine';
import { runBench } from '../../bots/bench';
import { BotContext, HARD_PARAMS, hardBot } from '../../bots/smart';
import { BARBARIAN_STEPS, ckSlice, type CkPhase } from './engine';
import { E, V, build, ckMain, giveCards, knight, roads, setGoods } from './engine/testkit';
import { strengthValue } from './strategy';

const RING = [E(0, 0, 'NW'), E(0, 0, 'NE'), E(0, 0, 'E')];
const pick = (s: GameState, p: PlayerId = 0) =>
  hardBot(
    s,
    p,
    Rng.fromSeed('ck-strategy'),
    legalActions(s, p).filter((a) => a.player === p),
  ) as Action & Record<string, unknown>;

/** Player 0: a city on h:0,0, roads around it, an inactive knight; player 1: a city. */
function board(): GameState {
  const s = ckMain();
  build(s, 0, V(0, 0, 'SW'), 'city');
  roads(s, 0, E(0, 0, 'W'), ...RING);
  knight(s, 0, V(0, 0, 'NW'));
  build(s, 1, V(2, 0, 'S'), 'city');
  return s;
}

describe('C&K smart bots', () => {
  it('values knight strength by how close the barbarians are and who would lose a city', () => {
    const far = board();
    const near = board();
    ckSlice(near).barbarian = BARBARIAN_STEPS - 1;
    const v = (s: GameState) => strengthValue(new BotContext(s, 0, HARD_PARAMS, new Rng(1)), 1);
    expect(v(near)).toBeGreaterThan(v(far));
    expect(v(near)).toBeGreaterThan(100); // a city saved
  });

  it('activates its knight when the barbarians are about to land and it is the weakest', () => {
    const s = board();
    ckSlice(s).barbarian = BARBARIAN_STEPS - 1;
    setGoods(s, 0, { grain: 1 });
    expect(pick(s)).toMatchObject({ type: 'ck/activateKnight', vertex: V(0, 0, 'NW') });
  });

  it('buys a city improvement when it holds the commodities', () => {
    const s = board();
    setGoods(s, 0, { cloth: 1 });
    expect(pick(s)).toMatchObject({ type: 'ck/improve', track: 'trade' });
  });

  it('loses its poorest city to the barbarians', () => {
    const s = board();
    build(s, 0, V(-1, -1, 'S'), 'city'); // lumber 3 + grain 4 + lumber 8: the better city
    s.phase = { kind: 'ck/pillage', queue: [0] } as unknown as GameState['phase'];
    const ctx = new BotContext(s, 0, HARD_PARAMS, new Rng(1));
    const a = pick(s);
    expect(a.type).toBe('ck/pickVertex');
    const other = a['vertex'] === V(0, 0, 'SW') ? V(-1, -1, 'S') : V(0, 0, 'SW');
    expect(ctx.cityValue(a['vertex'] as never)).toBeLessThanOrEqual(ctx.cityValue(other));
  });

  it('plays the Merchant (a VP) and discards its least useful card', () => {
    const s = board();
    giveCards(s, 0, 'merchant');
    expect(pick(s)).toMatchObject({ type: 'ck/play', card: 'merchant' });
    const d = board();
    giveCards(d, 0, 'merchant', 'diplomat');
    const phase: CkPhase = { kind: 'ck/progressDiscard', queue: [0], then: 'main' };
    d.phase = phase as unknown as GameState['phase'];
    d.turn.current = 1;
    expect(pick(d)).toMatchObject({ type: 'ck/pickCard', card: 'diplomat' });
  });

  it('never selects a knight just to cancel it', () => {
    const s = board();
    knight(s, 0, V(0, 0, 'NW'), 1, true, 1);
    s.phase = { kind: 'preRoll' };
    for (let i = 0; i < 5; i++) expect(pick(s).type).toBe('rollDice');
  });

  it('Normal beats Easy in C&K', () => {
    const r = runBench({
      hero: 'normal',
      field: 'easy',
      games: 8,
      players: 4,
      seed: 2,
      maxSteps: 30000,
      mode: 'ck',
      scenario: null,
    });
    expect(r.failures).toEqual([]);
    expect(r.heroWins / r.games).toBeGreaterThanOrEqual(0.6);
  }, 60_000);
});
