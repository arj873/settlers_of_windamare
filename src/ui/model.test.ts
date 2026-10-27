import { describe, expect, it } from 'vitest';
import type { Action, GameState, VertexId } from '../engine';
import {
  applyAction,
  cornerVertex,
  createGame,
  legalActions,
  PLAYER_COLORS,
  TOPOLOGY,
} from '../engine';
import {
  discardGame,
  freshGame,
  midGame,
  moveRobberGame as moveRobberGameState,
  tradeOfferGame,
} from '../engine/fixtures';
import { fakeLegal } from './devLegal';
import {
  availability,
  bankCardsHidden,
  bankView,
  bestRatios,
  blockReasons,
  boardPrompt,
  buildCards,
  inkFor,
  turnInfo,
  devCardRows,
  findBankTrade,
  findYearOfPlenty,
  hintFor,
  playerSummaries,
  viewerLegal,
} from './model';

const view = (viewer: number, legal: Action[], isBotTurn = false) => ({ viewer, legal, isBotTurn });

describe('availability (from legal actions only)', () => {
  it('enables nothing without legal actions', () => {
    expect(Object.values(availability([])).some(Boolean)).toBe(false);
  });

  it('enables exactly what is legal', () => {
    const av = availability([
      { type: 'rollDice', player: 1 },
      { type: 'playKnight', player: 1 },
    ]);
    expect(av.roll).toBe(true);
    expect(av.playKnight).toBe(true);
    expect(av.endTurn).toBe(false);
    expect(av.buildCity).toBe(false);
  });

  it('ignores other players legal actions via viewerLegal', () => {
    const legal: Action[] = [
      { type: 'rollDice', player: 0 },
      { type: 'endTurn', player: 1 },
    ];
    expect(viewerLegal(view(1, legal)).map((a) => a.type)).toEqual(['endTurn']);
  });

  it('does not enable a build the legal list lacks even if the hand could pay', () => {
    const s = midGame();
    // Blue holds 3 ore + 3 grain (a city), but legal says nothing -> disabled.
    expect(availability(viewerLegal(view(1, []))).buildCity).toBe(false);
    const legal = fakeLegal(s, 1);
    expect(availability(viewerLegal(view(1, legal))).buildCity).toBe(true);
  });
});

describe('bestRatios', () => {
  it('is 4:1 with no port', () => {
    const s = freshGame();
    expect(Object.values(bestRatios(s, 0))).toEqual([4, 4, 4, 4, 4]);
  });

  it('is 3:1 for everything with a generic port, 2:1 for the matching port', () => {
    const s = freshGame();
    const generic = s.board.ports.find((p) => p.kind === 'generic')!;
    s.pieces.buildings[generic.vertices[0]] = { owner: 0, kind: 'settlement' };
    expect(Object.values(bestRatios(s, 0))).toEqual([3, 3, 3, 3, 3]);

    const special = s.board.ports.find((p) => p.kind === 'ore')!;
    s.pieces.buildings[special.vertices[1]] = { owner: 0, kind: 'city' };
    const r = bestRatios(s, 0);
    expect(r.ore).toBe(2);
    expect(r.brick).toBe(3);
    // Another player is unaffected.
    expect(bestRatios(s, 1).ore).toBe(4);
  });

  it('2:1 port without a generic one leaves others at 4:1', () => {
    const s = freshGame();
    const special = s.board.ports.find((p) => p.kind === 'wool')!;
    s.pieces.buildings[special.vertices[0]] = { owner: 2, kind: 'settlement' };
    const r = bestRatios(s, 2);
    expect(r.wool).toBe(2);
    expect(r.grain).toBe(4);
  });
});

describe('legal lookups', () => {
  it('finds bank trades and order-insensitive year of plenty', () => {
    const legal: Action[] = [
      { type: 'bankTrade', player: 1, give: 'ore', receive: 'brick' },
      { type: 'playYearOfPlenty', player: 1, resources: ['brick', 'wool'] },
    ];
    expect(findBankTrade(legal, 'ore', 'brick')).toBeDefined();
    expect(findBankTrade(legal, 'brick', 'ore')).toBeUndefined();
    expect(findYearOfPlenty(legal, 'wool', 'brick')?.resources).toEqual(['brick', 'wool']);
    expect(findYearOfPlenty(legal, 'wool', 'ore')).toBeUndefined();
  });
});

describe('dev cards and players', () => {
  it('splits playable and new cards; VP cards are never playable', () => {
    const s = midGame();
    const rows = devCardRows(s, 1, [{ type: 'playKnight', player: 1 }]);
    const byType = Object.fromEntries(rows.map((r) => [r.type, r]));
    expect(byType.knight).toMatchObject({ ready: 1, fresh: 0, canPlay: true });
    expect(byType.monopoly).toMatchObject({ ready: 0, fresh: 1, canPlay: false });
    expect(byType.victoryPoint?.canPlay).toBe(false);
  });

  it('summaries show public VP only, hidden VP just for the viewer', () => {
    const s = midGame();
    const mine = playerSummaries(s, 1);
    expect(mine[1]).toMatchObject({ hiddenVp: 1, isCurrent: true });
    expect(mine[0]).toMatchObject({ hiddenVp: 0, longestRoad: true });
    expect(mine[2]).toMatchObject({ largestArmy: true, knights: 3 });
    expect(mine[1]!.publicVp).toBe(4);
  });

  it('marks players who must act (discard)', () => {
    const s = discardGame();
    const acting = playerSummaries(s, 1)
      .filter((p) => p.isActing)
      .map((p) => p.id);
    expect(acting).toEqual([1, 3]);
  });
});

describe('bank, build bar, players (redesigned HUD)', () => {
  it('bank shows counts unless bank cards are hidden (read defensively)', () => {
    const s = midGame();
    const shown = bankView(s);
    expect(shown.stacks.map((x) => x.count)).toEqual(Object.values(s.bank));
    expect(shown.devDeck).toBe(s.devDeck.length);
    expect(bankCardsHidden(s)).toBe(false);

    const flat = { ...s, settings: { ...s.settings, hideBankCards: true } };
    expect(bankView(flat).stacks.every((x) => x.count === null)).toBe(true);
    const nested = { ...s, settings: { ...s.settings, rules: { hideBankCards: true } } };
    expect(bankCardsHidden(nested)).toBe(true);
  });

  it('build cards count pieces left and only enable legal builds', () => {
    const s = freshGame();
    const av = availability([{ type: 'buildRoad', player: 0, edge: TOPOLOGY.edges[0]! }]);
    expect(buildCards(s, 0, av)).toEqual([
      { kind: 'dev', left: 25, total: 25, enabled: false },
      { kind: 'road', left: 15, total: 15, enabled: true },
      { kind: 'settlement', left: 5, total: 5, enabled: false },
      { kind: 'city', left: 4, total: 4, enabled: false },
    ]);
    s.pieces.buildings[cornerVertex(0, 0, 'N')] = { owner: 0, kind: 'city' };
    expect(buildCards(s, 0, av)[3]!.left).toBe(3);
  });

  it('dev deck total follows the map (34 on the 5-6P board)', () => {
    const s = createGame({ seed: 1, players: PLAYER_COLORS.slice(0, 6), map: 'base56' });
    expect(buildCards(s, 0, availability([]))[0]).toMatchObject({ left: 34, total: 34 });
  });

  it('summaries carry road length and the bot flag', () => {
    const s = midGame();
    const list = playerSummaries(s, 1, [true, false]);
    expect(list.map((p) => p.isBot)).toEqual([true, false, false, false]);
    expect(list[0]!.roadLength).toBeGreaterThanOrEqual(5); // Red holds Longest Road
  });

  it('picks readable text for player colours', () => {
    expect(inkFor('#ecf0f1')).toBe('dark');
    expect(inkFor('#f39c12')).toBe('dark');
    expect(inkFor('#3a7bd5')).toBe('light');
    expect(inkFor('#d64541')).toBe('light');
    expect(inkFor('rebeccapurple')).toBe('light');
  });

  it('turn info: your turn vs. someone else, without repeating the name', () => {
    const s = midGame();
    expect(turnInfo(s, view(1, [{ type: 'endTurn', player: 1 }]), null)).toMatchObject({
      player: 1,
      title: 'Your turn',
      hint: { text: 'build, trade or end your turn' },
    });
    expect(turnInfo(s, view(0, [], true), null)).toMatchObject({
      title: "Blue's turn",
      hint: { text: 'thinking…', tone: 'wait' },
    });
  });
});

describe('why a build button is disabled', () => {
  const reasons = (s: GameState, viewer: number) => {
    const av = availability(legalActions(s, viewer));
    return Object.fromEntries(
      buildCards(s, viewer, av).map((c) => [c.kind, blockReasons(s, viewer, c)]),
    );
  };

  it('shows the missing cards; nothing for what is possible', () => {
    // Blue: 2 wool, 3 grain, 3 ore, 1 lumber.
    const r = reasons(midGame(), 1);
    expect(r.road).toEqual([{ text: 'Missing 1 brick', missing: { brick: 1 } }]);
    // Blue's roads are too short for a settlement too: both reasons, cost first.
    expect(r.settlement).toEqual([
      { text: 'Missing 1 brick', missing: { brick: 1 } },
      { text: 'No legal spot (needs your road, no building next to it)' },
    ]);
    expect(r.city).toEqual([]);
    expect(r.dev).toEqual([]);
  });

  it('not your turn / roll first / finish the step first', () => {
    expect(reasons(midGame(), 0).road).toEqual([{ text: 'Not your turn' }]);
    const pre = midGame();
    pre.phase = { kind: 'preRoll' };
    expect(reasons(pre, 1).city).toEqual([{ text: 'Roll the dice first' }]);
    expect(reasons(moveRobberGameState(), 1).dev).toEqual([
      { text: 'Finish the current step first' },
    ]);
  });

  it('no pieces left, empty deck', () => {
    const s = midGame();
    expect(blockReasons(s, 1, { kind: 'road', left: 0, total: 15, enabled: false })).toEqual([
      { text: 'No roads left (all 15 placed)' },
    ]);
    s.devDeck = [];
    expect(reasons(s, 1).dev).toEqual([{ text: 'No development cards left' }]);
  });

  it('no legal spot, also when the cards are there', () => {
    const s = midGame();
    s.players[1]!.resources = { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 };
    for (const [v, b] of Object.entries(s.pieces.buildings)) {
      if (b.owner === 1) s.pieces.buildings[v as VertexId] = { owner: 1, kind: 'city' };
    }
    expect(reasons(s, 1).city).toEqual([{ text: 'No settlement to upgrade' }]);
    s.players[1]!.resources = { brick: 0, lumber: 0, wool: 5, grain: 5, ore: 0 };
    expect(reasons(s, 1).city?.map((r) => r.text)).toEqual([
      'Missing 3 ore',
      'No settlement to upgrade',
    ]);
  });
});

describe('special building phase pill', () => {
  it('names the builder and who is still to go', () => {
    const s = midGame();
    for (const p of s.players) p.resources = { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 };
    s.phase = { kind: 'specialBuild', builder: 2, owner: 1 };
    s.turn.current = 2;
    expect(turnInfo(s, view(0, [], true), null)).toMatchObject({
      title: 'Special build: White',
      next: 'then Orange, Red',
    });
    expect(turnInfo(s, view(2, [{ type: 'passSpecialBuild', player: 2 }]), null)).toMatchObject({
      title: 'Special build: you',
      hint: { text: 'Build or buy a card, then pass', tone: 'action' },
    });
    // Players who could not do anything are skipped by the engine, and so by the list.
    s.players[0]!.resources = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
    expect(turnInfo(s, view(0, []), null).next).toBe('then Orange');
    s.phase = { kind: 'specialBuild', builder: 0, owner: 1 };
    s.turn.current = 0;
    expect(turnInfo(s, view(0, []), null).next).toBe("then White's turn");
    // White builds first after Blue's turn and nobody else can: White's own turn is next.
    s.phase = { kind: 'specialBuild', builder: 2, owner: 1 };
    s.turn.current = 2;
    s.players[3]!.resources = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
    expect(turnInfo(s, view(2, []), null)).toMatchObject({
      title: 'Special build: you',
      next: 'then your turn',
    });
  });

  it('has no queue outside the phase', () => {
    expect(turnInfo(midGame(), view(1, []), null).next).toBeNull();
  });
});

describe('hints and board prompt', () => {
  it('asks to place a settlement in setup', () => {
    const s = freshGame();
    const v = view(0, [
      { type: 'placeSetupSettlement', player: 0, vertex: cornerVertex(0, 0, 'N') },
    ]);
    expect(hintFor(s, v, null)?.text).toBe('Place a settlement');
    expect(boardPrompt(v)).toBe('setupSettlement');
  });

  it('names the city when the setup step places one (C&K round 2)', () => {
    let s = createGame({ seed: 'ck-hint', players: PLAYER_COLORS.slice(0, 3), mode: 'ck' });
    // Round 1: three settlements + roads, first legal spot each.
    while (s.phase.kind === 'setup' && s.phase.index < s.players.length) {
      const a = legalActions(s)[0] as Action;
      const r = applyAction(s, a);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    const p = s.turn.current;
    const v = view(p, legalActions(s));
    expect(hintFor(s, v, null)?.text).toBe('Place a city');
    const placed = applyAction(s, legalActions(s)[0] as Action);
    if (!placed.ok) throw new Error(placed.error);
    expect(hintFor(placed.state, view(p, legalActions(placed.state)), null)?.text).toBe(
      'Place a road next to your new city',
    );
  });

  it('shows the active build mode', () => {
    const s = midGame();
    const v = view(1, [{ type: 'endTurn', player: 1 }]);
    expect(hintFor(s, v, 'city')?.text).toContain('Place a city');
    expect(boardPrompt(v)).toBeNull();
  });

  it('waits on others, naming bots', () => {
    const s = midGame();
    expect(hintFor(s, view(0, [], true), null)).toEqual({
      text: 'Blue is thinking…',
      tone: 'wait',
    });
    const t = tradeOfferGame();
    expect(hintFor(t, view(1, [{ type: 'cancelTrade', player: 1 }]), null)?.text).toMatch(
      /Waiting for trade/,
    );
  });

  it('has no hint after game over', () => {
    const s = midGame();
    s.phase = { kind: 'gameOver' };
    expect(hintFor(s, view(1, []), null)).toBeNull();
  });

  it('uses real topology ids for the fake legal list', () => {
    expect(TOPOLOGY.vertices.length).toBeGreaterThan(3);
  });
});
