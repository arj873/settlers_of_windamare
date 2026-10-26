// @vitest-environment jsdom
/**
 * Explorers & Pirates online views (engine/mask.ts): face-down hexes, number disc and lair token
 * stacks and uncaptured lairs' numbers never reach any viewer; everything else stays public; the
 * HUD and the board layers draw from the masked shape.
 */
import { describe, expect, it } from 'vitest';
import * as art from '../../render/art';
import {
  legalActions,
  topologyOf,
  viewFor,
  type GameState,
  type HexId,
  type Terrain,
  type Viewer,
} from '../../engine';
import { cloneJson } from '../../engine/expansions/ext';
import type { DrawContext } from '../../render/expansions';
import { Hud } from '../../ui/hud';
import { canary, canaryNumber, expectNoLeak, sampleStates, type Plant } from '../maskTestkit';
import { epDrawer } from './render';
import {
  scenarioIdOf,
  epSlice,
  rulesOf,
  type EpSlice,
  type Hidden,
  type SpiceKind,
} from './engine/state';
import { HIDDEN_CONTENT, HIDDEN_DISC, HIDDEN_LAIR_TOKEN } from './engine/mask';
import { blank, epGame, reveal } from './engine/testkit';

const viewers = (s: GameState): Viewer[] => ['spectator', ...s.players.map((p) => p.id)];
const ep = (s: GameState): EpSlice => epSlice(s);

type Kind = 'hidden' | 'discs' | 'lairTokens' | 'lairs';

/** Canaries in every E&P secret (all global: nobody has seen them). Counts what it planted. */
function planter(planted: Record<Kind, number>): Plant {
  return (state, owner) => {
    if (owner !== null) return null; // E&P has no per-seat secret beyond the base hand
    const st = cloneJson(state);
    const s = ep(st);
    const canaries: string[] = [];
    let k = 0;
    const num = (kind: Kind): number => {
      const n = canaryNumber(k++);
      canaries.push(String(n));
      planted[kind] += 1;
      return n;
    };
    const str = (kind: Kind): string => {
      const c = canary(`${kind}${k++}`);
      canaries.push(c);
      planted[kind] += 1;
      return c;
    };
    for (const h of Object.keys(s.hidden) as HexId[]) {
      s.hidden[h] = {
        terrain: str('hidden') as Terrain,
        shoal: num('hidden'),
        spice: str('hidden') as SpiceKind,
        number: num('hidden'),
      };
    }
    s.discs.parrot = s.discs.parrot.map(() => num('discs'));
    s.discs.goose = s.discs.goose.map(() => num('discs'));
    s.lairTokens = s.lairTokens.map(() => num('lairTokens'));
    for (const lair of Object.values(s.lairs)) if (!lair.captured) lair.token = num('lairs');
    return { state: st, canaries };
  };
}

describe('E&P online views: no leak in bot games', () => {
  const cases = [
    ['landHo', 4, 1200, 9],
    ['pirateLairs', 3, 2500, 13],
    ['fish', 4, 2500, 13],
    ['spices', 4, 2500, 13],
    ['full', 4, 3000, 15],
    ['full', 6, 3000, 15],
  ] as const;
  it.each(cases)(
    '%s, %i players',
    (key, players, maxSteps, every) => {
      const states = sampleStates(
        { seed: 300 + players, players, mode: 'ep', scenario: scenarioIdOf(key) },
        maxSteps,
        every,
      );
      const planted: Record<Kind, number> = { hidden: 0, discs: 0, lairTokens: 0, lairs: 0 };
      const report = expectNoLeak(states, planter(planted));
      expect(report.planted).toBeGreaterThan(10);
      expect(planted.hidden).toBeGreaterThan(0);
      expect(planted.discs).toBeGreaterThan(0);
      if (rulesOf(states[0] as GameState).lairs) expect(planted.lairTokens).toBeGreaterThan(0);
      // Nothing face-down shows on the board of any view.
      for (const st of states) {
        const v = viewFor(st, 'spectator');
        for (const h of Object.keys(ep(st).hidden) as HexId[]) {
          expect(['ep/parrot', 'ep/goose']).toContain(v.board.hexes[h]?.terrain);
          expect(v.board.hexes[h]?.token).toBeNull();
        }
      }
    },
    60_000,
  );

  it.each([['ep+ck', 'full']] as const)(
    'combination %s (%s): the E&P mask runs',
    (mode, key) => {
      const states = sampleStates(
        { seed: 77, players: 4, mode, scenario: scenarioIdOf(key) },
        3000,
        15,
      );
      const planted: Record<Kind, number> = { hidden: 0, discs: 0, lairTokens: 0, lairs: 0 };
      expect(expectNoLeak(states, planter(planted)).planted).toBeGreaterThan(10);
      expect(planted.hidden).toBeGreaterThan(0);
    },
    60_000,
  );
});

/** A full-game state with face-down hexes, an uncaptured and a captured lair. */
function withLairs(): { s: GameState; open: HexId; done: HexId } {
  const s = blank('full');
  const [open, done] = Object.keys(ep(s).hidden) as HexId[];
  if (!open || !done) throw new Error('no face-down hexes');
  reveal(s, open, 'gold');
  reveal(s, done, 'gold', 8);
  ep(s).lairs = {
    [open]: { token: 9, crews: [1], captured: false },
    [done]: { token: 8, crews: [], captured: true },
  };
  ep(s).lairTokens = [3, 11];
  return { s, open, done };
}

describe('E&P maskFor', () => {
  it('keeps the shape: same face-down hexes, stack lengths; placeholders; shares the rest', () => {
    const { s, open, done } = withLairs();
    const before = cloneJson(s);
    const v = viewFor(s, 0);
    const m = ep(v);
    const full = ep(s);
    expect(Object.keys(m.hidden).sort()).toEqual(Object.keys(full.hidden).sort());
    for (const c of Object.values(m.hidden) as Hidden[]) expect(c).toEqual(HIDDEN_CONTENT);
    expect(m.discs.parrot).toEqual(full.discs.parrot.map(() => HIDDEN_DISC));
    expect(m.discs.goose).toEqual(full.discs.goose.map(() => HIDDEN_DISC));
    expect(m.discs.parrot.length).toBeGreaterThan(0);
    expect(m.lairTokens).toEqual([HIDDEN_LAIR_TOKEN, HIDDEN_LAIR_TOKEN]);
    expect(m.lairs[open]).toEqual({ token: HIDDEN_LAIR_TOKEN, crews: [1], captured: false });
    // A captured lair's number lies face up on the gold field.
    expect(m.lairs[done]).toEqual({ token: 8, crews: [], captured: true });
    expect(v.board.hexes[done]?.token).toBe(8);
    // Public parts are shared, the full state untouched.
    expect(m.ships).toBe(full.ships);
    expect(m.gold).toBe(full.gold);
    expect(m.tracks).toBe(full.tracks);
    expect(v.board).toBe(s.board);
    expect(s).toEqual(before);
  });

  it('the view does not depend on the secrets', () => {
    const { s, open } = withLairs();
    const t = cloneJson(s);
    const e = ep(t);
    const hexes = Object.keys(e.hidden) as HexId[];
    const contents = hexes.map((h) => e.hidden[h] as Hidden).reverse();
    hexes.forEach((h, i) => (e.hidden[h] = contents[i] as Hidden));
    e.discs = { parrot: [...e.discs.parrot].reverse(), goose: [...e.discs.goose].reverse() };
    e.lairTokens = [11, 3];
    (e.lairs[open] as { token: number }).token = 4;
    expect(JSON.stringify(e.hidden)).not.toBe(JSON.stringify(ep(s).hidden));
    for (const w of viewers(s)) {
      expect(JSON.stringify(viewFor(t, w))).toBe(JSON.stringify(viewFor(s, w)));
    }
  });

  it('runs after the base masks: opponents’ hands stay hidden in E&P games', () => {
    const s = blank('full');
    (s.players[1] as GameState['players'][number]).resources.ore = 3;
    const v = viewFor(s, 0);
    expect(v.players[1]?.resources.ore).toBe(0);
    expect(viewFor(s, 1).players[1]?.resources.ore).toBe(3);
    expect(v.rng).toBe(0);
  });

  it('game over: hands are revealed, face-down hexes and stacks stay hidden', () => {
    const { s, open } = withLairs();
    (s.players[1] as GameState['players'][number]).resources.ore = 3;
    s.phase = { kind: 'gameOver', winner: 0 } as GameState['phase'];
    for (const w of viewers(s)) {
      const v = viewFor(s, w);
      expect(v.players[1]?.resources.ore).toBe(3);
      expect(ep(v).lairTokens).toEqual([HIDDEN_LAIR_TOKEN, HIDDEN_LAIR_TOKEN]);
      expect(ep(v).lairs[open]?.token).toBe(HIDDEN_LAIR_TOKEN);
      for (const c of Object.values(ep(v).hidden) as Hidden[]) expect(c).toEqual(HIDDEN_CONTENT);
      expect(ep(v).discs.goose.every((d) => d === HIDDEN_DISC)).toBe(true);
    }
  });

  it('a fresh game: the dealt regions and stacks are masked for every viewer', () => {
    const s = epGame('fish', 3);
    for (const w of viewers(s)) {
      const text = JSON.stringify(ep(viewFor(s, w)).hidden);
      expect(text).not.toMatch(/shoal|spice|number|gold|ore|brick|lumber|wool|grain|"sea"/);
    }
  });
});

describe('E&P HUD and board on a masked view', () => {
  const ctxOf = (s: GameState): DrawContext => ({
    topo: topologyOf(s),
    S: 40,
    colorOf: () => 0x3366cc,
    pt: (p) => [p.x * 40, p.y * 40],
    art,
  });

  it('the panel renders from the view and shows no placeholder', () => {
    const { s } = withLairs();
    ep(s).gold = [3, 1, 0, 2];
    const view = viewFor(s, 1);
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    const hud = new Hud(root);
    hud.render(view, { viewer: 1, legal: [], isBotTurn: false });
    const text = root.textContent ?? '';
    expect(text).toMatch(/17 VP wins/);
    expect(text).not.toContain('ep/hidden');
    expect(root.querySelector('.sec-ext-ep')).not.toBeNull();
    // The current player's own view with their legal actions (a fresh HUD: no hotseat cover).
    const root0 = document.createElement('div');
    document.body.replaceChildren(root0);
    new Hud(root0).render(viewFor(s, 0), { viewer: 0, legal: legalActions(s), isBotTurn: false });
    expect(root0.querySelector('.sec-ext-ep')?.textContent).toMatch(/Action phase/);
  });

  it('every board layer signs and draws the view like the full state', () => {
    const { s } = withLairs();
    const view = viewFor(s, 'spectator');
    const ctx = ctxOf(s);
    for (const layer of epDrawer.layers ?? []) {
      // The marks layer draws an uncaptured lair as a skull without its number: same signature
      // apart from the masked token.
      if (layer.key !== 'marks') expect(layer.sig(view), layer.key).toBe(layer.sig(s));
      const c = layer.draw(view, ctx);
      const d = layer.draw(s, ctx);
      expect(c.children.length, layer.key).toBe(d.children.length);
    }
  });
});
