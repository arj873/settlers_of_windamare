import { describe, expect, it } from 'vitest';
import { applyAction, createGame, legalActions, PLAYER_COLORS, Rng, type Action } from '../engine';
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
    [{ mode: 'seafarers' }],
    [{ rules: { balancedDice: 'yes', hideBankCards: false } }],
    [{ rules: null }],
  ])('rejects %j', (patch) => {
    expect(() => parseRoomConfig(cfg(patch), 'c')).toThrow(Invalid);
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
