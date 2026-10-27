import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./stats.css', import.meta.url), 'utf8');

/** Declarations of the top-level rule whose selector list is exactly `selectors`. */
function rule(selectors: string[]): string {
  const re = /([^{}]+)\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const list = (m[1] ?? '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(',')
      .map((s) => s.trim());
    if (list.length === selectors.length && selectors.every((s) => list.includes(s))) {
      return m[2] ?? '';
    }
  }
  return '';
}

describe('stats panel layout', () => {
  // #49: the panel is a capped flex column. The overflowing (overflow-x: auto) tab strip has a
  // zero minimum height, so on a tall tab it shrank and the active underline crossed the labels.
  // The browser check across themes and widths is scripts/shots-game-stats.mjs.
  it('header, tabs and footer never shrink; only the body scrolls', () => {
    expect(rule(['.gs-head', '.gs-tabs', '.gs-foot'])).toMatch(/flex-shrink:\s*0/);
    expect(rule(['.gs-body'])).toMatch(/overflow-y:\s*auto/);
  });
});
