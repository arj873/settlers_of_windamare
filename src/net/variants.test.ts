/** Wire protocol + online session for the V1 variants (actions, room config, phases, clock). */
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, legalActions, PLAYER_COLORS, Rng, type Action } from '../engine';
import { Invalid } from './guard';
import { DEFAULT_ROOM_CONFIG, parseAction, parseRoomConfig, type RoomConfig } from './protocol';

/** Every legal action over random games with event cards + veto + second settler. */
function variantActions(): Action[] {
  const out: Action[] = [];
  const rng = new Rng(11);
  for (const seed of [1, 2, 3]) {
    let s = createGame({
      seed,
      players: PLAYER_COLORS.slice(0, 4),
      eventCards: true,
      mapSelection: 'veto',
      secondSettler: true,
    });
    for (let i = 0; i < 1500 && s.phase.kind !== 'gameOver'; i++) {
      const legal = legalActions(s);
      out.push(...legal);
      const pick = legal.filter((a) => a.type !== 'endTurn');
      const r = applyAction(s, rng.float() < 0.7 && pick.length ? rng.pick(pick) : rng.pick(legal));
      if (r.ok) s = r.state;
    }
  }
  return out;
}

describe('parseAction: V1 actions', () => {
  it('round-trips every variant action the engine produces', () => {
    const actions = variantActions();
    const types = new Set(actions.map((a) => a.type));
    for (const t of ['vetoMap', 'eventGain', 'eventSteal', 'eventDamageRoad'] as const) {
      expect(types.has(t)).toBe(true);
    }
    for (const a of actions) expect(parseAction(JSON.parse(JSON.stringify(a)), 'a')).toEqual(a);
  });

  it('accepts the rest and rebuilds from known fields only', () => {
    const ok: Action[] = [
      { type: 'eventGive', player: 1, to: 2, resource: 'ore' },
      { type: 'eventSteal', player: 1, victim: null },
      { type: 'repairRoad', player: 0 },
    ];
    for (const a of ok) expect(parseAction({ ...a, junk: 1 }, 'a')).toEqual(a);
  });

  it.each([
    [{ type: 'vetoMap', player: 0, candidate: 3 }],
    [{ type: 'vetoMap', player: 0, candidate: '1' }],
    [{ type: 'eventGain', player: 0, resource: 'gold' }],
    [{ type: 'eventGive', player: 0, to: 9, resource: 'ore' }],
    [{ type: 'eventGive', player: 0, resource: 'ore' }],
    [{ type: 'eventSteal', player: 0 }], // victim must be sent (null = pass)
    [{ type: 'eventSteal', player: 0, victim: -1 }],
    [{ type: 'eventDamageRoad', player: 0, edge: 'v:0,0,N' }],
  ])('rejects %j', (x) => {
    expect(() => parseAction(x, 'a')).toThrow(Invalid);
  });
});

describe('parseRoomConfig: variants', () => {
  const cfg = (variants: unknown, patch: Partial<RoomConfig> = {}) => ({
    ...DEFAULT_ROOM_CONFIG,
    ...patch,
    variants,
  });

  it('accepts every variant and keeps one canonical form (defaults dropped)', () => {
    const variants = {
      robberMode: 'friendly',
      eventCards: true,
      rushMode: true,
      turboMode: true,
      secondSettler: true,
      randomTurnOrder: true,
      mapSelection: 'veto',
      setupPlacement: {
        first: { building: 'city', restriction: 'anyVertex' },
        second: { building: 'settlement', restriction: 'normal' },
      },
      timer: { preset: 'classic', bankSec: 1200, incrementSec: 30 },
    };
    expect(parseRoomConfig(cfg(variants, { turnTimerSec: null }), 'c').variants).toEqual(variants);
    const defaults = { robberMode: 'normal', eventCards: false, mapSelection: 'fixed' };
    expect(parseRoomConfig(cfg(defaults), 'c').variants).toEqual({});
    expect(parseRoomConfig(DEFAULT_ROOM_CONFIG, 'c')).toEqual(DEFAULT_ROOM_CONFIG);
  });

  it('accepts the 5+ rule set and map rules; only true flags survive', () => {
    const base = { map: 'base56', seatCount: 5, vpToWin: 12 } as const;
    expect(
      parseRoomConfig(
        cfg(
          {
            rules56: true,
            mapRules: {
              allowRedTouch: true,
              allowExtremeTouch: false,
              allowSameResourceTouch: true,
            },
          },
          base,
        ),
        'c',
      ).variants,
    ).toEqual({ rules56: true, mapRules: { allowRedTouch: true, allowSameResourceTouch: true } });
    // all map rules off is the default: dropped; rules56 false likewise
    expect(
      parseRoomConfig(cfg({ rules56: false, mapRules: { allowRedTouch: false } }, base), 'c')
        .variants,
    ).toEqual({});
    // map rules are fine at any seat count and on every map
    expect(
      parseRoomConfig(cfg({ mapRules: { allowSameNumberTouch: true } }, { seatCount: 3 }), 'c')
        .variants,
    ).toEqual({ mapRules: { allowSameNumberTouch: true } });
  });

  it.each([
    ['rules56 with 4 seats', { rules56: true }, { seatCount: 4 }],
    [
      'rules56 + second settler',
      { rules56: true, secondSettler: true },
      { map: 'base56', seatCount: 5 },
    ],
    ['unknown map rule', { mapRules: { allowEverything: true } }, {}],
    ['map rule type', { mapRules: { allowRedTouch: 'yes' } }, {}],
    ['map rules not an object', { mapRules: true }, {}],
  ] as const)('rejects %s', (_label, variants, patch) => {
    expect(() => parseRoomConfig(cfg(variants, patch as Partial<RoomConfig>), 'c')).toThrow(
      Invalid,
    );
  });

  it('accepts a custom clock within the ranges', () => {
    const timer = { preset: 'custom', bankSec: 300, incrementSec: 0 };
    expect(parseRoomConfig(cfg({ timer }, { turnTimerSec: null }), 'c').variants?.timer).toEqual(
      timer,
    );
  });

  it.each([
    ['unknown key', { cheat: true }, {}],
    ['robber', { robberMode: 'evil' }, {}],
    ['flag type', { eventCards: 'yes' }, {}],
    ['map selection', { mapSelection: 'all' }, {}],
    [
      'setup building',
      {
        setupPlacement: {
          first: { building: 'castle', restriction: 'normal' },
          second: { building: 'city', restriction: 'normal' },
        },
      },
      {},
    ],
    [
      'setup missing round',
      { setupPlacement: { first: { building: 'city', restriction: 'normal' } } },
      {},
    ],
    [
      'preset off',
      { timer: { preset: 'off', bankSec: 60, incrementSec: 0 } },
      { turnTimerSec: null },
    ],
    [
      'preset values',
      { timer: { preset: 'classic', bankSec: 60, incrementSec: 30 } },
      { turnTimerSec: null },
    ],
    [
      'custom range',
      { timer: { preset: 'custom', bankSec: 5, incrementSec: 0 } },
      { turnTimerSec: null },
    ],
    ['clock + per-turn timer', { timer: { preset: 'blitz', bankSec: 300, incrementSec: 10 } }, {}],
    [
      'event cards + balanced dice',
      { eventCards: true },
      { rules: { balancedDice: true, hideBankCards: false } },
    ],
    ['second settler with 3 seats', { secondSettler: true }, { seatCount: 3 }],
  ] as const)('rejects %s', (_label, variants, patch) => {
    expect(() => parseRoomConfig(cfg(variants, patch as Partial<RoomConfig>), 'c')).toThrow(
      Invalid,
    );
  });
});
