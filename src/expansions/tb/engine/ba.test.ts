/** Barbarian Attack (§2.5, §3.6, §4.8). */
import { describe, expect, it } from 'vitest';
import { bankTradeRatio } from '../../../engine/actions/trade';
import { publicVictoryPoints, victoryPoints } from '../../../engine/selectors';
import { hexEdges, hexVertices, topologyOf } from '../../../engine/topology';
import type { EdgeId, GameState, HexId, VertexId } from '../../../engine/types';
import {
  baOf,
  goldOf,
  isCastleEdge,
  isConqueredBuilding,
  isConqueredHex,
  knightTargets,
  tbBoard,
} from '.';
import { bad, build, legalOf, ok, rngFor, roads, setHand, tbGame, tbMain } from './testkit';

const coast = (s: GameState) => tbBoard(s).coast ?? [];
const hexWith = (s: GameState, n: number): HexId =>
  coast(s).find((h) => s.board.hexes[h]?.token === n) as HexId;
const castleEdges = (s: GameState) => hexEdges(topologyOf(s), 'h:-2,2');

describe('setup', () => {
  it('one barbarian on the coastal 2 and 12, 28 in the supply, no base development cards', () => {
    const s = tbGame('barbarianAttack');
    const b = baOf(s);
    expect(b.onHex).toEqual({ [hexWith(s, 2)]: 1, [hexWith(s, 12)]: 1 });
    expect(b.supply).toBe(28);
    expect(b.deck).toHaveLength(26);
    expect(s.devDeck).toEqual([]);
    expect(s.robber).toBe('h:999,999');
  });

  it('the second setup building is a city', () => {
    const s = tbGame('barbarianAttack', 3);
    s.phase = { kind: 'setup', index: 3, step: 'settlement', lastSettlement: null };
    s.turn.current = 2;
    const next = ok(s, { type: 'placeSetupSettlement', player: 2, vertex: 'v:0,0,N' });
    expect(next.pieces.buildings['v:0,0,N']?.kind).toBe('city');
  });
});

describe('barbarians land', () => {
  it('each settlement built lands up to 3 barbarians on distinct non-7 numbers', () => {
    const s = tbMain('barbarianAttack');
    const v: VertexId = 'v:0,0,N';
    roads(s, 0, (topologyOf(s).vertex[v]?.edges ?? [])[0] as EdgeId);
    setHand(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    // Rolls: 2 (1+1), 7 (3+4, re-rolled), 3 (1+2), 4 (2+2).
    s.rng = rngFor(1, 1, 3, 4, 1, 2, 2, 2);
    const next = ok(s, { type: 'buildSettlement', player: 0, vertex: v });
    const b = baOf(next);
    expect(b.onHex[hexWith(s, 2)]).toBe(2);
    expect(b.onHex[hexWith(s, 3)]).toBe(1);
    expect(b.onHex[hexWith(s, 4)]).toBe(1);
    expect(b.supply).toBe(25);
  });

  it('a number already rolled in the same landing is rolled again', () => {
    const s = tbMain('barbarianAttack');
    const v: VertexId = 'v:0,0,N';
    roads(s, 0, (topologyOf(s).vertex[v]?.edges ?? [])[0] as EdgeId);
    setHand(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    // Rolls: 2, 2 (again: re-rolled), 3, 4.
    s.rng = rngFor(1, 1, 1, 1, 1, 2, 2, 2);
    const next = ok(s, { type: 'buildSettlement', player: 0, vertex: v });
    expect(baOf(next).onHex[hexWith(s, 2)]).toBe(2);
    expect(baOf(next).onHex[hexWith(s, 4)]).toBe(1);
  });

  it('a hex with 3 barbarians takes no more; the supply running out stops the landing', () => {
    const s = tbMain('barbarianAttack');
    baOf(s).onHex[hexWith(s, 2)] = 3;
    baOf(s).supply = 1;
    const v: VertexId = 'v:0,0,N';
    roads(s, 0, (topologyOf(s).vertex[v]?.edges ?? [])[0] as EdgeId);
    setHand(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    s.rng = rngFor(1, 1, 1, 2, 2, 2);
    const next = ok(s, { type: 'buildSettlement', player: 0, vertex: v });
    expect(baOf(next).onHex[hexWith(s, 2)]).toBe(3);
    expect(baOf(next).onHex[hexWith(s, 3)]).toBe(1);
    expect(baOf(next).supply).toBe(0);
  });
});

describe('conquest', () => {
  it('a conquered hex produces nothing and bans new roads and settlements next to it', () => {
    const s = tbMain('barbarianAttack');
    const h = hexWith(s, 8);
    baOf(s).onHex[h] = 3;
    expect(isConqueredHex(s, h)).toBe(true);
    const v = hexVertices(topologyOf(s), h)[0] as VertexId;
    build(s, 1, v, 'city');
    s.rng = rngFor(4, 4);
    s.phase = { kind: 'preRoll' };
    const next = ok(s, { type: 'rollDice', player: 0 });
    const terrain = s.board.hexes[h]?.terrain as 'ore';
    expect(next.players[1]?.resources[terrain]).toBe(0);
    const free = hexVertices(topologyOf(s), h)[3] as VertexId;
    const e = hexEdges(topologyOf(s), h)[3] as EdgeId;
    roads(s, 0, ...(topologyOf(s).vertex[free]?.edges ?? []).filter((x) => x !== e));
    setHand(s, 0, { brick: 2, lumber: 2, wool: 1, grain: 1 });
    expect(
      legalOf(s, 'buildSettlement').some((a) => a.type === 'buildSettlement' && a.vertex === free),
    ).toBe(false);
    bad(s, { type: 'buildRoad', player: 0, edge: e });
  });

  it('a building with only conquered hexes around counts 0 VP, loses its harbour and cannot upgrade', () => {
    const s = tbMain('barbarianAttack');
    const port = s.board.ports.find((p) => {
      const hexes = topologyOf(s).vertex[p.vertices[0]]?.hexes ?? [];
      return hexes.length === 1 && coast(s).includes(hexes[0] as HexId);
    });
    const v = port!.vertices[0];
    const h = topologyOf(s).vertex[v]?.hexes[0] as HexId;
    build(s, 0, v);
    setHand(s, 0, { [port!.kind === 'generic' ? 'wool' : port!.kind]: 3, grain: 2, ore: 3 });
    const r = port!.kind === 'generic' ? 'wool' : port!.kind;
    expect(bankTradeRatio(s, 0, r)).toBeLessThan(4);
    baOf(s).onHex[h] = 3;
    expect(isConqueredBuilding(s, v)).toBe(true);
    expect(publicVictoryPoints(s, 0)).toBe(0);
    expect(bankTradeRatio(s, 0, r)).toBe(4);
    bad(s, { type: 'buildCity', player: 0, vertex: v }, /conquered/);
  });
});

describe('a 7 without a robber', () => {
  it('discards as usual, then the roller steals from any player', () => {
    const s = tbMain('barbarianAttack');
    setHand(s, 2, { ore: 1 });
    s.rng = rngFor(3, 4);
    s.phase = { kind: 'preRoll' };
    let next = ok(s, { type: 'rollDice', player: 0 });
    expect(next.phase).toEqual({ kind: 'steal', candidates: [2], resume: 'main' });
    next = ok(next, { type: 'steal', player: 0, victim: 2 });
    expect(next.players[0]?.resources.ore).toBe(1);
  });
});

describe('knights', () => {
  it('Knighthood places a knight on a free castle edge', () => {
    const s = tbMain('barbarianAttack');
    setHand(s, 0, { ore: 1, wool: 1, grain: 1 });
    baOf(s).deck.push('knighthood');
    let next = ok(s, { type: 'tb/buyCard', player: 0 });
    expect(next.phase).toMatchObject({ kind: 'tb/placeKnight', card: 'knighthood' });
    const spots = legalOf(next, 'tb/placeKnight').map((a) => (a as { edge: EdgeId }).edge);
    expect(spots.every((e) => isCastleEdge(next, e))).toBe(true);
    bad(next, { type: 'tb/placeKnight', player: 0, edge: 'e:0,0,E' }, /cannot go/);
    next = ok(next, { type: 'tb/placeKnight', player: 0, edge: spots[0] as EdgeId });
    expect(baOf(next).knights[spots[0] as EdgeId]).toBe(0);
    expect(next.phase.kind).toBe('main');
  });

  it('a knight moves up to 3 edges, 5 for 1 grain, never onto the castle or another knight', () => {
    const s = tbMain('barbarianAttack');
    baOf(s).knights['e:0,0,E'] = 0;
    baOf(s).knights['e:0,0,SE'] = 1;
    expect([...knightTargets(s, 'e:0,0,E').values()].every((d) => d <= 3)).toBe(true);
    expect(knightTargets(s, 'e:0,0,E').has('e:0,0,SE')).toBe(false);
    setHand(s, 0, { grain: 1 });
    const far = [...knightTargets(s, 'e:0,0,E')].find(([, d]) => d > 3)?.[0] as EdgeId;
    let next = ok(
      s,
      { type: 'tb/startKnights', player: 0, edge: 'e:0,0,E' },
      { type: 'tb/moveKnight', player: 0, edge: far },
    );
    expect(next.players[0]?.resources.grain).toBe(0);
    expect(baOf(next).knights[far]).toBe(0);
    // Each knight moves once per turn; no building any more after moving knights.
    expect(legalOf(next, 'tb/selectKnight')).toEqual([]);
    expect(legalOf(next, 'buildRoad')).toEqual([]);
    for (const e of castleEdges(s)) expect(knightTargets(s, 'e:0,0,E').has(e)).toBe(false);
    next = ok(next, { type: 'endTurn', player: 0 });
    expect(next.turn.current).toBe(1);
  });

  it('knights on the castle must move before the turn ends', () => {
    const s = tbMain('barbarianAttack');
    baOf(s).knights[castleEdges(s)[0] as EdgeId] = 0;
    bad(s, { type: 'endTurn', player: 0 }, /castle/);
    expect(legalOf(s, 'endTurn')).toEqual([]);
  });
});

describe('expelling the barbarians', () => {
  it('more knights than barbarians: prisoners, liberation, then a die for knight losses (3 gold each)', () => {
    const s = tbMain('barbarianAttack');
    const h = hexWith(s, 8);
    baOf(s).onHex[h] = 3;
    const [a, b, c, d] = hexEdges(topologyOf(s), h) as EdgeId[];
    Object.assign(baOf(s).knights, {
      [a as EdgeId]: 0,
      [b as EdgeId]: 0,
      [c as EdgeId]: 1,
      [d as EdgeId]: 1,
    });
    // Ties for the leftover prisoner: 0 rolls 6, 1 rolls 1; then the loss die: 1 -> the 'NE' family.
    s.rng = rngFor(6, 1, 1);
    const next = ok(s, { type: 'endTurn', player: 0 });
    const ba = baOf(next);
    expect(ba.prisoners[0]).toBe(2);
    expect(ba.prisoners[1]).toBe(1);
    expect(goldOf(next, 1)).toBeGreaterThanOrEqual(3);
    expect(isConqueredHex(next, h)).toBe(false);
    const lost = [a, b, c, d].filter((e) => e?.endsWith(',NE'));
    for (const e of lost) expect(ba.knights[e as EdgeId]).toBeUndefined();
  });

  it('no victory without more knights than barbarians', () => {
    const s = tbMain('barbarianAttack');
    const h = hexWith(s, 8);
    baOf(s).onHex[h] = 2;
    const [a, b] = hexEdges(topologyOf(s), h) as EdgeId[];
    Object.assign(baOf(s).knights, { [a as EdgeId]: 0, [b as EdgeId]: 0 });
    const next = ok(s, { type: 'endTurn', player: 0 });
    expect(baOf(next).onHex[h]).toBe(2);
    expect(baOf(next).prisoners[0]).toBe(0);
  });

  it('2 prisoners = 1 VP; reaching the goal by prisoners at the end of the turn wins', () => {
    const s = tbMain('barbarianAttack', 4, { vpToWin: 3 });
    build(s, 0, 'v:0,0,N', 'city');
    baOf(s).prisoners[0] = 1;
    expect(victoryPoints(s, 0)).toBe(2);
    const h = hexWith(s, 8);
    baOf(s).onHex[h] = 1;
    const [a, b] = hexEdges(topologyOf(s), h) as EdgeId[];
    Object.assign(baOf(s).knights, { [a as EdgeId]: 0, [b as EdgeId]: 0 });
    const next = ok(s, { type: 'endTurn', player: 0 });
    expect(next.winner).toBe(0);
    expect(next.phase.kind).toBe('gameOver');
  });
});

describe('Treason and Intrigue', () => {
  it('Treason: 2 gold, then 2 barbarians move from 2 coastal hexes to 2 others', () => {
    const s = tbMain('barbarianAttack');
    setHand(s, 0, { ore: 1, wool: 1, grain: 1 });
    baOf(s).deck.push('treason');
    const two = hexWith(s, 2);
    const twelve = hexWith(s, 12);
    let next = ok(s, { type: 'tb/buyCard', player: 0 });
    expect(goldOf(next, 0)).toBe(2);
    expect(next.phase.kind).toBe('tb/treason');
    next = ok(
      next,
      { type: 'tb/treasonHex', player: 0, hex: two },
      { type: 'tb/treasonHex', player: 0, hex: hexWith(s, 5) },
    );
    bad(next, { type: 'tb/treasonHex', player: 0, hex: two }, /no barbarian/);
    next = ok(next, { type: 'tb/treasonHex', player: 0, hex: twelve });
    bad(next, { type: 'tb/treasonHex', player: 0, hex: hexWith(s, 5) }, /cannot go/);
    next = ok(next, { type: 'tb/treasonHex', player: 0, hex: hexWith(s, 6) });
    expect(baOf(next).onHex).toEqual({ [hexWith(s, 5)]: 1, [hexWith(s, 6)]: 1 });
    expect(next.phase.kind).toBe('main');
  });

  it('Intrigue takes a barbarian prisoner', () => {
    const s = tbMain('barbarianAttack');
    setHand(s, 0, { ore: 1, wool: 1, grain: 1 });
    baOf(s).deck.push('intrigue');
    let next = ok(s, { type: 'tb/buyCard', player: 0 });
    next = ok(next, { type: 'tb/intrigueHex', player: 0, hex: hexWith(s, 2) });
    expect(baOf(next).prisoners[0]).toBe(1);
    expect(baOf(next).onHex[hexWith(s, 2)]).toBeUndefined();
  });

  it('an empty deck is reshuffled from the discards', () => {
    const s = tbMain('barbarianAttack');
    setHand(s, 0, { ore: 1, wool: 1, grain: 1 });
    baOf(s).discard = [...baOf(s).deck];
    baOf(s).deck = [];
    const next = ok(s, { type: 'tb/buyCard', player: 0 });
    expect(baOf(next).deck.length + 1).toBe(26);
  });
});
