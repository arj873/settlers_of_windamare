/**
 * The Diplomat with ships (C2.3: what applies to roads applies to ships). An open ship (not on a
 * closed route; at one end none of its owner's buildings, knights, ships or roads) may be
 * removed like an open road; the player's own may be placed again as a ship. The C&K card flow
 * is reused: the same `ck/card` phase, `ck/pickEdge` and `ck/done` answers, here wrapped so a
 * ship edge is handled as a ship.
 */
import { fail, log, ok } from '../../../engine/actions/common';
import { playerName } from '../../../engine/rules/text';
import type { Action, EdgeId, GameState, Phase, PlayerId } from '../../../engine/types';
import type { ExtWrap } from '../../../engine/expansions/types';
import {
  ckPlayer,
  ckSlice,
  effectBlocker,
  openRoads,
  phaseOf,
  playBlocker,
  startCard,
} from '../../ck/engine';
import { seaSlice } from '../../seafarers/engine';
import { graph } from '../../seafarers/engine/geometry';
import { canPlaceShip, markClosedRoutes } from '../../seafarers/engine/ships';

type DiplomatPhase = { kind: 'ck/card'; card: 'diplomat'; removed: EdgeId | null };

function diplomatPhase(state: GameState): DiplomatPhase | null {
  const ph = phaseOf(state) as unknown as { kind: string; card?: string };
  return ph.kind === 'ck/card' && ph.card === 'diplomat' ? (ph as DiplomatPhase) : null;
}

/** Is the ship on `e` open (Diplomat)? */
export function isOpenShip(state: GameState, e: EdgeId): boolean {
  const ship = seaSlice(state).ships[e];
  if (!ship || ship.closed) return false;
  const o = ship.owner;
  const g = graph(state);
  const knights = ckSlice(state).knights;
  return (g.ends.get(e) ?? []).some(
    (v) =>
      state.pieces.buildings[v]?.owner !== o &&
      knights[v]?.owner !== o &&
      !(g.edgesAt.get(v) ?? []).some(
        (x) => x !== e && (seaSlice(state).ships[x]?.owner === o || state.pieces.roads[x] === o),
      ),
  );
}

export function openShips(state: GameState): EdgeId[] {
  return (Object.keys(seaSlice(state).ships) as EdgeId[]).filter((e) => isOpenShip(state, e));
}

/** Where `p` may put their own ship taken off `removed` again (not the same edge). */
export function shipReplaceSpots(state: GameState, p: PlayerId, removed: EdgeId): EdgeId[] {
  return graph(state).edges.filter(
    (e) => e !== removed && canPlaceShip(state, p, e, { ignore: removed }),
  );
}

/** The Diplomat is playable for its open ships alone (C&K checks open roads only). */
function playableForShips(state: GameState, p: PlayerId): boolean {
  return (
    playBlocker(state, p, 'diplomat') === effectBlocker(state, p, 'diplomat') &&
    effectBlocker(state, p, 'diplomat') !== null &&
    ckPlayer(state, p).progress.includes('diplomat') &&
    openRoads(state).length === 0 &&
    openShips(state).length > 0
  );
}

const pn = playerName;

export const diplomatWraps: Record<`${string}/${string}`, ExtWrap> = {
  'ck/play': (draft, action, next) => {
    if (action['card'] !== 'diplomat' || !playableForShips(draft, action.player)) {
      return next(draft, action);
    }
    const phase = startCard(draft, action.player, 'diplomat');
    if (phase) draft.phase = phase;
    return ok(draft);
  },

  'ck/pickEdge': (draft, action, next) => {
    const ph = diplomatPhase(draft);
    const e = action['edge'];
    const ships = seaSlice(draft).ships;
    if (!ph || typeof e !== 'string') return next(draft, action);
    const p = action.player;
    if (draft.turn.current !== p) return next(draft, action);
    if (ph.removed === null) {
      if (!ships[e as EdgeId]) return next(draft, action);
      if (!isOpenShip(draft, e as EdgeId)) return fail('that ship is not open');
      const owner = ships[e as EdgeId]?.owner as PlayerId;
      if (owner !== p) {
        Reflect.deleteProperty(ships, e);
        log(draft, p, `${pn(draft, p)} removed a ship of ${pn(draft, owner)}`);
        draft.phase = { kind: 'main' };
        return ok(draft);
      }
      draft.phase = { ...ph, removed: e } as unknown as Phase;
      return ok(draft);
    }
    if (!ships[ph.removed]) return next(draft, action);
    if (!shipReplaceSpots(draft, p, ph.removed).includes(e as EdgeId)) {
      return fail('the ship cannot go there');
    }
    Reflect.deleteProperty(ships, ph.removed);
    ships[e as EdgeId] = { owner: p };
    log(draft, p, `${pn(draft, p)} moved one of their ships`);
    markClosedRoutes(draft);
    draft.phase = { kind: 'main' };
    return ok(draft);
  },

  'ck/done': (draft, action, next) => {
    const ph = diplomatPhase(draft);
    if (!ph || ph.removed === null || !seaSlice(draft).ships[ph.removed]) {
      return next(draft, action);
    }
    if (draft.turn.current !== action.player) return fail('not your turn');
    Reflect.deleteProperty(seaSlice(draft).ships, ph.removed);
    log(draft, action.player, `${pn(draft, action.player)} removed one of their ships`);
    draft.phase = { kind: 'main' };
    return ok(draft);
  },
};

/** Legal additions: playing the Diplomat for ships, open ships, re-placing an own ship. */
export function diplomatLegal(state: GameState, out: Action[]): void {
  const p = state.turn.current;
  if (state.phase.kind === 'main' && playableForShips(state, p)) {
    out.push({ type: 'ck/play', player: p, card: 'diplomat' } as Action);
  }
  const ph = diplomatPhase(state);
  if (!ph) return;
  if (ph.removed === null) {
    for (const edge of openShips(state))
      out.push({ type: 'ck/pickEdge', player: p, edge } as Action);
  } else if (seaSlice(state).ships[ph.removed]) {
    for (const edge of shipReplaceSpots(state, p, ph.removed)) {
      out.push({ type: 'ck/pickEdge', player: p, edge } as Action);
    }
  }
}

/** While an own ship is being re-placed, C&K's road choices do not apply. */
export function diplomatFilter(state: GameState, a: Action): boolean {
  const ph = diplomatPhase(state);
  if (!ph || ph.removed === null || !seaSlice(state).ships[ph.removed]) return true;
  if (a.type !== 'ck/pickEdge') return true;
  const e = (a as { edge?: EdgeId }).edge;
  return e !== undefined && shipReplaceSpots(state, a.player, ph.removed).includes(e);
}
