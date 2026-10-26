/**
 * Game-setting variants (V1, Colonist-style room options). Every variant setting is OPTIONAL in
 * GameSettings; absent means the official rule. Read them only through these accessors, so old
 * saves (which never have the fields) behave exactly as before. Sources: docs/RULES.md §18.
 */
import { publicVictoryPoints } from './selectors';
import { edgeVertices, hexVertices, topologyOf } from './topology';
import type {
  VertexId,
  GameSettings,
  GameState,
  HexId,
  MapRules,
  MapSelection,
  PlayerId,
  RobberMode,
  SetupBuilding,
  SetupPlacement,
  SetupRestriction,
} from './types';

export const ROBBER_MODES: readonly RobberMode[] = ['normal', 'friendly', 'none'];
/** Friendly robber: players with this many public VP or fewer are protected. */
export const FRIENDLY_ROBBER_MAX_VP = 2;

export const MAP_SELECTIONS: readonly MapSelection[] = ['fixed', 'random', 'veto'];

export const SETUP_BUILDINGS: readonly SetupBuilding[] = ['settlement', 'city'];
export const SETUP_RESTRICTIONS: readonly SetupRestriction[] = ['normal', 'anyVertex'];

/** The official setup: two settlements, distance rule. */
export const OFFICIAL_SETUP: SetupPlacement = {
  first: { building: 'settlement', restriction: 'normal' },
  second: { building: 'settlement', restriction: 'normal' },
};

export function robberModeOf(settings: GameSettings): RobberMode {
  return settings.robberMode ?? 'normal';
}

export function setupPlacementOf(settings: GameSettings): SetupPlacement {
  return settings.setupPlacement ?? OFFICIAL_SETUP;
}

export function eventCardsOn(settings: GameSettings): boolean {
  return settings.eventCards === true;
}

/** The optional 5+ player rule set (RULES.md §20). */
export function rules56On(settings: GameSettings): boolean {
  return settings.rules56 === true;
}
/** Suggested victory points for the 5+ player rule set (a default on the setup screen only). */
export const RULES56_VP = 12;
/** The rule set needs this many players (it is built on the 5-6 extension). */
export const RULES56_MIN_PLAYERS = 5;

export const MAP_RULE_KEYS: readonly (keyof MapRules)[] = [
  'allowRedTouch',
  'allowExtremeTouch',
  'allowSameNumberTouch',
  'allowSameResourceTouch',
];

/** Map rules in force (`true` = that adjacency is allowed); absent = all constrained. */
export function mapRulesOf(settings: GameSettings): MapRules {
  return settings.mapRules ?? {};
}

/** The "first" desert: the first desert hex in `landHexes` order (rows top to bottom, left to right). */
export function firstDesert(state: GameState): HexId | undefined {
  return topologyOf(state).landHexes.find((h) => state.board.hexes[h]?.terrain === 'desert');
}

/** Friendly robber: is `player` protected (≤ FRIENDLY_ROBBER_MAX_VP public VP)? */
export function isRobberProtected(state: GameState, player: PlayerId): boolean {
  return (
    robberModeOf(state.settings) === 'friendly' &&
    publicVictoryPoints(state, player) <= FRIENDLY_ROBBER_MAX_VP
  );
}

/** Owners of buildings on `hex`, other than `mover`. */
function ownersAround(state: GameState, hex: HexId, mover: PlayerId): Set<PlayerId> {
  const owners = new Set<PlayerId>();
  for (const v of hexVertices(topologyOf(state), hex)) {
    const b = state.pieces.buildings[v];
    if (b && b.owner !== mover) owners.add(b.owner);
  }
  return owners;
}

/**
 * Hexes `mover` may move the robber to: every land hex but the robber's. Friendly robber: not
 * next to a protected opponent. When that leaves nothing, the robber "moves to (or remains on)
 * the desert" (T&B 2020 p.3): the deserts, including the robber's own hex if it is one.
 */
export function robberTargets(state: GameState, mover: PlayerId): HexId[] {
  const t = topologyOf(state);
  // 5+ player rule set: every desert but the first is a dead hex the robber never enters.
  const first = rules56On(state.settings) ? firstDesert(state) : undefined;
  const open = (h: HexId) =>
    first === undefined || h === first || state.board.hexes[h]?.terrain !== 'desert';
  const all = t.landHexes.filter((h) => h !== state.robber && open(h));
  if (robberModeOf(state.settings) !== 'friendly') return all;
  const ok = all.filter(
    (h) => ![...ownersAround(state, h, mover)].some((p) => isRobberProtected(state, p)),
  );
  if (ok.length > 0) return ok;
  const deserts = t.landHexes.filter((h) => state.board.hexes[h]?.terrain === 'desert' && open(h));
  return deserts.length > 0 ? deserts : all;
}

/** Earthquake (event cards): `player` has a damaged road, so they may build no roads. */
export function roadsBlocked(state: GameState, player: PlayerId): boolean {
  return (state.damagedRoads?.[player] ?? null) !== null;
}

/** Earthquake: no settlement next to (at an end of) your own damaged road. */
export function nextToDamagedRoad(state: GameState, player: PlayerId, v: VertexId): boolean {
  const e = state.damagedRoads?.[player] ?? null;
  return e !== null && edgeVertices(topologyOf(state), e).includes(v);
}

/** The robber is in play (every mode but 'none'). */
export function hasRobber(settings: GameSettings): boolean {
  return robberModeOf(settings) !== 'none';
}
