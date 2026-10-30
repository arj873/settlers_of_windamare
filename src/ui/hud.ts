/**
 * The HUD: HTML overlay on top of the Pixi canvas. Never mutates state, never calls applyAction.
 * Everything clickable is enabled from `view.legal` only; clicks emit Actions (or 'placeMode').
 */
import {
  costOf,
  devDeckCounts,
  emptyResources,
  EVENT_INFO,
  getPlayer,
  handCount,
  RESOURCES,
  victoryPoints,
  type Action,
  type GameState,
  type PlayerId,
  type Resource,
  type ResourceCounts,
  resourceWord,
} from '../engine';
import {
  discardAction,
  discardRows,
  discardStatus,
  draftToAction,
  emptyDraft,
  stepDiscard,
  stepDraft,
  toggleRecipient,
  validateDiscard,
  validateDraft,
  type TradeDraft,
} from './composer';
import {
  handCardLine,
  handCardsFor,
  hiddenBaseCards,
  hudExtensionsFor,
  type HandCard,
} from './expansions';
import { boardPreviewSvg } from './setup/mapPreviews';
import { SetupScreen } from './setup/screen';
import { costLabel, costTip, missingCards, type Cost } from './costView';
import { h, patchChildren, type Child, type Props } from './dom';
import { dieFace, glyph, RESOURCE_LABEL, resourceIcon } from './icons';
import {
  availability,
  bestRatios,
  blockReasons,
  tradeBlockReason,
  buildCards,
  devCardRows,
  devCardStatus,
  DEV_CARD_INFO,
  diceTotal,
  findBankTrade,
  findYearOfPlenty,
  ofType,
  placeModeAvailable,
  TIMER_WARN_SEC,
  turnInfo,
  viewerLegal,
  type Availability,
  type BuildKind,
} from './model';
import { bankPanel, LogList, playersList } from './sidebar';
import { statsFor, type StatsTab } from './stats/model';
import { statsPanel } from './stats/panel';
import { themePicker } from './theme';
import { loadAnimations, saveAnimations } from './motion';
import { isLowPower, POWER_LABEL, POWER_SETTINGS, powerSetting, setPowerSetting } from './power';
import { ProductionFx, type HexLocator } from './production/fx';
import { soundControl } from './sound';
import { feedbackMenuItems } from './feedback';
import type {
  BotSpeedControl,
  BuildConfirmControl,
  HudEventName,
  HudEvents,
  HudView,
  PlaceMode,
  SessionAction,
  ToggleControl,
} from './types';
import { avatar, devCardFace, playerStyle, resCardFace } from './widgets';
import './hud.css';

type Listeners = { [E in HudEventName]: ((payload: HudEvents[E]) => void)[] };
/** 'card': a module hand card's play dialog (`cardDialog`). */
type Dialog = null | 'bank' | 'trade' | 'yop' | 'monopoly' | 'card';
/** What a hand card's info card shows (#devinfo, #cardinfo). */
interface InfoContent {
  face(w: number): HTMLElement;
  name: string;
  count: number;
  text: string;
  /** The "can I play it" line; null for a good (a card one spends, never plays). */
  status: { playable: boolean; line: string } | null;
  notes: readonly string[];
}
/** Base sections, or `ext:<expansionId>` for an expansion panel. */
type Section = 'log' | 'bank' | 'players' | 'chat' | `ext:${string}`;
type Region =
  'menu' | 'turn' | 'side' | 'drawer' | 'bottom' | 'controls' | 'pop' | 'dialog' | 'overlay';
/** Game Events scroll position; `stick`: scroll to the newest entry. */
type LogScroll = { atBottom: boolean; stick: boolean };

/** Run `fn` in the next frame before it is painted (jsdom tests: after this task). */
const beforePaint = (fn: () => void) =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : queueMicrotask(fn);

const BUILD_LABEL: Record<BuildKind, string> = {
  dev: 'Buy card',
  road: 'Road',
  settlement: 'Settlement',
  city: 'City',
};

/** The board action each base build card's place mode submits. */
const BUILD_ACTION: Record<Exclude<BuildKind, 'dev'>, string> = {
  road: 'buildRoad',
  settlement: 'buildSettlement',
  city: 'buildCity',
};

const BUILD_COST: Record<BuildKind, Partial<Record<Resource, number>>> = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  dev: { wool: 1, grain: 1, ore: 1 },
};

const costText = (k: BuildKind) =>
  Object.entries(BUILD_COST[k])
    .map(([r, n]) => `${n} ${resourceWord(r)}`)
    .join(', ');

const describeCost = (cost: ResourceCounts) =>
  RESOURCES.filter((r) => cost[r] > 0)
    .map((r) => `${cost[r]} ${resourceWord(r)}`)
    .join(', ');

const SECTION_TITLE: Record<'log' | 'bank' | 'players' | 'chat', string> = {
  log: 'Game Events',
  bank: 'Bank',
  players: 'Players',
  chat: 'Chat',
};

/** How long a tapped "why is this disabled" bubble stays open. */
const WHY_MS = 3500;
/** A touch held this long on a build button opens its cost tooltip instead of clicking (#35). */
const LONG_PRESS_MS = 450;

/** Regions emptied while a full-screen cover is up. */
const GAME_REGIONS = [
  'menu',
  'turn',
  'side',
  'drawer',
  'bottom',
  'controls',
  'pop',
  'dialog',
] as const;

export class Hud {
  private readonly root: HTMLElement;
  private readonly regions: Record<Region, HTMLElement>;
  private listeners: Listeners = { action: [], newGame: [], placeMode: [] };

  private state: GameState | null = null;
  private view: HudView | null = null;

  // Local UI state (never game state).
  private placeMode: PlaceMode | null = null;
  private dialog: Dialog = null;
  private bankGive: Resource | null = null;
  private bankReceive: Resource | null = null;
  private yopFirst: Resource | null = null;
  /** Event card "give" task: the recipient picked so far. */
  private eventTo: PlayerId | null = null;
  private draft: TradeDraft = emptyDraft([]);
  private discardSel: ResourceCounts = emptyResources();
  /** Viewer the discard selection was made for (null outside the discard phase). */
  private discardFor: PlayerId | null = null;
  private setup: SetupScreen | null = null;
  private newGameOpen = false;
  /** The viewer who has been shown the screen (hotseat cover compares against this). */
  private unlockedViewer: PlayerId | null = null;
  private pieceSig = '';
  private lastDice = '';
  private lastPillKey = '';
  private lastDialogKey = '';
  private lastLogLength = -1;
  /** Log scroll read by a render whose list is not scrolled yet (see `logScroll`). */
  private pendingLogScroll: LogScroll | null = null;
  private menuOpen = false;
  /** Phone layout: the sidebar is a drawer. */
  private drawerOpen = false;
  private collapsed = new Set<Section>();
  /** Game over (UX2): the statistics panel instead of the winner card; collapsed = the board shows. */
  private statsOpen = false;
  private statsCollapsed = false;
  private statsTab: StatsTab = 'overview';
  private statsPlayer: PlayerId | null = null;
  /** The panel was just opened / expanded: play its fade-in once. */
  private statsEntering = false;
  private botSpeed: BotSpeedControl | null = null;
  /** #51: "Show longest road on the board" in the menu (null hides it). */
  private longestRoadToggle: ToggleControl | null = null;
  private buildConfirm: BuildConfirmControl | null = null;
  /** Online: replaces "New game" in the menu and on the winner screen. */
  private sessionActions: SessionAction[] | null = null;
  /** "Learn to play" (src/ui/tutorial) in the menu and on the setup screen (null hides it). */
  private learnToPlay: ((course?: string) => void) | null = null;
  /** The menu asks before leaving a running game for the tutorial. */
  private learnAsk = false;
  /** Online: chat panel kept as one node across refreshes (typing must survive re-renders). */
  private chatSec: HTMLElement | null = null;
  /** Game Events: one list for the HUD's life, updated in place (s17). */
  private readonly logList = new LogList();
  private logSec: HTMLElement | null = null;
  /** Disabled build button whose reason was tapped open. */
  /** Build slot whose tooltip a tap / long-press opened (BuildKind or an expansion mode). */
  private whyKind: string | null = null;
  /** A touch long-press is pending on a build button (#35); fired = swallow its click. */
  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private pressFired = false;
  private whyTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Hand card whose info card is open (what it does, why it can or can't be played now): a dev
   * card type, or a module card's key (#cardinfo, 'ck/alchemist'). Opened by a click on a card
   * that can't be played, or a right-click / long-press on one that can.
   */
  private cardInfo: string | null = null;
  /** The viewer whose card it is (hotseat: the next player starts with it closed). */
  private cardInfoFor: PlayerId | null = null;
  /** What the hand's cards say in their info card, by key: rebuilt with the hand bar. */
  private handInfo = new Map<string, InfoContent>();
  /** The module cards in the hand, by key (their play dialogs). */
  private extHand = new Map<string, HandCard>();
  /** The module card whose play dialog is open (dialog 'card'). */
  private cardDialog: string | null = null;
  /** The info card: one node while the HUD lives, so re-renders patch it instead of swapping it. */
  private readonly infoPop = h('div', {
    class: 'why dev-info',
    id: 'dev-info',
    attrs: { role: 'tooltip' },
  });
  /** Where the info card was last put (`x/y`), so an unmoved card is not written to again. */
  private infoPopAt = '';
  private infoPopQueued = false;
  /** Issue #29: cards flying from the producing hexes after a roll, gain badges on the rows. */
  private readonly fx: ProductionFx;
  private onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (this.cardInfo !== null) this.closeCardInfo();
    else if (this.menuOpen) {
      this.menuOpen = false;
      this.refresh();
    } else if (this.placeMode) this.setPlaceMode(null);
  };
  private onDocClick = (e: MouseEvent) => {
    if (this.menuOpen && !this.regions.menu.contains(e.target as Node)) {
      this.menuOpen = false;
      this.refresh();
    }
    // A hand card's own click toggles or switches its info card.
    const t = e.target;
    if (
      this.cardInfo !== null &&
      !(t instanceof Element && (this.infoPop.contains(t) || t.closest('.hcard[data-info]')))
    ) {
      this.closeCardInfo();
    }
  };
  private onResize = () => {
    if (this.cardInfo !== null) this.queuePlaceCardInfo();
  };

  constructor(root: HTMLElement) {
    this.root = root;
    root.classList.add('catan-hud');
    const mk = (cls: string) => h('div', { class: cls });
    this.regions = {
      menu: mk('hud-menu'),
      turn: mk('hud-turn'),
      side: h('aside', { class: 'hud-side', attrs: { 'aria-label': 'Game info' } }),
      drawer: mk('hud-drawer'),
      bottom: mk('hud-bottom'),
      controls: mk('hud-controls'),
      pop: mk('hud-pop-layer'),
      dialog: mk('hud-dialog-layer'),
      overlay: mk('hud-overlay-layer'),
    };
    root.replaceChildren(...Object.values(this.regions));
    this.fx = new ProductionFx(root);
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('click', this.onDocClick, true);
    window.addEventListener('resize', this.onResize);
  }

  /** Remove listeners and DOM. */
  destroy(): void {
    if (this.whyTimer !== null) clearTimeout(this.whyTimer);
    if (this.pressTimer !== null) clearTimeout(this.pressTimer);
    this.fx.destroy();
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('click', this.onDocClick, true);
    window.removeEventListener('resize', this.onResize);
    this.root.replaceChildren();
    this.root.classList.remove('catan-hud');
  }

  /** Show a bot-speed picker in the menu (null hides it). The HUD keeps the chosen value. */
  setBotSpeed(control: BotSpeedControl | null): void {
    this.botSpeed = control;
    this.refresh();
  }

  /** #51: show the "Show longest road on the board" setting in the menu (null hides it). */
  setLongestRoadToggle(control: ToggleControl | null): void {
    this.longestRoadToggle = control;
    this.refresh();
  }

  /** Show the "Confirm before building" switch in the menu (null hides it). */
  setBuildConfirm(control: BuildConfirmControl | null): void {
    this.buildConfirm = control;
    this.refresh();
  }

  /** Online play: menu / winner-screen actions instead of "New game" (null = hotseat). */
  setSessionActions(actions: SessionAction[] | null): void {
    this.sessionActions = actions;
    this.refresh();
  }

  /**
   * Hotseat: offer "Learn to play" in the menu and on the setup screen (null hides it). `course`:
   * a tutorial picked on the setup screen; absent = let the player pick.
   */
  setLearnToPlay(start: ((course?: string) => void) | null): void {
    this.learnToPlay = start;
    this.refresh();
  }

  /**
   * Online play: show `panel` as a Chat section at the bottom of the sidebar (null removes it).
   * The node is kept as is across renders.
   */
  setChat(panel: HTMLElement | null): void {
    this.chatSec?.remove();
    this.chatSec = panel ? this.section('chat', panel, true) : null;
    this.refresh();
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
    this.fx.update(state, view, this.isCovered());
  }

  /** Where board hexes are on screen (`BoardView.screenPos`): the production cards start there. */
  setHexLocator(locate: HexLocator | null): void {
    this.fx.setLocator(locate);
  }

  /** The hotseat cover or the new-game screen hides the game (the controller pauses the turn timer). */
  isCovered(): boolean {
    return this.root.classList.contains('is-covered');
  }

  /** Update only the turn timer (between renders; redraws just the turn pill). */
  setTurnTimer(timer: HudView['turnTimer']): void {
    if (!this.view || !this.state) return;
    this.view = { ...this.view, turnTimer: timer };
    if (this.isCovered()) return;
    this.regions.turn.replaceChildren(...this.turnPill(this.state, this.view));
  }

  // -------------------------------------------------------------------------
  // Local state housekeeping
  // -------------------------------------------------------------------------

  private syncLocalState(state: GameState, view: HudView): void {
    const legal = viewerLegal(view);
    const av = availability(legal);

    if (this.unlockedViewer === null) this.unlockedViewer = view.viewer;

    // A game in progress: the next game over starts on the winner card again.
    if (state.phase.kind !== 'gameOver') {
      this.statsOpen = false;
      this.statsCollapsed = false;
      this.statsTab = 'overview';
      this.statsPlayer = null;
    }

    // Leave build mode after anything was placed, or when it stops being legal.
    // (Expansion pieces live in state.ext: its size stands in for "a module piece was placed".)
    const extSig = state.settings.expansions.length > 0 ? JSON.stringify(state.ext).length : 0;
    const sig = `${Object.keys(state.pieces.buildings).length}/${Object.keys(state.pieces.roads).length}/${state.turn.number}/${state.phase.kind}/${extSig}`;
    const sigChanged = sig !== this.pieceSig;
    this.pieceSig = sig;
    if (this.placeMode && (sigChanged || !placeModeAvailable(av, this.placeMode, legal))) {
      this.setPlaceMode(null);
    }

    // Close dialogs whose actions are no longer legal.
    if (this.dialog === 'bank' && !av.bankTrade) this.dialog = null;
    if (this.dialog === 'trade' && !av.offerTrade) this.dialog = null;
    if (this.dialog === 'yop' && !av.playYearOfPlenty) this.dialog = null;
    if (this.dialog === 'monopoly' && !av.playMonopoly) this.dialog = null;
    if (this.dialog !== 'bank') this.bankGive = this.bankReceive = null;
    if (this.dialog !== 'yop') this.yopFirst = null;
    if (state.phase.kind !== 'event') this.eventTo = null;

    // The info card closes for another viewer or a spectator; with its card in `cardInfoCard`.
    if (this.cardInfo !== null && (view.spectator || this.cardInfoFor !== view.viewer)) {
      this.cardInfo = null;
    }
    // A module card's play dialog: same viewer only (it closes once the card can't be played).
    if (this.dialog === 'card' && (view.spectator || this.cardInfoFor !== view.viewer)) {
      this.dialog = null;
    }

    // Fresh draft per turn / viewer; recipients default to everyone else.
    const others = state.players.filter((p) => p.id !== view.viewer).map((p) => p.id);
    if (this.dialog !== 'trade') this.draft = emptyDraft(others);
    this.draft = { ...this.draft, to: this.draft.to.filter((p) => others.includes(p)) };

    // Several players can owe a discard on the same 7: the selection belongs to one viewer.
    if (state.phase.kind !== 'discard' || this.discardFor !== view.viewer) {
      this.discardSel = emptyResources();
      this.discardFor = state.phase.kind === 'discard' ? view.viewer : null;
    }
  }

  private setPlaceMode(mode: PlaceMode | null): void {
    if (this.placeMode === mode) return;
    this.placeMode = mode;
    this.emit('placeMode', mode);
    if (this.view) this.refresh();
  }

  /**
   * A build bar slot with its cost tooltip (#35): hover shows it; on touch, a tap on a disabled
   * button or a long-press on an enabled one opens it for a few seconds. A disabled button gets
   * no pointer events (CSS), so the slot takes them.
   */
  private buildSlot(key: string, button: HTMLElement, tip: HTMLElement, blocked: boolean) {
    const cancel = () => {
      if (this.pressTimer !== null) clearTimeout(this.pressTimer);
      this.pressTimer = null;
    };
    return h(
      'span',
      {
        class: `bslot${blocked ? ' is-blocked' : ''}${this.whyKind === key ? ' is-why' : ''}`,
        on: blocked
          ? { click: () => this.showWhy(key) }
          : {
              pointerdown: (e: Event) => {
                cancel();
                this.pressFired = false;
                if ((e as PointerEvent).pointerType !== 'touch') return;
                this.pressTimer = setTimeout(() => {
                  this.pressTimer = null;
                  this.pressFired = true;
                  this.showWhy(key);
                }, LONG_PRESS_MS);
              },
              pointerup: cancel,
              pointercancel: cancel,
              pointerleave: cancel,
              contextmenu: (e: Event) => e.preventDefault(),
            },
      },
      button,
      tip,
    );
  }

  /** A build button's click, skipped right after a long-press opened its tooltip. */
  private unlessLongPress(fn: () => void): () => void {
    return () => {
      if (this.pressFired) {
        this.pressFired = false;
        return;
      }
      fn();
    };
  }

  /** Tap on a disabled build button (or long-press): show its tooltip for a few seconds. */
  private showWhy(kind: string): void {
    if (this.whyTimer !== null) clearTimeout(this.whyTimer);
    this.whyKind = this.whyKind === kind ? null : kind;
    this.whyTimer = this.whyKind
      ? setTimeout(() => {
          this.whyKind = null;
          this.whyTimer = null;
          this.refresh();
        }, WHY_MS)
      : null;
    this.refresh();
  }

  /**
   * A card in the hand with an info card (#devinfo, #cardinfo: dev cards, module cards): a click
   * plays it when it can be played, else toggles its info card; a right-click or a touch
   * long-press opens the info card either way, to read before playing. The button stays focusable
   * (aria-disabled, never `disabled`), so the keyboard gets the same: Enter on a card that can't
   * be played, the context-menu key on any card.
   */
  private infoCardOn(key: string, play: (() => void) | null): Props['on'] {
    const cancel = () => {
      if (this.pressTimer !== null) clearTimeout(this.pressTimer);
      this.pressTimer = null;
    };
    return {
      pointerdown: (e) => {
        cancel();
        this.pressFired = false;
        if (e.pointerType !== 'touch') return;
        this.pressTimer = setTimeout(() => {
          this.pressTimer = null;
          this.pressFired = true;
          this.openCardInfo(key);
        }, LONG_PRESS_MS);
      },
      pointerup: cancel,
      pointercancel: cancel,
      pointerleave: cancel,
      contextmenu: (e) => {
        e.preventDefault();
        // Android follows a long-press with contextmenu: the timer already opened it.
        if (!this.pressFired) this.toggleCardInfo(key);
      },
      click: () => {
        if (this.pressFired) {
          this.pressFired = false;
          return;
        }
        if (!play) {
          this.toggleCardInfo(key);
          return;
        }
        this.closeCardInfo();
        play();
      },
    };
  }

  private openCardInfo(key: string): void {
    if (this.cardInfo === key) return;
    this.cardInfo = key;
    this.cardInfoFor = this.view?.viewer ?? null;
    // Hidden until placed above its card (before the next paint).
    this.infoPop.classList.add('is-placing');
    this.refresh();
  }

  private toggleCardInfo(key: string): void {
    if (this.cardInfo === key) this.closeCardInfo();
    else this.openCardInfo(key);
  }

  private closeCardInfo(): void {
    if (this.cardInfo === null) return;
    this.cardInfo = null;
    this.refresh();
  }

  /** A module card's play that needs choices first: its dialog (#cardinfo, `HandCardPlay`). */
  private openCardDialog(key: string): void {
    this.cardDialog = key;
    this.cardInfoFor = this.view?.viewer ?? null;
    this.open('card');
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
      for (const k of GAME_REGIONS) r[k].replaceChildren();
      return;
    }
    if (!state || !view) {
      r.overlay.replaceChildren();
      this.root.classList.remove('is-covered');
      return;
    }
    const scroll = this.logScroll(); // before any write

    const covered =
      state.phase.kind !== 'gameOver' &&
      this.unlockedViewer !== null &&
      this.unlockedViewer !== view.viewer;
    this.root.classList.toggle('is-covered', covered);
    if (covered) {
      for (const k of GAME_REGIONS) r[k].replaceChildren();
      r.overlay.replaceChildren(this.coverScreen(state, view));
      return;
    }

    const legal = viewerLegal(view);
    const av = availability(legal);

    // Don't rebuild the open menu under a dragged volume slider (bot moves re-render often).
    const sliding =
      this.menuOpen &&
      r.menu.contains(document.activeElement) &&
      document.activeElement instanceof HTMLInputElement;
    // Unchanged panels stay as they are (s17, `patchChildren`); expansion cards in the hand and
    // build bars may act on state their markup does not show, so those bars are always fresh.
    const fresh = hudExtensionsFor(state).length > 0;
    const put = (region: HTMLElement, nodes: Node[]) =>
      fresh ? region.replaceChildren(...nodes) : patchChildren(region, nodes);
    if (!sliding) patchChildren(r.menu, this.menu(view));
    patchChildren(r.turn, this.turnPill(state, view));
    this.renderSidebar(state, view, scroll);
    if (view.spectator) {
      // Public info only: no hand, no buttons, no dialogs; the dice stay visible. The build
      // costs stay readable (#35: a read-only bar with the cost tooltips).
      put(r.bottom, [this.costBar(state)]);
      patchChildren(r.controls, [this.diceBox(state)]);
      r.dialog.replaceChildren();
      this.lastDialogKey = '';
      this.handInfo = new Map();
      this.extHand = new Map();
    } else {
      // A hand card whose markup changed (its info card opened) is a new node: keep the focus on it.
      const focus = document.activeElement;
      const focusCard =
        focus instanceof HTMLElement && r.bottom.contains(focus) ? focus.dataset.info : undefined;
      put(r.bottom, this.handBar(state, view, av));
      if (focusCard && !r.bottom.contains(document.activeElement)) {
        r.bottom
          .querySelector<HTMLElement>(`.hcard[data-info="${focusCard}"]`)
          ?.focus({ preventScroll: true });
      }
      patchChildren(r.controls, this.controls(state, view, av));
      this.renderDialog(state, view, legal);
    }
    patchChildren(r.pop, this.cardInfoCard());
    // Stats panel: keep the body's scroll position across re-renders of the same tab.
    const prevBody = r.overlay.querySelector<HTMLElement>('.gs-body');
    const keep = prevBody ? { tab: prevBody.dataset.tab, top: prevBody.scrollTop } : null;
    r.overlay.replaceChildren(...this.gameOverScreen(state, view));
    const body = r.overlay.querySelector<HTMLElement>('.gs-body');
    if (body && keep && body.dataset.tab === keep.tab) body.scrollTop = keep.top;
  }

  /** Winner card, or (UX2) the statistics panel; nothing before game over. */
  private gameOverScreen(state: GameState, view: HudView): HTMLElement[] {
    const stats = statsFor(state);
    if (state.phase.kind !== 'gameOver') return [];
    if (!this.statsOpen || !stats) return [this.winnerScreen(state, stats !== null)];
    const panel = statsPanel(state, stats, {
      tab: this.statsTab,
      player: this.statsPlayer ?? state.winner ?? 0,
      collapsed: this.statsCollapsed,
      durationMs: view.gameDurationMs ?? null,
      onTab: (tab) => {
        this.statsTab = tab;
        this.refresh();
      },
      onPlayer: (p) => {
        this.statsPlayer = p;
        this.refresh();
      },
      onToggle: () => {
        this.statsCollapsed = !this.statsCollapsed;
        this.statsEntering = !this.statsCollapsed;
        this.refresh();
      },
      actions: [
        h(
          'button',
          {
            class: 'btn gs-results',
            on: {
              click: () => {
                this.statsOpen = false;
                this.refresh();
              },
            },
          },
          'Results',
        ),
        ...this.endActions(''),
      ],
    });
    // Fade in only when the panel opens, not on every tab switch.
    const entering = this.statsEntering;
    this.statsEntering = false;
    const cls = this.statsCollapsed ? 'gs-dock' : `gs-overlay${entering ? ' is-entering' : ''}`;
    return [h('div', { class: cls }, panel)];
  }

  /** "New game" (hotseat) or the online session actions, as buttons. */
  private endActions(size: string): HTMLElement[] {
    if (!this.sessionActions) {
      return [
        h(
          'button',
          { class: `btn btn-primary ${size}`, on: { click: () => this.showNewGame() } },
          'New game',
        ),
      ];
    }
    return this.sessionActions.map((a) =>
      h(
        'button',
        {
          class: `btn ${a.primary ? 'btn-primary' : 'btn-ghost'} ${size}`,
          on: { click: () => a.onClick() },
        },
        a.label,
      ),
    );
  }

  // --- top: menu and turn pill ----------------------------------------------

  private menu(view: HudView): HTMLElement[] {
    const toggle = h(
      'button',
      {
        class: `menu-btn${this.menuOpen ? ' is-open' : ''}`,
        title: 'Menu',
        attrs: { 'aria-label': 'Menu', 'aria-expanded': String(this.menuOpen) },
        on: {
          click: () => {
            this.menuOpen = !this.menuOpen;
            this.refresh();
          },
        },
      },
      glyph('menu', 22),
    );
    if (!this.menuOpen) {
      this.learnAsk = false;
      return [toggle];
    }
    const speed = this.botSpeed;
    const showSpeed = speed !== null && (view.bots?.some(Boolean) ?? true);
    return [
      toggle,
      h(
        'div',
        { class: 'menu-panel wood', attrs: { role: 'menu' } },
        ...(this.sessionActions ?? [{ label: 'New game', onClick: () => this.showNewGame() }]).map(
          (a) =>
            h(
              'button',
              {
                class: 'menu-item',
                attrs: { role: 'menuitem' },
                on: {
                  click: () => {
                    this.menuOpen = false;
                    this.refresh();
                    a.onClick();
                  },
                },
              },
              a.label,
            ),
        ),
        this.sessionActions === null && this.learnMenuItem(),
        showSpeed &&
          h(
            'div',
            { class: 'menu-sec' },
            h('div', { class: 'menu-label' }, 'Bot speed'),
            h(
              'div',
              { class: 'seg', attrs: { role: 'group', 'aria-label': 'Bot speed' } },
              ...speed.presets.map((p) =>
                h(
                  'button',
                  {
                    class: `seg-btn${p.ms === speed.value ? ' is-on' : ''}`,
                    on: {
                      click: () => {
                        this.botSpeed = { ...speed, value: p.ms };
                        speed.onChange(p.ms);
                        this.refresh();
                      },
                    },
                  },
                  p.label,
                ),
              ),
            ),
          ),
        this.animationsToggle(),
        this.powerToggle(),
        this.buildConfirmSec(),
        this.longestRoadMenu(),
        h('div', { class: 'menu-sec' }, h('div', { class: 'menu-label' }, 'Sound'), soundControl()),
        h('div', { class: 'menu-sec' }, h('div', { class: 'menu-label' }, 'Theme'), themePicker()),
        ...feedbackMenuItems({ state: this.state, online: this.sessionActions !== null }),
        h(
          'a',
          {
            class: 'menu-item',
            attrs: {
              role: 'menuitem',
              href: 'https://www.catan.com/understand-catan/game-rules',
              target: '_blank',
              rel: 'noopener noreferrer',
            },
          },
          'Rules ↗',
        ),
      ),
    ];
  }

  /** "Learn to play": starts the tutorial game; asks first while a game is running. */
  private learnMenuItem(): HTMLElement | null {
    const start = this.learnToPlay;
    if (!start) return null;
    const go = () => {
      this.menuOpen = false;
      this.refresh();
      start();
    };
    if (!this.learnAsk) {
      const running = this.state !== null && this.state.phase.kind !== 'gameOver';
      return h(
        'button',
        {
          class: 'menu-item',
          attrs: { role: 'menuitem', 'data-k': 'learn-to-play' },
          on: {
            click: () => {
              if (!running) return go();
              this.learnAsk = true;
              this.refresh();
            },
          },
        },
        'Learn to play',
      );
    }
    return h(
      'div',
      { class: 'menu-sec', attrs: { 'data-k': 'learn-ask' } },
      h('div', { class: 'menu-label' }, 'Leave this game and start the tutorial?'),
      h(
        'div',
        { class: 'seg' },
        h(
          'button',
          {
            class: 'seg-btn',
            on: {
              click: () => {
                this.learnAsk = false;
                this.refresh();
              },
            },
          },
          'Cancel',
        ),
        h('button', { class: 'seg-btn is-on', on: { click: go } }, 'Start tutorial'),
      ),
    );
  }

  /** #51: Off / On for outlining the Longest Road holder's route on the board. */
  private longestRoadMenu(): HTMLElement | null {
    const toggle = this.longestRoadToggle;
    if (!toggle) return null;
    const label = 'Show longest road on the board';
    return h(
      'div',
      { class: 'menu-sec', attrs: { 'data-k': 'longest-road-setting' } },
      h('div', { class: 'menu-label' }, label),
      h(
        'div',
        { class: 'seg', attrs: { role: 'group', 'aria-label': label } },
        ...[false, true].map((on) =>
          h(
            'button',
            {
              class: `seg-btn${on === toggle.value ? ' is-on' : ''}`,
              attrs: { 'aria-pressed': String(on === toggle.value) },
              on: {
                click: () => {
                  this.longestRoadToggle = { ...toggle, value: on };
                  toggle.onChange(on);
                  this.refresh();
                },
              },
            },
            on ? 'On' : 'Off',
          ),
        ),
      ),
    );
  }

  /** Animations on / off (saved like the theme): off = no flying cards, badges only. */
  private animationsToggle(): HTMLElement {
    const on = loadAnimations();
    return h(
      'div',
      { class: 'menu-sec' },
      h('div', { class: 'menu-label' }, 'Animations'),
      h(
        'div',
        { class: 'seg', attrs: { role: 'group', 'aria-label': 'Animations' } },
        ...[true, false].map((v) =>
          h(
            'button',
            {
              class: `seg-btn${v === on ? ' is-on' : ''}`,
              attrs: { 'aria-pressed': String(v === on), 'data-animations': v ? 'on' : 'off' },
              on: {
                click: () => {
                  saveAnimations(v);
                  if (!v) this.fx.clear();
                  this.refresh();
                },
              },
            },
            v ? 'On' : 'Off',
          ),
        ),
      ),
    );
  }

  /**
   * s17: Performance Auto / High quality / Low power (ui/power.ts, saved like the theme). The
   * page applies it at once (main wiring in app.ts); Auto's tooltip says what it picked.
   */
  private powerToggle(): HTMLElement {
    const current = powerSetting();
    const auto = `Auto: ${isLowPower() ? 'low power' : 'high quality'} on this device`;
    return h(
      'div',
      { class: 'menu-sec' },
      h('div', { class: 'menu-label' }, 'Performance'),
      h(
        'div',
        { class: 'seg', attrs: { role: 'group', 'aria-label': 'Performance' } },
        ...POWER_SETTINGS.map((v) =>
          h(
            'button',
            {
              class: `seg-btn${v === current ? ' is-on' : ''}`,
              ...(v === 'auto' ? { title: auto } : {}),
              attrs: { 'aria-pressed': String(v === current), 'data-power': v },
              on: {
                click: () => {
                  setPowerSetting(v);
                  if (isLowPower()) this.fx.clear();
                  this.refresh();
                },
              },
            },
            POWER_LABEL[v],
          ),
        ),
      ),
    );
  }

  /** Menu: "Confirm before building" On / Off (off: a click on a spot with one build builds). */
  private buildConfirmSec(): HTMLElement | null {
    const c = this.buildConfirm;
    if (!c) return null;
    const option = (on: boolean) =>
      h(
        'button',
        {
          class: `seg-btn${c.value === on ? ' is-on' : ''}`,
          attrs: {
            'aria-pressed': String(c.value === on),
            'data-k': `confirm-${on ? 'on' : 'off'}`,
          },
          on: {
            click: () => {
              this.buildConfirm = { ...c, value: on };
              c.onChange(on);
              this.refresh();
            },
          },
        },
        on ? 'On' : 'Off',
      );
    return h(
      'div',
      { class: 'menu-sec' },
      h('div', { class: 'menu-label' }, 'Confirm before building'),
      h(
        'div',
        { class: 'seg', attrs: { role: 'group', 'aria-label': 'Confirm before building' } },
        option(true),
        option(false),
      ),
    );
  }

  private turnPill(state: GameState, view: HudView): HTMLElement[] {
    if (state.phase.kind === 'gameOver') return [];
    const spectating =
      view.spectator &&
      h(
        'span',
        {
          class: 'spectate-pill',
          attrs: { role: 'status' },
          title: 'You are watching: only public information is shown',
        },
        glyph('eye', 16),
        'Spectating',
      );
    const info = turnInfo(state, view, this.placeMode);
    const p = getPlayer(state, info.player);
    const timer = view.turnTimer;
    const low = timer ? Math.ceil(timer.remainingSec) <= TIMER_WARN_SEC : false;
    // The pill is rebuilt on every render and timer tick: drop it in only when it says something new.
    const pillKey = `${info.player}|${info.title}|${info.hint?.text ?? ''}`;
    const fresh = pillKey !== this.lastPillKey;
    this.lastPillKey = pillKey;
    return [
      h(
        'div',
        {
          class: `turn-pill${info.hint?.tone === 'action' ? ' is-action' : ''}${low ? ' is-timer-low' : ''}`,
          style: { ...playerStyle(p.color), ...(fresh ? {} : { animation: 'none' }) },
          attrs: { role: 'status' },
        },
        avatar(p, view.bots?.[info.player] ?? view.isBotTurn, 34),
        h(
          'div',
          { class: 'turn-text' },
          h(
            'span',
            { class: 'turn-title' },
            info.title,
            info.next && h('span', { class: 'turn-next' }, info.next),
          ),
          info.hint && h('span', { class: `hint hint-${info.hint.tone}` }, info.hint.text),
        ),
        timer && this.timerBadge(timer.remainingSec, timer.totalSec),
        this.placeMode &&
          h(
            'button',
            { class: 'btn btn-sm', on: { click: () => this.setPlaceMode(null) } },
            'Cancel',
          ),
      ),
      ...(spectating ? [spectating] : []),
    ];
  }

  private timerBadge(remaining: number, total: number): HTMLElement {
    const left = Math.max(0, Math.ceil(remaining));
    const frac = total > 0 ? Math.min(1, left / total) : 0;
    return h(
      'span',
      {
        class: `turn-timer${left <= TIMER_WARN_SEC ? ' is-low' : ''}`,
        style: { '--frac': String(frac) },
        title: 'Time left; when it runs out the minimum moves are made for you',
      },
      `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`,
    );
  }

  // --- sidebar ---------------------------------------------------------------

  /**
   * Whether the Game Events list is scrolled to the newest entry. Read before `refresh` writes
   * anything: a read after the first write forces a layout of the whole HUD (s17, the biggest
   * cost of a bot move).
   */
  private logScroll(): LogScroll {
    // Another render before the list was scrolled (same frame): keep the first read.
    if (this.pendingLogScroll) return this.pendingLogScroll;
    const old = this.logList.element;
    if (!old.isConnected) return { atBottom: true, stick: false };
    return { atBottom: old.scrollTop + old.clientHeight >= old.scrollHeight - 8, stick: false };
  }

  private renderSidebar(state: GameState, view: HudView, scroll: LogScroll): void {
    const side = this.regions.side;
    // The log stays on screen and updates in place (s17); the other panels are rebuilt and
    // swapped in only when their markup changed.
    this.logList.update(state, view.viewer);
    const list = this.logList.element;
    this.logSec ??= this.section('log', list, true);
    side.classList.toggle('is-open', this.drawerOpen);
    const extPanels = hudExtensionsFor(state).flatMap((x) => {
      const p = x.panel?.(state, view, (a) => this.send(a));
      return p ? [this.section(`ext:${x.id}`, p.body, false, p.title)] : [];
    });
    const panels = [
      this.logSec,
      this.section('bank', bankPanel(state)),
      ...extPanels,
      this.section('players', playersList(state, view)),
      ...(this.chatSec ? [this.chatSec] : []),
    ];
    // Expansion panels may act on state their markup does not show: always fresh.
    if (extPanels.length > 0) side.replaceChildren(...panels);
    else patchChildren(side, panels);
    const grew = state.log.length !== this.lastLogLength;
    this.lastLogLength = state.log.length;
    // Scroll in the next frame, before it is painted: the frame lays the page out anyway, and
    // reading `scrollHeight` now would force one more layout of the whole HUD per render.
    scroll.stick ||= grew && scroll.atBottom;
    this.pendingLogScroll = scroll;
    // (Otherwise the list, which stays on screen, keeps its own scroll position.)
    beforePaint(() => {
      if (this.pendingLogScroll === scroll) this.pendingLogScroll = null;
      if (scroll.stick && list.isConnected) list.scrollTop = list.scrollHeight;
    });

    patchChildren(this.regions.drawer, [
      h(
        'button',
        {
          class: `drawer-btn${this.drawerOpen ? ' is-open' : ''}`,
          title: this.drawerOpen ? 'Hide game info' : 'Show game info',
          attrs: { 'aria-label': 'Game info', 'aria-expanded': String(this.drawerOpen) },
          on: {
            click: () => {
              this.drawerOpen = !this.drawerOpen;
              this.refresh();
            },
          },
        },
        glyph(this.drawerOpen ? 'close' : 'cards', 22),
      ),
    ]);
  }

  /**
   * `persistent`: the section is reused across renders, so collapsing toggles it in place.
   * `title`: heading of an expansion panel (default: the section's base title).
   */
  private section(
    key: Section,
    body: HTMLElement,
    persistent = false,
    title?: string,
  ): HTMLElement {
    const closed = this.collapsed.has(key);
    const heading = title ?? (key.startsWith('ext:') ? key : SECTION_TITLE[key as 'log' | 'chat']);
    const sec: HTMLElement = h(
      'section',
      {
        class: `side-sec sec-${key.replace(':', '-')}${key.startsWith('ext:') ? ' sec-ext' : ''}${closed ? ' is-collapsed' : ''}`,
      },
      h(
        'header',
        { class: 'sec-head' },
        h('h2', { class: 'plaque' }, heading),
        h(
          'button',
          {
            class: 'sec-toggle',
            title: closed ? 'Expand' : 'Collapse',
            attrs: {
              'aria-label': `${closed ? 'Expand' : 'Collapse'} ${heading}`,
              'aria-expanded': String(!closed),
            },
            on: {
              click: (e) => {
                if (this.collapsed.has(key)) this.collapsed.delete(key);
                else this.collapsed.add(key);
                if (!persistent) {
                  this.refresh();
                  return;
                }
                const now = this.collapsed.has(key);
                sec.classList.toggle('is-collapsed', now);
                const btn = e.currentTarget as HTMLElement;
                btn.title = now ? 'Expand' : 'Collapse';
                btn.setAttribute('aria-label', `${now ? 'Expand' : 'Collapse'} ${heading}`);
                btn.setAttribute('aria-expanded', String(!now));
              },
            },
          },
          glyph('chevron', 14),
        ),
      ),
      h('div', { class: 'sec-body' }, body),
    );
    return sec;
  }

  // --- bottom-left: hand, trade, build bar ------------------------------------

  private handBar(state: GameState, view: HudView, av: Availability): HTMLElement[] {
    const me = getPlayer(state, view.viewer);
    const legal = viewerLegal(view);
    const over = state.phase.kind === 'gameOver';
    const ratios = bestRatios(state, view.viewer);

    const stackCls = (n: number) =>
      n === 0 ? ' is-zero' : n >= 3 ? ' stack-3' : n === 2 ? ' stack-2' : '';
    const resCards = RESOURCES.map((r) => {
      const n = me.resources[r];
      return h(
        'div',
        {
          class: `hcard rcard rc-${r}${stackCls(n)}`,
          title: `${RESOURCE_LABEL[r]}: ${n} (bank ${ratios[r]}:1)`,
          attrs: { 'data-card': r },
        },
        resCardFace(r, 46),
        ratios[r] < 4 && h('span', { class: `ratio-tag r${ratios[r]}` }, `${ratios[r]}:1`),
        h('span', { class: 'count-badge' }, String(n)),
      );
    });

    const devOpen = (type: string) =>
      type === 'knight'
        ? () => this.send({ type: 'playKnight', player: view.viewer })
        : type === 'roadBuilding'
          ? () => this.send({ type: 'playRoadBuilding', player: view.viewer })
          : type === 'yearOfPlenty'
            ? () => this.open('yop')
            : () => this.open('monopoly');
    // #devinfo: a card that can't be played stays focusable and opens its info card instead.
    const info = new Map<string, InfoContent>();
    const devCards = devCardRows(state, view.viewer, legal).map((row) => {
      const card = DEV_CARD_INFO[row.type];
      const n = row.ready + row.fresh;
      const play = row.canPlay && !over && row.type !== 'victoryPoint';
      const status = devCardStatus(state, view.viewer, row);
      info.set(row.type, {
        face: (w) => devCardFace(row.type, w),
        name: card.name,
        count: n,
        text: card.text,
        status: { playable: status.playable, line: status.reason },
        notes: status.fresh ? [status.fresh] : [],
      });
      return this.infoCardButton({
        key: row.type,
        kind: 'play',
        name: card.name,
        count: n,
        face: devCardFace(row.type, 46),
        play: play ? devOpen(row.type) : null,
        why: status.reason,
        cls: `dcard${row.type === 'victoryPoint' ? ' is-vp' : ''}`,
        tag: row.fresh > 0 ? 'new' : undefined,
        attrs: { 'data-dev': row.type },
      });
    });

    // #cardinfo: module cards (commodities, progress cards, ...) get the same card and info card.
    const send = (a: Action) => this.send(a);
    const ext = handCardsFor(state, view, send);
    this.extHand = new Map(ext.map((c) => [c.key, c]));
    const extCard = (c: HandCard) => {
      const good = c.kind === 'good';
      const how = c.play;
      const play = !how
        ? null
        : 'action' in how
          ? () => this.send(how.action)
          : () => this.openCardDialog(c.key);
      const line = handCardLine(state, view, c);
      info.set(c.key, {
        face: c.face,
        name: c.name,
        count: c.count,
        text: c.text,
        status: good || line === null ? null : { playable: play !== null, line },
        notes: c.notes ?? [],
      });
      return this.infoCardButton({
        key: c.key,
        kind: c.kind,
        name: c.name,
        count: c.count,
        face: c.face(46),
        play: good ? null : play,
        why: line,
        cls: `${good ? 'rcard' : 'dcard'}${c.cls ? ` ${c.cls}` : ''}`,
        tag: c.tag,
        title: good ? `${c.name}: ${c.count}` : undefined,
        attrs: c.produced ? { 'data-card': c.produced } : {},
      });
    };
    const extGoods = ext.filter((c) => c.kind === 'good').map(extCard);
    const extPlays = ext.filter((c) => c.kind === 'play').map(extCard);
    this.handInfo = info;
    const playCards = [...extPlays, ...devCards];

    const extItems = hudExtensionsFor(state).flatMap((x) => x.handCards?.(state, view, send) ?? []);
    const hand = h(
      'div',
      { class: 'hand wood' },
      ...resCards,
      extGoods.length > 0 && h('span', { class: 'hand-sep' }),
      ...extGoods,
      ...extItems,
      playCards.length > 0 && h('span', { class: 'hand-sep' }),
      ...playCards,
    );
    // The CSS sizes the narrowest fan from these (hud.css, `.hand`).
    hand.style.setProperty('--hand-n', String(hand.querySelectorAll(':scope > .hcard').length));
    hand.style.setProperty(
      '--hand-seps',
      String(hand.querySelectorAll(':scope > .hand-sep').length),
    );

    const sideBtn = (label: 'Trade' | 'Bank', enabled: boolean, d: 'trade' | 'bank') => {
      const why = enabled && !over ? null : tradeBlockReason(state, view.viewer, d);
      return h(
        'button',
        {
          class: `act tbtn${this.dialog === d ? ' is-active' : ''}`,
          disabled: !enabled || over,
          on: { click: () => this.open(d) },
          ...(why ? { attrs: { 'data-why': why } } : {}),
        },
        glyph(label === 'Trade' ? 'trade' : 'bank', 20),
        h('span', {}, label),
      );
    };
    const trade = h(
      'div',
      { class: 'trade-col wood' },
      sideBtn('Trade', av.offerTrade, 'trade'),
      sideBtn('Bank', av.bankTrade, 'bank'),
    );

    const toggleMode = (m: PlaceMode) => () => this.setPlaceMode(this.placeMode === m ? null : m);
    const myHand = me.resources;
    const build = h(
      'div',
      { class: 'build-bar wood', style: playerStyle(me.color) },
      ...buildCards(state, view.viewer, av)
        .filter((c) => !hiddenBaseCards(state).has(c.kind))
        .map((c) => {
          const why = blockReasons(state, view.viewer, over ? { ...c, enabled: false } : c);
          // What the card's place mode submits on the board (the playtest CLI reads it).
          const actionsAttr: Record<string, string> =
            c.kind === 'dev' ? {} : { 'data-actions': BUILD_ACTION[c.kind] };
          const button = h(
            'button',
            {
              class: `act bcard${c.kind !== 'dev' && this.placeMode === c.kind ? ' is-active' : ''}${c.left === 0 ? ' is-out' : ''}`,
              disabled: !c.enabled || over,
              ...(why.length > 0
                ? { attrs: { 'data-why': why.map((w) => w.text).join('; '), ...actionsAttr } }
                : {
                    attrs: {
                      'aria-label': `${BUILD_LABEL[c.kind]}, cost ${costText(c.kind)}`,
                      ...actionsAttr,
                    },
                  }),
              on: {
                click: this.unlessLongPress(
                  c.kind === 'dev'
                    ? () => this.send({ type: 'buyDevCard', player: view.viewer })
                    : toggleMode(c.kind),
                ),
              },
            },
            h(
              'span',
              { class: 'bcard-art' },
              c.kind === 'dev' ? devCardFace(null, 26) : glyph(c.kind, 30),
            ),
            h('span', { class: 'bcard-label' }, BUILD_LABEL[c.kind]),
            h('span', { class: 'bcard-left' }, `${c.left}/${c.total}`),
            h(
              'span',
              { class: 'cost', attrs: { 'aria-hidden': 'true' } },
              ...Object.entries(BUILD_COST[c.kind]).flatMap(([r, n]) =>
                Array.from({ length: n }, () => resCardFace(r as Resource, 16)),
              ),
            ),
          );
          // #35: the cost tooltip (hover, long-press); the "Missing …" line comes from costTip.
          const tip = costTip(
            BUILD_LABEL[c.kind],
            BUILD_COST[c.kind],
            myHand,
            why.filter((w) => !w.missing).map((w) => h('span', { class: 'why-line' }, w.text)),
          );
          return this.buildSlot(c.kind, button, tip, why.length > 0);
        }),
    );

    // Expansion build cards (docs/EXPANSIONS.md §8): same look, enabled from legal actions only.
    for (const x of hudExtensionsFor(state)) {
      for (const c of x.buildCards ?? []) {
        // `available`: is the card in this game at all; `alsoActions`: more types it places.
        if (c.available && !c.available(state)) continue;
        const enabled =
          !over && legal.some((a) => a.type === c.actionType || c.alsoActions?.includes(a.type));
        const cost = costOf(state, c.costItem ?? c.mode);
        const left = c.left?.(state, view.viewer);
        const total = c.total?.(state, view.viewer);
        const missing = cost ? missingCards(cost, myHand) : {};
        const blocker = over ? null : (c.blocker?.(state, view.viewer) ?? null);
        const reasons = [
          Object.keys(missing).length > 0 ? `Missing ${costLabel(missing)}` : null,
          blocker,
        ].filter((x): x is string => x !== null);
        const why = reasons.length > 0 ? reasons.join('; ') : 'Not possible right now';
        const tip = costTip(c.label, cost ?? null, myHand, [
          !enabled && blocker === null && reasons.length === 0
            ? h('span', { class: 'why-line' }, why)
            : null,
          blocker === null ? null : h('span', { class: 'why-line' }, blocker),
        ]);
        build.append(
          this.buildSlot(
            c.mode,
            h(
              'button',
              {
                class: `act bcard ext-card${this.placeMode === c.mode ? ' is-active' : ''}${left === 0 ? ' is-out' : ''}`,
                disabled: !enabled,
                // data-actions: what the card's place mode submits on the board (playtest CLI).
                attrs: {
                  'data-actions': [c.actionType, ...(c.alsoActions ?? [])].join(' '),
                  ...(enabled
                    ? { 'aria-label': `${c.label}${cost ? `, cost ${describeCost(cost)}` : ''}` }
                    : { 'data-why': why }),
                },
                on: { click: this.unlessLongPress(toggleMode(c.mode)) },
              },
              h('span', { class: 'bcard-art' }, glyph(c.glyph ?? 'settlement', 30)),
              h('span', { class: 'bcard-label' }, c.label),
              left !== undefined && h('span', { class: 'bcard-left' }, `${left}/${total ?? left}`),
              cost &&
                h(
                  'span',
                  { class: 'cost', attrs: { 'aria-hidden': 'true' } },
                  ...RESOURCES.flatMap((r) =>
                    Array.from({ length: cost[r] }, () => resCardFace(r, 16)),
                  ),
                ),
            ),
            tip,
            !enabled,
          ),
        );
      }
    }

    // DOM order puts the build bar first so text lookups ("Road") hit it before "Road Building";
    // CSS `order` shows hand | trade | build from left to right.
    build.style.setProperty('--build-n', String(build.childElementCount));
    return [build, trade, hand];
  }

  /**
   * A hand card with an info card (#devinfo, #cardinfo). A card one plays is `.can-play` with
   * `play` (the click plays it), else `.is-off` + aria-disabled (the click opens the info card;
   * `why`, its status line, goes to data-why). A good (C&K commodity, E&P gold) is never played:
   * the click opens its info card.
   */
  private infoCardButton(o: {
    key: string;
    kind: 'play' | 'good';
    name: string;
    count: number;
    face: HTMLElement;
    play: (() => void) | null;
    why: string | null;
    cls: string;
    tag?: string | undefined;
    title?: string | undefined;
    attrs?: Record<string, string>;
  }): HTMLElement {
    const open = this.cardInfo === o.key;
    const n = o.count;
    const stack = n === 0 ? ' is-zero' : n >= 3 ? ' stack-3' : n === 2 ? ' stack-2' : '';
    const off = o.kind === 'play' && !o.play;
    const look = o.kind === 'good' ? ' is-info' : off ? ' is-off' : ' can-play';
    return h(
      'button',
      {
        class: `hcard ${o.cls}${stack}${look}${open ? ' is-open' : ''}`,
        ...(o.title ? { title: o.title } : {}),
        attrs: {
          'aria-label': `${o.name} ×${n}${off ? ", can't play now" : ''}`,
          'data-info': o.key,
          ...o.attrs,
          ...(o.play ? {} : { 'aria-expanded': String(open) }),
          ...(off ? { 'aria-disabled': 'true' } : {}),
          ...(open ? { 'aria-describedby': this.infoPop.id } : {}),
          // The playtest CLI reads data-why (scripts/playtest/inpage.js).
          ...(off && o.why !== null ? { 'data-why': o.why } : {}),
        },
        on: this.infoCardOn(o.key, o.play),
      },
      o.face,
      o.tag && h('span', { class: 'new-tag' }, o.tag),
      h('span', { class: 'count-badge' }, String(n)),
    );
  }

  /**
   * The open hand card's info card (#devinfo, #cardinfo): face, name, what it does, and whether
   * it can be played now (or why not, and when). One node for the HUD's life with its content
   * patched, so a re-render under it (a bot moving) changes only text that changed. It closes
   * when its card leaves the hand (played, spent, a spectator's view).
   */
  private cardInfoCard(): HTMLElement[] {
    const c = this.cardInfo === null ? undefined : this.handInfo.get(this.cardInfo);
    if (!c) {
      this.cardInfo = null;
      return [];
    }
    const n = c.count;
    patchChildren(this.infoPop, [
      h(
        'div',
        { class: 'di-head' },
        c.face(34),
        h(
          'span',
          { class: 'di-title' },
          h('b', {}, c.name),
          h('span', { class: 'muted' }, n === 1 ? 'You have 1' : `You have ${n}`),
        ),
      ),
      h('p', { class: 'di-text' }, c.text),
      ...(c.status
        ? [h('p', { class: `di-when${c.status.playable ? ' is-ok' : ''}` }, c.status.line)]
        : []),
      ...c.notes.map((line) => h('p', { class: 'di-when' }, line)),
    ]);
    this.queuePlaceCardInfo();
    return [this.infoPop];
  }

  private queuePlaceCardInfo(): void {
    if (this.infoPopQueued) return;
    this.infoPopQueued = true;
    beforePaint(() => {
      this.infoPopQueued = false;
      this.placeCardInfo();
    });
  }

  /** Put the info card above its card, inside the window: layout reads first, then the writes. */
  private placeCardInfo(): void {
    const pop = this.infoPop;
    const card =
      this.cardInfo === null
        ? null
        : this.regions.bottom.querySelector<HTMLElement>(`.hcard[data-info="${this.cardInfo}"]`);
    if (!card || !pop.isConnected) return;
    const at = card.getBoundingClientRect();
    const box = this.regions.pop.getBoundingClientRect();
    const w = pop.offsetWidth;
    const ht = pop.offsetHeight;
    const MARGIN = 8;
    const left = at.left - box.left + at.width / 2 - w / 2;
    const x = Math.round(Math.max(MARGIN, Math.min(left, box.width - w - MARGIN)));
    const y = Math.round(Math.max(MARGIN, at.top - box.top - ht - 12));
    const key = `${x}/${y}`;
    if (key !== this.infoPopAt) {
      this.infoPopAt = key;
      pop.style.setProperty('--x', `${x}px`);
      pop.style.setProperty('--y', `${y}px`);
    }
    pop.classList.remove('is-placing');
  }

  /**
   * Spectators (#35): the build cards as a read-only price list, each with its cost tooltip
   * (hover / tap), base and expansion cards alike.
   */
  private costBar(state: GameState): HTMLElement {
    const hidden = hiddenBaseCards(state);
    const card = (key: string, label: string, art: HTMLElement, cost: Cost | null) =>
      this.buildSlot(
        key,
        h(
          'button',
          { class: 'act bcard', disabled: true, attrs: { 'data-why': 'Spectating' } },
          h('span', { class: 'bcard-art' }, art),
          h('span', { class: 'bcard-label' }, label),
          cost &&
            h(
              'span',
              { class: 'cost', attrs: { 'aria-hidden': 'true' } },
              ...RESOURCES.flatMap((r) =>
                Array.from({ length: cost[r] ?? 0 }, () => resCardFace(r, 16)),
              ),
            ),
        ),
        costTip(label, cost, null, [h('span', { class: 'why-line' }, 'You are watching')]),
        true,
      );
    const base = (['dev', 'road', 'settlement', 'city'] as const)
      .filter((k) => !hidden.has(k) && (k !== 'dev' || devDeckCounts(state).total > 0))
      .map((k) =>
        card(k, BUILD_LABEL[k], k === 'dev' ? devCardFace(null, 26) : glyph(k, 30), BUILD_COST[k]),
      );
    const ext = hudExtensionsFor(state).flatMap((x) =>
      (x.buildCards ?? [])
        .filter((c) => !c.available || c.available(state))
        .map((c) =>
          card(
            c.mode,
            c.label,
            glyph(c.glyph ?? 'settlement', 30),
            costOf(state, c.costItem ?? c.mode) ?? null,
          ),
        ),
    );
    const bar = h('div', { class: 'build-bar wood is-costs' }, ...base, ...ext);
    bar.style.setProperty('--build-n', String(bar.childElementCount));
    return bar;
  }

  // --- bottom-right: dice, roll, end turn ------------------------------------

  private controls(state: GameState, view: HudView, av: Availability): HTMLElement[] {
    const over = state.phase.kind === 'gameOver';
    return [
      this.diceBox(state),
      h(
        'div',
        { class: 'ctl-btns' },
        h(
          'button',
          {
            class: `act btn-roll${av.roll ? ' is-ready' : ''}`,
            disabled: !av.roll || over,
            on: { click: () => this.send({ type: 'rollDice', player: view.viewer }) },
          },
          glyph('dice', 24),
          h('span', {}, 'Roll dice'),
        ),
        // During a special build step (5+ players) the same button passes the step instead.
        av.passSpecialBuild
          ? h(
              'button',
              {
                class: 'act btn-end is-ready',
                disabled: over,
                title: 'End your special build step',
                on: {
                  click: () => this.send({ type: 'passSpecialBuild', player: view.viewer }),
                },
              },
              glyph('next', 20),
              h('span', {}, 'Pass'),
            )
          : h(
              'button',
              {
                class: `act btn-end${av.endTurn && !av.roll ? ' is-ready' : ''}`,
                disabled: !av.endTurn || over,
                on: { click: () => this.send({ type: 'endTurn', player: view.viewer }) },
              },
              glyph('next', 20),
              h('span', {}, 'End turn'),
            ),
      ),
    ];
  }

  private diceBox(state: GameState): HTMLElement {
    const d = state.dice;
    if (!d) {
      this.lastDice = 'stale'; // the first roll of the game animates
      return h(
        'div',
        { class: 'dice dice-empty', title: 'No roll yet' },
        h('span', { class: 'die die-blank' }),
        h('span', { class: 'die die-blank' }),
      );
    }
    // Animate only for a roll made this turn. Before the roll (preRoll, special build, setup)
    // the faces are last turn's, so End turn must not re-tumble them; a reload or reconnect
    // (first render) shows the faces still.
    const stale = ['preRoll', 'specialBuild', 'setup', 'mapVeto'].includes(state.phase.kind);
    const key = stale ? 'stale' : `${state.turn.number}:${d[0]}:${d[1]}`;
    const fresh = !stale && this.lastDice !== '' && key !== this.lastDice;
    this.lastDice = key;
    const total = diceTotal(d);
    // Event Cards: the card's event is shown under the dice.
    const event = state.lastEvent ? EVENT_INFO[state.lastEvent] : null;
    return h(
      'div',
      {
        class: `dice${fresh ? ' rolling' : ''}${total === 7 ? ' is-seven' : ''}`,
        title: event ? `Last card: ${total}, ${event.name}. ${event.text}` : `Last roll: ${total}`,
      },
      dieFace(d[0]),
      dieFace(d[1]),
      h('span', { class: 'dice-total' }, String(total)),
      event && state.lastEvent !== 'none' && h('span', { class: 'dice-event' }, event.name),
    );
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
      // The engine needs an explicit steal action even with one victim; the controllers submit
      // that one on their own (#34, `autoSteal`), so the picker shows for a real choice.
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
    if (phase.kind === 'mapVeto' && ofType(legal, 'vetoMap').length > 0) {
      return this.vetoDialog(state, legal);
    }
    if (phase.kind === 'event') {
      const d = this.eventDialog(state, view, legal);
      if (d) return d;
    }
    for (const x of hudExtensionsFor(state)) {
      const d = x.dialog?.(state, view, legal, (a) => this.send(a));
      if (d) return d;
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
      case 'card': {
        // A module card's play dialog (#cardinfo): gone once the card can't be played.
        const play = this.cardDialog === null ? null : this.extHand.get(this.cardDialog)?.play;
        const d = play && 'dialog' in play ? play.dialog(() => this.closeDialog()) : null;
        if (d) return d;
        this.dialog = null;
        return this.repairCard(legal);
      }
      default:
        return this.repairCard(legal);
    }
  }

  // --- V1 variant dialogs: map veto, event-card choices, road repair ----------

  private vetoDialog(state: GameState, legal: Action[]) {
    const phase = state.phase;
    if (phase.kind !== 'mapVeto') return null;
    const acts = ofType(legal, 'vetoMap');
    return {
      key: `veto-${phase.next}`,
      title: 'Veto a map',
      modal: true,
      wide: true,
      body: [
        h(
          'p',
          { class: 'sub' },
          'Players veto in turn until one map is left. Pick the board you least want to play.',
        ),
        h(
          'div',
          { class: 'veto-maps' },
          ...phase.candidates.map((c, i) => {
            const act = acts.find((a) => a.candidate === i);
            const by = phase.vetoed[i];
            return h(
              'button',
              {
                class: `veto-map${by !== null && by !== undefined ? ' is-vetoed' : ''}`,
                disabled: !act,
                attrs: { 'data-k': `veto-${i}`, 'aria-label': `Veto map ${i + 1}` },
                on: { click: () => act && this.send(act) },
              },
              boardPreviewSvg(state.settings.map, c.board),
              h(
                'span',
                { class: 'veto-label' },
                by !== null && by !== undefined
                  ? `Map ${i + 1}: vetoed by ${getPlayer(state, by).name}`
                  : `Veto map ${i + 1}`,
              ),
            );
          }),
        ),
      ],
    };
  }

  private eventDialog(state: GameState, view: HudView, legal: Action[]) {
    const phase = state.phase;
    if (phase.kind !== 'event') return null;
    const task = phase.tasks.find((t) => t.player === view.viewer);
    if (!task || task.kind === 'damageRoad') return null; // Earthquake: picked on the board
    const info = EVENT_INFO[phase.event];
    const base = { key: `event-${state.turn.number}-${view.viewer}`, modal: true };
    const note = h('p', { class: 'sub' }, info.text);
    if (task.kind === 'gain') {
      const acts = ofType(legal, 'eventGain');
      return {
        ...base,
        title: `${info.name}: take a resource`,
        body: [
          note,
          this.resourcePick(
            null,
            (r) => acts.some((a) => a.resource === r),
            (r) => {
              const a = acts.find((x) => x.resource === r);
              if (a) this.send(a);
            },
          ),
        ],
      };
    }
    if (task.kind === 'give') {
      const acts = ofType(legal, 'eventGive');
      const to =
        task.targets.length === 1
          ? task.targets[0]
          : this.eventTo !== null && task.targets.includes(this.eventTo)
            ? this.eventTo
            : null;
      return {
        ...base,
        title: `${info.name}: give a resource`,
        body: [
          note,
          task.targets.length > 1 &&
            h(
              'div',
              { class: 'victims' },
              ...task.targets.map((id) => {
                const p = getPlayer(state, id);
                return h(
                  'button',
                  {
                    class: `victim${to === id ? ' is-on' : ''}`,
                    style: { '--pc': p.color },
                    attrs: { 'aria-pressed': String(to === id) },
                    on: {
                      click: () => {
                        this.eventTo = id;
                        this.refresh();
                      },
                    },
                  },
                  avatar(p, view.bots?.[id] ?? false, 44),
                  h('span', { class: 'victim-name' }, p.name),
                );
              }),
            ),
          to !== null && to !== undefined
            ? h(
                'div',
                {},
                h('p', { class: 'sub' }, `Give ${getPlayer(state, to).name} one of your cards:`),
                this.resourcePick(
                  null,
                  (r) => acts.some((a) => a.to === to && a.resource === r),
                  (r) => {
                    const a = acts.find((x) => x.to === to && x.resource === r);
                    if (a) this.send(a);
                  },
                ),
              )
            : h('p', { class: 'sub' }, 'Pick a player with fewer points first.'),
        ],
      };
    }
    // steal
    const acts = ofType(legal, 'eventSteal');
    const pass = acts.find((a) => a.victim === null);
    return {
      ...base,
      title: `${info.name}: take a card from whom?`,
      body: [
        note,
        h(
          'div',
          { class: 'victims' },
          ...task.targets.map((id) => {
            const p = getPlayer(state, id);
            const act = acts.find((a) => a.victim === id);
            return h(
              'button',
              {
                class: 'victim',
                style: { '--pc': p.color },
                disabled: !act,
                on: { click: () => act && this.send(act) },
              },
              avatar(p, view.bots?.[id] ?? false, 44),
              h('span', { class: 'victim-name' }, p.name),
              h('span', { class: 'muted' }, `${handCount(state, id)} cards`),
            );
          }),
        ),
        pass &&
          h(
            'div',
            { class: 'dialog-actions' },
            h(
              'button',
              { class: 'btn btn-ghost', on: { click: () => this.send(pass) } },
              'Take nothing',
            ),
          ),
      ],
    };
  }

  /** Earthquake: a docked card offering the repair while the viewer has a damaged road. */
  private repairCard(legal: Action[]) {
    const act = ofType(legal, 'repairRoad')[0];
    if (!act) return null;
    return {
      key: 'repair',
      title: 'Damaged road',
      modal: false,
      side: true,
      body: [
        h(
          'p',
          { class: 'sub' },
          'Earthquake: you cannot build roads, or settlements next to the damaged road, until it is repaired.',
        ),
        h(
          'div',
          { class: 'dialog-actions' },
          h(
            'button',
            {
              class: 'btn btn-primary',
              attrs: { 'data-k': 'repair' },
              on: { click: () => this.send(act) },
            },
            'Repair (1 brick, 1 lumber)',
          ),
        ),
      ],
    };
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
    held?: number,
  ): HTMLElement {
    return h(
      'div',
      {
        class: `step${value > 0 ? ' has-value' : ''}${held === 0 ? ' is-none' : ''}`,
        style: { '--rc': `var(--res-${resource})` },
      },
      resourceIcon(resource, 26),
      h('span', { class: 'step-name' }, RESOURCE_LABEL[resource]),
      held === undefined ? null : h('span', { class: 'step-have' }, `you have ${held}`),
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

  private bundleRow(bundle: ResourceCounts, extra: Child[] = []): HTMLElement {
    return h(
      'span',
      { class: 'bundle' },
      ...RESOURCES.filter((r) => bundle[r] > 0).map((r) =>
        h('span', { class: 'bundle-item' }, resCardFace(r, 24), `×${bundle[r]}`),
      ),
      ...extra,
    );
  }

  /** Expansion items of the open offer (offerExtras hook). */
  private offerExtras(state: GameState, side: 'give' | 'want'): Child[] {
    return hudExtensionsFor(state).flatMap((x) => x.offerExtras?.(state, side) ?? []);
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
          avatar(p, this.view?.bots?.[id] ?? false, 24),
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
          this.bundleRow(offer.give, this.offerExtras(state, 'give')),
          h('span', { class: 'swap' }, '⇄'),
          h('span', {}, 'you get'),
          this.bundleRow(offer.want, this.offerExtras(state, 'want')),
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
          avatar(from, view.bots?.[offer.from] ?? false, 28),
          h('span', {}, `${from.name} gives`),
          this.bundleRow(offer.give, this.offerExtras(state, 'give')),
          h('span', { class: 'swap' }, '⇄'),
          h('span', {}, 'you give'),
          this.bundleRow(offer.want, this.offerExtras(state, 'want')),
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
    const status = discardStatus(hand, required, sel);
    const rows = discardRows(hand, sel, required);
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
          ...rows.map((row) =>
            this.stepper(
              row.resource,
              row.picked,
              (d) => {
                this.discardSel = stepDiscard(sel, row.resource, d, hand, required);
                this.refresh();
              },
              row.max,
              row.held,
            ),
          ),
        ),
        h(
          'p',
          { class: `discard-status${status.ok ? ' is-ok' : ''}`, attrs: { role: 'status' } },
          status.text,
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
            const count = handCount(state, id);
            return h(
              'button',
              {
                class: 'victim',
                style: { '--pc': p.color },
                disabled: !act,
                on: { click: () => act && this.send(act) },
              },
              avatar(p, view.bots?.[id] ?? false, 44),
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

  private winnerScreen(state: GameState, hasStats: boolean): HTMLElement {
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
          'div',
          { class: 'winner-actions' },
          hasStats &&
            h(
              'button',
              {
                class: 'btn btn-lg winner-stats',
                on: {
                  click: () => {
                    this.statsOpen = true;
                    this.statsCollapsed = false;
                    this.statsEntering = true;
                    this.refresh();
                  },
                },
              },
              'Game stats',
            ),
          ...this.endActions('btn-lg'),
        ),
      ),
    );
  }

  private newSetupScreen(): SetupScreen {
    const learn = this.learnToPlay;
    return new SetupScreen({
      onBack: this.state ? () => this.hideNewGame() : undefined,
      onTutorial: learn
        ? (course?: string) => {
            this.newGameOpen = false;
            this.setup = null;
            this.unlockedViewer = null;
            this.state = null;
            this.view = null;
            this.refresh();
            learn(course);
          }
        : undefined,
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
