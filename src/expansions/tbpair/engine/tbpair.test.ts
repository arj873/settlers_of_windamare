/**
 * T&B scenario pairs with Fishing on Catan (the 2025 sheets, traders-barbarians.md §8.1): the
 * mode, the boards, one test per sheet rule, soundness.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../../../engine/engine';
import { createGame } from '../../../engine/createGame';
import { computeProduction } from '../../../engine/rules/production';
import { hexNeighbors, topologyOf } from '../../../engine/topology';
import type { Action, EdgeId, GameState, PlayerId, VertexId } from '../../../engine/types';
import { baOf, featuresOf, fishOf, fishOwed, goldOf, tbBoard, tradersOf } from '../../tb/engine';
import { bridgesBuilt } from '../../tb/engine/rivers';
import { FISH_PAIRS, TBPAIR, TBPAIR_MODE, TBPAIR_SCENARIOS } from '.';

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#40404${i}` }));

function game(scenario: string, n = 4, extra: Record<string, unknown> = {}): GameState {
  return createGame({
    seed: 5,
    players: players(n),
    mode: TBPAIR_MODE,
    scenario,
    startingPlayer: 0,
    ...extra,
  });
}

function main(scenario: string): GameState {
  const s = game(scenario);
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
const fails = (s: GameState, a: Action, match: RegExp) => {
  const r = applyAction(s, a);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(match);
};
const legalOf = (s: GameState, type: string) => legalActions(s).filter((a) => a.type === type);

describe('the mode and boards', () => {
  it('plays Fishing with a second T&B scenario at the sheets’ targets, 3-4 players', () => {
    const want: Record<string, [string, number]> = {
      'tbpair/fishRivers': ['rivers', 10],
      'tbpair/fishTraders': ['traders', 12],
      'tbpair/fishBa': ['ba', 12],
      'tbpair/fishCaravans': ['caravans', 12],
    };
    for (const sc of TBPAIR_SCENARIOS) {
      const s = game(sc, 3);
      expect(s.settings.expansions).toEqual([TBPAIR, 'tb']);
      expect(featuresOf(sc)).toEqual(['fish', want[sc]?.[0]]);
      expect(s.settings.vpToWin).toBe(want[sc]?.[1]);
    }
    expect(() => game('tbpair/fishRivers', 5)).toThrow(/players/);
  });

  it('six fishing grounds; no lake, except beside the oasis with the Caravans', () => {
    for (const p of FISH_PAIRS) {
      const s = game(p.id, 4, { seed: 11 });
      const b = tbBoard(s);
      expect(b.grounds, p.id).toHaveLength(6);
      if (p.other !== 'tb/caravans') {
        expect(b.lakes ?? []).toHaveLength(0);
        continue;
      }
      const lake = b.lakes?.[0]?.hex;
      const oasis = Object.values(s.board.hexes).find((h) => h.terrain === 'tb/oasis')?.id;
      expect(lake && oasis && hexNeighbors(topologyOf(s), oasis)).toContain(lake);
      // The 2 shares the 12's hex: 17 numbered hexes, no 2 token, the 12 hex on record.
      const tokens = Object.values(s.board.hexes).flatMap((h) => (h.token ? [h.token] : []));
      expect(tokens).toHaveLength(17);
      expect(tokens).not.toContain(2);
      expect(b.twoOnTwelve && s.board.hexes[b.twoOnTwelve]?.token).toBe(12);
    }
  });

  it('Caravans: the 12 hex produces on a 2 as well', () => {
    const s = main('tbpair/fishCaravans');
    const h = tbBoard(s).twoOnTwelve;
    if (!h) throw new Error('no 12');
    const v = topologyOf(s).hex[h]?.vertices[0] as VertexId;
    s.pieces.buildings[v] = { owner: 1, kind: 'settlement' };
    const terrain = s.board.hexes[h]?.terrain as 'brick';
    expect(computeProduction(s, 2)[1]?.[terrain]).toBe(1);
    expect(computeProduction(s, 12)[1]?.[terrain]).toBe(1);
  });
});

describe('Fishing + Rivers', () => {
  function withSite() {
    const s = main('tbpair/fishRivers');
    const site = (tbBoard(s).bridgeSites ?? [])[0] as EdgeId;
    const v = topologyOf(s).edge[site]?.vertices[0] as VertexId;
    s.pieces.buildings[v] = { owner: 0, kind: 'settlement' };
    return { s, site };
  }

  it('6 fish pay for a bridge (its gold too)', () => {
    const { s, site } = withSite();
    fishOf(s).hands[0] = [3, 3];
    expect(legalOf(s, 'tbpair/fishBridge').map((a) => (a as { edge?: string }).edge)).toContain(
      site,
    );
    const t = run(s, act('tbpair/fishBridge', 0, { edge: site }));
    expect(t.pieces.roads[site]).toBe(0);
    expect(bridgesBuilt(t, 0)).toBe(1);
    expect(goldOf(t, 0)).toBe(3);
    expect(fishOf(t).hands[0]).toEqual([]);
  });

  it('not with 5 fish, not off a bridge site, not before the roll', () => {
    const { s, site } = withSite();
    fishOf(s).hands[0] = [3, 2];
    fails(s, act('tbpair/fishBridge', 0, { edge: site }), /needs 6 fish/);
    fishOf(s).hands[0] = [3, 3];
    const road = topologyOf(s).edges.find((e) => !(tbBoard(s).bridgeSites ?? []).includes(e));
    fails(s, act('tbpair/fishBridge', 0, { edge: road }), /bridge site/);
    s.phase = { kind: 'preRoll' };
    fails(s, act('tbpair/fishBridge', 0, { edge: site }), /own turn/);
  });
});

describe('Fishing + Traders & Barbarians', () => {
  function moving(): GameState {
    const s = main('tbpair/fishTraders');
    const v = 'v:0,0,N' as VertexId;
    tradersOf(s).wagons[0] = v;
    s.phase = { kind: 'tb/wagon' } as unknown as GameState['phase'];
    return s;
  }

  it('there is no robber to chase: 2 fish give the wagon 2 more MP instead, once per move', () => {
    const s = moving();
    fishOf(s).hands[0] = [2];
    s.phase = { kind: 'main' };
    expect(legalOf(s, 'tb/fish').filter((a) => (a as { use?: string }).use === 'robber')).toEqual(
      [],
    );
    s.phase = { kind: 'tb/wagon' } as unknown as GameState['phase'];
    const mp = tradersOf(s).move.mp;
    const t = run(s, act('tbpair/fishWagon', 0));
    expect(tradersOf(t).move.mp).toBe(mp + 2);
    fishOf(t).hands[0] = [2];
    fails(t, act('tbpair/fishWagon', 0), /already/);
    // Like grain: no grain after the fish either.
    t.players[0]!.resources.grain = 1;
    expect(legalOf(t, 'tb/wagonGrain')).toHaveLength(0);
  });
});

describe('Fishing + Barbarian Attack', () => {
  it('2 fish move a knight up to 5 paths, as 1 grain does', () => {
    const s = main('tbpair/fishBa');
    const t = topologyOf(s);
    const from = t.edges.find(
      (e) => !(tbBoard(s).castles ?? []).some((h) => t.hex[h]?.edges.includes(e)),
    ) as EdgeId;
    baOf(s).knights[from] = 0;
    s.phase = { kind: 'tb/knights', from } as unknown as GameState['phase'];
    s.players[0]!.resources.grain = 0;
    fishOf(s).hands[0] = [1];
    expect(legalOf(s, 'tbpair/fishKnight')).toHaveLength(0);
    fishOf(s).hands[0] = [2];
    const far = legalOf(s, 'tbpair/fishKnight');
    expect(far.length).toBeGreaterThan(0);
    const to = (far[0] as unknown as { edge: EdgeId }).edge;
    expect(legalOf(s, 'tb/moveKnight').map((a) => (a as { edge?: string }).edge)).not.toContain(to);
    const u = run(s, far[0] as Action);
    expect(baOf(u).knights[to]).toBe(0);
    expect(baOf(u).knights[from]).toBeUndefined();
    expect(fishOf(u).hands[0]).toEqual([]);
  });

  it('conquered buildings catch no fish', () => {
    const s = main('tbpair/fishBa');
    const t = topologyOf(s);
    const coast = new Set(tbBoard(s).coast ?? []);
    const g = (tbBoard(s).grounds ?? []).find((x) =>
      (t.vertex[x.vertices[0] as VertexId]?.hexes ?? []).every((h) => coast.has(h)),
    );
    if (!g) throw new Error('no ground on the coast');
    const v = g.vertices[0] as VertexId;
    s.pieces.buildings[v] = { owner: 1, kind: 'settlement' };
    expect(fishOwed(s, g.number)[1]).toBe(1);
    for (const h of t.vertex[v]?.hexes ?? []) baOf(s).onHex[h] = 3;
    expect(fishOwed(s, g.number)[1]).toBe(0);
  });

  it('no fish road on a conquered hex’s edge', () => {
    const s = main('tbpair/fishBa');
    const t = topologyOf(s);
    const h = (tbBoard(s).coast ?? [])[0] as string;
    const v = t.hex[h as never]?.vertices.find(
      (x) => (t.vertex[x]?.hexes.length ?? 0) >= 2,
    ) as VertexId;
    s.pieces.buildings[v] = { owner: 0, kind: 'settlement' };
    baOf(s).onHex[h as never] = 3;
    fishOf(s).hands[0] = [3, 2];
    const r = applyAction(s, act('tb/fish', 0, { use: 'road' }));
    const after = r.ok ? r.state : s;
    const free = legalOf(after, 'placeFreeRoad').map((a) => (a as { edge?: EdgeId }).edge);
    for (const e of t.hex[h as never]?.edges ?? []) expect(free).not.toContain(e);
  });
});

describe('soundness', { timeout: 180_000 }, () => {
  for (const sc of TBPAIR_SCENARIOS) {
    it(`${sc}: every legal action is accepted`, () => {
      let s = game(sc, 4, { seed: 9 });
      let pick = 12345;
      for (let step = 0; step < 900 && s.phase.kind !== 'gameOver'; step++) {
        const legal = legalActions(s);
        expect(legal.length, s.phase.kind).toBeGreaterThan(0);
        for (const a of legal.slice(0, 25)) {
          const r = applyAction(s, a);
          expect(r.ok, `${JSON.stringify(a)}: ${r.ok ? '' : r.error}`).toBe(true);
        }
        pick = (pick * 1103515245 + 12345) >>> 0;
        const progress = legal.filter((a) => a.type !== 'endTurn');
        const from = progress.length > 0 && pick % 3 !== 0 ? progress : legal;
        s = run(s, from[pick % from.length] as Action);
      }
    });
  }
});
