import { describe, expect, it } from 'vitest';
import {
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  roomCodeFromBytes,
  roomSocketPath,
} from './api';

describe('room codes', () => {
  it('alphabet: 32 symbols, no 0/O/1/I', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(32);
    for (const ch of '0O1I') expect(ROOM_CODE_ALPHABET).not.toContain(ch);
  });

  it('codes from bytes are 6 alphabet symbols, using the low 5 bits', () => {
    expect(roomCodeFromBytes(Uint8Array.from([0, 1, 2, 31, 32, 255]))).toBe('234Z2Z');
    for (let i = 0; i < 50; i++) {
      const bytes = Uint8Array.from(
        { length: ROOM_CODE_LENGTH },
        (_, j) => (i * 37 + j * 101) % 256,
      );
      expect(normalizeRoomCode(roomCodeFromBytes(bytes))).toBe(roomCodeFromBytes(bytes));
    }
    expect(() => roomCodeFromBytes(new Uint8Array(3))).toThrow();
  });

  it('normalize: trims and upper-cases; rejects ambiguous symbols and wrong lengths', () => {
    expect(normalizeRoomCode(' abc234 ')).toBe('ABC234');
    expect(normalizeRoomCode('ABC23')).toBeNull();
    expect(normalizeRoomCode('ABC2345')).toBeNull();
    expect(normalizeRoomCode('ABC20O')).toBeNull();
    expect(normalizeRoomCode('ABC2-4')).toBeNull();
  });

  it('socket path', () => {
    expect(roomSocketPath('ABC234')).toBe('/api/rooms/ABC234/ws');
  });
});
