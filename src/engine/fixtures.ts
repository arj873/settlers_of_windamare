/**
 * Ready-made GameStates for renderer/UI/bot work before the rules exist.
 * Built by direct state edits on the beginner board; fixtures.test.ts checks they are
 * internally consistent (distance rule, road connectivity, resource/card conservation).
 * Every function returns a fresh object, so callers may mutate it.
 */
import { RESOURCES } from './constants';
import { createGame, type PlayerConfig } from './createGame';
import { cornerVertex, sideEdge, type Corner, type Side } from './hex';
import { addResources, emptyResources } from './resources';
import type { DevCardType, GameState, PlayerId, ResourceBundle } from './types';

export const FIXTURE_PLAYERS: PlayerConfig[] = [
  { name: 'Red', color: '#d64541' },
  { name: 'Blue', color: '#3a7bd5' },
  { name: 'White', color: '#ecf0f1' },
  { name: 'Orange', color: '#f39c12' },
];

/** Game just created: beginner board, 4 players, setup phase (player 0 to place a settlement). */
export function freshGame(playerCount: 3 | 4 = 4): GameState {
  return createGame({
    seed: 'fixture',
    players: FIXTURE_PLAYERS.slice(0, playerCount),
    map: 'base',
  });
}

type Spot = [q: number, r: number, corner: Corner];
type Side3 = [q: number, r: number, side: Side];

function settle(s: GameState, p: PlayerId, [q, r, c]: Spot, kind: 'settlement' | 'city') {
  s.pieces.buildings[cornerVertex(q, r, c)] = { owner: p, kind };
}

function road(s: GameState, p: PlayerId, [q, r, side]: Side3) {
  s.pieces.roads[sideEdge(q, r, side)] = p;
}

function pl(s: GameState, p: PlayerId) {
  const player = s.players[p];
  if (!player) throw new Error(`no player ${p}`);
  return player;
}

/** Move resources from the bank to a player's hand. */
function give(s: GameState, p: PlayerId, bundle: ResourceBundle) {
  const player = pl(s, p);
  player.resources = addResources(player.resources, bundle);
  for (const r of RESOURCES) s.bank[r] -= bundle[r] ?? 0;
}

/** Move one dev card of `type` from the deck to a player. */
function giveDev(s: GameState, p: PlayerId, type: DevCardType, fresh = false) {
  const i = s.devDeck.lastIndexOf(type);
  const player = pl(s, p);
  if (i < 0) throw new Error(`cannot give ${type}`);
  s.devDeck.splice(i, 1);
  (fresh ? player.newDevCards : player.devCards)[type] += 1;
}

/**
 * Setup half done: players 0,1,2,3,3 placed (snake index 5 next = player 2, round 2).
 * Player 3's round-2 settlement already produced its starting resources.
 */
export function setupInProgressGame(): GameState {
  const s = freshGame();
  settle(s, 0, [0, -1, 'N'], 'settlement');
  road(s, 0, [0, -1, 'NE']);
  settle(s, 1, [2, -1, 'N'], 'settlement');
  road(s, 1, [2, -1, 'NW']);
  settle(s, 2, [-2, 0, 'N'], 'settlement');
  road(s, 2, [-2, 0, 'NE']);
  settle(s, 3, [2, 0, 'N'], 'settlement');
  road(s, 3, [2, 0, 'NE']);
  settle(s, 3, [-1, 1, 'SW'], 'settlement');
  road(s, 3, [-1, 1, 'W']);
  // Hexes around v(-1,1,SW): (-1,1) lumber, (-2,1) lumber, (-2,2) brick on the beginner board.
  give(s, 3, { lumber: 2, brick: 1 });
  s.turn.current = 2;
  s.phase = { kind: 'setup', index: 5, step: 'settlement', lastSettlement: null };
  s.log.push({ turn: 0, player: 3, text: 'Orange placed a settlement and a road' });
  return s;
}

/**
 * Turn 12, Blue (player 1) has rolled 8 and is in the main phase.
 * Red holds Longest Road (5 roads around hex 0,-1). White holds Largest Army (3 knights).
 * Robber sits on h:1,-1. Mix of settlements and cities, hands, and dev cards.
 */
export function midGame(): GameState {
  const s = freshGame();

  // Red: settlement + 5-road loop around h:0,-1 (Longest Road), city in the south-west.
  settle(s, 0, [0, -1, 'N'], 'settlement');
  for (const side of ['NE', 'E', 'SE', 'SW', 'W'] as const) road(s, 0, [0, -1, side]);
  settle(s, 0, [-2, 2, 'S'], 'city');
  road(s, 0, [-2, 2, 'SE']);

  // Blue: two settlements + a city on the east.
  settle(s, 1, [2, -1, 'N'], 'settlement');
  road(s, 1, [2, -1, 'NW']);
  settle(s, 1, [1, 1, 'SE'], 'city');
  road(s, 1, [1, 1, 'E']);
  road(s, 1, [1, 1, 'SE']);
  settle(s, 1, [2, -2, 'N'], 'settlement');
  road(s, 1, [2, -2, 'NW']);

  // White: city + settlement, Largest Army.
  settle(s, 2, [-2, 0, 'N'], 'city');
  road(s, 2, [-2, 0, 'NE']);
  settle(s, 2, [-1, 2, 'N'], 'settlement');
  road(s, 2, [-1, 2, 'NE']);
  pl(s, 2).knightsPlayed = 3;
  for (let i = 0; i < 3; i++) s.devDeck.splice(s.devDeck.lastIndexOf('knight'), 1);

  // Orange: two settlements.
  settle(s, 3, [2, 0, 'N'], 'settlement');
  road(s, 3, [2, 0, 'NE']);
  settle(s, 3, [-1, 1, 'SW'], 'settlement');
  road(s, 3, [-1, 1, 'W']);

  give(s, 0, { brick: 2, lumber: 1, grain: 1 });
  give(s, 1, { wool: 2, grain: 3, ore: 3, lumber: 1 });
  give(s, 2, { ore: 1, wool: 1 });
  give(s, 3, { brick: 1, lumber: 3, wool: 1, grain: 1, ore: 2 });
  giveDev(s, 1, 'knight');
  giveDev(s, 1, 'victoryPoint');
  giveDev(s, 1, 'monopoly', true);
  giveDev(s, 3, 'roadBuilding');

  s.awards = { longestRoad: 0, largestArmy: 2 };
  s.robber = 'h:1,-1';
  s.turn = { number: 12, current: 1, devCardPlayed: false, tradeOffers: 0 };
  s.dice = [5, 3];
  s.phase = { kind: 'main' };
  s.log.push(
    { turn: 11, player: 0, text: 'Red built a road' },
    { turn: 12, player: 1, text: 'Blue rolled 8' },
  );
  return s;
}

/** midGame, but Blue rolled a 7: Blue (10 cards) and Orange (8 cards) must discard. */
export function discardGame(): GameState {
  const s = midGame();
  give(s, 1, { brick: 1 }); // Blue now 10 cards
  s.dice = [3, 4];
  s.phase = { kind: 'discard', pending: [0, 5, 0, 4] };
  s.log.push({ turn: 12, player: 1, text: 'Blue rolled 7' });
  return s;
}

/** midGame, Blue played a knight before rolling and must move the robber. */
export function moveRobberGame(): GameState {
  const s = midGame();
  pl(s, 1).devCards.knight -= 1;
  pl(s, 1).knightsPlayed += 1;
  s.turn.devCardPlayed = true;
  s.phase = { kind: 'moveRobber', resume: 'preRoll' };
  s.log.push({ turn: 12, player: 1, text: 'Blue played a knight' });
  return s;
}

/** midGame, Blue offers 1 ore for 1 brick to everyone; Orange accepted, Red rejected. */
export function tradeOfferGame(): GameState {
  const s = midGame();
  const giveOre = { ...emptyResources(), ore: 1 };
  const wantBrick = { ...emptyResources(), brick: 1 };
  s.phase = {
    kind: 'trade',
    offer: {
      from: 1,
      give: giveOre,
      want: wantBrick,
      responses: ['rejected', null, 'pending', 'accepted'],
    },
  };
  return s;
}

/** Red has won: 1 settlement + 2 cities + Longest Road + 3 VP cards = 10. */
export function gameOverGame(): GameState {
  const s = midGame();
  settle(s, 0, [0, -1, 'S'], 'city');
  for (let i = 0; i < 3; i++) giveDev(s, 0, 'victoryPoint');
  // Blue's turn is over: the Monopoly bought on it is no longer "new".
  const blue = pl(s, 1);
  blue.devCards.monopoly += blue.newDevCards.monopoly;
  blue.newDevCards.monopoly = 0;
  s.turn.current = 0;
  s.winner = 0;
  s.phase = { kind: 'gameOver' };
  s.log.push({ turn: 12, player: 0, text: 'Red wins!' });
  return s;
}
