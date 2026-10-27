/** Board-target descriptions for the playtest CLI: "what is at this spot", in words. */
import {
  edgeVertices,
  setupRoundAt,
  tokenPips,
  topologyOf,
  vertexHexes,
  type Action,
  type EdgeId,
  type GameState,
  type HexId,
  type PlayerId,
  type VertexId,
} from '../../src/engine';
import { locationOf } from '../../src/game/logic';

export interface Spot {
  /** 1-based number the agent types: `click-spot 3`. */
  n: number;
  id: string;
  kind: 'vertex' | 'edge' | 'hex';
  text: string;
  /** The move a click here makes, e.g. "setup road", "place setup ship" (module moves). */
  does: string;
  /** Its action type; `click-spot` checks a board click picks it (else switches build mode). */
  type: string;
  action: Action;
}

/** A module action's other fields, so two moves on one spot differ: " (ship 1)". */
function extraFields(a: Action): string {
  if (!a.type.includes('/')) return '';
  const skip = new Set(['type', 'player', 'vertex', 'edge', 'hex']);
  const parts = Object.entries(a)
    .filter(([k, v]) => !skip.has(k) && (typeof v === 'string' || typeof v === 'number'))
    .map(([k, v]) => `${k} ${String(v)}`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/** What a board click does for each base action type. */
export const SPOT_VERB: Partial<Record<Action['type'], string>> = {
  placeSetupSettlement: 'place your setup settlement',
  placeSetupRoad: 'place your setup road',
  buildRoad: 'build a road',
  buildSettlement: 'build a settlement',
  buildCity: 'upgrade a settlement to a city',
  moveRobber: 'move the robber',
  placeFreeRoad: 'place a free road (Road Building)',
};

const SPOT_NOUN: Partial<Record<Action['type'], string>> = {
  placeSetupSettlement: 'setup settlement',
  placeSetupRoad: 'setup road',
  buildRoad: 'road',
  buildSettlement: 'settlement',
  buildCity: 'city',
  moveRobber: 'robber',
  placeFreeRoad: 'free road',
  eventDamageRoad: 'damage road',
};

/**
 * A short name for what an action does: base types from the table, module types from their
 * name ("seafarers/placeSetupShip" -> "place setup ship"). The setup building names the piece
 * the engine places (C&K round 2: a city).
 */
export function actionName(state: GameState | null, a: { type: string }): string {
  if (a.type === 'placeSetupSettlement' && state?.phase.kind === 'setup') {
    return `setup ${setupRoundAt(state, state.phase.index).building}`;
  }
  const base = SPOT_NOUN[a.type as Action['type']];
  if (base) return base;
  const name = a.type.includes('/') ? a.type.slice(a.type.indexOf('/') + 1) : a.type;
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

/** The heading verb for a list of spots of one type ("place your setup city"). */
export function spotVerb(state: GameState, type: string): string {
  if (type === 'placeSetupSettlement') return `place your ${actionName(state, { type })}`;
  return SPOT_VERB[type as Action['type']] ?? actionName(state, { type });
}

/** "brick 8" / "desert" (+ " [robber]"). */
export function hexLabel(state: GameState, id: HexId): string {
  const hex = state.board.hexes[id];
  if (!hex) return 'sea';
  const base = hex.token === null ? hex.terrain : `${hex.terrain} ${hex.token}`;
  return state.robber === id ? `${base} [robber]` : base;
}

function harborAt(state: GameState, v: VertexId): string | null {
  const port = state.board.ports.find((p) => p.vertices.includes(v));
  if (!port) return null;
  return port.kind === 'generic' ? 'harbor 3:1 any' : `harbor 2:1 ${port.kind}`;
}

function owner(state: GameState, p: PlayerId, viewer: PlayerId): string {
  return p === viewer ? 'your' : `${state.players[p]?.name ?? `P${p}`}'s`;
}

/** "brick 8 + wool 3 + coast (pips 7), harbor 3:1 any, your settlement". */
export function describeVertex(state: GameState, v: VertexId, viewer: PlayerId): string {
  const hexes = vertexHexes(topologyOf(state), v);
  const parts = hexes.map((h) => hexLabel(state, h));
  if (hexes.length < 3) parts.push('coast');
  const extra = [harborAt(state, v)];
  const b = state.pieces.buildings[v];
  if (b) extra.push(`${owner(state, b.owner, viewer)} ${b.kind}`);
  return [`${parts.join(' + ')} (pips ${vertexPips(state, v)})`, ...extra.filter(Boolean)].join(
    ', ',
  );
}

/** Production pips around a vertex (dots on the adjacent number tokens; desert/robber ignored). */
export function vertexPips(state: GameState, v: VertexId): number {
  return vertexHexes(topologyOf(state), v).reduce((n, h) => {
    const t = state.board.hexes[h]?.token;
    return n + (t ? tokenPips(t) : 0);
  }, 0);
}

function endpoint(state: GameState, v: VertexId, viewer: PlayerId): string {
  const b = state.pieces.buildings[v];
  const ownRoad = topologyOf(state).vertex[v]?.edges.some((e) => state.pieces.roads[e] === viewer);
  const what = b ? `${owner(state, b.owner, viewer)} ${b.kind}` : ownRoad ? 'your road' : 'open';
  return `${v} (${what})`;
}

/** "between brick 8 | wool 3; ends v:… (your settlement), v:… (open)". */
export function describeEdge(state: GameState, e: EdgeId, viewer: PlayerId): string {
  const hexes = topologyOf(state).edge[e]?.hexes ?? [];
  const sides = hexes.map((h) => hexLabel(state, h));
  if (hexes.length < 2) sides.push('sea');
  const ends = edgeVertices(topologyOf(state), e).map((v) => endpoint(state, v, viewer));
  return `between ${sides.join(' | ')}; ends ${ends.join(', ')}`;
}

/** "lumber 6; buildings: Seat2 settlement, your city" (robber targets). */
export function describeHex(state: GameState, h: HexId, viewer: PlayerId): string {
  const info = topologyOf(state).hex[h];
  const who = (info?.vertices ?? []).flatMap((v) => {
    const b = state.pieces.buildings[v];
    return b ? [`${owner(state, b.owner, viewer)} ${b.kind}`] : [];
  });
  return `${hexLabel(state, h)}; buildings: ${who.length > 0 ? who.join(', ') : 'none'}`;
}

/**
 * Board actions (from `__catanDebug.boardTargets()`) as numbered, described spots.
 * Vertex spots come best-first (most pips), so short lists of good options lead.
 */
export function listSpots(state: GameState, targets: readonly Action[], viewer: PlayerId): Spot[] {
  const pips = (a: Action) => {
    const at = locationOf(a);
    return at?.kind === 'vertex' ? vertexPips(state, at.id) : 0;
  };
  const ordered = [...targets].sort((a, b) => pips(b) - pips(a));
  const spots: Spot[] = [];
  for (const a of ordered) {
    const n = spots.length + 1;
    const at = locationOf(a);
    const what = { n, does: actionName(state, a) + extraFields(a), type: a.type, action: a };
    if (at?.kind === 'vertex') {
      spots.push({
        ...what,
        id: at.id,
        kind: 'vertex',
        text: describeVertex(state, at.id, viewer),
      });
    } else if (at?.kind === 'edge') {
      spots.push({ ...what, id: at.id, kind: 'edge', text: describeEdge(state, at.id, viewer) });
    } else if (at?.kind === 'hex') {
      spots.push({ ...what, id: at.id, kind: 'hex', text: describeHex(state, at.id, viewer) });
    }
  }
  return spots;
}

/** Identity of a listed spot (`click-spot` refuses when the list changed since `spots`). */
export const spotKey = (s: Spot) => `${s.id} ${s.type}`;

/** The `spots` reply. Each line names its move when the list mixes moves (road / ship). */
export function formatSpots(state: GameState, spots: readonly Spot[], behind: string[]): string {
  const lines: string[] = [];
  const more =
    behind.length > 0
      ? [
          'Board moves behind a button (click it, then run `spots` again):',
          ...behind.map((b) => `  ${b}`),
        ]
      : [];
  if (spots.length === 0) {
    lines.push('No board spots to click right now.');
    if (more.length === 0) {
      lines.push(
        'To build, first click a build button (`click Road`, `click Settlement`, `click City`), then run `spots` again.',
      );
    }
    return [...lines, ...more].join('\n');
  }
  const types = new Set(spots.map((s) => s.type));
  const first = spots[0] as Spot;
  // Several kinds of move, or two moves on one spot (two ships on an edge): name each.
  const mixed = types.size > 1 || new Set(spots.map((s) => s.id)).size < spots.length;
  lines.push(
    mixed
      ? `${spots.length} spot(s); several kinds of move (in [brackets]). Use \`click-spot N\`:`
      : `${spots.length} spot(s) to ${spotVerb(state, first.type)}. Use \`click-spot N\`:`,
  );
  for (const s of spots) lines.push(`  ${s.n}. ${s.id}  ${mixed ? `[${s.does}] ` : ''}${s.text}`);
  return [...lines, ...more].join('\n');
}

/**
 * Board moves a button unlocks that the board does not offer yet (C&K: `click Command` to pick a
 * knight). From the build cards' `data-actions`: "[Command]: select knight (2)".
 */
export function movesBehindButtons(
  state: GameState,
  legal: readonly Action[],
  targets: readonly Action[],
  controls: readonly { label: string; enabled: boolean; actions?: string[] | null }[],
  viewer: PlayerId,
): string[] {
  const shown = new Set(targets.map((a) => a.type));
  const out: string[] = [];
  for (const c of controls) {
    if (!c.enabled || !c.actions) continue;
    const counts = new Map<string, number>();
    for (const a of legal) {
      if (a.player !== viewer || shown.has(a.type) || !c.actions.includes(a.type)) continue;
      if (!locationOf(a)) continue;
      const name = actionName(state, a);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    if (counts.size === 0) continue;
    out.push(`[${c.label}]: ${[...counts].map(([k, n]) => `${k} (${n})`).join(', ')}`);
  }
  return out;
}

/** Same description for any id (`click-board <id>`); null if the id is not on the board. */
export function describeId(state: GameState, id: string, viewer: PlayerId): string | null {
  const t = topologyOf(state);
  if (t.vertex[id as VertexId]) return describeVertex(state, id as VertexId, viewer);
  if (t.edge[id as EdgeId]) return describeEdge(state, id as EdgeId, viewer);
  if (t.hex[id as HexId]) return describeHex(state, id as HexId, viewer);
  return null;
}
