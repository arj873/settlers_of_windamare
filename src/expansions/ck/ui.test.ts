// @vitest-environment jsdom
/** Cities & Knights in the UI layer: setup screen, HUD panel, build cards, hand, dialogs. */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  legalActions,
  viewFor,
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
import { CK, ckSlice } from './engine';
import { E, V, build, giveCards, knight, roads, setGoods } from './engine/testkit';

const seats = (n = 4) =>
  ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, n).map((name, i) => ({ name, color: `#20202${i}` }));

function main(): GameState {
  const s = createGame({
    seed: 4,
    players: seats(),
    mode: CK,
    scenario: 'ck/starter',
    startingPlayer: 0,
  });
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind: 'main' };
  return s;
}

function applyOk(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe('C&K setup screen', () => {
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

  it('offers C&K with its two scenarios, 3-6 seats and a 13 VP target', () => {
    const screen = make();
    expect(pickMode(screen.element, CK)).toBe(true);
    expect(screen.state.mode).toBe(CK);
    expect(q(screen, 'scenario-ck/classic')).not.toBeNull();
    expect(q(screen, 'scenario-ck/starter')).not.toBeNull();
    expect(playerRange(screen.state)).toEqual({ min: 3, max: 6 });
    expect(screen.state.vpToWin).toBe(13);
    q(screen, 'start')?.click();
    expect(started[0]).toMatchObject({ mode: CK, scenario: 'ck/classic', vpToWin: 13 });
  });

  it('refuses Rush mode with C&K: the reason is shown and Start is off', () => {
    const screen = make();
    expect(pickMode(screen.element, CK)).toBe(true);
    q(screen, 'rule-rushMode')?.click();
    expect(setupError(screen.state)).toMatch(/Rush/);
    expect(screen.element.querySelector('.su-error')?.textContent).toMatch(/Rush/);
    expect(q(screen, 'start')?.disabled).toBe(true);
    q(screen, 'rule-rushMode')?.click();
    expect(q(screen, 'start')?.disabled).toBe(false);
  });
});

describe('C&K HUD', () => {
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

  it('panel: barbarian track, strengths, improvement tracks, players', () => {
    const s = main();
    build(s, 0, V(0, 0, 'S'), 'city');
    ckSlice(s).barbarian = 3;
    show(s);
    const panel = root.querySelector('.sec-ext-ck');
    expect(panel?.textContent).toContain('Barbarians');
    expect(panel?.textContent).toContain('1 cities vs 0 knights');
    expect(panel?.querySelectorAll('.ck-cell')).toHaveLength(8);
    expect(panel?.querySelector('.ck-cell.is-ship')).not.toBeNull();
    expect(panel?.querySelectorAll('.ck-trk')).toHaveLength(3);
    expect(panel?.querySelectorAll('.ck-row')).toHaveLength(4);
    expect(byText('Buy card')).toBeUndefined();
  });

  it('player rows show commodity totals as commodities, not as one type (online view)', () => {
    const s = main();
    setGoods(s, 2, { paper: 2 });
    setGoods(s, 1, { cloth: 1 });
    show(viewFor(s, 0) as GameState);
    const rows = [...root.querySelectorAll('.sec-ext-ck .ck-row')];
    const stat = (p: number) =>
      [...rows[p]!.querySelectorAll<HTMLElement>('.ck-stat')].find((e) =>
        e.title.startsWith('Commodity'),
      )!;
    expect(stat(2).textContent).toBe('2');
    expect(stat(1).textContent).toBe('1');
    for (const row of rows) {
      const labels = [...row.querySelectorAll('[aria-label]')].map((e) =>
        e.getAttribute('aria-label'),
      );
      expect(labels).not.toContain('Coin');
      expect(labels).not.toContain('Paper');
      expect(labels).not.toContain('Cloth');
    }
  });

  it('the commodity Bank form states the price on its button', () => {
    const s = main();
    setGoods(s, 0, { grain: 4, coin: 4 });
    show(s);
    const form = [...root.querySelectorAll('.sec-ext-ck .ck-form')].find((f) =>
      f.textContent?.startsWith('Bank'),
    )!;
    const [give, receive] = [...form.querySelectorAll('select')];
    const go = form.querySelector('button')!;
    give!.value = 'grain';
    give!.dispatchEvent(new Event('change'));
    receive!.value = 'paper';
    receive!.dispatchEvent(new Event('change'));
    expect(go.textContent).toBe('Trade 4:1');
    expect(go.getAttribute('aria-label')).toBe('Give 4 Grain for 1 Paper');
    go.click();
    expect(actions.at(-1)).toEqual({
      type: 'ck/bankTrade',
      player: 0,
      give: 'grain',
      receive: 'paper',
    });
    give!.value = 'coin';
    give!.dispatchEvent(new Event('change'));
    expect(go.getAttribute('aria-label')).toMatch(/^Give 4 Coin for 1 /);
  });

  it('Improve buttons send ck/improve; progress cards have Play buttons', () => {
    const s = main();
    build(s, 0, V(0, 0, 'S'), 'city');
    setGoods(s, 0, { cloth: 1 });
    build(s, 0, V(-1, -1, 'S'));
    giveCards(s, 0, 'irrigation');
    show(s);
    const improve = root.querySelector<HTMLButtonElement>('.ck-trk-trade .ck-improve');
    expect(improve?.disabled).toBe(false);
    // Named for what it buys, not just its price ("1× Cloth" read like a trade).
    expect(improve?.getAttribute('aria-label')).toBe('Improve trade to level 1 (Market): 1 cloth');
    improve?.click();
    expect(actions.at(-1)).toEqual({ type: 'ck/improve', player: 0, track: 'trade' });
    byText('Play')?.click();
    expect(actions.at(-1)).toEqual({ type: 'ck/play', player: 0, card: 'irrigation' });
  });

  it('each progress card Play button names its card', () => {
    const s = main();
    build(s, 0, V(0, 0, 'S'), 'city');
    giveCards(s, 0, 'irrigation', 'mining');
    show(s);
    const names = [...root.querySelectorAll('.ck-card button')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(names).toEqual(expect.arrayContaining(['Play Irrigation', 'Play Mining']));
    root.querySelector<HTMLButtonElement>('.ck-card button[aria-label="Play Mining"]')?.click();
    expect(actions.at(-1)).toEqual({ type: 'ck/play', player: 0, card: 'mining' });
  });

  it('the hand bar shows commodities and the progress stack', () => {
    const s = main();
    setGoods(s, 0, { coin: 2, paper: 1 });
    giveCards(s, 0, 'spy', 'crane');
    show(s);
    const hand = root.querySelector('.hand');
    expect(hand?.querySelectorAll('.ck-cf')).toHaveLength(3);
    expect(hand?.querySelector('.ck-hp .count-badge')?.textContent).toBe('2');
  });

  it('Knight / Command / City wall build cards drive the board', () => {
    const s = main();
    build(s, 0, V(0, 0, 'SW'));
    roads(s, 0, E(0, 0, 'W'), E(0, 0, 'NW'));
    setGoods(s, 0, { wool: 1, ore: 1, grain: 1 });
    knight(s, 0, V(0, 0, 'N'));
    show(s);
    byText('Knight')?.click();
    expect(modes.at(-1)).toBe('ck/knight');
    const spots = boardActions(legalActions(s, 0), 0, 'ck/knight');
    expect(highlightsFor(spots).vertices).toContain(V(0, 0, 'NW'));
    byText('Command')?.click();
    expect(modes.at(-1)).toBe('ck/command');
    const select = boardActions(legalActions(s, 0), 0, 'ck/command');
    expect(select).toEqual([{ type: 'ck/selectKnight', player: 0, vertex: V(0, 0, 'N') }]);
    // The command dialog offers Activate.
    const r = applyOk(s, select[0] as Action);
    show(r);
    expect(root.textContent).toContain('Basic knight (inactive)');
    byText('Activate')?.click();
    expect(actions.at(-1)).toEqual({ type: 'ck/activateKnight', player: 0, vertex: V(0, 0, 'N') });
  });

  it('discarding on a 7 counts commodities', () => {
    const s = main();
    setGoods(s, 0, { ore: 4, coin: 4 });
    s.phase = { kind: 'discard', pending: [4, 0, 0, 0] };
    show(s);
    expect(root.textContent).toContain('Discard 4 cards (commodities count)');
    const more = [...root.querySelectorAll<HTMLButtonElement>('button[aria-label="more coin"]')];
    for (let i = 0; i < 4; i++) more[0]?.click();
    root.querySelector<HTMLButtonElement>('.dialog .btn-primary')?.click();
    expect(actions.at(-1)).toEqual({
      type: 'ck/discard',
      player: 0,
      resources: {},
      commodities: { coin: 4 },
    });
  });

  it('prompts list their choices: a tied defender picks a stack', () => {
    const s = main();
    s.phase = { kind: 'ck/defender', queue: [0] } as never;
    show(s);
    expect(root.textContent).toContain('Defenders tied');
    byText('Politics')?.click();
    expect(actions.at(-1)).toEqual({ type: 'ck/pickTrack', player: 0, track: 'politics' });
  });

  it('board prompts are implied clicks: a pillaged city is picked on the board', () => {
    const s = main();
    build(s, 0, V(0, 0, 'S'), 'city');
    build(s, 0, V(2, 0, 'S'), 'city');
    s.phase = { kind: 'ck/pillage', queue: [0] } as never;
    const targets = boardActions(legalActions(s, 0), 0, null);
    expect([...(highlightsFor(targets).vertices ?? [])].sort()).toEqual(
      [V(0, 0, 'S'), V(2, 0, 'S')].sort() as VertexId[],
    );
  });

  it('a trade offer shows its commodity part', () => {
    const s = main();
    setGoods(s, 0, { coin: 1 });
    const r = applyOk(s, {
      type: 'ck/offerTrade',
      player: 0,
      give: { coin: 1 },
      want: { brick: 1 },
      to: [1, 2, 3],
    } as unknown as Action);
    hud.render(r, { viewer: 1, legal: legalActions(r), isBotTurn: false });
    expect(root.querySelector('.offer-line .ck-cf-coin')).not.toBeNull();
  });
});
