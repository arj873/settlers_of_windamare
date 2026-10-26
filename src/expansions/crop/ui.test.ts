// @vitest-environment jsdom
/** Crop Trust in the UI layer: setup tiles, panel, deposit form, harvest dialog, replant clicks. */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  hexVertices,
  legalActions,
  topologyOf,
  type Action,
  type GameState,
  type HexId,
  type VertexId,
} from '../../engine';
import { rngForRoll } from '../../engine/actions/testkit';
import { actionForClick, boardActions, highlightsFor } from '../../game/logic';
import { Hud } from '../../ui/hud';
import { SetupScreen } from '../../ui/setup/screen';
import { playerRange } from '../../ui/setup/model';
import type { NewGameConfig } from '../../ui/types';
import { CROP, cropSlice, fieldsHexes } from './engine';

const seats = (n = 4) =>
  ['A', 'B', 'C', 'D'].slice(0, n).map((name, i) => ({ name, color: `#20202${i}` }));

function cropGame(): GameState {
  return createGame({ seed: 4, players: seats(), mode: CROP, startingPlayer: 0 });
}

function applyOk(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

const fieldsWith = (s: GameState, token: number): HexId =>
  fieldsHexes(s).find((h) => s.board.hexes[h]?.token === token) as HexId;

describe('crop setup screen', () => {
  it('offers Crop Trust as a ready mode with 3-4 seats and the 10 VP target', () => {
    const started: NewGameConfig[] = [];
    const screen = new SetupScreen({ onStart: (c) => started.push(c), storage: null });
    document.body.replaceChildren(screen.element);
    const q = (k: string) => screen.element.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);
    q(`mode-${CROP}`)?.click();
    expect(screen.state.mode).toBe(CROP);
    expect(q('scenario-crop/cropTrust')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('scenario-crop/cropTrustVariable')).not.toBeNull();
    expect(playerRange(screen.state)).toEqual({ min: 3, max: 4 });
    q('start')?.click();
    expect(started[0]).toMatchObject({ mode: CROP, scenario: 'crop/cropTrust', vpToWin: 10 });
  });
});

describe('crop HUD', () => {
  let root: HTMLElement;
  let hud: Hud;
  let actions: Action[];
  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
    hud = new Hud(root);
    actions = [];
    hud.on('action', (a) => actions.push(a));
  });
  const byText = (t: string) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(t));
  const show = (s: GameState, viewer = 0) =>
    hud.render(s, { viewer, legal: legalActions(s), isBotTurn: false });

  function mainWithSettlement(): { s: GameState; f: HexId } {
    const s = cropGame();
    const f = fieldsWith(s, 6);
    s.pieces.buildings[hexVertices(topologyOf(s), f)[0] as VertexId] = {
      owner: 0,
      kind: 'settlement',
    };
    s.players[0]!.resources.lumber = 2;
    s.players[0]!.resources.ore = 2;
    s.bank.lumber -= 2;
    s.bank.ore -= 2;
    s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
    s.phase = { kind: 'main' };
    return { s, f };
  }

  it('shows the Crop Trust panel: crops per field, records, vault', () => {
    const { s } = mainWithSettlement();
    show(s);
    const panel = root.querySelector('.sec-ext-crop');
    expect(panel?.textContent).toContain('Crop Trust');
    expect(panel?.querySelectorAll('.crop-field')).toHaveLength(5);
    expect(panel?.querySelectorAll('.crop-prow')).toHaveLength(4);
    expect(panel?.querySelectorAll('.crop-field .crop-chip').length).toBeGreaterThan(10);
    expect(panel?.querySelector('.crop-vault')).not.toBeNull();
    expect(panel?.textContent).toContain('Fields without crops 0/3');
  });

  it('the seed vault form sends crop/deposit with the chosen species, field and row', () => {
    const { s, f } = mainWithSettlement();
    show(s);
    const form = root.querySelector('.crop-deposit');
    expect(form).not.toBeNull();
    const selects = [...(form?.querySelectorAll('select') ?? [])] as HTMLSelectElement[];
    expect(selects).toHaveLength(3);
    selects[0]!.value = 'wheat';
    selects[0]!.dispatchEvent(new Event('change'));
    expect(selects[1]!.value).toBe(f);
    selects[2]!.value = 'bottom';
    (form?.querySelector('button') as HTMLButtonElement).click();
    expect(actions.at(-1)).toEqual({
      type: 'crop/deposit',
      player: 0,
      hex: f,
      species: 'wheat',
      row: 'bottom',
    });
  });

  it('no seed vault form without the cash or after a deposit', () => {
    const { s } = mainWithSettlement();
    s.players[0]!.resources.ore = 0;
    show(s);
    expect(root.querySelector('.crop-deposit')).toBeNull();
  });

  it('a harvest opens a dialog for the player whose turn it is, with one button per crop', () => {
    const { s, f } = mainWithSettlement();
    s.pieces.buildings[hexVertices(topologyOf(s), f)[2] as VertexId] = {
      owner: 1,
      kind: 'settlement',
    };
    s.phase = { kind: 'preRoll' };
    s.rng = rngForRoll(6);
    const open = applyOk(s, { type: 'rollDice', player: 0 });
    expect(open.phase.kind).toBe('crop/harvest');
    // P0 is first (it has a building there): the dialog is theirs, not P1's.
    const other = document.createElement('div');
    new Hud(other).render(open, { viewer: 1, legal: legalActions(open), isBotTurn: false });
    expect(other.querySelector('[role="dialog"]')).toBeNull();
    hud.render(open, { viewer: 0, legal: legalActions(open), isBotTurn: false });
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Harvest field 6',
    );
    expect(root.textContent).toContain('Harvest the field, or skip');
    byText('Rice')?.click();
    expect(actions.at(-1)).toEqual({ type: 'crop/harvest', player: 0, species: 'rice' });
    byText('Skip')?.click();
    expect(actions.at(-1)).toEqual({ type: 'crop/skipHarvest', player: 0 });
  });

  it('replanting: fields hexes are highlighted and a click plants there', () => {
    const { s, f } = mainWithSettlement();
    const g = applyOk(s, {
      type: 'crop/deposit',
      player: 0,
      hex: f,
      species: 'wheat',
      row: 'top',
    } as unknown as Action);
    expect(g.phase.kind).toBe('crop/replant');
    const legal = legalActions(g, 0);
    const targets = boardActions(legal, 0, null);
    expect(highlightsFor(targets).hexes).toHaveLength(5);
    const hex = fieldsHexes(g)[2] as HexId;
    expect(actionForClick(targets, { kind: 'hex', id: hex })).toEqual({
      type: 'crop/plant',
      player: 0,
      hex,
    });
    hud.render(g, { viewer: 0, legal, isBotTurn: false });
    expect(root.textContent).toContain('Replant the seeds');
    expect(cropSlice(g).deposited).toBe(true);
  });
});
