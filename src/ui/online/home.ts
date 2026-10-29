/**
 * Home screen (M3): "Play online" (create a room), "Join with code", "Play offline (hotseat)".
 * With `invite` it is the landing card of an invite link: nickname, then join. Also the small
 * full-screen notices (connecting, room not found, disconnected for good).
 */
// The home screen is in the first chunk (main.ts): nothing that pulls in the engine.
import { parseRoomCode } from '../../net/transport';
import { h, type Child } from '../dom';
import { feedbackFooter } from '../feedback';
import { glyph } from '../icons';
import { themePicker } from '../theme';
import { openProfileDialog, profileChip } from '../profile/dialog';
import { PROFILE_NAME_MAX, type Profile } from '../profile/model';
import './online.css';

export interface HomeOptions {
  /** Remembered nickname. */
  name: string;
  onOffline: () => void;
  /** Rejections are shown on the screen. */
  onCreate: (name: string) => Promise<void>;
  onJoin: (code: string, name: string) => Promise<void>;
  /** Invite-link landing: join this room (the game may already be running). */
  invite?: { roomId: string; playing: boolean };
  /** PR1: the local profile (a Profile button next to the nickname). */
  profile?: ProfileStore;
}

/** Where the local profile lives (main.ts: localStorage). */
export interface ProfileStore {
  load(): Profile;
  save(p: Profile): void;
}

const LOGO = `<svg viewBox="0 0 32 32" width="56" height="56" aria-hidden="true">
  <path d="M16 2 28 9v14l-12 7L4 23V9z" fill="currentColor" opacity=".18"/>
  <path d="M16 2 28 9v14l-12 7L4 23V9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  <path d="M16 9v14M10 12.5l12 7M22 12.5l-12 7" stroke="currentColor" stroke-width="1.4" opacity=".7"/></svg>`;

function logo(): HTMLElement {
  const s = h('span', { class: 'su-logo ol-logo' });
  s.innerHTML = LOGO; // static markup
  return s;
}

/** Full-screen shell shared by the home screen and notices. */
function shell(...children: Child[]): HTMLElement {
  return h(
    'div',
    { class: 'online-screen setup ol-home' },
    h('div', { class: 'ol-home-card' }, logo(), ...children),
    feedbackFooter(),
    h('div', { class: 'ol-home-theme' }, themePicker({ compact: true })),
  );
}

export class HomeScreen {
  readonly element: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly codeInput: HTMLInputElement | null;
  private readonly error: HTMLElement;
  private busy = false;

  constructor(private readonly opts: HomeOptions) {
    this.nameInput = h('input', {
      class: 'input ol-name',
      value: opts.name,
      maxLength: PROFILE_NAME_MAX,
      placeholder: 'Your nickname',
      attrs: { 'aria-label': 'Nickname', 'data-k': 'nickname', autocomplete: 'nickname' },
      on: {
        keydown: (e) => {
          if (e.key === 'Enter' && opts.invite) void this.join(opts.invite.roomId);
        },
      },
    });
    this.error = h('p', { class: 'ol-error', attrs: { role: 'alert' } });
    const nameField = h(
      'div',
      { class: 'pf-name-row' },
      h('label', { class: 'ol-field' }, h('span', {}, 'Nickname'), this.nameInput),
      opts.profile && this.profileChip(opts.profile),
    );

    if (opts.invite) {
      const inv = opts.invite;
      this.codeInput = null;
      this.element = shell(
        h('h1', {}, inv.playing ? 'Watch the game' : 'Join the game'),
        h(
          'p',
          { class: 'muted' },
          inv.playing
            ? 'This game has already started. You can watch and chat as a spectator.'
            : 'A friend invited you to their table.',
          ' Room ',
          h('b', { class: 'ol-code' }, inv.roomId),
        ),
        nameField,
        h(
          'button',
          {
            class: 'btn btn-primary btn-lg ol-wide',
            attrs: { 'data-k': 'join' },
            on: { click: () => void this.join(inv.roomId) },
          },
          inv.playing ? 'Watch' : 'Join',
        ),
        this.error,
        h(
          'button',
          { class: 'btn btn-ghost', on: { click: () => opts.onOffline() } },
          'Play offline instead',
        ),
      );
      return;
    }

    this.codeInput = h('input', {
      class: 'input ol-code-input',
      placeholder: 'Room code or link',
      attrs: {
        'aria-label': 'Room code',
        'data-k': 'code',
        autocomplete: 'off',
        spellcheck: 'false',
      },
      on: {
        keydown: (e) => {
          if (e.key === 'Enter') void this.joinTyped();
        },
      },
    });
    this.element = shell(
      h('h1', {}, 'Colonizers of Windamere'),
      h(
        'p',
        { class: 'muted' },
        'Settle, build and trade — with friends online or around one screen.',
      ),
      nameField,
      h(
        'div',
        { class: 'ol-choices' },
        h(
          'button',
          {
            class: 'ol-choice is-primary',
            attrs: { 'data-k': 'create' },
            on: { click: () => void this.create() },
          },
          glyph('link', 26),
          h('span', { class: 'su-tile-title' }, 'Play online'),
          h('span', { class: 'su-tile-sub' }, 'Create a room and share the invite link'),
        ),
        h(
          'div',
          { class: 'ol-choice ol-join' },
          glyph('person', 26),
          h('span', { class: 'su-tile-title' }, 'Join with code'),
          h(
            'div',
            { class: 'ol-row' },
            this.codeInput,
            h(
              'button',
              {
                class: 'btn',
                attrs: { 'data-k': 'join' },
                on: { click: () => void this.joinTyped() },
              },
              'Join',
            ),
          ),
        ),
        h(
          'button',
          {
            class: 'ol-choice',
            attrs: { 'data-k': 'offline' },
            on: { click: () => opts.onOffline() },
          },
          glyph('dice', 26),
          h('span', { class: 'su-tile-title' }, 'Play offline'),
          h('span', { class: 'su-tile-sub' }, 'Hotseat on this device, with bots'),
        ),
      ),
      this.error,
    );
  }

  /** PR1: the Profile chip; saving also fills in the nickname. */
  private profileChip(store: ProfileStore): HTMLElement {
    const slot = h('span', { class: 'pf-chip-slot' });
    const draw = () => {
      slot.replaceChildren(
        profileChip(store.load().avatar, () => {
          const typed = this.nameInput.value.trim();
          const current = store.load();
          openProfileDialog({
            profile: { ...current, name: typed || current.name },
            onSave: (p) => {
              store.save(p);
              this.nameInput.value = p.name;
              draw();
            },
          });
        }),
      );
    };
    draw();
    return slot;
  }

  private name(): string | null {
    const name = this.nameInput.value.trim();
    if (name === '') {
      this.fail('Pick a nickname first.');
      this.nameInput.focus();
      return null;
    }
    return name;
  }

  private fail(text: string): void {
    this.error.textContent = text;
  }

  private async run(task: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.element.classList.add('is-busy');
    this.fail('');
    try {
      await task();
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
      this.element.classList.remove('is-busy');
    }
  }

  private async create(): Promise<void> {
    const name = this.name();
    if (name) await this.run(() => this.opts.onCreate(name));
  }

  private async join(code: string): Promise<void> {
    const name = this.name();
    if (name) await this.run(() => this.opts.onJoin(code, name));
  }

  private async joinTyped(): Promise<void> {
    const code = parseRoomCode(this.codeInput?.value ?? '');
    if (!code) {
      this.fail('Enter a room code or paste an invite link.');
      this.codeInput?.focus();
      return;
    }
    await this.join(code);
  }
}

export interface NoticeAction {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

/** A full-screen message (connecting, room not found, disconnected...). */
export function noticeScreen(
  title: string,
  text: string,
  actions: NoticeAction[] = [],
  opts: { spinner?: boolean } = {},
): HTMLElement {
  return shell(
    opts.spinner && h('span', { class: 'conn-spin is-big', attrs: { 'aria-hidden': 'true' } }),
    h('h1', {}, title),
    text && h('p', { class: 'muted' }, text),
    actions.length > 0 &&
      h(
        'div',
        { class: 'ol-notice-actions' },
        ...actions.map((a) =>
          h(
            'button',
            {
              class: `btn btn-lg ${a.primary ? 'btn-primary' : 'btn-ghost'}`,
              on: { click: () => a.onClick() },
            },
            a.label,
          ),
        ),
      ),
  );
}
