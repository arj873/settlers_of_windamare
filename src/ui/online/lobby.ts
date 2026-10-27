/**
 * Online lobby (M3): invite link, nickname, seats and colours, add/remove bot seats, the host's
 * game settings (the wrapped setup screen, read-only for others), chat, and the start button.
 * Rebuilds the seat list on every room update; the settings, chat and name field persist.
 */
import type { MemberId, RoomConfig, RoomInfo } from '../../net/protocol';
import { LIMITS } from '../../net/protocol';
import { BOT_LEVEL_LABELS, type BotLevel } from '../../bots/levels';
import { botLevelSelect } from '../botLevel';
import { append, h } from '../dom';
import { glyph } from '../icons';
import { themePicker } from '../theme';
import { RoomConfigPanel, withSeatCount } from './configPanel';
import { profileAvatar, profileChip, stylePreviewImg } from '../profile/dialog';
import { PIECE_STYLE_LABEL, pieceStyleOr, type AvatarRef } from '../profile/model';
import { lobbyView, type LobbyView, type SeatView } from './lobbyModel';
import './online.css';

export interface LobbyActions {
  setName(name: string): void;
  takeSeat(seat: number): void;
  leaveSeat(): void;
  setColor(color: string): void;
  /** Host (B1): difficulty of the bot on an open seat. */
  setBotLevel(seat: number, level: BotLevel): void;
  configure(config: RoomConfig): void;
  start(): void;
  leave(): void;
}

export interface LobbyOptions {
  roomId: string;
  inviteUrl: string;
  actions: LobbyActions;
  /** The chat panel element (moved here while the lobby is shown). */
  chat: HTMLElement;
  /** Clipboard write; default navigator.clipboard with a select() fallback. */
  copy?: (text: string) => Promise<void>;
  /** PR1: a member's picture (RoomClient.avatarOf). */
  avatarOf?: (member: MemberId) => AvatarRef | null;
  /** PR1: open the Profile dialog (a chip in the "You" section). */
  onProfile?: () => void;
}

async function defaultCopy(text: string, input: HTMLInputElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    input.select();
    document.execCommand('copy');
  }
}

export class LobbyScreen {
  readonly element: HTMLElement;
  private readonly seatsBox: HTMLElement;
  private readonly specBox: HTMLElement;
  private readonly roleBox: HTMLElement;
  private readonly footerInfo: HTMLElement;
  private readonly footerActions: HTMLElement;
  private readonly configNote: HTMLElement;
  private readonly chatBox: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly linkInput: HTMLInputElement;
  private readonly copyBtn: HTMLButtonElement;
  private config: RoomConfigPanel | null = null;
  private room: RoomInfo | null = null;
  private view: LobbyView | null = null;
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly configHost = h('div');
  /** PR1: the Profile chip (picture of the viewer). */
  private readonly profileBox = h('span', { class: 'pf-chip-slot' });

  constructor(private readonly opts: LobbyOptions) {
    this.linkInput = h('input', {
      class: 'input ol-link',
      value: opts.inviteUrl,
      attrs: { readonly: '', 'aria-label': 'Invite link', 'data-k': 'invite' },
      on: { focus: (e) => (e.target as HTMLInputElement).select() },
    });
    this.copyBtn = h(
      'button',
      {
        class: 'btn btn-primary',
        attrs: { 'data-k': 'copy' },
        on: { click: () => void this.copy() },
      },
      glyph('link', 16),
      h('span', {}, 'Copy link'),
    );
    this.nameInput = h('input', {
      class: 'input ol-name',
      maxLength: LIMITS.name,
      placeholder: 'Your nickname',
      attrs: { 'aria-label': 'Nickname', 'data-k': 'nickname', autocomplete: 'nickname' },
      on: {
        keydown: (e) => {
          if (e.key === 'Enter') this.commitName();
        },
        change: () => this.commitName(),
      },
    });
    this.roleBox = h('div', { class: 'ol-role' });
    this.seatsBox = h('div', { class: 'ol-seats' });
    this.specBox = h('div', { class: 'ol-specs' });
    this.configNote = h('p', { class: 'ol-note' });
    this.chatBox = h('div', { class: 'ol-chat' });
    this.footerInfo = h('div', { class: 'su-summary ol-summary' });
    this.footerActions = h('div', { class: 'ol-footer-actions' });

    const section = (title: string, id: string, ...body: (Node | null)[]) =>
      h(
        'section',
        { class: 'su-sec ol-sec', attrs: { 'aria-labelledby': `ol-h-${id}` } },
        h('h2', { id: `ol-h-${id}` }, title),
        ...body,
      );

    this.element = h(
      'div',
      {
        class: 'online-screen setup ol-lobby',
        attrs: { role: 'main', 'aria-label': 'Room lobby' },
      },
      h(
        'div',
        { class: 'su-scroll' },
        h(
          'div',
          { class: 'ol-inner' },
          h(
            'div',
            { class: 'ol-main' },
            h(
              'header',
              { class: 'su-head' },
              h('span', { class: 'su-logo' }, glyph('person', 34)),
              h(
                'div',
                {},
                h('h1', {}, 'Lobby'),
                h('p', { class: 'muted' }, 'Room ', h('b', { class: 'ol-code' }, opts.roomId)),
              ),
            ),
            section(
              'Invite friends',
              'invite',
              h('div', { class: 'ol-row' }, this.linkInput, this.copyBtn),
              h(
                'p',
                { class: 'ol-note' },
                'Anyone with the link can join. Late arrivals watch as spectators.',
              ),
            ),
            section(
              'You',
              'you',
              h(
                'div',
                { class: 'ol-row' },
                this.nameInput,
                h('button', { class: 'btn', on: { click: () => this.commitName() } }, 'Save'),
                this.profileBox,
                this.roleBox,
              ),
            ),
            section('Seats', 'seats', this.seatsBox, this.specBox),
            section('Game settings', 'config', this.configNote, this.configHost),
          ),
          h('aside', { class: 'ol-side' }, section('Chat', 'chat', this.chatBox)),
        ),
      ),
      h(
        'div',
        { class: 'su-footer' },
        h(
          'div',
          { class: 'su-footer-in' },
          this.footerInfo,
          themePicker({ compact: true }),
          this.footerActions,
        ),
      ),
    );
    this.chatBox.append(opts.chat);
  }

  /** Re-render from a room update. */
  update(room: RoomInfo, me: MemberId | null): void {
    this.room = room;
    const v = lobbyView(room, me);
    this.view = v;
    if (document.activeElement !== this.nameInput) this.nameInput.value = v.me?.name ?? '';
    this.roleBox.replaceChildren();
    append(this.roleBox, [
      v.isHost && h('span', { class: 'tag ol-tag-host' }, 'Host'),
      v.me?.seat !== null && v.me?.seat !== undefined
        ? h('span', { class: 'tag' }, 'Player')
        : h('span', { class: 'tag' }, 'Spectator'),
    ]);
    const onProfile = this.opts.onProfile;
    this.profileBox.replaceChildren(
      ...(onProfile && v.me
        ? [
            profileChip(
              this.opts.avatarOf?.(v.me.id) ?? null,
              onProfile,
              v.me.seat === null ? undefined : room.seats[v.me.seat]?.color,
            ),
          ]
        : []),
    );
    this.renderSeats(v);
    this.renderFooter(v);
    if (!this.config) {
      this.config = new RoomConfigPanel({
        config: room.config,
        editable: v.isHost,
        onChange: (cfg) => this.opts.actions.configure(cfg),
      });
      this.configHost.replaceChildren(this.config.element);
    } else {
      this.config.update(room.config, v.isHost);
    }
    this.configNote.textContent = v.isHost
      ? 'You are the host: pick the map and rules, then start when everyone is seated.'
      : `Only the host${v.hostName ? ` (${v.hostName})` : ''} can change the settings.`;
  }

  /** Put the chat panel back here (after a game). */
  attachChat(chat: HTMLElement): void {
    this.chatBox.append(chat);
  }

  destroy(): void {
    this.config?.destroy();
    if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
    this.element.remove();
  }

  private commitName(): void {
    const name = this.nameInput.value.trim();
    if (name === '' || name === this.view?.me?.name) return;
    this.opts.actions.setName(name);
  }

  private async copy(): Promise<void> {
    const text = this.opts.inviteUrl;
    await (this.opts.copy ? this.opts.copy(text) : defaultCopy(text, this.linkInput));
    const label = this.copyBtn.querySelector('span');
    if (label) label.textContent = 'Copied!';
    if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => {
      if (label) label.textContent = 'Copy link';
    }, 1800);
  }

  private renderSeats(v: LobbyView): void {
    const a = this.opts.actions;
    const room = this.room;
    this.seatsBox.replaceChildren(...v.seats.map((s) => this.seatCard(s, v)));
    append(this.seatsBox, [
      v.canAddSeat &&
        room &&
        h(
          'button',
          {
            class: 'ol-seat ol-seat-add',
            attrs: { 'data-k': 'add-bot' },
            title: 'Add a seat; a bot plays it unless someone sits down',
            on: { click: () => a.configure(withSeatCount(room.config, room.seats.length + 1)) },
          },
          h('span', { class: 'ol-add-plus' }, '+'),
          h('span', {}, 'Add bot'),
        ),
    ]);
    this.specBox.replaceChildren(
      ...(v.spectators.length === 0
        ? []
        : [
            h(
              'div',
              { class: 'ol-spec-list' },
              h('span', { class: 'ol-spec-title' }, glyph('eye', 15), 'Watching'),
              ...v.spectators.map((m) =>
                h(
                  'span',
                  { class: `ol-spec${m.connected ? '' : ' is-away'}` },
                  m.name,
                  m.id === room?.host && h('span', { class: 'tag ol-tag-host' }, 'Host'),
                  !m.connected && glyph('offline', 13, 'Disconnected'),
                ),
              ),
            ),
          ]),
    );
  }

  private seatCard(s: SeatView, v: LobbyView): HTMLElement {
    const a = this.opts.actions;
    const room = this.room;
    const meSeated = v.me?.seat !== null && v.me?.seat !== undefined;
    // PR1: the occupant's picture and piece style.
    const occupant = room?.seats[s.index]?.occupant ?? null;
    const member = occupant === null ? undefined : room?.members.find((m) => m.id === occupant);
    const pic = member ? (this.opts.avatarOf?.(member.id) ?? null) : null;
    return h(
      'div',
      {
        class: `ol-seat${s.isMine ? ' is-mine' : ''}${s.name === null ? ' is-open' : ''}${s.isAway ? ' is-away' : ''}`,
        style: { '--pc': s.color },
        attrs: { 'data-seat': String(s.index) },
      },
      pic
        ? profileAvatar(pic, s.color, 40)
        : h('span', { class: 'ol-seat-dot' }, glyph(s.name === null ? 'bot' : 'person', 22)),
      h(
        'div',
        { class: 'ol-seat-main' },
        h(
          'div',
          { class: 'ol-seat-name' },
          s.name ?? `${s.colorLabel} Bot`,
          s.isMine && h('span', { class: 'tag' }, 'You'),
          s.isHostSeat && h('span', { class: 'tag ol-tag-host' }, 'Host'),
          s.isAway && glyph('offline', 14, 'Disconnected'),
        ),
        h(
          'div',
          { class: 'ol-seat-sub' },
          s.name === null
            ? s.canSetLevel
              ? 'Open — a bot plays it:'
              : `Open — a ${BOT_LEVEL_LABELS[s.botLevel]} bot plays it`
            : s.isAway
              ? 'Disconnected — the seat is kept for a minute'
              : s.colorLabel,
        ),
        s.colors.length > 1 &&
          h(
            'div',
            { class: 'su-swatches', attrs: { role: 'group', 'aria-label': 'Your colour' } },
            ...s.colors.map((c) =>
              h('button', {
                class: `swatch${c === s.color ? ' is-on' : ''}`,
                style: { '--sw': c },
                attrs: { 'aria-label': `Colour ${c}`, 'aria-pressed': String(c === s.color) },
                on: { click: () => c !== s.color && a.setColor(c) },
              }),
            ),
          ),
        member &&
          h(
            'div',
            {
              class: 'pf-seat-style',
              title: `Pieces: ${PIECE_STYLE_LABEL[pieceStyleOr(member.pieceStyle)]}`,
            },
            stylePreviewImg(pieceStyleOr(member.pieceStyle), s.color),
            h('span', {}, PIECE_STYLE_LABEL[pieceStyleOr(member.pieceStyle)]),
          ),
        s.canSetLevel &&
          botLevelSelect(s.botLevel, { seat: s.index, key: 'seat-level' }, (level) =>
            a.setBotLevel(s.index, level),
          ),
      ),
      h(
        'div',
        { class: 'ol-seat-actions' },
        s.canSit &&
          h(
            'button',
            {
              class: 'btn btn-sm btn-primary',
              attrs: { 'data-k': `sit-${s.index}` },
              on: { click: () => a.takeSeat(s.index) },
            },
            meSeated ? 'Move here' : 'Sit here',
          ),
        s.name === null &&
          !s.canSit &&
          !v.me?.name &&
          h('span', { class: 'ol-hint' }, 'Pick a nickname to sit'),
        s.canStand &&
          h(
            'button',
            {
              class: 'btn btn-sm',
              attrs: { 'data-k': 'stand' },
              on: { click: () => a.leaveSeat() },
            },
            'Stand up',
          ),
        s.canRemove &&
          room &&
          h(
            'button',
            {
              class: 'btn btn-sm btn-ghost',
              attrs: { 'data-k': 'remove-bot' },
              title: 'Remove this seat',
              on: { click: () => a.configure(withSeatCount(room.config, room.seats.length - 1)) },
            },
            'Remove bot',
          ),
      ),
    );
  }

  private renderFooter(v: LobbyView): void {
    const a = this.opts.actions;
    this.footerInfo.replaceChildren(h('strong', {}, 'Online'), ` · ${v.summary}`);
    this.footerActions.replaceChildren(
      h(
        'button',
        { class: 'btn btn-ghost', attrs: { 'data-k': 'leave' }, on: { click: () => a.leave() } },
        'Leave',
      ),
      v.isHost
        ? h(
            'button',
            {
              class: 'btn btn-primary btn-lg su-start',
              disabled: v.startBlocked !== null,
              title: v.startBlocked ?? 'Start the game; open seats get bots',
              attrs: { 'data-k': 'lobby-start' },
              on: { click: () => a.start() },
            },
            'Start game',
          )
        : h(
            'span',
            { class: 'ol-waiting' },
            h('span', { class: 'conn-spin', attrs: { 'aria-hidden': 'true' } }),
            v.hostName ? `Waiting for ${v.hostName} to start…` : 'Waiting for the host to start…',
          ),
    );
  }
}
