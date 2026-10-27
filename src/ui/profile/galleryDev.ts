/**
 * Dev page entry (avatars-dev.html): every gallery picture as a 96 px square and as 44 px / 24 px
 * circles with a player-colour ring, on a dark and a light background.
 */
import { AVATAR_ART, BOT_AVATAR_SVG } from './gallery';
import { AVATAR_IDS } from './model';

const SEAT_COLORS = [
  '#d64541',
  '#3a7bd5',
  '#ecf0f1',
  '#f39c12',
  '#3fae6a',
  '#9b59b6',
  '#9c6b43',
  '#ec7fb5',
];

const ENTRIES: { label: string; svg: string }[] = [
  ...AVATAR_IDS.map((id) => AVATAR_ART[id]),
  { label: 'Bot', svg: BOT_AVATAR_SVG },
];

function el(tag: string, cls: string, svg?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  // Our own constant markup from gallery.ts.
  if (svg) e.innerHTML = svg;
  return e;
}

function circle(svg: string, size: number, color: string): HTMLElement {
  const c = el('div', 'av', svg);
  c.style.width = `${size}px`;
  c.style.height = `${size}px`;
  c.style.boxShadow = `0 0 0 3px ${color}`;
  return c;
}

function panel(kind: 'dark' | 'light'): HTMLElement {
  const root = el('section', `panel ${kind}`);
  const h = el('h2', '');
  h.textContent = `${kind} background`;
  root.append(h);
  const grid = el('div', 'grid');
  ENTRIES.forEach((a, i) => {
    const color = SEAT_COLORS[i % SEAT_COLORS.length] ?? '#fff';
    const card = el('div', 'card');
    card.append(el('div', 'sq', a.svg), circle(a.svg, 44, color), circle(a.svg, 24, color));
    const name = el('div', 'name');
    name.textContent = a.label;
    card.append(name);
    grid.append(card);
  });
  root.append(grid);
  // A player-list-like strip: every avatar at 24 px, then at 44 px.
  for (const size of [24, 44]) {
    const strip = el('div', 'strip');
    ENTRIES.forEach((a, i) => {
      strip.append(circle(a.svg, size, SEAT_COLORS[i % SEAT_COLORS.length] ?? '#fff'));
    });
    root.append(strip);
  }
  return root;
}

document.getElementById('root')?.append(panel('dark'), panel('light'));
