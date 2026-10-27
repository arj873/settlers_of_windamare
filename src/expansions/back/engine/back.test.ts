/**
 * Barbarian Attack + Cities & Knights (2025 sheet, docs/rules/combos.md §10): one test per rule,
 * the composition order, soundness.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../../../engine/engine';
import { createGame } from '../../../engine/createGame';
import { victoryPoints } from '../../../engine/selectors';
import { hexEdges, hexVertices, topologyOf } from '../../../engine/topology';
import type { Action, EdgeId, GameState, HexId, PlayerId, VertexId } from '../../../engine/types';
import { ckSlice, type KnightLevel } from '../../ck/engine';
import { bad, build, giveCards, legalOf, ok, roll, setGoods } from '../../ck/engine/testkit';
import { SC_BA, baOf, goldOf, isConqueredBuilding, tbBoard } from '../../tb/engine';
import { edgeDistances } from '../../tb/engine/ba';
import { rngFor as diceRng } from '../../tb/engine/testkit';
import {
  BACK,
  BACK_MODE,
  backModule,
  backSlice,
  innerInventorHexes,
  moveTargets,
  trackCut,
} from '.';

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: `#20202${i}` }));

const game = (n = 4, extra: Record<string, unknown> = {}): GameState =>
  createGame({
    seed: 3,
    players: players(n),
    mode: BACK_MODE,
    scenario: SC_BA,
    startingPlayer: 0,
    ...extra,
  });

/** Player 0 in the main phase of turn 3, nothing on the board. */
function main(n = 4): GameState {
  const s = game(n);
  s.pieces.buildings = {};
  s.pieces.roads = {};
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  return s;
}

const coast = (s: GameState) => tbBoard(s).coast ?? [];
const hexWith = (s: GameState, n: number): HexId =>
  coast(s).find((h) => s.board.hexes[h]?.token === n) as HexId;
const CASTLE_HEX: HexId = 'h:-2,2';
const castleEdges = (s: GameState) => hexEdges(topologyOf(s), CASTLE_HEX);

function put(
  s: GameState,
  e: EdgeId,
  owner: PlayerId,
  level: KnightLevel = 1,
  active = false,
  activatedOn: number | null = active ? 1 : null,
) {
  backSlice(s).knights[e] = { owner, level, active, activatedOn, promotedOn: null };
}

/** An edge exactly `d` paths from `from` (not on the castle, no knight). */
function edgeAt(s: GameState, from: EdgeId, d: number): EdgeId {
  const castle = new Set(castleEdges(s));
  const e = [...edgeDistances(s, from, d)].find(
    ([x, k]) => k === d && !castle.has(x) && !backSlice(s).knights[x],
  );
  if (!e) throw new Error(`no edge ${d} from ${from}`);
  return e[0];
}

/** A coastal corner touching one land hex only (the frame elsewhere): `h` alone conquers it. */
function rimVertex(s: GameState, h: HexId): VertexId {
  const t = topologyOf(s);
  const v = hexVertices(t, h).find((x) => (t.vertex[x]?.hexes ?? []).length === 1);
  if (!v) throw new Error(`no rim corner on ${h}`);
  return v;
}

const conquer = (s: GameState, h: HexId) => {
  const b = baOf(s);
  b.supply -= 3 - (b.onHex[h] ?? 0);
  b.onHex[h] = 3;
};

const edgeFamily = (e: EdgeId) => e.slice(e.lastIndexOf(',') + 1);
const typesOf = (s: GameState) => new Set(legalActions(s).map((a) => a.type));

describe('the mode', () => {
  it('composes back, ck and tb in that order; Barbarian Attack only, 13 VP, 3-6 players', () => {
    const s = game();
    expect(s.settings.expansions).toEqual([BACK, 'ck', 'tb']);
    expect(s.settings.vpToWin).toBe(13);
    expect(game(6).players).toHaveLength(6);
    expect(() => game(4, { scenario: 'tb/fishermen' })).toThrow();
    expect(() => game(2)).toThrow(/players/);
    expect(backModule.modes?.[0]?.hideOptions).toEqual(['ck.knightErrant']);
  });

  it('uses neither BA’s knights and development cards nor C&K’s barbarian track', () => {
    const s = main();
    expect(baOf(s).deck).toEqual([]);
    expect(s.devDeck).toEqual([]);
    s.players[0]!.resources = { brick: 0, lumber: 0, wool: 1, grain: 1, ore: 1 };
    expect(legalOf(s, 'tb/buyCard')).toHaveLength(0);
    const next = roll(s, 1, 2, 'ship');
    expect(ckSlice(next).barbarian).toBe(0);
    expect(ckSlice(next).attacks).toBe(0);
  });
});

describe('the event die and the barbarians', () => {
  it('a ship lands a barbarian on the coastal hex of the production roll', () => {
    const s = main();
    const h = hexWith(s, 3);
    const before = baOf(s).onHex[h] ?? 0;
    const next = roll(s, 1, 2, 'ship');
    expect(baOf(next).onHex[h]).toBe(before + 1);
    // A gate lands none.
    expect(baOf(roll(s, 1, 2, 'trade')).onHex[h] ?? 0).toBe(before);
  });

  it('no barbarian on a 7, and none on a hex that already holds 3', () => {
    const s = main();
    const total = (x: GameState) => Object.values(baOf(x).onHex).reduce((a, b) => a + b, 0);
    expect(total(roll(s, 3, 4, 'ship'))).toBe(total(s));
    conquer(s, hexWith(s, 3));
    expect(baOf(roll(s, 1, 2, 'ship')).onHex[hexWith(s, 3)]).toBe(3);
  });

  it('the hex the ship conquers produces nothing on that roll', () => {
    const s = main();
    const h = hexWith(s, 3);
    s.board.hexes[h] = { ...s.board.hexes[h]!, terrain: 'brick' };
    baOf(s).onHex[h] = 2;
    baOf(s).supply -= 2;
    build(s, 1, rimVertex(s, h));
    expect(roll(s, 1, 2, 'trade').players[1]!.resources.brick).toBe(1);
    const next = roll(s, 1, 2, 'ship');
    expect(baOf(next).onHex[h]).toBe(3);
    expect(next.players[1]!.resources.brick).toBe(0);
  });

  it('every city improvement rolls the production dice and lands a barbarian there', () => {
    const s = main();
    build(s, 0, 'v:0,0,N', 'city');
    setGoods(s, 0, { cloth: 1 });
    s.rng = diceRng(1, 2);
    const h = hexWith(s, 3);
    const before = baOf(s).onHex[h] ?? 0;
    const next = ok(s, { type: 'ck/improve', player: 0, track: 'trade' });
    expect(baOf(next).onHex[h]).toBe(before + 1);
  });

  it('settlements and cities still land barbarians (BA)', () => {
    const s = main();
    const v: VertexId = 'v:0,0,N';
    s.pieces.roads[(topologyOf(s).vertex[v]?.edges ?? [])[0] as EdgeId] = 0;
    setGoods(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    const total = (x: GameState) => baOf(x).supply;
    expect(total(ok(s, { type: 'buildSettlement', player: 0, vertex: v }))).toBeLessThan(total(s));
  });
});

describe('conquest with C&K', () => {
  it('a conquered hex pays no commodity to a city', () => {
    const s = main();
    const h = hexWith(s, 3);
    s.board.hexes[h] = { ...s.board.hexes[h]!, terrain: 'lumber' };
    build(s, 1, rimVertex(s, h), 'city');
    const paper = (x: GameState) => ckSlice(x).players[1]!.commodities.paper;
    const free = roll(s, 1, 2, 'trade');
    expect([free.players[1]!.resources.lumber, paper(free)]).toEqual([1, 1]);
    conquer(s, h);
    const taken = roll(s, 1, 2, 'trade');
    expect([taken.players[1]!.resources.lumber, paper(taken)]).toEqual([0, 0]);
  });

  it('a city wall does not save a city from conquest', () => {
    const s = main();
    const h = hexWith(s, 3);
    const v = rimVertex(s, h);
    build(s, 1, v, 'city');
    ckSlice(s).walls[v] = 1;
    conquer(s, h);
    expect(isConqueredBuilding(s, v)).toBe(true);
  });

  it('a metropolis is never conquered (4 VP) but its track is blocked while surrounded', () => {
    const s = main();
    const h = hexWith(s, 3);
    const v = rimVertex(s, h);
    build(s, 1, v, 'city');
    ckSlice(s).metropolis.trade = { owner: 1, vertex: v };
    ckSlice(s).players[1]!.improvements.trade = 4;
    conquer(s, h);
    const next = roll(s, 1, 2, 'trade');
    expect(isConqueredBuilding(next, v)).toBe(false);
    expect(victoryPoints(next, 1)).toBe(4);
    expect(trackCut(next, 1, 'trade')).toBe(true);
    next.turn.current = 1;
    setGoods(next, 1, { cloth: 5 });
    bad(next, { type: 'ck/improve', player: 1, track: 'trade' }, /metropolis/);
    expect(
      legalOf(next, 'ck/improve', 1).some((a) => (a as { track?: string }).track === 'trade'),
    ).toBe(false);
    baOf(next).onHex[h] = 0;
    expect(trackCut(next, 1, 'trade')).toBe(false);
  });

  it('gold buys resources only', () => {
    const s = main();
    bad(s, { type: 'tb/buyResource', player: 0, resource: 'paper' } as unknown as Action);
  });
});

describe('knights on paths', () => {
  it('are recruited on a free castle edge at C&K’s cost; C&K’s vertex knights are gone', () => {
    const s = main();
    setGoods(s, 0, { wool: 1, ore: 1 });
    const e = castleEdges(s)[0]!;
    const next = ok(s, { type: 'back/recruit', player: 0, edge: e } as unknown as Action);
    expect(backSlice(next).knights[e]).toMatchObject({ owner: 0, level: 1, active: false });
    expect(next.players[0]!.resources).toMatchObject({ wool: 0, ore: 0 });
    const away = edgeAt(s, e, 3);
    bad(s, { type: 'back/recruit', player: 0, edge: away } as unknown as Action, /castle/);
    bad(s, { type: 'ck/buildKnight', player: 0, vertex: 'v:0,0,N' } as unknown as Action, /paths/);
    expect(typesOf(s).has('ck/buildKnight')).toBe(false);
  });

  it('activate (grain) and promote (C&K: mighty needs the Fortress) in the Action phase', () => {
    const s = main();
    const e = castleEdges(s)[0]!;
    put(s, e, 0, 2);
    setGoods(s, 0, { grain: 1, wool: 1, ore: 1 });
    const on = ok(s, { type: 'back/activate', player: 0, edge: e } as unknown as Action);
    expect(backSlice(on).knights[e]).toMatchObject({ active: true, activatedOn: 3 });
    bad(s, { type: 'back/promote', player: 0, edge: e } as unknown as Action, /Fortress/);
    ckSlice(s).players[0]!.improvements.politics = 3;
    const up = ok(s, { type: 'back/promote', player: 0, edge: e } as unknown as Action);
    expect(backSlice(up).knights[e]?.level).toBe(3);
  });

  it('at the end of the turn an active knight moves up to 5 paths and lies down', () => {
    const s = main();
    const e = edgeAt(s, castleEdges(s)[0]!, 2);
    put(s, e, 0, 1, true);
    const to = edgeAt(s, e, 5);
    expect(moveTargets(s, e)).toContain(to);
    const next = ok(
      s,
      { type: 'back/startKnights', player: 0, edge: e } as unknown as Action,
      { type: 'back/moveKnight', player: 0, edge: to } as unknown as Action,
    );
    expect(backSlice(next).knights[to]).toMatchObject({ owner: 0, active: false });
    // Once per turn.
    expect(moveTargets(next, to)).toEqual([]);
    // No trade or build any more.
    expect(typesOf(next).has('buildRoad')).toBe(false);
  });

  it('an inactive knight moves up to 3 paths; one activated this turn does not act', () => {
    const s = main();
    const e = edgeAt(s, castleEdges(s)[0]!, 2);
    put(s, e, 0);
    expect(moveTargets(s, e)).toContain(edgeAt(s, e, 3));
    expect(moveTargets(s, e)).not.toContain(edgeAt(s, e, 4));
    put(s, e, 0, 1, true, 3);
    expect(moveTargets(s, e)).toEqual([]);
  });

  it('knights on the castle must leave it before the turn ends', () => {
    const s = main();
    const e = castleEdges(s)[0]!;
    put(s, e, 0);
    expect(legalOf(s, 'endTurn')).toHaveLength(0);
    bad(s, { type: 'endTurn', player: 0 }, /castle/);
    const out = edgeAt(s, e, 2);
    const next = ok(
      s,
      { type: 'back/startKnights', player: 0, edge: e } as unknown as Action,
      { type: 'back/moveKnight', player: 0, edge: out } as unknown as Action,
    );
    expect(legalOf(next, 'endTurn')).toHaveLength(1);
    expect(ok(next, { type: 'endTurn', player: 0 }).turn.current).toBe(1);
  });

  it('an active knight displaces a weaker one within 3 paths; its owner places it nearby', () => {
    const s = main();
    const e = edgeAt(s, castleEdges(s)[0]!, 3);
    const target = edgeAt(s, e, 2);
    put(s, e, 0, 2, true);
    put(s, target, 1, 1, true);
    const start = ok(s, { type: 'back/startKnights', player: 0, edge: e } as unknown as Action);
    expect(legalOf(start, 'back/displace').map((a) => (a as { edge?: string }).edge)).toEqual([
      target,
    ]);
    const next = ok(start, { type: 'back/displace', player: 0, edge: target } as unknown as Action);
    expect(backSlice(next).knights[target]).toMatchObject({ owner: 0, active: false });
    const k = (x: GameState) => Object.entries(backSlice(x).knights).find(([, v]) => v.owner === 1);
    if (next.phase.kind === 'back/relocate') {
      expect(legalActions(next).every((a) => a.player === 1)).toBe(true);
      const spot = legalOf(next, 'back/relocate', 1)[0]!;
      bad(next, { ...spot, player: 0 } as Action, /owner/);
      const done = ok(next, spot);
      expect(k(done)?.[1]).toMatchObject({ active: false });
    } else {
      expect(k(next)?.[1]).toMatchObject({ active: false });
    }
    // Equal strength: no displacement.
    put(s, target, 1, 2, true);
    expect(
      legalOf(
        ok(s, { type: 'back/startKnights', player: 0, edge: e } as unknown as Action),
        'back/displace',
      ),
    ).toHaveLength(0);
  });
});

describe('expelling the barbarians', () => {
  /** Hex `h` with `n` barbarians and the given knights on its edges (families E, NE first). */
  function battleAt(n: number, knights: [PlayerId, KnightLevel, boolean][]) {
    const s = main();
    const h = hexWith(s, 8);
    baOf(s).onHex[h] = n;
    baOf(s).supply -= n;
    const edges = [...hexEdges(topologyOf(s), h)].sort(
      (a, b) => Number(edgeFamily(a) === 'SE') - Number(edgeFamily(b) === 'SE'),
    );
    knights.forEach(([p, l, a], i) => put(s, edges[i]!, p, l, a));
    return { s, h, edges };
  }

  it('active knights’ strength must beat the barbarians; inactive knights do not fight', () => {
    const { s, h } = battleAt(2, [
      [0, 3, false],
      [1, 2, true],
    ]);
    s.rng = diceRng(3);
    expect(baOf(ok(s, { type: 'endTurn', player: 0 })).onHex[h]).toBe(2);
    const { s: s2, h: h2 } = battleAt(2, [
      [0, 2, true],
      [1, 1, true],
    ]);
    s2.rng = diceRng(3);
    const next = ok(s2, { type: 'endTurn', player: 0 });
    expect(baOf(next).onHex[h2] ?? 0).toBe(0);
    expect(baOf(next).prisoners.slice(0, 2)).toEqual([1, 1]);
  });

  it('a prisoner left over goes to the highest total strength', () => {
    const { s } = battleAt(3, [
      [0, 3, true],
      [1, 1, true],
    ]);
    s.rng = diceRng(3);
    expect(baOf(ok(s, { type: 'endTurn', player: 0 })).prisoners.slice(0, 2)).toEqual([2, 1]);
  });

  it('a lost knight steps down a level (or leaves) and pays its owner 3 gold', () => {
    const { s, edges } = battleAt(1, [[0, 3, true]]);
    const se = edges.find((e) => edgeFamily(e) === 'SE')!;
    Reflect.deleteProperty(backSlice(s).knights, edges[0]!);
    put(s, se, 0, 3, true);
    s.rng = diceRng(3); // 3 → the SE family
    const next = ok(s, { type: 'endTurn', player: 0 });
    expect(backSlice(next).knights[se]?.level).toBe(2);
    expect(goldOf(next, 0)).toBe(3);
    // No strong knight left: a mighty one becomes basic.
    const { s: s2, edges: e2 } = battleAt(1, []);
    const se2 = e2.find((e) => edgeFamily(e) === 'SE')!;
    put(s2, se2, 0, 3, true);
    put(s2, castleEdges(s2)[0]!, 0, 2);
    put(s2, castleEdges(s2)[1]!, 0, 2);
    s2.turn.current = 1;
    s2.rng = diceRng(3);
    const n2 = ok(s2, { type: 'endTurn', player: 1 });
    expect(backSlice(n2).knights[se2]?.level).toBe(1);
  });

  it('3 prisoners are 1 VP; a short supply turns 3 prisoners into a VP token', () => {
    const s = main();
    const vp = victoryPoints(s, 0);
    baOf(s).prisoners[0] = 3;
    baOf(s).supply -= 3;
    expect(victoryPoints(s, 0)).toBe(vp + 1);
    baOf(s).prisoners[0] = 5;
    baOf(s).supply = 1;
    const next = roll(s, 1, 2, 'trade');
    expect(baOf(next).prisoners[0]).toBe(2);
    expect(backSlice(next).tokens[0]).toBe(1);
    expect(victoryPoints(next, 0)).toBe(vp + 1);
  });
});

describe('the 7', () => {
  it('discards, then the roller robs any player (commodities count)', () => {
    const s = main();
    setGoods(s, 2, { coin: 1 });
    const next = roll(s, 3, 4, 'trade');
    expect(next.phase).toMatchObject({ kind: 'steal', candidates: [2] });
    const done = ok(next, { type: 'steal', player: 0, victim: 2 });
    expect(ckSlice(done).players[0]!.commodities.coin).toBe(1);
  });
});

describe('progress cards', () => {
  it('Intrigue takes a barbarian prisoner from a hex of your choice', () => {
    const s = main();
    giveCards(s, 0, 'intrigue');
    const h = hexWith(s, 2);
    const at = baOf(s).onHex[h] ?? 0;
    const next = ok(
      s,
      { type: 'ck/play', player: 0, card: 'intrigue' } as unknown as Action,
      { type: 'back/intrigueHex', player: 0, hex: h } as unknown as Action,
    );
    expect(baOf(next).prisoners[0]).toBe(1);
    expect(baOf(next).onHex[h] ?? 0).toBe(at - 1);
  });

  it('Invention swaps inner numbers only', () => {
    const s = main();
    giveCards(s, 0, 'inventor');
    const next = ok(s, { type: 'ck/play', player: 0, card: 'inventor' } as unknown as Action);
    const hexes = legalOf(next, 'ck/pickHex').map((a) => (a as { hex?: HexId }).hex);
    expect(hexes.length).toBeGreaterThanOrEqual(2);
    expect(hexes.every((h) => !coast(s).includes(h!))).toBe(true);
    expect(hexes.sort()).toEqual(innerInventorHexes(s).sort());
    bad(next, { type: 'ck/pickHex', player: 0, hex: hexWith(s, 3) } as unknown as Action, /centre/);
  });

  it('Merchant: never on a conquered hex; removed when its hex is conquered', () => {
    const s = main();
    const h = hexWith(s, 3);
    build(s, 0, rimVertex(s, h));
    ckSlice(s).merchant = { hex: h, owner: 0 };
    conquer(s, h);
    expect(ckSlice(roll(s, 2, 2, 'trade')).merchant).toBeNull();
    ckSlice(s).merchant = null;
    giveCards(s, 0, 'merchant');
    expect(legalOf(s, 'ck/play').some((a) => (a as { card?: string }).card === 'merchant')).toBe(
      false,
    );
  });

  it('Taxation robs each player with an unconquered building on the chosen hex', () => {
    const s = main();
    giveCards(s, 0, 'bishop');
    const h = hexWith(s, 6);
    const [a, b] = hexVertices(topologyOf(s), h);
    build(s, 1, a!);
    build(s, 2, b!);
    setGoods(s, 1, { ore: 1 });
    setGoods(s, 2, { cloth: 1 });
    const next = ok(
      s,
      { type: 'ck/play', player: 0, card: 'bishop' } as unknown as Action,
      { type: 'back/taxHex', player: 0, hex: h } as unknown as Action,
    );
    expect(next.players[0]!.resources.ore).toBe(1);
    expect(ckSlice(next).players[0]!.commodities.cloth).toBe(1);
  });

  it('Treason: your knight takes the path of the knight the opponent removes', () => {
    const s = main();
    giveCards(s, 0, 'deserter');
    const e = edgeAt(s, castleEdges(s)[0]!, 3);
    put(s, e, 1, 2, true);
    const asked = ok(
      s,
      { type: 'ck/play', player: 0, card: 'deserter' } as unknown as Action,
      { type: 'back/deserterPlayer', player: 0, victim: 1 } as unknown as Action,
    );
    expect(legalActions(asked).every((x) => x.player === 1)).toBe(true);
    const next = ok(asked, {
      type: 'back/deserterKnight',
      player: 1,
      edge: e,
    } as unknown as Action);
    expect(backSlice(next).knights[e]).toMatchObject({ owner: 0, level: 2 });
  });

  it('Smith promotes path knights for free; Warlord activates them all', () => {
    const s = main();
    giveCards(s, 0, 'smith', 'warlord');
    const [e1, e2] = castleEdges(s);
    put(s, e1!, 0);
    put(s, e2!, 0);
    const up = ok(
      s,
      { type: 'ck/play', player: 0, card: 'smith' } as unknown as Action,
      { type: 'back/smithKnight', player: 0, edge: e1 } as unknown as Action,
      { type: 'back/smithKnight', player: 0, edge: e2 } as unknown as Action,
    );
    expect([backSlice(up).knights[e1!]?.level, backSlice(up).knights[e2!]?.level]).toEqual([2, 2]);
    const on = ok(s, { type: 'ck/play', player: 0, card: 'warlord' } as unknown as Action);
    expect(Object.values(backSlice(on).knights).every((k) => k.active)).toBe(true);
  });

  it('Medicine never upgrades a conquered settlement', () => {
    const s = main();
    giveCards(s, 0, 'medicine');
    setGoods(s, 0, { grain: 1, ore: 2 });
    const h = hexWith(s, 3);
    build(s, 0, rimVertex(s, h));
    conquer(s, h);
    expect(legalOf(s, 'ck/play').some((a) => (a as { card?: string }).card === 'medicine')).toBe(
      false,
    );
    bad(s, { type: 'ck/play', player: 0, card: 'medicine' } as unknown as Action, /conquered/);
  });
});

describe('soundness', { timeout: 300_000 }, () => {
  it.each([3, 4, 5])('%i players: every legal action is accepted', (n) => {
    for (const seed of [1, 2]) {
      let s = createGame({ seed, players: players(n), mode: BACK_MODE, scenario: SC_BA });
      let pick = seed * 7919;
      for (let step = 0; step < 2500 && s.phase.kind !== 'gameOver'; step++) {
        const legal = legalActions(s);
        expect(legal.length, `no legal action in ${s.phase.kind}`).toBeGreaterThan(0);
        pick = (pick * 1103515245 + 12345) >>> 0;
        const progress = legal.filter((a) => a.type !== 'endTurn');
        const from = progress.length > 0 && pick % 3 !== 0 ? progress : legal;
        const a = from[pick % from.length] as Action;
        const r = applyAction(s, a);
        if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error}`);
        s = r.state;
      }
    }
  });
});
