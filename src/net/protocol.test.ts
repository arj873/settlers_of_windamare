import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  legalActions,
  listModes,
  modeById,
  PLAYER_COLORS,
  Rng,
  type Action,
} from '../engine';
import { createRandomBot } from '../bots';
import { newGame, runGame } from '../bots/runner';
import {
  buildConfig,
  defaultSetup,
  modeOf,
  modeOptions,
  setMode,
  setOption,
  setScenario,
  setupError,
} from '../ui/setup/model';
import { Invalid } from './guard';
import {
  cleanText,
  DEFAULT_ROOM_CONFIG,
  LIMITS,
  parseAction,
  parseClientMessage,
  parseRoomConfig,
  parseServerMessage,
  PROTOCOL_VERSION,
} from './protocol';

const v = PROTOCOL_VERSION;

function parseOk(x: unknown) {
  const r = parseClientMessage(x);
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.msg;
}

function errorOf(x: unknown) {
  const r = parseClientMessage(x);
  return r.ok ? null : r.code;
}

/** Every legal action of a few hundred random states. */
function sampleActions(): Action[] {
  const out: Action[] = [];
  const rng = new Rng(7);
  for (const map of ['base', 'base56'] as const) {
    let s = createGame({ seed: map, players: PLAYER_COLORS.slice(0, map === 'base' ? 4 : 5), map });
    for (let i = 0; i < 600 && s.phase.kind !== 'gameOver'; i++) {
      const legal = legalActions(s);
      out.push(...legal);
      const pick = legal.filter((a) => a.type !== 'endTurn');
      const r = applyAction(s, rng.float() < 0.7 && pick.length ? rng.pick(pick) : rng.pick(legal));
      if (r.ok) s = r.state;
    }
  }
  return out;
}

describe('parseAction', () => {
  it('accepts every action the engine can produce, unchanged', () => {
    const actions = sampleActions();
    const types = new Set(actions.map((a) => a.type));
    expect(types.size).toBeGreaterThanOrEqual(15);
    for (const a of actions) expect(parseAction(JSON.parse(JSON.stringify(a)), 'a')).toEqual(a);
  });

  it('accepts T&B spoke edges and plaza vertices (F2 ids)', () => {
    for (const a of [
      { type: 'buildRoad', player: 0, edge: 'e:2,-2,CS' },
      { type: 'placeSetupRoad', player: 0, edge: 'e:-3,3,CNW' },
      { type: 'placeFreeRoad', player: 0, edge: 'e:0,0,CNE' },
      { type: 'buildSettlement', player: 0, vertex: 'v:2,-2,C' },
    ]) {
      expect(parseAction(a, 'a')).toEqual(a);
    }
    expect(() => parseAction({ type: 'buildRoad', player: 0, edge: 'e:0,0,CE' }, 'a')).toThrow(
      Invalid,
    );
  });

  it('rebuilds the object from known fields only', () => {
    const a = parseAction({ type: 'rollDice', player: 1, junk: 'x', __proto__: { evil: 1 } }, 'a');
    expect(a).toEqual({ type: 'rollDice', player: 1 });
    expect(Object.keys(a)).toEqual(['type', 'player']);
  });

  it.each([
    [{ type: 'nope', player: 0 }],
    [{ type: 'rollDice', player: 8 }],
    [{ type: 'rollDice', player: '0' }],
    [{ type: 'rollDice', player: 0.5 }],
    [{ type: 'buildRoad', player: 0, edge: 'v:0,0,N' }],
    [{ type: 'buildSettlement', player: 0, vertex: 'v:0,0,X' }],
    [{ type: 'moveRobber', player: 0, hex: 'h:100,0' }],
    [{ type: 'discard', player: 0, resources: { brick: -1 } }],
    [{ type: 'discard', player: 0, resources: { gold: 1 } }],
    [{ type: 'discard', player: 0, resources: [1, 2] }],
    [{ type: 'playYearOfPlenty', player: 0, resources: ['ore'] }],
    [{ type: 'playYearOfPlenty', player: 0, resources: ['ore', 'ore', 'ore'] }],
    [{ type: 'playMonopoly', player: 0, resource: 'desert' }],
    [
      {
        type: 'offerTrade',
        player: 0,
        give: { ore: 1 },
        want: { wool: 1 },
        to: [1, 2, 3, 4, 5, 6, 7, 0],
      },
    ],
    [{ type: 'confirmTrade', player: 0 }],
    [null],
    ['rollDice'],
  ])('rejects %j', (x) => {
    expect(() => parseAction(x, 'a')).toThrow(Invalid);
  });
});

/** Every legal action of bot games in each expansion mode (a sample of states). */
function expansionActions(): Action[] {
  const out: Action[] = [];
  for (const m of listModes().filter((x) => x.id !== 'base')) {
    for (const scenario of m.scenarios.length ? m.scenarios : [undefined]) {
      runGame({
        // 4 seats, or what the mode allows (Catan for Two + C&K: 2).
        initial: newGame({
          seed: `p-${m.id}`,
          players: Math.min(Math.max(4, m.players?.min ?? 4), m.players?.max ?? 4),
          mode: m.id,
          scenario,
        }),
        maxSteps: 200,
        bot: createRandomBot({ progressBias: 0.5 }),
        onStep: ({ step, state }) => {
          if (step % 4 === 0) out.push(...legalActions(state));
        },
      });
    }
  }
  return out;
}

describe('parseAction: expansion actions', () => {
  it('accepts every expansion action the engine produces, unchanged', () => {
    const actions = expansionActions().filter((a) => a.type.includes('/'));
    const types = new Set(actions.map((a) => a.type));
    for (const ns of ['ck', 'seafarers', 'tb', 'ep', 'oil', 'crop']) {
      expect([...types].some((t) => t.startsWith(`${ns}/`))).toBe(true);
    }
    for (const a of actions) expect(parseAction(JSON.parse(JSON.stringify(a)), 'a')).toEqual(a);
  }, 30_000);

  it('rebuilds the payload as plain JSON', () => {
    const raw = JSON.parse('{"type":"ck/play","player":1,"card":"spy","__proto__":{"evil":1}}');
    expect(() => parseAction(raw, 'a')).toThrow(Invalid);
    const a = parseAction({ type: 'ck/play', player: 1, card: 'spy' }, 'a');
    expect(a).toEqual({ type: 'ck/play', player: 1, card: 'spy' });
    expect(Object.getPrototypeOf(a)).toBe(Object.prototype);
  });

  const deep = { a: { b: { c: { d: { e: 1 } } } } };
  it.each([
    ['unknown module', { type: 'zz/foo', player: 0 }],
    ['unknown action of a known module', { type: 'ck/teleport', player: 0 }],
    ['a phase kind, not an action', { type: 'ck/pillage', player: 0 }],
    ['bad player', { type: 'ck/cancel', player: 9 }],
    ['bad key', { type: 'ck/play', player: 0, 'card!': 'spy' }],
    ['not finite', { type: 'ck/alchemist', player: 0, yellow: Infinity, red: 1 }],
    ['nested too deep', { type: 'ck/play', player: 0, card: deep }],
    ['too many items', { type: 'ck/play', player: 0, card: Array.from({ length: 65 }, () => 1) }],
    ['too large', { type: 'ck/play', player: 0, ...bigPayload() }],
    ['long string', { type: 'ck/play', player: 0, card: 'x'.repeat(65) }],
  ])('rejects %s', (_label, x) => {
    expect(() => parseAction(x, 'a')).toThrow(Invalid);
  });
});

function bigPayload(): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (let i = 0; i < 10; i++) out[`k${i}`] = Array.from({ length: 30 }, () => i);
  return out;
}

describe('parseClientMessage', () => {
  it('parses every message type', () => {
    expect(parseOk({ v, type: 'hello', token: null })).toEqual({ v, type: 'hello', token: null });
    expect(parseOk({ v, type: 'hello', token: 'a'.repeat(20), name: 'Bob' })).toMatchObject({
      name: 'Bob',
    });
    expect(parseOk({ v, type: 'setName', name: 'Ann' }).type).toBe('setName');
    expect(parseOk({ v, type: 'takeSeat', seat: 2 })).toEqual({ v, type: 'takeSeat', seat: 2 });
    expect(parseOk({ v, type: 'leaveSeat' }).type).toBe('leaveSeat');
    expect(parseOk({ v, type: 'setColor', color: '#d64541' }).type).toBe('setColor');
    expect(parseOk({ v, type: 'configure', config: DEFAULT_ROOM_CONFIG })).toEqual({
      v,
      type: 'configure',
      config: DEFAULT_ROOM_CONFIG,
    });
    expect(parseOk({ v, type: 'kick', member: 'm2' }).type).toBe('kick');
    expect(parseOk({ v, type: 'start' }).type).toBe('start');
    expect(parseOk({ v, type: 'rematch' }).type).toBe('rematch');
    expect(parseOk({ v, type: 'intent', action: { type: 'endTurn', player: 0 }, seq: 4 })).toEqual({
      v,
      type: 'intent',
      action: { type: 'endTurn', player: 0 },
      seq: 4,
    });
    expect(parseOk({ v, type: 'chat', text: 'hi' }).type).toBe('chat');
    expect(parseOk({ v, type: 'react', reaction: 'gg' }).type).toBe('react');
    expect(parseOk({ v, type: 'sync' }).type).toBe('sync');
    // JSON strings work too.
    expect(parseOk(JSON.stringify({ v, type: 'sync' })).type).toBe('sync');
  });

  it('reports version mismatches separately', () => {
    expect(errorOf({ v: 2, type: 'sync' })).toBe('version_mismatch');
    expect(errorOf({ type: 'sync' })).toBe('version_mismatch');
  });

  it.each([
    ['not json', '{'],
    ['too long', JSON.stringify({ v, type: 'chat', text: 'x'.repeat(LIMITS.messageChars) })],
    ['array', [v]],
    ['unknown type', { v, type: 'hack' }],
    ['short token', { v, type: 'hello', token: 'abc' }],
    ['token with spaces', { v, type: 'hello', token: 'a a a a a a a a a a a a' }],
    ['missing token', { v, type: 'hello' }],
    ['seat out of range', { v, type: 'takeSeat', seat: 9 }],
    ['colour not in the palette', { v, type: 'setColor', color: 'red' }],
    ['unknown reaction', { v, type: 'react', reaction: 'poop' }],
    ['chat too long', { v, type: 'chat', text: 'x'.repeat(LIMITS.chat * 2 + 1) }],
    ['bad action', { v, type: 'intent', action: { type: 'rollDice' } }],
    ['negative seq', { v, type: 'intent', action: { type: 'rollDice', player: 0 }, seq: -1 }],
  ])('rejects %s', (_label, x) => {
    expect(errorOf(x)).toBe('bad_message');
  });
});

describe('parseRoomConfig', () => {
  const cfg = (patch: object) => ({ ...DEFAULT_ROOM_CONFIG, ...patch });

  it('accepts the default and the map player ranges', () => {
    expect(parseRoomConfig(DEFAULT_ROOM_CONFIG, 'c')).toEqual(DEFAULT_ROOM_CONFIG);
    expect(parseRoomConfig(cfg({ map: 'base78', seatCount: 8 }), 'c').seatCount).toBe(8);
    expect(parseRoomConfig(cfg({ turnTimerSec: null }), 'c').turnTimerSec).toBeNull();
  });

  it.each([
    [{ map: 'moon' }],
    [{ seatCount: 5 }], // base maps are 3-4
    [{ map: 'base56', seatCount: 7 }], // 3-6
    [{ seatCount: 2 }],
    [{ vpToWin: 2 }],
    [{ discardLimit: 21 }],
    [{ turnTimerSec: 31 }], // not one of the setup screen's steps
    [{ mode: 'atlantis' }],
    [{ scenario: 'seafarers/newShores' }], // base mode: no scenario
    [{ options: {} }], // base mode: no options
    [{ mode: 'ck', scenario: 'seafarers/newShores' }], // not one of the mode's scenarios
    [{ mode: 'ck', options: { zz: {} } }],
    [{ mode: 'ck', options: { ck: { nope: true } } }],
    [{ mode: 'ck', options: { seafarers: {} } }], // not a module of the mode
    [{ mode: 'ck', seatCount: 7 }], // C&K: 3-6
    [{ mode: 'seafarers', scenario: 'seafarers/fogIslands', seatCount: 2 }],
    [{ mode: 'ck', variants: { rushMode: true } }], // a module's validate refuses it
    [{ rules: { balancedDice: 'yes', hideBankCards: false } }],
    [{ rules: null }],
  ])('rejects %j', (patch) => {
    expect(() => parseRoomConfig(cfg(patch), 'c')).toThrow(Invalid);
  });

  it('accepts every mode, scenario and option the setup screen can make, unchanged', () => {
    let n = 0;
    for (const mode of listModes()) {
      const scenarios = mode.scenarios.length ? mode.scenarios : [null];
      for (const scenario of scenarios) {
        let d = setMode(defaultSetup(4), mode.id);
        if (scenario) d = setScenario(d, scenario);
        for (const { ext, def } of modeOptions(modeOf(d))) {
          const value =
            def.type === 'boolean'
              ? !def.default
              : def.type === 'int'
                ? def.max
                : (def.choices[def.choices.length - 1]?.value ?? def.default);
          d = setOption(d, ext, def.key, value);
        }
        if (setupError(d) !== null) continue; // e.g. an option the scenario refuses
        const { players, seed: _seed, ...rest } = buildConfig(d);
        const config = { ...rest, seatCount: players.length };
        expect(parseRoomConfig(JSON.parse(JSON.stringify(config)), 'c')).toEqual(config);
        n += 1;
      }
    }
    expect(n).toBeGreaterThan(25);
  });

  it('checks option types and ranges', () => {
    const boolOpt = modeOptions(modeById('ck')!).find((o) => o.def.type === 'boolean')!;
    const bad = { mode: 'ck', options: { [boolOpt.ext]: { [boolOpt.def.key]: 'yes' } } };
    expect(() => parseRoomConfig(cfg(bad), 'c')).toThrow(Invalid);
    const ok = { mode: 'ck', options: { [boolOpt.ext]: { [boolOpt.def.key]: true } } };
    expect(parseRoomConfig(cfg(ok), 'c').options).toEqual(ok.options);
  });
});

describe('parseServerMessage', () => {
  it('checks JSON, version and type only', () => {
    expect(parseServerMessage(JSON.stringify({ v, type: 'room', room: {} })).ok).toBe(true);
    expect(parseServerMessage(JSON.stringify({ v: 0, type: 'room' }))).toMatchObject({
      ok: false,
      code: 'version_mismatch',
    });
    expect(parseServerMessage(JSON.stringify({ v, type: 'weird' })).ok).toBe(false);
    expect(parseServerMessage('nope').ok).toBe(false);
  });
});

describe('cleanText', () => {
  it('trims, collapses whitespace and strips control / bidi characters', () => {
    expect(cleanText('  a \n\t b  ', 10)).toBe('a b');
    expect(cleanText(`x${String.fromCharCode(0x202e)}y${String.fromCharCode(0)}z`, 10)).toBe(
      'x y z',
    );
    expect(cleanText('   ', 10)).toBe('');
  });

  it('clips by code points, never splitting an emoji', () => {
    const smile = String.fromCodePoint(0x1f600);
    expect(cleanText(smile.repeat(5), 3)).toBe(smile.repeat(3));
  });
});
