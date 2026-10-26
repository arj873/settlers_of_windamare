import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../../../engine/engine';
import { victoryPoints } from '../../../engine/selectors';
import type { Action, GameState, PlayerId } from '../../../engine/types';
import { A, pirateTargets } from './actions';
import { graph, isPirateHex } from './geometry';
import { T } from './maps';
import { advance, tileHolder } from './missions';
import { mpLeft, reachable } from './ships';
import { epSlice, type Ship } from './state';
import {
  addShip,
  blank,
  E,
  give,
  H,
  movement,
  openSea,
  R,
  reveal,
  run,
  settle,
  tryAct,
  V,
} from './testkit';

const COAST = V(5, 0, 'SE');
const ship = (s: GameState, id: number) => epSlice(s).ships.find((x) => x.id === id) as Ship;
const legalOf = (s: GameState, type: string, p: PlayerId = 0) =>
  legalActions(s, p).filter((a) => a.type === type);

/** Apply `type` with `rng` seeds until `ok(next)` (dice-driven rules). */
function rollUntil(
  s: GameState,
  type: string,
  p: PlayerId,
  payload: object,
  ok: (t: GameState) => boolean,
): GameState {
  for (let seed = 0; seed < 500; seed++) {
    const r = applyAction({ ...s, rng: seed }, { type, player: p, ...payload } as Action);
    if (r.ok && ok(r.state)) return r.state;
  }
  throw new Error(`no seed for ${type}`);
}

describe('building ships (§4.4)', () => {
  it('next to an own harbor settlement, for 1 lumber + 1 wool; 2 ships per edge at most', () => {
    const s = blank();
    settle(s, 0, COAST, true);
    give(s, 0, { lumber: 3, wool: 3 });
    const spots = legalOf(s, A.buildShip).map((a) => (a as unknown as { edge: string }).edge);
    expect(spots.sort()).toEqual([E(5, 0, 'E'), E(5, 0, 'SE'), E(7, 0, 'SW')].sort());
    let t = run(s, A.buildShip, 0, { edge: E(5, 0, 'SE') });
    t = run(t, A.buildShip, 0, { edge: E(5, 0, 'SE') });
    expect(t.players[0]?.resources).toEqual(R({ lumber: 1, wool: 1 }));
    expect(tryAct(t, A.buildShip, 0, { edge: E(5, 0, 'SE') }).ok).toBe(false);
    // Not at a plain settlement.
    const u = blank();
    settle(u, 0, COAST);
    give(u, 0, { lumber: 1, wool: 1 });
    expect(tryAct(u, A.buildShip, 0, { edge: E(5, 0, 'SE') }).ok).toBe(false);
  });

  it('not on a side of an unexplored hex; a ship built with an end at one explores it', () => {
    const s = openSea(blank());
    reveal(s, H(10, 1), 'ore', 6);
    reveal(s, H(11, 0), T.parrot);
    epSlice(s).hidden[H(11, 0)] = { terrain: 'sea' };
    settle(s, 0, V(10, 1, 'N'), true);
    give(s, 0, { lumber: 2, wool: 2 });
    expect(tryAct(s, A.buildShip, 0, { edge: E(10, 1, 'NE') }).ok).toBe(false);
    const t = run(s, A.buildShip, 0, { edge: E(10, 1, 'NW') });
    expect(t.board.hexes[H(11, 0)]?.terrain).toBe('sea');
    expect(epSlice(t).gold[0]).toBe(2);
    expect(mpLeft(t, epSlice(t).ships[0] as Ship)).toBe(0);
  });

  it('with no ship left, return one (its cargo goes back to the supply) to build anew', () => {
    const s = blank();
    settle(s, 0, COAST, true);
    for (let i = 0; i < 3; i++) addShip(s, 0, E(9, 4, 'E'), i === 0 ? ['crew', 'crew'] : []);
    give(s, 0, { lumber: 1, wool: 1 });
    expect(tryAct(s, A.buildShip, 0, { edge: E(5, 0, 'SE') }).ok).toBe(false);
    const t = run(s, A.buildShip, 0, { edge: E(5, 0, 'SE'), replace: 0 });
    expect(epSlice(t).ships.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(legalOf(s, A.buildShip).every((a) => 'replace' in a)).toBe(true);
  });
});

describe('sailing (§4.4)', () => {
  function sailing(): GameState {
    const s = movement(openSea(blank()));
    addShip(s, 0, E(8, 3, 'E'));
    return s;
  }

  it('4 movement points; 6 with a bought extra move (1 wool, once per ship per turn)', () => {
    const s = sailing();
    const far = () => Math.max(...[...reachable(s, ship(s, 0)).values()].map((r) => r.dist));
    expect(far()).toBe(4);
    give(s, 0, { wool: 2 });
    const t = run(s, A.extraMove, 0, { ship: 0 });
    expect(Math.max(...[...reachable(t, ship(t, 0)).values()].map((r) => r.dist))).toBe(6);
    expect(tryAct(t, A.extraMove, 0, { ship: 0 }).ok).toBe(false);
    expect(t.players[0]?.resources.wool).toBe(1);
  });

  it('Swift Voyage adds 1 MP to every ship at once, even after it moved (FAQ-9)', () => {
    const s = sailing();
    epSlice(s).spice[H(9, 2)] = { kind: 'swift', sacks: [], crews: [0] };
    expect(mpLeft(s, ship(s, 0))).toBe(5);
  });

  it('a move spends its distance; the ship may stop and go on later; another ship moving ends it', () => {
    let s = sailing();
    addShip(s, 0, E(8, 3, 'SE'));
    const to = [...reachable(s, ship(s, 0)).entries()].find(([, r]) => r.dist === 1)?.[0];
    s = run(s, A.selectShip, 0, { ship: 0, edge: E(8, 3, 'E') });
    s = run(s, A.moveShip, 0, { ship: 0, edge: to });
    expect(mpLeft(s, ship(s, 0))).toBe(3);
    s = run(s, A.selectShip, 0, { ship: 1, edge: E(8, 3, 'SE') });
    const to1 = [...reachable(s, ship(s, 1)).keys()][0];
    s = run(s, A.moveShip, 0, { ship: 1, edge: to1 });
    expect(mpLeft(s, ship(s, 0))).toBe(0);
  });

  it('moves are offered for the selected ship (or the only one that can sail)', () => {
    let s = sailing();
    expect(legalOf(s, A.moveShip).length).toBeGreaterThan(0);
    addShip(s, 0, E(8, 3, 'SE'));
    expect(legalOf(s, A.moveShip)).toHaveLength(0);
    s = run(s, A.selectShip, 0, { ship: 1, edge: E(8, 3, 'SE') });
    expect(legalOf(s, A.moveShip).every((a) => (a as unknown as { ship: number }).ship === 1)).toBe(
      true,
    );
  });

  it('may pass other ships but not stop on an edge with two', () => {
    const s = sailing();
    const target = E(10, 3, 'E');
    expect(reachable(s, ship(s, 0)).has(target)).toBe(true);
    addShip(s, 1, target);
    addShip(s, 2, target);
    expect(reachable(s, ship(s, 0)).has(target)).toBe(false);
    // ... but may sail through it: with the extra move it reaches one step past the target.
    s.players[0]!.resources.wool = 1;
    const t = run(s, A.extraMove, 0, { ship: 0 });
    expect(reachable(t, ship(t, 0)).has(E(14, 3, 'W'))).toBe(true);
  });

  it('only along sea routes: never between two land hexes; along the frame and the Council', () => {
    const s = movement(openSea(blank()));
    addShip(s, 0, E(4, 3, 'E')); // between the island hex (4,3) and the Council
    const r = reachable(s, ship(s, 0));
    expect(r.has(E(2, 3, 'E'))).toBe(false); // between two island hexes
    expect([...r.keys()].length).toBeGreaterThan(0);
  });
});

describe('exploring (§4.3)', () => {
  it('an end at a corner of a face-down hex turns it over, pays 1 card, stops the ship', () => {
    let s = movement(blank());
    addShip(s, 0, E(5, 2, 'E'));
    const h = H(9, 2);
    epSlice(s).hidden[h] = { terrain: 'ore' };
    epSlice(s).discs.parrot = [10, 8];
    // The NE side of (7,2) is 2 steps away; its NE corner is a corner of (9,2).
    const r = reachable(s, ship(s, 0));
    expect(r.get(E(7, 2, 'NE'))?.dist).toBe(2);
    // ... and the ship cannot sail past that corner.
    expect(r.has(E(7, 2, 'E'))).toBe(false);
    s = run(s, A.moveShip, 0, { ship: 0, edge: E(7, 2, 'NE') });
    expect(s.board.hexes[h]).toMatchObject({ terrain: 'ore', token: 8 });
    expect(s.players[0]?.resources.ore).toBe(1);
    expect(mpLeft(s, ship(s, 0))).toBe(0);
    expect(epSlice(s).hidden[h]).toBeUndefined();
  });

  it('sea, gold fields (a lair token), shoals and spice farms (a sack per player) pay 2 gold', () => {
    for (const [hidden, check] of [
      [{ terrain: 'sea' }, (t: GameState) => expect(t.board.hexes[H(9, 2)]?.terrain).toBe('sea')],
      [
        { terrain: 'gold' },
        (t: GameState) => {
          expect(t.board.hexes[H(9, 2)]).toMatchObject({ terrain: 'gold', token: null });
          expect(epSlice(t).lairs[H(9, 2)]).toMatchObject({ crews: [], captured: false });
        },
      ],
      [{ terrain: T.fish, shoal: 4 }, (t: GameState) => expect(epSlice(t).shoals[H(9, 2)]).toBe(4)],
      [
        { terrain: T.spice, spice: 'fast' },
        (t: GameState) =>
          expect(epSlice(t).spice[H(9, 2)]).toEqual({
            kind: 'fast',
            sacks: [0, 1, 2, 3],
            crews: [],
          }),
      ],
    ] as const) {
      const s = movement(blank());
      addShip(s, 0, E(5, 2, 'E'));
      epSlice(s).hidden[H(9, 2)] = { ...hidden } as never;
      const t = run(s, A.moveShip, 0, { ship: 0, edge: E(7, 2, 'NE') });
      expect(epSlice(t).gold[0]).toBe(2);
      check(t);
    }
  });

  it('one move explores at most one hex: its other end was reached free of fog (rules doc §10 Q5)', () => {
    const s = movement(blank());
    addShip(s, 0, E(5, 2, 'E'));
    for (const [e, r] of reachable(s, ship(s, 0))) {
      void r;
      const fog = new Set<string>();
      for (const v of graph(s).ends.get(e) ?? []) {
        for (const h of graph(s).hexesAt.get(v) ?? []) {
          if (s.board.hexes[h]?.terrain === T.parrot || s.board.hexes[h]?.terrain === T.goose)
            fog.add(h);
        }
      }
      expect(fog.size, e).toBeLessThanOrEqual(1);
    }
  });
});

describe('cargo and settlers (§4.5-4.6)', () => {
  it('settlers and crews are built into an own basin or an own ship at an own harbor, if there is room', () => {
    const s = blank();
    settle(s, 0, COAST, true);
    addShip(s, 0, E(5, 0, 'SE'));
    addShip(s, 0, E(9, 4, 'E'));
    give(s, 0, { brick: 2, lumber: 2, wool: 4, grain: 2, ore: 2 });
    const t = run(s, A.buildSettler, 0, { vertex: COAST });
    expect(epSlice(t).harbors[COAST]).toEqual(['settler']);
    expect(tryAct(t, A.buildCrew, 0, { vertex: COAST }).ok).toBe(false); // basin full
    const u = run(t, A.buildCrew, 0, { edge: E(5, 0, 'SE'), ship: 0 });
    expect(ship(u, 0).cargo).toEqual(['crew']);
    expect(tryAct(u, A.buildCrew, 0, { edge: E(9, 4, 'E'), ship: 1 }).ok).toBe(false); // not at a harbor
    // A piece can be returned to the supply to make room.
    const w = run(u, A.dump, 0, { vertex: COAST, cargo: 'settler' });
    expect(epSlice(w).harbors[COAST]).toEqual([]);
  });

  it('no crews in Land Ho!', () => {
    const s = blank('landHo');
    settle(s, 0, COAST, true);
    give(s, 0, { ore: 1, wool: 1 });
    expect(tryAct(s, A.buildCrew, 0, { vertex: COAST }).ok).toBe(false);
  });

  it('load, unload and swap between a ship and an adjacent own harbor; capacity 1 large or 2 small', () => {
    let s = movement(blank());
    settle(s, 0, COAST, true);
    epSlice(s).harbors[COAST] = ['settler'];
    addShip(s, 0, E(5, 0, 'SE'), ['crew']);
    // The settler does not fit next to the crew; the crew does not fit next to the settler.
    expect(tryAct(s, A.load, 0, { ship: 0, vertex: COAST, cargo: 'settler' }).ok).toBe(false);
    expect(tryAct(s, A.unload, 0, { ship: 0, vertex: COAST, cargo: 'crew' }).ok).toBe(false);
    expect(legalOf(s, A.swap)).toHaveLength(1);
    s = run(s, A.swap, 0, { ship: 0, vertex: COAST, give: 'crew', take: 'settler' });
    expect(ship(s, 0).cargo).toEqual(['settler']);
    expect(epSlice(s).harbors[COAST]).toEqual(['crew']);
    expect(tryAct(s, A.unload, 0, { ship: 0, vertex: COAST, cargo: 'settler' }).ok).toBe(false);
    expect(tryAct(s, A.load, 0, { ship: 0, vertex: COAST, cargo: 'crew' }).ok).toBe(false);
    s = run(s, A.swap, 0, { ship: 0, vertex: COAST, give: 'settler', take: 'crew' });
    expect(ship(s, 0).cargo).toEqual(['crew']);
    // Ships do not hand cargo to each other, nor at someone else's harbor.
    const t = movement(blank());
    settle(t, 1, COAST, true);
    epSlice(t).harbors[COAST] = ['crew'];
    addShip(t, 0, E(5, 0, 'SE'));
    expect(legalOf(t, A.load)).toHaveLength(0);
  });

  it('a settler lands on explored land at an end of its ship: free settlement; ship and settler go home', () => {
    let s = movement(openSea(blank()));
    reveal(s, H(9, 2), 'ore', 5);
    addShip(s, 0, E(7, 2, 'NE'), ['settler']);
    const spot = V(7, 2, 'NE');
    expect(legalOf(s, A.land).map((a) => (a as unknown as { vertex: string }).vertex)).toContain(
      spot,
    );
    s = run(s, A.land, 0, { ship: 0, vertex: spot });
    expect(s.pieces.buildings[spot]).toEqual({ owner: 0, kind: 'settlement' });
    expect(epSlice(s).ships).toHaveLength(0);
    expect(victoryPoints(s, 0)).toBe(1);
  });

  it('landing obeys the distance rule and needs a settlement piece; not on sea-only corners', () => {
    const s = movement(openSea(blank()));
    reveal(s, H(9, 2), 'ore', 5);
    addShip(s, 0, E(7, 2, 'NE'), ['settler']);
    settle(s, 1, V(9, 2, 'N'));
    expect(tryAct(s, A.land, 0, { ship: 0, vertex: V(7, 2, 'NE') }).ok).toBe(false);
    expect(tryAct(s, A.land, 0, { ship: 0, vertex: V(7, 2, 'N') }).ok).toBe(false);
  });

  it('landing is a Movement phase action; a settler bought this turn can land this turn (FAQ-7)', () => {
    const s = openSea(blank());
    reveal(s, H(9, 2), 'ore', 5);
    addShip(s, 0, E(7, 2, 'NE'), ['settler']);
    expect(tryAct(s, A.land, 0, { ship: 0, vertex: V(7, 2, 'NE') }).ok).toBe(false);
  });
});

describe('the pirate (§4.7)', () => {
  function seven(s: GameState): GameState {
    s.phase = { kind: 'preRoll' };
    return rollUntil(
      s,
      'rollDice',
      s.turn.current,
      {},
      (t) => (t.dice?.[0] ?? 0) + (t.dice?.[1] ?? 0) === 7,
    );
  }

  it('a 7: discards, then the roller places their pirate ship (not next to the island, not on the frame or the Council)', () => {
    const s = openSea(blank());
    const t = seven(s);
    expect(t.phase).toEqual({ kind: 'ep/pirate', resume: 'main' });
    const hexes = pirateTargets(t);
    expect(hexes).toContain(H(8, 3));
    expect(hexes).not.toContain(H(5, 2)); // next to the island
    expect(hexes).not.toContain(H(6, 3)); // the Council
    expect(isPirateHex(t, H(4, -1))).toBe(false); // the frame
    const u = run(t, A.placePirate, 0, { hex: H(8, 3) });
    expect(epSlice(u).pirate).toEqual({ owner: 0, hex: H(8, 3) });
    expect(u.phase.kind).toBe('main');
  });

  it('Land Ho!: a 7 only discards, there is no pirate', () => {
    const s = blank('landHo');
    const t = seven(s);
    expect(t.phase.kind).toBe('main');
    expect(epSlice(t).pirate).toBeNull();
  });

  it('steals a card from a player with a ship beside the hex; gold only from a player without cards', () => {
    const s = openSea(blank());
    s.phase = { kind: 'ep/pirate', resume: 'main' };
    addShip(s, 1, E(8, 3, 'E'));
    addShip(s, 2, E(8, 3, 'SE'));
    give(s, 1, { ore: 1 });
    epSlice(s).gold[2] = 3;
    const t = run(s, A.placePirate, 0, { hex: H(8, 3) });
    expect(t.phase).toMatchObject({ kind: 'ep/pirateSteal', candidates: [1, 2] });
    const u = run(t, A.pirateSteal, 0, { victim: 1 });
    expect(u.players[0]?.resources.ore).toBe(1);
    const w = run(t, A.pirateSteal, 0, { victim: 2 });
    expect(epSlice(w).gold).toEqual([1, 0, 2, 0]);
  });

  it('moves away from where it stood; an opponent’s pirate goes home when yours comes', () => {
    const s = openSea(blank());
    epSlice(s).pirate = { owner: 1, hex: H(8, 3) };
    s.phase = { kind: 'ep/pirate', resume: 'main' };
    expect(tryAct(s, A.placePirate, 0, { hex: H(8, 3) }).ok).toBe(false);
    const t = run(s, A.placePirate, 0, { hex: H(10, 3) });
    expect(epSlice(t).pirate).toEqual({ owner: 0, hex: H(10, 3) });
  });

  it('a fish haul on the pirate’s hex goes back to the supply', () => {
    const s = openSea(blank());
    reveal(s, H(9, 2), T.fish);
    const e = epSlice(s);
    e.shoals[H(9, 2)] = 2;
    e.hauls = [H(9, 2)];
    e.haulSupply = 5;
    s.phase = { kind: 'ep/pirate', resume: 'main' };
    const t = run(s, A.placePirate, 0, { hex: H(9, 2) });
    expect(epSlice(t).hauls).toEqual([]);
    expect(epSlice(t).haulSupply).toBe(6);
  });

  it('tribute: 1 gold, once per ship per turn, to sail onto / off / along an opponent’s pirate hex', () => {
    const s = movement(openSea(blank()));
    epSlice(s).pirate = { owner: 1, hex: H(8, 3) };
    addShip(s, 0, E(5, 2, 'E'));
    const side = E(7, 2, 'SE'); // a side of (8,3)
    expect(reachable(s, ship(s, 0)).has(side)).toBe(false); // no gold
    epSlice(s).gold[0] = 1;
    expect(reachable(s, ship(s, 0)).get(side)?.tribute).toBe(true);
    const t = run(s, A.moveShip, 0, { ship: 0, edge: side });
    expect(epSlice(t).gold[0]).toBe(0);
    // Paid once: sailing on along the pirate is free now.
    const next = [...reachable(t, ship(t, 0)).values()];
    expect(next.length).toBeGreaterThan(0);
    expect(next.every((r) => !r.tribute)).toBe(true);
    // Your own pirate never charges you.
    const u = movement(openSea(blank()));
    epSlice(u).pirate = { owner: 0, hex: H(8, 3) };
    addShip(u, 0, E(5, 2, 'E'));
    expect(reachable(u, ship(u, 0)).get(side)?.tribute).toBe(false);
  });

  it('chasing: an unmoved ship touching the pirate’s hex rolls a 6 (or a Pirate Bonus number) and then activates its own pirate', () => {
    const s = movement(openSea(blank()));
    epSlice(s).pirate = { owner: 1, hex: H(8, 3) };
    addShip(s, 0, E(7, 2, 'SE'));
    const miss = rollUntil(s, A.chase, 0, { ship: 0 }, (t) => epSlice(t).pirate !== null);
    expect(tryAct(miss, A.chase, 0, { ship: 0 }).ok).toBe(false); // one roll per ship
    const hit = rollUntil(s, A.chase, 0, { ship: 0 }, (t) => epSlice(t).pirate === null);
    expect(hit.log.at(-2)?.text).toMatch(/rolled 6/);
    expect(hit.phase).toEqual({ kind: 'ep/pirate', resume: 'main' });
    // With a Pirate Bonus farm (4), a 4 chases too.
    epSlice(s).spice[H(9, 2)] = { kind: 'bonus', number: 4, sacks: [], crews: [0] };
    const four = rollUntil(s, A.chase, 0, { ship: 0 }, (t) =>
      /rolled 4/.test(t.log.at(-2)?.text ?? ''),
    );
    expect(epSlice(four).pirate).toBeNull();
    // A ship that moved this turn may not chase.
    epSlice(s).turn.ships[0] = {
      used: 1,
      extra: false,
      done: false,
      tribute: false,
      chased: false,
    };
    expect(tryAct(s, A.chase, 0, { ship: 0 }).ok).toBe(false);
  });
});

describe('pirate lairs (§4.8)', () => {
  function lairGame(): GameState {
    const s = movement(openSea(blank()));
    reveal(s, H(9, 2), 'gold');
    epSlice(s).lairs[H(9, 2)] = { token: 5, crews: [], captured: false };
    return s;
  }

  it('three crews capture it; everyone involved gets 2 gold and a space, the hero one more and a crew back', () => {
    let s = lairGame();
    addShip(s, 0, E(7, 2, 'NE'), ['crew', 'crew']);
    epSlice(s).lairs[H(9, 2)]?.crews.push(1);
    s = run(s, A.dropCrew, 0, { ship: 0, hex: H(9, 2) });
    s = run(s, A.dropCrew, 0, { ship: 0, hex: H(9, 2) });
    expect(epSlice(s).turn.captured).toEqual([H(9, 2)]);
    expect(tryAct(s, A.dropCrew, 0, { ship: 0, hex: H(9, 2) }).ok).toBe(false);
    // Resolved after the Movement phase.
    s = run(s, 'endTurn', 0);
    const e = epSlice(s);
    const lair = e.lairs[H(9, 2)];
    expect(lair?.captured).toBe(true);
    expect(s.board.hexes[H(9, 2)]?.token).toBe(5);
    expect(e.gold[0]).toBe(2);
    expect(e.gold[1]).toBe(2);
    const pos = e.tracks.lairs?.pos ?? [];
    expect((pos[0] ?? 0) + (pos[1] ?? 0)).toBe(3);
    expect(lair?.crews).toHaveLength(2);
  });

  it('a sole player is the hero without a roll: 2 spaces', () => {
    let s = lairGame();
    addShip(s, 0, E(7, 2, 'NE'), ['crew', 'crew']);
    addShip(s, 0, E(7, 2, 'SE'), ['crew']);
    s = run(s, A.dropCrew, 0, { ship: 0, hex: H(9, 2) });
    s = run(s, A.dropCrew, 0, { ship: 0, hex: H(9, 2) });
    s = run(s, A.dropCrew, 0, { ship: 1, hex: H(9, 2) });
    s = run(s, 'endTurn', 0);
    expect(epSlice(s).tracks.lairs?.pos[0]).toBe(2);
    expect(victoryPoints(s, 0)).toBe(1 + 1); // track space 2 = 1 VP, plus the bonus tile
  });

  it('crews left on a captured lair can be picked up again', () => {
    const s = lairGame();
    const lair = epSlice(s).lairs[H(9, 2)];
    if (lair) {
      lair.captured = true;
      lair.crews = [0, 1];
    }
    reveal(s, H(9, 2), 'gold', 5);
    addShip(s, 0, E(7, 2, 'NE'));
    const t = run(s, A.pickCrew, 0, { ship: 0, hex: H(9, 2) });
    expect(ship(t, 0).cargo).toEqual(['crew']);
    expect(epSlice(t).lairs[H(9, 2)]?.crews).toEqual([1]);
  });

  it('a lair capture after the Movement phase can win the game', () => {
    let s = lairGame();
    s.settings = { ...s.settings, vpToWin: 2 };
    addShip(s, 0, E(7, 2, 'NE'), ['crew', 'crew']);
    addShip(s, 0, E(7, 2, 'SE'), ['crew']);
    s = run(s, A.dropCrew, 0, { ship: 0, hex: H(9, 2) });
    s = run(s, A.dropCrew, 0, { ship: 0, hex: H(9, 2) });
    s = run(s, A.dropCrew, 0, { ship: 1, hex: H(9, 2) });
    s = run(s, 'endTurn', 0);
    expect(s.winner).toBe(0);
    expect(s.phase.kind).toBe('gameOver');
  });
});

describe('fish (§4.9)', () => {
  function fishGame(): GameState {
    const s = movement(openSea(blank()));
    reveal(s, H(9, 2), T.fish);
    const e = epSlice(s);
    e.shoals[H(9, 2)] = 3;
    e.haulSupply = 6;
    return s;
  }

  it('once per turn, a die roll matching an explored shoal puts a haul there', () => {
    const s = fishGame();
    const t = rollUntil(s, A.rollFish, 0, {}, (x) => epSlice(x).hauls.length > 0);
    expect(epSlice(t).hauls).toEqual([H(9, 2)]);
    expect(epSlice(t).haulSupply).toBe(5);
    expect(tryAct(t, A.rollFish, 0).ok).toBe(false);
  });

  it('a ship touching the shoal loads the haul (large: empty hold, no MP needed) and delivers it at a Council anchor', () => {
    let s = fishGame();
    epSlice(s).hauls = [H(9, 2)];
    addShip(s, 0, E(7, 2, 'NE'));
    epSlice(s).turn.ships[0] = {
      used: 4,
      extra: false,
      done: false,
      tribute: false,
      chased: false,
    };
    s = run(s, A.catchFish, 0, { ship: 0, hex: H(9, 2) });
    expect(ship(s, 0).cargo).toEqual(['fish']);
    expect(tryAct(s, A.deliver, 0, { ship: 0 }).ok).toBe(false); // not at the Council
    // The W side of (7,2) has the Council's north corner as an end.
    ship(s, 0).edge = E(5, 2, 'E');
    s = run(s, A.deliver, 0, { ship: 0 });
    expect(epSlice(s).tracks.fish?.pos[0]).toBe(1);
    expect(epSlice(s).haulSupply).toBe(7);
    expect(victoryPoints(s, 0)).toBe(2); // 1 space + Best Fisher
  });
});

describe('spice (§4.10, §4.12)', () => {
  it('befriend a farm with a crew (it stays), then load your one sack; deliver it for a space', () => {
    let s = movement(openSea(blank()));
    reveal(s, H(9, 2), T.spice);
    epSlice(s).spice[H(9, 2)] = { kind: 'swift', sacks: [0, 1], crews: [] };
    addShip(s, 0, E(7, 2, 'NE'), ['crew']);
    expect(tryAct(s, A.loadSpice, 0, { ship: 0, hex: H(9, 2) }).ok).toBe(false);
    s = run(s, A.dropCrew, 0, { ship: 0, hex: H(9, 2) });
    expect(epSlice(s).spice[H(9, 2)]?.crews).toEqual([0]);
    expect(mpLeft(s, ship(s, 0))).toBe(5); // Swift Voyage at once
    s = run(s, A.loadSpice, 0, { ship: 0, hex: H(9, 2) });
    expect(tryAct(s, A.loadSpice, 0, { ship: 0, hex: H(9, 2) }).ok).toBe(false);
    expect(tryAct(s, A.pickCrew, 0, { ship: 0, hex: H(9, 2) }).ok).toBe(false);
    ship(s, 0).edge = E(5, 2, 'E');
    s = run(s, A.deliver, 0, { ship: 0 });
    expect(epSlice(s).tracks.spice?.pos[0]).toBe(1);
  });
});

describe('mission tracks (§4.13)', () => {
  it('VP per space; the tile goes to the furthest marker, a tie to the first to arrive; the end clamps', () => {
    const s = blank();
    const e = epSlice(s);
    advance(e, 'fish', 1, 2);
    advance(e, 'fish', 0, 2);
    expect(tileHolder(e.tracks.fish)).toBe(1);
    advance(e, 'fish', 0, 1);
    expect(tileHolder(e.tracks.fish)).toBe(0);
    advance(e, 'fish', 1, 1);
    expect(tileHolder(e.tracks.fish)).toBe(0);
    expect(advance(e, 'fish', 2, 20)).toBe(7);
    expect(e.tracks.fish?.pos[2]).toBe(7);
    expect(tileHolder(e.tracks.fish)).toBe(2);
    expect(victoryPoints(s, 2)).toBe(3 + 1);
    expect(victoryPoints(s, 0)).toBe(2);
  });
});
