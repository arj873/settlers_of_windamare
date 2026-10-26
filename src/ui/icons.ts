/** Inline SVG icons. The markup is static (no user text), so innerHTML is safe here. */
import type { DevCardType, Resource } from '../engine';

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

/**
 * Game glyphs, 32×32. Player-coloured parts use `var(--pc)` (set by the caller), so a piece icon
 * takes the colour of whatever element it sits in.
 */
const GLYPH = {
  road: `<g transform="rotate(-30 16 16)"><rect x="3" y="12" width="26" height="8" rx="2" style="fill:var(--pc,#e9dcc0)" stroke="#2a1708" stroke-width="1.6"/>
    <path d="M5 13.6h22" stroke="#fff" stroke-opacity=".35" stroke-width="1.4"/></g>`,
  settlement: `<path d="M5 15 16 5l11 10v12H5z" style="fill:var(--pc,#e9dcc0)" stroke="#2a1708" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M7 15 16 7l9 8" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.4"/>
    <rect x="13" y="19" width="6" height="8" fill="#2a1708" fill-opacity=".55"/>`,
  city: `<path d="M3 27V15l7-6 7 6v-4h12v16z" style="fill:var(--pc,#e9dcc0)" stroke="#2a1708" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M17 11V7h12v4" style="fill:var(--pc,#e9dcc0)" stroke="#2a1708" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M5 15l5-4 5 4" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.4"/>
    <rect x="8" y="19" width="4" height="8" fill="#2a1708" fill-opacity=".55"/>
    <path d="M20 15h3v3h-3zM25 15h2v3h-2zM20 21h3v3h-3z" fill="#2a1708" fill-opacity=".55"/>`,
  devBack: `<rect x="6" y="3" width="20" height="26" rx="3" fill="#5b3a8c" stroke="#2a1708" stroke-width="1.6"/>
    <rect x="9" y="6" width="14" height="20" rx="2" fill="none" stroke="#e8c76a" stroke-width="1.2"/>
    <path d="M13 13.2a3 3 0 1 1 4.4 2.6c-1 .6-1.4 1.1-1.4 2.2" fill="none" stroke="#f6e7c1" stroke-width="2" stroke-linecap="round"/>
    <circle cx="16" cy="21.5" r="1.3" fill="#f6e7c1"/>`,
  knight: `<path d="M16 3l10 4v8c0 7-5 11-10 14C11 26 6 22 6 15V7z" fill="#b3412f" stroke="#2a1708" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M16 8v15M11 13h10" stroke="#f6e7c1" stroke-width="2.4" stroke-linecap="round"/>`,
  roadBuilding: `<g transform="rotate(-30 16 16)"><rect x="4" y="8" width="24" height="6" rx="1.5" fill="#c08a4a" stroke="#2a1708" stroke-width="1.4"/>
    <rect x="4" y="18" width="24" height="6" rx="1.5" fill="#c08a4a" stroke="#2a1708" stroke-width="1.4"/></g>`,
  yearOfPlenty: `<path d="M5 22c2-9 10-14 20-13-3 2-4 6-3 10-5-1-10 0-17 3z" fill="#d9a43a" stroke="#2a1708" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="23" cy="12" r="3" fill="#c4532d"/><circle cx="20" cy="17" r="2.6" fill="#3f8f46"/><circle cx="25.5" cy="17.5" r="2.4" fill="#f0c53f"/>`,
  monopoly: `<path d="M10 9h12l-2 3c5 2 7 6 7 10 0 4-4 6-11 6S5 26 5 22c0-4 2-8 7-10z" fill="#d9a43a" stroke="#2a1708" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M13 9l-2-5h10l-2 5" fill="#b8862a" stroke="#2a1708" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M16 15v9M18.5 17c-.6-1-1.4-1.3-2.5-1.3-1.5 0-2.5.8-2.5 1.9 0 2.6 5.2 1.4 5.2 4 0 1.1-1 1.9-2.7 1.9-1.2 0-2-.4-2.6-1.3" fill="none" stroke="#2a1708" stroke-width="1.5" stroke-linecap="round"/>`,
  victoryPoint: `<path d="M16 3l3.6 7.6 8.2 1-6 5.7 1.6 8.2L16 21.4l-7.4 4.1 1.6-8.2-6-5.7 8.2-1z" fill="#f2c35a" stroke="#2a1708" stroke-width="1.6" stroke-linejoin="round"/>`,
  robber: `<path d="M16 4c-3.5 0-6 2.7-6 6.2 0 2 .9 3.6 2.2 4.7C8.6 16.6 7 20.7 7 27.5h18c0-6.8-1.6-10.9-5.2-12.6 1.3-1.1 2.2-2.7 2.2-4.7C22 6.7 19.5 4 16 4z" fill="#3a3530" stroke="#120d09" stroke-width="1.6"/>
    <path d="M12.5 10.5h7" stroke="#d9cbb0" stroke-width="2" stroke-linecap="round"/>`,
  longestRoad: `<circle cx="16" cy="16" r="13" fill="#f2c35a" stroke="#2a1708" stroke-width="1.6"/>
    <g transform="rotate(-30 16 16)"><rect x="7" y="11" width="18" height="4" rx="1" fill="#7a4a24"/><rect x="7" y="17" width="18" height="4" rx="1" fill="#7a4a24"/></g>`,
  largestArmy: `<circle cx="16" cy="16" r="13" fill="#f2c35a" stroke="#2a1708" stroke-width="1.6"/>
    <path d="M9 9l14 14M23 9 9 23" stroke="#5a3720" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M8 21l3 3M24 21l-3 3" stroke="#5a3720" stroke-width="3" stroke-linecap="round"/>`,
  cards: `<rect x="5" y="7" width="15" height="21" rx="2.5" fill="#d8c39a" stroke="#2a1708" stroke-width="1.5" transform="rotate(-12 12 17)"/>
    <rect x="12" y="5" width="15" height="21" rx="2.5" fill="#f3e3c3" stroke="#2a1708" stroke-width="1.5"/>`,
  devCards: `<rect x="8" y="4" width="17" height="24" rx="2.5" fill="#6d47a6" stroke="#2a1708" stroke-width="1.5"/>
    <rect x="11" y="7" width="11" height="18" rx="1.5" fill="none" stroke="#e8c76a" stroke-width="1.2"/>`,
  person: `<circle cx="16" cy="11" r="6" fill="currentColor"/><path d="M5 29c0-6.5 5-10.5 11-10.5S27 22.5 27 29z" fill="currentColor"/>`,
  bot: `<path d="M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="3.5" r="2" fill="currentColor"/>
    <rect x="6" y="8" width="20" height="15" rx="4" fill="currentColor"/>
    <circle cx="12" cy="15" r="2.4" fill="#000" fill-opacity=".55"/><circle cx="20" cy="15" r="2.4" fill="#000" fill-opacity=".55"/>
    <path d="M10 29c0-3 2.7-5 6-5s6 2 6 5z" fill="currentColor"/>`,
  menu: `<path d="M7 9h18M7 16h18M7 23h18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,
  trade: `<path d="M6 11h17l-4-4M26 21H9l4 4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  bank: `<path d="M4 12 16 5l12 7z" fill="currentColor"/><path d="M7 14v9M12.5 14v9M19.5 14v9M25 14v9" stroke="currentColor" stroke-width="2.6"/><rect x="4" y="24" width="24" height="3.5" rx="1" fill="currentColor"/>`,
  dice: `<rect x="5" y="5" width="22" height="22" rx="5" fill="#fbf6ea" stroke="#2a1708" stroke-width="1.6"/>
    <circle cx="11" cy="11" r="2.2" fill="#2a1708"/><circle cx="16" cy="16" r="2.2" fill="#2a1708"/><circle cx="21" cy="21" r="2.2" fill="#2a1708"/>`,
  next: `<path d="M8 7l10 9-10 9z" fill="currentColor"/><rect x="21" y="7" width="3.5" height="18" rx="1" fill="currentColor"/>`,
  chevron: `<path d="M9 12l7 7 7-7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  timer: `<circle cx="16" cy="17" r="11" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M16 17v-6M13 3h6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`,
  close: `<path d="M9 9l14 14M23 9 9 23" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,
  trophy: `<path d="M10 5h12v6a6 6 0 0 1-12 0z" fill="#f2c35a" stroke="#2a1708" stroke-width="1.5"/>
    <path d="M10 7H6c0 4 2 6 4.5 6.5M22 7h4c0 4-2 6-4.5 6.5" fill="none" stroke="#2a1708" stroke-width="1.5"/>
    <path d="M14 17h4v5h-4zM10 23h12v4H10z" fill="#c99a3a" stroke="#2a1708" stroke-width="1.5"/>`,
  // Online play (M3): chat, spectating, disconnected, invite link.
  chat: `<path d="M5 7.5A3.5 3.5 0 0 1 8.5 4h15A3.5 3.5 0 0 1 27 7.5v10a3.5 3.5 0 0 1-3.5 3.5H14l-6 5v-5h.5A3.5 3.5 0 0 1 5 17.5z" fill="currentColor"/>`,
  eye: `<path d="M3 16s5-8 13-8 13 8 13 8-5 8-13 8S3 16 3 16z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><circle cx="16" cy="16" r="4" fill="currentColor"/>`,
  offline: `<path d="M4 12.5a17 17 0 0 1 24 0M8.5 17a10.5 10.5 0 0 1 15 0M13 21.5a4.5 4.5 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" opacity=".55"/><path d="M6 5l20 22" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,
  link: `<path d="M13.5 18.5a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-1.5 1.5M18.5 13.5a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l1.5-1.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>`,
} as const;

export type GlyphName = keyof typeof GLYPH;

/** A `<span class="glyph g-<name>">` holding one of the game glyphs. */
export function glyph(name: GlyphName, size = 20, label?: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `glyph g-${name}`;
  span.style.width = span.style.height = `${size}px`;
  if (label) {
    span.setAttribute('role', 'img');
    span.setAttribute('aria-label', label);
  } else span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}">${GLYPH[name]}</svg>`;
  return span;
}

export const DEV_GLYPH: Record<DevCardType, GlyphName> = {
  knight: 'knight',
  victoryPoint: 'victoryPoint',
  roadBuilding: 'roadBuilding',
  yearOfPlenty: 'yearOfPlenty',
  monopoly: 'monopoly',
};
