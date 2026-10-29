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
    listened.add(el);
  }
  append(el, children);
  return el;
}

/** Elements `h` gave listeners to. */
const listened = new WeakSet<Element>();
/** Controls keep state outside their markup (value, listeners added by hand): never reused. */
const CONTROLS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'LABEL']);

/**
 * Like `parent.replaceChildren(...next)`, but the DOM already there is kept wherever it matches
 * (s17: a HUD render rebuilds every panel; swapping in identical ones made the browser restyle,
 * lay out and paint the whole HUD on every bot move). The result has the same markup as
 * `replaceChildren`. A current child stays when it has the new child's tag and attributes: a
 * plain element (no listeners, not a control) then gets its children patched the same way; one
 * with listeners or a control stays only if its whole markup is the same, and then keeps its old
 * listeners, so use this only where handlers act on nothing the markup does not show.
 */
export function patchChildren(parent: Node, next: readonly Node[]): void {
  const cur = [...parent.childNodes];
  const wanted = new Set(next);
  // A node passed in `next` itself (a persistent panel) is never a stand-in for another one.
  const out = next.map((n, i) => {
    const old = cur[i];
    return old && old !== n && !wanted.has(old) && reuse(old, n) ? old : n;
  });
  const live = parent.childNodes;
  out.forEach((n, i) => {
    if (live[i] !== n) parent.insertBefore(n, live[i] ?? null);
  });
  while (live.length > out.length) live[out.length]?.remove();
}

/** Whether `old` can stay in place of `n` (patching its children to match). */
function reuse(old: Node, n: Node): boolean {
  if (old instanceof Element && n instanceof Element) {
    if (old.tagName !== n.tagName || !sameAttributes(old, n)) return false;
    if (listened.has(old) || listened.has(n) || CONTROLS.has(old.tagName)) {
      return old.innerHTML === n.innerHTML;
    }
    patchChildren(old, [...n.childNodes]);
    return true;
  }
  if (old.nodeType === Node.TEXT_NODE && n.nodeType === Node.TEXT_NODE) {
    if (old.textContent !== n.textContent) old.textContent = n.textContent;
    return true;
  }
  return false;
}

function sameAttributes(a: Element, b: Element): boolean {
  const as = a.attributes;
  const bs = b.attributes;
  if (as.length !== bs.length) return false;
  for (const attr of as) {
    if (b.getAttribute(attr.name) !== attr.value) return false;
  }
  return true;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
}
