/**
 * Award banner (#36): a short pop-up when Longest Road / Largest Army (or an expansion title:
 * Longest Trade Route, a C&K metropolis, Harbormaster...) changes hands. Non-blocking: it takes
 * no pointer events and fades out on its own. Theme tokens only.
 */
import type { Player, PlayerId } from '../engine';
import { h, type Child } from './dom';
import { glyph, type GlyphName } from './icons';
import { parseLogText, youTokens } from './log';
import { playerName } from './widgets';
import './awardBanner.css';

export interface AwardBannerInfo {
  award: 'longestRoad' | 'largestArmy' | 'other';
  /** "Longest Road", "science metropolis"... */
  label: string;
  /** "Blue took Longest Road from Red" (the viewer may already read as "You"). */
  text: string;
  to: PlayerId | null;
}

export const AWARD_BANNER_MS = 3400;

let box: HTMLElement | null = null;

function iconFor(info: AwardBannerInfo): GlyphName {
  if (info.award !== 'other') return info.award;
  if (/metropolis/i.test(info.label)) return 'city';
  if (/defender/i.test(info.label)) return 'knight';
  return 'victoryPoint';
}

/** The banner element (exported for tests); `viewer` reads as "You". */
export function awardBanner(
  info: AwardBannerInfo,
  players: readonly Pick<Player, 'id' | 'name' | 'color'>[],
  viewer: PlayerId | null = null,
): HTMLElement {
  const raw = parseLogText(info.text, players);
  const tokens = viewer === null || viewer < 0 ? raw : youTokens(raw, viewer);
  const line = tokens.flatMap((t): Child[] => {
    if (t.kind === 'player') return [playerName(players.find((p) => p.id === t.id))];
    if (t.kind === 'text') return [t.text.replace(/^ (?=Longest|Largest)/, '')];
    return [];
  });
  const color = info.to === null ? undefined : players.find((p) => p.id === info.to)?.color;
  return h(
    'div',
    {
      class: `award-banner${info.to === null ? ' is-lost' : ''}${info.to === viewer && viewer !== null ? ' is-mine' : ''}`,
      style: color ? { '--pc': color } : {},
      attrs: { role: 'status' },
    },
    h('span', { class: 'award-icon' }, glyph(iconFor(info), 30, info.label)),
    h(
      'span',
      { class: 'award-body' },
      h('span', { class: 'award-title' }, info.label),
      h('span', { class: 'award-text' }, ...line),
    ),
  );
}

/** Show `info` for AWARD_BANNER_MS (several stack). */
export function showAwardBanner(
  info: AwardBannerInfo,
  players: readonly Pick<Player, 'id' | 'name' | 'color'>[],
  viewer: PlayerId | null = null,
  ms = AWARD_BANNER_MS,
): HTMLElement {
  if (!box || !box.isConnected) {
    box = h('div', { class: 'award-banners' });
    document.body.append(box);
  }
  const el = awardBanner(info, players, viewer);
  box.append(el);
  setTimeout(() => el.classList.add('is-leaving'), ms);
  setTimeout(() => el.remove(), ms + 450);
  return el;
}
