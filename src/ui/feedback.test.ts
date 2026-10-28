// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { midGame } from '../engine/fixtures';
import {
  MAX_URL_LENGTH,
  REPO_URL,
  bugReportUrl,
  featureRequestUrl,
  feedbackFooter,
} from './feedback';
import { Hud } from './hud';
import { fakeLegal } from './devLegal';

const params = (url: string) => new URL(url).searchParams;

describe('bugReportUrl', () => {
  it('points at the bug form and prefills the public fields', () => {
    const s = midGame();
    const url = bugReportUrl({
      state: s,
      online: true,
      userAgent: 'UA/1.0 (X11; Linux)',
      version: 'abc1234',
    });
    expect(url.startsWith(`${REPO_URL}/issues/new?`)).toBe(true);
    const q = params(url);
    expect(q.get('template')).toBe('bug_report.yml');
    expect(q.get('version')).toBe('abc1234');
    expect(q.get('players')).toBe(String(s.players.length));
    expect(q.get('connection')).toBe('Online');
    expect(q.get('browser')).toBe('UA/1.0 (X11; Linux)');
    expect(q.get('mode')).toContain(s.settings.mode);
    expect(bugReportUrl({ online: false }).includes('connection=Offline')).toBe(true);
  });

  it('omits game fields when no game is open', () => {
    const q = params(bugReportUrl({ userAgent: 'x' }));
    expect(q.has('mode')).toBe(false);
    expect(q.has('players')).toBe(false);
    expect(q.has('connection')).toBe(false);
  });

  it('encodes special characters', () => {
    const url = bugReportUrl({ userAgent: 'a&b=c #d é' });
    expect(url).not.toMatch(/[ #é]/);
    expect(params(url).get('browser')).toBe('a&b=c #d é');
  });

  it('caps the length by shortening the user agent', () => {
    const url = bugReportUrl({ state: midGame(), userAgent: 'Z'.repeat(5000) });
    expect(url.length).toBeLessThanOrEqual(MAX_URL_LENGTH);
    expect(params(url).get('browser')!.length).toBeGreaterThan(0);
  });

  it('carries nothing private', () => {
    const s = midGame();
    const url = bugReportUrl({ state: s, online: true, userAgent: 'UA' });
    const keys = [...params(url).keys()].sort();
    expect(keys).toEqual(['browser', 'connection', 'mode', 'players', 'template', 'version']);
    for (const p of s.players) if (p.name) expect(url).not.toContain(encodeURIComponent(p.name));
  });
});

describe('featureRequestUrl', () => {
  it('points at the feature form with no prefill', () => {
    const q = params(featureRequestUrl());
    expect([...q.keys()]).toEqual(['template']);
    expect(q.get('template')).toBe('feature_request.yml');
  });
});

describe('buttons', () => {
  beforeEach(() => document.body.replaceChildren());

  it('home footer renders both links safely', () => {
    document.body.append(feedbackFooter());
    const links = [...document.querySelectorAll<HTMLAnchorElement>('a.fb-link')];
    expect(links.map((a) => a.textContent)).toEqual(['Report a bug', 'Suggest a feature']);
    for (const a of links) {
      expect(a.target).toBe('_blank');
      expect(a.rel).toBe('noopener noreferrer');
    }
  });

  it('HUD menu renders both links', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const hud = new Hud(root);
    const s = midGame();
    hud.render(s, { viewer: 1, legal: fakeLegal(s, 1), isBotTurn: false });
    root.querySelector<HTMLButtonElement>('.menu-btn')!.click();
    const links = [...root.querySelectorAll<HTMLAnchorElement>('.menu-panel a.menu-item')];
    const bug = links.find((a) => a.textContent?.includes('Report a bug'))!;
    const feat = links.find((a) => a.textContent?.includes('Suggest a feature'))!;
    expect(bug.href).toContain('template=bug_report.yml');
    expect(bug.href).toContain('connection=Offline');
    expect(feat.href).toContain('template=feature_request.yml');
    expect(bug.target).toBe('_blank');
    expect(bug.rel).toBe('noopener noreferrer');
  });
});
