/** Text helpers for the playtest CLI: label cleanup and forgiving-but-safe choice matching. */

/** Lowercase, emoji and punctuation stripped, whitespace collapsed. "🎲 Roll dice!" -> "roll dice". */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/[^\p{L}\p{N}:+×\-−]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type Match =
  | { kind: 'one'; index: number; how: 'exact' | 'fuzzy' }
  | { kind: 'none' }
  | { kind: 'many'; indices: number[] };

/**
 * Find `query` among `choices`. Tries, in order, and stops at the first tier with any hit:
 * exact text, case/emoji-insensitive equality, whole-word prefix of every query word, substring.
 * A tier with several hits is ambiguous (`many`) — the caller lists them; we never guess.
 * `prefer` breaks ties inside a tier when exactly one tied choice satisfies it.
 */
export function matchChoice(
  query: string,
  choices: readonly string[],
  prefer?: (index: number) => boolean,
): Match {
  const q = normalize(query);
  if (q === '') return { kind: 'none' };
  const words = q.split(' ');
  const norm = choices.map(normalize);
  const tiers: ((c: string, i: number) => boolean)[] = [
    (_c, i) => choices[i] === query,
    (c) => c === q,
    (c) => {
      const cw = c.split(' ');
      return words.every((w) => cw.some((x) => x.startsWith(w)));
    },
    (c) => c.includes(q),
  ];
  for (const [t, test] of tiers.entries()) {
    const hits = norm.flatMap((c, i) => (test(c, i) ? [i] : []));
    if (hits.length === 0) continue;
    const how = t < 2 ? 'exact' : 'fuzzy';
    if (hits.length === 1) return { kind: 'one', index: hits[0] as number, how };
    if (prefer) {
      const preferred = hits.filter(prefer);
      if (preferred.length === 1) return { kind: 'one', index: preferred[0] as number, how };
    }
    return { kind: 'many', indices: hits };
  }
  return { kind: 'none' };
}

/** "Seat 2" / "seat2" / "2" -> 1 (0-based player index), or null. */
export function parseSeat(raw: string | undefined, seats = 3): number | null {
  const m = /^(?:seat\s*)?([0-9]+)$/i.exec((raw ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= seats ? n - 1 : null;
}

/** File-name-safe slug: "Robber can't move!" -> "robber-can-t-move". */
export function slugify(s: string, max = 40): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return slug || 'bug';
}

/**
 * Split CLI words into positional words and `--flag value…` options. A flag's value is every
 * word up to the next `--flag`; a flag with no words is `''`.
 */
export function parseFlags(words: readonly string[]): {
  positional: string[];
  flags: Record<string, string>;
} {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  let current: string | null = null;
  for (const w of words) {
    const m = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/i.exec(w);
    if (m) {
      current = (m[1] as string).toLowerCase();
      flags[current] = m[2] ?? '';
      if (m[2] !== undefined) current = null;
    } else if (current !== null) {
      flags[current] = flags[current] ? `${flags[current]} ${w}` : w;
    } else {
      positional.push(w);
    }
  }
  return { positional, flags };
}
