/**
 * Rivers + C&K: "If your city is going to be pillaged, you may spend 5 gold to keep your city."
 *
 * C&K pillages inside its roll step (the event die, before production), so the pair notes the
 * cities when the roll starts (`onRoll`, which runs before C&K's) and, once the roll is resolved
 * and the turn is back in the main phase, asks each owner of a pillaged city who holds 5 gold
 * whether to pay. Paying restores the city and its wall and pays what the city would have
 * produced on top of the settlement on this roll (the second card / the commodity).
 */
import { fail, log, ok } from '../../../engine/actions/common';
import type { ExtHandler } from '../../../engine/expansions/types';
import { isResource } from '../../../engine/resources';
import { playerName } from '../../../engine/rules/text';
import { topologyOf, vertexHexes } from '../../../engine/topology';
import type { GameState, HexId, Phase, PlayerId, VertexId } from '../../../engine/types';
import { hasRobber } from '../../../engine/variants';
import { COMMODITY_OF, ckSlice, cityYieldOf, moveGood } from '../../ck/engine';
import { has } from '../../tb/engine';
import { addGold, goldOf } from '../../tb/engine/common';

export const RANSOM_GOLD = 5;

/** A city standing when the roll began: where, whose, walled. */
export interface CityNote {
  vertex: VertexId;
  owner: PlayerId;
  wall: boolean;
}

export interface RansomSlice {
  /** Cities when the current roll began (null outside a roll). */
  roll: { number: number; cities: CityNote[] } | null;
}

export interface RansomPhase {
  kind: 'tbck/ransom';
  /** Pillaged cities still to decide on, in the order the attack took them. */
  queue: CityNote[];
  roll: number;
  [key: string]: unknown;
}

const pn = playerName;

/** onRoll: note the cities (C&K's attack may pillage some in its own onRoll, after this). */
export function noteCities(draft: GameState, slice: RansomSlice, roll: number): void {
  if (!has(draft, 'rivers')) return;
  const walls = ckSlice(draft).walls;
  const cities: CityNote[] = [];
  for (const [v, b] of Object.entries(draft.pieces.buildings) as [
    VertexId,
    { owner: PlayerId; kind: string },
  ][]) {
    if (b.kind === 'city') cities.push({ vertex: v, owner: b.owner, wall: walls[v] !== undefined });
  }
  slice.roll = { number: roll, cities };
}

/**
 * afterAction: the roll is over (back in main) — offer the ransom for every noted city that is
 * a settlement now, to owners with the gold.
 */
export function offerRansom(draft: GameState, slice: RansomSlice): void {
  const r = slice.roll;
  if (!r || draft.phase.kind !== 'main') return;
  slice.roll = null;
  const queue = r.cities.filter((c) => {
    const b = draft.pieces.buildings[c.vertex];
    return b?.owner === c.owner && b.kind === 'settlement' && goldOf(draft, c.owner) >= RANSOM_GOLD;
  });
  if (queue.length > 0) {
    const phase: RansomPhase = { kind: 'tbck/ransom', queue, roll: r.number };
    draft.phase = phase as unknown as Phase;
  }
}

/** What the city on `v` would have produced on `roll` beyond a settlement (C&K production). */
function missedProduction(draft: GameState, v: VertexId, owner: PlayerId, roll: number): string[] {
  if (cityYieldOf(draft) < 2) return [];
  const blocked = hasRobber(draft.settings) ? draft.robber : null;
  const got: string[] = [];
  for (const h of vertexHexes(topologyOf(draft), v) as HexId[]) {
    const tile = draft.board.hexes[h];
    if (!tile || tile.token !== roll || h === blocked || !isResource(tile.terrain)) continue;
    const c = COMMODITY_OF[tile.terrain];
    if (c !== undefined) {
      if (ckSlice(draft).bank[c] > 0) {
        moveGood(draft, 'bank', owner, c, 1);
        got.push(c);
      }
    } else if (draft.bank[tile.terrain] > 0) {
      moveGood(draft, 'bank', owner, tile.terrain, 1);
      got.push(tile.terrain);
    }
  }
  return got;
}

const isRansom = (state: GameState): RansomPhase | null =>
  state.phase.kind === 'tbck/ransom' ? (state.phase as unknown as RansomPhase) : null;

export function ransomActor(state: GameState): PlayerId[] | undefined {
  const ph = isRansom(state);
  return ph ? ph.queue.slice(0, 1).map((c) => c.owner) : undefined;
}

/** `tbck/ransom { pay }`: the first city in the queue is bought back (pay) or stays pillaged. */
export const ransom: ExtHandler = (draft, action) => {
  const ph = isRansom(draft);
  if (!ph) return fail('no city to buy back now');
  const city = ph.queue[0];
  if (!city || city.owner !== action.player) return fail('not your city');
  const pay = action['pay'];
  if (typeof pay !== 'boolean') return fail('pay or not');
  const p = action.player;
  if (pay) {
    if (goldOf(draft, p) < RANSOM_GOLD) return fail(`needs ${RANSOM_GOLD} gold`);
    addGold(draft, p, -RANSOM_GOLD);
    draft.pieces.buildings[city.vertex] = { owner: p, kind: 'city' };
    if (city.wall) ckSlice(draft).walls[city.vertex] = p;
    const got = missedProduction(draft, city.vertex, p, ph.roll);
    log(
      draft,
      p,
      `${pn(draft, p)} paid ${RANSOM_GOLD} gold to keep their city${got.length > 0 ? ` (and received ${got.join(', ')})` : ''}`,
    );
  } else {
    log(draft, p, `${pn(draft, p)} let the barbarians pillage their city`);
  }
  const rest = ph.queue.slice(1).filter((c) => goldOf(draft, c.owner) >= RANSOM_GOLD);
  draft.phase =
    rest.length > 0 ? ({ ...ph, queue: rest } as unknown as Phase) : ({ kind: 'main' } as Phase);
  return ok(draft);
};

export function ransomLegal(
  state: GameState,
): { type: 'tbck/ransom'; player: PlayerId; pay: boolean }[] {
  const ph = isRansom(state);
  const city = ph?.queue[0];
  if (!city) return [];
  const out = [{ type: 'tbck/ransom' as const, player: city.owner, pay: false }];
  if (goldOf(state, city.owner) >= RANSOM_GOLD) out.push({ ...out[0]!, pay: true });
  return out;
}
