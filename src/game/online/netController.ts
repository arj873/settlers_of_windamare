/**
 * NetGameController (M3): plays a game from server views. The server owns the state; this only
 * renders `game` messages (board + HUD), turns clicks into intents, and counts the server's turn
 * clock down between messages. Same board/HUD wiring as the hotseat GameController, no engine
 * calls on the view (docs/MULTIPLAYER.md §6).
 */
import type { Action, GameState, PlayerId } from '../../engine';
import type { MemberId, RoomClient, RoomInfo } from '../../net';
import type { AvatarRef, SeatLook } from '../../ui/profile/model';
import type { HudView, PlaceMode } from '../../ui';
import type { BoardLike, HudLike, ToastKind } from '../controller';
import { autoSteal, tradeEndNotice, type BoardClick } from '../logic';
import { emitGameNotice, gameNotices, type NoticeSink } from '../notices';
import { TurnRecap } from '../recap';
import { SpotPicker, type SpotPromptLike } from '../spotPicker';
import type { SoundObserver } from '../sounds';

export interface NetControllerOptions {
  board: BoardLike;
  hud: HudLike;
  client: RoomClient;
  toast?: (message: string, kind: ToastKind) => void;
  onRender?: () => void;
  /** Shows a game notice (steal, award; `notices.ts`); default: an info toast. */
  notice?: NoticeSink;
  /** Timer tick; injectable for tests. */
  every?: (fn: () => void, ms: number) => () => void;
  /** PR1: the seats' pictures and piece styles, before each render (cosmetic). */
  onLooks?: (looks: readonly SeatLook[]) => void;
  /** The popover a click on a board spot opens (issue #28); absent = a click acts at once. */
  prompt?: SpotPromptLike | null;
  /** The "Confirm before building" setting; default on. */
  confirmBuild?: () => boolean;
  /** Sound effects (A1): told about every rendered view and the turn timer. */
  sounds?: SoundObserver;
}

/** PR1: each seat's look from its occupant's profile (open seats: none, classic). */
export function roomLooks(
  room: RoomInfo | null,
  avatarOf: (member: MemberId) => AvatarRef | null,
  players: number,
): SeatLook[] {
  return Array.from({ length: players }, (_, i) => {
    const occupant = room?.seats[i]?.occupant ?? null;
    const m = occupant === null ? undefined : room?.members.find((x) => x.id === occupant);
    if (!m) return {};
    const avatar = avatarOf(m.id);
    return {
      ...(avatar === null ? {} : { avatar }),
      ...(m.pieceStyle ? { pieceStyle: m.pieceStyle } : {}),
    };
  });
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
  private readonly notice: NoticeSink;
  private readonly every: (fn: () => void, ms: number) => () => void;
  private readonly onLooks: (looks: readonly SeatLook[]) => void;
  private readonly sounds: SoundObserver | null;
  private active = false;
  private placeMode: PlaceMode | null = null;
  private readonly spots: SpotPicker;
  private stopTimer: (() => void) | null = null;
  private shownSec = -1;
  /** The last rendered view, to notice an ended trade offer (`tradeEndNotice`). */
  private shown: GameState | null = null;
  private readonly recap = new TurnRecap();
  /** The last action this seat sent (a cancel / confirm / reject ends offers on purpose). */
  private lastSent: Action['type'] | null = null;
  /** The steal phase whose only steal this seat already sent on its own (#34). */
  private autoKey: string | null = null;
  private readonly offs: (() => void)[] = [];

  constructor(opts: NetControllerOptions) {
    this.board = opts.board;
    this.hud = opts.hud;
    this.client = opts.client;
    this.toast = opts.toast ?? ((m) => console.info(m));
    this.onRender = opts.onRender ?? (() => undefined);
    this.notice = opts.notice ?? ((n) => this.toast(n.text, 'info'));
    this.every = opts.every ?? defaultEvery;
    this.onLooks = opts.onLooks ?? (() => undefined);
    const board = this.board;
    this.spots = new SpotPicker({
      prompt: opts.prompt ?? null,
      screenPos: (id) => board.screenPos?.(id) ?? null,
      confirm: opts.confirmBuild ?? (() => true),
      submit: (a) => this.send(a),
      rehighlight: () => this.updateHighlights(),
    });
    this.sounds = opts.sounds ?? null;

    // The HUD has no unsubscribe: these stay registered and check `active`.
    this.hud.on('action', (a) => {
      if (this.active) this.send(a);
    });
    this.hud.on('placeMode', (m) => {
      if (!this.active) return;
      this.placeMode = m;
      this.spots.close();
      this.updateHighlights();
    });
    this.offs.push(
      this.board.on('vertexClick', (id) => this.click({ kind: 'vertex', id })),
      this.board.on('edgeClick', (id) => this.click({ kind: 'edge', id })),
      this.board.on('hexClick', (id) => this.click({ kind: 'hex', id })),
      // Server errors are toasted by the online app (lobby and game alike).
      this.client.on((e) => {
        if (this.active && (e.type === 'game' || e.type === 'room' || e.type === 'avatars')) {
          this.render();
        }
      }),
    );
  }

  /** The seat this browser plays (null = spectator). */
  get viewer(): PlayerId | null {
    return this.client.game?.view.view.viewer ?? null;
  }

  /** Board actions a click may lead to right now (GameController.boardActions). */
  get boardActions(): Action[] {
    const g = this.client.game;
    const v = this.viewer;
    return g && v !== null
      ? this.spots.targets({ legal: g.legal, viewer: v, placeMode: this.placeMode })
      : [];
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
    this.spots.close();
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
    this.lastSent = action.type;
    if (!this.client.intent(action)) {
      this.toast('Not connected: your move was not sent. Reconnecting…', 'error');
    }
  }

  private click(click: BoardClick): void {
    const g = this.client.game;
    const v = this.viewer;
    if (!this.active || !g || v === null) return;
    this.spots.click(
      { state: g.view, legal: g.legal, viewer: v, placeMode: this.placeMode },
      click,
    );
  }

  private render(): void {
    const g = this.client.game;
    const hv = this.hudView();
    if (!g || !hv) return;
    this.spots.sync({ legal: g.legal, viewer: this.viewer, placeMode: this.placeMode });
    const prev = this.shown;
    const notices = prev ? gameNotices(prev, g.view, hv.viewer) : [];
    this.noticeTradeEnd(g.view, hv.viewer);
    // #34: rob the only player who can be robbed at once; the dialog never opens for it.
    const steal = autoSteal(g.legal, hv.viewer);
    if (steal) {
      hv.legal = g.legal.filter((a) => a !== steal);
      const key = JSON.stringify([g.view.turn.number, g.view.phase, steal]);
      if (key !== this.autoKey) {
        this.autoKey = key;
        this.send(steal);
      }
    }
    this.shownSec = hv.turnTimer ? Math.ceil(hv.turnTimer.remainingSec) : -1;
    this.onLooks(
      roomLooks(this.client.room, (m) => this.client.avatarOf(m), g.view.players.length),
    );
    this.board.render(g.view);
    this.hud.render(g.view, hv);
    const seat = this.viewer;
    this.sounds?.observe(g.view, {
      viewer: seat,
      local: g.view.players.map((_, i) => i === seat),
      bots: hv.bots ?? [],
    });
    this.updateHighlights();
    this.onRender();
    for (const n of notices) {
      this.notice(n, g.view, hv.viewer < 0 ? null : hv.viewer);
      emitGameNotice(n);
    }
    // #33: your turn again: briefly mark what the others built since your last one.
    const since = this.recap.update(prev, g.view, hv.viewer);
    if (since) this.board.markSince?.(since);
  }

  /** Toast how a trade offer this seat took part in ended, unless the seat ended it itself. */
  private noticeTradeEnd(view: GameState, viewer: PlayerId): void {
    const prev = this.shown;
    this.shown = view;
    if (!prev || prev === view || viewer < 0) return;
    const own =
      this.lastSent === 'cancelTrade' ||
      this.lastSent === 'confirmTrade' ||
      this.lastSent === 'rejectTrade';
    const notice = tradeEndNotice(prev, view, viewer, own);
    if (prev.phase.kind === 'trade' && view.phase.kind !== 'trade') this.lastSent = null;
    if (notice) this.toast(notice, 'info');
  }

  private updateHighlights(): void {
    const g = this.client.game;
    const v = this.viewer;
    if (!g || v === null) {
      this.board.setHighlights({});
      return;
    }
    this.board.setHighlights(
      this.spots.highlights({
        state: g.view,
        legal: g.legal,
        viewer: v,
        placeMode: this.placeMode,
      }),
    );
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
    const owner = this.client.game.timer?.player;
    this.sounds?.timer(t ? t.remainingSec : null, owner !== undefined && owner === this.viewer);
  }
}
