/** Plain-text renderings of a Snapshot for the playtest CLI. Pure, unit-tested. */
import {
  bankTradeRatio,
  handSize,
  piecesLeft,
  publicVictoryPoints,
  RESOURCES,
  victoryPoints,
  type Action,
  type DevCardCounts,
  type GameState,
  type PlayerId,
} from '../../src/engine';
import { actors, mustDo, waitingOn } from './guard';
import type { Snapshot, UiScan } from './protocol';
import { hexLabel } from './spots';

const DEV_NAMES: Record<keyof DevCardCounts, string> = {
  knight: 'Knight',
  victoryPoint: 'Victory Point',
  roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly',
};

type LogEntry = GameState['log'][number];

export function formatLogEntry(state: GameState, e: LogEntry): string {
  const name = e.player === null ? null : (state.players[e.player]?.name ?? `P${e.player}`);
  // Engine log texts usually start with the player's name already.
  const who = name === null || e.text.includes(name) ? '' : `${name}: `;
  return `  ${e.turn > 0 ? `T${e.turn}` : 'Setup'} ${who}${e.text}`;
}

/** "buildRoad x12, endTurn, bankTrade x4". */
export function legalKinds(legal: readonly Action[], seat: PlayerId): string {
  const counts = new Map<string, number>();
  for (const a of legal) if (a.player === seat) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
  if (counts.size === 0) return 'none';
  return [...counts].map(([t, n]) => (n > 1 ? `${t} x${n}` : t)).join(', ');
}

function devLine(state: GameState, seat: PlayerId): string {
  const p = state.players[seat];
  if (!p) return 'none';
  const parts: string[] = [];
  for (const t of Object.keys(DEV_NAMES) as (keyof DevCardCounts)[]) {
    const ready = p.devCards[t];
    const fresh = p.newDevCards[t];
    if (ready + fresh === 0) continue;
    const bits = [ready > 0 ? `${ready} ready` : '', fresh > 0 ? `${fresh} new (next turn)` : ''];
    parts.push(`${DEV_NAMES[t]} (${bits.filter(Boolean).join(', ')})`);
  }
  if (state.turn.devCardPlayed && state.turn.current === seat)
    parts.push('[already played one this turn]');
  return parts.length > 0 ? parts.join('; ') : 'none';
}

/** UI-vs-state disagreements worth a bug report (only checked when the screen is yours). */
export function uiMismatches(state: GameState, ui: UiScan, seat: PlayerId): string[] {
  const out: string[] = [];
  const me = state.players[seat];
  if (ui.hand && me) {
    for (const r of RESOURCES) {
      const shown = ui.hand[r];
      if (shown !== undefined && shown !== me.resources[r]) {
        out.push(`HUD hand shows ${r} ${shown}, engine has ${me.resources[r]}`);
      }
    }
  }
  for (const panel of ui.panels) {
    const p = state.players.find((x) => x.name === panel.name);
    if (!p) continue;
    if (panel.cards !== handSize(p)) {
      out.push(`${p.name} panel shows ${panel.cards} cards, engine has ${handSize(p)}`);
    }
    const vp = publicVictoryPoints(state, p.id);
    if (panel.vp !== vp)
      out.push(`${p.name} panel shows ${panel.vp} VP, engine public VP is ${vp}`);
  }
  if (ui.diceTotal !== null && state.dice && ui.diceTotal !== state.dice[0] + state.dice[1]) {
    out.push(`dice show ${ui.diceTotal}, engine rolled ${state.dice[0] + state.dice[1]}`);
  }
  return out;
}

/** HUD controls in a compact form: dialog first, then the action bar. */
export function formatControls(ui: UiScan): string[] {
  const lines: string[] = [];
  const btn = (c: UiScan['controls'][number]) => `[${c.label}${c.on ? ' (on)' : ''}]`;
  const dialog = ui.controls.filter((c) => c.inDialog);
  if (ui.dialogTitle) {
    lines.push(`Dialog "${ui.dialogTitle}"`);
    for (const t of ui.dialogText) lines.push(`  says: ${t}`);
    if (ui.steppers.length > 0) {
      lines.push(
        `  steppers (use \`set <label> <n>\`): ${ui.steppers.map((s) => `${s.label}=${s.value}`).join(', ')}`,
      );
    }
    const on = dialog.filter((c) => c.enabled);
    const off = dialog.filter((c) => !c.enabled);
    lines.push(`  buttons: ${on.map(btn).join(' ') || 'none'}`);
    if (off.length > 0) lines.push(`  disabled: ${off.map(btn).join(' ')}`);
  }
  const rest = ui.controls.filter((c) => !c.inDialog);
  const on = rest.filter((c) => c.enabled);
  const off = rest.filter((c) => !c.enabled);
  lines.push(`Buttons: ${on.map(btn).join(' ') || 'none'}`);
  if (off.length > 0) lines.push(`Disabled: ${off.map(btn).join(' ')}`);
  return lines;
}

export function formatStatus(snap: Snapshot, seat: PlayerId, newConsole: number): string {
  const state = snap.state;
  if (!state) return 'The game has not loaded yet. Is `pnpm pt:serve` running?';
  const me = state.players[seat];
  if (!me) return `There is no seat ${seat + 1} in this game.`;
  const ui = snap.ui;
  const mine = snap.viewer === seat;
  const phase = state.phase;
  const cur = state.players[state.turn.current]?.name ?? '?';
  const lines: string[] = [];

  lines.push(
    `== ${me.name} (seat ${seat + 1}) | turn ${state.turn.number} | phase ${phase.kind} | current player: ${cur}`,
  );
  if (phase.kind === 'gameOver') {
    lines.push(`GAME OVER: ${ui.winnerText ?? state.players[state.winner ?? -1]?.name ?? '?'}`);
  } else if (mine && snap.legal.some((a) => a.player === seat)) {
    lines.push(`YOU MUST: ${mustDo(state, seat, snap.legal)}`);
    if (ui.cover) lines.push(`Screen: covered ("${ui.cover}") — run \`pass\` first.`);
  } else {
    lines.push(`NOT YOUR MOMENT: ${waitingOn(snap)}. Run \`wait\`.`);
  }

  const hand = RESOURCES.map((r) => `${r} ${me.resources[r]}`).join(', ');
  lines.push(`Hand: ${hand} (${handSize(me)} cards)`);
  const ratios = RESOURCES.map((r) => `${r} ${bankTradeRatio(state, seat, r)}:1`).join(', ');
  lines.push(`Bank ratios: ${ratios}`);
  lines.push(`Dev cards: ${devLine(state, seat)}`);
  const left = piecesLeft(state, seat);
  lines.push(
    `VP: ${victoryPoints(state, seat)} (public ${publicVictoryPoints(state, seat)}) of ${state.settings.vpToWin} | pieces left: roads ${left.road}, settlements ${left.settlement}, cities ${left.city}`,
  );
  const others = state.players
    .filter((p) => p.id !== seat)
    .map((p) => {
      const dev = Object.values(p.devCards).reduce((a, b) => a + b, 0);
      const fresh = Object.values(p.newDevCards).reduce((a, b) => a + b, 0);
      return `${p.name}: ${publicVictoryPoints(state, p.id)} VP, ${handSize(p)} cards, ${dev + fresh} dev, ${p.knightsPlayed} knights`;
    });
  lines.push(`Others: ${others.join(' | ')}`);
  const award = (p: PlayerId | null) => (p === null ? 'nobody' : (state.players[p]?.name ?? p));
  lines.push(
    `Longest Road: ${award(state.awards.longestRoad)} | Largest Army: ${award(state.awards.largestArmy)} | robber on ${state.robber} (${hexLabel(state, state.robber)})${state.dice ? ` | last roll ${state.dice[0]}+${state.dice[1]}=${state.dice[0] + state.dice[1]}` : ''}`,
  );

  if (mine && !ui.cover) {
    if (ui.hint) lines.push(`Prompt: "${ui.hint}"`);
    lines.push(...formatControls(ui));
    const bad = uiMismatches(state, ui, seat);
    if (bad.length > 0) lines.push(`POSSIBLE BUG (UI vs engine): ${bad.join('; ')}`);
  }
  if (ui.toasts.length > 0) lines.push(`Toasts: ${ui.toasts.map((t) => `"${t}"`).join(' ')}`);
  lines.push(`Legal for you: ${legalKinds(snap.legal, seat)}`);
  if (actors(snap.legal).length === 0 && phase.kind !== 'gameOver') {
    lines.push('STALLED: nobody can act. Report this as a blocker.');
  }
  if (newConsole > 0)
    lines.push(`Console: ${newConsole} new error(s)/warning(s) — run \`console\`.`);
  lines.push('Log (last 8):');
  for (const e of state.log.slice(-8)) lines.push(formatLogEntry(state, e));
  return lines.join('\n');
}
