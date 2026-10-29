/**
 * The new-game setup screen: stacked sections (mode, map, rules, advanced, seats) and a sticky
 * Start button. Owns its draft; emits a `NewGameConfig` through `onStart`.
 */
import { botLevelSelect } from '../botLevel';
import { h, type Child } from '../dom';
import { themePicker } from '../theme';
import { soundControl } from '../sound';
import type { MapId, NewGameConfig } from '../types';
import { mapPreviewSvg } from './mapPreviews';
import {
  chipNotes,
  chipStates,
  modeLabel,
  pickScenario,
  scenarioGroups,
  toggleChip,
  type ScenarioEntry,
} from './modePicker';
import {
  addSeat,
  buildConfig,
  setupError,
  clamp,
  clockLabel,
  CLOCK_OPTIONS,
  CUSTOM_BANK_MIN,
  CUSTOM_INCREMENT_SEC,
  MAP_RULE_OPTIONS,
  mapRulesApply,
  mapSelectionOf,
  mapSelectionOptions,
  ROBBER_OPTIONS,
  RULES56_SEATS,
  RULES56_VP,
  SECOND_SETTLER_MIN_PLAYERS,
  SETUP_BUILDING_OPTIONS,
  SETUP_RESTRICTION_OPTIONS,
  setClockPreset,
  setSetupRound,
  setTimerIdx,
  toggle,
  type ToggleKey,
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
  removeSeat,
  saveSetup,
  scenarioOf,
  SEAT_COLORS,
  SEED_MAX,
  setMap,
  setMode,
  setOption,
  setPlayerCount,
  visibleModes,
  TIMER_STEPS,
  timerLabel,
  VP_MAX,
  VP_MIN,
  type SetupDraft,
  type SetupStorage,
} from './model';
import './setup.css';
import { seatLookButton, withProfileLook } from '../profile/seatLook';
import { loadProfile, type AvatarRef, type PieceStyleId } from '../profile/model';

/** A seat with a new picture / piece style (classic and no picture are stored as absent). */
function withLook<T extends { avatar?: string; pieceStyle?: PieceStyleId }>(
  seat: T,
  look: { avatar: AvatarRef | null; pieceStyle: PieceStyleId },
): T {
  const { avatar: _a, pieceStyle: _p, ...rest } = seat;
  return {
    ...rest,
    ...(look.avatar ? { avatar: look.avatar } : {}),
    ...(look.pieceStyle !== 'classic' ? { pieceStyle: look.pieceStyle } : {}),
  } as T;
}

/** The setup storage as the profile's KeyStore (same localStorage). */
function keyStoreOf(s: SetupStorage) {
  return { get: (k: string) => s.getItem(k), set: (k: string, v: string) => s.setItem(k, v) };
}

export interface SetupScreenOptions {
  onStart: (cfg: NewGameConfig) => void;
  /** Present when there is a game to go back to. */
  onBack?: () => void;
  /** "Learn to play" (src/ui/tutorial): starts the tutorial game instead. Absent = no button. */
  onTutorial?: () => void;
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
  cards: `<rect x="5" y="7" width="15" height="21" rx="3" fill="currentColor" opacity=".16" transform="rotate(-10 12 17)"/>
    <rect x="5" y="7" width="15" height="21" rx="3" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(-10 12 17)"/>
    <rect x="12" y="4" width="15" height="21" rx="3" fill="currentColor" opacity=".16"/>
    <rect x="12" y="4" width="15" height="21" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M19.5 9.5l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="currentColor"/>`,
  rush: `<path d="M18 3 7 18h8l-2 11 11-15h-8z" fill="currentColor" opacity=".18"/>
    <path d="M18 3 7 18h8l-2 11 11-15h-8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
  turbo: `<path d="M4 8l10 8-10 8zM16 8l10 8-10 8z" fill="currentColor" opacity=".18"/>
    <path d="M4 8l10 8-10 8zM16 8l10 8-10 8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
  seats: `<g fill="currentColor" opacity=".18"><circle cx="16" cy="9" r="4.5"/><circle cx="7" cy="14" r="3.5"/><circle cx="25" cy="14" r="3.5"/></g>
    <g fill="none" stroke="currentColor" stroke-width="2"><circle cx="16" cy="9" r="4.5"/><circle cx="7" cy="14" r="3.5"/><circle cx="25" cy="14" r="3.5"/>
    <path d="M7 27c0-5 4-8 9-8s9 3 9 8z" stroke-linejoin="round"/></g>`,
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
    // PR1: seat 1 wears the local profile unless it has a look of its own.
    if (this.storage) {
      const profile = loadProfile(keyStoreOf(this.storage));
      this.draft = { ...this.draft, seats: withProfileLook(this.draft.seats, profile) };
    }
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
          soundControl({ compact: true }),
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
    // A combination the engine refuses (an expansion's validate): say why, no Start.
    const error = setupError(d);
    this.summary.replaceChildren(
      h('strong', {}, title),
      ` · ${d.seats.length} players · ${d.vpToWin} VP`,
      TIMER_STEPS[d.timerIdx] ? ` · ${timerLabel(d.timerIdx)} timer` : '',
      d.clockPreset !== 'off' ? ` · ${clockLabel(d)} clock` : '',
      error ? h('span', { class: 'su-error', attrs: { role: 'alert' } }, error) : '',
    );
    const start = this.element.querySelector<HTMLButtonElement>('.su-start');
    if (start) start.disabled = error !== null;
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
        this.opts.onTutorial &&
          h(
            'button',
            {
              class: 'btn su-learn',
              title: 'A guided first game against two easy bots that teaches the rules',
              attrs: { 'data-k': 'learn' },
              on: { click: () => this.opts.onTutorial?.() },
            },
            h('span', { class: 'su-learn-q', attrs: { 'aria-hidden': 'true' } }, '?'),
            h('span', {}, h('b', {}, 'Learn to play'), h('small', {}, 'New here? Start with this')),
          ),
      ),
      this.modeSection(),
      this.mapSection(),
      this.balanceSection(),
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

  /**
   * Expansion chips (src/ui/setup/modePicker.ts, from the engine registry): none on = base. A
   * line names the resulting mode; chips that can't toggle are disabled, their reasons below.
   */
  private modeSection(): HTMLElement {
    const d = this.draft;
    const chips = chipStates(d, this.showAllModes);
    const mode = modeOf(d);
    return this.section(
      'Game mode',
      'mode',
      h(
        'p',
        { class: 'su-mode-base' },
        h('strong', {}, 'Base game'),
        h('span', { class: 'su-mode-tick', attrs: { 'aria-label': 'included' } }, '✓'),
      ),
      h('p', { class: 'su-mode-add', id: 'su-mode-add' }, 'Add expansions:'),
      h(
        'div',
        { class: 'su-chips', attrs: { role: 'group', 'aria-labelledby': 'su-mode-add' } },
        ...chips.map((c) =>
          h(
            'button',
            {
              class: `su-chip${c.on ? ' is-on' : ''}`,
              disabled: c.reason !== null,
              title: c.reason ?? `${c.on ? 'Remove' : 'Add'} ${c.name}`,
              attrs: { 'aria-pressed': String(c.on), 'data-k': `chip-${c.id}` },
              on: { click: () => this.set(toggleChip(this.draft, c.id, this.showAllModes)) },
            },
            h('span', { class: 'su-chip-ico', attrs: { 'aria-hidden': 'true' } }, c.icon),
            h('span', { class: 'su-chip-name' }, c.name),
            h(
              'span',
              { class: 'su-chip-mark', attrs: { 'aria-hidden': 'true' } },
              c.on ? '✓' : '+',
            ),
          ),
        ),
      ),
      h(
        'p',
        { class: 'su-mode-result', attrs: { 'aria-live': 'polite', 'data-k': 'mode-result' } },
        h('span', { class: 'su-mode-arrow', attrs: { 'aria-hidden': 'true' } }, '→'),
        h('strong', {}, modeLabel(d)),
        mode.status !== 'ready' && h('span', { class: 'su-mode-status' }, mode.status),
      ),
      h(
        'ul',
        { class: 'su-mode-notes' },
        ...chipNotes(chips).map((n) => h('li', {}, `${n.names.join(', ')}: ${n.reason}`)),
      ),
    );
  }

  /**
   * Expansion modes: one tile per scenario (map preview, seats, VP) of every mode of the chip
   * selection, grouped under the mode's name when the selection stands for several modes.
   */
  private scenarioSection(): HTMLElement {
    const d = this.draft;
    const n = d.seats.length;
    const groups = scenarioGroups(d, this.showAllModes);
    const tiles = (entries: ScenarioEntry[], label: Record<string, string>) =>
      h(
        'div',
        { class: 'su-tiles su-maps', attrs: { role: 'group', ...label } },
        ...entries.map((e) => {
          const { min, max } = e.players;
          const on = d.mode === e.mode.id && d.scenario === e.scenario.id;
          return h(
            'button',
            {
              class: `su-tile su-map${on ? ' is-on' : ''}`,
              title: `${e.scenario.name}: ${e.scenario.blurb}`,
              attrs: {
                'aria-pressed': String(on),
                'data-k': e.key,
                'data-mode': e.mode.id,
                'data-scenario': e.scenario.id,
              },
              on: {
                click: () => this.set(pickScenario(this.draft, e.mode.id, e.scenario.id)),
              },
            },
            h(
              'span',
              { class: 'su-map-art' },
              mapPreviewSvg(e.scenario.mapFor(clamp(n, min, max))),
            ),
            h('span', { class: 'su-tile-title' }, e.scenario.name),
            h(
              'span',
              { class: 'su-tile-sub' },
              `${min === max ? min : `${min}–${max}`} players · ${e.vp} VP`,
            ),
          );
        }),
      );
    const [only] = groups;
    return this.section(
      'Scenario',
      'map',
      ...(groups.length === 1 && only
        ? [tiles(only.entries, { 'aria-labelledby': 'su-h-map' })]
        : groups.map((g) =>
            h(
              'div',
              { class: 'su-scen-group' },
              h(
                'h3',
                { class: 'su-scen-head' },
                g.mode.name,
                h('span', { class: 'su-scen-blurb' }, g.mode.blurb),
              ),
              tiles(g.entries, { 'aria-label': g.mode.name }),
            ),
          )),
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

  /** Which neighbouring hexes may touch on random maps (all off = every constraint on). */
  private balanceSection(): HTMLElement {
    const d = this.draft;
    const applies = mapRulesApply(d);
    return this.section(
      'Balance rules',
      'balance',
      h(
        'div',
        { class: 'su-card su-card-wide', attrs: { role: 'group', 'aria-label': 'Balance rules' } },
        ...MAP_RULE_OPTIONS.map((o) => this.switchRow(o.key, o.title, o.desc, !applies)),
        h(
          'p',
          { class: 'su-hint', attrs: { 'data-v': 'balance-note' } },
          applies
            ? 'Random maps only: with a switch off, the generator keeps those hexes apart.'
            : d.mode !== 'base'
              ? 'Scenario maps come with their own layout rules, so these do not apply.'
              : 'The official beginner layout is fixed, so these do not apply. Pick a random map to use them.',
        ),
      ),
    );
  }

  private rulesSection(): HTMLElement {
    const d = this.draft;
    const rule = (key: ToggleKey, ico: keyof typeof ICON, title: string, desc: string) =>
      h(
        'button',
        {
          class: `su-tile su-rule${d[key] ? ' is-on' : ''}`,
          title: desc,
          attrs: { 'aria-pressed': String(d[key]), 'data-k': `rule-${key}` },
          on: { click: () => this.set(toggle(this.draft, key)) },
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
        rule(
          'eventCards',
          'cards',
          'Event Cards',
          'A 36-card event deck replaces the dice: same odds, plus events.',
        ),
        rule(
          'rushMode',
          'rush',
          'Rush Mode',
          'Dice roll by themselves at the start of each turn. Sets discard 9 and the friendly robber.',
        ),
        rule(
          'turboMode',
          'turbo',
          'Turbo Mode',
          'Both starting settlements pay resources, for a faster start.',
        ),
        d.seats.length >= RULES56_SEATS &&
          rule(
            'rules56',
            'seats',
            '5+ player rules',
            `Play one dev card in the build phase. Robber stays off the 2nd desert. Suggests ${RULES56_VP} VP.`,
          ),
        ...this.optionTiles(),
      ),
    );
  }

  /** Compact select inside a card. `key` is the data-k of the select. */
  private select<T extends string>(
    label: string,
    key: string,
    options: readonly { id: T; label: string; desc?: string }[],
    value: T,
    onChange: (v: T) => void,
  ): HTMLElement {
    return h(
      'label',
      { class: 'su-field' },
      h('span', {}, label),
      h(
        'select',
        {
          class: 'input su-select',
          attrs: { 'aria-label': label, 'data-k': key },
          on: { change: (e) => onChange((e.target as HTMLSelectElement).value as T) },
        },
        ...options.map((o) =>
          h(
            'option',
            { attrs: { value: o.id, ...(o.id === value ? { selected: '' } : {}) } },
            o.label,
          ),
        ),
      ),
    );
  }

  private switchRow(key: ToggleKey, title: string, desc: string, disabled = false): HTMLElement {
    const on = this.draft[key];
    return h(
      'button',
      {
        class: `su-switchrow${on ? ' is-on' : ''}`,
        title: desc,
        disabled,
        attrs: { 'aria-pressed': String(on), 'data-k': `rule-${key}` },
        on: { click: () => this.set(toggle(this.draft, key)) },
      },
      h(
        'span',
        { class: 'su-rule-text' },
        h('span', { class: 'su-switch-title' }, title),
        h('span', { class: 'su-tile-sub' }, desc),
      ),
      h('span', { class: 'su-switch', attrs: { 'aria-hidden': 'true' } }, h('i')),
    );
  }

  private variantCards(): HTMLElement[] {
    const d = this.draft;
    const robber = ROBBER_OPTIONS.find((o) => o.id === d.robberMode);
    const mapSelOptions = mapSelectionOptions(d);
    const mapSel = mapSelOptions.find((o) => o.id === mapSelectionOf(d));
    const custom = d.clockPreset === 'custom';
    const num = (
      key: string,
      label: string,
      value: number,
      r: { min: number; max: number },
      set: (v: number) => void,
    ) =>
      h(
        'label',
        { class: 'su-field su-field-num' },
        h('span', {}, label),
        h('input', {
          class: 'input',
          type: 'number',
          value: String(value),
          attrs: {
            min: String(r.min),
            max: String(r.max),
            step: '1',
            'aria-label': label,
            'data-k': key,
          },
          on: {
            change: (e) => {
              const v = Number((e.target as HTMLInputElement).value);
              set(Number.isFinite(v) ? clamp(Math.round(v), r.min, r.max) : value);
            },
          },
        }),
      );
    const round = (r: 'first' | 'second', n: string) =>
      h(
        'div',
        { class: 'su-pair' },
        this.select(
          `${n} building`,
          `setup-${r}-building`,
          SETUP_BUILDING_OPTIONS,
          d.setupPlacement[r].building,
          (v) => this.set(setSetupRound(this.draft, r, { building: v })),
        ),
        this.select(
          `${n} restriction`,
          `setup-${r}-restriction`,
          SETUP_RESTRICTION_OPTIONS,
          d.setupPlacement[r].restriction,
          (v) => this.set(setSetupRound(this.draft, r, { restriction: v })),
        ),
      );
    return [
      h(
        'div',
        { class: 'su-card', attrs: { role: 'group', 'aria-label': 'Robber' } },
        this.select('Robber', 'robber', ROBBER_OPTIONS, d.robberMode, (v) =>
          this.set({ ...this.draft, robberMode: v }),
        ),
        h('p', { class: 'su-hint' }, robber?.desc ?? ''),
      ),
      h(
        'div',
        { class: 'su-card', attrs: { role: 'group', 'aria-label': 'Chess clock' } },
        this.select('Chess clock', 'clock', CLOCK_OPTIONS, d.clockPreset, (v) =>
          this.set(setClockPreset(this.draft, v)),
        ),
        custom
          ? h(
              'div',
              { class: 'su-pair' },
              num('clock-bank', 'Bank (min)', d.customBankMin, CUSTOM_BANK_MIN, (v) =>
                this.set({ ...this.draft, customBankMin: v }),
              ),
              num('clock-inc', 'Per turn (s)', d.customIncrementSec, CUSTOM_INCREMENT_SEC, (v) =>
                this.set({ ...this.draft, customIncrementSec: v }),
              ),
            )
          : h(
              'p',
              { class: 'su-hint', attrs: { 'data-v': 'clock' } },
              d.clockPreset === 'off'
                ? 'Bank per player + time added each turn'
                : `${clockLabel(d)} per player`,
            ),
      ),
      h(
        'div',
        { class: 'su-card', attrs: { role: 'group', 'aria-label': 'Map selection' } },
        this.select('Map selection', 'mapSelection', mapSelOptions, mapSelectionOf(d), (v) =>
          this.set({ ...this.draft, mapSelection: v }),
        ),
        h('p', { class: 'su-hint' }, mapSel?.desc ?? ''),
      ),
      h(
        'div',
        { class: 'su-card', attrs: { role: 'group', 'aria-label': 'Turn order' } },
        this.switchRow(
          'randomTurnOrder',
          'Randomize Turn Order',
          'Shuffle the seats when the game starts',
        ),
        this.switchRow(
          'secondSettler',
          'Second Settler Mode',
          d.seats.length < SECOND_SETTLER_MIN_PLAYERS
            ? 'Needs 4+ players'
            : 'Paired turns: the 3rd player to the left builds after each turn',
          d.seats.length < SECOND_SETTLER_MIN_PLAYERS,
        ),
      ),
      h(
        'div',
        {
          class: 'su-card su-card-wide',
          attrs: { role: 'group', 'aria-label': 'Setup placement' },
        },
        h('div', { class: 'su-card-title' }, 'Setup placement'),
        round('first', '1st'),
        round('second', '2nd'),
      ),
    ];
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
          (dir) => this.set(setTimerIdx(this.draft, this.draft.timerIdx + dir)),
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
        ...this.variantCards(),
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
    const range = playerRange(d);
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
            seatLookButton(seat, i, (look) =>
              this.set({
                ...this.draft,
                seats: this.draft.seats.map((s, j) => (j === i ? withLook(s, look) : s)),
              }),
            ),
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
            botLevelSelect(seat.botLevel, { seat: i, hidden: seat.controller !== 'bot' }, (level) =>
              this.set({
                ...this.draft,
                seats: this.draft.seats.map((s, j) => (j === i ? { ...s, botLevel: level } : s)),
              }),
            ),
            h(
              'button',
              {
                class: 'su-seat-x',
                disabled: d.seats.length <= range.min,
                title: d.seats.length <= range.min ? `At least ${range.min} players` : 'Remove',
                attrs: { 'aria-label': `Remove seat ${i + 1}`, 'data-k': `remove-${i}` },
                on: { click: () => this.set(removeSeat(this.draft, i)) },
              },
              '×',
            ),
          ),
        ),
      ),
      h(
        'button',
        {
          class: 'btn su-add-seat',
          disabled: d.seats.length >= range.max,
          title: d.seats.length >= range.max ? `At most ${range.max} players` : undefined,
          attrs: { 'data-k': 'add-seat' },
          on: { click: () => this.set(addSeat(this.draft)) },
        },
        '+ Add player',
      ),
    );
  }
}
