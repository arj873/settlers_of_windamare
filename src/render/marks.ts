/**
 * "What was just built" (#33): every piece on the board as a site (where, whose, what), so the
 * view can diff two states and mark the new ones. Base buildings and roads, plus what active
 * modules report through their drawer's `sites` hook (ships, knights, walls...). Pure.
 */
import type { EdgeId, GameState, HexId, PlayerId, VertexId } from '../engine';

export interface PieceSite {
  /** Vertex, edge or hex the piece stands on. */
  at: VertexId | EdgeId | HexId;
  owner: PlayerId;
  /** What stands there ("city", "ship"...): a change (settlement -> city) counts as new. */
  kind: string;
}

/** Sites keyed by a stable id ("b:<vertex>", "r:<edge>", module keys). */
export type Sites = ReadonlyMap<string, PieceSite>;

/** All sites of `state`; `extra` = the active modules' sites (`BoardDrawer.sites`). */
export function pieceSites(
  state: GameState,
  extra: readonly (readonly [string, PieceSite])[] = [],
): Map<string, PieceSite> {
  const out = new Map<string, PieceSite>();
  for (const [v, b] of Object.entries(state.pieces.buildings)) {
    out.set(`b:${v}`, { at: v as VertexId, owner: b.owner, kind: b.kind });
  }
  for (const [e, owner] of Object.entries(state.pieces.roads)) {
    out.set(`r:${e}`, { at: e as EdgeId, owner, kind: 'road' });
  }
  for (const [key, site] of extra) out.set(key, site);
  return out;
}

/** Sites in `after` that are not in `before` or show something else there now. */
export function newSites(before: Sites, after: Sites): PieceSite[] {
  const out: PieceSite[] = [];
  for (const [key, s] of after) {
    const old = before.get(key);
    if (!old || old.kind !== s.kind || old.owner !== s.owner) out.push(s);
  }
  return out;
}

export interface MarkRing {
  /** Radius as a multiple of the mark's rest radius. */
  scale: number;
  alpha: number;
}

const easeOut = (p: number) => 1 - (1 - p) * (1 - p);

/**
 * The rings of a mark at `t` (0..1 of its life): a live build sends two expanding, fading rings
 * and a short glow disk (`glow` alpha); the recap one fainter ring. Nothing at t >= 1.
 */
export function markFrame(t: number, soft: boolean): { rings: MarkRing[]; glow: number } {
  if (t >= 1) return { rings: [], glow: 0 };
  const ring = (p: number, a: number): MarkRing[] =>
    p <= 0 || p >= 1 ? [] : [{ scale: 0.55 + 0.75 * easeOut(p), alpha: a * (1 - p) }];
  if (soft) return { rings: ring(t, 0.6), glow: 0.22 * (1 - t) };
  return {
    rings: [...ring(t / 0.75, 0.95), ...ring((t - 0.3) / 0.7, 0.7)],
    glow: 0.38 * (1 - t) * (1 - t),
  };
}

/** s17: a board without motion (low power, reduced motion) shows a mark as this one frame. */
export const STILL_MARK_T = 0.25;

/**
 * More new sites than this at once is a different position (a loaded game, a new board), not a
 * build: no marks then.
 */
export const MAX_LIVE_MARKS = 6;
/** The "since your last turn" recap shows at most this many. */
export const MAX_RECAP_MARKS = 16;
