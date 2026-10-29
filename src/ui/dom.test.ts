// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { h, patchChildren } from './dom';

const render = (label: string, count: number) => [
  h('div', { class: 'title' }, h('b', {}, label)),
  h('ul', {}, ...Array.from({ length: count }, (_, i) => h('li', {}, `item ${i}`))),
  h('button', { class: 'go', on: { click: () => undefined } }, label),
];

describe('patchChildren', () => {
  it('ends with the same markup as replaceChildren', () => {
    const a = h('div');
    const b = h('div');
    for (const [label, n] of [
      ['one', 2],
      ['two', 3],
      ['two', 1],
      ['three', 0],
    ] as const) {
      a.replaceChildren(...render(label, n));
      patchChildren(b, render(label, n));
      expect(b.innerHTML).toBe(a.innerHTML);
    }
  });

  it('keeps unchanged elements and plain parents, replaces changed ones', () => {
    const root = h('div');
    patchChildren(root, render('one', 2));
    const [title, list, button] = [...root.children];
    const first = list?.firstElementChild;
    patchChildren(root, render('one', 3));
    expect(root.children[0]).toBe(title);
    expect(root.children[1]).toBe(list); // same tag and attributes: patched in place
    expect(list?.firstElementChild).toBe(first);
    expect(list?.children).toHaveLength(3);
    expect(root.children[2]).toBe(button); // a listener, but the same markup
    patchChildren(root, render('two', 3));
    expect(root.children[0]).toBe(title);
    expect(title?.textContent).toBe('two');
    // A control with other markup is new (its handler may act on what it shows).
    expect(root.children[2]).not.toBe(button);
    expect(root.children[2]?.textContent).toBe('two');
  });

  it('replaces an element whose attributes changed', () => {
    const root = h('div');
    patchChildren(root, [h('span', { class: 'a' }, 'x')]);
    const old = root.firstChild;
    patchChildren(root, [h('span', { class: 'b' }, 'x')]);
    expect(root.firstChild).not.toBe(old);
    expect(root.innerHTML).toBe('<span class="b">x</span>');
  });

  it('places persistent nodes passed in next, wherever they were', () => {
    const keep = h('section', {}, 'log');
    const root = h('div');
    patchChildren(root, [keep, h('p', {}, 'bank')]);
    patchChildren(root, [h('p', {}, 'new'), h('p', {}, 'bank'), keep]);
    expect(root.innerHTML).toBe('<p>new</p><p>bank</p><section>log</section>');
    expect(root.lastChild).toBe(keep);
    patchChildren(root, [keep]);
    expect(root.innerHTML).toBe('<section>log</section>');
    expect(root.firstChild).toBe(keep);
  });
});
