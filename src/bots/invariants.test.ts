import { describe, expect, it } from 'vitest';
import { TOPOLOGY, vertexNeighbors, type EdgeId, type GameState, type VertexId } from '../engine';
import {
  discardGame,
  freshGame,
  gameOverGame,
  midGame,
  moveRobberGame,
  setupInProgressGame,
  tradeOfferGame,
} from '../engine/fixtures';
import { checkInvariants, longestRoadLength, type ViolationCode } from './invariants';

const FIXTURES = {
  freshGame,
  setupInProgressGame,
  midGame,
  discardGame,
  moveRobberGame,
  tradeOfferGame,
  gameOverGame,
};

const codes = (s: GameState): ViolationCode[] => [
  ...new Set(checkInvariants(s).map((v) => v.code)),
];

/** Apply `break_` to a fresh midGame and expect exactly `code` to be reported. */
function expectOnly(code: ViolationCode, break_: (s: GameState) => void, base = midGame) {
  const s = base();
  break_(s);
  expect(codes(s)).toEqual([code]);
}

describe('checkInvariants on healthy fixtures', () => {
  for (const [name, make] of Object.entries(FIXTURES)) {
    it(`${name} has no violations`, () => {
      expect(checkInvariants(make())).toEqual([]);
    });
  }
});

describe('checkInvariants on deliberately broken states', () => {
  it('resource conservation: extra card in a hand', () => {
    expectOnly('resource-conservation', (s) => void (s.players[0]!.resources.ore += 1));
  });
  it('resource conservation: negative bank', () => {
    expectOnly('resource-conservation', (s) => {
      s.bank.brick = -1;
      s.players[0]!.resources.brick += 1 + s.bank.brick + 1; // keep the sum at 19
    });
  });
  it('dev cards: deck card vanished', () => {
    expectOnly('dev-conservation', (s) => void s.devDeck.splice(s.devDeck.indexOf('knight'), 1));
  });
  it('dev cards: knight count inflated by played knights', () => {
    expectOnly('dev-conservation', (s) => void (s.players[3]!.knightsPlayed += 1));
  });
  it('dev cards: a progress card is exact too: it may move deck -> played, never vanish', () => {
    const s = midGame();
    s.devDeck.splice(s.devDeck.indexOf('monopoly'), 1);
    expect(codes(s)).toEqual(['dev-conservation']);
    s.players[0]!.progressCardsPlayed.monopoly += 1;
    expect(codes(s)).toEqual([]);
    s.players[0]!.progressCardsPlayed.yearOfPlenty += 1;
    expect(codes(s)).toEqual(['dev-conservation']);
  });
  it('dev cards: negative played count', () => {
    expectOnly('dev-conservation', (s) => {
      s.players[0]!.progressCardsPlayed.roadBuilding = -1;
      s.devDeck.push('roadBuilding');
    });
  });
  it('piece limit: 6 settlements', () => {
    const s = midGame();
    // Red gets 6 settlements on far-apart vertices; adjacency is allowed to fire as well.
    const spots: VertexId[] = [
      'v:0,-2,N',
      'v:1,-2,N',
      'v:2,-2,S',
      'v:-2,2,N',
      'v:-1,2,S',
      'v:0,2,S',
    ];
    for (const v of spots) s.pieces.buildings[v] = { owner: 0, kind: 'settlement' };
    expect(codes(s)).toContain('piece-limit');
  });
  it('piece limit: 16 roads', () => {
    const s = midGame();
    const free = TOPOLOGY.edges.filter((e) => s.pieces.roads[e as EdgeId] === undefined);
    for (const e of free.slice(0, 10)) s.pieces.roads[e as EdgeId] = 0;
    expect(codes(s)).toContain('piece-limit');
  });
  it('adjacent buildings', () => {
    const s = midGame();
    const v = Object.keys(s.pieces.buildings)[0] as VertexId;
    s.pieces.buildings[vertexNeighbors(v)[0]!] = { owner: 3, kind: 'settlement' };
    expect(codes(s)).toContain('building-adjacent');
  });
  it('disconnected road', () => {
    expectOnly('road-disconnected', (s) => {
      s.pieces.roads['e:-1,-2,E'] = 3; // nowhere near Orange
    });
  });
  it('robber in the sea', () => {
    expectOnly('robber-position', (s) => void (s.robber = 'h:0,-3'));
  });
  it('award held below threshold', () => {
    expectOnly('award-mismatch', (s) => {
      s.players[2]!.knightsPlayed = 2;
      s.devDeck.push('knight'); // keep knights conserved
    });
  });
  it('unique longest road not awarded', () => {
    expectOnly('award-mismatch', (s) => void (s.awards.longestRoad = null));
  });
  it('award holder that is not a player', () => {
    const s = midGame();
    s.awards.largestArmy = 9;
    expect(codes(s)).toContain('award-holder');
  });
  it('winner without gameOver', () => {
    expectOnly('winner', (s) => void (s.winner = 1));
  });
  it('gameOver with a winner below the VP target', () => {
    expectOnly('winner', (s) => void (s.settings.vpToWin = 12), gameOverGame);
  });
  it('current player already at vpToWin but game continues', () => {
    expectOnly('winner', (s) => void (s.settings.vpToWin = 3));
  });
  it('phase/actor: setup current player does not match snake order', () => {
    expectOnly('phase-actor', (s) => void (s.turn.current = 0), setupInProgressGame);
  });
  it('phase/actor: discard with nothing pending', () => {
    expectOnly('phase-actor', (s) => void (s.phase = { kind: 'discard', pending: [0, 0, 0, 0] }));
  });
  it('phase/actor: discard more than the hand', () => {
    expectOnly('phase-actor', (s) => void (s.phase = { kind: 'discard', pending: [0, 99, 0, 0] }));
  });
  it('phase/actor: steal candidate with no cards', () => {
    const s = midGame();
    s.players[2]!.resources = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
    s.bank.ore += 1;
    s.bank.wool += 1;
    s.phase = { kind: 'steal', candidates: [2], resume: 'main' };
    expect(codes(s)).toEqual(['phase-actor']);
  });
  it('phase/actor: the thief listed as steal candidate', () => {
    expectOnly(
      'phase-actor',
      (s) => void (s.phase = { kind: 'steal', candidates: [1], resume: 'main' }),
    );
  });
  it('phase/actor: trade where the offerer also has a response', () => {
    expectOnly(
      'phase-actor',
      (s) => {
        if (s.phase.kind === 'trade') s.phase.offer.responses[1] = 'pending';
      },
      tradeOfferGame,
    );
  });
  it('phase/actor: turn.number 0 outside setup', () => {
    expectOnly('phase-actor', (s) => void (s.turn.number = 0));
  });
});

describe('longestRoadLength', () => {
  it('counts Red’s 5-road loop in midGame, and an opponent building cuts it', () => {
    const s = midGame();
    expect(longestRoadLength(s, 0)).toBe(5);
    expect(longestRoadLength(s, 3)).toBe(1);
    // Put an opponent settlement mid-chain: Red's chain around h:0,-1 splits.
    s.pieces.buildings['v:0,-1,S'] = { owner: 1, kind: 'settlement' };
    expect(longestRoadLength(s, 0)).toBeLessThan(5);
  });
});
