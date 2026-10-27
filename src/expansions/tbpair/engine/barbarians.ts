/**
 * Barbarian Attack + Traders & Barbarians (the 2025 sheet, docs/rules/combos.md §2d): one set of
 * barbarians. Each stands on a hex (Barbarian Attack's count, conquest, battles) and by one of the
 * hex's paths, its sides or (on a trade hex) its spokes, where it acts as a T&B barbarian (wagons
 * pay 2 MP more and may drive it off). One barbarian a path; a hex with every path taken gets
 * the next one at its centre (by no path). T&B keeps them in `BaSlice.paths`.
 *
 * - Landing (a settlement / city built) and a rolled 2 or 12 (on the coastal hex with that
 *   number, no re-roll): the current player picks the path of each new barbarian.
 * - Treason moves 2 barbarians (or from the supply) to any unconquered hexes, inland too; a
 *   successful drive-off moves the barbarian to any unconquered hex; Intrigue takes the picked one.
 * - A 7: discards, then steal 1 card from any player (no barbarian moves: T&B's `sevenPhase`).
 * Choices (ours): the current player picks the paths; Treason keeps T&B's rule of two different
 * destinations, neither its source hex, and moves two different barbarians (not from a hex it
 * already moved one to); a driven-off barbarian may go back to its hex, on another path.
 */
import { fail, isCurrent, log, ok, resumePhase } from '../../../engine/actions/common';
import { continueRoll } from '../../../engine/actions/turn';
import type { ExtHandler, ExtWrap } from '../../../engine/expansions/types';
import { CORNERS, parseHexId, spokeEdge } from '../../../engine/hex';
import { playerName } from '../../../engine/rules/text';
import { hexEdges, topologyOf } from '../../../engine/topology';
import type {
  Action,
  ActionResult,
  EdgeId,
  GameState,
  HexId,
  Phase,
  PlayerId,
} from '../../../engine/types';
import { barbarianHexes, barbariansOn, setBarbarians, takePrisoner } from '../../tb/engine/ba';
import { CONQUER_AT } from '../../tb/engine/conquest';
import {
  baOf,
  hexHasNumber,
  sheetRules,
  tbBoard,
  type BaSlice,
  type ResumeTo,
  type TbPhase,
} from '../../tb/engine/state';

const pn = playerName;

/** Where a phase returns to: a turn phase, the wagon move, or the rest of a roll (2 or 12). */
export type Resume = ResumeTo | 'wagon' | 'roll';

/** A barbarian: by a path, or at a hex's centre (`edge` null). */
export interface BarbarianRef {
  hex: HexId;
  edge: EdgeId | null;
}

export type BarbarianPhase =
  /** New barbarians: each queued hex's newest one needs a path (queue[0] first). */
  | { kind: 'tbpair/landPath'; queue: HexId[]; resume: Resume }
  /**
   * Treason (left 2) or a drive-off (left 1): the barbarian (`from`; Treason picks it, null =
   * pick, 'supply' = from the supply), then its hex (`to`), then its path.
   */
  | {
      kind: 'tbpair/moveBarbarian';
      left: number;
      from: BarbarianRef | 'supply' | null;
      to: HexId | null;
      sources: HexId[];
      dests: HexId[];
      treason: boolean;
      resume: Resume;
    }
  /** Intrigue: pick the barbarian to take prisoner. */
  | { kind: 'tbpair/intrigue'; resume: ResumeTo };

export type BarbarianAction =
  | { type: 'tbpair/barbarianPath'; player: PlayerId; edge: EdgeId }
  | { type: 'tbpair/barbarianHex'; player: PlayerId; hex: HexId }
  | { type: 'tbpair/pickBarbarian'; player: PlayerId; edge?: EdgeId; hex?: HexId };

const phaseOf = (s: GameState) => s.phase as unknown as BarbarianPhase | TbPhase | { kind: 'main' };
const asPhase = (p: BarbarianPhase): Phase => p as unknown as Phase;

/** This game ties barbarians to paths (Barbarian Attack + T&B). */
export const pathBarbarians = (state: GameState): boolean =>
  sheetRules(state).barbarianPaths === true;

const pathsOf = (state: GameState): Record<EdgeId, HexId> => baOf(state).paths ?? {};

/** The paths of hex `h`: its six sides and, on a trade hex, its spokes. */
export function hexPaths(state: GameState, h: HexId): EdgeId[] {
  const t = topologyOf(state);
  const { q, r } = parseHexId(h);
  const spokes = CORNERS.map((c) => spokeEdge(q, r, c)).filter((e) => t.edge[e] !== undefined);
  return [...hexEdges(t, h), ...spokes];
}

/** Paths of `h` without a barbarian (a new one there must take one, if any). */
export function freePaths(state: GameState, h: HexId): EdgeId[] {
  const taken = pathsOf(state);
  return hexPaths(state, h).filter((e) => taken[e] === undefined);
}

/** Barbarians at the centre of `h` (by no path). */
export function centreBarbarians(state: GameState, h: HexId): number {
  const by = Object.values(pathsOf(state)).filter((x) => x === h).length;
  return barbariansOn(state, h) - by;
}

/** Every barbarian on the board (by a path, or one per hex with any at its centre). */
export function barbarianRefs(state: GameState, skip: readonly HexId[] = []): BarbarianRef[] {
  const out: BarbarianRef[] = [];
  for (const [e, h] of Object.entries(pathsOf(state)) as [EdgeId, HexId][]) {
    if (!skip.includes(h)) out.push({ hex: h, edge: e });
  }
  for (const h of barbarianHexes(state)) {
    if (!skip.includes(h) && centreBarbarians(state, h) > 0) out.push({ hex: h, edge: null });
  }
  return out;
}

/** A barbarian of `p`'s pick action, or null. */
function refOf(state: GameState, a: { edge?: unknown; hex?: unknown }): BarbarianRef | null {
  if (typeof a.edge === 'string') {
    const h = pathsOf(state)[a.edge as EdgeId];
    return h ? { hex: h, edge: a.edge as EdgeId } : null;
  }
  if (typeof a.hex === 'string' && centreBarbarians(state, a.hex as HexId) > 0) {
    return { hex: a.hex as HexId, edge: null };
  }
  return null;
}

/** Take a barbarian off the board (its path is free again). */
function lift(draft: GameState, ref: BarbarianRef): void {
  if (ref.edge !== null) Reflect.deleteProperty(baOf(draft).paths ?? {}, ref.edge);
  setBarbarians(draft, ref.hex, barbariansOn(draft, ref.hex) - 1);
}

/** Put a barbarian by path `edge` of `h` (the count on `h` already includes it). */
function standBy(draft: GameState, h: HexId, edge: EdgeId): void {
  const s: BaSlice = baOf(draft);
  s.paths = { ...s.paths, [edge]: h };
}

function leave(draft: GameState, resume: Resume): void {
  if (resume === 'roll') {
    draft.phase = { kind: 'main' };
    continueRoll(draft);
  } else if (resume === 'wagon') draft.phase = { kind: 'tb/wagon' } as unknown as Phase;
  else draft.phase = resumePhase(draft, resume);
}

/** Resolve the queue's barbarians that have no choice (a full hex: the centre); then wait or leave. */
function nextLanding(draft: GameState, queue: HexId[], resume: Resume): void {
  while (queue.length > 0 && freePaths(draft, queue[0] as HexId).length === 0) queue.shift();
  if (queue.length > 0) draft.phase = asPhase({ kind: 'tbpair/landPath', queue, resume });
  else leave(draft, resume);
}

/** Run `build` (a settlement or city: barbarians land); the new barbarians then need paths. */
export function withLanding(draft: GameState, build: () => ActionResult): ActionResult {
  if (!pathBarbarians(draft)) return build();
  const before = { ...baOf(draft).onHex };
  const r = build();
  if (!r.ok) return r;
  const after = baOf(draft).onHex;
  const queue = barbarianHexes(draft).flatMap((h) =>
    Array<HexId>(Math.max(0, (after[h] ?? 0) - (before[h] ?? 0))).fill(h),
  );
  const k = draft.phase.kind;
  if (queue.length > 0 && (k === 'main' || k === 'specialBuild')) nextLanding(draft, queue, k);
  return r;
}

/**
 * A rolled 2 or 12: one barbarian on the coastal hex with that number (unless conquered or the
 * supply is empty); returns the path-picking phase, or undefined (the roll goes on).
 */
export function landOnRoll(draft: GameState, roll: number): Phase | undefined {
  if (!pathBarbarians(draft) || (roll !== 2 && roll !== 12)) return undefined;
  const s = baOf(draft);
  const h = (tbBoard(draft).coast ?? []).find((x) => hexHasNumber(draft, x, roll));
  if (!h || s.supply <= 0 || barbariansOn(draft, h) >= CONQUER_AT) return undefined;
  s.supply -= 1;
  setBarbarians(draft, h, barbariansOn(draft, h) + 1);
  log(draft, null, `A ${roll}: a barbarian lands on the ${roll} hex`);
  if (freePaths(draft, h).length === 0) return undefined;
  return asPhase({ kind: 'tbpair/landPath', queue: [h], resume: 'roll' });
}

// ---------------------------------------------------------------------------------------------
// Moving barbarians: Treason, drive-off
// ---------------------------------------------------------------------------------------------

type MovePhase = Extract<BarbarianPhase, { kind: 'tbpair/moveBarbarian' }>;

/** Unconquered hexes a barbarian may move to (Treason: not its source, not twice). */
export function moveDests(state: GameState, phase: MovePhase): HexId[] {
  const from = phase.from;
  return topologyOf(state).landHexes.filter(
    (h) =>
      barbariansOn(state, h) < CONQUER_AT &&
      (!phase.treason || (!phase.dests.includes(h) && (from === 'supply' || from?.hex !== h))),
  );
}

/**
 * Settle the move phase (T&B's treasonStep): with no barbarian left to pick, Treason takes one
 * from the supply; the phase ends when nothing is left to move or nowhere to go.
 */
function nextMove(draft: GameState, phase: MovePhase): void {
  const picks = () => barbarianRefs(draft, [...phase.sources, ...phase.dests]).length;
  if (phase.left > 0 && phase.from === null && picks() === 0 && baOf(draft).supply > 0) {
    phase.from = 'supply';
  }
  const done =
    phase.left <= 0 || (phase.from === null ? picks() === 0 : moveDests(draft, phase).length === 0);
  if (done) leave(draft, phase.resume);
  else draft.phase = asPhase(phase);
}

/** Move the picked barbarian to `h`, by `edge` (null: the centre, a full hex). */
function moveTo(draft: GameState, phase: MovePhase, h: HexId, edge: EdgeId | null): void {
  const from = phase.from;
  if (from === 'supply') baOf(draft).supply -= 1;
  else if (from !== null) {
    lift(draft, from);
    phase.sources.push(from.hex);
  }
  setBarbarians(draft, h, barbariansOn(draft, h) + 1);
  if (edge !== null) standBy(draft, h, edge);
  phase.dests.push(h);
  phase.left -= 1;
  phase.from = null;
  phase.to = null;
  const p = draft.turn.current;
  log(draft, p, `${pn(draft, p)} moved a barbarian`);
}

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

export const barbarianPath: ExtHandler = (draft, action) => {
  const a = action as unknown as { player: PlayerId; edge?: unknown };
  const phase = phaseOf(draft);
  if (!isCurrent(draft, a.player)) return fail('not your turn');
  const edge = a.edge as EdgeId;
  if (phase.kind === 'tbpair/landPath') {
    const h = phase.queue[0] as HexId;
    if (!freePaths(draft, h).includes(edge)) return fail('pick a free path of that hex');
    standBy(draft, h, edge);
    phase.queue.shift();
    nextLanding(draft, phase.queue, phase.resume);
    return ok(draft);
  }
  if (phase.kind === 'tbpair/moveBarbarian' && phase.to !== null) {
    if (!freePaths(draft, phase.to).includes(edge)) return fail('pick a free path of that hex');
    moveTo(draft, phase, phase.to, edge);
    nextMove(draft, phase);
    return ok(draft);
  }
  return fail('no barbarian to place');
};

export const barbarianHex: ExtHandler = (draft, action) => {
  const a = action as unknown as { player: PlayerId; hex?: unknown };
  const phase = phaseOf(draft);
  if (phase.kind !== 'tbpair/moveBarbarian' || phase.from === null || phase.to !== null) {
    return fail('no barbarian to move');
  }
  if (!isCurrent(draft, a.player)) return fail('not your turn');
  const h = a.hex as HexId;
  if (!moveDests(draft, phase).includes(h)) return fail('the barbarian cannot go there');
  if (freePaths(draft, h).length === 0) {
    moveTo(draft, phase, h, null);
    nextMove(draft, phase);
  } else {
    phase.to = h;
  }
  return ok(draft);
};

export const pickBarbarian: ExtHandler = (draft, action) => {
  const a = action as unknown as { player: PlayerId; edge?: unknown; hex?: unknown };
  const phase = phaseOf(draft);
  if (!isCurrent(draft, a.player)) return fail('not your turn');
  const ref = refOf(draft, a);
  if (phase.kind === 'tbpair/intrigue') {
    if (!ref) return fail('no barbarian there');
    if (ref.edge !== null) Reflect.deleteProperty(baOf(draft).paths ?? {}, ref.edge);
    takePrisoner(draft, a.player, ref.hex);
    draft.phase = resumePhase(draft, phase.resume);
    return ok(draft);
  }
  if (phase.kind === 'tbpair/moveBarbarian' && phase.treason && phase.from === null) {
    if (!ref || [...phase.sources, ...phase.dests].includes(ref.hex)) {
      return fail('no barbarian to take there');
    }
    phase.from = ref;
    nextMove(draft, phase);
    return ok(draft);
  }
  return fail('no barbarian to pick');
};

/** tb/buyCard: Treason and Intrigue pick barbarians by their paths. */
export const wrapBuyCard: ExtWrap = (draft, action, next) => {
  const r = next(draft, action);
  if (!r.ok || !pathBarbarians(draft)) return r;
  const phase = phaseOf(draft);
  if (phase.kind === 'tb/treason') {
    nextMove(draft, {
      kind: 'tbpair/moveBarbarian',
      left: phase.left,
      from: null,
      to: null,
      sources: [],
      dests: [],
      treason: true,
      resume: phase.resume,
    });
  } else if (phase.kind === 'tb/intrigue') {
    draft.phase = asPhase({ kind: 'tbpair/intrigue', resume: phase.resume });
  }
  return r;
};

/** tb/driveOff: a driven-off barbarian goes to any unconquered hex, by a path. */
export const wrapDriveOff: ExtWrap = (draft, action, next) => {
  const r = next(draft, action);
  if (!r.ok || !pathBarbarians(draft)) return r;
  const phase = phaseOf(draft);
  if (phase.kind !== 'tb/barbarian' || phase.from === null) return r;
  const hex = pathsOf(draft)[phase.from];
  if (!hex) return fail('no barbarian there');
  nextMove(draft, {
    kind: 'tbpair/moveBarbarian',
    left: 1,
    from: { hex, edge: phase.from },
    to: null,
    sources: [],
    dests: [],
    treason: false,
    resume: 'wagon',
  });
  return r;
};

/** Legal actions of the barbarian phases. */
export function barbarianLegal(state: GameState): Action[] {
  const p = state.turn.current;
  const out: Action[] = [];
  const act = (a: Record<string, unknown>) => out.push({ player: p, ...a } as unknown as Action);
  const pick = (refs: BarbarianRef[]) => {
    for (const r of refs)
      act({ type: 'tbpair/pickBarbarian', ...(r.edge ? { edge: r.edge } : { hex: r.hex }) });
  };
  const phase = phaseOf(state);
  switch (phase.kind) {
    case 'tbpair/landPath':
      for (const e of freePaths(state, phase.queue[0] as HexId)) {
        act({ type: 'tbpair/barbarianPath', edge: e });
      }
      break;
    case 'tbpair/moveBarbarian':
      if (phase.from === null) pick(barbarianRefs(state, [...phase.sources, ...phase.dests]));
      else if (phase.to === null) {
        for (const h of moveDests(state, phase)) act({ type: 'tbpair/barbarianHex', hex: h });
      } else {
        for (const e of freePaths(state, phase.to)) act({ type: 'tbpair/barbarianPath', edge: e });
      }
      break;
    case 'tbpair/intrigue':
      pick(barbarianRefs(state));
      break;
    default:
      break;
  }
  return out;
}

export const isBarbarianPhase = (kind: string): boolean =>
  kind === 'tbpair/landPath' || kind === 'tbpair/moveBarbarian' || kind === 'tbpair/intrigue';
