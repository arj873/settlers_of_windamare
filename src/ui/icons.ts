/** Inline SVG icons. The markup is static (no user text), so innerHTML is safe here. */
import type { Resource } from '../engine';

export const RESOURCE_LABEL: Record<Resource, string> = {
  brick: 'Brick',
  lumber: 'Lumber',
  wool: 'Wool',
  grain: 'Grain',
  ore: 'Ore',
};

const SVG: Record<Resource, string> = {
  brick: `<rect x="3" y="7" width="26" height="18" rx="2.5" fill="#c4532d"/>
    <path d="M3 13h26M3 19h26M12 7v6M22 13v6M12 19v6" stroke="#f3cdb8" stroke-width="1.6" fill="none"/>`,
  lumber: `<path d="M16 3 8 13h4l-5 8h18l-5-8h4z" fill="#2f7d3a"/>
    <path d="M16 3 8 13h4l-5 8h9z" fill="#3c9a49"/>
    <rect x="14" y="21" width="4" height="7" rx="1" fill="#7a4a24"/>`,
  wool: `<g fill="#f4f6f2"><circle cx="11" cy="14" r="5"/><circle cx="17" cy="11" r="5.5"/>
    <circle cx="22" cy="15" r="5"/><circle cx="15" cy="18" r="5.5"/></g>
    <ellipse cx="25" cy="19.5" rx="3.2" ry="3.8" fill="#3a3f45"/>
    <path d="M10 22v5M17 23v4M22 22v5" stroke="#3a3f45" stroke-width="2" stroke-linecap="round"/>`,
  grain: `<path d="M16 29V9" stroke="#b78a1d" stroke-width="2" stroke-linecap="round"/>
    <g fill="#f0c53f"><ellipse cx="16" cy="6" rx="2.4" ry="4"/>
    <ellipse cx="11.5" cy="12" rx="2.4" ry="4" transform="rotate(-35 11.5 12)"/>
    <ellipse cx="20.5" cy="12" rx="2.4" ry="4" transform="rotate(35 20.5 12)"/>
    <ellipse cx="11.5" cy="19" rx="2.4" ry="4" transform="rotate(-35 11.5 19)"/>
    <ellipse cx="20.5" cy="19" rx="2.4" ry="4" transform="rotate(35 20.5 19)"/></g>`,
  ore: `<g stroke="#2f3842" stroke-width="1.1" stroke-linejoin="round">
    <path d="M19 25l1-8 5-4 4 4v8z" fill="#8795a5"/></g>
    <path d="M20 17l5-4v7zM19 25l1-8 5 3z" fill="#a9b6c4"/><path d="M29 17v8l-4-5z" fill="#5f6c7b"/>
    <path d="M19 25l6-5 4 5z" fill="#56626f"/>
    <path d="M3 26l2-11 7-6 7 3 3 7-2 7z" fill="#8795a5" stroke="#2f3842" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="M5 15l7-6 1 9z" fill="#bac7d4"/>
    <path d="M12 9l7 3-6 6z" fill="#93a1b1"/><path d="M19 12l3 7-2 7-7-8z" fill="#6c7a8a"/>
    <path d="M3 26l10-8 7 8z" fill="#566370"/>
    <g fill="#f0c040" stroke="#8a6a14" stroke-width=".7"><path d="M9 20.8l1.7 1.7L9 24.2l-1.7-1.7zM14.5 20.7l1.3 1.3-1.3 1.3-1.3-1.3zM17.5 17.4l1.1 1.1-1.1 1.1-1.1-1.1z"/></g>
    <path d="M10 10l.9 2.1L13 13l-2.1.9L10 16l-.9-2.1L7 13l2.1-.9zM25.5 14.3l.7 1.5 1.5.7-1.5.7-.7 1.5-.7-1.5-1.5-.7 1.5-.7z" fill="#fff"/>`,
};

/** A small `<span class="ico">` holding the resource's SVG. */
export function resourceIcon(resource: Resource, size = 28): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `ico ico-${resource}`;
  span.style.width = span.style.height = `${size}px`;
  span.setAttribute('role', 'img');
  span.setAttribute('aria-label', RESOURCE_LABEL[resource]);
  span.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">${SVG[resource]}</svg>`;
  return span;
}

const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
};

/** A die face with pips. */
export function dieFace(value: number): HTMLSpanElement {
  const die = document.createElement('span');
  die.className = 'die';
  die.setAttribute('role', 'img');
  die.setAttribute('aria-label', `Die showing ${value}`);
  for (const [x, y] of PIPS[value] ?? []) {
    const pip = document.createElement('i');
    pip.style.gridColumn = String(x + 1);
    pip.style.gridRow = String(y + 1);
    die.append(pip);
  }
  return die;
}
