/** Pure lobby logic (no DOM): what each seat shows and which buttons the viewer gets. */
import { MAPS, modeById, scenarioById } from '../../engine';
import type { MemberId, MemberInfo, RoomConfig, RoomInfo } from '../../net/protocol';
import { ROOM_COLORS, roomSeatCap } from '../../net/protocol';
import { DEFAULT_BOT_LEVEL, type BotLevel } from '../../bots/levels';
import {
  colorName,
  MAX_PLAYERS,
  mapInfo,
  playerRange,
  timerLabel,
  TIMER_STEPS,
} from '../setup/model';

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
  /** B1: the bot that plays the seat when nobody does. */
  botLevel: BotLevel;
  /** Host, open seat: may pick the bot level. */
  canSetLevel: boolean;
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
  /** L1: the viewer has no seat (the prompt at the top); null when seated. */
  watching: WatchingView | null;
  /** L1: who sits down on joining, and the seat cap when that is why newcomers watch. */
  inviteNote: string;
  /** Every seat has a person and the room cannot grow: newcomers watch. */
  tableFull: boolean;
}

export interface WatchingView {
  /** Has a nickname (needed to sit). */
  named: boolean;
  /** First open (bot) seat, or null when every seat has a person. */
  openSeat: number | null;
}

/** Seats the config's map (base) or mode + scenario (expansions) allow. */
export function seatRange(config: RoomConfig): { min: number; max: number } {
  if (config.mode === 'base') return { min: MAPS[config.map].minPlayers, max: MAX_PLAYERS };
  return playerRange({ mode: config.mode, scenario: config.scenario ?? null });
}

export function minSeats(config: RoomConfig): number {
  return seatRange(config).min;
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
      botLevel: s.botLevel ?? DEFAULT_BOT_LEVEL,
      canSetLevel: isHost && s.occupant === null,
    };
  });
  const seated = room.seats.some((s) => s.occupant !== null);
  const cap = roomSeatCap(room.config);
  const tableFull = room.seats.every((s) => s.occupant !== null) && room.seats.length >= cap;
  return {
    seats,
    spectators: room.members.filter((m) => m.seat === null && m.name !== ''),
    me,
    isHost,
    hostName: room.host ? (byId.get(room.host)?.name ?? null) || null : null,
    canAddSeat: isHost && room.seats.length < seatRange(room.config).max,
    startBlocked: !isHost
      ? 'Only the host can start'
      : !seated
        ? 'Someone has to take a seat first'
        : null,
    summary: configSummary(room.config),
    watching:
      me === null || me.seat !== null
        ? null
        : { named, openSeat: room.seats.find((s) => s.occupant === null)?.index ?? null },
    inviteNote: inviteNote(room.config, cap, tableFull),
    tableFull,
  };
}

/** Why the cap is what it is: "8 players" or "4 players (the most Explorers & Pirates: …)". */
function capText(c: RoomConfig, cap: number): string {
  return c.mode === 'base' ? `${cap} players` : `${cap} players, the most ${boardLabel(c)} allows`;
}

function inviteNote(c: RoomConfig, cap: number, full: boolean): string {
  if (full) return `The table is full (${capText(c, cap)}): anyone else who joins watches.`;
  return `Anyone with the link can join. They take a bot's seat, or a new one up to ${capText(c, cap)}; after that, newcomers watch.`;
}

function boardLabel(c: RoomConfig): string {
  const mode = modeById(c.mode);
  const scenario = c.scenario ? scenarioById(c.scenario) : undefined;
  return c.mode === 'base' || !mode
    ? mapInfo(c.map).label
    : scenario
      ? `${mode.name}: ${scenario.name}`
      : mode.name;
}

export function configSummary(c: RoomConfig): string {
  const parts = [boardLabel(c), `${c.seatCount} seats`, `${c.vpToWin} VP`];
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
