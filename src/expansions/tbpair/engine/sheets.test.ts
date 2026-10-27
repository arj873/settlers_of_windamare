/**
 * The six T&B × T&B sheets without Fishing (the 2025 sheets, docs/rules/combos.md §2d): the
 * boards, one test per sheet rule. Soundness: tbpair.test.ts (every scenario of the mode).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../../../engine/engine';
import { NO_ROBBER } from '../../../engine/expansions/ext';
import { createGame } from '../../../engine/createGame';
import { computeProduction } from '../../../engine/rules/production';
import { victoryPoints } from '../../../engine/selectors';
import { hexNeighbors, topologyOf } from '../../../engine/topology';
import type {
  Action,
  EdgeId,
  GameState,
  HexId,
  PlayerId,
  Resource,
  VertexId,
} from '../../../engine/types';
import {
  baOf,
  camelOptions,
  caravansOf,
  featuresOf,
  goldOf,
  stepCost,
  tbBoard,
  tbSlice,
  tradersOf,
  wagonSteps,
} from '../../tb/engine';
import { pathsAt } from '../../tb/engine/paths';
import { rngFor } from '../../tb/engine/testkit';
import { visitPlaza } from '../../tb/engine/traders';
import {
  barbarianRefs,
  centreBarbarians,
  freePaths,
  hexPaths,
  SHEETS,
  TBPAIR,
  TBPAIR_MODE,
} from '.';

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#50505${i}` }));

function game(scenario: string, n = 4, seed = 5): GameState {
  return createGame({
    seed,
    players: players(n),
    mode: TBPAIR_MODE,
    scenario: `tbpair/${scenario}`,
    startingPlayer: 0,
  });
}

function main(scenario: string, seed = 5): GameState {
  const s = game(scenario, 4, seed);
  s.pieces.buildings = {};
  s.pieces.roads = {};
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  return s;
}

const act = (type: string, player: PlayerId, rest: Record<string, unknown> = {}): Action =>
  ({ type, player, ...rest }) as unknown as Action;
const run = (s: GameState, a: Action): GameState => {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error}`);
  return r.state;
};
const legalOf = (s: GameState, type: string) => legalActions(s).filter((a) => a.type === type);
const field = (a: Action, k: string) => (a as unknown as Record<string, string>)[k];
const setPhase = (s: GameState, p: Record<string, unknown>) => {
  s.phase = p as unknown as GameState['phase'];
};
const terrainOf = (s: GameState, h: HexId) => s.board.hexes[h]?.terrain;
const tokenOf = (s: GameState, h: HexId) => s.board.hexes[h]?.token ?? null;

/** Settlement of `p` on `v` (with a road on one of its edges). */
function settle(
  s: GameState,
  p: PlayerId,
  v: VertexId,
  kind: 'settlement' | 'city' = 'settlement',
) {
  s.pieces.buildings[v] = { owner: p, kind };
}

/** A vertex of `h` (not a centre, not a sea-only corner) where a building produces from it. */
function cornerOf(s: GameState, h: HexId, land = 2): VertexId {
  const t = topologyOf(s);
  const noBuild = new Set(tbBoard(s).noBuild ?? []);
  const v = t.hex[h]?.vertices.find(
    (x) => !noBuild.has(x) && !x.endsWith(',C') && (t.vertex[x]?.hexes.length ?? 0) >= land,
  );
  if (!v) throw new Error(`no corner on ${h}`);
  return v;
}

/** Give `p` the cards for a settlement and build it on a fresh spot of hex `h` (with a road). */
function buildOn(s: GameState, p: PlayerId, h: HexId): GameState {
  const v = cornerOf(s, h);
  const e = topologyOf(s).vertex[v]?.edges.find((x) => !x.includes(',C')) as EdgeId;
  s.pieces.roads[e] = p;
  for (const r of ['brick', 'lumber', 'wool', 'grain'] as Resource[]) {
    s.players[p]!.resources[r] += 1;
    s.bank[r] -= 1;
  }
  return run(s, act('buildSettlement', p, { vertex: v }));
}

const CASTLE_TRADE: HexId = 'h:-2,0';
const QUARRY: HexId = 'h:2,-2';
const GLASSWORKS: HexId = 'h:0,2';
const BA_CASTLE: HexId = 'h:-2,2';

// ---------------------------------------------------------------------------------------------
// The mode and the boards
// ---------------------------------------------------------------------------------------------

describe('the six sheets: scenarios and boards', () => {
  it('each plays as its two T&B scenarios at the sheet’s target, 3-4 players', () => {
    const want: Record<string, [string[], number]> = {
      'tbpair/baTraders': [['ba', 'traders'], 14],
      'tbpair/caravansBa': [['caravans', 'ba'], 12],
      'tbpair/caravansTraders': [['caravans', 'traders'], 15],
      'tbpair/riversBa': [['rivers', 'ba'], 12],
      'tbpair/riversCaravans': [['rivers', 'caravans'], 12],
      'tbpair/riversTraders': [['rivers', 'traders'], 13],
    };
    expect(SHEETS.map((x) => x.id).sort()).toEqual(Object.keys(want).sort());
    for (const sheet of SHEETS) {
      const s = game(sheet.id.slice(TBPAIR.length + 1), 3);
      expect(s.settings.expansions).toEqual([TBPAIR, 'tb']);
      expect(featuresOf(sheet.id)).toEqual(want[sheet.id]?.[0]);
      expect(s.settings.vpToWin).toBe(want[sheet.id]?.[1]);
      expect(() => game(sheet.id.slice(TBPAIR.length + 1), 5)).toThrow(/players/);
    }
  });

  it('BA + T&B: the diagram — trade hexes on BA’s 12, 2 and desert; castle; terrain pools', () => {
    for (const seed of [1, 2, 3]) {
      const s = game('baTraders', 4, seed);
      expect(terrainOf(s, CASTLE_TRADE)).toBe('tb/tradeCastle');
      expect(terrainOf(s, QUARRY)).toBe('tb/quarry');
      expect(terrainOf(s, GLASSWORKS)).toBe('tb/glassworks');
      expect(terrainOf(s, BA_CASTLE)).toBe('tb/castle');
      expect([tokenOf(s, CASTLE_TRADE), tokenOf(s, GLASSWORKS), tokenOf(s, QUARRY)]).toEqual([
        12,
        2,
        null,
      ]);
      const t = topologyOf(s);
      const count = (inner: boolean) => {
        const out: Record<string, number> = {};
        for (const h of t.landHexes) {
          if (((t.hex[h]?.neighbors.length ?? 0) === 6) !== inner) continue;
          const x = terrainOf(s, h) as string;
          if (x.startsWith('tb/')) continue;
          out[x] = (out[x] ?? 0) + 1;
        }
        return out;
      };
      expect(count(false)).toEqual({ brick: 2, lumber: 1, wool: 2, grain: 2, ore: 1 });
      expect(count(true)).toEqual({ brick: 1, lumber: 1, wool: 1, grain: 2, ore: 2 });
      expect(Object.values(s.board.hexes).filter((h) => h.terrain === 'desert')).toHaveLength(0);
    }
  });

  it('BA + T&B: start barbarians at the centre of the castle and the glassworks; BA’s deck only', () => {
    const s = game('baTraders');
    expect(baOf(s).onHex).toEqual({ [CASTLE_TRADE]: 1, [GLASSWORKS]: 1 });
    expect(baOf(s).paths).toEqual({});
    expect(centreBarbarians(s, CASTLE_TRADE)).toBe(1);
    expect(tradersOf(s).barbarians).toEqual([]);
    expect(tradersOf(s).swift.deck).toBe(0);
    expect(s.devDeck).toHaveLength(0);
    expect(s.robber).toBe(NO_ROBBER);
  });

  it('Caravans + BA: the oasis on BA’s desert, only two caravan starts', () => {
    const s = game('caravansBa');
    expect(terrainOf(s, QUARRY)).toBe('tb/oasis');
    expect(tbBoard(s).caravanStarts).toHaveLength(2);
    expect(tbBoard(s).coast).not.toContain(QUARRY);
    expect(tbBoard(s).coast).not.toContain(BA_CASTLE);
    expect(Object.keys(baOf(s).onHex).sort()).toEqual(['h:-2,0', 'h:0,2']);
  });

  it('Caravans + T&B: the oasis in the middle, all 18 discs (the trade hexes too)', () => {
    const s = game('caravansTraders');
    expect(terrainOf(s, 'h:0,0')).toBe('tb/oasis');
    const tokens = Object.values(s.board.hexes).flatMap((h) => (h.token ? [h.token] : []));
    expect(tokens.sort((a, b) => a - b)).toEqual([
      2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12,
    ]);
    for (const h of [CASTLE_TRADE, QUARRY, GLASSWORKS]) expect(tokenOf(s, h)).not.toBeNull();
    expect(tbBoard(s).caravanStarts).toHaveLength(3);
    expect(s.robber).toBe(NO_ROBBER);
  });

  it('Rivers + BA: the diagram — rivers, swamps without numbers, the 2 on the 12 hex', () => {
    const s = game('riversBa');
    const b = tbBoard(s);
    expect(b.rivers).toEqual(['h:2,-2', 'h:1,-1', 'h:0,0', 'h:-1,1', 'h:2,0', 'h:1,1', 'h:0,2']);
    expect(
      ['h:1,-1', 'h:0,0', 'h:-1,1', 'h:2,0', 'h:1,1'].map((h) => [
        terrainOf(s, h as HexId),
        tokenOf(s, h as HexId),
      ]),
    ).toEqual([
      ['wool', 5],
      ['brick', 10],
      ['ore', 9],
      ['ore', 11],
      ['brick', 5],
    ]);
    expect([tokenOf(s, 'h:2,-2'), tokenOf(s, 'h:0,2')]).toEqual([null, null]);
    expect(b.twoOnTwelve).toBe('h:-2,0');
    expect(tokenOf(s, 'h:-2,0')).toBe(12);
    expect(b.bridgeSites).toHaveLength(7);
    expect(baOf(s).onHex).toEqual({ 'h:-2,0': 1, 'h:2,0': 1 });
  });

  it('Rivers + Caravans: the 2 and the 12 on the two 3s; the oasis in the middle', () => {
    for (const seed of [1, 2, 3]) {
      const s = game('riversCaravans', 4, seed);
      const also = tbBoard(s).alsoOn ?? [];
      expect(also.map((x) => x.number).sort((a, b) => a - b)).toEqual([2, 12]);
      for (const x of also) expect(tokenOf(s, x.hex)).toBe(3);
      expect(also[0]?.hex).not.toBe(also[1]?.hex);
      const tokens = Object.values(s.board.hexes).flatMap((h) => (h.token ? [h.token] : []));
      expect(tokens).toHaveLength(16);
      expect(terrainOf(s, 'h:0,0')).toBe('tb/oasis');
      expect(terrainOf(s, s.robber as HexId)).toBe('tb/swamp');
    }
  });

  it('Rivers + T&B: rivers apart, trade hexes numbered, the 2 on the 12, 3 gold each', () => {
    const s = game('riversTraders');
    const t = topologyOf(s);
    const rivers = tbBoard(s).rivers ?? [];
    const a = rivers.slice(0, 4);
    const b = rivers.slice(4);
    for (const h of a) for (const n of hexNeighbors(t, h)) expect(b).not.toContain(n);
    const tokens = Object.values(s.board.hexes).flatMap((h) => (h.token ? [h.token] : []));
    expect(tokens).toHaveLength(17);
    expect(tokens).not.toContain(2);
    for (const h of [CASTLE_TRADE, QUARRY, GLASSWORKS]) expect(tokenOf(s, h)).not.toBeNull();
    const twelve = tbBoard(s).twoOnTwelve;
    expect(twelve && tokenOf(s, twelve)).toBe(12);
    expect(tbSlice(s).gold).toEqual([3, 3, 3, 3]);
  });
});

// ---------------------------------------------------------------------------------------------
// Shared rules
// ---------------------------------------------------------------------------------------------

describe('trade hexes that produce (Caravans + T&B, Rivers + T&B, BA + T&B)', () => {
  it('quarry brick, glassworks lumber, castle wool (city 2)', () => {
    const s = main('caravansTraders');
    const yields: [HexId, Resource][] = [
      [QUARRY, 'brick'],
      [GLASSWORKS, 'lumber'],
      [CASTLE_TRADE, 'wool'],
    ];
    for (const [h, r] of yields) {
      const n = tokenOf(s, h) as number;
      const v = cornerOf(s, h);
      settle(s, 1, v, 'city');
      const owed = computeProduction(s, n)[1] ?? {};
      expect(owed[r], h).toBeGreaterThanOrEqual(2);
      s.pieces.buildings = {};
    }
  });

  it('not on the sheets without trade production', () => {
    const s = main('caravansBa');
    expect(tbBoard(s).tradeHexes ?? []).toHaveLength(0);
  });

  it('a 2 and a 12 on the board are not re-rolled (T&B re-rolls them only without discs)', () => {
    const s = main('caravansTraders');
    s.phase = { kind: 'preRoll' };
    s.rng = rngFor(1, 1);
    const t = run(s, act('rollDice', 0));
    expect(t.dice).toEqual([1, 1]);
  });
});

describe('Rivers + T&B', () => {
  function riverEdge(s: GameState, site: boolean): EdgeId {
    const sites = new Set(tbBoard(s).bridgeSites ?? []);
    const rivers = new Set(tbBoard(s).rivers ?? []);
    const t = topologyOf(s);
    const e = t.edges.find(
      (x) =>
        sites.has(x) === site &&
        (t.edge[x]?.hexes ?? []).some((h) => rivers.has(h)) &&
        (t.edge[x]?.hexes.length ?? 0) === 2,
    );
    if (!e) throw new Error('no river edge');
    return e;
  }

  it('river gold for a settlement only during set-up; roads beside a river still pay', () => {
    const s = main('riversTraders');
    const rivers = tbBoard(s).rivers ?? [];
    const h = rivers.find((x) => tokenOf(s, x) !== null) as HexId;
    const before = goldOf(s, 0);
    const t = buildOn(s, 0, h);
    // The settlement pays nothing; its road was placed by hand (no gold).
    expect(goldOf(t, 0)).toBe(before);
    const u = structuredClone(t);
    const e = riverEdge(u, false);
    const v = topologyOf(u).edge[e]?.vertices[0] as VertexId;
    settle(u, 0, v);
    u.players[0]!.resources.brick += 1;
    u.players[0]!.resources.lumber += 1;
    const w = run(u, act('buildRoad', 0, { edge: e }));
    expect(goldOf(w, 0)).toBe(before + 1);
  });

  it('set-up: a settlement beside a river pays 1 gold on top of the 3', () => {
    const s = game('riversTraders');
    const rivers = new Set(tbBoard(s).rivers ?? []);
    const t = topologyOf(s);
    const spot = legalActions(s).find(
      (a) =>
        a.type === 'placeSetupSettlement' &&
        (t.vertex[field(a, 'vertex') as VertexId]?.hexes ?? []).some((h) => rivers.has(h)),
    );
    if (!spot) throw new Error('no river spot');
    expect(goldOf(run(s, spot), 0)).toBe(4);
  });

  it('a bridge pays 2 gold', () => {
    const s = main('riversTraders');
    const site = (tbBoard(s).bridgeSites ?? [])[0] as EdgeId;
    settle(s, 0, topologyOf(s).edge[site]?.vertices[0] as VertexId);
    s.players[0]!.resources.brick = 2;
    s.players[0]!.resources.lumber = 1;
    const before = goldOf(s, 0);
    expect(goldOf(run(s, act('tb/buildBridge', 0, { edge: site })), 0)).toBe(before + 2);
  });

  it('the Poor Settler loses no VP (Rivers + BA too)', () => {
    for (const sc of ['riversTraders', 'riversBa']) {
      const s = main(sc);
      tbSlice(s).gold = [5, 0, 0, 0];
      expect(victoryPoints(s, 1)).toBe(0);
      expect(victoryPoints(s, 0)).toBe(1);
    }
    const plain = main('riversCaravans');
    tbSlice(plain).gold = [5, 0, 0, 0];
    expect(victoryPoints(plain, 1)).toBe(-2);
  });

  it('a wagon crossing a river: 3 MP, 1 over your bridge, 1 + 2 gold to the owner over another’s', () => {
    const s = main('riversTraders');
    const site = riverEdge(s, true);
    expect(stepCost(s, 0, site)).toEqual({ mp: 3, toll: null });
    s.pieces.roads[site] = 0;
    expect(stepCost(s, 0, site)).toEqual({ mp: 1, toll: null });
    s.pieces.roads[site] = 1;
    expect(stepCost(s, 0, site)).toEqual({ mp: 1, toll: 1 });
    const [from, to] = topologyOf(s).edge[site]?.vertices as [VertexId, VertexId];
    tradersOf(s).wagons[0] = from;
    tbSlice(s).gold = [5, 5, 3, 3];
    const u = run(s, act('tb/startWagon', 0, { vertex: to }));
    expect(tbSlice(u).gold.slice(0, 2)).toEqual([3, 7]);
    tbSlice(s).gold = [1, 5, 3, 3];
    expect(wagonSteps(s, 0).map((x) => x.vertex)).not.toContain(to);
  });
});

describe('Rivers + Barbarian Attack', () => {
  it('the 2/12 hex lands a barbarian on either number and produces on both', () => {
    const s = main('riversBa');
    const h: HexId = 'h:-2,0';
    const v = cornerOf(s, h);
    settle(s, 1, v);
    expect(computeProduction(s, 2)[1]?.[terrainOf(s, h) as Resource]).toBe(1);
    expect(computeProduction(s, 12)[1]?.[terrainOf(s, h) as Resource]).toBe(1);
    // A landing roll of 2 lands on it: rolls 2, 3, 4.
    const site = buildOnRolls(s, [1, 1, 1, 2, 2, 2]);
    expect(baOf(site).onHex[h]).toBe(2);
    // Conquered: it produces nothing, not on the 2 either.
    baOf(s).onHex[h] = 3;
    expect(computeProduction(s, 2)[1]?.[terrainOf(s, h) as Resource] ?? 0).toBe(0);
  });
});

/** Build a settlement on a fresh inner spot for player 0 with the landing dice set. */
function buildOnRolls(s: GameState, dice: number[]): GameState {
  const c = structuredClone(s);
  c.rng = rngFor(...dice);
  return buildOn(c, 0, 'h:0,-1');
}

describe('Rivers + Caravans', () => {
  it('each 3 hex produces on its extra number', () => {
    const s = main('riversCaravans');
    for (const x of tbBoard(s).alsoOn ?? []) {
      s.pieces.buildings = {};
      settle(s, 2, cornerOf(s, x.hex, 1));
      const r = terrainOf(s, x.hex) as Resource;
      expect(computeProduction(s, x.number)[2]?.[r], `${x.hex} on ${x.number}`).toBeGreaterThan(0);
    }
  });

  it('a camel may go on a bridge site, bridge or not', () => {
    const s = main('riversCaravans');
    const site = (tbBoard(s).bridgeSites ?? [])[0] as EdgeId;
    const v = topologyOf(s).edge[site]?.vertices[0] as VertexId;
    caravansOf(s).heads[0] = v;
    expect(camelOptions(s).map((c) => c.edge)).toContain(site);
    s.pieces.roads[site] = 1;
    expect(camelOptions(s).map((c) => c.edge)).toContain(site);
  });
});

describe('Caravans + Barbarian Attack', () => {
  it('barbarians never stop a camel: a camel may go beside a conquered hex', () => {
    const s = main('caravansBa');
    const start = tbBoard(s).caravanStarts?.[0];
    if (!start) throw new Error('no start');
    for (const h of topologyOf(s).edge[start.edge]?.hexes ?? []) baOf(s).onHex[h] = 3;
    expect(camelOptions(s).map((c) => c.edge)).toContain(start.edge);
  });
});

// ---------------------------------------------------------------------------------------------
// Barbarian Attack + Traders & Barbarians
// ---------------------------------------------------------------------------------------------

describe('BA + T&B: barbarians by paths', () => {
  it('a landing: the builder picks a free path of each hex hit; wagons pay 2 MP more there', () => {
    // Landing rolls 3, 4, 5: coastal 3 (h:0,-2), 4 (h:-2,1), 5 (h:1,1).
    const t = buildOnRolls(main('baTraders'), [1, 2, 2, 2, 1, 4]);
    expect(t.phase.kind).toBe('tbpair/landPath');
    const queue = () => (t.phase as unknown as { queue: HexId[] }).queue;
    expect([...queue()].sort()).toEqual(['h:-2,1', 'h:0,-2', 'h:1,1']);
    let u = t;
    for (const h of queue()) {
      const picks = legalOf(u, 'tbpair/barbarianPath');
      expect(picks.map((a) => field(a, 'edge')).sort()).toEqual([...freePaths(u, h)].sort());
      u = run(u, picks[0] as Action);
      expect(Object.values(baOf(u).paths ?? {})).toContain(h);
    }
    expect(u.phase.kind).toBe('main');
    const e = Object.keys(baOf(u).paths ?? {})[0] as EdgeId;
    expect(stepCost(u, 0, e).mp).toBe(4);
  });

  it('a hex with every path taken gets the next barbarian at its centre', () => {
    const s = main('baTraders');
    const h: HexId = 'h:0,-2';
    baOf(s).onHex[h] = 2;
    const all = hexPaths(s, h);
    // Every path of the hex already has a barbarian (counted on a far hex: enough here).
    baOf(s).paths = Object.fromEntries(all.map((e) => [e, 'h:2,0' as HexId]));
    baOf(s).onHex['h:2,0'] = all.length;
    let t = buildOnRolls(s, [1, 2, 3, 4, 3, 4]);
    // The other landing rolls ask for their paths; this hex never does.
    while (t.phase.kind === 'tbpair/landPath') {
      expect((t.phase as unknown as { queue: HexId[] }).queue[0]).not.toBe(h);
      t = run(t, legalOf(t, 'tbpair/barbarianPath')[0] as Action);
    }
    expect(baOf(t).onHex[h]).toBe(3);
    expect(centreBarbarians(t, h)).toBe(3);
  });

  it('a rolled 2 or 12 lands a barbarian on that coastal hex (no re-roll), then production', () => {
    const s = main('baTraders');
    settle(s, 1, cornerOf(s, GLASSWORKS));
    s.phase = { kind: 'preRoll' };
    s.rng = rngFor(1, 1);
    const t = run(s, act('rollDice', 0));
    expect(t.dice).toEqual([1, 1]);
    expect(t.phase.kind).toBe('tbpair/landPath');
    expect(baOf(t).onHex[GLASSWORKS]).toBe(2);
    const lumber = t.players[1]!.resources.lumber;
    const u = run(t, legalOf(t, 'tbpair/barbarianPath')[0] as Action);
    expect(u.phase.kind).toBe('main');
    // The glassworks produces lumber (not conquered: 2 barbarians).
    expect(u.players[1]!.resources.lumber).toBe(lumber + 1);
  });

  it('a conquered trade hex produces nothing; deliveries there go on', () => {
    const s = main('baTraders');
    settle(s, 1, cornerOf(s, CASTLE_TRADE));
    expect(computeProduction(s, 12)[1]?.wool).toBe(1);
    baOf(s).onHex[CASTLE_TRADE] = 3;
    expect(computeProduction(s, 12)[1]?.wool ?? 0).toBe(0);
    tradersOf(s).commodity[1] = 'glass';
    visitPlaza(s, 1, CASTLE_TRADE);
    expect(tradersOf(s).delivered[1]).toBe(1);
  });

  it('a 7: discards, then steal from any player; no barbarian moves', () => {
    const s = main('baTraders');
    s.players[2]!.resources.ore = 2;
    s.phase = { kind: 'preRoll' };
    s.rng = rngFor(3, 4);
    const t = run(s, act('rollDice', 0));
    expect(t.phase.kind).toBe('steal');
    expect(baOf(t).onHex).toEqual(baOf(s).onHex);
  });

  it('a drive-off: the barbarian goes to any unconquered hex (inland too), by a path', () => {
    const s = main('baTraders');
    const e = hexPaths(s, 'h:-1,-1')[0] as EdgeId;
    baOf(s).onHex['h:-1,-1'] = 1;
    baOf(s).paths = { [e]: 'h:-1,-1' };
    const at = topologyOf(s).edge[e]?.vertices[0] as VertexId;
    tradersOf(s).wagons[0] = at;
    tradersOf(s).level[0] = 5;
    setPhase(s, { kind: 'tb/wagon' });
    expect(pathsAt(s, at)).toContain(e);
    s.rng = rngFor(6);
    const t = run(s, act('tb/driveOff', 0, { edge: e }));
    expect(t.phase.kind).toBe('tbpair/moveBarbarian');
    const dests = legalOf(t, 'tbpair/barbarianHex').map((a) => field(a, 'hex'));
    expect(dests).toContain('h:0,0');
    const u = run(t, act('tbpair/barbarianHex', 0, { hex: 'h:0,0' }));
    const path = legalOf(u, 'tbpair/barbarianPath')[0] as Action;
    const w = run(u, path);
    expect(w.phase.kind).toBe('tb/wagon');
    expect(baOf(w).onHex['h:-1,-1']).toBeUndefined();
    expect(baOf(w).onHex['h:0,0']).toBe(1);
    expect(baOf(w).paths).toEqual({ [field(path, 'edge')]: 'h:0,0' });
  });

  it('Treason: pick a barbarian, a hex (inland too), its path; twice; +2 gold', () => {
    const s = main('baTraders');
    baOf(s).deck.push('treason');
    s.players[0]!.resources = { brick: 0, lumber: 0, wool: 1, grain: 1, ore: 1 };
    const t = run(s, act('tb/buyCard', 0));
    expect(t.phase.kind).toBe('tbpair/moveBarbarian');
    expect(goldOf(t, 0)).toBe(goldOf(s, 0) + 2);
    const picks = legalOf(t, 'tbpair/pickBarbarian');
    expect(picks.map((a) => field(a, 'hex')).sort()).toEqual([CASTLE_TRADE, GLASSWORKS].sort());
    let u = run(t, act('tbpair/pickBarbarian', 0, { hex: CASTLE_TRADE }));
    const dests = legalOf(u, 'tbpair/barbarianHex').map((a) => field(a, 'hex'));
    expect(dests).toContain('h:0,0');
    expect(dests).not.toContain(CASTLE_TRADE);
    u = run(u, act('tbpair/barbarianHex', 0, { hex: 'h:0,0' }));
    u = run(u, legalOf(u, 'tbpair/barbarianPath')[0] as Action);
    expect(u.phase.kind).toBe('tbpair/moveBarbarian');
    // The second: the moved one's hex may not be a source again, nor h:0,0 a destination.
    expect(barbarianRefs(u).length).toBe(2);
    const second = legalOf(u, 'tbpair/pickBarbarian').map(
      (a) => field(a, 'hex') ?? field(a, 'edge'),
    );
    expect(second).toEqual([GLASSWORKS]);
    u = run(u, act('tbpair/pickBarbarian', 0, { hex: GLASSWORKS }));
    expect(legalOf(u, 'tbpair/barbarianHex').map((a) => field(a, 'hex'))).not.toContain('h:0,0');
    u = run(u, act('tbpair/barbarianHex', 0, { hex: 'h:1,0' }));
    u = run(u, legalOf(u, 'tbpair/barbarianPath')[0] as Action);
    expect(u.phase.kind).toBe('main');
    expect(baOf(u).onHex).toEqual({ 'h:0,0': 1, 'h:1,0': 1 });
  });

  it('Intrigue: take the picked barbarian prisoner (its path is free again)', () => {
    const s = main('baTraders');
    const e = hexPaths(s, 'h:0,-2')[0] as EdgeId;
    baOf(s).onHex['h:0,-2'] = 1;
    baOf(s).paths = { [e]: 'h:0,-2' };
    baOf(s).deck.push('intrigue');
    s.players[0]!.resources = { brick: 0, lumber: 0, wool: 1, grain: 1, ore: 1 };
    const t = run(s, act('tb/buyCard', 0));
    expect(t.phase.kind).toBe('tbpair/intrigue');
    expect(legalOf(t, 'tbpair/pickBarbarian')).toHaveLength(3);
    const u = run(t, act('tbpair/pickBarbarian', 0, { edge: e }));
    expect(baOf(u).prisoners[0]).toBe(1);
    expect(baOf(u).paths).toEqual({});
    expect(baOf(u).onHex['h:0,-2']).toBeUndefined();
  });

  it('expelled barbarians leave their paths', () => {
    const s = main('baTraders');
    const h: HexId = 'h:0,-2';
    const [a, b, c] = hexPaths(s, h) as [EdgeId, EdgeId, EdgeId];
    baOf(s).onHex[h] = 1;
    baOf(s).paths = { [a]: h };
    baOf(s).knights[b] = 0;
    baOf(s).knights[c] = 0;
    const t = run(s, act('endTurn', 0));
    expect(baOf(t).onHex[h]).toBeUndefined();
    expect(baOf(t).paths).toEqual({});
    expect(baOf(t).prisoners[0]).toBe(1);
  });

  it('knights and the wagon at the end of the turn, in either order', () => {
    const s = main('baTraders');
    const e = hexPaths(s, 'h:0,0')[0] as EdgeId;
    baOf(s).knights[e] = 0;
    const v = cornerOf(s, 'h:0,-1');
    tradersOf(s).wagons[0] = v;
    const knights = run(s, legalOf(s, 'tb/startKnights')[0] as Action);
    expect(knights.phase.kind).toBe('tb/knights');
    const wagon = legalOf(knights, 'tb/startWagon');
    expect(wagon.length).toBeGreaterThan(0);
    expect(run(knights, wagon[0] as Action).phase.kind).toBe('tb/wagon');
    const first = run(s, legalOf(s, 'tb/startWagon')[0] as Action);
    expect(first.phase.kind).toBe('tb/wagon');
    const back = legalOf(first, 'tb/startKnights');
    expect(back.length).toBeGreaterThan(0);
    expect(run(first, back[0] as Action).phase.kind).toBe('tb/knights');
  });

  it('no Swift Journey, no development card but BA’s', () => {
    const s = main('baTraders');
    s.players[0]!.resources = { brick: 0, lumber: 0, wool: 1, grain: 1, ore: 1 };
    expect(legalOf(s, 'buyDevCard')).toHaveLength(0);
    expect(legalOf(s, 'tb/buyCard')).toHaveLength(1);
  });
});
