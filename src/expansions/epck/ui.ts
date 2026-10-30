/**
 * E&P + C&K HUD: a short panel with the pair's rules in play (VP target, cities and harbor
 * settlements, knights on their island), Fast Gold for a commodity, one player-offer form for
 * resources, commodities and gold, the Medicine harbor card and the setup hint (city first).
 * Everything else is the C&K and E&P HUDs.
 */
import type { Action, GameState } from '../../engine';
import { RESOURCES } from '../../engine/constants';
import { h } from '../../ui/dom';
import type { HudExtension } from '../../ui/expansions';
import { RESOURCE_LABEL } from '../../ui/icons';
import type { HudView } from '../../ui/types';
import { COMMODITIES, isProgressCard, mainTurn, phaseOf, type Commodity } from '../ck/engine';
import { COMMODITY_LABEL, commodityFace } from '../ck/ui';
import { inMovement } from '../ep/engine/actions';
import { offerForm } from '../ep/ui';
import { EPCK, EPCK_VP_BONUS, MEDICINE_HARBOR_ITEM, cardBlocker } from './engine';
import './epck.css';

type Send = (a: Action) => void;
const mine = (view: HudView, type: string): Action[] =>
  view.legal.filter((a) => a.player === view.viewer && a.type === type);
const field = (a: Action, k: string): unknown => (a as unknown as Record<string, unknown>)[k];

const inMedicine = (state: GameState): boolean => {
  const ph = phaseOf(state);
  return ph.kind === 'ck/card' && (ph as { card?: string }).card === 'medicine';
};

function fastGoldRow(view: HudView, send: Send): HTMLElement | null {
  const sells = mine(view, 'epck/fastGold');
  if (sells.length === 0) return null;
  return h(
    'div',
    { class: 'epck-row' },
    h('span', { class: 'epck-label', title: 'Spice farm advantage' }, 'Fast Gold: 1 for 1 gold'),
    ...sells.map((a) => {
      const c = field(a, 'commodity') as Commodity;
      return h(
        'button',
        {
          class: 'epck-good',
          title: `Fast Gold: ${COMMODITY_LABEL[c]}`,
          on: { click: () => send(a) },
        },
        commodityFace(c, 22),
      );
    }),
  );
}

/** One offer form: resources, commodities and gold (a commodity or gold must be in it). */
function offerBlock(state: GameState, view: HudView, send: Send): HTMLElement | null {
  if (mine(view, 'epck/offerTrade').length === 0) return null;
  const me = view.viewer;
  const to = state.players.filter((p) => p.id !== me).map((p) => p.id);
  const goods = [
    ['gold', 'Gold'],
    ...COMMODITIES.map((c) => [c, COMMODITY_LABEL[c]] as const),
    ...RESOURCES.map((r) => [r, RESOURCE_LABEL[r]] as const),
  ] as const;
  const special = (g: string) => g === 'gold' || (COMMODITIES as readonly string[]).includes(g);
  const make = (give: string, giveN: number, want: string, wantN: number): Action | null =>
    give === want || (!special(give) && !special(want))
      ? null
      : ({
          type: 'epck/offerTrade',
          player: me,
          give: { [give]: giveN },
          want: { [want]: wantN },
          to,
        } as unknown as Action);
  return h(
    'div',
    { class: 'epck-offer' },
    h('div', { class: 'epck-sub' }, 'Offer commodities or gold to players'),
    offerForm(goods, 'gold', make, send),
  );
}

function panel(state: GameState, view: HudView, send: Send): { title: string; body: HTMLElement } {
  const body = h(
    'div',
    { class: 'epck-panel' },
    h(
      'p',
      { class: 'epck-goal' },
      `${state.settings.vpToWin} VP to win (scenario + ${EPCK_VP_BONUS})`,
    ),
    h(
      'p',
      { class: 'epck-fact' },
      'A settlement grows into a city or a harbor settlement, never both. Barbarians count cities only.',
    ),
    h(
      'p',
      { class: 'epck-fact muted' },
      'Knights stay on their island and never stand next to unexplored hexes.',
    ),
  );
  const fast = fastGoldRow(view, send);
  if (fast) body.append(fast);
  const offer = offerBlock(state, view, send);
  if (offer) body.append(offer);
  return { title: 'E&P + Cities & Knights', body };
}

export const epckHud: HudExtension = {
  id: EPCK,

  panel: (state, view, send) => panel(state, view, send),

  buildCards: [
    {
      // Medicine: a harbor settlement for 1 grain + 1 ore instead of a city.
      mode: 'epck/medicineHarbor',
      label: 'Harbor (Medicine)',
      actionType: 'epck/medicineHarbor',
      glyph: 'city',
      costItem: MEDICINE_HARBOR_ITEM,
      available: inMedicine,
    },
  ],

  // #cardinfo: progress cards wait for the Action phase; Medicine, Bishop, Inventor work here.
  handCardStatus(state, view, key) {
    const card = key.slice('ck/'.length);
    if (!key.startsWith('ck/') || !isProgressCard(card) || card === 'alchemist') return null;
    if (mainTurn(state, view.viewer) !== null) return null;
    if (inMovement(state)) {
      return 'Progress cards are played in the Action phase, before your ships move: play it on a later turn.';
    }
    const why = cardBlocker(state, view.viewer, card);
    return why ? `Not now: ${why}.` : null;
  },

  hint(state, view) {
    if (state.phase.kind === 'setup' && state.turn.current === view.viewer) {
      return state.phase.index < state.players.length && state.phase.step === 'settlement'
        ? 'Place your city anywhere on the island (it pays its hexes)'
        : null;
    }
    if (inMedicine(state) && state.turn.current === view.viewer) {
      return mine(view, 'epck/medicineHarbor').length > 0
        ? 'Medicine: click a settlement for a city (1 wheat, 2 ore), or pick Harbor (Medicine) (1 wheat, 1 ore)'
        : null;
    }
    return null;
  },
};
