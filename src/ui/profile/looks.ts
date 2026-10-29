/**
 * Who looks like what (PR1): the seat looks the game controller (hotseat) or the net controller
 * (online) set, read by `avatar()` in ../widgets.ts. Kept here rather than threaded through
 * every HUD render, since a look is cosmetic and changes rarely.
 */
import { h } from '../dom';
import { staticSvg } from '../icons';
import { AVATAR_ART } from './gallery';
import { avatarError, isAvatarId, type AvatarRef, type SeatLook } from './model';
import './profile.css';

let looks: readonly SeatLook[] = [];
const listeners = new Set<() => void>();

/** Looks per PlayerId (the HUD re-renders on its next render; listeners hear it at once). */
export function setSeatLooks(next: readonly SeatLook[]): void {
  if (JSON.stringify(next) === JSON.stringify(looks)) return;
  looks = next.map((l) => ({ ...l }));
  for (const cb of [...listeners]) cb();
}

export function seatLooks(): readonly SeatLook[] {
  return looks;
}

/** A seat's picture, or null (none: the generic icon). */
export function seatAvatar(player: number): AvatarRef | null {
  return looks[player]?.avatar ?? null;
}

export function onSeatLooks(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * The picture of `ref` filling its box (`.avatar-pic`): the gallery's SVG inline, or an <img> of
 * an uploaded data URL. null for a bad or unknown ref (callers show the generic icon).
 */
export function avatarPicture(ref: AvatarRef | null | undefined): HTMLElement | null {
  if (!ref || avatarError(ref) !== null) return null;
  if (isAvatarId(ref)) {
    const el = h('span', { class: 'avatar-pic', attrs: { 'aria-hidden': 'true' } });
    // Our own markup (gallery.ts), never user input.
    el.append(staticSvg(`avatar:${ref}`, () => AVATAR_ART[ref].svg));
    return el;
  }
  const img = h('img', {
    class: 'avatar-pic',
    attrs: { alt: '', draggable: 'false', decoding: 'async' },
  }) as HTMLImageElement;
  img.src = ref; // a checked data:image URL, never a remote one
  return img;
}

/** The label of a gallery avatar ('Fox'), or 'Your picture' for an upload. */
export function avatarLabel(ref: AvatarRef | null): string {
  if (!ref) return 'No picture';
  return isAvatarId(ref) ? AVATAR_ART[ref].label : 'Your picture';
}
