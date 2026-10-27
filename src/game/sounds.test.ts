import { describe, expect, it } from 'vitest';
import {
  applyAction,
  legalActions,
  viewFor,
  type Action,
  type GameState,
  type LogEntry,
} from '../engine';
import { gameOverGame, midGame, moveRobberGame, tradeOfferGame } from '../engine/fixtures';
import type { SoundCue } from '../audio';
import { SoundLimiter } from '../audio/limiter';
import { GameSounds, newLogEntries, soundCues, type ExtSounds, type SoundSeats } from './sounds';

/** Seats of a 4-player game: `local` played on this screen, `bots` by bots, the rest remote. */
function seats(local: number[], bots: number[] = [], viewer = local[0] ?? null): SoundSeats {
  return {
    viewer,
    local: [0, 1, 2, 3].map((p) => local.includes(p)),
    bots: [0, 1, 2, 3].map((p) => bots.includes(p)),
  };
}

function after(state: GameState, ...actions: Action[]): GameState {
  let s = state;
  for (const a of actions) {
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
    s = r.state;
  }
  return s;
}

/** The first legal action of `type` for `player`. */
function legal(state: GameState, type: Action['type'], player: number): Action {
  const a = legalActions(state).find((x) => x.type === type && x.player === player);
  if (!a) throw new Error(`no legal ${type} for ${player}`);
  return a;
}

const rich = (s: GameState, p: number): GameState => {
  const c = structuredClone(s);
  c.players[p]!.resources = { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 };
  return c;
};

const ids = (cues: SoundCue[]) => cues.map((c) => c.id);
const level = (cues: SoundCue[], id: string) => cues.find((c) => c.id === id)?.level;

const withLog = (s: GameState, ...entries: Omit<LogEntry, 'turn'>[]): GameState => ({
  ...s,
  log: [...s.log, ...entries.map((e) => ({ turn: s.turn.number, ...e }))],
});

describe('soundCues: when nothing should sound', () => {
  it('is silent for the first state, an unchanged state and a different game', () => {
    const s = midGame();
    expect(soundCues(null, s, seats([1]))).toEqual([]);
    expect(soundCues(s, s, seats([1]))).toEqual([]);
    expect(soundCues(s, structuredClone(s), seats([1]))).toEqual([]);
    const other = { ...s, settings: { ...s.settings, seed: 'another' } };
    expect(
      soundCues(s, withLog(other, { player: 1, text: 'Blue rolled 6 (3+3)' }), seats([1])),
    ).toEqual([]);
  });
});

describe('soundCues: base events', () => {
  it('a roll plays the dice, at the roller’s level', () => {
    const pre: GameState = { ...midGame(), phase: { kind: 'preRoll' } };
    const rolled = after(pre, { type: 'rollDice', player: 1 });
    expect(ids(soundCues(pre, rolled, seats([1])))).toContain('dice');
    expect(level(soundCues(pre, rolled, seats([1])), 'dice')).toBe('high');
    expect(level(soundCues(pre, rolled, seats([0], [1])), 'dice')).toBe('low');
    expect(level(soundCues(pre, rolled, seats([0])), 'dice')).toBe('normal');
  });

  it('a 7 adds the seven sting, prominent for whoever must discard', () => {
    const s = midGame();
    const seven: GameState = {
      ...withLog(s, { player: 1, text: 'Blue rolled 7 (3+4)' }),
      phase: { kind: 'discard', pending: [0, 0, 0, 4] },
    };
    const cues = soundCues(s, seven, seats([3]));
    expect(ids(cues)).toEqual(expect.arrayContaining(['dice', 'seven']));
    expect(level(cues, 'seven')).toBe('high');
    expect(level(soundCues(s, seven, seats([0])), 'seven')).toBe('normal');
  });

  it('your turn chimes only for a seat played here', () => {
    const s = midGame();
    const next = after(s, { type: 'endTurn', player: 1 });
    expect(next.turn.current).toBe(2);
    expect(level(soundCues(s, next, seats([2])), 'yourTurn')).toBe('high');
    expect(ids(soundCues(s, next, seats([3])))).not.toContain('yourTurn');
    // Hotseat: every human seat is local.
    expect(ids(soundCues(s, next, seats([0, 2])))).toContain('yourTurn');
  });

  it('builds: road, settlement and a city upgrade, quieter for bots', () => {
    const s = rich(midGame(), 1);
    const road = after(s, legal(s, 'buildRoad', 1));
    expect(soundCues(s, road, seats([1]))).toContainEqual({ id: 'road', level: 'high' });
    expect(soundCues(s, road, seats([0], [1]))).toContainEqual({ id: 'road', level: 'low' });
    const city = after(s, legal(s, 'buildCity', 1));
    expect(ids(soundCues(s, city, seats([1])))).toContain('city');
    expect(ids(soundCues(s, city, seats([1])))).not.toContain('settlement');
  });

  it('dev cards: buy and play', () => {
    const s = rich(midGame(), 1);
    const bought = after(s, { type: 'buyDevCard', player: 1 });
    expect(ids(soundCues(s, bought, seats([1])))).toContain('devBuy');
    const pre: GameState = { ...midGame(), phase: { kind: 'preRoll' } };
    const knight = after(pre, { type: 'playKnight', player: 1 });
    expect(ids(soundCues(pre, knight, seats([1])))).toContain('devPlay');
  });

  it('robber and steal: the steal is prominent for its victim', () => {
    const s = moveRobberGame();
    const moved = after(s, legal(s, 'moveRobber', 1));
    expect(ids(soundCues(s, moved, seats([0])))).toContain('robber');
    if (moved.phase.kind !== 'steal') throw new Error('expected a steal');
    const victim = moved.phase.candidates[0]!;
    const stolen = after(moved, { type: 'steal', player: 1, victim });
    const bystander = [0, 2, 3].find((p) => p !== victim)!;
    expect(level(soundCues(moved, stolen, seats([victim], [1])), 'steal')).toBe('high');
    expect(level(soundCues(moved, stolen, seats([bystander], [1])), 'steal')).toBe('low');
  });

  it('discards', () => {
    const s = midGame();
    const next = withLog(s, { player: 3, text: 'Orange discarded 2 ore, 2 lumber' });
    expect(soundCues(s, next, seats([3]))).toContainEqual({ id: 'discard', level: 'high' });
  });

  it('trade: an offer to you, replies to your offer, the trade itself', () => {
    const s = rich(midGame(), 1);
    const offer = after(s, legal(s, 'offerTrade', 1));
    expect(soundCues(s, offer, seats([2]))).toContainEqual({ id: 'tradeOffer', level: 'high' });
    expect(ids(soundCues(s, offer, seats([1])))).not.toContain('tradeOffer');

    const open = tradeOfferGame();
    for (const p of open.players) p.resources = { ...p.resources, ore: 2, brick: 2 };
    const accepted = after(open, { type: 'acceptTrade', player: 2 });
    expect(soundCues(open, accepted, seats([1]))).toContainEqual({
      id: 'tradeAccept',
      level: 'high',
    });
    expect(ids(soundCues(open, accepted, seats([0])))).not.toContain('tradeAccept');
    const rejected = after(open, { type: 'rejectTrade', player: 2 });
    expect(ids(soundCues(open, rejected, seats([1])))).toContain('tradeReject');

    const done = after(accepted, { type: 'confirmTrade', player: 1, partner: 3 });
    expect(soundCues(accepted, done, seats([3], [1]))).toContainEqual({
      id: 'trade',
      level: 'high',
    });
    expect(soundCues(accepted, done, seats([0], [1]))).toContainEqual({
      id: 'trade',
      level: 'low',
    });
  });

  it('awards: prominent when you gain or lose one', () => {
    const s = midGame();
    const next = { ...s, awards: { ...s.awards, longestRoad: 1 } };
    expect(soundCues(s, next, seats([1]))).toContainEqual({ id: 'longestRoad', level: 'high' });
    expect(soundCues(s, next, seats([0]))).toContainEqual({ id: 'longestRoad', level: 'high' });
    expect(soundCues(s, next, seats([3]))).toContainEqual({ id: 'longestRoad', level: 'normal' });
  });

  it('game over: victory for a local winner, defeat for the others, victory for spectators', () => {
    const s = midGame();
    const over = gameOverGame();
    expect(ids(soundCues(s, over, seats([0])))).toContain('victory');
    expect(ids(soundCues(s, over, seats([1])))).toContain('defeat');
    expect(soundCues(s, over, seats([], [0, 1, 2, 3], null))).toContainEqual({
      id: 'victory',
      level: 'normal',
    });
    expect(ids(soundCues(s, over, seats([0])))).not.toContain('yourTurn');
  });

  it('coalesces repeats into one cue at the loudest level', () => {
    const s = midGame();
    const next = withLog(
      s,
      { player: 3, text: 'Orange discarded 4 ore' },
      { player: 1, text: 'Blue discarded 5 grain' },
    );
    expect(soundCues(s, next, seats([1], [3]))).toEqual([{ id: 'discard', level: 'high' }]);
  });
});

describe('soundCues: online views', () => {
  it('a masked view sounds like the full state for that seat', () => {
    const s = rich(midGame(), 1);
    const steps: GameState[] = [s];
    steps.push(after(s, legal(s, 'buildRoad', 1)));
    steps.push(after(steps[1]!, { type: 'buyDevCard', player: 1 }));
    steps.push(after(steps[2]!, { type: 'endTurn', player: 1 }));
    for (const seat of [1, 2]) {
      for (let i = 1; i < steps.length; i++) {
        const full = soundCues(steps[i - 1]!, steps[i]!, seats([seat], [0, 3]));
        const view = soundCues(
          viewFor(steps[i - 1]!, seat),
          viewFor(steps[i]!, seat),
          seats([seat], [0, 3]),
        );
        expect(view).toEqual(full);
      }
    }
  });
});

describe('soundCues: expansion hooks', () => {
  it('adds module cues and survives a failing hook', () => {
    const s = midGame();
    const next = withLog(s, { player: 1, text: 'something' });
    const ok: ExtSounds = { cues: (_a, _b, ctx) => [{ id: 'x/thing', level: ctx.levelOf(1) }] };
    const bad: ExtSounds = {
      cues: () => {
        throw new Error('boom');
      },
    };
    const err = console.error;
    console.error = () => undefined;
    try {
      expect(soundCues(s, next, seats([1]), [bad, ok])).toEqual([{ id: 'x/thing', level: 'high' }]);
    } finally {
      console.error = err;
    }
  });
});

describe('newLogEntries', () => {
  const e = (turn: number, text: string): LogEntry => ({ turn, player: 0, text });
  const base = [e(1, 'a'), e(1, 'b'), e(2, 'c')];

  it('returns what was appended to an untrimmed log', () => {
    expect(newLogEntries(base, [...base, e(2, 'd')])).toEqual([e(2, 'd')]);
    expect(newLogEntries(base, base)).toEqual([]);
  });

  it('tolerates an extended newest line (C&K trades)', () => {
    const extended = [e(1, 'a'), e(1, 'b'), e(2, 'c, more'), e(2, 'd')];
    expect(newLogEntries(base, extended)).toEqual([e(2, 'd')]);
  });

  it('anchors on the newest line once the log is trimmed', () => {
    expect(newLogEntries(base, [e(1, 'b'), e(2, 'c'), e(2, 'd'), e(3, 'e')])).toEqual([
      e(2, 'd'),
      e(3, 'e'),
    ]);
  });

  it('returns nothing without an anchor (never a burst of old lines)', () => {
    expect(newLogEntries(base, [e(5, 'x'), e(5, 'y')])).toEqual([]);
  });
});

describe('GameSounds', () => {
  function rig() {
    const played: [string, number][] = [];
    let t = 0;
    const sounds = new GameSounds({
      play: (id, gain) => played.push([id, gain]),
      now: () => t,
      limiter: new SoundLimiter(),
    });
    return { sounds, played, advance: (ms: number) => (t += ms) };
  }

  it('plays the cues of each new state with the level gain', () => {
    const { sounds, played } = rig();
    const s = midGame();
    sounds.observe(s, seats([2]));
    expect(played).toEqual([]);
    sounds.observe(after(s, { type: 'endTurn', player: 1 }), seats([2]));
    expect(played).toEqual([['yourTurn', 1]]);
  });

  it('keeps fast bot play to a quiet trickle', () => {
    const { sounds, played, advance } = rig();
    let s = rich(midGame(), 1);
    sounds.observe(s, seats([0], [1, 2, 3]));
    for (let i = 0; i < 10; i++) {
      const road = legalActions(s).find((a) => a.type === 'buildRoad' && a.player === 1);
      if (!road) break;
      s = after(s, road);
      s.players[1]!.resources = { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 };
      sounds.observe(s, seats([0], [1, 2, 3]));
      advance(20);
    }
    // Ten bot roads in 200 ms: at most two quiet road sounds (an award may still be heard).
    const roads = played.filter(([id]) => id === 'road');
    expect(roads.length).toBeGreaterThan(0);
    expect(roads.length).toBeLessThanOrEqual(2);
    expect(roads.every(([, gain]) => gain < 0.5)).toBe(true);
  });

  it('ticks the turn timer once per second for the last 10 s of your own clock', () => {
    const { sounds, played, advance } = rig();
    // Shown seconds: 13, 11, 11, 10, 10, 4, 3, 1.
    for (const sec of [12.2, 10.9, 10.4, 9.6, 9.1, 3.5, 2.7, 0.5]) {
      sounds.timer(sec, true);
      advance(1000);
    }
    expect(played.map(([id]) => id)).toEqual([
      'timerWarn',
      'timerWarn',
      'timerUrgent',
      'timerUrgent',
    ]);
    played.length = 0;
    sounds.timer(5, false);
    expect(played).toEqual([]);
  });

  it('plays one-off cues (chat)', () => {
    const { sounds, played } = rig();
    sounds.cue('chat');
    expect(played).toEqual([['chat', 0.6]]);
  });
});
