/** Player-facing wording for server error codes (docs/MULTIPLAYER.md §14). */
import type { ErrorCode } from '../../net/protocol';

/** null = say nothing (the client recovers on its own). */
export function errorText(code: ErrorCode, message: string, ref?: string): string | null {
  switch (code) {
    case 'stale_state':
    case 'not_joined':
      return null;
    case 'not_host':
      return 'Only the host can do that.';
    case 'wrong_phase':
      return 'That is not possible right now.';
    case 'name_required':
      return 'Pick a nickname first.';
    case 'bad_seat':
      return 'That seat does not exist any more.';
    case 'seat_taken':
      return 'Someone just took that seat.';
    case 'color_taken':
      return 'Another player has that colour.';
    case 'not_seated':
      return ref === 'start'
        ? 'Someone has to take a seat before the game can start.'
        : 'Take a seat first.';
    case 'bad_config':
      return `The server rejected these settings: ${message}`;
    case 'not_your_seat':
      return 'That is not your seat.';
    case 'illegal_action':
      return `Move not allowed: ${message}`;
    case 'rate_limited':
      return 'Slow down a little.';
    case 'bad_message':
      return `The server did not understand that (${message}).`;
    default:
      return fatalText(code);
  }
}

/** Why the connection ended for good. */
export function fatalText(code: ErrorCode): string {
  switch (code) {
    case 'kicked':
      return 'The host removed you from the room.';
    case 'replaced':
      return 'You opened this room in another tab or window.';
    case 'room_expired':
      return 'This room does not exist any more.';
    case 'room_full':
      return 'This room is full.';
    case 'version_mismatch':
      return 'A new version of the game is out. Reload the page to keep playing.';
    default:
      return 'The connection to the room was closed.';
  }
}
