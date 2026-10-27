/**
 * Dev page entry (styles-dev.html): every piece style x every seat colour, settlement and city on
 * terrain, at an in-game "zoomed out" scale and 2.5x larger, plus cities under the C&K wall and
 * metropolis overlays.
 */
import { Application, Container, Graphics } from 'pixi.js';
import { drawMetropolis, drawWall } from '../expansions/ck/render';
import { PIECE_STYLE_IDS, PIECE_STYLE_LABEL, type PieceStyleId } from '../ui/profile/model';
import { SEAT_COLORS } from '../ui/setup/model';
import { HEX_SIZE as U } from './geometry';
import { pieceStyle } from './pieceStyles';
import { TERRAIN_PALETTE } from './theme';

const COLORS = SEAT_COLORS.map((c) => parseInt(c.color.slice(1), 16));
const TERRAINS = [
  TERRAIN_PALETTE.grain,
  TERRAIN_PALETTE.lumber,
  TERRAIN_PALETTE.wool,
  TERRAIN_PALETTE.brick,
  TERRAIN_PALETTE.ore,
  TERRAIN_PALETTE.desert,
  TERRAIN_PALETTE.grain,
  TERRAIN_PALETTE.wool,
];
/** Cell size in hex units (two pieces side by side on a hex corner pair). */
const CELL_W = 1.6;
const CELL_H = 1.0;

function hexPoints(cx: number, cy: number, r: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return out;
}

/** A terrain patch: two neighbouring hexes, the pieces sit on their shared vertices. */
function backdrop(g: Graphics, terrain: number, ox: number, oy: number) {
  const t = TERRAINS[terrain % TERRAINS.length] ?? TERRAIN_PALETTE.grain;
  const r = U * 0.92;
  const w = Math.sqrt(3) * r;
  g.rect(ox, oy, CELL_W * U, CELL_H * U).fill(t.dark);
  for (const dx of [-w / 2, w / 2]) {
    g.poly(hexPoints(ox + (CELL_W * U) / 2 + dx, oy + (CELL_H * U) / 2, r))
      .fill(t.base)
      .stroke({ width: 3, color: t.light, alpha: 0.6 });
  }
}

function drawCell(
  g: Graphics,
  ox: number,
  oy: number,
  style: PieceStyleId,
  color: number,
  terrain: number,
  ck = false,
) {
  backdrop(g, terrain, ox, oy);
  const s = pieceStyle(style);
  // C&K cells sit the city lower: the metropolis tower reaches 0.67 above the vertex.
  const y = oy + CELL_H * U * (ck ? 0.7 : 0.62);
  if (ck) {
    const cx = ox + CELL_W * U * 0.5;
    drawWall(g, cx, y, U);
    s.city(g, cx, y, color);
    drawMetropolis(g, cx, y, U, 0x3d6fd6);
    return;
  }
  s.settlement(g, ox + CELL_W * U * 0.27, y, color);
  s.city(g, ox + CELL_W * U * 0.66, y, color);
}

async function section(title: string, scale: number, ck = false, colors = COLORS) {
  const root = document.getElementById('root');
  if (!root) return;
  const h = document.createElement('h2');
  h.textContent = title;
  root.append(h);
  const row = document.createElement('div');
  row.className = 'section';
  const labels = document.createElement('div');
  labels.className = 'labels';
  const cellW = CELL_W * U * scale;
  const cellH = CELL_H * U * scale;
  const gap = 4;
  for (const id of PIECE_STYLE_IDS) {
    const d = document.createElement('div');
    d.style.height = `${cellH + gap}px`;
    d.textContent = PIECE_STYLE_LABEL[id];
    labels.append(d);
  }
  row.append(labels);
  root.append(row);

  const cols = colors.length;
  const app = new Application();
  await app.init({
    width: cols * (cellW + gap),
    height: PIECE_STYLE_IDS.length * (cellH + gap),
    background: 0x0f2a44,
    antialias: true,
    resolution: window.devicePixelRatio,
    autoDensity: true,
    autoStart: false,
  });
  app.ticker.stop();
  row.append(app.canvas);
  const world = new Container();
  world.scale.set(scale);
  app.stage.addChild(world);
  const step = gap / scale;
  PIECE_STYLE_IDS.forEach((id, r) => {
    colors.forEach((color, c) => {
      const ox = c * (CELL_W * U + step);
      const oy = r * (CELL_H * U + step);
      // Each cell is clipped to its own rectangle (the backdrop hexes overflow it).
      const cell = new Container();
      const g = new Graphics();
      const mask = new Graphics().rect(ox, oy, CELL_W * U, CELL_H * U).fill(0xffffff);
      cell.addChild(g, mask);
      cell.mask = mask;
      world.addChild(cell);
      drawCell(g, ox, oy, id, color, (c + r) % TERRAINS.length, ck);
    });
  });
  // A still page: render once, no ticker.
  app.render();
}

await section('In-game, zoomed out (hex ≈ 32 px)', 0.32);
await section('2.5× (hex ≈ 80 px)', 0.8);
await section('Cities & Knights overlays (wall under, metropolis over), 2.5×', 0.8, true);
// Close-up of a few colours (red, white, dark brown) for detail work.
await section('Close-up (hex ≈ 220 px)', 2.2, false, [0xd64541, 0xecf0f1, 0x9c6b43]);
