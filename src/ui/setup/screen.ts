/**
 * The new-game setup screen: stacked sections (mode, map, rules, advanced, seats) and a sticky
 * Start button. Owns its draft; emits a `NewGameConfig` through `onStart`.
 */
import { scenarioById } from '../../engine';
import { h, type Child } from '../dom';
import { themePicker } from '../theme';
import type { MapId, NewGameConfig } from '../types';
import { mapPreviewSvg } from './mapPreviews';
import {
  buildConfig,
  clamp,
  DISCARD_MAX,
  DISCARD_MIN,
  defaultStorage,
  loadSetup,
  MAPS,
  NAME_MAX,
  mapDisabledReason,
  modeOf,
  modeOptions,
  pickSeatColor,
  playerRange,
  rangeLabel,
  saveSetup,
  scenarioOf,
  SEAT_COLORS,
  SEED_MAX,
  setMap,
  setMode,
  setOption,
  setPlayerCount,
  setScenario,
  visibleModes,
  TIMER_STEPS,
  timerLabel,
  VP_MAX,
  VP_MIN,
  type SetupDraft,
  type SetupStorage,
} from './model';
import './setup.css';

export interface SetupScreenOptions {
  onStart: (cfg: NewGameConfig) => void;
  /** Present when there is a game to go back to. */
  onBack?: () => void;
  /** Where the last-used settings live. Default: localStorage (null = don't remember). */
  storage?: SetupStorage | null;
  /** Also offer 'wip' / 'demo' modes. Default: the page URL has ?modes=all. */
  showAllModes?: boolean;
}

/** ?modes=all in the page URL (guarded: tests and workers have no location). */
function urlShowsAllModes(): boolean {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('modes') === 'all';
  } catch {
    return false;
  }
}

const ICON = {
  dice: `<rect x="4" y="4" width="24" height="24" rx="6" fill="currentColor" opacity=".16"/>
    <rect x="4" y="4" width="24" height="24" rx="6" fill="none" stroke="currentColor" stroke-width="2"/>
    <g fill="currentColor"><circle cx="11" cy="11" r="2.2"/><circle cx="21" cy="11" r="2.2"/>
    <circle cx="16" cy="16" r="2.2"/><circle cx="11" cy="21" r="2.2"/><circle cx="21" cy="21" r="2.2"/></g>`,
  hide: `<path d="M3 16s5-8 13-8 13 8 13 8-5 8-13 8S3 16 3 16z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="16" cy="16" r="4" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M6 26 26 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
  logo: `<path d="M16 2 28 9v14l-12 7L4 23V9z" fill="currentColor" opacity=".18"/>
    <path d="M16 2 28 9v14l-12 7L4 23V9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <path d="M16 9v14M10 12.5l12 7M22 12.5l-12 7" stroke="currentColor" stroke-width="1.4" opacity=".7"/>`,
};

function icon(name: keyof typeof ICON, size = 28): HTMLSpanElement {
  const s = h('span', { class: 'su-ico' });
  // Static markup, no user text.
  s.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">${ICON[name]}</svg>`;
  return s;
}

export class SetupScreen {
  readonly element: HTMLElement;
  private draft: SetupDraft;
  private readonly storage: SetupStorage | null;
  private readonly inner: HTMLElement;
  private readonly summary: HTMLElement;
  private seedOpen = false;
  private readonly showAllModes: boolean;

  constructor(private readonly opts: SetupScreenOptions) {
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.showAllModes = opts.showAllModes ?? urlShowsAllModes();
    this.draft = loadSetup(this.storage);
    // A remembered hidden mode (e.g. last game was the demo) falls back to base when not offered.
    if (!visibleModes(this.showAllModes).some((m) => m.id === this.draft.mode)) {
      this.draft = setMode(this.draft, 'base');
    }
    this.seedOpen = false;

    this.inner = h('div', { class: 'su-inner' });
    this.summary = h('div', { class: 'su-summary' });
    this.element = h(
      'div',
      { class: 'setup', attrs: { role: 'dialog', 'aria-label': 'New game setup' } },
      h('div', { class: 'su-scroll' }, this.inner),
      h(
        'div',
        { class: 'su-footer' },
        h(
          'div',
          { class: 'su-footer-in' },
          this.summary,
          themePicker({ compact: true }),
          opts.onBack &&
            h(
              'button',
              { class: 'btn btn-ghost', on: { click: () => opts.onBack?.() } },
              'Back to game',
            ),
          h(
            'button',
            {
              class: 'btn btn-primary btn-lg su-start',
              attrs: { 'data-k': 'start' },
              on: { click: () => this.start() },
            },
            'Start game',
          ),
        ),
      ),
    );
    this.render();
  }

  /** Current draft, for tests and debugging. */
  get state(): SetupDraft {
    return this.draft;
  }

  private start(): void {
    saveSetup(this.storage, this.draft);
    this.opts.onStart(buildConfig(this.draft));
  }

  private set(next: SetupDraft): void {
    this.draft = next;
    saveSetup(this.storage, next);
    this.render();
  }

  /** Update without rebuilding the DOM (typing, dragging a slider would lose focus). */
  private patch(next: SetupDraft): void {
    this.draft = next;
    saveSetup(this.storage, next);
    this.renderSummary();
  }

  private renderSummary(): void {
    const d = this.draft;
    const map = MAPS.find((m) => m.id === d.map);
    const title =
      d.mode === 'base'
        ? (map?.label ?? 'Base')
        : `${modeOf(d).name}${scenarioOf(d) ? `: ${scenarioOf(d)?.name ?? ''}` : ''}`;
    this.summary.replaceChildren(
      h('strong', {}, title),
      ` · ${d.seats.length} players · ${d.vpToWin} VP`,
      TIMER_STEPS[d.timerIdx] ? ` · ${timerLabel(d.timerIdx)} timer` : '',
    );
  }

  private render(): void {
    const active = document.activeElement;
    const focusKey = active && this.element.contains(active) ? active.getAttribute('data-k') : null;
    this.inner.replaceChildren(
      h(
        'header',
        { class: 'su-head' },
        h('span', { class: 'su-logo' }, icon('logo', 38)),
        h(
          'div',
          {},
          h('h1', {}, 'New game'),
          h('p', { class: 'muted' }, 'Colonizers of Windamere'),
        ),
      ),
      this.modeSection(),
      this.mapSection(),
      this.rulesSection(),
      this.advancedSection(),
      this.seatsSection(),
    );
    this.renderSummary();
    if (focusKey) this.element.querySelector<HTMLElement>(`[data-k="${focusKey}"]`)?.focus();
  }

  // -------------------------------------------------------------------------
  // Sections
  // -------------------------------------------------------------------------

  private section(title: string, id: string, ...children: Child[]): HTMLElement {
    return h(
      'section',
      { class: 'su-sec', attrs: { 'aria-labelledby': `su-h-${id}` } },
      h('h2', { id: `su-h-${id}` }, title),
      ...children,
    );
  }

  /** Mode tiles come from the engine registry (docs/EXPANSIONS.md §8); base first. */
  private modeSection(): HTMLElement {
    const modes = visibleModes(this.showAllModes);
    return this.section(
      'Game mode',
      'mode',
      h(
        'div',
        { class: 'su-tiles', attrs: { role: 'group', 'aria-labelledby': 'su-h-mode' } },
        ...modes.map((m) => {
          const on = this.draft.mode === m.id;
          return h(
            'button',
            {
              class: `su-tile${on ? ' is-on' : ''}`,
              title: `${m.name}: ${m.players.min}–${m.players.max} players`,
              attrs: { 'aria-pressed': String(on), 'data-k': `mode-${m.id}` },
              on: { click: () => this.set(setMode(this.draft, m.id)) },
            },
            h('span', { class: 'su-tile-title' }, m.name),
            h('span', { class: 'su-tile-sub' }, m.blurb),
            m.status !== 'ready' && h('span', { class: 'su-tile-reason' }, m.status),
          );
        }),
      ),
    );
  }

  /** Expansion modes: one tile per scenario of the mode, with its map preview. */
  private scenarioSection(): HTMLElement {
    const mode = modeOf(this.draft);
    const n = this.draft.seats.length;
    return this.section(
      'Scenario',
      'map',
      h(
        'div',
        { class: 'su-tiles su-maps', attrs: { role: 'group', 'aria-labelledby': 'su-h-map' } },
        ...mode.scenarios.map((id) => {
          const s = scenarioById(id);
          if (!s) return null;
          const on = this.draft.scenario === id;
          const players = clamp(n, s.players.min, s.players.max);
          return h(
            'button',
            {
              class: `su-tile su-map${on ? ' is-on' : ''}`,
              title: `${s.name}: ${s.blurb}`,
              attrs: { 'aria-pressed': String(on), 'data-k': `scenario-${id}` },
              on: { click: () => this.set(setScenario(this.draft, id)) },
            },
            h('span', { class: 'su-map-art' }, mapPreviewSvg(s.mapFor(players))),
            h('span', { class: 'su-tile-title' }, s.name),
            h('span', { class: 'su-tile-sub' }, `${s.players.min}–${s.players.max} players`),
          );
        }),
      ),
    );
  }

  /** Expansion options of the draft's mode: booleans as rule tiles, ints / choices as selects. */
  private optionTiles(): HTMLElement[] {
    const d = this.draft;
    return modeOptions(modeOf(d)).map(({ ext, def }) => {
      const value = d.options[ext]?.[def.key] ?? def.default;
      const key = `opt-${ext}-${def.key}`;
      if (def.type === 'boolean') {
        return h(
          'button',
          {
            class: `su-tile su-rule${value === true ? ' is-on' : ''}`,
            title: def.description ?? def.label,
            attrs: { 'aria-pressed': String(value === true), 'data-k': key },
            on: { click: () => this.set(setOption(this.draft, ext, def.key, value !== true)) },
          },
          h(
            'span',
            { class: 'su-rule-text' },
            h('span', { class: 'su-tile-title' }, def.label),
            def.description && h('span', { class: 'su-tile-sub' }, def.description),
          ),
          h('span', { class: 'su-switch', attrs: { 'aria-hidden': 'true' } }, h('i')),
        );
      }
      const choices =
        def.type === 'choice'
          ? def.choices
          : Array.from({ length: def.max - def.min + 1 }, (_, i) => ({
              value: String(def.min + i),
              label: String(def.min + i),
            }));
      return h(
        'label',
        { class: 'su-tile su-rule su-opt', title: def.description ?? def.label },
        h('span', { class: 'su-tile-title' }, def.label),
        h(
          'select',
          {
            class: 'input',
            attrs: { 'data-k': key, 'aria-label': def.label },
            on: {
              change: (e) => {
                const raw = (e.target as HTMLSelectElement).value;
                this.set(
                  setOption(this.draft, ext, def.key, def.type === 'int' ? Number(raw) : raw),
                );
              },
            },
          },
          ...choices.map((c) =>
            h(
              'option',
              { value: c.value, attrs: String(value) === c.value ? { selected: '' } : {} },
              c.label,
            ),
          ),
        ),
      );
    });
  }

  private mapSection(): HTMLElement {
    if (this.draft.mode !== 'base') return this.scenarioSection();
    const players = this.draft.seats.length;
    return this.section(
      'Map',
      'map',
      h(
        'div',
        { class: 'su-tiles su-maps', attrs: { role: 'group', 'aria-labelledby': 'su-h-map' } },
        ...MAPS.map((m) => {
          const reason = mapDisabledReason(m.id, players);
          const on = this.draft.map === m.id;
          return h(
            'button',
            {
              class: `su-tile su-map${on ? ' is-on' : ''}`,
              disabled: reason !== null,
              attrs: { 'aria-pressed': String(on), 'data-k': `map-${m.id}` },
              title: reason ?? `${m.label}: ${rangeLabel(m)}`,
              on: { click: () => this.set(setMap(this.draft, m.id as MapId)) },
            },
            h('span', { class: 'su-map-art' }, mapPreviewSvg(m.id)),
            h('span', { class: 'su-tile-title' }, m.label),
            h('span', { class: 'su-tile-sub' }, rangeLabel(m)),
            reason && h('span', { class: 'su-tile-reason' }, reason),
          );
        }),
      ),
    );
  }

  private rulesSection(): HTMLElement {
    const d = this.draft;
    const rule = (
      key: 'balancedDice' | 'hideBankCards',
      ico: keyof typeof ICON,
      title: string,
      desc: string,
    ) =>
      h(
        'button',
        {
          class: `su-tile su-rule${d[key] ? ' is-on' : ''}`,
          title: desc,
          attrs: { 'aria-pressed': String(d[key]), 'data-k': `rule-${key}` },
          on: { click: () => this.set({ ...this.draft, [key]: !this.draft[key] }) },
        },
        icon(ico, 30),
        h(
          'span',
          { class: 'su-rule-text' },
          h('span', { class: 'su-tile-title' }, title),
          h('span', { class: 'su-tile-sub' }, desc),
        ),
        h('span', { class: 'su-switch', attrs: { 'aria-hidden': 'true' } }, h('i')),
      );
    return this.section(
      'Rules',
      'rules',
      h(
        'div',
        { class: 'su-tiles su-rules', attrs: { role: 'group', 'aria-labelledby': 'su-h-rules' } },
        rule(
          'balancedDice',
          'dice',
          'Balanced Dice',
          'Rolls follow the true distribution with less streakiness.',
        ),
        rule(
          'hideBankCards',
          'hide',
          'Hide Bank Cards',
          "The bank's resource stock is hidden from players.",
        ),
        ...this.optionTiles(),
      ),
    );
  }

  private advancedSection(): HTMLElement {
    const d = this.draft;
    return this.section(
      'Advanced settings',
      'adv',
      h(
        'div',
        { class: 'su-grid' },
        this.stepperCard(
          'Turn timer',
          'timer',
          timerLabel(d.timerIdx),
          d.timerIdx > 0,
          d.timerIdx < TIMER_STEPS.length - 1,
          (dir) =>
            this.set({
              ...this.draft,
              timerIdx: clamp(this.draft.timerIdx + dir, 0, TIMER_STEPS.length - 1),
            }),
        ),
        this.stepperCard(
          'Players',
          'players',
          String(d.seats.length),
          d.seats.length > playerRange(d).min,
          d.seats.length < playerRange(d).max,
          (dir) => this.set(setPlayerCount(this.draft, this.draft.seats.length + dir)),
        ),
        this.sliderCard('Points to win', 'vp', d.vpToWin, VP_MIN, VP_MAX, (v) =>
          this.patch({ ...this.draft, vpToWin: v }),
        ),
        this.sliderCard(
          'Card discard limit',
          'discard',
          d.discardLimit,
          DISCARD_MIN,
          DISCARD_MAX,
          (v) => this.patch({ ...this.draft, discardLimit: v }),
        ),
      ),
      h(
        'details',
        {
          class: 'su-more',
          attrs: this.seedOpen ? { open: '' } : {},
          on: { toggle: (e) => (this.seedOpen = (e.currentTarget as HTMLDetailsElement).open) },
        },
        h('summary', { attrs: { 'data-k': 'seed-toggle' } }, 'More options'),
        h(
          'label',
          { class: 'su-seed' },
          h('span', {}, 'Seed'),
          h('input', {
            class: 'input',
            value: d.seed,
            placeholder: 'optional: same seed, same game',
            maxLength: SEED_MAX,
            attrs: { 'aria-label': 'Seed', 'data-k': 'seed' },
            on: {
              input: (e) =>
                this.patch({ ...this.draft, seed: (e.target as HTMLInputElement).value }),
            },
          }),
        ),
      ),
    );
  }

  private stepperCard(
    title: string,
    key: string,
    value: string,
    canDec: boolean,
    canInc: boolean,
    step: (dir: -1 | 1) => void,
  ): HTMLElement {
    return h(
      'div',
      { class: 'su-card', attrs: { role: 'group', 'aria-label': title } },
      h('div', { class: 'su-card-title' }, title),
      h(
        'div',
        { class: 'su-stepper' },
        h(
          'button',
          {
            class: 'su-step',
            disabled: !canDec,
            attrs: { 'aria-label': `Decrease ${title.toLowerCase()}`, 'data-k': `${key}-dec` },
            on: { click: () => step(-1) },
          },
          '−',
        ),
        h('output', { class: 'su-value', attrs: { 'aria-live': 'polite', 'data-v': key } }, value),
        h(
          'button',
          {
            class: 'su-step',
            disabled: !canInc,
            attrs: { 'aria-label': `Increase ${title.toLowerCase()}`, 'data-k': `${key}-inc` },
            on: { click: () => step(1) },
          },
          '+',
        ),
      ),
    );
  }

  private sliderCard(
    title: string,
    key: string,
    value: number,
    min: number,
    max: number,
    onChange: (v: number) => void,
  ): HTMLElement {
    const out = h(
      'output',
      { class: 'su-value su-value-sm', attrs: { 'data-v': key } },
      String(value),
    );
    const pct = (v: number) => `${((v - min) / (max - min)) * 100}%`;
    const input = h('input', {
      class: 'su-range',
      type: 'range',
      value: String(value),
      style: { '--pct': pct(value) },
      attrs: { min: String(min), max: String(max), step: '1', 'aria-label': title, 'data-k': key },
      on: {
        input: (e) => {
          const el = e.target as HTMLInputElement;
          const v = clamp(Number(el.value), min, max);
          out.textContent = String(v);
          el.style.setProperty('--pct', pct(v));
          onChange(v);
        },
      },
    });
    return h(
      'div',
      { class: 'su-card' },
      h('div', { class: 'su-card-title' }, title, out),
      input,
      h('div', { class: 'su-range-ends' }, h('span', {}, String(min)), h('span', {}, String(max))),
    );
  }

  private seatsSection(): HTMLElement {
    const d = this.draft;
    return this.section(
      'Seats',
      'seats',
      h(
        'div',
        { class: 'su-seats' },
        ...d.seats.map((seat, i) =>
          h(
            'div',
            { class: 'su-seat', style: { '--pc': seat.color } },
            h('span', { class: 'su-seat-no' }, String(i + 1)),
            h('input', {
              class: 'input su-name',
              value: seat.name,
              maxLength: NAME_MAX,
              placeholder: `Player ${i + 1}`,
              attrs: { 'aria-label': `Seat ${i + 1} name`, 'data-k': `name-${i}` },
              on: {
                input: (e) => {
                  const name = (e.target as HTMLInputElement).value;
                  this.patch({
                    ...this.draft,
                    seats: this.draft.seats.map((s, j) => (j === i ? { ...s, name } : s)),
                  });
                },
              },
            }),
            h(
              'div',
              {
                class: 'su-swatches',
                attrs: { role: 'group', 'aria-label': `Seat ${i + 1} colour` },
              },
              ...SEAT_COLORS.map((c) =>
                h('button', {
                  class: `swatch${c.color === seat.color ? ' is-on' : ''}`,
                  title: c.name,
                  style: { '--sw': c.color },
                  attrs: {
                    'aria-label': `${c.name} for seat ${i + 1}`,
                    'aria-pressed': String(c.color === seat.color),
                    'data-k': `color-${i}-${c.name}`,
                  },
                  on: { click: () => this.set(pickSeatColor(this.draft, i, c.color)) },
                }),
              ),
            ),
            h(
              'div',
              { class: 'seg', attrs: { role: 'group', 'aria-label': `Seat ${i + 1} controller` } },
              ...(['human', 'bot'] as const).map((c) =>
                h(
                  'button',
                  {
                    class: `seg-btn${seat.controller === c ? ' is-on' : ''}`,
                    attrs: {
                      'aria-pressed': String(seat.controller === c),
                      'data-k': `ctl-${i}-${c}`,
                    },
                    on: {
                      click: () =>
                        this.set({
                          ...this.draft,
                          seats: this.draft.seats.map((s, j) =>
                            j === i ? { ...s, controller: c } : s,
                          ),
                        }),
                    },
                  },
                  c === 'human' ? 'Human' : 'Bot',
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
