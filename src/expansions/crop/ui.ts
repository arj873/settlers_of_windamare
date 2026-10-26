/**
 * Crop Trust HUD: a sidebar panel (crops on each fields hex, the Crop Storage Records, the seed
 * vault form with its species / hex / row choice), a harvest dialog for the player whose turn it
 * is to harvest, and replanting by clicking fields hexes on the board.
 */
import type { Action, ExpansionAction, GameState, HexId, PlayerId } from '../../engine';
import { h, type Child } from '../../ui/dom';
import type { HudDialog, HudExtension } from '../../ui/expansions';
import type { HudView } from '../../ui/types';
import { playerStyle } from '../../ui/widgets';
import {
  CROP,
  DEPOSIT_COST,
  ROW_SIZE,
  SPECIES,
  SPECIES_COLOR,
  SPECIES_NAME,
  cropSlice,
  emptyFields,
  fieldsHexes,
  recordVp,
  storedCount,
  type CropCounts,
  type HarvestPhase,
  type ReplantPhase,
  type Row,
  type Species,
} from './engine';
import './crop.css';

type Send = (a: Action) => void;

const act = (a: Record<string, unknown>): Action => a as unknown as ExpansionAction;
const mine = (view: HudView, type: string): Action[] =>
  view.legal.filter((a) => a.player === view.viewer && a.type === type);
const flag = (a: Action, k: string): unknown => (a as Record<string, unknown>)[k];

const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** A coloured crop token chip. */
export function chip(sp: Species, size = 16, title?: string): HTMLElement {
  return h('span', {
    class: 'crop-chip',
    title: title ?? SPECIES_NAME[sp],
    attrs: { role: 'img', 'aria-label': SPECIES_NAME[sp] },
    style: { '--cc': css(SPECIES_COLOR[sp]), width: `${size}px`, height: `${size}px` },
  });
}

const chips = (c: Partial<CropCounts>, size = 14): Child[] =>
  SPECIES.flatMap((sp) => Array.from({ length: c[sp] ?? 0 }, () => chip(sp, size)));

/** Hex names for the HUD: the number token, e.g. "9". */
const hexLabel = (state: GameState, id: HexId): string =>
  String(state.board.hexes[id]?.token ?? '?');

function fieldsList(state: GameState): HTMLElement {
  const crops = cropSlice(state).crops;
  return h(
    'ul',
    { class: 'crop-fields' },
    ...fieldsHexes(state).map((id) => {
      const c = crops[id] as CropCounts;
      const total = SPECIES.reduce((n, sp) => n + c[sp], 0);
      return h(
        'li',
        { class: `crop-field${total === 0 ? ' is-empty' : ''}` },
        h('b', { class: 'crop-num' }, hexLabel(state, id)),
        total === 0
          ? h('span', { class: 'muted' }, 'empty')
          : h('span', { class: 'crop-chips' }, ...chips(c)),
      );
    }),
  );
}

function recordRow(cells: Species[]): HTMLElement {
  return h(
    'span',
    { class: 'crop-row' },
    ...Array.from({ length: ROW_SIZE }, (_, i) => {
      const sp = cells[i];
      return h(
        'span',
        { class: `crop-cell${i >= 2 ? ' is-vp' : ''}${i === 1 ? ' is-card' : ''}` },
        sp ? chip(sp, 14) : null,
      );
    }),
  );
}

function playerRows(state: GameState): HTMLElement {
  const s = cropSlice(state);
  return h(
    'ul',
    { class: 'crop-list' },
    ...state.players.map((p) => {
      const r = s.record[p.id] ?? { top: [], bottom: [] };
      const v = s.vault[p.id];
      return h(
        'li',
        { class: 'crop-prow', style: playerStyle(p.color) },
        h(
          'span',
          { class: 'crop-pname' },
          p.name,
          h(
            'span',
            { class: 'muted' },
            ` ${storedCount(state, p.id)} stored · +${recordVp(state, p.id)} VP`,
          ),
        ),
        h(
          'span',
          { class: 'crop-rows' },
          recordRow(r.top),
          recordRow(r.bottom),
          v &&
            h(
              'span',
              { class: 'crop-vault', title: `Seed vault: ${v.count} ${v.species}` },
              chip(v.species, 14),
              h('small', {}, `×${v.count}`),
            ),
        ),
      );
    }),
  );
}

/** "Store seeds" form: species → hex → row, built from the viewer's legal deposits. */
function depositForm(view: HudView, state: GameState, send: Send): HTMLElement | null {
  const options = mine(view, 'crop/deposit');
  if (options.length === 0) return null;
  const el = <T extends string>(opts: [T, string][]) => {
    const sel = h('select', { class: 'crop-select' });
    for (const [value, label] of opts) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      sel.append(o);
    }
    return sel;
  };
  const speciesList = SPECIES.filter((sp) => options.some((a) => flag(a, 'species') === sp));
  const sp = el(speciesList.map((x): [Species, string] => [x, SPECIES_NAME[x]]));
  const hexSel = el<string>([]);
  const rowSel = el<Row>([]);
  const go = h('button', { class: 'btn btn-sm' }, 'Store');
  const fill = (select: HTMLSelectElement, items: [string, string][]) => {
    const keep = select.value;
    select.replaceChildren(
      ...items.map(([v, l]) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = l;
        return o;
      }),
    );
    if (items.some(([v]) => v === keep)) select.value = keep;
  };
  const sync = () => {
    const forSpecies = options.filter((a) => flag(a, 'species') === sp.value);
    const hexes = [...new Set(forSpecies.map((a) => flag(a, 'hex') as HexId))];
    fill(
      hexSel,
      hexes.map((id) => [id, `field ${hexLabel(state, id)}`]),
    );
    const rows = [
      ...new Set(
        forSpecies.filter((a) => flag(a, 'hex') === hexSel.value).map((a) => flag(a, 'row') as Row),
      ),
    ];
    fill(
      rowSel,
      rows.map((r) => [r, r === 'top' ? 'top row' : 'bottom row']),
    );
  };
  sp.addEventListener('change', sync);
  hexSel.addEventListener('change', sync);
  go.addEventListener('click', () =>
    send(
      act({
        type: 'crop/deposit',
        player: view.viewer,
        hex: hexSel.value,
        species: sp.value,
        row: rowSel.value,
      }),
    ),
  );
  sync();
  return h(
    'div',
    { class: 'crop-deposit' },
    h('b', {}, 'Seed vault'),
    h(
      'span',
      { class: 'muted' },
      `costs ${DEPOSIT_COST.lumber} lumber + ${DEPOSIT_COST.ore} ore, once a turn`,
    ),
    sp,
    hexSel,
    rowSel,
    go,
  );
}

function harvestDialog(state: GameState, view: HudView, send: Send): HudDialog | null {
  const phase = state.phase;
  if (phase.kind !== 'crop/harvest') return null;
  const ph = phase as HarvestPhase;
  const head = ph.queue[0];
  const picks = mine(view, 'crop/harvest');
  if (!head || head.player !== view.viewer) return null;
  const c = cropSlice(state).crops[head.hex] as CropCounts;
  const round = ph.queue.filter((e) => e.hex === head.hex && e.player === head.player).length;
  return {
    key: `crop-harvest-${state.turn.number}-${ph.queue.length}`,
    title: `Harvest field ${hexLabel(state, head.hex)}`,
    modal: true,
    body: [
      h(
        'p',
        {},
        `Take 1 crop off the field for 1 food${round > 1 ? ' (your city harvests twice)' : ''}, or leave it for the others and the seed vault.`,
      ),
      h(
        'div',
        { class: 'crop-picks' },
        ...picks.map((a) => {
          const sp = flag(a, 'species') as Species;
          return h(
            'button',
            {
              class: 'btn',
              title: SPECIES_NAME[sp],
              on: { click: () => send(a) },
            },
            chip(sp, 18),
            ` ${SPECIES_NAME[sp]} (${c[sp]})`,
          );
        }),
        h(
          'button',
          {
            class: 'btn btn-ghost',
            on: { click: () => send(act({ type: 'crop/skipHarvest', player: view.viewer })) },
          },
          'Skip',
        ),
      ),
    ],
  };
}

export const cropHud: HudExtension = {
  id: CROP,

  panel(state, view, send) {
    const s = cropSlice(state);
    const gone = emptyFields(state).length;
    const body = h(
      'div',
      { class: 'crop-panel' },
      h(
        'p',
        { class: 'muted crop-facts' },
        `Fields without crops ${gone}/3 · extinct species ${s.extinct.length}/2 · events left ${s.stack.length}`,
      ),
      s.extinct.length > 0 &&
        h(
          'p',
          { class: 'crop-extinct' },
          'Extinct: ',
          ...s.extinct.map((sp) => h('b', {}, `${SPECIES_NAME[sp]} `)),
        ),
      fieldsList(state),
      playerRows(state),
    );
    const form = depositForm(view, state, send);
    if (form) body.append(form);
    return { title: 'Crop Trust', body };
  },

  dialog(state, view, _legal, send) {
    return harvestDialog(state, view, send);
  },

  hint(state, view) {
    const phase = state.phase;
    if (phase.kind === 'crop/harvest') {
      const head = (phase as HarvestPhase).queue[0];
      return head && head.player === view.viewer ? 'Harvest the field, or skip' : null;
    }
    if (phase.kind === 'crop/replant' && state.turn.current === view.viewer) {
      const left = (phase as ReplantPhase).left;
      return `Replant the seeds: click a field (${left} left)`;
    }
    return null;
  },

  impliedActions: ['crop/plant'],
};

export type { PlayerId };
