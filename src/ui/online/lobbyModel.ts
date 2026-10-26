/** Pure lobby logic (no DOM): what each seat shows and which buttons the viewer gets. */
import { MAPS } from '../../engine';
import type { MemberId, MemberInfo, RoomConfig, RoomInfo } from '../../net/protocol';
import { ROOM_COLORS } from '../../net/protocol';
import { colorName, MAX_PLAYERS, timerLabel, TIMER_STEPS, mapInfo } from '../setup/model';

export interface SeatView {
  index: number;
  color: string;
  colorLabel: string;
  /** Occupant's nickname, or null for an open seat. */
  name: string | null;
  isMine: boolean;
  isHostSeat: boolean;
  /** Occupant disconnected. */
  isAway: boolean;
  canSit: boolean;
  canStand: boolean;
  /** Host: remove this (open, last) seat. */
  canRemove: boolean;
  /** Colours the viewer may switch to (own seat only). */
  colors: string[];
}

export interface LobbyView {
  seats: SeatView[];
  spectators: MemberInfo[];
  me: MemberInfo | null;
  isHost: boolean;
  hostName: string | null;
  canAddSeat: boolean;
  /** Start button: null = enabled, else why not. */
  startBlocked: string | null;
  summary: string;
}

export function minSeats(config: RoomConfig): number {
  return MAPS[config.map].minPlayers;
}

export function lobbyView(room: RoomInfo, meId: MemberId | null): LobbyView {
  const me = room.members.find((m) => m.id === meId) ?? null;
  const isHost = me !== null && room.host === me.id;
  const byId = new Map(room.members.map((m) => [m.id, m]));
  const last = room.seats[room.seats.length - 1];
  const named = me !== null && me.name !== '';
  const seats = room.seats.map((s): SeatView => {
    const occ = s.occupant ? byId.get(s.occupant) : undefined;
    const isMine = s.occupant !== null && s.occupant === meId;
    return {
      index: s.index,
      color: s.color,
      colorLabel: colorName(s.color) ?? 'Seat',
      name: occ ? occ.name || 'Someone' : null,
      isMine,
      isHostSeat: s.occupant !== null && s.occupant === room.host,
      isAway: occ !== undefined && !occ.connected,
      canSit: s.occupant === null && named,
      canStand: isMine,
      canRemove:
        isHost && s.occupant === null && s === last && room.seats.length > minSeats(room.config),
      colors: isMine
        ? ROOM_COLORS.filter((c) => c === s.color || !room.seats.some((o) => o.color === c))
        : [],
    };
  });
  const seated = room.seats.some((s) => s.occupant !== null);
  return {
    seats,
    spectators: room.members.filter((m) => m.seat === null && m.name !== ''),
    me,
    isHost,
    hostName: room.host ? (byId.get(room.host)?.name ?? null) || null : null,
    canAddSeat: isHost && room.seats.length < MAX_PLAYERS,
    startBlocked: !isHost
      ? 'Only the host can start'
      : !seated
        ? 'Someone has to take a seat first'
        : null,
    summary: configSummary(room.config),
  };
}

export function configSummary(c: RoomConfig): string {
  const parts = [mapInfo(c.map).label, `${c.seatCount} seats`, `${c.vpToWin} VP`];
  const idx = TIMER_STEPS.indexOf(c.turnTimerSec);
  if (c.turnTimerSec !== null && idx >= 0) parts.push(`${timerLabel(idx)} timer`);
  return parts.join(' · ');
}

/** The link friends open: this page with `?room=CODE` (keeps an explicit `?server=`). */
export function inviteUrl(href: string, roomId: string): string {
  const u = new URL(href);
  const server = u.searchParams.get('server');
  u.search = '';
  u.hash = '';
  u.searchParams.set('room', roomId);
  if (server) u.searchParams.set('server', server);
  return u.toString();
}
