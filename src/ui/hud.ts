/**
 * The HUD: HTML overlay on top of the Pixi canvas. Never mutates state, never calls applyAction.
 * Everything clickable is enabled from `view.legal` only; clicks emit Actions (or 'placeMode').
 */
import {
  emptyResources,
  getPlayer,
  RESOURCES,
  victoryPoints,
  type Action,
  type GameState,
  type PlayerId,
  type Resource,
  type ResourceCounts,
} from '../engine';
import {
  discardAction,
  draftToAction,
  emptyDraft,
  stepDiscard,
  stepDraft,
  toggleRecipient,
  validateDiscard,
  validateDraft,
  type TradeDraft,
} from './composer';
import { SetupScreen } from './setup/screen';
import { h, type Child } from './dom';
import { dieFace, RESOURCE_LABEL, resourceIcon } from './icons';
import {
  availability,
  bestRatios,
  devCardRows,
  DEV_CARD_INFO,
  diceTotal,
  findBankTrade,
  findYearOfPlenty,
  hintFor,
  ofType,
  placeModeAvailable,
  playerSummaries,
  viewerLegal,
  type Availability,
} from './model';
import type { HudEventName, HudEvents, HudView, PlaceMode } from './types';
import './hud.css';

type Listeners = { [E in HudEventName]: ((payload: HudEvents[E]) => void)[] };
type Dialog = null | 'bank' | 'trade' | 'yop' | 'monopoly';

const COSTS_TEXT: Record<PlaceMode | 'dev', string> = {
  road: '1 brick + 1 lumber',
  settlement: '1 brick, 1 lumber, 1 wool, 1 grain',
  city: '2 grain + 3 ore',
  dev: '1 wool, 1 grain, 1 ore',
};

export class Hud {
  private readonly root: HTMLElement;
  private readonly regions: Record<
    'players' | 'hint' | 'dice' | 'log' | 'bottom' | 'dialog' | 'overlay',
    HTMLElement
  >;
  private listeners: Listeners = { action: [], newGame: [], placeMode: [] };

  private state: GameState | null = null;
  private view: HudView | null = null;

  // Local UI state (never game state).
  private placeMode: PlaceMode | null = null;
  private dialog: Dialog = null;
  private bankGive: Resource | null = null;
  private bankReceive: Resource | null = null;
  private yopFirst: Resource | null = null;
  private draft: TradeDraft = emptyDraft([]);
  private discardSel: ResourceCounts = emptyResources();
  private setup: SetupScreen | null = null;
  private newGameOpen = false;
  /** The viewer who has been shown the screen (hotseat cover compares against this). */
  private unlockedViewer: PlayerId | null = null;
  private pieceSig = '';
  private lastDice = '';
  private lastDialogKey = '';
  private lastLogLength = -1;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.placeMode) this.setPlaceMode(null);
  };

  constructor(root: HTMLElement) {
    this.root = root;
    root.classList.add('catan-hud');
    const mk = (cls: string) => h('div', { class: cls });
    this.regions = {
      players: mk('hud-players'),
      hint: mk('hud-hint-wrap'),
      dice: mk('hud-dice-wrap'),
      log: mk('hud-log-wrap'),
      bottom: mk('hud-bottom'),
      dialog: mk('hud-dialog-layer'),
      overlay: mk('hud-overlay-layer'),
    };
    root.replaceChildren(...Object.values(this.regions));
    document.addEventListener('keydown', this.onKey);
  }

  /** Remove listeners and DOM. */
  destroy(): void {
    document.removeEventListener('keydown', this.onKey);
    this.root.replaceChildren();
    this.root.classList.remove('catan-hud');
  }

  on<E extends HudEventName>(event: E, cb: (payload: HudEvents[E]) => void): void {
    this.listeners[event].push(cb);
  }

  private emit<E extends HudEventName>(event: E, payload: HudEvents[E]): void {
    for (const cb of this.listeners[event]) cb(payload);
  }

  /** Open the new-game screen (also what the winner screen's button does). */
  showNewGame(): void {
    this.newGameOpen = true;
    // A fresh screen each time: it reloads the remembered settings.
    this.setup = null;
    this.refresh();
  }

  hideNewGame(): void {
    this.newGameOpen = false;
    this.setup = null;
    this.refresh();
  }

  render(state: GameState, view: HudView): void {
    this.state = state;
    this.view = view;
    this.syncLocalState(state, view);
    this.refresh();
  }

  // -------------------------------------------------------------------------
  // Local state housekeeping
  // -------------------------------------------------------------------------

  private syncLocalState(state: GameState, view: HudView): void {
    const legal = viewerLegal(view);
    const av = availability(legal);

    if (this.unlockedViewer === null) this.unlockedViewer = view.viewer;

    // Leave build mode after anything was placed, or when it stops being legal.
    const sig = `${Object.keys(state.pieces.buildings).length}/${Object.keys(state.pieces.roads).length}/${state.turn.number}/${state.phase.kind}`;
    const sigChanged = sig !== this.pieceSig;
    this.pieceSig = sig;
    if (this.placeMode && (sigChanged || !placeModeAvailable(av, this.placeMode))) {
      this.setPlaceMode(null);
    }

    // Close dialogs whose actions are no longer legal.
    if (this.dialog === 'bank' && !av.bankTrade) this.dialog = null;
    if (this.dialog === 'trade' && !av.offerTrade) this.dialog = null;
    if (this.dialog === 'yop' && !av.playYearOfPlenty) this.dialog = null;
    if (this.dialog === 'monopoly' && !av.playMonopoly) this.dialog = null;
    if (this.dialog !== 'bank') this.bankGive = this.bankReceive = null;
    if (this.dialog !== 'yop') this.yopFirst = null;

    // Fresh draft per turn / viewer; recipients default to everyone else.
    const others = state.players.filter((p) => p.id !== view.viewer).map((p) => p.id);
    if (this.dialog !== 'trade') this.draft = emptyDraft(others);
    this.draft = { ...this.draft, to: this.draft.to.filter((p) => others.includes(p)) };

    if (state.phase.kind !== 'discard') this.discardSel = emptyResources();
  }

  private setPlaceMode(mode: PlaceMode | null): void {
    if (this.placeMode === mode) return;
    this.placeMode = mode;
    this.emit('placeMode', mode);
    if (this.view) this.refresh();
  }

  private send(a: Action): void {
    this.dialog = null;
    this.emit('action', a);
  }

  private open(d: Dialog): void {
    if (d !== 'trade') this.setPlaceMode(null);
    this.dialog = d;
    this.refresh();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private refresh(): void {
    const r = this.regions;
    const state = this.state;
    const view = this.view;

    if (this.newGameOpen) {
      this.setup ??= this.newSetupScreen();
      r.overlay.replaceChildren(this.setup.element);
      this.root.classList.add('is-covered');
      for (const k of ['players', 'hint', 'dice', 'log', 'bottom', 'dialog'] as const) {
        r[k].replaceChildren();
      }
      return;
    }
    if (!state || !view) {
      r.overlay.replaceChildren();
      this.root.classList.remove('is-covered');
      return;
    }

    const covered =
      state.phase.kind !== 'gameOver' &&
      this.unlockedViewer !== null &&
      this.unlockedViewer !== view.viewer;
    this.root.classList.toggle('is-covered', covered);
    if (covered) {
      for (const k of ['players', 'hint', 'dice', 'log', 'bottom', 'dialog'] as const) {
        r[k].replaceChildren();
      }
      r.overlay.replaceChildren(this.coverScreen(state, view));
      return;
    }

    const legal = viewerLegal(view);
    const av = availability(legal);

    r.players.replaceChildren(...this.playerPanels(state, view));
    r.hint.replaceChildren(...this.hintBanner(state, view));
    r.dice.replaceChildren(...this.diceBox(state));
    this.renderLog(state);
    r.bottom.replaceChildren(...this.bottomBar(state, view, av));
    this.renderDialog(state, view, legal);
    r.overlay.replaceChildren(
      ...(state.phase.kind === 'gameOver' ? [this.winnerScreen(state)] : []),
    );
  }

  // --- players -------------------------------------------------------------

  private playerPanels(state: GameState, view: HudView): HTMLElement[] {
    return playerSummaries(state, view.viewer).map((p) => {
      const badges = [
        p.longestRoad &&
          h('span', { class: 'badge', title: 'Longest Road (+2 VP)' }, '🛣️', 'Longest Road'),
        p.largestArmy &&
          h('span', { class: 'badge', title: 'Largest Army (+2 VP)' }, '⚔️', 'Largest Army'),
      ];
      return h(
        'div',
        {
          class: `pp${p.isCurrent ? ' is-current' : ''}${p.id === view.viewer ? ' is-you' : ''}${p.isActing && !p.isCurrent ? ' is-acting' : ''}`,
          style: { '--pc': p.color },
        },
        h(
          'div',
          { class: 'pp-head' },
          h('span', { class: 'pp-dot' }),
          h('span', { class: 'pp-name' }, p.name),
          p.id === view.viewer && h('span', { class: 'tag' }, 'you'),
          p.isCurrent && h('span', { class: 'turn-pip', title: 'Current turn' }),
          h(
            'span',
            { class: 'pp-vp', title: 'Victory points (public)' },
            String(p.publicVp),
            h('small', {}, 'VP'),
          ),
        ),
        h(
          'div',
          { class: 'pp-stats' },
          h('span', { title: 'Resource cards in hand' }, '🃏 ', String(p.cards)),
          h('span', { title: 'Development cards' }, '🎴 ', String(p.devCards)),
          h('span', { title: 'Knights played' }, '⚔️ ', String(p.knights)),
          p.hiddenVp > 0 &&
            h(
              'span',
              { class: 'hidden-vp', title: 'Hidden VP cards (only you see this)' },
              `+${p.hiddenVp} hidden`,
            ),
        ),
        badges.some(Boolean) && h('div', { class: 'pp-badges' }, ...badges),
      );
    });
  }

  private hintBanner(state: GameState, view: HudView): HTMLElement[] {
    const hint = hintFor(state, view, this.placeMode);
    if (!hint) return [];
    return [
      h(
        'div',
        { class: `hint hint-${hint.tone}`, attrs: { role: 'status' } },
        hint.text,
        this.placeMode &&
          h(
            'button',
            { class: 'btn btn-ghost btn-sm', on: { click: () => this.setPlaceMode(null) } },
            'Cancel',
          ),
      ),
    ];
  }

  private diceBox(state: GameState): HTMLElement[] {
    const d = state.dice;
    if (!d)
      return [h('div', { class: 'dice dice-empty' }, h('span', { class: 'dice-label' }, 'Dice'))];
    const key = `${state.turn.number}:${d[0]}:${d[1]}`;
    const fresh = key !== this.lastDice;
    this.lastDice = key;
    const total = diceTotal(d);
    return [
      h(
        'div',
        { class: `dice${fresh ? ' rolling' : ''}${total === 7 ? ' is-seven' : ''}` },
        dieFace(d[0]),
        dieFace(d[1]),
        h('span', { class: 'dice-total', title: 'Last roll' }, String(total)),
      ),
    ];
  }

  private renderLog(state: GameState): void {
    const box = this.regions.log;
    const old = box.querySelector('.log-list');
    const wasAtBottom = !old || old.scrollTop + old.clientHeight >= old.scrollHeight - 8;
    const prevTop = old ? old.scrollTop : 0;
    const list = h(
      'div',
      { class: 'log-list' },
      ...state.log.map((e) => {
        const p = e.player === null ? undefined : state.players[e.player];
        return h(
          'div',
          { class: 'log-row', style: { '--pc': p?.color ?? 'transparent' } },
          h('span', { class: 'log-turn' }, e.turn > 0 ? `T${e.turn}` : 'Setup'),
          h('span', { class: 'log-text' }, e.text),
        );
      }),
    );
    box.replaceChildren(h('div', { class: 'log-title' }, 'Game log'), list);
    const grew = state.log.length !== this.lastLogLength;
    this.lastLogLength = state.log.length;
    list.scrollTop = grew && wasAtBottom ? list.scrollHeight : prevTop;
  }

  // --- hand & actions ------------------------------------------------------

  private bottomBar(state: GameState, view: HudView, av: Availability): HTMLElement[] {
    const me = getPlayer(state, view.viewer);
    const legal = viewerLegal(view);
    const over = state.phase.kind === 'gameOver';

    const actionBtn = (
      label: string,
      icon: string,
      enabled: boolean,
      onClick: () => void,
      opts: { title?: string; primary?: boolean; active?: boolean } = {},
    ) =>
      h(
        'button',
        {
          class: `btn act${opts.primary ? ' btn-primary' : ''}${opts.active ? ' is-active' : ''}`,
          disabled: !enabled || over,
          title: opts.title ?? '',
          on: { click: onClick },
        },
        h('span', { class: 'act-ico' }, icon),
        h('span', {}, label),
      );

    const toggleMode = (m: PlaceMode) => () => this.setPlaceMode(this.placeMode === m ? null : m);

    const actions = h(
      'div',
      { class: 'actions' },
      actionBtn(
        'Roll dice',
        '🎲',
        av.roll,
        () => this.send({ type: 'rollDice', player: view.viewer }),
        { primary: av.roll },
      ),
      h('span', { class: 'sep' }),
      actionBtn('Road', '🛣️', av.buildRoad, toggleMode('road'), {
        title: `Cost: ${COSTS_TEXT.road}`,
        active: this.placeMode === 'road',
      }),
      actionBtn('Settlement', '🏠', av.buildSettlement, toggleMode('settlement'), {
        title: `Cost: ${COSTS_TEXT.settlement}`,
        active: this.placeMode === 'settlement',
      }),
      actionBtn('City', '🏙️', av.buildCity, toggleMode('city'), {
        title: `Cost: ${COSTS_TEXT.city}`,
        active: this.placeMode === 'city',
      }),
      actionBtn(
        'Buy card',
        '🎴',
        av.buyDevCard,
        () => this.send({ type: 'buyDevCard', player: view.viewer }),
        { title: `Cost: ${COSTS_TEXT.dev}` },
      ),
      h('span', { class: 'sep' }),
      actionBtn('Bank', '🏦', av.bankTrade, () => this.open('bank'), {
        active: this.dialog === 'bank',
      }),
      actionBtn('Trade', '🤝', av.offerTrade, () => this.open('trade'), {
        active: this.dialog === 'trade',
      }),
      h('span', { class: 'sep' }),
      av.passSpecialBuild
        ? actionBtn(
            'Pass',
            '⏭️',
            true,
            () => this.send({ type: 'passSpecialBuild', player: view.viewer }),
            { primary: true, title: 'End your special build step' },
          )
        : actionBtn(
            'End turn',
            '⏭️',
            av.endTurn,
            () => this.send({ type: 'endTurn', player: view.viewer }),
            { primary: av.endTurn && !av.roll },
          ),
    );

    const ratios = bestRatios(state, view.viewer);
    const cards = h(
      'div',
      { class: 'hand' },
      ...RESOURCES.map((r) =>
        h(
          'div',
          {
            class: `rcard rc-${r}${me.resources[r] === 0 ? ' is-zero' : ''}`,
            title: `${RESOURCE_LABEL[r]} — bank ratio ${ratios[r]}:1`,
          },
          resourceIcon(r, 30),
          h('span', { class: 'rc-count' }, String(me.resources[r])),
          h('span', { class: 'rc-name' }, RESOURCE_LABEL[r]),
          h('span', { class: `rc-ratio r${ratios[r]}` }, `${ratios[r]}:1`),
        ),
      ),
    );

    const rows = devCardRows(state, view.viewer, legal);
    const devOpen = (type: string) =>
      type === 'knight'
        ? () => this.send({ type: 'playKnight', player: view.viewer })
        : type === 'roadBuilding'
          ? () => this.send({ type: 'playRoadBuilding', player: view.viewer })
          : type === 'yearOfPlenty'
            ? () => this.open('yop')
            : () => this.open('monopoly');
    const dev = h(
      'div',
      { class: 'devs' },
      rows.length === 0 && h('span', { class: 'muted' }, 'No development cards'),
      ...rows.map((row) => {
        const info = DEV_CARD_INFO[row.type];
        const playable = row.type !== 'victoryPoint';
        return h(
          'button',
          {
            class: `dcard${row.canPlay ? ' can-play' : ''}${row.type === 'victoryPoint' ? ' is-vp' : ''}`,
            disabled: !row.canPlay || over,
            title: `${info.name}: ${info.blurb}${row.fresh > 0 ? ' (new cards can be played next turn)' : ''}`,
            on: { click: playable ? devOpen(row.type) : () => undefined },
          },
          h('span', { class: 'dc-ico' }, info.icon),
          h('span', { class: 'dc-name' }, info.name),
          h(
            'span',
            { class: 'dc-counts' },
            row.ready > 0 && h('b', {}, `×${row.ready}`),
            row.fresh > 0 && h('em', { title: 'Bought this turn' }, `+${row.fresh} new`),
          ),
        );
      }),
    );

    return [actions, h('div', { class: 'hand-row' }, cards, h('span', { class: 'vsep' }), dev)];
  }

  // --- dialogs -------------------------------------------------------------

  private renderDialog(state: GameState, view: HudView, legal: Action[]): void {
    const layer = this.regions.dialog;
    const built = this.pickDialog(state, view, legal);
    if (!built) {
      layer.replaceChildren();
      this.lastDialogKey = '';
      return;
    }
    const fresh = built.key !== this.lastDialogKey;
    this.lastDialogKey = built.key;
    layer.replaceChildren(
      h(
        'div',
        { class: `scrim${built.modal ? ' is-modal' : ''}${built.side ? ' is-side' : ''}` },
        h(
          'div',
          {
            class: `dialog${fresh ? ' enter' : ''}${built.wide ? ' wide' : ''}`,
            attrs: { role: 'dialog', 'aria-label': built.title },
          },
          h('h2', {}, built.title),
          ...built.body,
        ),
      ),
    );
  }

  private pickDialog(
    state: GameState,
    view: HudView,
    legal: Action[],
  ): {
    key: string;
    title: string;
    body: Child[];
    modal: boolean;
    wide?: boolean;
    /** Non-blocking card docked at the side instead of centred over the board. */
    side?: boolean;
  } | null {
    const phase = state.phase;
    const me = getPlayer(state, view.viewer);

    // Forced dialogs first.
    if (phase.kind === 'discard' && ofType(legal, 'discard').length > 0) {
      return this.discardDialog(view, me.resources, phase.pending[view.viewer] ?? 0);
    }
    if (phase.kind === 'steal') {
      const victims = ofType(legal, 'steal');
      // Always show the picker: the engine needs an explicit steal action even with one victim.
      if (victims.length > 0)
        return this.stealDialog(
          state,
          view,
          victims.map((v) => v.victim),
        );
    }
    if (phase.kind === 'trade') {
      const offer = phase.offer;
      if (offer.from === view.viewer) return this.offererDialog(state, legal);
      if (offer.responses[view.viewer] === 'pending')
        return this.responderDialog(state, view, legal);
      return null;
    }

    switch (this.dialog) {
      case 'bank':
        return this.bankDialog(state, view, legal);
      case 'trade':
        return this.composerDialog(state, view, me.resources);
      case 'yop':
        return this.yopDialog(legal);
      case 'monopoly':
        return this.monopolyDialog(legal);
      default:
        return null;
    }
  }

  private closeButton(label = 'Close'): HTMLElement {
    return h('button', { class: 'btn btn-ghost', on: { click: () => this.closeDialog() } }, label);
  }

  private closeDialog(): void {
    this.dialog = null;
    this.refresh();
  }

  private stepper(
    resource: Resource,
    value: number,
    onDelta: (d: number) => void,
    max: number,
  ): HTMLElement {
    return h(
      'div',
      {
        class: `step${value > 0 ? ' has-value' : ''}`,
        style: { '--rc': `var(--res-${resource})` },
      },
      resourceIcon(resource, 26),
      h('span', { class: 'step-name' }, RESOURCE_LABEL[resource]),
      h(
        'div',
        { class: 'step-ctl' },
        h(
          'button',
          {
            class: 'btn-round',
            disabled: value <= 0,
            title: 'Less',
            on: { click: () => onDelta(-1) },
          },
          '−',
        ),
        h('span', { class: 'step-val' }, String(value)),
        h(
          'button',
          {
            class: 'btn-round',
            disabled: value >= max,
            title: 'More',
            on: { click: () => onDelta(1) },
          },
          '+',
        ),
      ),
    );
  }

  private resourcePick(
    selected: Resource | null,
    allowed: (r: Resource) => boolean,
    onPick: (r: Resource) => void,
    extra?: (r: Resource) => Child,
  ): HTMLElement {
    return h(
      'div',
      { class: 'rpick' },
      ...RESOURCES.map((r) =>
        h(
          'button',
          {
            class: `rpick-btn${selected === r ? ' is-selected' : ''}`,
            disabled: !allowed(r),
            style: { '--rc': `var(--res-${r})` },
            on: { click: () => onPick(r) },
          },
          resourceIcon(r, 30),
          h('span', {}, RESOURCE_LABEL[r]),
          extra?.(r),
        ),
      ),
    );
  }

  private bankDialog(state: GameState, view: HudView, legal: Action[]) {
    const trades = ofType(legal, 'bankTrade');
    const ratios = bestRatios(state, view.viewer);
    const canGive = new Set(trades.map((t) => t.give));
    const give = this.bankGive;
    const receive = this.bankReceive;
    const action = give && receive ? findBankTrade(legal, give, receive) : undefined;
    const receivable = (r: Resource) =>
      give ? findBankTrade(legal, give, r) !== undefined : false;
    return {
      key: 'bank',
      title: 'Trade with the bank',
      modal: false,
      body: [
        h('p', { class: 'sub' }, 'Give'),
        this.resourcePick(
          give,
          (r) => canGive.has(r),
          (r) => {
            this.bankGive = r;
            if (this.bankReceive === r) this.bankReceive = null;
            this.refresh();
          },
          (r) => h('small', { class: `rc-ratio r${ratios[r]}` }, `${ratios[r]}:1`),
        ),
        h('p', { class: 'sub' }, 'Receive'),
        this.resourcePick(receive, receivable, (r) => {
          this.bankReceive = r;
          this.refresh();
        }),
        h(
          'p',
          { class: 'summary' },
          give && receive
            ? `Give ${ratios[give]} ${RESOURCE_LABEL[give].toLowerCase()} → get 1 ${RESOURCE_LABEL[receive].toLowerCase()}`
            : give
              ? 'Pick what you want to receive'
              : 'Pick a resource to give',
        ),
        h(
          'div',
          { class: 'dialog-actions' },
          this.closeButton('Cancel'),
          h(
            'button',
            {
              class: 'btn btn-primary',
              disabled: !action,
              on: { click: () => action && this.send(action) },
            },
            'Trade',
          ),
        ),
      ],
    };
  }

  private composerDialog(state: GameState, view: HudView, hand: ResourceCounts) {
    const draft = this.draft;
    const error = validateDraft(draft, hand);
    const built = draftToAction(view.viewer, draft, hand);
    const set = (next: TradeDraft) => {
      this.draft = next;
      this.refresh();
    };
    const others = state.players.filter((p) => p.id !== view.viewer);
    return {
      key: 'trade-compose',
      title: 'Offer a trade',
      modal: false,
      wide: true,
      body: [
        h(
          'div',
          { class: 'cols' },
          h(
            'div',
            { class: 'col' },
            h('p', { class: 'sub' }, 'You give'),
            ...RESOURCES.map((r) =>
              this.stepper(
                r,
                draft.give[r],
                (d) => set(stepDraft(draft, 'give', r, d, hand)),
                hand[r],
              ),
            ),
          ),
          h('div', { class: 'swap' }, '⇄'),
          h(
            'div',
            { class: 'col' },
            h('p', { class: 'sub' }, 'You want'),
            ...RESOURCES.map((r) =>
              this.stepper(r, draft.want[r], (d) => set(stepDraft(draft, 'want', r, d, hand)), 9),
            ),
          ),
        ),
        h('p', { class: 'sub' }, 'Offer to'),
        h(
          'div',
          { class: 'recipients' },
          ...others.map((p) =>
            h(
              'button',
              {
                class: `chip${draft.to.includes(p.id) ? ' is-on' : ''}`,
                style: { '--pc': p.color },
                on: { click: () => set(toggleRecipient(draft, p.id)) },
              },
              h('span', { class: 'pp-dot' }),
              p.name,
            ),
          ),
        ),
        h('p', { class: `summary${error ? ' is-error' : ''}` }, error ?? 'Ready to send'),
        h(
          'div',
          { class: 'dialog-actions' },
          this.closeButton('Cancel'),
          h(
            'button',
            {
              class: 'btn btn-primary',
              disabled: built === null,
              on: { click: () => built && this.send(built) },
            },
            'Send offer',
          ),
        ),
      ],
    };
  }

  private bundleRow(bundle: ResourceCounts): HTMLElement {
    return h(
      'span',
      { class: 'bundle' },
      ...RESOURCES.filter((r) => bundle[r] > 0).map((r) =>
        h('span', { class: 'bundle-item' }, resourceIcon(r, 22), `×${bundle[r]}`),
      ),
    );
  }

  private offererDialog(state: GameState, legal: Action[]) {
    const offer = (state.phase as Extract<GameState['phase'], { kind: 'trade' }>).offer;
    const confirms = ofType(legal, 'confirmTrade');
    const cancel = ofType(legal, 'cancelTrade')[0];
    const rows = offer.responses.flatMap((resp, id) => {
      if (resp === null) return [];
      const p = state.players[id];
      if (!p) return [];
      const confirm = confirms.find((c) => c.partner === id);
      return [
        h(
          'div',
          { class: `resp resp-${resp}`, style: { '--pc': p.color } },
          h('span', { class: 'pp-dot' }),
          h('span', { class: 'resp-name' }, p.name),
          h(
            'span',
            { class: 'resp-status' },
            resp === 'pending' ? 'thinking…' : resp === 'accepted' ? '✔ accepted' : '✖ rejected',
          ),
          resp === 'accepted' &&
            h(
              'button',
              {
                class: 'btn btn-primary btn-sm',
                disabled: !confirm,
                on: { click: () => confirm && this.send(confirm) },
              },
              'Trade',
            ),
        ),
      ];
    });
    return {
      key: 'trade-offerer',
      title: 'Your trade offer',
      modal: false,
      side: true,
      body: [
        h(
          'div',
          { class: 'offer-line' },
          h('span', {}, 'You give'),
          this.bundleRow(offer.give),
          h('span', { class: 'swap' }, '⇄'),
          h('span', {}, 'you get'),
          this.bundleRow(offer.want),
        ),
        h('div', { class: 'resps' }, ...rows),
        h(
          'div',
          { class: 'dialog-actions' },
          h(
            'button',
            {
              class: 'btn btn-ghost',
              disabled: !cancel,
              on: { click: () => cancel && this.send(cancel) },
            },
            'Cancel offer',
          ),
        ),
      ],
    };
  }

  private responderDialog(state: GameState, view: HudView, legal: Action[]) {
    const offer = (state.phase as Extract<GameState['phase'], { kind: 'trade' }>).offer;
    const from = getPlayer(state, offer.from);
    const accept = ofType(legal, 'acceptTrade')[0];
    const reject = ofType(legal, 'rejectTrade')[0];
    return {
      key: `trade-incoming-${view.viewer}`,
      title: `${from.name} offers a trade`,
      modal: false,
      side: true,
      body: [
        h(
          'div',
          { class: 'offer-line', style: { '--pc': from.color } },
          h('span', {}, `${from.name} gives`),
          this.bundleRow(offer.give),
          h('span', { class: 'swap' }, '⇄'),
          h('span', {}, 'you give'),
          this.bundleRow(offer.want),
        ),
        !accept && h('p', { class: 'summary is-error' }, "You don't have the cards to accept"),
        h(
          'div',
          { class: 'dialog-actions' },
          h(
            'button',
            {
              class: 'btn btn-ghost',
              disabled: !reject,
              on: { click: () => reject && this.send(reject) },
            },
            'Reject',
          ),
          h(
            'button',
            {
              class: 'btn btn-primary',
              disabled: !accept,
              on: { click: () => accept && this.send(accept) },
            },
            'Accept',
          ),
        ),
      ],
    };
  }

  private discardDialog(view: HudView, hand: ResourceCounts, required: number) {
    const sel = this.discardSel;
    const error = validateDiscard(hand, required, sel);
    return {
      key: `discard-${view.viewer}`,
      title: `Discard ${required} cards`,
      modal: true,
      body: [
        h(
          'p',
          { class: 'note' },
          'A 7 was rolled and you hold more than 7 cards. Pick exactly half (rounded down).',
        ),
        h(
          'div',
          { class: 'col wide-col' },
          ...RESOURCES.filter((r) => hand[r] > 0).map((r) =>
            this.stepper(
              r,
              sel[r],
              (d) => {
                this.discardSel = stepDiscard(sel, r, d, hand, required);
                this.refresh();
              },
              Math.min(
                hand[r],
                required - (Object.values(sel).reduce((a, b) => a + b, 0) - sel[r]),
              ),
            ),
          ),
        ),
        h(
          'p',
          { class: `summary${error ? '' : ' is-ok'}` },
          error ?? `Discarding ${required} of ${required}`,
        ),
        h(
          'div',
          { class: 'dialog-actions' },
          h(
            'button',
            {
              class: 'btn btn-primary',
              disabled: error !== null,
              on: { click: () => error === null && this.send(discardAction(view.viewer, sel)) },
            },
            'Discard',
          ),
        ),
      ],
    };
  }

  private stealDialog(state: GameState, view: HudView, victims: PlayerId[]) {
    const acts = ofType(viewerLegal(view), 'steal');
    return {
      key: 'steal',
      title: 'Steal from whom?',
      modal: true,
      body: [
        h(
          'div',
          { class: 'victims' },
          ...victims.map((id) => {
            const p = getPlayer(state, id);
            const act = acts.find((a) => a.victim === id);
            const count = RESOURCES.reduce((n, r) => n + p.resources[r], 0);
            return h(
              'button',
              {
                class: 'victim',
                style: { '--pc': p.color },
                disabled: !act,
                on: { click: () => act && this.send(act) },
              },
              h('span', { class: 'pp-dot big' }),
              h('span', { class: 'victim-name' }, p.name),
              h('span', { class: 'muted' }, `${count} cards`),
            );
          }),
        ),
      ],
    };
  }

  private yopDialog(legal: Action[]) {
    const pairs = ofType(legal, 'playYearOfPlenty');
    const first = this.yopFirst;
    const allowed = (r: Resource) =>
      pairs.some((p) => p.resources[0] === r || p.resources[1] === r);
    const action = (r: Resource) => (first ? findYearOfPlenty(legal, first, r) : undefined);
    return {
      key: 'yop',
      title: 'Year of Plenty',
      modal: false,
      body: [
        h(
          'p',
          { class: 'sub' },
          first
            ? `Second resource (first: ${RESOURCE_LABEL[first]})`
            : 'Pick the first of two free resources',
        ),
        this.resourcePick(
          null,
          (r) => (first ? action(r) !== undefined : allowed(r)),
          (r) => {
            const done = action(r);
            if (done) this.send(done);
            else {
              this.yopFirst = r;
              this.refresh();
            }
          },
        ),
        h(
          'div',
          { class: 'dialog-actions' },
          first &&
            h(
              'button',
              {
                class: 'btn btn-ghost',
                on: {
                  click: () => {
                    this.yopFirst = null;
                    this.refresh();
                  },
                },
              },
              'Back',
            ),
          this.closeButton('Cancel'),
        ),
      ],
    };
  }

  private monopolyDialog(legal: Action[]) {
    const acts = ofType(legal, 'playMonopoly');
    return {
      key: 'monopoly',
      title: 'Monopoly',
      modal: false,
      body: [
        h('p', { class: 'sub' }, 'Every other player hands you all of one resource'),
        this.resourcePick(
          null,
          (r) => acts.some((a) => a.resource === r),
          (r) => {
            const a = acts.find((x) => x.resource === r);
            if (a) this.send(a);
          },
        ),
        h('div', { class: 'dialog-actions' }, this.closeButton('Cancel')),
      ],
    };
  }

  // --- overlays ------------------------------------------------------------

  private coverScreen(state: GameState, view: HudView): HTMLElement {
    const p = getPlayer(state, view.viewer);
    return h(
      'div',
      { class: 'cover', style: { '--pc': p.color } },
      h(
        'div',
        { class: 'cover-card' },
        h('div', { class: 'cover-dot' }),
        h('p', { class: 'muted' }, 'Hotseat — hide your cards'),
        h('h1', {}, `Pass to ${p.name}`),
        h(
          'button',
          {
            class: 'btn btn-primary btn-lg',
            on: {
              click: () => {
                this.unlockedViewer = view.viewer;
                this.refresh();
              },
            },
          },
          `I'm ${p.name} — show my cards`,
        ),
      ),
    );
  }

  private winnerScreen(state: GameState): HTMLElement {
    const ranked = state.players
      // Final scores reveal hidden VP cards.
      .map((p) => ({ p, vp: victoryPoints(state, p.id) }))
      .sort((a, b) => b.vp - a.vp || a.p.id - b.p.id);
    const winner = state.winner === null ? null : state.players[state.winner];
    return h(
      'div',
      { class: 'winner', style: { '--pc': winner?.color ?? '#f2b84b' } },
      h(
        'div',
        { class: 'winner-card' },
        h('div', { class: 'trophy' }, '🏆'),
        h('p', { class: 'muted' }, 'Game over'),
        h('h1', {}, winner ? `${winner.name} wins!` : 'Game over'),
        h(
          'div',
          { class: 'scores' },
          ...ranked.map(({ p, vp }, i) =>
            h(
              'div',
              {
                class: `score${p.id === state.winner ? ' is-winner' : ''}`,
                style: { '--pc': p.color },
              },
              h('span', { class: 'rank' }, String(i + 1)),
              h('span', { class: 'pp-dot' }),
              h('span', { class: 'score-name' }, p.name),
              h('span', { class: 'score-vp' }, `${vp} VP`),
            ),
          ),
        ),
        h(
          'button',
          { class: 'btn btn-primary btn-lg', on: { click: () => this.showNewGame() } },
          'New game',
        ),
      ),
    );
  }

  private newSetupScreen(): SetupScreen {
    return new SetupScreen({
      onBack: this.state ? () => this.hideNewGame() : undefined,
      onStart: (cfg) => {
        this.newGameOpen = false;
        this.setup = null;
        this.unlockedViewer = null;
        this.state = null;
        this.view = null;
        this.emit('newGame', cfg);
        this.refresh();
      },
    });
  }
}
