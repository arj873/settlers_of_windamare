/**
 * The online room visit (M3): room check, nickname, RoomClient, then lobby <-> game as the room
 * phase changes. Owns the chat panel (lobby column or HUD sidebar), the reaction bubbles, the
 * reconnect banner and the fatal-error screens. The game itself is NetGameController.
 */
import type { Hud } from '../../ui';
import {
  NAME_KEY,
  RoomClient,
  tokenKey,
  type ChatEntry,
  type Clock,
  type KeyStore,
  type MemberId,
  type RoomInfo,
} from '../../net';
import { ConnectionBanner } from '../../ui/online/banner';
import { ChatPanel, ReactionLayer } from '../../ui/online/chat';
import { HomeScreen, noticeScreen } from '../../ui/online/home';
import { LobbyScreen } from '../../ui/online/lobby';
import { inviteUrl } from '../../ui/online/lobbyModel';
import { errorText, fatalText } from '../../ui/online/messages';
import type { SessionAction } from '../../ui/types';
import type { BoardLike, ToastKind } from '../controller';
import type { Backend } from './backend';
import { NetGameController } from './netController';

export interface OnlineEnv {
  board: BoardLike;
  hud: Pick<Hud, 'render' | 'on' | 'isCovered' | 'setTurnTimer' | 'setChat' | 'setSessionActions'>;
  backend: Backend;
  /** The remembered nickname. */
  store: KeyStore;
  /** Reconnect tokens (backend.ts tokenStoreFor). */
  tokens: KeyStore;
  clock: Clock;
  toast: (message: string, kind: ToastKind) => void;
  onRender?: () => void;
  /** Where full-screen pages go (document.body). */
  layer: HTMLElement;
  /** This page's URL (invite links are built from it). */
  href: string;
  /** Leave the room: back to the home screen. */
  goHome: () => void;
  /** From the invite landing card: play hotseat instead. */
  playOffline: () => void;
}

export class OnlineApp {
  private screen: HTMLElement | null = null;
  private client: RoomClient | null = null;
  private lobby: LobbyScreen | null = null;
  private net: NetGameController | null = null;
  private chat: ChatPanel | null = null;
  private reactions: ReactionLayer | null = null;
  private banner: ConnectionBanner | null = null;
  private welcomed = false;
  private inGame = false;

  constructor(
    private readonly env: OnlineEnv,
    readonly roomId: string,
  ) {}

  get roomClient(): RoomClient | null {
    return this.client;
  }

  /** What `installDebugHook` (?debug=1, playtest harness) reads: the server view as the state. */
  get debugController() {
    const game = () => this.client?.game ?? null;
    const net = () => this.net;
    return {
      get state() {
        return game()?.view ?? null;
      },
      get legalActions() {
        return game()?.legal ?? [];
      },
      get viewer() {
        return game()?.view.view.viewer ?? null;
      },
      get boardActions() {
        return net()?.boardActions ?? [];
      },
    };
  }

  /** Check the room, ask for a nickname if needed, connect. */
  async run(): Promise<void> {
    this.show(noticeScreen('Joining room…', '', [], { spinner: true }));
    let room: { phase?: string } | null;
    try {
      room = await this.env.backend.api.check(this.roomId);
    } catch (e) {
      this.show(
        noticeScreen('Can’t reach the server', e instanceof Error ? e.message : String(e), [
          { label: 'Home', onClick: () => this.env.goHome() },
          { label: 'Try again', primary: true, onClick: () => void this.run() },
        ]),
      );
      return;
    }
    if (!room) {
      this.show(
        noticeScreen(
          'Room not found',
          `There is no room “${this.roomId}”. It may have expired, or the link is incomplete.`,
          [{ label: 'Home', primary: true, onClick: () => this.env.goHome() }],
        ),
      );
      return;
    }
    const name = this.env.store.get(NAME_KEY) ?? '';
    // Back in a room this browser already joined (reload, reconnect): straight in. A new
    // visitor confirms the (remembered) nickname first.
    if (this.env.tokens.get(tokenKey(this.roomId)) !== null) {
      this.connect(name);
      return;
    }
    const home = new HomeScreen({
      name,
      invite: { roomId: this.roomId, playing: room.phase === 'playing' || room.phase === 'over' },
      onOffline: () => {
        this.show(null);
        this.env.playOffline();
      },
      onCreate: () => Promise.resolve(),
      onJoin: (_code, nick) => {
        this.env.store.set(NAME_KEY, nick);
        this.connect(nick);
        return Promise.resolve();
      },
    });
    this.show(home.element);
  }

  /** Open the connection (also used right after creating a room). */
  connect(name: string): void {
    if (this.client) return;
    this.show(noticeScreen('Connecting…', '', [], { spinner: true }));
    const env = this.env;
    const client = new RoomClient({
      roomId: this.roomId,
      connect: env.backend.connect(this.roomId),
      clock: env.clock,
      store: env.tokens,
      ...(name ? { name } : {}),
      random: Math.random,
    });
    this.client = client;
    this.banner = new ConnectionBanner(env.layer, () => client.retryNow());
    this.reactions = new ReactionLayer(env.layer);
    this.chat = new ChatPanel({
      send: (text) => this.sendOrWarn(client.chatSend(text)),
      react: (r) => this.sendOrWarn(client.react(r)),
      colorOf: (e) => this.colorOf(e),
    });
    this.net = new NetGameController({
      board: env.board,
      hud: env.hud,
      client,
      toast: env.toast,
      ...(env.onRender ? { onRender: env.onRender } : {}),
    });
    client.on((e) => {
      switch (e.type) {
        case 'status':
          this.onStatus();
          break;
        case 'room':
          this.onRoom(e.room);
          break;
        case 'chat':
          this.chat?.add(e.entry);
          break;
        case 'reaction': {
          const m = client.room?.members.find((x) => x.id === e.member);
          this.reactions?.show(m?.name || 'Someone', this.seatColor(e.seat), e.reaction);
          break;
        }
        case 'error': {
          const text = errorText(e.code, e.message, e.ref);
          if (text && !client.fatal) env.toast(text, 'error');
          break;
        }
      }
    });
    addEventListener('online', () => client.retryNow());
    client.start();
  }

  // -------------------------------------------------------------------------

  private sendOrWarn(sent: boolean): boolean {
    if (!sent) this.env.toast('Not connected right now. Reconnecting…', 'error');
    return sent;
  }

  private seatColor(seat: number | null): string | null {
    if (seat === null) return null;
    return this.client?.room?.seats[seat]?.color ?? null;
  }

  private colorOf(e: ChatEntry): string | null {
    return this.seatColor(e.seat);
  }

  private onStatus(): void {
    const c = this.client;
    if (!c) return;
    if (c.status === 'open') {
      this.banner?.hide();
      if (!this.welcomed) {
        this.welcomed = true;
      }
      // Fresh chat history with every welcome (reconnects included).
      this.chat?.setEntries(c.chat);
      this.syncChatInput();
      return;
    }
    if (c.status === 'reconnecting') {
      if (!this.welcomed) {
        this.show(
          noticeScreen(
            'Can’t reach the room',
            'Still trying to connect…',
            [
              { label: 'Home', onClick: () => this.leave() },
              { label: 'Retry now', primary: true, onClick: () => c.retryNow() },
            ],
            { spinner: true },
          ),
        );
      } else {
        this.banner?.reconnecting(c.attempts);
      }
      this.syncChatInput();
      return;
    }
    if (c.status === 'closed' && c.fatal) {
      this.banner?.hide();
      this.net?.stop();
      const reload = c.fatal.code === 'version_mismatch' || c.fatal.code === 'replaced';
      this.show(
        noticeScreen('Disconnected', fatalText(c.fatal.code), [
          { label: 'Home', primary: !reload, onClick: () => this.env.goHome() },
          ...(reload
            ? [
                {
                  label: c.fatal.code === 'replaced' ? 'Play here instead' : 'Reload',
                  primary: true,
                  onClick: () => location.reload(),
                },
              ]
            : []),
        ]),
      );
    }
  }

  private onRoom(room: RoomInfo): void {
    const c = this.client;
    if (!c || !this.chat) return;
    const me: MemberId | null = c.you?.member ?? null;
    this.syncChatInput();
    if (room.phase === 'lobby') {
      if (this.inGame) {
        this.inGame = false;
        this.net?.stop();
        this.env.hud.setChat(null);
        this.env.hud.setSessionActions(null);
      }
      if (!this.lobby) {
        this.lobby = new LobbyScreen({
          roomId: this.roomId,
          inviteUrl: inviteUrl(this.env.href, this.roomId),
          chat: this.chat.element,
          actions: {
            setName: (name) => {
              this.env.store.set(NAME_KEY, name);
              this.sendOrWarn(c.setName(name));
            },
            takeSeat: (seat) => this.sendOrWarn(c.send({ type: 'takeSeat', seat })),
            leaveSeat: () => this.sendOrWarn(c.send({ type: 'leaveSeat' })),
            setColor: (color) => this.sendOrWarn(c.send({ type: 'setColor', color })),
            setBotLevel: (seat, level) =>
              this.sendOrWarn(c.send({ type: 'setBotLevel', seat, level })),
            configure: (config) => this.sendOrWarn(c.configure(config)),
            start: () => this.sendOrWarn(c.send({ type: 'start' })),
            leave: () => this.leave(),
          },
        });
      } else {
        this.lobby.attachChat(this.chat.element);
      }
      this.lobby.update(room, me);
      this.show(this.lobby.element);
      return;
    }
    // playing / over
    if (!this.inGame) {
      this.inGame = true;
      this.show(null);
      this.env.hud.setChat(this.chat.element);
      this.net?.start();
    }
    this.env.hud.setSessionActions(this.sessionActions(room));
  }

  private sessionActions(room: RoomInfo): SessionAction[] {
    const c = this.client;
    const leave: SessionAction = { label: 'Leave room', onClick: () => this.leave() };
    if (room.phase === 'over' && c?.isHost) {
      return [
        {
          label: 'Back to lobby',
          primary: true,
          onClick: () => this.sendOrWarn(c.send({ type: 'rematch' })),
        },
        leave,
      ];
    }
    return [leave];
  }

  private syncChatInput(): void {
    const c = this.client;
    if (!c || !this.chat) return;
    const open = c.status === 'open';
    const named = (c.me?.name ?? '') !== '';
    this.chat.setEnabled(
      open && named,
      !open ? 'Not connected.' : named ? '' : 'Pick a nickname to chat.',
    );
    this.chat.setReactionsEnabled(open);
  }

  private leave(): void {
    this.client?.close();
    this.env.goHome();
  }

  /** Swap the full-screen page (null = show the game). */
  private show(el: HTMLElement | null): void {
    if (this.screen === el) return;
    this.screen?.remove();
    this.screen = el;
    if (el) this.env.layer.append(el);
  }
}
