/**
 * Seafarers state invariants (checked after every simulator step, and from tests). Pure; never
 * throws on a malformed state.
 */
import {
  DEV_CARD_TYPES,
  LARGEST_ARMY_MIN,
  longestRoadLengths,
  pieceLimit,
  supplyOf,
  terrainKind,
  victoryPoints,
  type DevCardType,
  type EdgeId,
  type GameState,
  type PlayerId,
} from '../../engine';
import type { Violation } from '../../bots/invariants';
import { CLOTH_PER_VILLAGE, CLOTH_SUPPLY, tribeGifts } from './engine/features';
import { graph, hexKind, isSeaHex, isShipEdge } from './engine/geometry';
import { mapKeyOf, OFF_BOARD, type MapKey } from './engine/maps';
import { fortressOf, lineOf } from './engine/pirates';
import { SHIP } from './engine/ships';
import { rulesOf, scenarioKey, type SeaSlice } from './engine/state';
import { villagesWithCloth } from './engine/effects';

export function checkSeafarers(state: GameState): Violation[] {
  const out: Violation[] = [];
  const bad = (message: string, player?: PlayerId) =>
    out.push({
      code: 'expansion',
      message: `seafarers: ${message}`,
      ...(player === undefined ? {} : { player }),
    });
  const s = state.ext.seafarers as SeaSlice | undefined;
  if (!s || s.v !== 1 || typeof s.ships !== 'object')
    return [{ code: 'expansion', message: 'seafarers: missing slice' }];
  const key = mapKeyOf(state.settings.map) as MapKey;
  const rules = rulesOf(state);
  const g = graph(state);

  // --- ships ----------------------------------------------------------------------------------
  const count = state.players.map(() => 0);
  for (const [e, ship] of Object.entries(s.ships) as [EdgeId, SeaSlice['ships'][EdgeId]][]) {
    if (!g.ends.has(e)) bad(`ship on unknown edge ${e}`);
    else if (!isShipEdge(state, e)) bad(`ship on a land edge ${e}`, ship.owner);
    if (state.pieces.roads[e] !== undefined) bad(`ship and road share ${e}`, ship.owner);
    if (count[ship.owner] === undefined) bad(`ship ${e} has owner ${ship.owner}`);
    else count[ship.owner] = (count[ship.owner] ?? 0) + 1;
  }
  count.forEach((n, p) => {
    if (n > pieceLimit(state, p, SHIP)) bad(`player ${p} has ${n} ships`, p);
  });

  // --- pirate, robber -------------------------------------------------------------------------
  if (s.pirate !== null && !isSeaHex(state, s.pirate)) bad(`pirate on ${s.pirate}`);
  if (!rules.pirate && s.pirate !== null) bad('pirate in a scenario without one');
  // The robber stands on land (a banned region only at its start or when nothing else is open).
  const robberTile = state.board.hexes[state.robber];
  if (state.robber !== OFF_BOARD && (!robberTile || terrainKind(robberTile.terrain) !== 'land')) {
    bad(`robber on ${state.robber}`);
  }
  if (scenarioKey(state) === 'pirateIslands' && state.robber !== OFF_BOARD) bad('robber in play');

  // --- development cards: deck + hands + played + gifts on the board = the deck ---------------
  const supply = supplyOf(state);
  for (const t of DEV_CARD_TYPES) {
    const deck = state.devDeck.filter((c) => c === t).length;
    const held = state.players.reduce((n, p) => n + p.devCards[t] + p.newDevCards[t], 0);
    const played = state.players.reduce(
      (n, p) =>
        n +
        (t === 'knight' ? p.knightsPlayed : t === 'victoryPoint' ? 0 : p.progressCardsPlayed[t]),
      0,
    );
    const gifts = Object.values(s.gifts ?? {}).filter(
      (x) => x.kind === 'dev' && x.card === (t as DevCardType),
    ).length;
    if (deck + held + played + gifts !== supply.devDeck[t]) {
      bad(
        `${t}: deck ${deck} + held ${held} + played ${played} + gifts ${gifts} ≠ ${supply.devDeck[t]}`,
      );
    }
  }

  // --- fog ------------------------------------------------------------------------------------
  const fogHexes = Object.values(state.board.hexes).filter((h) => h.terrain === 'fog').length;
  if (s.fog) {
    if (s.fog.terrains.length !== fogHexes)
      bad(`fog stack ${s.fog.terrains.length} for ${fogHexes} fog hexes`);
    const needTokens = s.fog.terrains.filter(
      (t) => terrainKind(t) === 'land' && t !== 'desert',
    ).length;
    if (s.fog.tokens.length !== needTokens)
      bad(`fog tokens ${s.fog.tokens.length} for ${needTokens} land hexes`);
  } else if (fogHexes > 0) bad('fog hexes without a stack');

  // --- Forgotten Tribe gifts ------------------------------------------------------------------
  const gifts = tribeGifts(key);
  if (gifts) {
    const giftChits = s.chits.filter((c) => c.area === 'gift').length;
    const onBoard = Object.values(s.gifts ?? {}).filter((x) => x.kind === 'chit').length;
    if (giftChits + onBoard !== gifts.chit.length)
      bad(`gift chits ${giftChits} + ${onBoard} ≠ ${gifts.chit.length}`);
    const harborsHeld = (s.harbors ?? []).reduce((n, h) => n + h.length, 0);
    const harborsLeft = Object.values(s.gifts ?? {}).filter((x) => x.kind === 'harbor').length;
    if (harborsHeld + harborsLeft + state.board.ports.length !== gifts.harbor.length) {
      bad(
        `harbors: held ${harborsHeld} + left ${harborsLeft} + placed ${state.board.ports.length}`,
      );
    }
    for (const port of state.board.ports) {
      const sides = g.sides.get(port.edge) ?? [];
      if (!sides.some((h) => hexKind(state, h) === 'land'))
        bad(`harbor on ${port.edge} has no land`);
    }
  }

  // --- cloth ----------------------------------------------------------------------------------
  if (s.cloth) {
    const villages = Object.values(s.cloth.villages);
    const total =
      villages.reduce((n, v) => n + v.cloth, 0) +
      s.cloth.supply +
      s.cloth.held.reduce((a, b) => a + b, 0);
    const expected = villages.length * CLOTH_PER_VILLAGE + CLOTH_SUPPLY;
    if (total !== expected) bad(`cloth ${total}, expected ${expected}`);
    if (villages.some((v) => v.cloth < 0) || s.cloth.supply < 0) bad('negative cloth');
  }

  // --- special VP -----------------------------------------------------------------------------
  const seen = new Set<string>();
  for (const c of s.chits) {
    if (c.area === 'gift') continue;
    const k = `${c.player}/${c.area}`;
    if (seen.has(k)) bad(`player ${c.player} paid twice for ${c.area}`, c.player);
    seen.add(k);
    if (!c.vertex || state.pieces.buildings[c.vertex]?.owner !== c.player) {
      bad(`chit of ${c.player} not under their building`, c.player);
    }
  }
  if (rules.bonus?.cap !== undefined) {
    state.players.forEach((p) => {
      const n = s.chits.filter((c) => c.player === p.id && c.area !== 'gift').length;
      if (n > (rules.bonus?.cap ?? 0)) bad(`player ${p.id} has ${n} new-land chits`, p.id);
    });
  }

  // --- awards ---------------------------------------------------------------------------------
  const { longestRoad, largestArmy } = state.awards;
  if (!rules.longestRoute && longestRoad !== null)
    bad('Longest Trade Route held in a scenario without it');
  if (!rules.largestArmy && largestArmy !== null) bad('Largest Army held in a scenario without it');
  if (rules.longestRoute) {
    // The hooked lengths: a combination may change the route (T&B + Seafarers: camels, none in T&B).
    const lengths = longestRoadLengths(state);
    const max = Math.max(...lengths);
    if (longestRoad !== null && (lengths[longestRoad] ?? 0) < max) {
      bad(`Longest Trade Route holder ${longestRoad} has ${lengths[longestRoad]}, longest ${max}`);
    }
    if (longestRoad === null && max >= 5 && lengths.filter((l) => l === max).length === 1) {
      bad(`nobody holds Longest Trade Route, ${lengths.indexOf(max)} has ${max}`);
    }
  }
  if (
    rules.largestArmy &&
    largestArmy !== null &&
    (state.players[largestArmy]?.knightsPlayed ?? 0) < LARGEST_ARMY_MIN
  ) {
    bad('Largest Army without 3 knights');
  }

  // --- Pirate Islands -------------------------------------------------------------------------
  if (s.fleet) {
    for (const f of s.fleet.fortresses) {
      if (f.chits < 0 || f.chits > 3) bad(`fortress chits ${f.chits}`, f.owner);
      const b = state.pieces.buildings[f.vertex];
      if (f.chits === 0 && b?.owner !== f.owner)
        bad(`captured fortress of ${f.owner} not theirs`, f.owner);
      if (f.chits > 0 && b !== undefined) bad(`building on the fortress of ${f.owner}`, f.owner);
    }
    state.players.forEach((p) => {
      const line = new Set(lineOf(state, p.id).ships);
      for (const [e, ship] of Object.entries(s.ships) as [EdgeId, SeaSlice['ships'][EdgeId]][]) {
        if (ship.owner === p.id && !line.has(e)) bad(`ship ${e} of ${p.id} off their line`, p.id);
      }
      if (fortressOf(state, p.id) === undefined) bad(`player ${p.id} has no fortress`, p.id);
    });
  }

  // --- statistics: every hand change is classified (statsCategory hook) -------------------------
  if (state.stats?.complete) {
    state.stats.players.forEach((ps, p) => {
      const other = Object.values(ps.gained.other).reduce((a, b) => a + b, 0);
      const lost = Object.values(ps.lost.other).reduce((a, b) => a + b, 0);
      if (other + lost > 0)
        bad(`unclassified hand change in the statistics (+${other} −${lost})`, p);
    });
  }

  // --- the winner -----------------------------------------------------------------------------
  const over = state.phase.kind === 'gameOver';
  if (over !== (state.winner !== null))
    bad(`phase ${state.phase.kind}, winner ${String(state.winner)}`);
  const wins = (p: PlayerId): boolean => {
    const vp = victoryPoints(state, p);
    const target = state.settings.vpToWin;
    switch (scenarioKey(state)) {
      case 'pirateIslands':
        return vp >= target && fortressOf(state, p)?.chits === 0;
      case 'wondersOfCatan': {
        const level = s.wonders?.level ?? [];
        const mine = level[p] ?? 0;
        return mine >= 4 || (vp >= target && level.every((l, o) => o === p || l < mine));
      }
      default:
        return vp >= target;
    }
  };
  if (state.winner !== null) {
    const clothEnded = s.cloth !== undefined && villagesWithCloth(state) <= 3;
    if (!wins(state.winner) && !clothEnded) bad(`winner ${state.winner} has not won`, state.winner);
  } else if (
    state.phase.kind !== 'specialBuild' &&
    state.phase.kind !== 'setup' &&
    state.turn.specialOwner === undefined &&
    wins(state.turn.current)
  ) {
    bad(`player ${state.turn.current} has won but the game goes on`, state.turn.current);
  }

  // --- Wonders --------------------------------------------------------------------------------
  if (s.wonders) {
    s.wonders.level.forEach((l, p) => {
      if (l < 0 || l > 4) bad(`wonder level ${l}`, p);
      if (l > 0 && !s.wonders?.started.includes(p)) bad(`wonder levels without a wonder`, p);
    });
    state.players.forEach((p) => {
      if ((s.wonders?.started.filter((x) => x === p.id).length ?? 0) > 1) bad('two wonders', p.id);
    });
  }
  return out;
}
