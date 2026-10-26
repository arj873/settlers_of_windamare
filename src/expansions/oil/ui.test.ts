// @vitest-environment jsdom
/** Oil Springs in the UI layer: setup tiles, the HUD panel and buttons, build card, dialogs. */
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
import { playerRange } from '../../ui/setup/model';
import type { NewGameConfig, PlaceMode } from '../../ui/types';
import { OIL, oilSlice } from './engine';

const seats = (n = 4) =>
  ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, n).map((name, i) => ({ name, color: `#20202${i}` }));

function oilGame(n = 4): GameState {
  return createGame({ seed: 4, players: seats(n), mode: OIL, startingPlayer: 0 });
}

function applyOk(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function give(s: GameState, p: number, n: number): void {
  const o = oilSlice(s);
  o.oil[p] = (o.oil[p] ?? 0) + n;
  o.supply -= n;
}

describe('oil setup screen', () => {
  let started: NewGameConfig[];
  const make = () => {
    started = [];
    const screen = new SetupScreen({ onStart: (c) => started.push(c), storage: null });
    document.body.replaceChildren(screen.element);
    return screen;
  };
  const q = (screen: SetupScreen, k: string) =>
    screen.element.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);

  it('offers Oil Springs as a ready mode with 2 scenarios, 3-6 seats and a 12 VP target', () => {
    const screen = make();
    expect(q(screen, `mode-${OIL}`)).not.toBeNull();
    q(screen, `mode-${OIL}`)?.click();
    expect(screen.state.mode).toBe(OIL);
    expect(q(screen, 'scenario-oil/oilSprings')?.getAttribute('aria-pressed')).toBe('true');
    expect(q(screen, 'scenario-oil/oilSpringsVariable')).not.toBeNull();
    expect(q(screen, 'map-base')).toBeNull();
    expect(playerRange(screen.state)).toEqual({ min: 3, max: 6 });
    q(screen, 'start')?.click();
    const cfg = started[0] as NewGameConfig;
    expect(cfg).toMatchObject({ mode: OIL, scenario: 'oil/oilSprings', vpToWin: 12 });
    const s = createGame({
      seed: 'ui',
      players: cfg.players,
      mode: cfg.mode,
      ...(cfg.scenario ? { scenario: cfg.scenario } : {}),
    });
    expect(s.settings.map).toBe('oil/fixed19');
  });
});

describe('oil HUD', () => {
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
  const show = (s: GameState, viewer = 0) =>
    hud.render(s, { viewer, legal: legalActions(s), isBotTurn: false });

  /** P0 in the main phase with a city, 2 oil and the metropolis cards. */
  function ready(): { s: GameState; v: VertexId } {
    const s = oilGame();
    const v = topologyOf(s).vertices[14] as VertexId;
    s.pieces.buildings[v] = { owner: 0, kind: 'city' };
    s.players[0]!.resources.brick = 1;
    s.players[0]!.resources.grain = 1;
    s.players[0]!.resources.ore = 1;
    s.bank.brick -= 1;
    s.bank.grain -= 1;
    s.bank.ore -= 1;
    give(s, 0, 2);
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'main' };
    return { s, v };
  }

  it('shows the Oil Springs panel: Disaster Track, supply, oil per player', () => {
    const { s } = ready();
    show(s);
    const panel = root.querySelector('.sec-ext-oil');
    expect(panel?.textContent).toContain('Oil Springs');
    expect(panel?.textContent).toContain('Pollution');
    expect(panel?.querySelectorAll('.oil-pip')).toHaveLength(6);
    expect(panel?.textContent).toContain('Oil supply 13');
    expect(panel?.querySelectorAll('.oil-row')).toHaveLength(4);
    expect(panel?.querySelector('.oil-row .oil-held svg')).not.toBeNull();
  });

  it('has a Metropolis build card that toggles its place mode and highlights cities', () => {
    const { s, v } = ready();
    show(s);
    const card = byText('Metropolis');
    expect(card?.disabled).toBe(false);
    card?.click();
    expect(modes).toEqual(['oil/metropolis']);
    const targets = boardActions(legalActions(s, 0), 0, 'oil/metropolis');
    expect(targets).toEqual([{ type: 'oil/metropolis', player: 0, vertex: v }]);
    expect(highlightsFor(targets).vertices).toEqual([v]);
  });

  it('disables the Metropolis card without oil; base games show none of this', () => {
    const { s } = ready();
    oilSlice(s).oil[0] = 1;
    show(s);
    expect(byText('Metropolis')?.disabled).toBe(true);
    const base = createGame({ seed: 4, players: seats() });
    hud.render(base, { viewer: 0, legal: legalActions(base, 0), isBotTurn: false });
    expect(root.querySelector('.sec-ext-oil')).toBeNull();
    expect(byText('Metropolis')).toBeUndefined();
  });

  it('sends oil/convert for the clicked resource and oil/sequester', () => {
    const { s } = ready();
    show(s);
    (root.querySelector('.oil-resbtn[aria-label="Ore"]') as HTMLButtonElement).click();
    expect(actions.at(-1)).toEqual({ type: 'oil/convert', player: 0, resource: 'ore' });
    byText('Sequester')?.click();
    expect(actions.at(-1)).toEqual({ type: 'oil/sequester', player: 0 });
  });

  it('hides the oil buttons that are not legal (marker at 5)', () => {
    const { s } = ready();
    oilSlice(s).marker = 5;
    show(s);
    expect(root.querySelector('.oil-resbtn')).toBeNull();
    expect(byText('Sequester')).toBeDefined(); // sequestering is not "using"
  });

  it('offers an oil trade form that sends oil/offerTrade', () => {
    const { s } = ready();
    s.players[1]!.resources.ore = 1;
    s.bank.ore -= 1;
    show(s);
    const form = root.querySelector('.oil-trade');
    expect(form).not.toBeNull();
    const selects = form?.querySelectorAll('select') ?? [];
    expect(selects).toHaveLength(5);
    (selects[4] as HTMLSelectElement).value = '1';
    (selects[3] as HTMLSelectElement).value = 'ore';
    (form?.querySelector('button') as HTMLButtonElement).click();
    expect(actions.at(-1)).toMatchObject({
      type: 'oil/offerTrade',
      player: 0,
      to: 1,
      giveOil: 1,
      wantOil: 0,
      want: { ore: 1 },
    });
  });

  it('discarding with oil: a dialog with steppers sends oil/discard', () => {
    const s = oilGame();
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'preRoll' };
    s.players[1]!.resources.brick = 4;
    s.bank.brick -= 4;
    give(s, 1, 4); // 8 cards: discard 4
    s.rng = rngForRoll(7);
    const seven = applyOk(s, { type: 'rollDice', player: 0 });
    hud.render(seven, { viewer: 1, legal: legalActions(seven), isBotTurn: false });
    const dialog = root.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Discard cards');
    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find((b) =>
      b.textContent?.includes('Discard'),
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const more = [...(dialog?.querySelectorAll('button[aria-label="more"]') ?? [])];
    expect(more).toHaveLength(2); // oil and brick
    for (let i = 0; i < 2; i++) (more[0] as HTMLButtonElement).click(); // 2 oil
    for (let i = 0; i < 2; i++) (more[1] as HTMLButtonElement).click(); // 2 brick
    expect(confirm.disabled).toBe(false);
    confirm.click();
    expect(actions.at(-1)).toEqual({
      type: 'oil/discard',
      player: 1,
      resources: { brick: 2 },
      oil: 2,
    });
  });

  it('stealing: a dialog lets the thief choose a random card or oil', () => {
    const { s } = ready();
    const t = topologyOf(s);
    const victimHex = Object.keys(s.board.hexes)[0] as never;
    const v = t.vertices.find((x) => t.vertex[x]?.hexes.includes(victimHex)) as VertexId;
    s.pieces.buildings[v] = { owner: 2, kind: 'settlement' };
    give(s, 2, 1);
    s.players[2]!.resources.ore = 1;
    s.bank.ore -= 1;
    s.phase = { kind: 'steal', candidates: [2], resume: 'main' };
    show(s);
    const dialog = root.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Steal');
    byText('Oil (1)')?.click();
    expect(actions.at(-1)).toEqual({ type: 'oil/steal', player: 0, victim: 2, oil: true });
    byText('Random card')?.click();
    expect(actions.at(-1)).toEqual({ type: 'oil/steal', player: 0, victim: 2, oil: false });
  });

  it('an oil trade offer opens a dialog for the partner with the hint and Accept / Decline', () => {
    const { s } = ready();
    s.players[1]!.resources.ore = 1;
    s.bank.ore -= 1;
    const offered = applyOk(s, {
      type: 'oil/offerTrade',
      player: 0,
      to: 1,
      giveOil: 1,
      wantOil: 0,
      give: {},
      want: { ore: 1 },
    } as unknown as Action);
    hud.render(offered, { viewer: 1, legal: legalActions(offered), isBotTurn: false });
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Oil trade offer',
    );
    expect(root.textContent).toContain('Answer the oil trade offer');
    byText('Accept')?.click();
    expect(actions.at(-1)).toEqual({ type: 'oil/acceptTrade', player: 1 });
    byText('Decline')?.click();
    expect(actions.at(-1)).toEqual({ type: 'oil/rejectTrade', player: 1 });
  });
});
