/**
 * NetGameController (M3): plays a game from server views. The server owns the state; this only
 * renders `game` messages (board + HUD), turns clicks into intents, and counts the server's turn
 * clock down between messages. Same board/HUD wiring as the hotseat GameController, no engine
 * calls on the view (docs/MULTIPLAYER.md §6).
 */
import type { Action, PlayerId } from '../../engine';
import type { RoomClient, RoomInfo } from '../../net';
import type { HudView, PlaceMode } from '../../ui';
import type { BoardLike, HudLike, ToastKind } from '../controller';
import { actionForClick, boardActions, highlightsFor, type BoardClick } from '../logic';

export interface NetControllerOptions {
  board: BoardLike;
  hud: HudLike;
  client: RoomClient;
  toast?: (message: string, kind: ToastKind) => void;
  onRender?: () => void;
  /** Timer tick; injectable for tests. */
  every?: (fn: () => void, ms: number) => () => void;
}

export const NET_TIMER_TICK_MS = 250;

/** Seats a bot is playing, and seats whose human is disconnected (player list icons). */
export function seatFlags(room: RoomInfo | null, players: number) {
  const seats = room?.seats ?? [];
  const connected = new Map((room?.members ?? []).map((m) => [m.id, m.connected]));
  const bots: boolean[] = [];
  const away: boolean[] = [];
  for (let i = 0; i < players; i++) {
    const s = seats[i];
    bots.push(s?.status === 'bot');
    away.push(
      s !== undefined &&
        (s.status === 'away' || (s.occupant !== null && connected.get(s.occupant) === false)),
    );
  }
  return { bots, away };
}

const defaultEvery = (fn: () => void, ms: number) => {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
};

export class NetGameController {
  private readonly board: BoardLike;
  private readonly hud: HudLike;
  private readonly client: RoomClient;
  private readonly toast: (message: string, kind: ToastKind) => void;
  private readonly onRender: () => void;
  private readonly every: (fn: () => void, ms: number) => () => void;
  private active = false;
  private placeMode: PlaceMode | null = null;
  private stopTimer: (() => void) | null = null;
  private shownSec = -1;
  private readonly offs: (() => void)[] = [];

  constructor(opts: NetControllerOptions) {
    this.board = opts.board;
    this.hud = opts.hud;
    this.client = opts.client;
    this.toast = opts.toast ?? ((m) => console.info(m));
    this.onRender = opts.onRender ?? (() => undefined);
    this.every = opts.every ?? defaultEvery;

    // The HUD has no unsubscribe: these stay registered and check `active`.
    this.hud.on('action', (a) => {
      if (this.active) this.send(a);
    });
    this.hud.on('placeMode', (m) => {
      if (!this.active) return;
      this.placeMode = m;
      this.updateHighlights();
    });
    this.offs.push(
      this.board.on('vertexClick', (id) => this.click({ kind: 'vertex', id })),
      this.board.on('edgeClick', (id) => this.click({ kind: 'edge', id })),
      this.board.on('hexClick', (id) => this.click({ kind: 'hex', id })),
      // Server errors are toasted by the online app (lobby and game alike).
      this.client.on((e) => {
        if (this.active && (e.type === 'game' || e.type === 'room')) this.render();
      }),
    );
  }

  /** The seat this browser plays (null = spectator). */
  get viewer(): PlayerId | null {
    return this.client.game?.view.view.viewer ?? null;
  }

  /** Board actions a click may submit right now. */
  get boardActions(): Action[] {
    const g = this.client.game;
    const v = this.viewer;
    return g && v !== null ? boardActions(g.legal, v, this.placeMode) : [];
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.placeMode = null;
    this.stopTimer = this.every(() => this.tickTimer(), NET_TIMER_TICK_MS);
    this.render();
  }

  stop(): void {
    this.active = false;
    this.stopTimer?.();
    this.stopTimer = null;
    this.board.setHighlights({});
  }

  destroy(): void {
    this.stop();
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  /** The HudView for the current game message (exported shape for tests). */
  hudView(): HudView | null {
    const g = this.client.game;
    if (!g) return null;
    const view = g.view;
    const viewer = view.view.viewer;
    const { bots, away } = seatFlags(this.client.room, view.players.length);
    return {
      viewer: viewer ?? -1,
      legal: g.legal,
      isBotTurn: bots[view.turn.current] === true,
      bots,
      away,
      turnTimer: this.timerView(),
      spectator: viewer === null,
      gameDurationMs: g.durationMs ?? null,
    };
  }

  private send(action: Action): void {
    if (!this.client.intent(action)) {
      this.toast('Not connected: your move was not sent. Reconnecting…', 'error');
    }
  }

  private click(click: BoardClick): void {
    if (!this.active) return;
    const action = actionForClick(this.boardActions, click);
    if (action) this.send(action);
  }

  private render(): void {
    const g = this.client.game;
    const hv = this.hudView();
    if (!g || !hv) return;
    this.shownSec = hv.turnTimer ? Math.ceil(hv.turnTimer.remainingSec) : -1;
    this.board.render(g.view);
    this.hud.render(g.view, hv);
    this.updateHighlights();
    this.onRender();
  }

  private updateHighlights(): void {
    const g = this.client.game;
    const v = this.viewer;
    if (!g || v === null) {
      this.board.setHighlights({});
      return;
    }
    this.board.setHighlights(highlightsFor(this.boardActions, g.view.players[v]?.color));
  }

  private timerView(): HudView['turnTimer'] {
    const g = this.client.game;
    const left = this.client.timerLeftMs();
    if (!g?.timer || left === null) return null;
    return { remainingSec: left / 1000, totalSec: g.timer.totalMs / 1000 };
  }

  private tickTimer(): void {
    if (!this.active || !this.client.game) return;
    const t = this.timerView();
    const shown = t ? Math.ceil(t.remainingSec) : -1;
    if (shown === this.shownSec) return;
    this.shownSec = shown;
    this.hud.setTurnTimer(t);
  }
}
