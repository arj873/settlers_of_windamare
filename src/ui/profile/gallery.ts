/**
 * The built-in profile pictures (PR1): 18 pickable avatars plus the robot face for bot seats.
 *
 * Original artwork drawn for this project as SVG markup in code (CC0, see docs/CREDITS.md).
 * Each picture is a full-bleed 96x96 square with its own background; the UI clips it to a circle,
 * so everything that matters stays inside the inscribed circle (radius ~44 around 48,48).
 * Gradient ids carry a per-avatar prefix (`av-<id>-`) because many pictures share one page.
 */
import type { AvatarId } from './model';

export interface AvatarArt {
  label: string;
  /** Full <svg> markup, viewBox="0 0 96 96". */
  svg: string;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** Outline colour (warm near-black) and width shared by every subject. */
const INK = '#3a2a22';

/** The frame: background gradient + a group that gives every child the ink outline. */
function svg(id: string, light: string, dark: string, body: string, ink = INK): string {
  const g = `av-${id}-bg`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">` +
    `<defs><radialGradient id="${g}" cx="50%" cy="35%" r="75%">` +
    `<stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/>` +
    `</radialGradient></defs><rect width="96" height="96" fill="url(#${g})"/>` +
    `<g stroke="${ink}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">` +
    body +
    `</g></svg>`
  );
}

/** A filled, outlined path. */
const p = (d: string, fill: string): string => `<path d="${d}" fill="${fill}"/>`;
/** A filled path without outline (inner details). */
const f = (d: string, fill: string): string => `<path d="${d}" fill="${fill}" stroke="none"/>`;
/** An outline-only path (lines, mouths, the outline redrawn over inner fills). */
const l = (d: string, extra = ''): string => `<path d="${d}" fill="none"${extra}/>`;
const circle = (cx: number, cy: number, r: number, fill: string, extra = ''): string =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${extra}/>`;
const ellipse = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill: string,
  extra = '',
): string => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"${extra}/>`;
const NS = ' stroke="none"';

/** Fill a shape, draw details over it, then redraw its outline on top. */
const layered = (d: string, fill: string, inner: string): string => f(d, fill) + inner + l(d);

/** A glossy dot eye. */
function eye(x: number, y: number, r = 3, color = INK): string {
  const h = Math.round(r * 0.38 * 10) / 10;
  return circle(x, y, r, color, NS) + circle(x + h, y - h, h, '#fff', NS);
}

/**
 * Overlapping circles merged into one outlined blob (wool, frog head): an ink pass grown by the
 * outline width, then the fill pass, so the inner overlaps draw no lines.
 */
function blob(parts: readonly (readonly [number, number, number])[], fill: string): string {
  const ink = parts.map(([x, y, r]) => circle(x, y, r + 2.5, INK, NS)).join('');
  return ink + parts.map(([x, y, r]) => circle(x, y, r, fill, NS)).join('');
}

/** n puffs on a ring (sheep wool), as blob parts. */
function ring(
  cx: number,
  cy: number,
  rr: number,
  n: number,
  r: number,
): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr), r]);
  }
  return out;
}

/** A four-pointed twinkle. */
function star(x: number, y: number, s: number, fill: string): string {
  const k = s * 0.3;
  return f(
    `M${x} ${y - s}L${x + k} ${y - k}L${x + s} ${y}L${x + k} ${y + k}L${x} ${y + s}` +
      `L${x - k} ${y + k}L${x - s} ${y}L${x - k} ${y - k}Z`,
    fill,
  );
}

/** Scale a subject by k around (cx, cy), to fill the circle better. */
const zoom = (k: number, cx: number, cy: number, body: string): string =>
  `<g transform="translate(${r2(cx * (1 - k))} ${r2(cy * (1 - k))}) scale(${k})">${body}</g>`;
const r2 = (x: number): number => Math.round(x * 100) / 100;

// People share a bust: shoulders, ears, head, face.
const shoulders = (fill: string): string => p('M10 98Q12 74 48 72Q84 74 86 98Z', fill);
const ears = (skin: string, y = 53): string => circle(30, y, 4.5, skin) + circle(66, y, 4.5, skin);
const head = (skin: string, cy = 51): string => ellipse(48, cy, 18, 19, skin);
function face(y = 52, smile = true, blush = '#e8806e'): string {
  return (
    eye(41, y, 2.7) +
    eye(55, y, 2.7) +
    circle(36.5, y + 6, 3, blush, `${NS} opacity=".45"`) +
    circle(59.5, y + 6, 3, blush, `${NS} opacity=".45"`) +
    (smile ? l(`M43 ${y + 8}Q48 ${y + 12} 53 ${y + 8}`) : '')
  );
}

// ---------------------------------------------------------------------------
// Animals
// ---------------------------------------------------------------------------

const FOX_HEAD = 'M13 44Q18 25 48 25Q78 25 83 44Q78 63 48 81Q18 63 13 44Z';
const fox = svg(
  'fox',
  '#d4f1ea',
  '#86cbbf',
  p('M21 10L41 30L16 44Z', '#e8762a') +
    p('M75 10L55 30L80 44Z', '#e8762a') +
    f('M23 17L34 29L20 37Z', '#4a2a1f') +
    f('M73 17L62 29L76 37Z', '#4a2a1f') +
    layered(
      FOX_HEAD,
      '#e8762a',
      f('M15 49Q32 50 48 65Q64 50 81 49Q76 64 48 81Q20 64 15 49Z', '#fdf3e6') +
        l('M17 49Q32 50 48 65Q64 50 79 49', ' stroke-width="2"'),
    ) +
    ellipse(48, 76, 5.5, 4, INK) +
    eye(35, 46, 3.6) +
    eye(61, 46, 3.6),
);

const owl = svg(
  'owl',
  '#e9e3fb',
  '#ad9fe0',
  p('M24 34L20 10L40 22Z', '#8c5d3b') +
    p('M72 34L76 10L56 22Z', '#8c5d3b') +
    layered(
      'M18 52Q18 20 48 20Q78 20 78 52Q78 86 48 90Q18 86 18 52Z',
      '#9b6b45',
      f('M30 64Q48 56 66 64Q66 86 48 88Q30 86 30 64Z', '#ecd3a8') +
        l('M38 70l5 4 5-4 5 4 5-4M38 79l5 4 5-4 5 4 5-4', ' stroke="#b0845a" stroke-width="2"'),
    ) +
    circle(34, 45, 14, '#f6e7cb') +
    circle(62, 45, 14, '#f6e7cb') +
    circle(34, 45, 8.5, '#f4b42e') +
    circle(62, 45, 8.5, '#f4b42e') +
    eye(34, 45, 4.8) +
    eye(62, 45, 4.8) +
    p('M42 54L54 54L48 65Z', '#e8862b'),
);

const bear = svg(
  'bear',
  '#e0effa',
  '#94c0e4',
  circle(24, 27, 11, '#8b5a3c') +
    circle(72, 27, 11, '#8b5a3c') +
    circle(24, 27, 5.5, '#d4a47a', NS) +
    circle(72, 27, 5.5, '#d4a47a', NS) +
    circle(48, 53, 31, '#8b5a3c') +
    ellipse(48, 66, 15, 12, '#e3c097') +
    p('M41 59Q48 54 55 59Q52 65 48 65Q44 65 41 59Z', INK) +
    l('M48 65V69M42 70Q45 73 48 69Q51 73 54 70') +
    eye(37, 46, 3.6) +
    eye(59, 46, 3.6),
);

const WOLF_HEAD =
  'M16 38Q22 23 48 23Q74 23 80 38L85 57L74 56L76 67L62 70L48 84L34 70L20 67L22 56L11 57Z';
const wolf = svg(
  'wolf',
  '#fbf1cf',
  '#e5c873',
  p('M19 40L24 7L43 27Z', '#737e8c') +
    p('M77 40L72 7L53 27Z', '#737e8c') +
    f('M25 31L27 16L36 27Z', '#e2cdbb') +
    f('M71 31L69 16L60 27Z', '#e2cdbb') +
    layered(
      WOLF_HEAD,
      '#7d8896',
      f('M33 53Q48 46 63 53L61 69L48 84L35 69Z', '#e9ebef') +
        f('M33 39Q38 35 42 40Q38 42 33 39ZM63 39Q58 35 54 40Q58 42 63 39Z', '#e9ebef'),
    ) +
    ellipse(48, 74, 6, 4.5, INK) +
    circle(38, 46, 5, '#f5b83c') +
    circle(58, 46, 5, '#f5b83c') +
    eye(38, 46.5, 2.9) +
    eye(58, 46.5, 2.9),
);

const ANTLERS =
  'M40 36Q35 26 27 14M33 25Q26 25 18 21M30 19Q33 14 34 9' +
  'M56 36Q61 26 69 14M63 25Q70 25 78 21M66 19Q63 14 62 9';
const STAG_HEAD = 'M31 40Q48 31 65 40Q70 58 59 76Q48 87 37 76Q26 58 31 40Z';
const stag = svg(
  'stag',
  '#fde9cc',
  '#f0b571',
  l(ANTLERS, ' stroke-width="8.5"') +
    l(ANTLERS, ' stroke="#f3e2bf" stroke-width="3.6"') +
    ellipse(24, 47, 12, 6, '#b97a4a', ' transform="rotate(-22 24 47)"') +
    ellipse(72, 47, 12, 6, '#b97a4a', ' transform="rotate(22 72 47)"') +
    ellipse(24, 47, 7, 2.8, '#ecc2a3', `${NS} transform="rotate(-22 24 47)"`) +
    ellipse(72, 47, 7, 2.8, '#ecc2a3', `${NS} transform="rotate(22 72 47)"`) +
    layered(STAG_HEAD, '#b97a4a', f('M37 66Q48 60 59 66Q57 81 48 83Q39 81 37 66Z', '#f5e3cb')) +
    ellipse(48, 75, 6.5, 4.5, INK) +
    eye(40, 52, 3.4) +
    eye(56, 52, 3.4),
);

const boar = svg(
  'boar',
  '#fbe0dc',
  '#e59f96',
  p('M19 32L25 11L39 25Z', '#6b4d3c') +
    p('M77 32L71 11L57 25Z', '#6b4d3c') +
    f('M24 26L26 18L32 24Z', '#c79583') +
    f('M72 26L70 18L64 24Z', '#c79583') +
    p('M37 27L40 15L45 24L48 11L51 24L56 15L59 27Z', '#4a3328') +
    p('M17 53Q17 24 48 24Q79 24 79 53Q79 80 48 83Q17 80 17 53Z', '#7a5846') +
    p('M33 68Q25 60 28 49Q32 58 38 63Z', '#fffaf0') +
    p('M63 68Q71 60 68 49Q64 58 58 63Z', '#fffaf0') +
    ellipse(48, 65, 15, 11, '#eaa597') +
    ellipse(43, 65, 2.6, 3.8, '#7a3e34', NS) +
    ellipse(53, 65, 2.6, 3.8, '#7a3e34', NS) +
    eye(36, 46, 3.3) +
    eye(60, 46, 3.3),
);

const hare = svg(
  'hare',
  '#f7e3f5',
  '#d5a3d2',
  ellipse(37, 31, 8.5, 21, '#c8ab8c', ' transform="rotate(-12 37 31)"') +
    ellipse(59, 31, 8.5, 21, '#c8ab8c', ' transform="rotate(12 59 31)"') +
    ellipse(37, 32, 3.8, 15, '#f2b4b8', `${NS} transform="rotate(-12 37 32)"`) +
    ellipse(59, 32, 3.8, 15, '#f2b4b8', `${NS} transform="rotate(12 59 32)"`) +
    ellipse(48, 63, 25, 21, '#c8ab8c') +
    circle(42.5, 69, 7.5, '#f6ede1', NS) +
    circle(53.5, 69, 7.5, '#f6ede1', NS) +
    `<rect x="45" y="72" width="6" height="6.5" rx="1.2" fill="#fff" stroke-width="1.6"/>` +
    p('M44.5 63.5L51.5 63.5L48 68Z', '#e8808e') +
    eye(39, 57, 3.4) +
    eye(57, 57, 3.4),
);

const RAVEN_INK = '#15171f';
const raven = svg(
  'raven',
  '#d9f1fb',
  '#8fcde9',
  p(
    'M33 46Q33 22 54 22Q76 22 76 46Q76 58 70 64Q83 74 83 98L27 98Q27 74 40 64Q33 56 33 46Z',
    '#30364a',
  ) +
    f('M66 72Q80 78 80 98L60 98Q58 82 66 72Z', '#222737') +
    l('M44 29Q54 24 64 29', ' stroke="#5f6a8c" stroke-width="3"') +
    p('M37 37L9 48L37 56Q41 46 37 37Z', '#6f7584') +
    l('M12 48L37 47', ' stroke-width="2"') +
    circle(51, 40, 6.5, '#fff') +
    eye(52, 40, 3.6, RAVEN_INK),
  RAVEN_INK,
);

const sheep = svg(
  'sheep',
  '#e3f4cf',
  '#9bcf6c',
  blob([...ring(48, 46, 24, 10, 11), [48, 46, 24]], '#fbfaf5') +
    ellipse(30, 51, 10, 4.5, '#4b3a35', ' transform="rotate(25 30 51)"') +
    ellipse(66, 51, 10, 4.5, '#4b3a35', ' transform="rotate(-25 66 51)"') +
    p('M35 47Q35 37 48 37Q61 37 61 47Q61 71 48 75Q35 71 35 47Z', '#4b3a35') +
    blob(
      [
        [41, 38, 6.5],
        [48, 35, 7],
        [55, 38, 6.5],
      ],
      '#fbfaf5',
    ) +
    circle(42.5, 53, 3.6, '#fff', NS) +
    circle(53.5, 53, 3.6, '#fff', NS) +
    eye(42.5, 53.5, 2.2) +
    eye(53.5, 53.5, 2.2) +
    l('M44 65Q48 68 52 65', ' stroke="#d6c6be" stroke-width="2"'),
);

const ox = svg(
  'ox',
  '#d6f4f0',
  '#7fcdc4',
  p('M33 37Q15 37 20 15Q26 28 37 29Z', '#f3e7c8') +
    p('M63 37Q81 37 76 15Q70 28 59 29Z', '#f3e7c8') +
    ellipse(22, 45, 10, 5, '#a0623a', ' transform="rotate(18 22 45)"') +
    ellipse(74, 45, 10, 5, '#a0623a', ' transform="rotate(-18 74 45)"') +
    layered(
      'M27 33Q48 22 69 33Q73 49 67 62L29 62Q23 49 27 33Z',
      '#a0623a',
      f('M44 31L52 31L50 50L46 50Z', '#f6e8d6'),
    ) +
    p('M39 28Q43 36 48 30Q53 36 57 28Q48 23 39 28Z', '#7c4527') +
    ellipse(48, 67, 21, 14, '#ebc7a5') +
    ellipse(41, 67, 3, 2.6, INK, NS) +
    ellipse(55, 67, 3, 2.6, INK, NS) +
    eye(37, 45, 3.4) +
    eye(59, 45, 3.4),
);

const cat = svg(
  'cat',
  '#ffe6d6',
  '#f4ab86',
  p('M19 42L22 11L43 26Z', '#a3a9b6') +
    p('M77 42L74 11L53 26Z', '#a3a9b6') +
    f('M24.5 34L26 19L36 27Z', '#f0b3bb') +
    f('M71.5 34L70 19L60 27Z', '#f0b3bb') +
    layered(
      'M15 55Q15 26 48 26Q81 26 81 55Q81 81 48 81Q15 81 15 55Z',
      '#a3a9b6',
      l(
        'M48 28V37M40 29L42 36M56 29L54 36M16 52L24 54M17 61L25 60M80 52L72 54M79 61L71 60',
        ' stroke="#646a79" stroke-width="3"',
      ) +
        circle(43, 65, 7, '#f6f4f1', NS) +
        circle(53, 65, 7, '#f6f4f1', NS),
    ) +
    ellipse(37, 48, 6, 5.5, '#a5d24e') +
    ellipse(59, 48, 6, 5.5, '#a5d24e') +
    ellipse(37, 48, 1.7, 4.2, INK, NS) +
    ellipse(59, 48, 1.7, 4.2, INK, NS) +
    p('M44 59L52 59L48 63.5Z', '#ee98a4') +
    l(
      'M48 64V66M44 68Q46 69 48 66Q50 69 52 68M35 66L21 64M35 69L21 72M61 66L75 64M61 69L75 72',
      ' stroke-width="1.6"',
    ),
);

const frog = svg(
  'frog',
  '#fde3ec',
  '#f0a3bf',
  blob(
    [
      [31, 36, 13],
      [65, 36, 13],
    ],
    '#6dbb4a',
  ) +
    ellipse(48, 61, 37.5, 26.5, INK, NS) +
    ellipse(48, 61, 35, 24, '#6dbb4a', NS) +
    circle(31, 36, 13, '#6dbb4a', NS) +
    circle(65, 36, 13, '#6dbb4a', NS) +
    circle(31, 35, 8.5, '#fff') +
    circle(65, 35, 8.5, '#fff') +
    eye(32, 35, 4.6) +
    eye(64, 35, 4.6) +
    circle(30, 74, 3.2, '#4f9a35', NS) +
    circle(68, 72, 2.4, '#4f9a35', NS) +
    circle(23, 63, 4.2, '#f2938f', NS) +
    circle(73, 63, 4.2, '#f2938f', NS) +
    circle(44, 51, 1.4, INK, NS) +
    circle(52, 51, 1.4, INK, NS) +
    l('M28 62Q48 77 68 62'),
);

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const knight = svg(
  'knight',
  '#dde6fc',
  '#91a8e6',
  shoulders('#a9b4c0') +
    p('M34 98L36 77Q48 82 60 77L62 98Z', '#c0443f') +
    l('M48 84V96M43 89H53', ' stroke="#f2cc5a" stroke-width="3"') +
    p('M22 80Q18 30 48 28Q78 30 74 80Q48 88 22 80Z', '#9aa5b1') +
    l('M28 75Q48 83 68 75', ' stroke="#7d8896" stroke-width="2"') +
    ellipse(48, 57, 16.5, 17, '#c68a5a') +
    face(58, true, '#d9705e') +
    p('M48 23Q51 8 67 10Q59 15 57 25Z', '#d0453f') +
    p('M27 46Q27 22 48 22Q69 22 69 46Z', '#cdd6df') +
    `<rect x="25" y="41.5" width="46" height="7.5" rx="2.5" fill="#8d99a6"/>` +
    `<rect x="45.5" y="46" width="5" height="15" rx="1.5" fill="#8d99a6"/>` +
    l('M48 23V41', ' stroke="#8d99a6" stroke-width="2"'),
);

const farmer = svg(
  'farmer',
  '#ddf0fc',
  '#92c7ec',
  zoom(
    1.08,
    48,
    60,
    shoulders('#c8553d') +
      p('M35 98L35 83L61 83L61 98Z', '#4e74a8') +
      l('M38 83L34 74M58 83L62 74', ' stroke="#4e74a8" stroke-width="3.5"') +
      circle(38, 88, 1.8, '#f2cc5a', NS) +
      circle(58, 88, 1.8, '#f2cc5a', NS) +
      ears('#f3caa6', 54) +
      ellipse(48, 53, 17.5, 18.5, '#f3caa6') +
      p('M31 44Q29 52 33 55Q34 49 37 45ZM65 44Q67 52 63 55Q62 49 59 45Z', '#a0522d') +
      face(54) +
      f(
        'M35 58.5h1.6v1.6h-1.6zM38 60.5h1.6v1.6h-1.6zM58.4 58.5h1.6v1.6h-1.6zM55.4 60.5h1.6v1.6h-1.6z',
        '#b8693f',
      ) +
      ellipse(48, 38, 34, 8.5, '#ecc85c') +
      l('M20 38Q48 44 76 38', ' stroke="#c9a23e" stroke-width="1.6"') +
      p('M33 38Q32 18 48 18Q64 18 63 38Q48 42 33 38Z', '#ecc85c') +
      f('M33.5 31Q48 35 62.5 31L63 37.5Q48 41.5 33 37.5Z', '#c0503a') +
      l('M33 38Q48 42 63 38'),
  ),
);

const miner = svg(
  'miner',
  '#e6dfee',
  '#a597b8',
  zoom(
    1.08,
    48,
    60,
    shoulders('#3f6f73') +
      l('M36 75L38 98M60 75L58 98', ' stroke="#7a4f2a" stroke-width="4"') +
      ears('#7b4b2f', 54) +
      ellipse(48, 54, 18, 18.5, '#7b4b2f') +
      face(55, false, '#c0604c') +
      p('M42 63Q48 68 54 63Q48 65 42 63Z', '#fff') +
      ellipse(59.5, 64, 3.6, 2.2, '#3b2216', `${NS} opacity=".45"`) +
      p('M28 45Q28 21 48 21Q68 21 68 45Z', '#e2a838') +
      l('M48 22V30', ' stroke="#b98420" stroke-width="2"') +
      `<rect x="23" y="41" width="50" height="7.5" rx="3.75" fill="#c58d24"/>` +
      `<rect x="41.5" y="27" width="13" height="12" rx="3" fill="#6d5233"/>` +
      circle(48, 33, 6.2, '#fff3b0') +
      l('M48 19V15M38 22L35 19M58 22L61 19', ' stroke="#fff3b0" stroke-width="2.5"'),
  ),
);

const sailor = svg(
  'sailor',
  '#d6f3f5',
  '#80cbd3',
  zoom(
    1.08,
    48,
    60,
    shoulders('#f6f5ef') +
      l(
        'M16 86H80M14 94H82M22 79H74',
        ' stroke="#2f4f7f" stroke-width="3.5" stroke-linecap="butt"',
      ) +
      l('M10 98Q12 74 48 72Q84 74 86 98') +
      ears('#efc19c', 52) +
      head('#efc19c') +
      face(51, false) +
      p('M30 50Q29 79 48 81Q67 79 66 50Q61 62 48 62Q35 62 30 50Z', '#c8652c') +
      p('M40 62Q48 57 56 62Q48 65.5 40 62Z', '#a14d1e') +
      p('M29 44Q28 21 48 21Q68 21 67 44Z', '#2f4f7f') +
      `<rect x="27" y="38" width="42" height="9" rx="4" fill="#3f68a0"/>` +
      l('M34 39V46M41 39V46M48 39V46M55 39V46M62 39V46', ' stroke="#2f4f7f" stroke-width="1.6"'),
  ),
);

const merchant = svg(
  'merchant',
  '#fcf0c8',
  '#ebc35c',
  zoom(
    1.08,
    48,
    60,
    shoulders('#2f6b4f') +
      p('M21 83Q34 72 48 80Q62 72 75 83Q62 91 48 89Q34 91 21 83Z', '#ece0c8') +
      l('M37 85Q48 97 59 85', ' stroke="#d9a62c" stroke-width="3"') +
      circle(48, 91, 3.5, '#f2cc5a', ' stroke-width="1.8"') +
      ears('#d7a070', 54) +
      ellipse(48, 54, 17.5, 18.5, '#d7a070') +
      face(55, false, '#d06a5a') +
      p('M39 64Q43 59 48 62Q53 59 57 64Q53 62.5 48 64.5Q43 62.5 39 64Z', '#4a2c1c') +
      p('M62 31Q74 25 71 15Q67 22 60 27Z', '#f4d36b') +
      p('M22 44Q18 27 39 22Q62 15 75 30Q79 41 72 45Q48 38 22 44Z', '#a8323e') +
      f('M24.5 42Q48 36 73 43.5L72.5 47Q48 40.5 24 46Z', '#73202b') +
      l('M23 45Q48 39 73 46'),
  ),
);

const wizard = svg(
  'wizard',
  '#fde4d4',
  '#f0a383',
  shoulders('#6b5bb5') +
    ears('#8e5a38', 54) +
    ellipse(48, 54, 17.5, 18.5, '#8e5a38') +
    face(54, false, '#d26a5a') +
    p('M30 56Q28 86 48 93Q68 86 66 56Q61 66 48 66Q35 66 30 56Z', '#f4f2ec') +
    p('M38 63Q48 57 58 63Q48 67 38 63Z', '#dedad0') +
    p('M35 48Q40 42 46 47Q40 46 35 48ZM61 48Q56 42 50 47Q56 46 61 48Z', '#f4f2ec') +
    ellipse(48, 40, 31, 6.5, '#3f4aa0') +
    p('M32 40L50 9Q58 6 65 12Q56 12 55 18L64 40Q48 44 32 40Z', '#3f4aa0') +
    star(50, 26, 4.5, '#f6d35b') +
    star(42, 35, 3, '#f6d35b') +
    star(57, 34, 2.5, '#f6d35b'),
);

// ---------------------------------------------------------------------------
// Bot seats
// ---------------------------------------------------------------------------

/** The robot face shown for bot seats (not pickable). Same format. */
export const BOT_AVATAR_SVG: string = svg(
  'bot',
  '#e8edf3',
  '#aab8c9',
  p('M16 98Q18 79 48 77Q78 79 80 98Z', '#7f93a8') +
    `<rect x="41" y="68" width="14" height="10" fill="#93a6b9"/>` +
    l('M48 27V15') +
    circle(48, 12, 4.8, '#ef6b5b') +
    `<rect x="15" y="40" width="9" height="17" rx="3" fill="#8ea1b4"/>` +
    `<rect x="72" y="40" width="9" height="17" rx="3" fill="#8ea1b4"/>` +
    `<rect x="21" y="26" width="54" height="45" rx="12" fill="#c3d0dc"/>` +
    `<rect x="28" y="34" width="40" height="23" rx="8" fill="#2e3a4b"/>` +
    circle(39, 45.5, 5.2, '#6ee7f0', NS) +
    circle(57, 45.5, 5.2, '#6ee7f0', NS) +
    circle(40.5, 44, 1.8, '#fff', NS) +
    circle(58.5, 44, 1.8, '#fff', NS) +
    `<rect x="36" y="61" width="24" height="5.5" rx="2.75" fill="#8ea1b4" stroke-width="1.8"/>` +
    l('M42 61V66.5M48 61V66.5M54 61V66.5', ' stroke-width="1.5"'),
);

export const AVATAR_ART: Readonly<Record<AvatarId, AvatarArt>> = Object.freeze({
  fox: { label: 'Fox', svg: fox },
  owl: { label: 'Owl', svg: owl },
  bear: { label: 'Bear', svg: bear },
  wolf: { label: 'Wolf', svg: wolf },
  stag: { label: 'Stag', svg: stag },
  boar: { label: 'Boar', svg: boar },
  hare: { label: 'Hare', svg: hare },
  raven: { label: 'Raven', svg: raven },
  sheep: { label: 'Sheep', svg: sheep },
  ox: { label: 'Ox', svg: ox },
  cat: { label: 'Cat', svg: cat },
  frog: { label: 'Frog', svg: frog },
  knight: { label: 'Knight', svg: knight },
  farmer: { label: 'Farmer', svg: farmer },
  miner: { label: 'Miner', svg: miner },
  sailor: { label: 'Sailor', svg: sailor },
  merchant: { label: 'Merchant', svg: merchant },
  wizard: { label: 'Wizard', svg: wizard },
});
