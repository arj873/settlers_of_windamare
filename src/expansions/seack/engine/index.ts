/**
 * Seafarers + Cities & Knights (docs/rules/scenarios-and-combos.md C2, seafarers.md §8.2,
 * cities-knights.md §8.2): the official combination, composed from the two modules plus the
 * rules only the pair has. Engine status per rule: docs/rules/combos.md §1.
 *
 * Composition order (`before`): seack, ck, seafarers. This module's hooks run first, so where the
 * two modules hook the same first-wins point it decides:
 * - afterProduction: C&K commodities, then Seafarers' gold (and cloth), then the Aqueduct for
 *   whoever got nothing at all (gold counts as cards);
 * - onSeven: C&K's (the robber and the pirate sleep until the first barbarian attack; Seafarers
 *   has no onSeven);
 * - the robber vs the pirate: a 7 moves either; chasing with a knight moves the one it chased.
 * Additive hooks need nothing: knights block ship routes (`blocksRoute`), barbarians count every
 * city on every island, a city on gold takes resources only (C&K makes commodities on forest /
 * pasture / mountains only), the merchant never stands on gold (C&K).
 */
import { fail, log, ok } from '../../../engine/actions/common';
import { cloneJson } from '../../../engine/expansions/ext';
import type { ExpansionModule, ExtHandler, ExtWrap } from '../../../engine/expansions/types';
import { playerName } from '../../../engine/rules/text';
import type {
  Action,
  EdgeId,
  GameState,
  HexId,
  Phase,
  PlayerId,
  VertexId,
} from '../../../engine/types';
import { hasRobber } from '../../../engine/variants';
import { RESOURCES } from '../../../engine/constants';
import { CK, ckModule, ckSlice, isRobberActive, phaseOf } from '../../ck/engine';
import { SEAFARERS, seafarersModule, seaSlice, type GoldPhase } from '../../seafarers/engine';
import { pirateTargets, robberMoveOk } from '../../seafarers/engine/actions';
import { graph } from '../../seafarers/engine/geometry';
import { shipsOf } from '../../seafarers/engine/ships';

export const SEACK = 'seack';
export const SEACK_MODE = 'seafarers+ck';

/** The suitable Seafarers scenarios (no fog, few small islands; C2.1). */
export const SEACK_SCENARIOS = ['seafarers/newShores', 'seafarers/throughTheDesert'] as const;

/** Raise each scenario's VP target by 2 (C2.2). */
export const SEACK_VP_BONUS = 2;

export interface SeackSlice {
  v: 1;
  /** Which piece the current moveRobber phase may move (a knight chased it), or null = either. */
  chase: 'robber' | 'pirate' | null;
}

export type SeackAction = { type: 'seack/chasePirate'; player: PlayerId };

export const seackSlice = (state: Pick<GameState, 'ext'>): SeackSlice =>
  state.ext[SEACK] as SeackSlice;

const pn = playerName;

// ---------------------------------------------------------------------------------------------
// Knights and ships
// ---------------------------------------------------------------------------------------------

/** A knight (anyone's) stands at an end of the ship on `e`. */
function knightAtEnd(state: GameState, e: EdgeId): boolean {
  const knights = ckSlice(state).knights;
  return (graph(state).ends.get(e) ?? []).some((v) => knights[v] !== undefined);
}

/**
 * Why `player` may not pick up the ship on `e` (C2.6, C2.7), or null: a knight at its end
 * closes the route (the owner's own knight never loses its link), and a ship bordering a foreign
 * knight or building stays where it is (the route owner cannot repair a cut route).
 */
export function shipMoveBlocker(state: GameState, player: PlayerId, e: EdgeId): string | null {
  if (knightAtEnd(state, e)) return 'a knight stands at the end of this ship';
  const ends = graph(state).ends.get(e) ?? [];
  if (ends.some((v) => (state.pieces.buildings[v]?.owner ?? player) !== player)) {
    return 'this ship borders an opponent’s building';
  }
  return null;
}

/** Can the knight on `v` of `p` chase the pirate away (C2.8)? */
export function chasePirateBlocker(state: GameState, p: PlayerId, v: VertexId): string | null {
  const phase = phaseOf(state);
  if (phase.kind !== 'ck/knight' || phase.vertex !== v) return 'select the knight first';
  if (phase.resume === 'specialBuild') return 'no knight actions in the special build phase';
  if (state.turn.current !== p) return 'not your turn';
  const k = ckSlice(state).knights[v];
  if (!k || k.owner !== p) return 'not your knight';
  if (!k.active) return 'only an active knight can act';
  if (k.activatedOn === state.turn.number) return 'a knight activated this turn cannot act yet';
  if (!hasRobber(state.settings)) return 'there is no robber or pirate in this game';
  // The pirate sleeps like the robber until the barbarians first reach Catan (C2.10).
  if (!isRobberActive(state)) return 'the pirate sleeps until the first barbarian attack';
  const pirate = seaSlice(state).pirate;
  if (pirate === null || !(graph(state).hexesAt.get(v) ?? []).includes(pirate)) {
    return 'the knight is not next to the pirate';
  }
  return pirateTargets(state, p).length > 0 ? null : 'the pirate cannot move';
}

const chasePirate: ExtHandler = (draft, action) => {
  const phase = phaseOf(draft);
  if (phase.kind !== 'ck/knight') return fail('select a knight first');
  const err = chasePirateBlocker(draft, action.player, phase.vertex);
  if (err) return fail(err);
  const k = ckSlice(draft).knights[phase.vertex];
  if (k) k.active = false;
  seackSlice(draft).chase = 'pirate';
  log(draft, action.player, `${pn(draft, action.player)}'s knight chased the pirate away`);
  draft.phase = { kind: 'moveRobber', resume: phase.resume === 'preRoll' ? 'preRoll' : 'main' };
  return ok(draft);
};

// ---------------------------------------------------------------------------------------------
// Wraps of the composed modules' actions
// ---------------------------------------------------------------------------------------------

const wraps: Record<`${string}/${string}`, ExtWrap> = {
  'seafarers/pickShip': (draft, action, next) => {
    const e = action['edge'];
    if (typeof e === 'string') {
      const err = shipMoveBlocker(draft, action.player, e as EdgeId);
      if (err) return fail(err);
    }
    return next(draft, action);
  },
  // The Bishop moves the robber like a 7 does: on land, within the scenario's bans.
  'ck/pickHex': (draft, action, next) => {
    const h = action['hex'];
    if (bishopHexBanned(draft, action.player, h)) return fail('the robber cannot go there');
    return next(draft, action);
  },
  'seafarers/movePirate': (draft, action, next) =>
    seackSlice(draft).chase === 'robber'
      ? fail('the knight chased the robber: move the robber')
      : next(draft, action),
  // A knight whose only act is chasing the pirate may still be selected.
  'ck/selectKnight': (draft, action, next) => {
    const r = next(draft, action);
    if (r.ok) return r;
    const v = action['vertex'];
    if (typeof v !== 'string' || !pirateOnlySelect(draft, action.player, v as VertexId)) return r;
    draft.phase = { kind: 'ck/knight', vertex: v, resume: 'main' } as unknown as Phase;
    return ok(draft);
  },
};

/** The Bishop's robber target `h` is one Seafarers forbids (sea, fog, banned regions). */
function bishopHexBanned(state: GameState, p: PlayerId, h: unknown): boolean {
  const phase = phaseOf(state);
  return (
    phase.kind === 'ck/card' &&
    phase.card === 'bishop' &&
    typeof h === 'string' &&
    !robberMoveOk(state, p, h as HexId)
  );
}

/** Selecting the knight on `v` would only be for chasing the pirate (main phase). */
function pirateOnlySelect(state: GameState, p: PlayerId, v: VertexId): boolean {
  if (state.phase.kind !== 'main' || state.turn.current !== p) return false;
  const view = {
    ...state,
    phase: { kind: 'ck/knight', vertex: v, resume: 'main' },
  } as unknown as GameState;
  return chasePirateBlocker(view, p, v) === null;
}

// ---------------------------------------------------------------------------------------------
// Production: commodities, gold, Aqueduct (explicit order)
// ---------------------------------------------------------------------------------------------

type AqueductPhase = { kind: 'ck/aqueduct'; queue: PlayerId[] };

/**
 * afterProduction of the pair: C&K pays the commodities (and names the Aqueduct players), then
 * Seafarers its gold fields; a player picking gold received cards, so no Aqueduct for them
 * (C2.9: gold gives resources only, never commodities). The gold choice comes first, the
 * Aqueduct after it.
 */
export function composedAfterProduction(
  draft: GameState,
  roll: number,
  paid: Parameters<NonNullable<NonNullable<ExpansionModule['hooks']>['afterProduction']>>[2],
): Phase {
  const aqueduct = ckModule.hooks?.afterProduction?.(draft, roll, paid) as
    AqueductPhase | undefined;
  const gold = seafarersModule.hooks?.afterProduction?.(draft, roll, paid) as GoldPhase | undefined;
  const queue = (aqueduct?.queue ?? []).filter((p) => (gold?.pending[p] ?? 0) === 0);
  const after: Phase =
    queue.length > 0
      ? ({ kind: 'ck/aqueduct', queue } as unknown as Phase)
      : ({ kind: 'main' } as Phase);
  return gold ? ({ ...gold, then: { phase: after } } as unknown as Phase) : after;
}

// ---------------------------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------------------------

function legal(state: GameState): Action[] {
  const phase = phaseOf(state);
  const p = state.turn.current;
  const out: Action[] = [];
  if (phase.kind === 'ck/knight' && chasePirateBlocker(state, p, phase.vertex) === null) {
    out.push({ type: 'seack/chasePirate', player: p });
  }
  if (state.phase.kind === 'main') {
    for (const [v, k] of Object.entries(ckSlice(state).knights) as [
      VertexId,
      { owner: number },
    ][]) {
      if (k.owner === p && pirateOnlySelect(state, p, v)) {
        out.push({ type: 'ck/selectKnight', player: p, vertex: v } as Action);
      }
    }
  }
  return out;
}

function filterLegal(state: GameState, actions: Action[]): Action[] {
  const chase = seackSlice(state).chase;
  const seen = new Set<string>();
  return actions.filter((a) => {
    if (a.type === 'ck/selectKnight') {
      // The wrap above may add a selection ck already offers.
      const key = String((a as { vertex?: string }).vertex);
      if (seen.has(key)) return false;
      seen.add(key);
    }
    if (a.type === 'ck/pickHex' && bishopHexBanned(state, a.player, (a as { hex?: unknown }).hex)) {
      return false;
    }
    if (a.type === 'seafarers/pickShip') {
      const e = (a as { edge?: EdgeId }).edge;
      return e === undefined || shipMoveBlocker(state, a.player, e) === null;
    }
    if (state.phase.kind !== 'moveRobber') return true;
    if (chase === 'robber' && a.type === 'seafarers/movePirate') return false;
    if (chase === 'pirate' && a.type === 'moveRobber') return false;
    return true;
  });
}

export const seackModule: ExpansionModule = {
  id: SEACK,
  name: 'Seafarers + Cities & Knights',
  requires: [CK, SEAFARERS],
  before: [CK, SEAFARERS],
  players: { min: 3, max: 6 },
  modes: [
    {
      id: SEACK_MODE,
      name: 'Seafarers + Cities & Knights',
      blurb: 'Knights sail with your ships; barbarians attack every island',
      status: 'ready',
      expansions: [SEACK],
      scenarios: SEACK_SCENARIOS,
      players: { min: 3, max: 6 },
      vpBonus: SEACK_VP_BONUS,
    },
  ],

  validate(settings) {
    if (!SEACK_SCENARIOS.includes(settings.scenario as (typeof SEACK_SCENARIOS)[number])) {
      return 'Seafarers + Cities & Knights is played on Heading for New Shores or Through the Desert';
    }
    return null;
  },

  init(draft) {
    const slice: SeackSlice = { v: 1, chase: null };
    draft.ext[SEACK] = slice;
  },
  cloneExt: (slice) => cloneJson(slice),

  actions: { 'seack/chasePirate': chasePirate },
  wraps,
  overrides: {
    moveRobber: (draft, action, next) =>
      seackSlice(draft).chase === 'pirate'
        ? fail('the knight chased the pirate: move the pirate')
        : next(draft, action),
  },
  legal,
  filterLegal,

  hooks: {
    afterProduction: composedAfterProduction,

    // Ships carry knights (C2.3, C2.5): knights walk roads and ships, may stand on a sea vertex.
    routeEdges: (state, p) => shipsOf(state, p),

    afterAction(draft, action) {
      const s = seackSlice(draft);
      if (action.type === 'ck/chaseRobber') s.chase = 'robber';
      else if (draft.phase.kind !== 'moveRobber') s.chase = null;
      // A gold pick may empty the bank before the Aqueduct: nothing left to take.
      if (draft.phase.kind === 'ck/aqueduct' && RESOURCES.every((r) => draft.bank[r] === 0)) {
        draft.phase = { kind: 'main' };
      }
    },
  },
};
