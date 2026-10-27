import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, type GameState } from '../engine';
import { midGame } from '../engine/fixtures';
import { ckGame, E, knight, V } from '../expansions/ck/engine/testkit';
import { seaGame, ship } from '../expansions/seafarers/engine/testkit';
import { allSites } from './expansions';
import { markFrame, newSites, pieceSites } from './marks';

/** midGame after Blue (1) builds a city on their first settlement. */
function afterCity(): { before: GameState; after: GameState } {
  const before = midGame();
  before.players[1]!.resources = { brick: 2, lumber: 2, wool: 2, grain: 5, ore: 5 };
  const city = legalActions(before).find((a) => a.type === 'buildCity' && a.player === 1)!;
  const r = applyAction(before, city);
  if (!r.ok) throw new Error(r.error);
  return { before, after: r.state };
}

describe('just-built marks (#33)', () => {
  it('sites list every building and road with owner and kind', () => {
    const s = midGame();
    const sites = pieceSites(s);
    expect(sites.size).toBe(
      Object.keys(s.pieces.buildings).length + Object.keys(s.pieces.roads).length,
    );
    const [v, b] = Object.entries(s.pieces.buildings)[0]!;
    expect(sites.get(`b:${v}`)).toEqual({ at: v, owner: b.owner, kind: b.kind });
    // A base game has no module sites.
    expect(allSites(s)).toEqual(sites);
  });

  it('a settlement upgraded to a city is new; unchanged pieces are not', () => {
    const { before, after } = afterCity();
    const added = newSites(pieceSites(before), pieceSites(after));
    expect(added).toEqual([expect.objectContaining({ owner: 1, kind: 'city' })]);
    expect(newSites(pieceSites(after), pieceSites(after))).toEqual([]);
  });

  it('module sites join in (keys from the drawer)', () => {
    const s = midGame();
    const sites = pieceSites(s, [['sea:e1', { at: 'e1' as never, owner: 2, kind: 'ship' }]]);
    expect(newSites(pieceSites(s), sites)).toEqual([{ at: 'e1', owner: 2, kind: 'ship' }]);
  });

  it('Seafarers ships and C&K knights / walls are sites too (drawer hooks)', () => {
    const sea = seaGame();
    const e = E(0, 0, 'NE');
    const before = allSites(sea);
    ship(sea, 1, e);
    expect(newSites(before, allSites(sea))).toEqual([{ at: e, owner: 1, kind: 'ship' }]);

    const ck = ckGame();
    const v = V(0, 0, 'N');
    const k0 = allSites(ck);
    knight(ck, 2, v);
    expect(newSites(k0, allSites(ck))).toEqual([{ at: v, owner: 2, kind: 'knight1' }]);
    const k1 = allSites(ck);
    knight(ck, 2, v, 2); // promoted
    expect(newSites(k1, allSites(ck))).toEqual([{ at: v, owner: 2, kind: 'knight2' }]);
  });

  it('a live mark sends two fading rings and a glow; the recap one faint ring; then nothing', () => {
    const live = markFrame(0.45, false);
    expect(live.rings).toHaveLength(2);
    expect(live.glow).toBeGreaterThan(0);
    for (const r of live.rings) expect(r.alpha).toBeGreaterThan(0);
    expect(markFrame(0.1, false).rings[0]!.alpha).toBeGreaterThan(
      markFrame(0.6, false).rings[0]!.alpha,
    );
    const soft = markFrame(0.5, true);
    expect(soft.rings).toHaveLength(1);
    expect(soft.rings[0]!.alpha).toBeLessThan(0.6);
    expect(markFrame(1, false)).toEqual({ rings: [], glow: 0 });
    expect(markFrame(1.5, true)).toEqual({ rings: [], glow: 0 });
  });
});
