/** Tiny hyperscript helper. Text always goes through textContent/text nodes (names are user input). */

export type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  id?: string;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  checked?: boolean;
  /** CSS custom properties / properties, e.g. { '--c': '#f00' }. */
  style?: Record<string, string>;
  attrs?: Record<string, string>;
  on?: { [K in keyof HTMLElementEventMap]?: (e: HTMLElementEventMap[K]) => void };
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.id) el.id = props.id;
  if (props.title) el.title = props.title;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.style) {
    for (const [k, v] of Object.entries(props.style)) el.style.setProperty(k, v);
  }
  if (el instanceof HTMLButtonElement) {
    el.type = 'button';
    if (props.disabled) el.disabled = true;
  }
  if (el instanceof HTMLInputElement) {
    if (props.type) el.type = props.type;
    if (props.value !== undefined) el.value = props.value;
    if (props.placeholder) el.placeholder = props.placeholder;
    if (props.maxLength) el.maxLength = props.maxLength;
    if (props.checked) el.checked = true;
  }
  if (props.on) {
    for (const [name, fn] of Object.entries(props.on)) {
      el.addEventListener(name, fn as EventListener);
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
}
