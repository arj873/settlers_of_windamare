/**
 * Per-map topology, generators, supply, settings v2 and save upgrades (T10).
 * Rules sources: docs/RULES.md §16.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from './engine';
import { generateBoard, redNumbersSeparated } from './board';
import { DEV_CARD_TYPES, PLAYER_COLORS, RESOURCES } from './constants';
import { createGame, resolveSettings } from './createGame';
import { FIXTURE_PLAYERS, freshGame, midGame } from './fixtures';
import { expectOk } from './actions/testkit';
import { hexDistance, parseHexId } from './hex';
import { supplyOf } from './mapLookup';
import { MAPS, MAP_IDS, defaultMapFor } from './maps';
import { upgradeState } from './migrate';
import { Rng, expandState, isRngState } from './rng';
import { setupPlayerAt } from './selectors';
import { TOPOLOGY, topologyFor, topologyOf } from './topology';
import type { BaseMapId, GameState, MapId, Terrain } from './types';

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => PLAYER_COLORS[i % PLAYER_COLORS.length]!);

describe('topology per map', () => {
  const expected: Record<BaseMapId, [number, number, number, number, number, number]> = {
    // land, water, vertices, edges, coastal edges, harbors
    base: [19, 18, 54, 72, 30, 9],
    baseRandom: [19, 18, 54, 72, 30, 9],
    base56: [30, 22, 80, 109, 38, 11],
    base78: [37, 24, 96, 132, 42, 12],
  };

  for (const map of MAP_IDS) {
    describe(map, () => {
      const T = topologyFor(map);

      it('has the expected counts', () => {
        expect([
          T.landHexes.length,
          T.waterHexes.length,
          T.vertices.length,
          T.edges.length,
          T.coastalEdges.length,
          T.portSlots.length,
        ]).toEqual(expected[map]);
        expect(T.portSlots.length).toBe(MAPS[map].harbors.length);
        expect(new Set(T.vertices).size).toBe(T.vertices.length);
        expect(new Set(T.edges).size).toBe(T.edges.length);
      });

      it('has symmetric adjacency', () => {
        for (const h of T.landHexes) {
          for (const v of T.hex[h]!.vertices) expect(T.vertex[v]!.hexes).toContain(h);
          for (const e of T.hex[h]!.edges) expect(T.edge[e]!.hexes).toContain(h);
          for (const n of T.hex[h]!.neighbors) expect(T.hex[n]!.neighbors).toContain(h);
        }
        for (const v of T.vertices) {
          for (const e of T.vertex[v]!.edges) expect(T.edge[e]!.vertices).toContain(v);
          for (const w of T.vertex[v]!.vertices) expect(T.vertex[w]!.vertices).toContain(v);
        }
        for (const e of T.edges) {
          for (const f of T.edge[e]!.edges) expect(T.edge[f]!.edges).toContain(e);
        }
      });

      it('water ring is a closed loop of adjacent hexes around the land', () => {
        const ring = T.waterHexes.map(parseHexId);
        ring.forEach((w, i) => {
          expect(hexDistance(w, ring[(i + 1) % ring.length]!)).toBe(1);
          expect(T.hex[T.waterHexes[i]!]).toBeUndefined();
        });
        // Top-left start.
        const minR = Math.min(...ring.map((c) => c.r));
        expect(ring[0]!.r).toBe(minR);
      });

      it('coastal edges: one land hex each, and a harbor on each slot edge', () => {
        expect(T.edges.filter((e) => T.edge[e]!.coastal)).toHaveLength(T.coastalEdges.length);
        for (const e of T.coastalEdges) expect(T.edge[e]!.hexes).toHaveLength(1);
        expect(T.coastalEdges[0]).toBe(T.portSlots[0]!.edge);
      });

      it('harbor slots: coastal, next to their water hex, no shared vertices', () => {
        const vs = T.portSlots.flatMap((p) => p.vertices);
        expect(new Set(vs).size).toBe(vs.length);
        for (const slot of T.portSlots) {
          expect(T.edge[slot.edge]!.coastal).toBe(true);
          expect(T.water[slot.waterHex]).toBeDefined();
          const land = parseHexId(T.edge[slot.edge]!.hexes[0]!);
          expect(hexDistance(land, parseHexId(slot.waterHex))).toBe(1);
        }
      });
    });
  }

  it('maps sharing a frame share one cached topology; base map = TOPOLOGY', () => {
    expect(topologyFor('baseRandom')).toBe(topologyFor('base'));
    expect(topologyFor('base')).toBe(TOPOLOGY);
    expect(topologyFor('base56')).not.toBe(TOPOLOGY);
    const s = createGame({ seed: 1, players: players(6), map: 'base56' });
    expect(topologyOf(s)).toBe(topologyFor('base56'));
  });

  it('5-6 harbors sit on the water hexes of the rulebook frame (RULES.md §16.B)', () => {
    expect(topologyFor('base56').portSlots.map((p) => p.waterHex)).toEqual([
      'h:1,-4',
      'h:3,-4',
      'h:4,-3',
      'h:4,0',
      'h:2,2',
      'h:1,3',
      'h:-1,4',
      'h:-3,4',
      'h:-3,2',
      'h:-3,1',
      'h:-2,-1',
    ]);
  });

  it('7-8 board: radius-3 hexagon, harbors 6-fold symmetric (4,3 coastal gaps)', () => {
    const T = topologyFor('base78');
    for (const h of T.landHexes) expect(hexDistance(parseHexId(h), { q: 0, r: 0 })).toBeLessThan(4);
    const idx = T.portSlots.map((p) => T.coastalEdges.indexOf(p.edge));
    const n = T.coastalEdges.length;
    const gaps = idx.map((i, k) => ((idx[(k + 1) % idx.length] ?? 0) - i + n) % n);
    expect(gaps).toEqual([4, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3]);
  });
});

describe('board generators', () => {
  const count = <T>(xs: T[]) => {
    const m = new Map<T, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };

  for (const map of ['baseRandom', 'base56', 'base78'] as const) {
    it(`${map}: official counts, separated 6/8, robber on a desert, over 60 seeds`, () => {
      const def = MAPS[map];
      const T = topologyFor(map);
      const robbers = new Set<string>();
      for (let seed = 0; seed < 60; seed++) {
        const { board, robber } = generateBoard(map, Rng.fromSeed(`gen-${seed}`));
        const tiles = Object.values(board.hexes);
        expect(Object.keys(board.hexes).sort()).toEqual([...T.landHexes].sort());
        const terrain = count(tiles.map((t) => t.terrain));
        for (const [t, n] of Object.entries(def.terrain) as [Terrain, number][]) {
          expect(terrain.get(t) ?? 0, `${t} seed ${seed}`).toBe(n);
        }
        const tokens = tiles.map((t) => t.token).filter((t): t is number => t !== null);
        expect(tokens.sort((a, b) => a - b)).toEqual([...def.tokens].sort((a, b) => a - b));
        for (const t of tiles) expect(t.token === null).toBe(t.terrain === 'desert');
        expect(redNumbersSeparated(board.hexes, map)).toBe(true);
        expect(board.hexes[robber]?.terrain).toBe('desert');
        robbers.add(robber);
        expect(board.ports.map((p) => p.kind).sort()).toEqual([...def.harbors].sort());
        expect(board.ports.map((p) => p.edge)).toEqual(T.portSlots.map((s) => s.edge));
      }
      expect(robbers.size).toBeGreaterThan(1); // the layout is actually random
    });
  }

  it('is deterministic per seed', () => {
    for (const map of MAP_IDS) {
      expect(generateBoard(map, Rng.fromSeed(7))).toEqual(generateBoard(map, Rng.fromSeed(7)));
    }
  });

  it("'base' is the fixed beginner layout whatever the seed", () => {
    expect(generateBoard('base', Rng.fromSeed(1))).toEqual(generateBoard('base', Rng.fromSeed(2)));
  });

  it('with several deserts the robber may start on any of them', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const { board, robber } = generateBoard('base56', Rng.fromSeed(seed));
      const deserts = Object.values(board.hexes).filter((h) => h.terrain === 'desert');
      expect(deserts).toHaveLength(2);
      seen.add(deserts[0]!.id === robber ? 'first' : 'second');
    }
    expect(seen).toEqual(new Set(['first', 'second']));
  });
});

describe('supply per map', () => {
  const cases: [BaseMapId, number, number, number][] = [
    // map, bank per resource, dev cards, knights
    ['base', 19, 25, 14],
    ['baseRandom', 19, 25, 14],
    ['base56', 24, 34, 20],
    ['base78', 29, 43, 26],
  ];
  for (const [map, bank, deck, knights] of cases) {
    it(`${map}: bank ${bank} each, ${deck} dev cards (${knights} knights)`, () => {
      const n = MAPS[map].maxPlayers;
      const s = createGame({ seed: 3, players: players(n), map });
      for (const r of RESOURCES) expect(s.bank[r]).toBe(bank);
      expect(s.devDeck).toHaveLength(deck);
      expect(s.devDeck.filter((c) => c === 'knight')).toHaveLength(knights);
      expect(s.devDeck.filter((c) => c === 'victoryPoint')).toHaveLength(5);
      for (const t of DEV_CARD_TYPES) {
        expect(s.devDeck.filter((c) => c === t)).toHaveLength(supplyOf(s).devDeck[t]);
      }
    });
  }
});

describe('player counts and setup snake', () => {
  it('each map accepts exactly its player range', () => {
    for (const map of MAP_IDS) {
      const { minPlayers, maxPlayers } = MAPS[map];
      for (let n = 2; n <= 9; n++) {
        const make = () => createGame({ seed: 1, players: players(n), map });
        if (n >= minPlayers && n <= maxPlayers) expect(make).not.toThrow();
        else expect(make, `${map} n=${n}`).toThrow();
      }
    }
    expect(MAPS.base.maxPlayers).toBe(4);
    expect(MAPS.base56.maxPlayers).toBe(6);
    expect(MAPS.base78.maxPlayers).toBe(8);
  });

  it('default map follows the player count', () => {
    expect([3, 4, 5, 6, 7, 8].map(defaultMapFor)).toEqual([
      'baseRandom',
      'baseRandom',
      'base56',
      'base56',
      'base78',
      'base78',
    ]);
    expect(createGame({ seed: 1, players: players(7) }).settings.map).toBe('base78');
  });

  for (let n = 3; n <= 8; n++) {
    it(`setup snake works for ${n} players`, () => {
      let s = createGame({
        seed: `snake-${n}`,
        players: players(n),
        map: defaultMapFor(n),
        startingPlayer: 0,
      });
      const order: number[] = [];
      while (s.phase.kind === 'setup') {
        const phase = s.phase;
        expect(s.turn.current).toBe(setupPlayerAt(phase.index, n));
        if (phase.step === 'settlement') order.push(s.turn.current);
        const [a] = legalActions(s);
        if (!a) throw new Error('no legal setup action');
        const r = applyAction(s, a);
        if (!r.ok) throw new Error(r.error);
        s = r.state;
      }
      const forward = Array.from({ length: n }, (_, i) => i);
      expect(order).toEqual([...forward, ...[...forward].reverse()]);
      expect(s.phase.kind).toBe('preRoll');
      expect(s.turn.current).toBe(0);
      expect(Object.keys(s.pieces.buildings)).toHaveLength(2 * n);
      expect(Object.keys(s.pieces.roads)).toHaveLength(2 * n);
    });
  }
});

describe('starting player (RULES.md 2.7, 2.13, 2.20)', () => {
  it('is drawn from the seed, and every seat can start', () => {
    const firsts = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const s = createGame({ seed: `start-${i}`, players: players(4), map: 'baseRandom' });
      expect(s.turn.current).toBe(s.settings.startingPlayer);
      // Same seed, same starter.
      const again = createGame({ seed: `start-${i}`, players: players(4), map: 'baseRandom' });
      expect(again.settings.startingPlayer).toBe(s.settings.startingPlayer);
      firsts.add(s.settings.startingPlayer);
    }
    expect([...firsts].sort()).toEqual([0, 1, 2, 3]);
  });

  it('does not change the board, deck or RNG of a seed', () => {
    const a = createGame({ seed: 9, players: players(4), map: 'baseRandom', startingPlayer: 2 });
    const b = createGame({ seed: 9, players: players(4), map: 'baseRandom', startingPlayer: 0 });
    expect(a.board).toEqual(b.board);
    expect(a.devDeck).toEqual(b.devDeck);
    expect(a.rng).toEqual(b.rng);
  });

  it('logs who starts', () => {
    const s = createGame({ seed: 1, players: FIXTURE_PLAYERS, startingPlayer: 1 });
    expect(s.log.map((e) => e.text)).toContain('Blue starts');
    expect(s.log.at(-1)).toMatchObject({ player: 1, text: 'Blue starts' });
  });

  it('snakes from the starting seat and takes the first turn', () => {
    let s = createGame({ seed: 's', players: players(4), map: 'baseRandom', startingPlayer: 2 });
    const order: number[] = [];
    while (s.phase.kind === 'setup') {
      if (s.phase.step === 'settlement') order.push(s.turn.current);
      const r = applyAction(s, legalActions(s)[0]!);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect(order).toEqual([2, 3, 0, 1, 1, 0, 3, 2]);
    expect(s.turn).toMatchObject({ number: 1, current: 2 });
    expect(setupPlayerAt(0, 4, 2)).toBe(2);
    expect(setupPlayerAt(7, 4, 2)).toBe(2);
  });

  it('rejects a seat that does not exist', () => {
    const base = { seed: 1, players: players(4), map: 'baseRandom' as const };
    expect(() => resolveSettings({ ...base, startingPlayer: 4 })).toThrow();
    expect(() => resolveSettings({ ...base, startingPlayer: -1 })).toThrow();
  });
});

describe('settings v2', () => {
  it('defaults', () => {
    const s = createGame({ seed: 1, players: players(4), map: 'baseRandom' });
    expect(s.schemaVersion).toBe(6);
    expect(s.settings).toEqual({
      seed: 1,
      map: 'baseRandom',
      vpToWin: 10,
      discardLimit: 7,
      balancedDice: false,
      specialBuildPhase: false,
      hideBankCards: false,
      turnTimerSec: null,
      startingPlayer: s.settings.startingPlayer,
      mode: 'base',
      expansions: [],
      scenario: null,
      options: {},
    });
    expect(s.ext).toEqual({});
    expect(createGame({ seed: 1, players: players(5) }).settings.specialBuildPhase).toBe(true);
  });

  it('stores explicit values', () => {
    const s = createGame({
      seed: 'x',
      players: players(6),
      map: 'base56',
      vpToWin: 12,
      discardLimit: 9,
      balancedDice: true,
      specialBuildPhase: false,
      hideBankCards: true,
      turnTimerSec: 90,
    });
    expect(s.settings).toMatchObject({
      map: 'base56',
      vpToWin: 12,
      discardLimit: 9,
      balancedDice: true,
      specialBuildPhase: false,
      hideBankCards: true,
      turnTimerSec: 90,
    });
  });

  it('layout (v1 config) still works and maps to base / baseRandom', () => {
    const p = FIXTURE_PLAYERS;
    expect(createGame({ seed: 1, players: p, layout: 'beginner' }).settings.map).toBe('base');
    expect(createGame({ seed: 1, players: p, layout: 'random' }).settings.map).toBe('baseRandom');
    // Same seed, same board as the map id.
    expect(createGame({ seed: 5, players: p, layout: 'random' }).board).toEqual(
      createGame({ seed: 5, players: p, map: 'baseRandom' }).board,
    );
  });

  it('rejects out-of-range values', () => {
    const base = { seed: 1, players: players(4), map: 'baseRandom' as const };
    for (const bad of [
      { vpToWin: 2 },
      { vpToWin: 26 },
      { vpToWin: 7.5 },
      { discardLimit: 4 },
      { discardLimit: 21 },
      { turnTimerSec: 0 },
      { turnTimerSec: 1.5 },
    ]) {
      expect(() => resolveSettings({ ...base, ...bad }), JSON.stringify(bad)).toThrow();
    }
    expect(() => resolveSettings({ ...base, map: 'nope' as MapId })).toThrow();
    for (const ok of [{ vpToWin: 3 }, { vpToWin: 25 }, { discardLimit: 5 }, { discardLimit: 20 }]) {
      expect(() => resolveSettings({ ...base, ...ok })).not.toThrow();
    }
  });
});

describe('upgradeState (saves)', () => {
  /** The uint32 rng every save before v6 held. */
  const OLD_RNG = 0x9e3779b9;
  /** `s` as upgraded from an older save: the old uint32 rng expanded (v5 -> v6). */
  const upgraded = (s: GameState): GameState => ({ ...s, rng: expandState(OLD_RNG) });

  /** A v1 save as T7 wrote it: schemaVersion 1, settings.layout. */
  function v1Save(layout: 'beginner' | 'random'): unknown {
    const s = JSON.parse(JSON.stringify(freshGame())) as Record<string, unknown>;
    return {
      ...s,
      schemaVersion: 1,
      settings: { seed: 'fixture', layout, vpToWin: 8 },
      rng: OLD_RNG,
    };
  }

  it('upgrades v1 -> v6 with defaults', () => {
    const up = upgradeState(v1Save('beginner'));
    expect(up?.schemaVersion).toBe(6);
    expect(up?.rng).toEqual(expandState(OLD_RNG));
    expect(up?.diceDeck).toEqual([]);
    expect(up?.ext).toEqual({});
    expect(up?.settings).toEqual({
      seed: 'fixture',
      map: 'base',
      vpToWin: 8,
      discardLimit: 7,
      balancedDice: false,
      specialBuildPhase: false,
      hideBankCards: false,
      turnTimerSec: null,
      startingPlayer: 0,
      mode: 'base',
      expansions: [],
      scenario: null,
      options: {},
    });
    expect(upgradeState(v1Save('random'))?.settings.map).toBe('baseRandom');
  });

  it('an upgraded v1 game keeps playing', () => {
    const up = upgradeState(v1Save('beginner')) as GameState;
    const [a] = legalActions(up);
    expect(a?.type).toBe('placeSetupSettlement');
    expect(applyAction(up, a!).ok).toBe(true);
  });

  it('upgrades v3 -> v4: seat 0 started every earlier game', () => {
    const s = freshGame();
    const { startingPlayer: _, ...v3Settings } = s.settings;
    const v3 = { ...s, schemaVersion: 3, settings: v3Settings, rng: OLD_RNG };
    expect(upgradeState(JSON.parse(JSON.stringify(v3)))).toEqual(upgraded(s));
  });

  it('upgrades v4 -> v5: base mode, no expansions, empty ext', () => {
    const s = freshGame();
    const { mode: _m, expansions: _e, scenario: _s, options: _o, ...v4Settings } = s.settings;
    const { ext: _x, ...rest } = s;
    const v4 = { ...rest, schemaVersion: 4, settings: v4Settings, rng: OLD_RNG };
    expect(upgradeState(JSON.parse(JSON.stringify(v4)))).toEqual(upgraded(s));
  });

  it('keeps V1/V2 variant fields and stats through v4 -> v5 and in v5 (no schema bump)', () => {
    const s = createGame({
      seed: 'variants',
      players: players(4),
      robberMode: 'friendly',
      eventCards: true,
      setupPlacement: {
        first: { building: 'settlement', restriction: 'normal' },
        second: { building: 'city', restriction: 'anyVertex' },
      },
      randomTurnOrder: true,
      mapSelection: 'random',
      rushMode: true,
      turboMode: true,
      secondSettler: true,
      timer: { preset: 'blitz', bankSec: 300, incrementSec: 10 },
      mapRules: { allowRedTouch: true },
    });
    expect(s.stats).toBeDefined();
    expect(s.eventDeck).toBeDefined();
    const { mode: _m, expansions: _e, scenario: _s, options: _o, ...v4Settings } = s.settings;
    const { ext: _x, ...rest } = s;
    const v4 = { ...rest, schemaVersion: 4, settings: v4Settings, rng: OLD_RNG };
    expect(upgradeState(JSON.parse(JSON.stringify(v4)))).toEqual(upgraded(s));
    expect(upgradeState(JSON.parse(JSON.stringify(s)))).toEqual(s);
    // A v5 expansion save with variants and stats passes through as well.
    const oil = createGame({ seed: 3, players: players(4), mode: 'oil', robberMode: 'friendly' });
    expect(upgradeState(JSON.parse(JSON.stringify(oil)))).toEqual(oil);
  });

  it('rejects a v5 save with an unknown expansion, mode or scenario', () => {
    const s = freshGame();
    const bad = (settings: Record<string, unknown>) =>
      upgradeState(JSON.parse(JSON.stringify({ ...s, settings: { ...s.settings, ...settings } })));
    expect(bad({ expansions: ['moon'] })).toBeNull();
    expect(bad({ mode: 'moon' })).toBeNull();
    expect(bad({ scenario: 'moon/x' })).toBeNull();
    const { ext: _x, ...noExt } = s;
    expect(upgradeState(noExt)).toBeNull();
  });

  it('passes v6 through and rejects garbage', () => {
    const s = freshGame();
    expect(upgradeState(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(upgradeState(null)).toBeNull();
    expect(upgradeState({})).toBeNull();
    expect(upgradeState({ ...s, schemaVersion: 7 })).toBeNull();
    expect(upgradeState({ ...s, settings: { ...s.settings, startingPlayer: 4 } })).toBeNull();
    expect(upgradeState({ ...s, settings: { ...s.settings, map: 'moon' } })).toBeNull();
    expect(
      upgradeState({ ...s, schemaVersion: 1, settings: { seed: 1, layout: 'x', vpToWin: 10 } }),
    ).toBeNull();
  });

  it('upgrades v5 -> v6: the uint32 rng expands to a 128-bit state (splitmix32 x4)', () => {
    const s = midGame();
    const v5 = JSON.parse(JSON.stringify({ ...s, schemaVersion: 5, rng: OLD_RNG })) as unknown;
    const up = upgradeState(v5) as GameState;
    expect(up).toEqual(upgraded(s));
    expect(up.schemaVersion).toBe(6);
    expect(isRngState(up.rng)).toBe(true);
    // Deterministic: the same old save always gives the same state, other numbers other ones.
    expect(upgradeState(JSON.parse(JSON.stringify(v5)))).toEqual(up);
    expect(upgradeState({ ...s, schemaVersion: 5, rng: OLD_RNG + 1 })?.rng).not.toEqual(up.rng);
    // A v5 expansion save too.
    const oil = createGame({ seed: 3, players: players(4), mode: 'oil' });
    const oilV5 = JSON.parse(JSON.stringify({ ...oil, schemaVersion: 5, rng: 7 })) as unknown;
    expect(upgradeState(oilV5)).toEqual({ ...oil, rng: expandState(7) });
  });

  it('an upgraded v5 game replays deterministically', () => {
    const v5 = JSON.parse(JSON.stringify({ ...midGame(), schemaVersion: 5, rng: 42 })) as unknown;
    const play = () => {
      let s = upgradeState(JSON.parse(JSON.stringify(v5))) as GameState;
      const rolls: unknown[] = [];
      for (let i = 0; i < 200 && s.winner === null; i++) {
        const [a] = legalActions(s);
        if (!a) break;
        s = expectOk(applyAction(s, a));
        if (a.type === 'rollDice') rolls.push(s.dice);
      }
      return { rolls, state: s };
    };
    const a = play();
    expect(a.rolls.length).toBeGreaterThan(0);
    expect(play()).toEqual(a);
  });

  it('rejects a bad rng: v5 needs a uint32, v6 four of them', () => {
    const s = freshGame();
    expect(upgradeState({ ...s, schemaVersion: 5 })).toBeNull(); // a v6 tuple labelled v5
    expect(upgradeState({ ...s, schemaVersion: 5, rng: 1.5 })).toBeNull();
    expect(upgradeState({ ...s, schemaVersion: 4, rng: '7' })).toBeNull();
    expect(upgradeState({ ...s, rng: 7 })).toBeNull(); // a uint32 labelled v6
    expect(upgradeState({ ...s, rng: [1, 2, 3] })).toBeNull();
    expect(upgradeState({ ...s, rng: [1, 2, 3, -4] })).toBeNull();
  });
});
