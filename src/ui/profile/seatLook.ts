/**
 * Hotseat seats (PR1): the look button in a setup-screen seat row (picture + piece-style preview,
 * opens the Profile dialog without the nickname), and the local profile as seat 1's default.
 */
import { h } from '../dom';
import { glyph } from '../icons';
import { playerStyle } from '../widgets';
import { openProfileDialog, profileAvatar, stylePreviewImg } from './dialog';
import {
  DEFAULT_PIECE_STYLE,
  PIECE_STYLE_LABEL,
  pieceStyleOr,
  type AvatarRef,
  type PieceStyleId,
  type Profile,
} from './model';

export interface SeatLookDraft {
  name: string;
  color: string;
  controller: 'human' | 'bot';
  avatar?: AvatarRef;
  pieceStyle?: PieceStyleId;
}

/** The seat's look changed (avatar null = none). */
export type SeatLookChange = (look: { avatar: AvatarRef | null; pieceStyle: PieceStyleId }) => void;

export function seatLookButton(
  seat: SeatLookDraft,
  index: number,
  onChange: SeatLookChange,
): HTMLElement {
  const bot = seat.controller === 'bot';
  const style = pieceStyleOr(seat.pieceStyle);
  const pic = bot
    ? h(
        'span',
        { class: 'avatar is-bot', style: { ...playerStyle(seat.color), '--av': '30px' } },
        glyph('bot', 19),
      )
    : profileAvatar(seat.avatar ?? null, seat.color, 30);
  return h(
    'button',
    {
      class: 'pf-seat-look',
      title: `${bot ? 'Pieces' : 'Picture and pieces'} for seat ${index + 1} (${PIECE_STYLE_LABEL[style]})`,
      attrs: { 'aria-label': `Look of seat ${index + 1}`, 'data-k': `look-${index}` },
      on: {
        click: () =>
          openProfileDialog({
            title: `Seat ${index + 1}${seat.name.trim() ? ` · ${seat.name.trim()}` : ''}`,
            showName: false,
            showAvatar: !bot,
            color: seat.color,
            profile: {
              name: seat.name,
              avatar: seat.avatar ?? null,
              pieceStyle: style,
            },
            onSave: (p) => onChange({ avatar: p.avatar, pieceStyle: p.pieceStyle }),
          }),
      },
    },
    pic,
    stylePreviewImg(style, seat.color),
  );
}

/**
 * Seat 1 takes the local profile's look (and nickname, over the default "You") when it is a
 * human seat without a look of its own.
 */
export function withProfileLook<T extends SeatLookDraft>(
  seats: readonly T[],
  profile: Profile,
): T[] {
  const first = seats[0];
  if (!first || first.controller !== 'human' || first.avatar || first.pieceStyle) return [...seats];
  const hasLook = profile.avatar !== null || profile.pieceStyle !== DEFAULT_PIECE_STYLE;
  if (!hasLook && !profile.name) return [...seats];
  const name =
    profile.name && (first.name === 'You' || first.name === '') ? profile.name : first.name;
  const look: T = {
    ...first,
    name,
    ...(profile.avatar ? { avatar: profile.avatar } : {}),
    ...(profile.pieceStyle !== DEFAULT_PIECE_STYLE ? { pieceStyle: profile.pieceStyle } : {}),
  };
  return [look, ...seats.slice(1)];
}
