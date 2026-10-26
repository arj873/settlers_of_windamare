/**
 * Seafarers HUD: a sidebar panel (scenario goal, ships left, special VP, fog stack, cloth,
 * fortresses, wonders with their buttons), Ship and Move-ship build cards, the gold choice and the
 * Cloth pirate's steal dialogs, and turn-pill hints for ships and the pirate.
 */
import {
  pieceLimit,
  type Action,
  type ExpansionAction,
  type GameState,
  type PlayerId,
  type Resource,
  type ResourceBundle,
} from '../../engine';
import { RESOURCES } from '../../engine/constants';
import { h, type Child } from '../../ui/dom';
import type { HudDialog, HudExtension } from '../../ui/expansions';
import { glyph, RESOURCE_LABEL } from '../../ui/icons';
import type { HudView } from '../../ui/types';
import { playerStyle, resCardFace } from '../../ui/widgets';
import {
  rulesOf,
  scenarioKey,
  SEA_ACTIONS,
  seaSlice,
  type ClothStealPhase,
  type GoldPhase,
} from './engine';
import { goldOwed, wonderBlocker, wonderOf } from './engine/actions';
import { wonderCards, WONDER_LEVELS } from './engine/features';
import { mapKeyOf, type MapKey } from './engine/maps';
import { fortressOf, warships } from './engine/pirates';
import { SHIP, shipsLeft } from './engine/ships';
import './seafarers.css';

type Send = (a: Action) => void;
const T = SEA_ACTIONS;
const act = (a: Record<string, unknown>): Action => a as unknown as ExpansionAction;
const mine = (view: HudView, type: string): Action[] =>
  view.legal.filter((a) => a.player === view.viewer && a.type === type);
const keyOf = (s: GameState) => mapKeyOf(s.settings.map) as MapKey;

/** The scenario's goal in one line (§5.2). */
export function goalText(state: GameState): string {
  const vp = state.settings.vpToWin;
  switch (scenarioKey(state)) {
    case 'newShores':
      return `${vp} VP wins. Your first settlement on each small island: +2 VP.`;
    case 'fourIslands':
      return `${vp} VP wins. Your first settlement on each foreign island: +2 VP.`;
    case 'fogIslands':
      return `${vp} VP wins. Sail into the fog to discover land (1 card for each).`;
    case 'throughTheDesert':
      return `${vp} VP wins. First settlement beyond the desert or on an island: +2 VP.`;
    case 'forgottenTribe':
      return `${vp} VP wins. Sail to the gifts: VP, development cards and harbors.`;
    case 'clothForCatan':
      return `${vp} VP wins, or most VP when only 3 villages have cloth left. 2 cloth = 1 VP.`;
    case 'pirateIslands':
      return `Capture your fortress and reach ${vp} VP. Knights build warships.`;
    case 'wondersOfCatan':
      return `Complete a wonder, or reach ${vp} VP with the highest wonder.`;
    case 'newWorld':
      return `${vp} VP wins. One settlement on a foreign island: +1 VP (once).`;
  }
}

function chitVp(state: GameState, p: PlayerId): number {
  return seaSlice(state).chits.reduce((n, c) => n + (c.player === p ? c.vp : 0), 0);
}

function playerRows(state: GameState): HTMLElement {
  const s = seaSlice(state);
  const key = scenarioKey(state);
  return h(
    'ul',
    { class: 'sea-list' },
    ...state.players.map((p) => {
      const cells: Child[] = [
        h('span', { class: 'sea-name' }, p.name),
        h(
          'span',
          {
            class: 'sea-stat',
            title: `${shipsLeft(state, p.id)} of ${pieceLimit(state, p.id, SHIP)} ships left`,
          },
          glyph('ship', 16),
          String(shipsLeft(state, p.id)),
        ),
      ];
      if (rulesOf(state).bonus || key === 'forgottenTribe') {
        cells.push(
          h(
            'span',
            { class: 'sea-stat', title: 'Special victory points' },
            glyph('victoryPoint', 14),
            `+${chitVp(state, p.id)}`,
          ),
        );
      }
      if (s.cloth) {
        const n = s.cloth.held[p.id] ?? 0;
        cells.push(
          h(
            'span',
            { class: 'sea-stat', title: `${n} cloth = ${Math.floor(n / 2)} VP` },
            h('span', { class: 'sea-cloth' }),
            String(n),
          ),
        );
      }
      if (s.fleet) {
        const f = fortressOf(state, p.id);
        cells.push(
          h('span', { class: 'sea-stat', title: 'Warships' }, '⚔', String(warships(state, p.id))),
          h(
            'span',
            { class: 'sea-stat', title: 'Fortress chits left (0 = captured)' },
            '🏰',
            f && f.chits > 0 ? String(f.chits) : '✓',
          ),
        );
      }
      if (s.wonders) {
        const i = wonderOf(state, p.id);
        const card = i === null ? null : wonderCards(keyOf(state))[i];
        cells.push(
          h(
            'span',
            { class: 'sea-stat', title: card ? card.name : 'No wonder yet' },
            card
              ? `${card.name.split(' ').pop()} ${s.wonders.level[p.id] ?? 0}/${WONDER_LEVELS}`
              : '—',
          ),
        );
      }
      return h('li', { class: 'sea-row', style: playerStyle(p.color) }, ...cells);
    }),
  );
}

function facts(state: GameState): Child[] {
  const s = seaSlice(state);
  const out: Child[] = [];
  if (s.fog) out.push(h('span', {}, `Fog stack: ${s.fog.terrains.length} hexes`));
  if (s.cloth) {
    const left = Object.values(s.cloth.villages).filter((v) => v.cloth > 0).length;
    out.push(h('span', {}, `Villages with cloth: ${left} (ends at 3) · supply ${s.cloth.supply}`));
  }
  if (s.gifts) out.push(h('span', {}, `Gifts left: ${Object.keys(s.gifts).length}`));
  if (s.fleet)
    out.push(
      h(
        'span',
        {},
        s.fleet.gone ? 'The pirate fleet is gone' : 'The fleet sails the lower die each roll',
      ),
    );
  if (s.pirate === null && rulesOf(state).pirate === false && !s.fleet)
    out.push(h('span', {}, 'No pirate in this scenario'));
  return out;
}

function wonderBlock(state: GameState, view: HudView, send: Send): HTMLElement | null {
  const w = seaSlice(state).wonders;
  if (!w) return null;
  const cards = wonderCards(keyOf(state));
  const me = view.viewer;
  const level = mine(view, T.buildWonder).length > 0;
  return h(
    'div',
    { class: 'sea-wonders' },
    ...cards.map((c, i) => {
      const owner = w.started[i];
      const can = mine(view, T.startWonder).some((a) => (a as { wonder?: number }).wonder === i);
      const why = owner === null || owner === undefined ? wonderBlocker(state, me, i) : null;
      return h(
        'div',
        {
          class: 'sea-wonder',
          style:
            owner === null || owner === undefined
              ? {}
              : playerStyle(state.players[owner]?.color ?? '#888'),
        },
        h('b', { title: `Needs: ${c.needs}` }, c.name),
        h(
          'span',
          { class: 'sea-cost', title: 'Cost of each of the 4 levels' },
          ...RESOURCES.flatMap((r) => Array.from({ length: c.cost[r] }, () => resCardFace(r, 13))),
        ),
        owner !== null && owner !== undefined
          ? h(
              'span',
              { class: 'sea-owner' },
              `${state.players[owner]?.name ?? ''}: ${w.level[owner] ?? 0}/${WONDER_LEVELS}`,
            )
          : h(
              'button',
              {
                class: 'btn btn-sm',
                disabled: !can,
                title: can ? 'Place a ship on the card: you must build this wonder' : (why ?? ''),
                on: { click: () => send(act({ type: T.startWonder, player: me, wonder: i })) },
              },
              'Start',
            ),
      );
    }),
    level &&
      h(
        'button',
        {
          class: 'btn btn-sm btn-primary',
          on: { click: () => send(act({ type: T.buildWonder, player: me })) },
        },
        'Build a wonder level',
      ),
  );
}

function actionButtons(view: HudView, send: Send): Child[] {
  const me = view.viewer;
  const out: Child[] = [];
  if (mine(view, T.attackFortress).length > 0) {
    out.push(
      h(
        'button',
        {
          class: 'btn btn-sm btn-primary',
          title: 'Roll one die against your warships. Ends your turn.',
          on: { click: () => send(act({ type: T.attackFortress, player: me })) },
        },
        '⚔ Attack your fortress',
      ),
    );
  }
  if (mine(view, T.cancelMove).length > 0) {
    out.push(
      h(
        'button',
        { class: 'btn btn-sm', on: { click: () => send(act({ type: T.cancelMove, player: me })) } },
        'Cancel ship move',
      ),
    );
  }
  return out;
}

// --- dialogs -------------------------------------------------------------------------------

let goldDraft: { key: string; res: ResourceBundle } = { key: '', res: {} };

function goldDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  if (state.phase.kind !== 'seafarers/gold' || mine(view, T.pickGold).length === 0) return null;
  const me = view.viewer;
  const owed = goldOwed(state, me);
  if (owed <= 0) return null;
  const phase = state.phase as GoldPhase;
  const key = `sea-gold-${state.turn.number}-${me}-${phase.pending.join('.')}-${state.log.length}`;
  if (goldDraft.key !== key) goldDraft = { key, res: {} };
  const total = () => RESOURCES.reduce((n, r) => n + (goldDraft.res[r] ?? 0), 0);
  const picked = h('div', { class: 'sea-picked' });
  const ok = h('button', { class: 'btn btn-primary' }, 'Take');
  const sync = () => {
    picked.replaceChildren(
      ...RESOURCES.flatMap((r) =>
        Array.from({ length: goldDraft.res[r] ?? 0 }, () => resCardFace(r, 26)),
      ),
      ...Array.from({ length: owed - total() }, () => h('span', { class: 'sea-slot' })),
    );
    (ok as HTMLButtonElement).disabled = total() !== owed;
  };
  ok.addEventListener('click', () =>
    send(act({ type: T.pickGold, player: me, resources: { ...goldDraft.res } })),
  );
  const buttons = RESOURCES.map((r: Resource) =>
    h(
      'button',
      {
        class: 'sea-resbtn',
        title: RESOURCE_LABEL[r],
        disabled: state.bank[r] <= 0,
        attrs: { 'aria-label': `Add ${RESOURCE_LABEL[r]}` },
        on: {
          click: () => {
            if (total() >= owed || (goldDraft.res[r] ?? 0) >= state.bank[r]) return;
            goldDraft.res[r] = (goldDraft.res[r] ?? 0) + 1;
            sync();
          },
        },
      },
      resCardFace(r, 30),
    ),
  );
  const clear = h(
    'button',
    { class: 'btn btn-ghost', on: { click: () => ((goldDraft.res = {}), sync()) } },
    'Clear',
  );
  sync();
  return {
    key,
    title: 'Gold!',
    modal: true,
    body: [
      h('p', {}, `Take ${owed} resource${owed > 1 ? 's' : ''} of your choice from the bank.`),
      h('div', { class: 'sea-res' }, ...buttons),
      picked,
      h('div', { class: 'dialog-actions' }, clear, ok),
    ],
  };
}

function clothStealDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  if (state.phase.kind !== 'seafarers/pirateSteal') return null;
  const cloth = mine(view, T.stealCloth);
  const cards = mine(view, T.stealCard);
  if (cloth.length + cards.length === 0) return null;
  const me = view.viewer;
  const phase = state.phase as ClothStealPhase;
  return {
    key: `sea-steal-${state.turn.number}-${state.log.length}`,
    title: 'The pirate robs',
    modal: true,
    body: [
      h(
        'p',
        {},
        'Take a random resource card or 1 cloth from a player with a ship next to the pirate.',
      ),
      ...phase.candidates.map((v) => {
        const p = state.players[v];
        const has = (list: Action[]) => list.some((a) => (a as { victim?: number }).victim === v);
        return h(
          'div',
          { class: 'sea-victim', style: playerStyle(p?.color ?? '#888') },
          h('b', {}, p?.name ?? `Player ${v + 1}`),
          has(cards) &&
            h(
              'button',
              {
                class: 'btn btn-sm',
                on: { click: () => send(act({ type: T.stealCard, player: me, victim: v })) },
              },
              'Random card',
            ),
          has(cloth) &&
            h(
              'button',
              {
                class: 'btn btn-sm',
                on: { click: () => send(act({ type: T.stealCloth, player: me, victim: v })) },
              },
              h('span', { class: 'sea-cloth' }),
              ` Cloth (${seaSlice(state).cloth?.held[v] ?? 0})`,
            ),
        );
      }),
    ],
  };
}

export const seafarersHud: HudExtension = {
  id: 'seafarers',

  panel(state, view, send) {
    const body = h(
      'div',
      { class: 'sea-panel' },
      h('p', { class: 'sea-goal' }, goalText(state)),
      h(
        'p',
        { class: 'muted sea-facts' },
        ...facts(state).flatMap((f, i) => (i === 0 ? [f] : [' · ', f])),
      ),
      playerRows(state),
    );
    const w = wonderBlock(state, view, send);
    if (w) body.append(w);
    const buttons = actionButtons(view, send);
    if (buttons.length > 0) body.append(h('div', { class: 'sea-actions' }, ...buttons));
    return { title: rulesOf(state).name, body };
  },

  buildCards: [
    {
      mode: 'seafarers/ship',
      label: 'Ship',
      actionType: T.buildShip,
      alsoActions: [T.setupShip, T.freeShip],
      glyph: 'ship',
      costItem: SHIP,
      left: (state, p) => shipsLeft(state, p),
      total: (state, p) => pieceLimit(state, p, SHIP),
    },
    {
      mode: 'seafarers/move',
      label: 'Move ship',
      actionType: T.pickShip,
      glyph: 'ship',
    },
  ],

  dialog(state, view, _legal, send) {
    return goldDialog(state, view, send) ?? clothStealDialog(state, view, send);
  },

  hint(state, view) {
    const can = (t: string) => mine(view, t).length > 0;
    switch (state.phase.kind) {
      case 'setup':
        if (state.phase.step === 'road' && can(T.setupShip)) {
          return 'Place a road or a ship (Ship card for a coast edge) next to your settlement';
        }
        return null;
      case 'moveRobber':
        return can(T.movePirate) ? 'Move the robber (land) or the pirate (sea)' : null;
      case 'roadBuilding':
        return can(T.freeShip) ? `Place a free road or ship (${state.phase.remaining} left)` : null;
      case 'seafarers/moveShip':
        return 'Move the ship: pick a highlighted edge';
      case 'seafarers/gold':
        return can(T.pickGold) ? 'Gold! Choose your resources' : null;
      case 'seafarers/placeHarbor':
        return 'Place your harbor on a coast edge at your building';
      case 'seafarers/pirateSteal':
        return 'Rob a card or a cloth';
      default:
        return null;
    }
  },

  impliedActions: [T.setupShip, T.freeShip, T.movePirate, T.moveShip, T.placeHarbor],
};
