/** Small shared DOM pieces of the wooden HUD: card faces, avatars, coloured names. */
import type { DevCardType, Player, Resource } from '../engine';
import { h, type Child } from './dom';
import { DEV_GLYPH, glyph, RESOURCE_LABEL, resourceIcon } from './icons';
import { DEV_CARD_INFO, inkFor } from './cards';
import { avatarPicture, seatAvatar } from './profile/looks';

/** A resource card face (`.rcard-face`); `w` is the card width in px, height follows 5:7. */
export function resCardFace(resource: Resource, w: number, ...extra: Child[]): HTMLElement {
  return h(
    'span',
    {
      class: `card-face rf-${resource}`,
      style: { '--cw': `${w}px` },
      attrs: { role: 'img', 'aria-label': RESOURCE_LABEL[resource] },
    },
    resourceIcon(resource, Math.round(w * 0.72)),
    ...extra,
  );
}

/** A development card face; `type: null` = face-down card back. */
export function devCardFace(type: DevCardType | null, w: number, ...extra: Child[]): HTMLElement {
  return h(
    'span',
    {
      class: `card-face df-${type ?? 'back'}`,
      style: { '--cw': `${w}px` },
      attrs: {
        role: 'img',
        'aria-label': type ? DEV_CARD_INFO[type].name : 'Development card',
      },
    },
    glyph(type ? DEV_GLYPH[type] : 'devBack', Math.round(w * 0.78)),
    ...extra,
  );
}

/** A tiny inline card for the log: repeated up to 4 times, then one card with "×n". */
export function miniCards(resource: Resource, count: number): HTMLElement {
  const n = Math.max(1, count);
  const shown = n <= 4 ? n : 1;
  return h(
    'span',
    { class: 'mini-cards', title: `${n} ${RESOURCE_LABEL[resource].toLowerCase()}` },
    ...Array.from({ length: shown }, () => resCardFace(resource, 15)),
    n > 4 && h('b', { class: 'mini-n' }, `×${n}`),
  );
}

/** Player colour variables for an element: `--pc` and a readable `--pc-ink`. */
export function playerStyle(color: string): Record<string, string> {
  return { '--pc': color, '--pc-ink': inkFor(color) === 'dark' ? '#1d1208' : '#ffffff' };
}

/**
 * Round avatar in the player's colour: the seat's profile picture (PR1, profile/looks.ts) with a
 * player-colour ring, else a person silhouette; bots always show the bot.
 */
export function avatar(
  p: Pick<Player, 'color' | 'name'> & { id?: number },
  isBot: boolean,
  size: number,
  ...extra: Child[]
) {
  const pic = isBot || p.id === undefined ? null : avatarPicture(seatAvatar(p.id));
  return h(
    'span',
    {
      class: `avatar${isBot ? ' is-bot' : ''}${pic ? ' has-pic' : ''}`,
      style: { ...playerStyle(p.color), '--av': `${size}px` },
      title: isBot ? `${p.name} (bot)` : p.name,
    },
    pic ?? glyph(isBot ? 'bot' : 'person', Math.round(size * 0.62)),
    ...extra,
  );
}

/** A player's name in their colour (log, dialogs). */
export function playerName(
  p: Pick<Player, 'color' | 'name'> | undefined,
  fallback = '?',
): HTMLElement {
  return h('b', { class: 'pname', style: { '--pc': p?.color ?? '#ccc' } }, p?.name ?? fallback);
}
