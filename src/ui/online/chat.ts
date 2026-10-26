/**
 * Online chat (M3): message list, input, quick reactions. One instance lives for the whole room
 * visit and moves between the lobby and the HUD sidebar. Text is always set as text, never HTML.
 */
import type { ChatEntry, Reaction } from '../../net/protocol';
import { LIMITS, REACTIONS } from '../../net/protocol';
import { h } from '../dom';
import { glyph } from '../icons';
import './online.css';

export const REACTION_FACE: Record<Reaction, string> = {
  thumbsUp: '👍',
  laugh: '😂',
  wow: '😮',
  sad: '😢',
  angry: '😠',
  clap: '👏',
  think: '🤔',
  gg: 'GG',
};

export const REACTION_LABEL: Record<Reaction, string> = {
  thumbsUp: 'Thumbs up',
  laugh: 'Laugh',
  wow: 'Wow',
  sad: 'Sad',
  angry: 'Angry',
  clap: 'Clap',
  think: 'Thinking',
  gg: 'Good game',
};

export interface ChatPanelOptions {
  /** False when it could not be sent (offline). */
  send: (text: string) => boolean;
  react: (r: Reaction) => boolean;
  /** Seat colour of a chat line (null = no seat). */
  colorOf: (entry: ChatEntry) => string | null;
}

export class ChatPanel {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly note: HTMLElement;
  private readonly reactBtns: HTMLButtonElement[];
  private lastId = -1;

  constructor(private readonly opts: ChatPanelOptions) {
    this.list = h('div', {
      class: 'chat-list',
      attrs: { role: 'log', 'aria-live': 'polite', 'aria-label': 'Chat messages' },
    });
    this.input = h('input', {
      class: 'input chat-input',
      placeholder: 'Say something…',
      maxLength: LIMITS.chat,
      attrs: { 'aria-label': 'Chat message', 'data-k': 'chat-input', autocomplete: 'off' },
      on: {
        keydown: (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.submit();
          }
          // Keep game shortcuts (Escape cancels build mode) from firing while typing.
          e.stopPropagation();
        },
      },
    });
    this.sendBtn = h(
      'button',
      {
        class: 'btn btn-sm chat-send',
        title: 'Send',
        attrs: { 'aria-label': 'Send message' },
        on: { click: () => this.submit() },
      },
      glyph('chat', 16),
    );
    this.reactBtns = REACTIONS.map((r) =>
      h(
        'button',
        {
          class: `chat-react${r === 'gg' ? ' is-text' : ''}`,
          title: REACTION_LABEL[r],
          attrs: { 'aria-label': `React: ${REACTION_LABEL[r]}`, 'data-k': `react-${r}` },
          on: { click: () => this.opts.react(r) },
        },
        REACTION_FACE[r],
      ),
    );
    this.note = h('div', { class: 'chat-note' });
    this.element = h(
      'div',
      { class: 'chat' },
      this.list,
      h(
        'div',
        { class: 'chat-reacts', attrs: { role: 'group', 'aria-label': 'Reactions' } },
        ...this.reactBtns,
      ),
      h('div', { class: 'chat-compose' }, this.input, this.sendBtn),
      this.note,
    );
    this.renderEmpty();
  }

  /** Replace the whole list (welcome / reconnect). */
  setEntries(entries: readonly ChatEntry[]): void {
    this.list.replaceChildren();
    this.lastId = -1;
    for (const e of entries) this.append(e, false);
    this.renderEmpty();
    this.list.scrollTop = this.list.scrollHeight;
  }

  add(entry: ChatEntry): void {
    if (entry.id <= this.lastId) return;
    this.list.querySelector('.chat-empty')?.remove();
    this.append(entry, true);
  }

  /** Disable typing (no nickname yet, or offline) with a short reason. */
  setEnabled(enabled: boolean, reason = ''): void {
    this.input.disabled = !enabled;
    this.sendBtn.disabled = !enabled;
    this.note.textContent = enabled ? '' : reason;
  }

  /** Reactions need a connection, not a nickname. */
  setReactionsEnabled(enabled: boolean): void {
    for (const b of this.reactBtns) b.disabled = !enabled;
  }

  private submit(): void {
    const text = this.input.value.trim();
    if (text === '') return;
    if (this.opts.send(text)) this.input.value = '';
  }

  private renderEmpty(): void {
    if (this.list.childElementCount === 0) {
      this.list.append(h('div', { class: 'chat-empty' }, 'No messages yet. Say hi!'));
    }
  }

  private append(e: ChatEntry, scroll: boolean): void {
    this.lastId = Math.max(this.lastId, e.id);
    const atBottom = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 12;
    const color = this.opts.colorOf(e);
    const when = new Date(e.at);
    const time = Number.isNaN(when.getTime())
      ? ''
      : when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.list.append(
      e.from === null
        ? h('div', { class: 'chat-row is-system', title: time }, e.text)
        : h(
            'div',
            { class: 'chat-row', title: time },
            h(
              'b',
              { class: 'chat-name', style: color ? { '--pc': color } : {} },
              e.name || 'Someone',
            ),
            ' ',
            h('span', { class: 'chat-text' }, e.text),
          ),
    );
    if (scroll && atBottom) this.list.scrollTop = this.list.scrollHeight;
  }
}

/** Floating reaction bubbles over the board (and the lobby). */
export class ReactionLayer {
  private readonly el: HTMLElement;

  constructor(parent: HTMLElement = document.body) {
    this.el = h('div', { class: 'reaction-layer', attrs: { 'aria-live': 'polite' } });
    parent.append(this.el);
  }

  show(name: string, color: string | null, reaction: Reaction): void {
    const bubble = h(
      'div',
      { class: 'reaction-bubble', style: color ? { '--pc': color } : {} },
      h(
        'span',
        { class: `reaction-face${reaction === 'gg' ? ' is-text' : ''}` },
        REACTION_FACE[reaction],
      ),
      h('span', { class: 'reaction-name' }, name),
    );
    this.el.append(bubble);
    while (this.el.childElementCount > 6) this.el.firstElementChild?.remove();
    setTimeout(() => bubble.classList.add('is-leaving'), 2600);
    setTimeout(() => bubble.remove(), 3100);
  }

  destroy(): void {
    this.el.remove();
  }
}
