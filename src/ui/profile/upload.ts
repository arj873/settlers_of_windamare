/**
 * Own-picture upload (PR1): a square crop of the image, scaled to AVATAR_LIMITS.size px and
 * encoded as WebP (JPEG where the browser cannot) at the best quality that fits
 * AVATAR_LIMITS.targetBytes. Everything stays in the browser; the result is a data URL.
 */
import { AVATAR_LIMITS, avatarError, base64Bytes } from './model';

/** Files larger than this are refused before decoding (phone photos are well below). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface Crop {
  /** 1 = the largest square that fits; larger zooms in. */
  zoom: number;
  /** Centre of the square, as a fraction of the image (0..1). */
  cx: number;
  cy: number;
}

export const CENTER_CROP: Crop = { zoom: 1, cx: 0.5, cy: 0.5 };
export const MAX_ZOOM = 4;

/** The source square (image px) of `crop`, kept inside the image. */
export function cropRect(w: number, h: number, crop: Crop): { x: number; y: number; side: number } {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom));
  const side = Math.min(w, h) / zoom;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(0, max));
  return {
    x: clamp(crop.cx * w - side / 2, w - side),
    y: clamp(crop.cy * h - side / 2, h - side),
    side,
  };
}

/** `crop` moved by (dx, dy) screen px on a stage of `stage` px showing that crop. */
export function panCrop(w: number, h: number, crop: Crop, dx: number, dy: number, stage: number) {
  const { x, y, side } = cropRect(w, h, crop);
  const k = side / stage; // image px per stage px
  const nx = x - dx * k + side / 2;
  const ny = y - dy * k + side / 2;
  const next = { ...crop, cx: nx / w, cy: ny / h };
  // Re-centre on the clamped square so dragging past an edge does not build up slack.
  const r = cropRect(w, h, next);
  return { ...next, cx: (r.x + r.side / 2) / w, cy: (r.y + r.side / 2) / h };
}

/** Draw the crop of `img` into a square canvas of `size` px. */
export function drawCrop(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  crop: Crop,
  size: number,
): boolean {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const { x, y, side } = cropRect(img.naturalWidth, img.naturalHeight, crop);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff'; // transparent PNGs become white, not black, as JPEG
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, x, y, side, side, 0, 0, size, size);
  return true;
}

const QUALITIES = [0.86, 0.78, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];

/**
 * The canvas as the smallest acceptable data URL: WebP, else JPEG, stepping quality down until it
 * fits `targetBytes`. null if nothing fits (or the canvas cannot encode).
 */
export function encodeAvatar(
  canvas: Pick<HTMLCanvasElement, 'toDataURL'>,
  targetBytes: number = AVATAR_LIMITS.targetBytes,
): string | null {
  for (const type of ['image/webp', 'image/jpeg']) {
    for (const q of QUALITIES) {
      let url: string;
      try {
        url = canvas.toDataURL(type, q);
      } catch {
        return null; // tainted or unsupported canvas
      }
      // Browsers without the encoder fall back to PNG: try the next type.
      if (!url.startsWith(`data:${type};`)) break;
      const b64 = url.slice(url.indexOf(',') + 1);
      if (base64Bytes(b64) <= targetBytes && avatarError(url) === null) return url;
    }
  }
  return null;
}

/** Decode a picked file (an <img> from an object URL; the URL is revoked once loaded). */
export function loadImageFile(file: File): Promise<HTMLImageElement> {
  if (!file.type.startsWith('image/')) return Promise.reject(new Error('That is not a picture.'));
  if (file.size > MAX_UPLOAD_BYTES) {
    return Promise.reject(new Error('That picture is too large (20 MB at most).'));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth < 8 || img.naturalHeight < 8) {
        reject(new Error('That picture is too small.'));
        return;
      }
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that picture.'));
    };
    img.src = url;
  });
}
