/**
 * Cities & Knights strategy for the smart bots (BotExtension.score / goals, src/bots/smart).
 * Knights against the barbarians (never be the weakest when they would win; take Defender when
 * cheap), city improvements toward abilities and metropolises, walls, progress cards and every
 * C&K prompt. Reads public information and the bot's own cards only.
 */
import {
  RESOURCES,
  buildingsOf,
  costOf,
  type Action,
  type HexId,
  type Resource,
  type ResourceCounts,
  type VertexId,
} from '../../engine';
import {
  PIP_VALUE,
  ROLL,
  VP,
  baseScore,
  conflict,
  hexPips,
  hexResource,
  robberHex,
  trade,
  type BotContext,
  type BotGoal,
} from '../../bots/smart';
import {
  ABILITY_LEVEL,
  ACTIVATE_COST,
  BARBARIAN_STEPS,
  COMMODITIES,
  COMMODITY_OF,
  KNIGHT_COST,
  KNIGHTS_PER_LEVEL,
  MAX_LEVEL,
  METROPOLIS_LEVEL,
  PROMOTE_COST,
  TRACKS,
  TRACK_COMMODITY,
  WALL_COST,
  activeStrength,
  barbarianStrength,
  canChase,
  knightActionBlocker,
  ckSlice,
  defenderStrength,
  freeCities,
  giveRatio,
  isCommodity,
  knightsOf,
  levelOf,
  phaseOf,
  winsMetropolis,
  type CkAction,
  type Commodity,
  type CommodityCounts,
  type Good,
  type ProgressCard,
  type Track,
} from './engine';

const CITY_LOSS = 1.6 * VP;

interface Defense {
  /** 0.1 (barbarians far) .. 1 (they land on the next ship face). */
  urgency: number;
  cities: number;
  knights: number;
  mine: number;
  /** Weakest opponent who could lose a city (Infinity when none). */
  lowest: number;
  /** Strongest opponent. */
  top: number;
  losable: boolean;
}

function defense(ctx: BotContext): Defense {
  return ctx.memo('ck:defense', () => {
    const { state, player } = ctx;
    const s = ckSlice(state);
    let lowest = Infinity;
    let top = 0;
    for (let p = 0; p < ctx.n; p++) {
      if (p === player) continue;
      const st = activeStrength(state, p);
      top = Math.max(top, st);
      if (freeCities(state, p).length > 0) lowest = Math.min(lowest, st);
    }
    const left = BARBARIAN_STEPS - s.barbarian;
    return {
      urgency: Math.min(1, Math.max(0.1, 1 - (left - 1) * 0.15)),
      cities: barbarianStrength(state),
      knights: defenderStrength(state),
      mine: activeStrength(state, player),
      lowest,
      top,
      losable: freeCities(state, player).length > 0,
    };
  });
}

/** What `k` more active knight strength is worth against the coming attack. */
export function strengthValue(ctx: BotContext, k: number): number {
  const d = defense(ctx);
  const lose = (extra: number) =>
    d.losable && d.cities > d.knights + extra && d.mine + extra <= d.lowest ? 1 : 0;
  const defender = (extra: number) =>
    d.cities <= d.knights + extra && d.mine + extra > d.top && d.mine + extra > 0 ? 1 : 0;
  const saved = (lose(0) - lose(k)) * CITY_LOSS;
  const gain = (defender(k) - defender(0)) * VP;
  return d.urgency * (saved + gain) + 8 * k;
}

// ---------------------------------------------------------------------------
// Commodities and improvements
// ---------------------------------------------------------------------------

/** Commodity pips per type the bot's cities collect. */
function commodityPips(ctx: BotContext): CommodityCounts {
  return ctx.memo('ck:cpips', () => {
    const out: CommodityCounts = { paper: 0, cloth: 0, coin: 0 };
    for (const v of buildingsOf(ctx.state, ctx.player, 'city')) {
      for (const h of ctx.topo.vertex[v]?.hexes ?? []) {
        const r = hexResource(ctx.state, h);
        const c = r && r !== 'gold' ? COMMODITY_OF[r] : undefined;
        if (c && h !== ctx.state.robber) out[c] += hexPips(ctx.state, h);
      }
    }
    return out;
  });
}

/** The track the bot builds up: its best level, then its commodity income. */
function mainTrack(ctx: BotContext): Track {
  return ctx.memo('ck:track', () => {
    const pips = commodityPips(ctx);
    let best: Track = 'science';
    let score = -Infinity;
    for (const t of TRACKS) {
      const s = 3 * levelOf(ctx.state, ctx.player, t) + pips[TRACK_COMMODITY[t]];
      if (s > score) [best, score] = [t, s];
    }
    return best;
  });
}

function commodityValue(ctx: BotContext, c: Commodity): number {
  const t = mainTrack(ctx);
  return 14 + (TRACK_COMMODITY[t] === c ? 14 : 0);
}

/** Value of the next level of `t`. */
function improveValue(ctx: BotContext, t: Track): number {
  const level = levelOf(ctx.state, ctx.player, t) + 1;
  let v = 45 + (t === mainTrack(ctx) ? 10 : 0);
  if (level === ABILITY_LEVEL) v += t === 'science' ? 55 : 40;
  if (level >= METROPOLIS_LEVEL && winsMetropolis(ctx.state, ctx.player, t, level)) v += 2 * VP;
  const m = ckSlice(ctx.state).metropolis[t];
  if (level === MAX_LEVEL && m?.owner === ctx.player) v += 60;
  return v;
}

/** A city on `v` in C&K: production plus its commodities, and the first city unlocks a lot. */
function cityBonus(ctx: BotContext, v: VertexId): number {
  let bonus = 0;
  for (const h of ctx.topo.vertex[v]?.hexes ?? []) {
    const r = hexResource(ctx.state, h);
    if (r && r !== 'gold' && COMMODITY_OF[r]) bonus += 0.8 * PIP_VALUE * hexPips(ctx.state, h);
  }
  if (buildingsOf(ctx.state, ctx.player, 'city').length === 0) bonus += 40;
  return bonus;
}

// ---------------------------------------------------------------------------
// Progress cards
// ---------------------------------------------------------------------------

function hexesNextTo(ctx: BotContext, r: Resource): number {
  const out = new Set<HexId>();
  for (const v of buildingsOf(ctx.state, ctx.player)) {
    for (const h of ctx.topo.vertex[v]?.hexes ?? []) {
      if (ctx.state.board.hexes[h]?.terrain === r) out.add(h);
    }
  }
  return out.size;
}

function inactiveStrength(ctx: BotContext): number {
  return knightsOf(ctx.state, ctx.player).reduce((s, [, k]) => s + (k.active ? 0 : k.level), 0);
}

function richer(ctx: BotContext): number {
  let n = 0;
  for (let p = 0; p < ctx.n; p++) if (p !== ctx.player && ctx.vp(p) > ctx.vp(ctx.player)) n++;
  return n;
}

/** Value of playing `card` now (negative = keep it). */
function playValue(ctx: BotContext, card: ProgressCard): number {
  const { state, player } = ctx;
  switch (card) {
    case 'crane': {
      const t = mainTrack(ctx);
      const cost = levelOf(state, player, t) + 1;
      const have = ckSlice(state).players[player]?.commodities[TRACK_COMMODITY[t]] ?? 0;
      return have === cost - 1 && cost <= MAX_LEVEL ? 40 : -5;
    }
    case 'engineer':
      return 35;
    case 'inventor':
      return 22;
    case 'irrigation':
      return 2 * hexesNextTo(ctx, 'grain') * 15 - 5;
    case 'mining':
      return 2 * hexesNextTo(ctx, 'ore') * 15 - 5;
    case 'medicine': {
      const spot = ctx.bestCitySpot();
      const h = ctx.hand;
      return spot && h.ore >= 2 && h.grain >= 1 ? spot.value + 10 : -5;
    }
    case 'roadBuilding':
      return (baseScore(ctx, { type: 'playRoadBuilding', player }) ?? 0) - 10;
    case 'smith':
      return 2 * 20;
    case 'bishop':
      return 30;
    case 'deserter':
      return 35;
    case 'diplomat':
      return 8;
    case 'intrigue':
      return 20;
    case 'saboteur': {
      let n = 0;
      for (let p = 0; p < ctx.n; p++) {
        if (p !== player && ctx.vp(p) >= ctx.vp(player) && ctx.cards(p) >= 4) n++;
      }
      return 15 * n - 5;
    }
    case 'spy':
      return 25;
    case 'warlord':
      return inactiveStrength(ctx) > 0 ? strengthValue(ctx, inactiveStrength(ctx)) + 5 : -5;
    case 'wedding':
      return 25 * richer(ctx) - 5;
    case 'commercialHarbor':
      return 20;
    case 'masterMerchant':
      return 35;
    case 'merchant':
      return 90;
    case 'merchantFleet':
      return 12;
    case 'resourceMonopoly':
      return 10 * 2 * (ctx.n - 1) - 10;
    case 'tradeMonopoly':
      return 10 * (ctx.n - 1);
    default:
      return -10;
  }
}

/** Value of keeping `card` in hand (for discards and the Spy). */
function keepValue(ctx: BotContext, card: ProgressCard): number {
  if (card === 'alchemist') return 30;
  return Math.max(10, playValue(ctx, card));
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

function goodsScore(
  ctx: BotContext,
  give: Partial<Record<Good, number>>,
  get: Partial<Record<Good, number>>,
): number {
  const res = (b: Partial<Record<Good, number>>) => {
    const out: Partial<ResourceCounts> = {};
    for (const r of RESOURCES) if (b[r]) out[r] = b[r];
    return out;
  };
  const own = ckSlice(ctx.state).players[ctx.player]?.commodities;
  let score = trade(ctx, res(give), res(get));
  for (const c of COMMODITIES) {
    if ((give[c] ?? 0) > (own?.[c] ?? 0)) return -100;
    score += ((get[c] ?? 0) - (give[c] ?? 0)) * commodityValue(ctx, c);
  }
  return score;
}

function alchemist(ctx: BotContext, sum: number, red: number): number {
  if (sum === 7) return -20;
  const gain = (n: number) => {
    let g = 0;
    for (const [v, b] of Object.entries(ctx.state.pieces.buildings)) {
      for (const h of ctx.topo.vertex[v as VertexId]?.hexes ?? []) {
        if (ctx.state.board.hexes[h]?.token !== n || h === ctx.state.robber) continue;
        const k = b.kind === 'city' ? 2 : 1;
        g += b.owner === ctx.player ? k : -0.3 * k;
      }
    }
    return g;
  };
  let expected = 0;
  for (let n = 2; n <= 12; n++) expected += ((6 - Math.abs(7 - n)) / 36) * gain(n);
  return ROLL - 10 + 15 * (gain(sum) - expected) + (6 - red);
}

function inventorHex(ctx: BotContext, h: HexId, first: HexId | null): number {
  let mine = 0;
  let theirs = 0;
  for (const v of ctx.topo.hex[h]?.vertices ?? []) {
    const b = ctx.state.pieces.buildings[v];
    if (!b) continue;
    const k = b.kind === 'city' ? 2 : 1;
    if (b.owner === ctx.player) mine += k;
    else theirs += k;
  }
  const pips = hexPips(ctx.state, h);
  // First pick: a good number we do not use; second: our hex with a poor number.
  if (first === null) return pips * (theirs + 1 - 3 * mine);
  return mine * (6 - pips) - theirs;
}

function prompt(ctx: BotContext, a: CkAction): number | null {
  const phase = phaseOf(ctx.state);
  const { state, player } = ctx;
  switch (phase.kind) {
    case 'ck/pillage':
      return a.type === 'ck/pickVertex' ? -ctx.cityValue(a.vertex) : null;
    case 'ck/defender':
      return a.type === 'ck/pickTrack' ? 10 * levelOf(state, player, a.track) : null;
    case 'ck/progressDiscard':
      return a.type === 'ck/pickCard' ? -keepValue(ctx, a.card) : null;
    case 'ck/aqueduct':
      return a.type === 'ck/pickGood' && !isCommodity(a.good)
        ? trade(ctx, {}, { [a.good]: 1 })
        : null;
    case 'ck/metropolis':
    case 'ck/relocate':
      return a.type === 'ck/pickVertex' ? ctx.vertexValue(a.vertex) : null;
    case 'ck/knight':
      // Moving and displacing knights: rarely worth a command for the bot.
      return a.type === 'ck/pickVertex' ? -5 : null;
    case 'ck/card':
      break;
    default:
      return null;
  }
  if (phase.kind !== 'ck/card') return null;
  const knightAt = (v: VertexId) => ckSlice(state).knights[v];
  switch (phase.card) {
    case 'inventor':
      return a.type === 'ck/pickHex' ? inventorHex(ctx, a.hex, phase.first) : null;
    case 'engineer':
    case 'medicine':
      return a.type === 'ck/pickVertex' ? ctx.cityValue(a.vertex) : null;
    case 'smith':
      if (a.type === 'ck/done') return 0;
      return a.type === 'ck/pickVertex' ? 5 + 5 * (knightAt(a.vertex)?.active ? 1 : 0) : null;
    case 'bishop':
      return a.type === 'ck/pickHex' ? robberHex(ctx, a.hex) : null;
    case 'intrigue':
      return a.type === 'ck/pickVertex'
        ? 10 * ctx.threat(knightAt(a.vertex)?.owner ?? player)
        : null;
    case 'merchant':
      return a.type === 'ck/pickHex' ? merchantHex(ctx, a.hex) : null;
    case 'merchantFleet':
      return a.type === 'ck/pickGood' ? 5 * goodHeld(ctx, a.good) : null;
    case 'resourceMonopoly':
      return a.type === 'ck/pickGood' && !isCommodity(a.good)
        ? trade(ctx, {}, { [a.good]: 2 * (ctx.n - 1) }) * 0.5 + ctx.rng.float()
        : null;
    case 'tradeMonopoly':
      return a.type === 'ck/pickGood' && isCommodity(a.good) ? commodityValue(ctx, a.good) : null;
    case 'deserter':
      if (a.type === 'ck/pickPlayer') return 10 * ctx.threat(a.target);
      if (a.type === 'ck/done') return -1;
      if (a.type !== 'ck/pickVertex') return null;
      // The victim removes its weakest knight; the player then places one wherever it is worth most.
      if (phase.victim === player && phase.removed === null)
        return -(knightAt(a.vertex)?.level ?? 0);
      return ctx.vertexValue(a.vertex);
    case 'diplomat':
      if (a.type === 'ck/done') return 0;
      if (a.type !== 'ck/pickEdge') return null;
      if (phase.removed === null) {
        const owner = state.pieces.roads[a.edge];
        return owner === undefined || owner === player ? -20 : 10 * ctx.threat(owner);
      }
      return ctx.roadToSpotValue(a.edge);
    case 'spy':
      if (a.type === 'ck/pickPlayer') return 10 * ctx.threat(a.target);
      return a.type === 'ck/pickCard' ? keepValue(ctx, a.card) : null;
    case 'masterMerchant':
      if (a.type === 'ck/pickPlayer') return 10 * ctx.threat(a.target);
      return a.type === 'ck/pickGood' ? goodsScore(ctx, {}, { [a.good]: 1 }) : null;
    case 'commercialHarbor': {
      if (a.type === 'ck/done') return 0;
      if (a.type !== 'ck/pickGood') return null;
      // The player offers a resource; the opponent answers with its least useful commodity.
      if (phase.offered === null) return goodsScore(ctx, { [a.good]: 1 }, {}) + 20;
      return isCommodity(a.good) ? -commodityValue(ctx, a.good) : null;
    }
  }
  return null;
}

function goodHeld(ctx: BotContext, g: Good): number {
  if (isCommodity(g)) return ckSlice(ctx.state).players[ctx.player]?.commodities[g] ?? 0;
  return ctx.hand[g];
}

function merchantHex(ctx: BotContext, h: HexId): number {
  const r = hexResource(ctx.state, h);
  if (!r || r === 'gold') return 0;
  return ctx.production(ctx.player)[r] + hexPips(ctx.state, h);
}

function knightSpot(ctx: BotContext, v: VertexId): number {
  // Next to the robber (to chase it) or to the bot's own best hexes.
  let score = 0;
  for (const h of ctx.topo.vertex[v]?.hexes ?? []) {
    if (h === ctx.state.robber) score += 6;
    score += 0.3 * hexPips(ctx.state, h);
  }
  return score;
}

function robberOnMine(ctx: BotContext): boolean {
  return (ctx.topo.hex[ctx.state.robber]?.vertices ?? []).some(
    (v) => ctx.state.pieces.buildings[v]?.owner === ctx.player,
  );
}

export function ckScore(ctx: BotContext, action: Action): number | null {
  const { state, player } = ctx;
  const a = action as unknown as CkAction;
  switch (action.type) {
    case 'buildCity':
      if (action.type !== 'buildCity') return null;
      return (baseScore(ctx, action) ?? 0) + cityBonus(ctx, action.vertex);
    case 'placeSetupSettlement': {
      if (action.type !== 'placeSetupSettlement') return null;
      let bonus = 0;
      for (const h of ctx.topo.vertex[action.vertex]?.hexes ?? []) {
        const r = hexResource(state, h);
        if (r && r !== 'gold' && COMMODITY_OF[r]) bonus += 3 * hexPips(state, h);
      }
      return (baseScore(ctx, action) ?? 0) + bonus;
    }
  }
  switch (a.type) {
    case 'ck/buildKnight': {
      const placed = knightsOf(state, player).length;
      if (placed >= 3 * KNIGHTS_PER_LEVEL) return -5;
      return (
        20 +
        0.5 * strengthValue(ctx, 1) +
        knightSpot(ctx, a.vertex) -
        conflict(ctx, 'ck/knight', KNIGHT_COST)
      );
    }
    case 'ck/activateKnight': {
      const k = ckSlice(state).knights[a.vertex];
      return 5 + strengthValue(ctx, k?.level ?? 1) - conflict(ctx, 'ck/activate', ACTIVATE_COST);
    }
    case 'ck/promoteKnight': {
      const k = ckSlice(state).knights[a.vertex];
      const v = k?.active ? strengthValue(ctx, 1) + 12 : 0.5 * strengthValue(ctx, 1) + 8;
      return v - conflict(ctx, 'ck/knight', PROMOTE_COST);
    }
    case 'ck/selectKnight':
      // Only to chase the robber off the bot's own hex (activate / promote are direct actions).
      return robberOnMine(ctx) &&
        canChase(state, player, a.vertex) &&
        knightActionBlocker(state, player, a.vertex) === null
        ? ROLL + 15
        : -20;
    case 'ck/chaseRobber':
      return 70;
    case 'ck/cancel':
      return 0;
    case 'ck/buildWall': {
      const cities = buildingsOf(state, player, 'city').length;
      return 18 + 4 * cities - conflict(ctx, 'ck/wall', WALL_COST);
    }
    case 'ck/improve':
      return improveValue(ctx, a.track);
    case 'ck/play':
      return playValue(ctx, a.card);
    case 'ck/alchemist':
      return alchemist(ctx, a.yellow + a.red, a.red);
    case 'ck/discardProgress':
      return -keepValue(ctx, a.card);
    case 'ck/bankTrade': {
      const ratio = giveRatio(state, player, a.give);
      return goodsScore(ctx, { [a.give]: ratio }, { [a.receive]: 1 }) - 1;
    }
    case 'ck/offerTrade':
      return -10;
    case 'ck/discard': {
      const lost: Partial<Record<Good, number>> = { ...a.resources, ...a.commodities };
      return goodsScore(ctx, lost, {});
    }
  }
  if (action.type.startsWith('ck/')) return prompt(ctx, a);
  return null;
}

/** Knights and walls to save for (cities get their commodity value through `ckScore`). */
export function ckGoals(ctx: BotContext): BotGoal[] {
  const { state, player } = ctx;
  const out: BotGoal[] = [];
  const knights = knightsOf(state, player);
  if (knights.length < 2 * KNIGHTS_PER_LEVEL) {
    out.push({ id: 'ck/knight', cost: KNIGHT_COST, value: 20 + 0.5 * strengthValue(ctx, 1) });
  }
  const sleeping = knights.find(([, k]) => !k.active);
  if (sleeping) {
    out.push({
      id: 'ck/activate',
      cost: ACTIVATE_COST,
      value: strengthValue(ctx, sleeping[1].level),
    });
  }
  // A city is worth more here (commodities): the same goal id, so building it is never a conflict.
  const city = ctx.bestCitySpot();
  if (city && ctx.left('city') > 0) {
    out.push({
      id: 'city',
      cost: costOf(state, 'city'),
      value: city.value + cityBonus(ctx, city.vertex),
    });
  }
  // Commodities are not resources: they stay out of goals (commodityValue prices them).
  return out;
}
