/* eslint-disable @typescript-eslint/no-non-null-assertion -- dev fixtures, topology is never empty */
/**
 * Dev-page only: hand-built legal-action lists so every HUD panel can be seen before the rules
 * engine lands. NOT the engine's legalActions — samples are enough to enable the controls.
 */
import {
  actingPlayers,
  getPlayer,
  hasResources,
  RESOURCES,
  TOPOLOGY,
  COSTS,
  type Action,
  type GameState,
  type PlayerId,
  type Resource,
} from '../engine';
import { bestRatios } from './model';

function sampleBundle(
  hand: Record<Resource, number>,
  n: number,
): Partial<Record<Resource, number>> {
  const out: Partial<Record<Resource, number>> = {};
  let left = n;
  for (const r of RESOURCES) {
    const take = Math.min(hand[r], left);
    if (take > 0) out[r] = take;
    left -= take;
  }
  return out;
}

export function fakeLegal(state: GameState, viewer: PlayerId): Action[] {
  if (!actingPlayers(state).includes(viewer)) return [];
  const me = getPlayer(state, viewer);
  const phase = state.phase;
  const out: Action[] = [];
  const player = viewer;
  const vertices = TOPOLOGY.vertices.slice(0, 3);
  const edges = TOPOLOGY.edges.slice(0, 3);

  switch (phase.kind) {
    case 'setup':
      if (phase.step === 'settlement') {
        for (const vertex of vertices) out.push({ type: 'placeSetupSettlement', player, vertex });
      } else {
        for (const edge of edges) out.push({ type: 'placeSetupRoad', player, edge });
      }
      break;
    case 'preRoll':
      out.push({ type: 'rollDice', player });
      break;
    case 'main': {
      out.push({ type: 'endTurn', player });
      const can = (cost: Parameters<typeof hasResources>[1]) => hasResources(me.resources, cost);
      if (can(COSTS.road)) out.push({ type: 'buildRoad', player, edge: edges[0]! });
      if (can(COSTS.settlement))
        out.push({ type: 'buildSettlement', player, vertex: vertices[0]! });
      if (can(COSTS.city)) out.push({ type: 'buildCity', player, vertex: vertices[0]! });
      if (can(COSTS.devCard)) out.push({ type: 'buyDevCard', player });
      break;
    }
    case 'discard': {
      const n = phase.pending[viewer] ?? 0;
      if (n > 0) out.push({ type: 'discard', player, resources: sampleBundle(me.resources, n) });
      break;
    }
    case 'moveRobber':
      for (const id of TOPOLOGY.landHexes.slice(0, 3)) {
        out.push({ type: 'moveRobber', player, hex: id });
      }
      break;
    case 'steal':
      for (const victim of phase.candidates) out.push({ type: 'steal', player, victim });
      break;
    case 'roadBuilding':
      out.push({ type: 'placeFreeRoad', player, edge: edges[0]! });
      break;
    case 'trade': {
      const offer = phase.offer;
      if (offer.from === viewer) {
        out.push({ type: 'cancelTrade', player });
        offer.responses.forEach((r, partner) => {
          if (r === 'accepted') out.push({ type: 'confirmTrade', player, partner });
        });
      } else if (offer.responses[viewer] === 'pending') {
        out.push({ type: 'rejectTrade', player });
        if (hasResources(me.resources, offer.want)) out.push({ type: 'acceptTrade', player });
      }
      break;
    }
    case 'gameOver':
      break;
  }

  // Dev cards: any phase where a play is allowed (preRoll / main), once per turn.
  if ((phase.kind === 'preRoll' || phase.kind === 'main') && !state.turn.devCardPlayed) {
    if (me.devCards.knight > 0) out.push({ type: 'playKnight', player });
    if (me.devCards.roadBuilding > 0) out.push({ type: 'playRoadBuilding', player });
    if (me.devCards.yearOfPlenty > 0) {
      for (let i = 0; i < RESOURCES.length; i++) {
        for (let j = i; j < RESOURCES.length; j++) {
          out.push({
            type: 'playYearOfPlenty',
            player,
            resources: [RESOURCES[i]!, RESOURCES[j]!],
          });
        }
      }
    }
    if (me.devCards.monopoly > 0) {
      for (const resource of RESOURCES) out.push({ type: 'playMonopoly', player, resource });
    }
  }

  if (phase.kind === 'main') {
    // Bank trades at the viewer's best ratio, 1:1 player offers.
    const ratios = bestRatios(state, viewer);
    for (const give of RESOURCES) {
      if (me.resources[give] < ratios[give]) continue;
      for (const receive of RESOURCES) {
        if (receive !== give) out.push({ type: 'bankTrade', player, give, receive });
      }
    }
    const others = state.players.map((p) => p.id).filter((p) => p !== viewer);
    const giveR = RESOURCES.find((r) => me.resources[r] > 0);
    if (giveR) {
      out.push({
        type: 'offerTrade',
        player,
        give: { [giveR]: 1 },
        want: { [RESOURCES.find((r) => r !== giveR) ?? 'ore']: 1 },
        to: others,
      });
    }
  }
  return out;
}
