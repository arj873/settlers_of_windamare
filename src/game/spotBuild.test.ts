import { describe, expect, it } from 'vitest';
import { legalActions, type Action, type GameState } from '../engine';
import { createRandomBot } from '../bots';
import { newGame, randomSource, runGame } from '../bots/runner';
import '../ui/expansions'; // registers the module build cards (setBoardExtensions)
import {
  clickTargets,
  locationOf,
  resolveClick,
  spotBuildActions,
  type BoardClick,
  type ClickTargets,
} from './logic';

const RICH = { brick: 9, lumber: 9, wool: 9, grain: 9, ore: 9 };

/** `s` with its current player able to afford anything. */
const rich = (s: GameState): GameState => {
  const p = s.turn.current;
  return { ...s, players: s.players.map((x) => (x.id === p ? { ...x, resources: RICH } : x)) };
};

const clickOn = (a: Action): BoardClick => locationOf(a) as BoardClick;

/** Action types per board spot. */
function typesBySpot(actions: readonly Action[]): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const a of actions) {
    const at = locationOf(a);
    if (at) by.set(at.id, [...(by.get(at.id) ?? []), a.type]);
  }
  return by;
}

/**
 * Bot-play a 3-player game of `mode` (seed 1) until `want` holds for some state (made rich in
 * the main phase); deterministic, stops at the first match.
 */
function stateWhere(
  mode: string,
  scenario: string | undefined,
  want: (s: GameState) => boolean,
): GameState {
  let found: GameState | null = null;
  const bot = randomSource(createRandomBot({ progressBias: 0.5 }), 'spot-tests');
  runGame({
    initial: newGame({ seed: 1, players: 3, mode, ...(scenario ? { scenario } : {}) }),
    maxSteps: 4000,
    source: (ctx) => (found ? null : bot(ctx)),
    onStep: ({ state }) => {
      if (found) return;
      const s = state.phase.kind === 'main' ? rich(state) : state;
      if (want(s)) found = s;
    },
  });
  if (!found) throw new Error(`no matching state in ${mode}`);
  return found;
}

/** Main-phase state whose current player has a spot taking all of `types`. */
const mainWithSpot = (mode: string, scenario: string | undefined, types: readonly string[]) =>
  stateWhere(
    mode,
    scenario,
    (s) =>
      s.phase.kind === 'main' &&
      [...typesBySpot(spotBuildActions(legalActions(s), s.turn.current)).values()].some((t) =>
        types.every((x) => t.includes(x)),
      ),
  );

/** The first spot of the current player taking all of `types`, as a click. */
function spotWith(actions: readonly Action[], types: readonly string[]): BoardClick {
  const id = [...typesBySpot(actions)].find(([, list]) =>
    types.every((x) => list.includes(x)),
  )?.[0];
  const a = actions.find((x) => locationOf(x)?.id === id);
  if (!a) throw new Error(`no spot with ${types.join(' + ')}`);
  return clickOn(a);
}

describe('resolveClick (pure)', () => {
  const road = { type: 'buildRoad', player: 0, edge: 'e:0,0,NE' } as Action;
  const ship = { type: 'seafarers/buildShip', player: 0, edge: 'e:0,0,NE' } as unknown as Action;
  const town = { type: 'buildSettlement', player: 0, vertex: 'v:0,0,N' } as Action;
  const spot = (actions: Action[]): ClickTargets => ({ actions, spot: true });
  const direct = (actions: Action[]): ClickTargets => ({ actions, spot: false });

  it('nothing at the spot: none', () => {
    expect(resolveClick(spot([road]), { kind: 'edge', id: 'e:1,0,E' }, true)).toEqual({
      kind: 'none',
    });
  });

  it('one build-anywhere action: confirm when the setting is on, else act', () => {
    expect(resolveClick(spot([road, town]), clickOn(road), true)).toEqual({
      kind: 'choose',
      choices: [road],
    });
    expect(resolveClick(spot([road, town]), clickOn(road), false)).toEqual({
      kind: 'act',
      action: road,
    });
  });

  it('several types at the spot always ask, setting on or off, prompt or mode', () => {
    for (const confirm of [true, false]) {
      expect(resolveClick(spot([road, ship]), clickOn(road), confirm)).toEqual({
        kind: 'choose',
        choices: [road, ship],
      });
      expect(resolveClick(direct([road, ship]), clickOn(road), confirm)).toEqual({
        kind: 'choose',
        choices: [road, ship],
      });
    }
  });

  it('prompts and build modes act at once on a single type; duplicates keep the first', () => {
    const other = { ...road, extra: 1 } as unknown as Action;
    expect(resolveClick(direct([road, other]), clickOn(road), true)).toEqual({
      kind: 'act',
      action: road,
    });
  });
});

describe('clickTargets / spotBuildActions: base game', () => {
  // A bot game in the main phase where the (rich) current player can place a settlement too.
  const s = mainWithSpot('base', undefined, ['buildSettlement']);
  const legal = legalActions(s);
  const p = s.turn.current;

  it('without a mode: every road, settlement and city spot of the viewer', () => {
    const t = clickTargets(legal, p, null);
    expect(t.spot).toBe(true);
    const types = new Set(t.actions.map((a) => a.type));
    expect(types).toEqual(new Set(['buildRoad', 'buildSettlement', 'buildCity']));
    expect(t.actions.every((a) => a.player === p)).toBe(true);
    // Everything listed is legal (the engine contract: the prompt never offers a rejected move).
    const keys = new Set(legal.map((a) => JSON.stringify(a)));
    expect(t.actions.every((a) => keys.has(JSON.stringify(a)))).toBe(true);
  });

  it('empty vertex -> settlement, own settlement -> city, edge -> road', () => {
    const t = clickTargets(legal, p, null);
    const own = Object.entries(s.pieces.buildings).find(
      ([, b]) => b.owner === p && b.kind === 'settlement',
    )![0];
    const city = resolveClick(t, { kind: 'vertex', id: own as never }, true);
    expect(city).toEqual({
      kind: 'choose',
      choices: [{ type: 'buildCity', player: p, vertex: own }],
    });
    const town = t.actions.find((a) => a.type === 'buildSettlement')!;
    expect(resolveClick(t, clickOn(town), true)).toEqual({ kind: 'choose', choices: [town] });
    const road = t.actions.find((a) => a.type === 'buildRoad')!;
    expect(resolveClick(t, clickOn(road), true)).toEqual({ kind: 'choose', choices: [road] });
  });

  it('a build mode limits the targets to its type and is not build-anywhere', () => {
    const t = clickTargets(legal, p, 'city');
    expect(t.spot).toBe(false);
    expect(new Set(t.actions.map((a) => a.type))).toEqual(new Set(['buildCity']));
  });

  it('other players and non-board actions are never targets', () => {
    expect(clickTargets(legal, (p + 1) % s.players.length, null).actions).toEqual([]);
  });

  it('prompts win over build-anywhere (setup placement)', () => {
    const fresh = newGame({ seed: 1, players: 3 });
    const t = clickTargets(legalActions(fresh), fresh.turn.current, null);
    expect(t.spot).toBe(false);
    expect(new Set(t.actions.map((a) => a.type))).toEqual(new Set(['placeSetupSettlement']));
  });
});

describe('spot choices in expansions', () => {
  it('Seafarers: a coast edge offers road and ship', () => {
    const s = mainWithSpot('seafarers', 'seafarers/newShores', [
      'buildRoad',
      'seafarers/buildShip',
    ]);
    const t = clickTargets(legalActions(s), s.turn.current, null);
    const out = resolveClick(t, spotWith(t.actions, ['buildRoad', 'seafarers/buildShip']), true);
    expect(out.kind).toBe('choose');
    if (out.kind === 'choose') {
      expect(out.choices.map((a) => a.type)).toEqual(['buildRoad', 'seafarers/buildShip']);
    }
    // "Move ship" (pick up a ship) is a build card too: own ships are spots.
    expect(t.actions.some((a) => a.type === 'seafarers/pickShip')).toBe(
      legalActions(s).some((a) => a.type === 'seafarers/pickShip' && a.player === s.turn.current),
    );
  });

  it('Seafarers setup: a coast edge asks road or ship (both implied prompts)', () => {
    const s = stateWhere(
      'seafarers',
      'seafarers/newShores',
      (x) =>
        x.phase.kind === 'setup' &&
        [...typesBySpot(clickTargets(legalActions(x), x.turn.current, null).actions).values()].some(
          (t) => t.includes('placeSetupRoad') && t.includes('seafarers/placeSetupShip'),
        ),
    );
    const t = clickTargets(legalActions(s), s.turn.current, null);
    expect(t.spot).toBe(false);
    const out = resolveClick(
      t,
      spotWith(t.actions, ['placeSetupRoad', 'seafarers/placeSetupShip']),
      false,
    );
    expect(out.kind).toBe('choose');
    // A land-only edge still places the road at once.
    const inland = [...typesBySpot(t.actions)].find(([, list]) => list.length === 1);
    if (inland) {
      const a = t.actions.find((x) => locationOf(x)?.id === inland[0])!;
      expect(resolveClick(t, clickOn(a), true)).toEqual({ kind: 'act', action: a });
    }
  });

  it('C&K: an empty vertex offers settlement and knight; walls and knights are spot builds', () => {
    const s = mainWithSpot('ck', undefined, ['buildSettlement', 'ck/buildKnight']);
    const t = clickTargets(legalActions(s), s.turn.current, null);
    const out = resolveClick(t, spotWith(t.actions, ['buildSettlement', 'ck/buildKnight']), true);
    expect(out.kind).toBe('choose');
    if (out.kind === 'choose') {
      expect(out.choices.map((a) => a.type).sort()).toEqual(['buildSettlement', 'ck/buildKnight']);
    }
    const all = new Set(t.actions.map((a) => a.type));
    expect(all.has('ck/buildKnight')).toBe(true);
    // Panel-only actions (activate / promote) stay off the board.
    expect(all.has('ck/activateKnight')).toBe(false);
  });

  it('T&B Rivers: bridges are spot builds', () => {
    const s = mainWithSpot('tb', 'tb/rivers', ['tb/buildBridge']);
    const t = clickTargets(legalActions(s), s.turn.current, null);
    const bridge = t.actions.find((a) => a.type === 'tb/buildBridge')!;
    const out = resolveClick(t, clickOn(bridge), true);
    expect(out.kind).toBe('choose');
    if (out.kind === 'choose') expect(out.choices).toContainEqual(bridge);
  });
});
