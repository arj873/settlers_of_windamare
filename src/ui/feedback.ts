/**
 * FB1: "Report a bug" / "Suggest a feature" links to the GitHub issue forms
 * (.github/ISSUE_TEMPLATE). The bug link prefills a few harmless public fields; never player
 * names, room codes, chat or game state.
 */
import type { GameState } from '../engine';
import { h } from './dom';

export const REPO_URL = 'https://github.com/arj873/settlers_of_windamare';

/** Git short SHA injected by vite.config.ts; "dev" when it is not defined (tests, tooling). */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** Keep the whole URL below what browsers and GitHub handle comfortably. */
export const MAX_URL_LENGTH = 2000;

export interface FeedbackContext {
  /** The open game, if any: only its mode, scenario and player count are used. */
  state?: {
    settings: Pick<GameState['settings'], 'mode' | 'scenario'>;
    players: readonly unknown[];
  } | null;
  online?: boolean;
  userAgent?: string;
  version?: string;
}

const issueUrl = (template: string, fields: Record<string, string> = {}): string => {
  const q = new URLSearchParams({ template });
  for (const [k, v] of Object.entries(fields)) if (v !== '') q.set(k, v);
  return `${REPO_URL}/issues/new?${q.toString()}`;
};

export const featureRequestUrl = (): string => issueUrl('feature_request.yml');

export function bugReportUrl(ctx: FeedbackContext = {}): string {
  const fields: Record<string, string> = { version: ctx.version ?? APP_VERSION };
  if (ctx.state) {
    fields.mode = ctx.state.settings.scenario
      ? `${ctx.state.settings.mode} / ${ctx.state.settings.scenario}`
      : ctx.state.settings.mode;
    fields.players = String(ctx.state.players.length);
  }
  if (ctx.online !== undefined) fields.connection = ctx.online ? 'Online' : 'Offline';
  // The user agent is the only unbounded field: shorten it until the URL fits.
  let ua = ctx.userAgent ?? '';
  for (;;) {
    const url = issueUrl('bug_report.yml', { ...fields, browser: ua });
    if (url.length <= MAX_URL_LENGTH || ua === '') return url;
    ua = ua.slice(0, Math.max(0, ua.length - 50));
  }
}

const link = (label: string, href: string, cls: string, role?: string) =>
  h(
    'a',
    {
      class: cls,
      attrs: { href, target: '_blank', rel: 'noopener noreferrer', ...(role ? { role } : {}) },
    },
    label,
  );

/** The two menu entries (HUD menu). */
export function feedbackMenuItems(ctx: FeedbackContext): HTMLElement[] {
  const ua = ctx.userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  return [
    link('Report a bug ↗', bugReportUrl({ ...ctx, userAgent: ua }), 'menu-item', 'menuitem'),
    link('Suggest a feature ↗', featureRequestUrl(), 'menu-item', 'menuitem'),
  ];
}

/** Small footer for the home screen (no game open). */
export function feedbackFooter(online = false): HTMLElement {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return h(
    'p',
    { class: 'fb-footer' },
    link('Report a bug', bugReportUrl({ online, userAgent: ua }), 'fb-link'),
    ' · ',
    link('Suggest a feature', featureRequestUrl(), 'fb-link'),
  );
}
