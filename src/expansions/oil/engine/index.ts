/**
 * Oil Springs (official free Catan scenario, Erik Assadourian & Ty Hansen, 2011): oil springs
 * produce oil instead of a resource, oil is converted into resources, turns cities into
 * metropolises or is sequestered for VP, and every 5 oil used triggers a disaster that floods
 * the coasts or destroys hexes. Rules and open questions: docs/rules/oil-springs.md.
 *
 * Framework use: `afterProduction` pays oil, `production` the metropolis bonus, `handSize` counts
 * oil for the 7 rule, `afterAction` resolves the disaster phase and the end of the game
 * (`deferVictory`: the win is checked at the end of the turn), overrides + `filterLegal` keep
 * the robber off destroyed hexes and let discards and thefts name oil.
 */
import { MAX_TRADE_OFFERS_PER_TURN, RESOURCES } from '../../../engine/constants';
import {
  log,
  ok,
  fail,
  isCurrent,
  resumePhase,
  type LegalGenerator,
} from '../../../engine/actions/common';
import { discardOptions, robberHandlers, startRobber } from '../../../engine/actions/robber';
import { costOf, pieceLimit } from '../../../engine/expansions/hooks';
import type { ExpansionModule, ExtHandler } from '../../../engine/expansions/types';
import { addResources, hasResources, isResource, isValidBundle } from '../../../engine/resources';
import { subtractResources, totalResources } from '../../../engine/resources';
import { updateAwards } from '../../../engine/rules/awards';
import { Rng } from '../../../engine/rng';
import { playerName } from '../../../engine/rules/text';
import { buildingsOf, getPlayer, victoryPoints } from '../../../engine/selectors';
import { hexVertices, topologyOf, vertexInfo } from '../../../engine/topology';
import { hasRobber } from '../../../engine/variants';
import type {
  Action,
  ActionResult,
  GameState,
  HexId,
  PlayerId,
  Resource,
  ResourceBundle,
  VertexId,
} from '../../../engine/types';
import { OIL_FIXED19, OIL_FIXED30, OIL_RANDOM19, OIL_RANDOM30 } from './maps';
import {
  DISASTER_AT,
  DISASTER_FLOOD,
  METROPOLIS,
  METROPOLIS_COST,
  METROPOLIS_OIL,
  OIL,
  SPRING_LOSS,
  isDestroyed,
  isSpringTerrain,
  metropolisCount,
  oilScale,
  oilSlice,
  oilVictoryPoints,
  type OilAction,
  type OilPick,
  type OilSlice,
  type OilTradePhase,
} from './state';

export * from './state';
export { OIL_FIXED19, OIL_FIXED30, OIL_RANDOM19, OIL_RANDOM30 } from './maps';

const num = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const asOil = (a: { type: string }) => a as unknown as OilAction;

// ---------------------------------------------------------------------------
// Preconditions (shared by handlers and legal generators)
// ---------------------------------------------------------------------------

/** Why the current player cannot use `n` more oil right now (marker limit, sequestering). */
function useBlocker(state: GameState, p: PlayerId, n: number, inSbp: boolean): string | null {
  const s = oilSlice(state);
  if (!inSbp && s.sequesteredNow) return 'you sequestered oil this turn: no using oil';
  if ((s.oil[p] ?? 0) < n) return 'not enough oil';
  if (s.marker + n > DISASTER_AT) return 'that would push the Disaster Track beyond 5';
  return null;
}

export function convertBlocker(state: GameState, p: PlayerId, r: Resource): string | null {
  if (state.phase.kind !== 'main') return 'can only convert oil in the main phase';
  if (!isCurrent(state, p)) return 'not your turn';
  if (state.bank[r] < 2) return `the bank has no 2 ${r}`;
  return useBlocker(state, p, 1, false);
}

export function metropolisBlocker(state: GameState, p: PlayerId, v: VertexId): string | null {
  const phase = state.phase.kind;
  if (phase !== 'main' && phase !== 'specialBuild') return 'cannot build a metropolis now';
  if (!isCurrent(state, p)) return 'not your turn';
  const b = state.pieces.buildings[v];
  if (b?.owner !== p || b.kind !== 'city') return 'a metropolis needs one of your cities';
  const s = oilSlice(state);
  if (s.metropolis[v] !== undefined) return 'that city is already a metropolis';
  if (metropolisCount(state) >= oilScale(state).metropolises) return 'no metropolis tokens left';
  const hand = state.players[p]?.resources;
  if (!hand || !hasResources(hand, costOf(state, METROPOLIS) ?? METROPOLIS_COST)) {
    return 'cannot afford a metropolis';
  }
  return useBlocker(state, p, METROPOLIS_OIL, phase === 'specialBuild');
}

export function sequesterBlocker(state: GameState, p: PlayerId): string | null {
  if (state.phase.kind !== 'main') return 'can only sequester oil in the main phase';
  if (!isCurrent(state, p)) return 'not your turn';
  const s = oilSlice(state);
  if ((s.oil[p] ?? 0) < 1) return 'no oil to sequester';
  if (s.usedOil) return 'you used oil this turn: no sequestering';
  if (s.sequesteredNow) return 'only 1 oil can be sequestered per turn';
  return null;
}

/** Room for `n` more oil in `p`'s stock. */
const hasRoom = (state: GameState, p: PlayerId, n: number): boolean =>
  (oilSlice(state).oil[p] ?? 0) + n <= oilScale(state).cap;

function canPlayDev(state: GameState, p: PlayerId, card: 'yearOfPlenty' | 'monopoly'): boolean {
  const k = state.phase.kind;
  return (
    (k === 'preRoll' || k === 'main') &&
    isCurrent(state, p) &&
    !state.turn.devCardPlayed &&
    (state.players[p]?.devCards[card] ?? 0) >= 1
  );
}

/** Mark the dev card as played (mirrors the base `spend`). */
function spendDev(draft: GameState, p: PlayerId, card: 'yearOfPlenty' | 'monopoly'): void {
  const pl = draft.players[p];
  if (!pl) return;
  pl.devCards[card] -= 1;
  pl.progressCardsPlayed[card] += 1;
  draft.turn.devCardPlayed = true;
  log(draft, p, `${pl.name} played ${card === 'monopoly' ? 'Monopoly' : 'Year of Plenty'}`);
}

/** Pay oil back to the supply and move the Disaster Track marker (using oil is polluting). */
function useOil(draft: GameState, p: PlayerId, n: number, inSbp: boolean): void {
  const s = oilSlice(draft);
  s.oil[p] = (s.oil[p] ?? 0) - n;
  s.supply += n;
  s.marker += n;
  if (!inSbp) s.usedOil = true;
}

// ---------------------------------------------------------------------------
// Oil production
// ---------------------------------------------------------------------------

/** Oil each player is owed for `roll`: 1 per settlement, 2 per city, 3 per metropolis. */
export function oilOwed(state: GameState, roll: number): number[] {
  const owed = state.players.map(() => 0);
  const s = oilSlice(state);
  const t = topologyOf(state);
  const blocked = hasRobber(state.settings) ? state.robber : null;
  for (const id of Object.keys(state.board.hexes) as HexId[]) {
    const hex = state.board.hexes[id];
    if (!hex || hex.token !== roll || id === blocked || !isSpringTerrain(hex.terrain)) continue;
    for (const v of hexVertices(t, id)) {
      const b = state.pieces.buildings[v];
      if (!b) continue;
      owed[b.owner] =
        (owed[b.owner] ?? 0) + (s.metropolis[v] !== undefined ? 3 : b.kind === 'city' ? 2 : 1);
    }
  }
  return owed;
}

/** One oil at a time from the roller clockwise, until everyone has theirs, the cap or the supply is hit. */
function payOil(draft: GameState, owed: readonly number[]): number[] {
  const s = oilSlice(draft);
  const n = draft.players.length;
  const cap = oilScale(draft).cap;
  const got = owed.map(() => 0);
  let moved = true;
  while (moved && s.supply > 0) {
    moved = false;
    for (let i = 0; i < n && s.supply > 0; i++) {
      const p = (draft.turn.current + i) % n;
      if ((owed[p] ?? 0) > (got[p] ?? 0) && (s.oil[p] ?? 0) < cap) {
        s.oil[p] = (s.oil[p] ?? 0) + 1;
        s.supply -= 1;
        got[p] = (got[p] ?? 0) + 1;
        moved = true;
      }
    }
  }
  return got;
}

// ---------------------------------------------------------------------------
// Disaster phase and the end of the game
// ---------------------------------------------------------------------------

function flood(draft: GameState): void {
  const t = topologyOf(draft);
  const s = oilSlice(draft);
  let gone = 0;
  let reduced = 0;
  for (const v of Object.keys(draft.pieces.buildings) as VertexId[]) {
    const b = draft.pieces.buildings[v];
    if (!b || !vertexInfo(t, v)?.coastal || s.metropolis[v] !== undefined) continue;
    if (b.kind === 'settlement') {
      Reflect.deleteProperty(draft.pieces.buildings, v);
      gone += 1;
    } else if (
      buildingsOf(draft, b.owner, 'settlement').length < pieceLimit(draft, b.owner, 'settlement')
    ) {
      b.kind = 'settlement';
      reduced += 1;
    } else {
      // No settlement piece to replace the city with: the city is lost altogether (rulebook silent).
      Reflect.deleteProperty(draft.pieces.buildings, v);
      gone += 1;
    }
  }
  log(draft, null, `Coastal flooding! ${gone} settlements lost, ${reduced} cities reduced`);
  updateAwards(draft, { roads: true });
}

/** 3 oil leave the game: from the supply first, then one at a time from the players, clockwise from `cause`. */
function pourOut(draft: GameState, cause: PlayerId): void {
  const s = oilSlice(draft);
  const n = draft.players.length;
  let left = SPRING_LOSS;
  const fromSupply = Math.min(left, s.supply);
  s.supply -= fromSupply;
  s.lost += fromSupply;
  left -= fromSupply;
  for (let i = 0; left > 0 && i < n * SPRING_LOSS; i++) {
    const p = (cause + i) % n;
    if ((s.oil[p] ?? 0) > 0) {
      s.oil[p] = (s.oil[p] ?? 0) - 1;
      s.lost += 1;
      left -= 1;
    }
  }
}

/** Resolve the Disaster Phase (marker at 5): roll, flood or pollute, reset the marker. */
function resolveDisaster(draft: GameState, cause: PlayerId): void {
  const s = oilSlice(draft);
  const rng = new Rng(draft.rng);
  const roll = rng.die() + rng.die();
  log(draft, cause, `Disaster! ${playerName(draft, cause)} rolled ${roll}`);
  if (roll === DISASTER_FLOOD) {
    flood(draft);
  } else {
    const hexes = (Object.keys(draft.board.hexes) as HexId[])
      .filter((h) => draft.board.hexes[h]?.token === roll)
      .sort();
    const hit = hexes.length > 1 ? rng.pick(hexes) : hexes[0];
    const tile = hit === undefined ? undefined : draft.board.hexes[hit];
    if (hit === undefined || !tile) {
      log(draft, null, 'Pollution strikes, but no hex carries that number');
    } else if (isSpringTerrain(tile.terrain)) {
      pourOut(draft, cause);
      log(draft, null, `Pollution hits an oil spring: ${SPRING_LOSS} oil are gone for good`);
    } else {
      draft.board = {
        ...draft.board,
        hexes: { ...draft.board.hexes, [hit]: { ...tile, token: null } },
      };
      s.destroyed.push(hit);
      log(draft, null, `Pollution destroys the ${roll} ${tile.terrain} hex`);
    }
  }
  draft.rng = rng.state;
  s.marker = 0;
}

function endGame(draft: GameState, winner: PlayerId | null, text: string): void {
  draft.winner = winner;
  draft.phase = { kind: 'gameOver' };
  log(draft, winner, text);
}

function afterAction(draft: GameState, action: Action): void {
  if (draft.phase.kind === 'gameOver') return;
  const s = oilSlice(draft);
  const ended = action.type === 'endTurn';
  const passed = action.type === 'passSpecialBuild' && draft.phase.kind === 'preRoll';
  if (!ended && !passed) return;
  if (s.marker >= DISASTER_AT) resolveDisaster(draft, action.player);
  if (s.destroyed.length >= oilScale(draft).ruin) {
    const champ = s.champion;
    endGame(
      draft,
      champ,
      champ === null
        ? 'The island is flooded and abandoned: nobody wins'
        : `The island is flooded: ${playerName(draft, champ)}, Champion of the Environment, wins a Pyrrhic victory`,
    );
    return;
  }
  // The win is checked at the end of the player's own turn, after the disaster phase.
  if (ended && victoryPoints(draft, action.player) >= draft.settings.vpToWin) {
    const vp = victoryPoints(draft, action.player);
    endGame(
      draft,
      action.player,
      `${playerName(draft, action.player)} wins with ${vp} victory points!`,
    );
  }
}

// ---------------------------------------------------------------------------
// Trades involving oil
// ---------------------------------------------------------------------------

/** Why a pending oil trade cannot be executed now, or null. */
export function tradeBlocker(state: GameState, t: OilTradePhase): string | null {
  const a = state.players[t.from];
  const b = state.players[t.to];
  if (!a || !b) return 'invalid player';
  if (!hasResources(a.resources, t.give) || (oilSlice(state).oil[t.from] ?? 0) < t.giveOil) {
    return 'the offerer cannot afford it';
  }
  if (!hasResources(b.resources, t.want) || (oilSlice(state).oil[t.to] ?? 0) < t.wantOil) {
    return 'you cannot afford it';
  }
  const s = oilSlice(state);
  const cap = oilScale(state).cap;
  if ((s.oil[t.from] ?? 0) - t.giveOil + t.wantOil > cap)
    return 'the offerer would hold too much oil';
  if ((s.oil[t.to] ?? 0) - t.wantOil + t.giveOil > cap) return 'you would hold too much oil';
  return null;
}

function parseTrade(
  draft: GameState,
  a: OilAction & { type: 'oil/offerTrade' },
): OilTradePhase | string {
  if (draft.phase.kind !== 'main') return 'can only offer a trade in the main phase';
  if (!isCurrent(draft, a.player)) return 'not your turn';
  if (draft.turn.tradeOffers >= MAX_TRADE_OFFERS_PER_TURN) return 'too many trade offers this turn';
  if (!num(a.to) || a.to === a.player || draft.players[a.to] === undefined)
    return 'invalid partner';
  if (!num(a.giveOil) || !num(a.wantOil)) return 'invalid oil amounts';
  if (!isValidBundle(a.give) || !isValidBundle(a.want)) return 'invalid resources';
  if (a.giveOil + a.wantOil === 0) return 'an oil trade needs oil';
  if (a.giveOil + totalResources(a.give) === 0) return 'you must offer something';
  if (a.wantOil + totalResources(a.want) === 0) return 'you must ask for something';
  if (a.giveOil > 0 && a.wantOil > 0) return 'trade oil for resources, not for oil';
  return {
    kind: 'oil/trade',
    from: a.player,
    to: a.to,
    giveOil: a.giveOil,
    wantOil: a.wantOil,
    give: { ...a.give },
    want: { ...a.want },
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const actions: Record<`oil/${string}`, ExtHandler> = {
  'oil/convert': (draft, action) => {
    const r = action['resource'];
    if (!isResource(r)) return fail('invalid resource');
    const err = convertBlocker(draft, action.player, r);
    if (err) return fail(err);
    useOil(draft, action.player, 1, false);
    getPlayer(draft, action.player).resources[r] += 2;
    draft.bank[r] -= 2;
    log(draft, action.player, `${playerName(draft, action.player)} turned 1 oil into 2 ${r}`);
    return ok(draft);
  },

  'oil/metropolis': (draft, action) => {
    const v = action.vertex;
    if (typeof v !== 'string') return fail('invalid vertex');
    const err = metropolisBlocker(draft, action.player, v);
    if (err) return fail(err);
    const builder = getPlayer(draft, action.player);
    const cost = costOf(draft, METROPOLIS) ?? METROPOLIS_COST;
    builder.resources = subtractResources(builder.resources, cost);
    draft.bank = addResources(draft.bank, cost);
    useOil(draft, action.player, METROPOLIS_OIL, draft.phase.kind === 'specialBuild');
    oilSlice(draft).metropolis[v] = action.player;
    log(draft, action.player, `${playerName(draft, action.player)} built a metropolis`);
    return ok(draft);
  },

  'oil/sequester': (draft, action) => {
    const err = sequesterBlocker(draft, action.player);
    if (err) return fail(err);
    const s = oilSlice(draft);
    const p = action.player;
    s.oil[p] = (s.oil[p] ?? 0) - 1;
    s.sequestered[p] = (s.sequestered[p] ?? 0) + 1;
    s.sequesteredNow = true;
    log(draft, p, `${playerName(draft, p)} sequestered 1 oil`);
    const mine = s.sequestered[p] ?? 0;
    const champ = s.champion;
    if (mine >= 3 && (champ === null || mine > (s.sequestered[champ] ?? 0)) && champ !== p) {
      s.champion = p;
      log(draft, p, `${playerName(draft, p)} is the Champion of the Environment`);
    }
    return ok(draft);
  },

  'oil/discard': (draft, action) => {
    const phase = draft.phase;
    if (phase.kind !== 'discard') return fail('nobody needs to discard now');
    const owed = phase.pending[action.player] ?? 0;
    if (owed <= 0) return fail('you do not need to discard');
    const a = asOil(action) as OilAction & { type: 'oil/discard' };
    if (!isValidBundle(a.resources) || !num(a.oil)) return fail('invalid cards');
    const s = oilSlice(draft);
    const p = draft.players[action.player];
    if (!p || a.oil > (s.oil[action.player] ?? 0)) return fail('you do not have that much oil');
    if (totalResources(a.resources) + a.oil !== owed) {
      return fail(`must discard exactly ${owed} cards`);
    }
    if (!hasResources(p.resources, a.resources)) return fail('you do not have those cards');
    for (const r of RESOURCES) {
      const k = a.resources[r] ?? 0;
      p.resources[r] -= k;
      draft.bank[r] += k;
    }
    s.oil[action.player] = (s.oil[action.player] ?? 0) - a.oil;
    s.supply += a.oil;
    phase.pending[action.player] = 0;
    log(
      draft,
      action.player,
      `${playerName(draft, action.player)} discarded ${owed} cards${a.oil > 0 ? ` (${a.oil} oil)` : ''}`,
    );
    if (phase.pending.every((n) => n === 0)) startRobber(draft, 'main');
    return ok(draft);
  },

  'oil/steal': (draft, action) => {
    const phase = draft.phase;
    if (phase.kind !== 'steal') return fail('cannot steal now');
    if (!isCurrent(draft, action.player)) return fail('not your turn');
    const victim = action['victim'];
    if (!num(victim) || !phase.candidates.includes(victim))
      return fail('cannot steal from that player');
    if (action['oil'] !== true) {
      return robberHandlers.steal(draft, { type: 'steal', player: action.player, victim });
    }
    const s = oilSlice(draft);
    if ((s.oil[victim] ?? 0) < 1) return fail('that player has no oil');
    if (!hasRoom(draft, action.player, 1)) return fail('you cannot hold more oil');
    s.oil[victim] = (s.oil[victim] ?? 0) - 1;
    s.oil[action.player] = (s.oil[action.player] ?? 0) + 1;
    log(
      draft,
      action.player,
      `${playerName(draft, action.player)} stole 1 oil from ${playerName(draft, victim)}`,
    );
    draft.phase = resumePhase(draft, phase.resume);
    return ok(draft);
  },

  'oil/yearOfPlenty': (draft, action) => {
    if (!canPlayDev(draft, action.player, 'yearOfPlenty'))
      return fail('cannot play Year of Plenty');
    const picks = action['picks'] as unknown;
    const valid = (x: unknown): x is OilPick => x === 'oil' || isResource(x);
    if (!Array.isArray(picks) || picks.length !== 2 || !picks.every(valid)) {
      return fail('pick exactly two resources');
    }
    const oilPicks = picks.filter((x) => x === 'oil').length;
    if (oilPicks === 0) return fail('use the normal Year of Plenty without oil');
    const s = oilSlice(draft);
    if (!hasRoom(draft, action.player, oilPicks)) return fail('you cannot hold that much oil');
    if (s.supply < oilPicks) return fail('the supply has no oil left');
    const bundle: ResourceBundle = {};
    for (const x of picks) if (x !== 'oil') bundle[x] = (bundle[x] ?? 0) + 1;
    if (!hasResources(draft.bank, bundle)) return fail('the bank does not have those resources');
    spendDev(draft, action.player, 'yearOfPlenty');
    const p = getPlayer(draft, action.player);
    p.resources = addResources(p.resources, bundle);
    draft.bank = subtractResources(draft.bank, bundle);
    s.oil[action.player] = (s.oil[action.player] ?? 0) + oilPicks;
    s.supply -= oilPicks;
    log(draft, action.player, `${p.name} took ${picks.join(' and ')}`);
    return ok(draft);
  },

  'oil/monopoly': (draft, action) => {
    if (!canPlayDev(draft, action.player, 'monopoly')) return fail('cannot play Monopoly');
    spendDev(draft, action.player, 'monopoly');
    const s = oilSlice(draft);
    const n = draft.players.length;
    const me = action.player;
    const cap = oilScale(draft).cap;
    let taken = 0;
    let moved = true;
    // One oil from each player in turn, starting with the next one, until the cap or nothing is left.
    while (moved && (s.oil[me] ?? 0) < cap) {
      moved = false;
      for (let i = 1; i < n && (s.oil[me] ?? 0) < cap; i++) {
        const q = (me + i) % n;
        if ((s.oil[q] ?? 0) > 0) {
          s.oil[q] = (s.oil[q] ?? 0) - 1;
          s.oil[me] = (s.oil[me] ?? 0) + 1;
          taken += 1;
          moved = true;
        }
      }
    }
    log(draft, me, `${playerName(draft, me)} took ${taken} oil`);
    return ok(draft);
  },

  'oil/offerTrade': (draft, action) => {
    const offer = parseTrade(draft, asOil(action) as OilAction & { type: 'oil/offerTrade' });
    if (typeof offer === 'string') return fail(offer);
    const err = tradeBlocker(draft, offer);
    // The partner may lack the goods only at accept time; the offerer must be able to pay now.
    if (err === 'the offerer cannot afford it') return fail(err);
    draft.turn.tradeOffers += 1;
    draft.phase = offer;
    log(
      draft,
      action.player,
      `${playerName(draft, action.player)} offered ${playerName(draft, offer.to)} a trade involving oil`,
    );
    return ok(draft);
  },

  'oil/acceptTrade': (draft, action) => {
    const t = draft.phase;
    if (t.kind !== 'oil/trade') return fail('no oil trade to accept');
    const trade = t as OilTradePhase;
    if (action.player !== trade.to) return fail('this offer is not for you');
    const err = tradeBlocker(draft, trade);
    if (err) return fail(err);
    const s = oilSlice(draft);
    const a = getPlayer(draft, trade.from);
    const b = getPlayer(draft, trade.to);
    a.resources = addResources(subtractResources(a.resources, trade.give), trade.want);
    b.resources = addResources(subtractResources(b.resources, trade.want), trade.give);
    s.oil[trade.from] = (s.oil[trade.from] ?? 0) - trade.giveOil + trade.wantOil;
    s.oil[trade.to] = (s.oil[trade.to] ?? 0) - trade.wantOil + trade.giveOil;
    log(draft, action.player, `${playerName(draft, trade.to)} accepted the oil trade`);
    draft.phase = { kind: 'main' };
    return ok(draft);
  },

  'oil/rejectTrade': (draft, action) => {
    const t = draft.phase;
    if (t.kind !== 'oil/trade') return fail('no oil trade to reject');
    if (action.player !== (t as OilTradePhase).to) return fail('this offer is not for you');
    log(draft, action.player, `${playerName(draft, action.player)} rejected the oil trade`);
    draft.phase = { kind: 'main' };
    return ok(draft);
  },
};

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

const yopPicks = (): [OilPick, OilPick][] => [
  ['oil', 'oil'],
  ...RESOURCES.map((r): [OilPick, OilPick] => ['oil', r]),
];

export const oilLegal: LegalGenerator = (state) => {
  const out: Action[] = [];
  const phase = state.phase;
  const p = state.turn.current;
  const s = oilSlice(state);
  const push = (a: OilAction) => out.push(a as unknown as Action);

  if (phase.kind === 'discard') {
    phase.pending.forEach((owed, q) => {
      const hand = state.players[q]?.resources;
      const oil = s.oil[q] ?? 0;
      if (owed <= 0 || !hand || oil < 1) return;
      for (let k = 0; k <= Math.min(oil, owed); k++) {
        for (const resources of discardOptions(hand, owed - k)) {
          push({ type: 'oil/discard', player: q, resources, oil: k });
        }
      }
    });
    return out;
  }
  if (phase.kind === 'oil/trade') {
    const t = phase as OilTradePhase;
    push({ type: 'oil/rejectTrade', player: t.to });
    if (tradeBlocker(state, t) === null) push({ type: 'oil/acceptTrade', player: t.to });
    return out;
  }
  if (phase.kind === 'steal') {
    for (const victim of phase.candidates) {
      push({ type: 'oil/steal', player: p, victim, oil: false });
      if ((s.oil[victim] ?? 0) > 0 && hasRoom(state, p, 1)) {
        push({ type: 'oil/steal', player: p, victim, oil: true });
      }
    }
    return out;
  }

  if (phase.kind === 'main') {
    for (const resource of RESOURCES) {
      if (convertBlocker(state, p, resource) === null)
        push({ type: 'oil/convert', player: p, resource });
    }
    if (sequesterBlocker(state, p) === null) push({ type: 'oil/sequester', player: p });
    if (state.turn.tradeOffers < MAX_TRADE_OFFERS_PER_TURN) {
      for (const q of state.players) {
        if (q.id === p) continue;
        for (const r of RESOURCES) {
          if ((s.oil[p] ?? 0) >= 1 && q.resources[r] >= 1 && hasRoom(state, q.id, 1)) {
            push({
              type: 'oil/offerTrade',
              player: p,
              to: q.id,
              giveOil: 1,
              wantOil: 0,
              give: {},
              want: { [r]: 1 },
            });
          }
          if (
            (state.players[p]?.resources[r] ?? 0) >= 1 &&
            (s.oil[q.id] ?? 0) >= 1 &&
            hasRoom(state, p, 1)
          ) {
            push({
              type: 'oil/offerTrade',
              player: p,
              to: q.id,
              giveOil: 0,
              wantOil: 1,
              give: { [r]: 1 },
              want: {},
            });
          }
        }
      }
    }
  }
  if (phase.kind === 'main' || phase.kind === 'specialBuild') {
    for (const v of buildingsOf(state, p, 'city')) {
      if (metropolisBlocker(state, p, v) === null)
        push({ type: 'oil/metropolis', player: p, vertex: v });
    }
  }
  if (canPlayDev(state, p, 'yearOfPlenty')) {
    for (const picks of yopPicks()) {
      const k = picks.filter((x) => x === 'oil').length;
      const bundle: ResourceBundle = {};
      for (const x of picks) if (x !== 'oil') bundle[x] = (bundle[x] ?? 0) + 1;
      if (hasRoom(state, p, k) && s.supply >= k && hasResources(state.bank, bundle)) {
        push({ type: 'oil/yearOfPlenty', player: p, picks });
      }
    }
  }
  if (canPlayDev(state, p, 'monopoly') && hasRoom(state, p, 1)) {
    if (state.players.some((q) => q.id !== p && (s.oil[q.id] ?? 0) > 0)) {
      push({ type: 'oil/monopoly', player: p });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

export const oilModule: ExpansionModule = {
  id: OIL,
  name: 'Oil Springs',
  players: { min: 3, max: 6 },
  terrains: {
    'oil/desertSpring': { kind: 'land', name: 'Oil spring (desert)', color: '#3a3342' },
    'oil/forestSpring': { kind: 'land', name: 'Oil spring (forest)', color: '#3a3342' },
    'oil/pastureSpring': { kind: 'land', name: 'Oil spring (pasture)', color: '#3a3342' },
  },
  maps: [OIL_FIXED19, OIL_RANDOM19, OIL_FIXED30, OIL_RANDOM30],
  scenarios: [
    {
      id: 'oil/oilSprings',
      name: 'Oil Springs',
      blurb: 'Oil, metropolises and disasters: the rulebook layout',
      players: { min: 3, max: 6 },
      maps: [OIL_FIXED19.id, OIL_FIXED30.id],
      mapFor: (n) => (n <= 4 ? OIL_FIXED19.id : OIL_FIXED30.id),
      vpToWin: 12,
    },
    {
      id: 'oil/oilSpringsVariable',
      name: 'Oil Springs (variable)',
      blurb: 'Random board with the springs placed by the variable setup',
      players: { min: 3, max: 6 },
      maps: [OIL_RANDOM19.id, OIL_RANDOM30.id],
      mapFor: (n) => (n <= 4 ? OIL_RANDOM19.id : OIL_RANDOM30.id),
      vpToWin: 12,
    },
  ],
  modes: [
    {
      id: OIL,
      name: 'Oil Springs',
      blurb: 'Use oil to grow, or sequester it to save the island',
      status: 'ready',
      expansions: [OIL],
      scenarios: ['oil/oilSprings', 'oil/oilSpringsVariable'],
      players: { min: 3, max: 6 },
    },
  ],

  init(draft) {
    const scale = oilScale(draft);
    const n = draft.players.length;
    const slice: OilSlice = {
      v: 1,
      oil: Array<number>(n).fill(0),
      sequestered: Array<number>(n).fill(0),
      supply: scale.oil,
      lost: 0,
      metropolis: {},
      marker: 0,
      destroyed: [],
      champion: null,
      usedOil: false,
      sequesteredNow: false,
    };
    draft.ext[OIL] = slice;
  },

  cloneExt(slice) {
    const s = slice as OilSlice;
    return {
      ...s,
      oil: [...s.oil],
      sequestered: [...s.sequestered],
      metropolis: { ...s.metropolis },
      destroyed: [...s.destroyed],
    } satisfies OilSlice;
  },

  actions,
  legal: oilLegal,

  overrides: {
    moveRobber: (draft, action, next): ActionResult => {
      if (isDestroyed(draft, action.hex)) return fail('the robber cannot go to a destroyed hex');
      return next(draft, action);
    },
  },

  filterLegal(state, list) {
    const s = oilSlice(state);
    const destroyed = new Set(s.destroyed);
    return list.filter((a) => {
      switch (a.type) {
        case 'moveRobber':
          return !destroyed.has(a.hex);
        // The oil variants (oil/discard, oil/steal) cover every base choice for these players.
        case 'discard':
          return (s.oil[a.player] ?? 0) < 1;
        case 'steal':
          return !(
            state.phase.kind === 'steal' &&
            state.phase.candidates.some((c) => (s.oil[c] ?? 0) > 0) &&
            hasRoom(state, a.player, 1)
          );
        default:
          return true;
      }
    });
  },

  actors(state) {
    const phase = state.phase;
    return phase.kind === 'oil/trade' ? [(phase as OilTradePhase).to] : undefined;
  },

  hooks: {
    cost: (_state, item, base) => (item === METROPOLIS ? METROPOLIS_COST : base),

    handSize: (state, player, base) => base + (oilSlice(state).oil[player] ?? 0),

    // A metropolis produces 3 resources instead of 2: the city's 2 come from the core.
    production(state, roll, owed, ctx) {
      const metro = oilSlice(state).metropolis;
      const t = topologyOf(state);
      for (const id of Object.keys(state.board.hexes) as HexId[]) {
        const hex = state.board.hexes[id];
        if (!hex || hex.token !== roll || id === ctx.blocked || !isResource(hex.terrain)) continue;
        for (const v of hexVertices(t, id)) {
          const owner = metro[v];
          const hand = owner === undefined ? undefined : owed[owner];
          if (hand) hand[hex.terrain] += 1;
        }
      }
    },

    afterProduction(draft, roll) {
      const owed = oilOwed(draft, roll);
      if (owed.every((n) => n === 0)) return undefined;
      const got = payOil(draft, owed);
      got.forEach((g, p) => {
        if (g > 0) log(draft, p, `${playerName(draft, p)} received ${g} oil`);
      });
      return undefined;
    },

    victoryPoints: (state, player) => ({ public: oilVictoryPoints(state, player) }),

    onStartTurn(draft) {
      const s = oilSlice(draft);
      s.usedOil = false;
      s.sequesteredNow = false;
    },

    afterAction,
    deferVictory: () => true,
  },
};
