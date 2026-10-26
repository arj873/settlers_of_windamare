/**
 * Explorers & Pirates state invariants (docs/rules/explorers-pirates.md §9.7), checked after every
 * simulator step and from tests. Pure; never throws on a malformed state.
 */
import {
  RESOURCES,
  expansionVictoryPoints,
  pieceLimit,
  terrainKind,
  victoryPoints,
  type GameState,
  type HexId,
  type PlayerId,
  type VertexId,
} from '../../engine';
import type { Violation } from '../../bots/invariants';
import { graph, isCoastal, isPirateHex, isShipEdge } from './engine/geometry';
import { FISH_HAULS, mapKeyOf, specOf, T } from './engine/maps';
import { missionVp, spaceVp, totalMissionVp } from './engine/missions';
import { epModule } from './engine';
import { cargoOnBoard, harborsOf } from './engine/ships';
import {
  CARGO,
  citiesInPlay,
  HOLD,
  ITEM,
  LAIR_CREWS,
  MISSIONS,
  TRACK_VP,
  load,
  rulesOf,
  type EpSlice,
} from './engine/state';

export function checkEp(state: GameState): Violation[] {
  const out: Violation[] = [];
  const bad = (message: string, player?: PlayerId) =>
    out.push({
      code: 'expansion',
      message: `ep: ${message}`,
      ...(player === undefined ? {} : { player }),
    });
  const s = state.ext.ep as EpSlice | undefined;
  if (!s || s.v !== 1 || !Array.isArray(s.ships))
    return [{ code: 'expansion', message: 'ep: missing slice' }];
  try {
    check(state, s, bad);
  } catch (e) {
    bad(`invariant check threw: ${String(e)}`);
  }
  return out;
}

function check(state: GameState, s: EpSlice, bad: (m: string, p?: PlayerId) => void): void {
  const rules = rulesOf(state);
  const g = graph(state);
  const n = state.players.length;
  const isPlayer = (p: unknown): p is PlayerId =>
    typeof p === 'number' && Number.isInteger(p) && p >= 0 && p < n;

  // --- gold -----------------------------------------------------------------------------------
  if (s.gold.length !== n) bad(`gold for ${s.gold.length} players`);
  s.gold.forEach((x, p) => {
    if (!Number.isInteger(x) || x < 0) bad(`gold ${x}`, p);
  });

  // --- ships ----------------------------------------------------------------------------------
  const perEdge = new Map<string, number>();
  const ids = new Set<number>();
  const shipCount = state.players.map(() => 0);
  for (const ship of s.ships) {
    if (ids.has(ship.id)) bad(`ship id ${ship.id} twice`);
    ids.add(ship.id);
    if (!isPlayer(ship.owner)) {
      bad(`ship ${ship.id} has owner ${ship.owner}`);
      continue;
    }
    shipCount[ship.owner] = (shipCount[ship.owner] ?? 0) + 1;
    if (!g.ends.has(ship.edge)) bad(`ship on unknown edge ${ship.edge}`, ship.owner);
    else if (!isShipEdge(state, ship.edge)) bad(`ship on a land edge ${ship.edge}`, ship.owner);
    perEdge.set(ship.edge, (perEdge.get(ship.edge) ?? 0) + 1);
    if (load(ship.cargo) > HOLD)
      bad(`ship ${ship.id} overloaded: ${ship.cargo.join(',')}`, ship.owner);
    if (ship.cargo.some((c) => !CARGO.includes(c)))
      bad(`ship ${ship.id} cargo ${ship.cargo.join(',')}`);
    if (ship.id >= s.nextShip) bad(`ship id ${ship.id} ≥ next ${s.nextShip}`);
  }
  for (const [e, k] of perEdge) if (k > 2) bad(`${k} ships on ${e}`);
  shipCount.forEach((k, p) => {
    if (k > pieceLimit(state, p, ITEM.ship)) bad(`${k} ships`, p);
  });

  // --- buildings, harbors, cargo pieces ---------------------------------------------------------
  for (const [v, b] of Object.entries(state.pieces.buildings) as [
    VertexId,
    { owner: number; kind: string },
  ][]) {
    // Cities only with Cities & Knights (E&P + C&K), and never a harbor settlement.
    if (b.kind !== 'settlement' && !(b.kind === 'city' && citiesInPlay(state))) {
      bad(`a ${b.kind} at ${v}`, b.owner);
    }
    if (b.kind !== 'settlement' && s.harbors[v] !== undefined) bad(`a harbor ${b.kind} at ${v}`);
    const hexes = g.hexesAt.get(v) ?? [];
    if (hexes.some((h) => terrainKind(state.board.hexes[h]?.terrain ?? 'sea') === 'fog')) {
      bad(`building next to an unexplored hex at ${v}`, b.owner);
    }
  }
  for (const [v, basin] of Object.entries(s.harbors) as [
    VertexId,
    EpSlice['harbors'][VertexId],
  ][]) {
    const b = state.pieces.buildings[v];
    if (!b) bad(`harbor basin without a settlement at ${v}`);
    if (load(basin) > HOLD) bad(`basin at ${v} overloaded: ${basin.join(',')}`, b?.owner);
    if (!isCoastal(state, v)) bad(`harbor settlement inland at ${v}`, b?.owner);
    if (basin.some((c) => c === 'fish' || c === 'spice')) {
      // Allowed (FAQ-3) — relayed cargo; nothing to check.
    }
  }
  for (const e of Object.keys(state.pieces.roads) as (keyof typeof state.pieces.roads)[]) {
    const sides = g.sides.get(e) ?? [];
    if (sides.some((h) => terrainKind(state.board.hexes[h]?.terrain ?? 'sea') === 'fog')) {
      bad(`road beside an unexplored hex at ${e}`);
    }
  }
  for (let p = 0; p < n; p++) {
    if (harborsOf(state, p).length > pieceLimit(state, p, ITEM.harbor)) bad('too many harbors', p);
    if (cargoOnBoard(state, p, 'settler') > pieceLimit(state, p, ITEM.settler))
      bad('too many settlers', p);
    if (cargoOnBoard(state, p, 'crew') > pieceLimit(state, p, ITEM.crew)) bad('too many crews', p);
    const plain = Object.entries(state.pieces.buildings).filter(
      ([v, b]) =>
        b.owner === p && b.kind === 'settlement' && s.harbors[v as VertexId] === undefined,
    ).length;
    // 5, or more with C&K's pillaged cities on their side (the limit already includes harbors).
    const pieces = pieceLimit(state, p, 'settlement') - harborsOf(state, p).length;
    if (plain > pieces) bad(`${plain} settlements`, p);
  }

  // --- face-down hexes ------------------------------------------------------------------------
  for (const [h, tile] of Object.entries(state.board.hexes) as [HexId, { terrain: string }][]) {
    const fog = tile.terrain === T.parrot || tile.terrain === T.goose;
    if (fog !== (s.hidden[h] !== undefined))
      bad(`hex ${h} ${tile.terrain}: hidden content mismatch`);
  }

  // --- pirate ---------------------------------------------------------------------------------
  if (s.pirate) {
    if (!rules.pirate) bad('a pirate in Land Ho!');
    if (!isPirateHex(state, s.pirate.hex)) bad(`pirate on ${s.pirate.hex}`);
    if (!isPlayer(s.pirate.owner)) bad(`pirate owner ${s.pirate.owner}`);
  }

  // --- lairs, fish, spice ---------------------------------------------------------------------
  for (const [h, lair] of Object.entries(s.lairs) as [HexId, EpSlice['lairs'][HexId]][]) {
    const tile = state.board.hexes[h];
    if (tile?.terrain !== 'gold') bad(`lair on ${tile?.terrain ?? 'nothing'} at ${h}`);
    if (lair.crews.length > LAIR_CREWS) bad(`${lair.crews.length} crews on the lair ${h}`);
    if (lair.captured && tile?.token !== lair.token) bad(`captured lair ${h} shows ${tile?.token}`);
    if (!lair.captured && tile?.token !== null) bad(`uncaptured lair ${h} shows a number`);
  }
  if (!rules.lairs && Object.keys(s.lairs).length > 0) bad('lairs without the lair mission');
  const key = mapKeyOf(state.settings.map);
  if (rules.fish && key) {
    const carried =
      s.ships.reduce((k, x) => k + x.cargo.filter((c) => c === 'fish').length, 0) +
      Object.values(s.harbors).reduce((k, b) => k + b.filter((c) => c === 'fish').length, 0);
    const total = specOf(key).big ? FISH_HAULS.big : FISH_HAULS.small;
    if (s.haulSupply + s.hauls.length + carried !== total) {
      bad(
        `fish hauls: ${s.haulSupply} supply + ${s.hauls.length} out + ${carried} carried ≠ ${total}`,
      );
    }
  }
  for (const h of s.hauls) if (s.shoals[h] === undefined) bad(`fish haul off a shoal at ${h}`);
  if (new Set(s.hauls).size !== s.hauls.length) bad('two hauls on one shoal');
  for (const [h, farm] of Object.entries(s.spice) as [HexId, EpSlice['spice'][HexId]][]) {
    if (state.board.hexes[h]?.terrain !== T.spice) bad(`spice farm on ${h}`);
    if (new Set(farm.crews).size !== farm.crews.length) bad(`two crews of a player on farm ${h}`);
    if (!farm.sacks.every((p) => isPlayer(p))) bad(`farm ${h} sacks ${String(farm.sacks)}`);
  }

  // --- missions and VP ------------------------------------------------------------------------
  for (const m of MISSIONS) {
    const t = s.tracks[m];
    if (!t) continue;
    t.pos.forEach((pos, p) => {
      if (!Number.isInteger(pos) || pos < 0 || pos > TRACK_VP[m].length)
        bad(`${m} track at ${pos}`, p);
    });
  }
  for (let p = 0; p < n; p++) {
    // Buildings (a city 2) + every module's VP; E&P's own share = its missions and harbors.
    const buildings = Object.values(state.pieces.buildings)
      .filter((b) => b.owner === p)
      .reduce((k, b) => k + (b.kind === 'city' ? 2 : 1), 0);
    const v = missionVp(state, p);
    const modules = expansionVictoryPoints(state, p);
    const expected = buildings + modules.public + modules.hidden;
    const vp = victoryPoints(state, p);
    if (vp !== expected) bad(`VP ${vp} ≠ ${expected}`, p);
    if (epModule.hooks?.victoryPoints?.(state, p).public !== totalMissionVp(v)) {
      bad('E&P VP mismatch', p);
    }
    for (const m of MISSIONS) {
      const t = s.tracks[m];
      if (t && (v.tracks[m] ?? 0) !== spaceVp(m, t.pos[p] ?? 0)) bad(`${m} VP`, p);
    }
  }
  if (state.winner !== null && victoryPoints(state, state.winner) < state.settings.vpToWin) {
    bad(`winner ${state.winner} below the target`);
  }

  // --- bank -----------------------------------------------------------------------------------
  for (const r of RESOURCES) if (state.bank[r] < 0) bad(`bank ${r} ${state.bank[r]}`);
}
