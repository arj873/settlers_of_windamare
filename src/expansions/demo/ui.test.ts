// @vitest-environment jsdom
/** Demo expansion end to end in the UI layer: setup tiles, HUD panel, build card, dialog, clicks. */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  legalActions,
  topologyOf,
  type Action,
  type GameState,
  type VertexId,
} from '../../engine';
import { rngForRoll } from '../../engine/actions/testkit';
import { boardActions, highlightsFor } from '../../game/logic';
import { Hud } from '../../ui/hud';
import { SetupScreen } from '../../ui/setup/screen';
import {
  buildConfig,
  defaultSetup,
  playerRange,
  setMode,
  visibleModes,
} from '../../ui/setup/model';
import type { NewGameConfig, PlaceMode } from '../../ui/types';
import { DEMO } from './engine';

describe('setup screen', () => {
  let started: NewGameConfig[];
  const make = (showAllModes: boolean) => {
    started = [];
    const screen = new SetupScreen({
      onStart: (c) => started.push(c),
      storage: null,
      showAllModes,
    });
    document.body.replaceChildren(screen.element);
    return screen;
  };
  const q = (screen: SetupScreen, k: string) =>
    screen.element.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);

  it('hides demo / wip modes unless asked; base stays first', () => {
    // (Other expansions register modes too: only the demo's visibility is this test's business.)
    expect(visibleModes().map((m) => m.id)[0]).toBe('base');
    expect(visibleModes().map((m) => m.id)).not.toContain(DEMO);
    expect(visibleModes(true).map((m) => m.id)[0]).toBe('base');
    expect(visibleModes(true).map((m) => m.id)).toContain(DEMO);
    expect(q(make(false), `mode-${DEMO}`)).toBeNull();
    expect(q(make(true), `mode-${DEMO}`)).not.toBeNull();
  });

  it('picking the demo shows its scenario and option, clamps seats, and starts a demo game', () => {
    const screen = make(true);
    q(screen, `mode-${DEMO}`)?.click();
    expect(screen.state.mode).toBe(DEMO);
    expect(q(screen, 'scenario-demo/oasis')?.getAttribute('aria-pressed')).toBe('true');
    expect(q(screen, 'map-base')).toBeNull();
    const opt = q(screen, 'opt-demo-friendlyRobber');
    expect(opt?.getAttribute('aria-pressed')).toBe('true');
    opt?.click();
    expect(screen.state.options).toEqual({ demo: { friendlyRobber: false } });
    expect(playerRange(screen.state)).toEqual({ min: 3, max: 4 });
    q(screen, 'start')?.click();
    const cfg = started[0] as NewGameConfig;
    expect(cfg).toMatchObject({
      mode: DEMO,
      scenario: 'demo/oasis',
      options: { demo: { friendlyRobber: false } },
    });
    const s = createGame({
      seed: 'ui',
      players: cfg.players,
      mode: cfg.mode,
      ...(cfg.scenario ? { scenario: cfg.scenario } : {}),
      ...(cfg.options ? { options: cfg.options } : {}),
    });
    expect(s.settings.map).toBe('demo/oasis19');
  });

  it('a 6-seat base draft picking the demo drops to 4 seats; base config is unchanged', () => {
    const six = { ...defaultSetup(6), map: 'base56' as const };
    expect(setMode(six, DEMO).seats).toHaveLength(4);
    expect(buildConfig(defaultSetup())).not.toHaveProperty('options');
    expect(buildConfig(defaultSetup()).mode).toBe('base');
  });
});

describe('HUD and board clicks', () => {
  let root: HTMLElement;
  let hud: Hud;
  let actions: Action[];
  let modes: (PlaceMode | null)[];
  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
    hud = new Hud(root);
    actions = [];
    modes = [];
    hud.on('action', (a) => actions.push(a));
    hud.on('placeMode', (m) => modes.push(m));
  });
  const byText = (t: string) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(t));

  /** Demo game, P0 in main with a settlement and well resources. */
  function wellReady(): { s: GameState; v: VertexId } {
    const s = createGame({ seed: 4, players: seats(), mode: DEMO, startingPlayer: 0 });
    const v = topologyOf(s).vertices[12] as VertexId;
    s.pieces.buildings[v] = { owner: 0, kind: 'settlement' };
    s.players[0]!.resources.brick = 1;
    s.players[0]!.resources.grain = 1;
    s.bank.brick -= 1;
    s.bank.grain -= 1;
    s.turn = { number: 2, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'main' };
    return { s, v };
  }

  it('shows the Oasis panel and a Well build card that toggles its place mode', () => {
    const { s, v } = wellReady();
    const legal = legalActions(s, 0);
    hud.render(s, { viewer: 0, legal, isBotTurn: false });
    expect(root.querySelector('.sec-ext-demo')?.textContent).toContain('Oasis');
    const well = byText('Well');
    expect(well?.disabled).toBe(false);
    well?.click();
    expect(modes).toEqual(['demo/well']);
    // The controller maps the mode to the module's action and highlights its vertices.
    const targets = boardActions(legal, 0, 'demo/well');
    expect(targets).toEqual([{ type: 'demo/buildWell', player: 0, vertex: v }]);
    expect(highlightsFor(targets).vertices).toEqual([v]);
  });

  it('disables the Well card without the resources; base games have no Oasis UI', () => {
    const { s } = wellReady();
    s.players[0]!.resources.grain = 0;
    hud.render(s, { viewer: 0, legal: legalActions(s, 0), isBotTurn: false });
    expect(byText('Well')?.disabled).toBe(true);
    const base = createGame({ seed: 4, players: seats() });
    hud.render(base, { viewer: 0, legal: legalActions(base, 0), isBotTurn: false });
    expect(root.querySelector('.sec-ext-demo')).toBeNull();
    expect(byText('Well')).toBeUndefined();
  });

  it('opens the bloom dialog, shows the hint, and sends the picked resource', () => {
    const s = createGame({ seed: 4, players: seats(), mode: DEMO, startingPlayer: 0 });
    s.turn = { number: 2, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'preRoll' };
    s.rng = rngForRoll(12);
    const bloom = applyOk(s, { type: 'rollDice', player: 0 });
    expect(bloom.phase.kind).toBe('demo/bloom');
    hud.render(bloom, { viewer: 0, legal: legalActions(bloom, 0), isBotTurn: false });
    expect(root.textContent).toContain('The oasis blooms');
    const dialog = root.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('The oasis blooms');
    (dialog?.querySelector('button[aria-label="Ore"]') as HTMLButtonElement | null)?.click();
    expect(actions).toEqual([{ type: 'demo/pickBloom', player: 0, resource: 'ore' }]);
  });
});

function seats() {
  return ['A', 'B', 'C', 'D'].map((name, i) => ({ name, color: `#20202${i}` }));
}

function applyOk(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
