import { describe, expect, it } from 'vitest';
import { AVATAR_ART, BOT_AVATAR_SVG } from './gallery';
import { AVATAR_IDS } from './model';

const ALL: [string, string][] = [
  ...AVATAR_IDS.map((id): [string, string] => [id, AVATAR_ART[id].svg]),
  ['bot', BOT_AVATAR_SVG],
];

describe('avatar gallery', () => {
  it('has exactly the AVATAR_IDS, each with a label', () => {
    expect(Object.keys(AVATAR_ART).sort()).toEqual([...AVATAR_IDS].sort());
    for (const id of AVATAR_IDS) expect(AVATAR_ART[id].label.trim()).not.toBe('');
  });

  it.each(ALL)('%s is a safe, self-contained 96x96 svg', (_id, svg) => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="0 0 96 96"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/<image/i);
    expect(svg).not.toMatch(/<foreignObject/i);
    expect(svg).not.toMatch(/<text/i);
    expect(svg).not.toMatch(/href\s*=\s*["']?\s*(https?:|\/\/|javascript:)/i);
    expect(svg).not.toMatch(/url\(\s*["']?(?!#)/i);
    expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
    expect(svg.length).toBeLessThan(4000);
  });

  it('uses ids that are unique across the whole gallery and prefixed per avatar', () => {
    const seen = new Set<string>();
    for (const [id, svg] of ALL) {
      for (const m of svg.matchAll(/\sid="([^"]+)"/g)) {
        const gid = m[1]!;
        expect(gid.startsWith(`av-${id}-`)).toBe(true);
        expect(seen.has(gid)).toBe(false);
        seen.add(gid);
      }
      // Every url(#ref) points at an id defined in the same picture.
      for (const m of svg.matchAll(/url\(#([^)]+)\)/g)) expect(svg).toContain(`id="${m[1]!}"`);
    }
  });
});
