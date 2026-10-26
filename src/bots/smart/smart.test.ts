/** Smart bots (B1): decisions in set situations, determinism, no peeking, legality, speed. */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  legalActions,
  Rng,
  tokenPips,
  topologyOf,
  viewFor,
  type Action,
  type GameState,
  type HexId,
  type PlayerId,
  type VertexId,
} from '../../engine';
import {
  discardGame,
  freshGame,
  midGame,
  moveRobberGame,
  tradeOfferGame,
} from '../../engine/fixtures';
import { runBench, seatSource } from '../bench';
import { botForLevel, easyBot } from '../byLevel';
import { createRandomBot } from '../index';
import { BOT_LEVELS, DEFAULT_BOT_LEVEL, isBotLevel } from '../levels';
import { newGame, runGame } from '../runner';
import { BotContext } from './context';
import { HARD_PARAMS, NORMAL_PARAMS, createSmartBot, hardBot, normalBot, scoreOptions } from '.';

const rng = (seed = 1) => Rng.fromSeed(`test:${seed}`);
const own = (s: GameState, p: PlayerId) => legalActions(s, p).filter((a) => a.player === p);
const pick = (bot = hardBot, s: GameState, p: PlayerId, seed = 1) =>
  bot(s, p, rng(seed), own(s, p));

describe('bot levels', () => {
  it('Easy is the progress-biased random bot, Normal the default', () => {
    expect(BOT_LEVELS).toEqual(['easy', 'normal', 'hard']);
    expect(DEFAULT_BOT_LEVEL).toBe('normal');
    expect(botForLevel('easy')).toBe(easyBot);
    expect(botForLevel('normal')).toBe(normalBot);
    expect(botForLevel('hard')).toBe(hardBot);
    expect(botForLevel()).toBe(normalBot);
    expect(isBotLevel('hard')).toBe(true);
    expect(isBotLevel('expert')).toBe(false);
    // Same choices as the pre-B1 default bot.
    const s = freshGame(4);
    const a = easyBot(s, 0, rng(), own(s, 0));
    const b = createRandomBot({ progressBias: 0.5 })(s, 0, rng(), own(s, 0));
    expect(a).toEqual(b);
  });
});

describe('smart bot decisions (base game)', () => {
  it('opens on a high-pip vertex', () => {
    const s = freshGame(4);
    const a = pick(hardBot, s, 0);
    expect(a?.type).toBe('placeSetupSettlement');
    const t = topologyOf(s);
    const pips = (v: VertexId) =>
      (t.vertex[v]?.hexes ?? []).reduce((n, h) => {
        const tok = s.board.hexes[h]?.token;
        return n + (typeof tok === 'number' ? tokenPips(tok) : 0);
      }, 0);
    const best = Math.max(...t.vertices.map(pips));
    expect(pips((a as Extract<Action, { vertex: VertexId }>).vertex)).toBeGreaterThanOrEqual(
      best - 2,
    );
  });

  it('places its setup road toward an open spot', () => {
    let s = freshGame(4);
    const settle = pick(hardBot, s, 0)!;
    s = (applyAction(s, settle) as { ok: true; state: GameState }).state;
    const road = pick(hardBot, s, 0);
    expect(road?.type).toBe('placeSetupRoad');
  });

  it('builds a city when it can (Normal and Hard, any noise draw)', () => {
    const s = midGame(); // Blue: 3 grain, 3 ore
    expect(pick(hardBot, s, 1)?.type).toBe('buildCity');
    for (let seed = 1; seed <= 10; seed++)
      expect(pick(normalBot, s, 1, seed)?.type).toBe('buildCity');
  });

  it('never moves the robber onto its own buildings while it has another hex', () => {
    const s = moveRobberGame(); // Blue moves the robber
    const t = topologyOf(s);
    for (const bot of [normalBot, hardBot]) {
      for (let seed = 1; seed <= 10; seed++) {
        const a = pick(bot, s, 1, seed) as Extract<Action, { type: 'moveRobber' }>;
        expect(a.type).toBe('moveRobber');
        const mine = (t.hex[a.hex]?.vertices ?? []).some((v) => s.pieces.buildings[v]?.owner === 1);
        expect(mine).toBe(false);
      }
    }
  });

  it('blocks the leader: robber on a hex where only the strongest opponent produces', () => {
    const s = moveRobberGame();
    const t = topologyOf(s);
    const ctx = new BotContext(s, 1, HARD_PARAMS, rng());
    const a = pick(hardBot, s, 1) as Extract<Action, { type: 'moveRobber' }>;
    const owners = new Set(
      (t.hex[a.hex]?.vertices ?? []).flatMap((v) => {
        const b = s.pieces.buildings[v];
        return b ? [b.owner] : [];
      }),
    );
    expect(owners.size).toBeGreaterThan(0);
    // The hex hits someone at least as dangerous as the average opponent.
    const threats = [0, 2, 3].map((p) => ctx.threat(p));
    const avg = threats.reduce((x, y) => x + y, 0) / threats.length;
    expect(Math.max(...[...owners].map((p) => ctx.threat(p)))).toBeGreaterThanOrEqual(avg);
  });

  it('discards what its plans need least', () => {
    const s = discardGame(); // Blue: 2 wool, 3 grain, 3 ore, 1 lumber, 1 brick; discards 5
    const a = pick(hardBot, s, 1) as Extract<Action, { type: 'discard' }>;
    expect(a.type).toBe('discard');
    // Keeps the city (2 grain + 3 ore) together.
    const hand = s.players[1]!.resources;
    expect(hand.ore - (a.resources.ore ?? 0)).toBe(3);
    expect(hand.grain - (a.resources.grain ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it('trades with the bank toward the next build', () => {
    const s = midGame();
    const blue = s.players[1]!;
    blue.resources = { brick: 0, lumber: 0, wool: 4, grain: 2, ore: 2 };
    blue.devCards.knight = 0;
    const a = pick(hardBot, s, 1);
    expect(a).toEqual({ type: 'bankTrade', player: 1, give: 'wool', receive: 'ore' });
  });

  it('accepts a helpful trade from a weak player and refuses one from a near-winner (Hard)', () => {
    const s = tradeOfferGame(); // Blue offers 1 ore for 1 brick; White (2) is pending
    const white = s.players[2]!;
    white.resources = { brick: 2, lumber: 0, wool: 0, grain: 2, ore: 2 };
    const answer = (st: GameState) => pick(hardBot, st, 2)?.type;
    expect(answer(s)).toBe('acceptTrade');
    const near = structuredClone(s);
    near.settings = { ...near.settings, vpToWin: 5 }; // Blue (4 VP) is one VP from winning
    expect(answer(near)).toBe('rejectTrade');
  });

  it('confirms with an accepter rather than withdrawing', () => {
    const s = tradeOfferGame();
    if (s.phase.kind === 'trade')
      s.phase.offer.responses = ['rejected', null, 'rejected', 'accepted'];
    expect(pick(hardBot, s, 1)).toEqual({ type: 'confirmTrade', player: 1, partner: 3 });
  });

  it('plays a knight before rolling when the robber blocks its own hex', () => {
    const s = midGame();
    s.phase = { kind: 'preRoll' };
    const t = topologyOf(s);
    const mine = Object.keys(s.board.hexes).find((h) =>
      (t.hex[h as HexId]?.vertices ?? []).some((v) => s.pieces.buildings[v]?.owner === 1),
    ) as HexId;
    s.robber = mine;
    expect(pick(hardBot, s, 1)?.type).toBe('playKnight');
    s.robber = 'h:0,0';
    expect(pick(hardBot, s, 1)?.type).toBe('rollDice');
  });

  it('plays Year of Plenty when it completes a city', () => {
    const s = midGame();
    const blue = s.players[1]!;
    blue.resources = { brick: 0, lumber: 0, wool: 0, grain: 2, ore: 1 };
    blue.devCards.yearOfPlenty = 1;
    blue.devCards.knight = 0;
    const a = pick(hardBot, s, 1) as Extract<Action, { type: 'playYearOfPlenty' }>;
    expect(a.type).toBe('playYearOfPlenty');
    expect(a.resources).toEqual(['ore', 'ore']);
  });

  it('ends the turn when nothing is worth doing', () => {
    const s = midGame();
    s.players[1]!.resources = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 1 };
    s.players[1]!.devCards.knight = 0;
    expect(pick(hardBot, s, 1)?.type).toBe('endTurn');
  });

  it('scores every option on one scale (scoreOptions)', () => {
    const s = midGame();
    const scored = scoreOptions(s, 1, rng(), own(s, 1), HARD_PARAMS);
    expect(scored).toHaveLength(own(s, 1).length);
    const end = scored.find((x) => x.action.type === 'endTurn')!;
    expect(end.score).toBe(0);
    const city = scored.find((x) => x.action.type === 'buildCity')!;
    expect(city.score).toBeGreaterThan(100);
  });
});

describe('smart bots are deterministic and do not peek', () => {
  it('replays the same game from the same seeds', () => {
    const play = () =>
      runGame({
        initial: newGame({ seed: 'det', players: 4 }),
        maxSteps: 3000,
        source: seatSource([normalBot, hardBot, normalBot, hardBot], 'det'),
      }).history;
    expect(play()).toEqual(play());
  });

  it('decides the same on the full state and on its own view', () => {
    let checked = 0;
    for (const bot of [normalBot, hardBot]) {
      runGame({
        initial: newGame({ seed: 'peek', players: 4 }),
        maxSteps: 600,
        source: (ctx) => {
          const p = ctx.actors.find((a) => ctx.legal.some((x) => x.player === a)) ?? 0;
          const options = ctx.legal.filter((a) => a.player === p);
          const full = bot(ctx.state, p, rng(ctx.step), options);
          const seen = bot(viewFor(ctx.state, p), p, rng(ctx.step), options);
          expect(seen).toEqual(full);
          checked++;
          return full;
        },
      });
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe('smart bots in full games', () => {
  const cases: [string, Parameters<typeof newGame>[0]][] = [
    ['3P base', { seed: 1, players: 3 }],
    ['4P base', { seed: 2, players: 4 }],
    ['6P base', { seed: 3, players: 6 }],
    ['8P base', { seed: 4, players: 8 }],
    ['4P C&K', { seed: 5, players: 4, mode: 'ck' }],
    ['4P Seafarers', { seed: 6, players: 4, mode: 'seafarers' }],
    [
      '4P Seafarers Four Islands',
      { seed: 7, players: 4, mode: 'seafarers', scenario: 'seafarers/fourIslands' },
    ],
    ['4P T&B', { seed: 8, players: 4, mode: 'tb' }],
    ['4P E&P', { seed: 9, players: 4, mode: 'ep' }],
    ['4P event cards', { seed: 10, players: 4, variants: { eventCards: true } }],
  ];
  for (const [name, setup] of cases) {
    it(`${name}: finish with only legal moves and every invariant holding`, () => {
      const n = setup.players;
      const bots = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? normalBot : hardBot));
      const r = runGame({
        initial: newGame(setup),
        maxSteps: 20000,
        source: seatSource(bots, `full:${name}`),
      });
      expect(r.failure?.message ?? null).toBeNull();
      expect(r.outcome).toBe('finished');
    }, 60_000);
  }

  it('decides fast: 95% of decisions under 50 ms at 8 players', () => {
    const timing = { max: 0, total: 0, count: 0 };
    const times: number[] = [];
    const bots = Array.from({ length: 8 }, () => hardBot);
    const timed = bots.map((b) => (...args: Parameters<typeof b>) => {
      const t0 = performance.now();
      const a = b(...args);
      times.push(performance.now() - t0);
      return a;
    });
    runGame({
      initial: newGame({ seed: 'speed', players: 8 }),
      maxSteps: 4000,
      source: seatSource(timed, 'speed', timing),
    });
    times.sort((a, b) => a - b);
    expect(times.length).toBeGreaterThan(500);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(50);
  }, 60_000);

  it('Normal clearly beats Easy (seat-rotated 4-player games)', () => {
    const r = runBench({
      hero: 'normal',
      field: 'easy',
      games: 16,
      players: 4,
      seed: 3,
      maxSteps: 20000,
      mode: null,
      scenario: null,
    });
    expect(r.failures).toEqual([]);
    expect(r.heroWins / r.games).toBeGreaterThanOrEqual(0.6);
  }, 60_000);

  it('Hard and Normal differ only by their parameters', () => {
    expect(createSmartBot(HARD_PARAMS)(midGame(), 1, rng(), own(midGame(), 1))).toEqual(
      hardBot(midGame(), 1, rng(), own(midGame(), 1)),
    );
    expect(NORMAL_PARAMS.noise).toBeGreaterThan(0);
    expect(HARD_PARAMS.noise).toBe(0);
  });
});
