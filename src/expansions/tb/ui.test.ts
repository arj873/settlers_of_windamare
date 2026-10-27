// @vitest-environment jsdom
/** Traders & Barbarians in the UI layer: setup screen, sidebar panel, buttons, build cards, dialogs. */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  legalActions,
  type Action,
  type GameState,
  type VertexId,
} from '../../engine';
import { boardActions, highlightsFor } from '../../game/logic';
import { Hud } from '../../ui/hud';
import { SetupScreen } from '../../ui/setup/screen';
import { pickMode } from '../../ui/setup/testkit';
import { playerRange, setupError } from '../../ui/setup/model';
import type { NewGameConfig, PlaceMode } from '../../ui/types';
import {
  SC_BA,
  SC_CARAVANS,
  SC_FISH,
  SC_RIVERS,
  SC_TRADERS,
  TB,
  tbSlice,
  tradersOf,
} from './engine';
import { tbHud } from './ui';

const seats = (n: number) =>
  ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, n).map((name, i) => ({ name, color: `#20202${i}` }));

/** A fresh game of `scenario`, skipped to player 0's main phase. */
function main(scenario: string, n = 4): GameState {
  const s = createGame({ seed: 7, players: seats(n), mode: TB, scenario, startingPlayer: 0 });
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  return s;
}

function applyOk(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe('T&B setup screen', () => {
  let started: NewGameConfig[];
  const make = () => {
    started = [];
    const screen = new SetupScreen({
      onStart: (c) => started.push(c),
      storage: null,
      showAllModes: true,
    });
    document.body.replaceChildren(screen.element);
    return screen;
  };
  const q = (screen: SetupScreen, k: string) =>
    screen.element.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);

  it('offers the five scenarios and the variants, 2-6 seats, Harbormaster adds 1 VP', () => {
    const screen = make();
    expect(pickMode(screen.element, TB)).toBe(true);
    expect(screen.state.mode).toBe(TB);
    for (const id of [SC_FISH, SC_RIVERS, SC_CARAVANS, SC_BA, SC_TRADERS, 'tb/variants']) {
      expect(q(screen, `scenario-${id}`)).not.toBeNull();
    }
    expect(playerRange(screen.state)).toEqual({ min: 2, max: 6 });
    expect(screen.state.vpToWin).toBe(10);
    q(screen, `scenario-${SC_TRADERS}`)?.click();
    expect(screen.state.vpToWin).toBe(13);
    q(screen, 'opt-tb-harbormaster')?.click();
    expect(screen.state.vpToWin).toBe(14);
    q(screen, 'start')?.click();
    expect(started[0]).toMatchObject({
      mode: TB,
      scenario: SC_TRADERS,
      vpToWin: 14,
      options: { tb: { harbormaster: true } },
    });
  });

  it('refuses the robber variants in Barbarian Attack: the reason shows, Start is off', () => {
    const screen = make();
    expect(pickMode(screen.element, TB)).toBe(true);
    q(screen, `scenario-${SC_BA}`)?.click();
    // Rush mode switches the friendly robber on.
    q(screen, 'rule-rushMode')?.click();
    expect(setupError(screen.state)).toMatch(/no robber/);
    expect(screen.element.querySelector('.su-error')?.textContent).toMatch(/no robber/);
    expect(q(screen, 'start')?.disabled).toBe(true);
  });
});

describe('T&B HUD', () => {
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
  const panel = () => root.querySelector('.sec-ext-tb');

  it('Rivers: gold per player with the Wealthiest / Poor Settler marks', () => {
    const s = main(SC_RIVERS);
    tbSlice(s).gold = [3, 1, 0, 0];
    show(s);
    expect(
      panel()?.querySelector('.sec-title, h3, summary')?.textContent ?? panel()?.textContent,
    ).toContain('Rivers of Catan');
    const rows = panel()?.querySelectorAll('.tb-row');
    expect(rows).toHaveLength(4);
    expect(rows?.[0]?.querySelector('.tb-tag.is-good')).not.toBeNull();
    expect(rows?.[2]?.querySelector('.tb-tag.is-bad')).not.toBeNull();
    expect(rows?.[3]?.querySelector('.tb-tag.is-bad')).not.toBeNull();
    expect(rows?.[1]?.querySelector('.tb-tag')).toBeNull();
  });

  it('gold buys a card: the resource buttons send tb/buyResource', () => {
    const s = main(SC_TRADERS);
    show(s);
    const buy = root.querySelector<HTMLButtonElement>(
      '.tb-act .tb-resbtn[aria-label="Buy 1 Ore for 2 gold"]',
    );
    expect(buy).not.toBeNull();
    buy?.click();
    expect(actions.at(-1)).toEqual({ type: 'tb/buyResource', player: 0, resource: 'ore' });
  });

  it('buy and sell buttons for one resource have different names', () => {
    const s = main(SC_TRADERS);
    s.players[0]!.resources.brick = 5;
    show(s);
    const names = [...root.querySelectorAll('.tb-act .tb-resbtn')].map((b) =>
      b.getAttribute('aria-label'),
    );
    const brick = names.filter((n) => n?.includes('Brick'));
    expect(brick).toEqual([
      'Buy 1 Brick for 2 gold',
      expect.stringMatching(/^Sell \d Brick for 1 gold$/),
    ]);
  });

  it('Fishermen: own fish values are shown, others only as a count; fish actions', () => {
    const s = main(SC_FISH);
    const f = tbSlice(s).fish;
    if (!f) throw new Error('no fish');
    f.hands[0] = [3, 2, 2];
    f.hands[1] = [3, 3];
    s.players[1]!.resources.ore = 2;
    show(s);
    const rows = panel()?.querySelectorAll('.tb-row');
    expect(rows?.[0]?.textContent).toContain('7');
    expect(rows?.[1]?.textContent).toContain('2×');
    expect(rows?.[1]?.textContent).not.toContain('6');
    expect(
      [...(panel()?.querySelectorAll('.tb-chip-fish') ?? [])].map((c) => c.textContent),
    ).toEqual(['2', '2', '3']);
    byText('B')?.click(); // steal from B (3 fish)
    expect(actions.at(-1)).toEqual({ type: 'tb/fish', player: 0, use: 'steal', victim: 1 });
    byText('Development card')?.click();
    expect(actions.at(-1)).toEqual({ type: 'tb/fish', player: 0, use: 'devCard' });
  });

  it('T&B: the Wagon build card shows the steps; then steps are implied clicks', () => {
    const s = main(SC_TRADERS);
    const start: VertexId = 'v:0,0,N';
    tradersOf(s).wagons[0] = start;
    show(s);
    byText('Wagon')?.click();
    expect(modes.at(-1)).toBe('tb/wagon');
    const first = boardActions(legalActions(s, 0), 0, 'tb/wagon');
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((a) => a.type === 'tb/startWagon')).toBe(true);
    const r = applyOk(s, first[0] as Action);
    show(r);
    expect(root.querySelector('.hud-turn')?.textContent ?? root.textContent).toMatch(
      /Move your wagon/,
    );
    const steps = boardActions(legalActions(r, 0), 0, null);
    expect(steps.length).toBeGreaterThan(0);
    expect(highlightsFor(steps).vertices?.length).toBe(steps.length);
    expect(steps.every((a) => a.type === 'tb/wagonStep')).toBe(true);
  });

  it('build cards show only in their scenario; a module place mode names its card in the pill', () => {
    const cards = () =>
      [...root.querySelectorAll('.ext-card .bcard-label')].map((b) => b.textContent ?? '');
    show(main(SC_RIVERS));
    expect(cards().map((t) => t.split(' ')[0])).toEqual(['Bridge']);
    show(main(SC_FISH));
    expect(cards()).toEqual([]);
    const s = main(SC_TRADERS);
    tradersOf(s).wagons[0] = 'v:0,0,N';
    show(s);
    byText('Wagon')?.click();
    hud.render(s, { viewer: 0, legal: legalActions(s), isBotTurn: false });
    expect(root.querySelector('.hud-turn')?.textContent).toContain(
      'Wagon — pick a highlighted spot',
    );
  });

  it('T&B: the baggage train upgrade button sends tb/upgradeWagon', () => {
    const s = main(SC_TRADERS);
    Object.assign(s.players[0]!.resources, { lumber: 1, wool: 1, ore: 1 });
    show(s);
    expect(panel()?.textContent).toContain('Baggage train 1/5');
    byText('Baggage train 2')?.click();
    expect(actions.at(-1)).toEqual({ type: 'tb/upgradeWagon', player: 0 });
  });

  it('Barbarian Attack: the card button and the knights / prisoners counts', () => {
    const s = main(SC_BA);
    Object.assign(s.players[0]!.resources, { wool: 1, grain: 1, ore: 1 });
    show(s);
    expect(panel()?.querySelectorAll('.tb-ico-prisoner')).toHaveLength(4);
    expect(panel()?.textContent).toContain('6/6');
    byText('Buy a development card')?.click();
    expect(actions.at(-1)).toEqual({ type: 'tb/buyCard', player: 0 });
  });

  it('Caravans: the vote dialog bids wool and grain', () => {
    const s = main(SC_CARAVANS);
    Object.assign(s.players[0]!.resources, { wool: 2, grain: 1 });
    s.phase = {
      kind: 'tb/vote',
      ender: 0,
      order: [0, 1, 2, 3],
      bids: [0, 0, 0, 0],
      camels: 1,
      placer: null,
    } as never;
    show(s);
    expect(root.textContent).toContain('Camel vote');
    root.querySelector<HTMLButtonElement>('button[aria-label="more wool"]')?.click();
    root.querySelector<HTMLButtonElement>('button[aria-label="more wool"]')?.click();
    root.querySelector<HTMLButtonElement>('button[aria-label="more wool"]')?.click(); // capped at 2
    root.querySelector<HTMLButtonElement>('button[aria-label="more grain"]')?.click();
    root.querySelector<HTMLButtonElement>('.dialog .btn-primary')?.click();
    expect(actions.at(-1)).toEqual({ type: 'tb/bid', player: 0, wool: 2, grain: 1 });
  });

  it('Catan for Two: tokens, the forced trade and its give-back dialog', () => {
    const s = main('tb/variants', 2);
    Object.assign(s.players[0]!.resources, { brick: 2 });
    Object.assign(s.players[1]!.resources, { ore: 3 });
    show(s);
    expect(panel()?.querySelectorAll('.tb-ico-token').length).toBeGreaterThan(0);
    const forced = byText('Forced trade');
    expect(forced).toBeDefined();
    forced?.click();
    const r = applyOk(s, actions.at(-1) as Action);
    show(r);
    expect(root.textContent).toContain('Give 2 cards');
    const give = root.querySelector<HTMLButtonElement>('.dialog .btn-primary');
    expect(give?.disabled).toBe(true);
    root.querySelector<HTMLButtonElement>('button[aria-label="more brick"]')?.click();
    root.querySelector<HTMLButtonElement>('button[aria-label="more brick"]')?.click();
    expect(give?.disabled).toBe(false);
    give?.click();
    expect(actions.at(-1)).toEqual({ type: 'tb/forcedGive', player: 0, resources: { brick: 2 } });
  });

  it('hints for the T&B phases', () => {
    const s = main(SC_BA);
    s.phase = {
      kind: 'tb/treason',
      left: 2,
      from: null,
      sources: [],
      dests: [],
      resume: 'main',
    } as never;
    const view = { viewer: 0, legal: legalActions(s), isBotTurn: false };
    expect(tbHud.hint?.(s, view)).toMatch(/Treason: pick a coastal hex to take/);
    s.phase = { kind: 'tb/knights', from: null } as never;
    expect(tbHud.hint?.(s, { ...view, legal: legalActions(s) })).toMatch(/Pick a knight/);
    s.phase = { kind: 'tb/neutral', piece: 'road', resume: { kind: 'main' } } as never;
    expect(tbHud.hint?.(s, { ...view, legal: [{ type: 'endTurn', player: 0 }] })).toMatch(
      /free road/,
    );
  });

  it('declares the board picks as implied clicks', () => {
    expect(tbHud.impliedActions).toEqual(
      expect.arrayContaining(['tb/wagonStep', 'tb/placeCamel', 'tb/moveKnight', 'tb/neutralRoad']),
    );
    expect(tbHud.buildCards?.map((c) => c.actionType)).toEqual([
      'tb/buildBridge',
      'tb/startWagon',
      'tb/startKnights',
    ]);
  });
});
