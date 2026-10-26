/** "Reconnecting…" strip at the top of the screen (lobby and game). */
import { h } from '../dom';
import { glyph } from '../icons';
import './online.css';

export class ConnectionBanner {
  readonly element: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly onRetry: () => void,
  ) {
    this.element = h('div', {
      class: 'conn-banner',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    this.element.hidden = true;
    parent.append(this.element);
  }

  /** `attempt`: failed attempts so far (0 = the first try is still running). */
  reconnecting(attempt: number): void {
    this.element.hidden = false;
    this.element.replaceChildren(
      glyph('offline', 18),
      h('span', { class: 'conn-spin', attrs: { 'aria-hidden': 'true' } }),
      h(
        'span',
        {},
        attempt > 1
          ? `Connection lost. Reconnecting… (attempt ${attempt})`
          : 'Connection lost. Reconnecting…',
      ),
      h('button', { class: 'btn btn-sm', on: { click: () => this.onRetry() } }, 'Retry now'),
    );
  }

  hide(): void {
    this.element.hidden = true;
    this.element.replaceChildren();
  }

  destroy(): void {
    this.element.remove();
  }
}
