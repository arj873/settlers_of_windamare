/**
 * Keeps sound sparse during fast play: one update's cues are coalesced (one per id, loudest
 * level), each id has a cooldown, at most `perUpdate` cues play at once, and normal / low cues
 * share a rolling budget per window (bots at instant speed stay a quiet trickle). High cues
 * (you, or what affects you) only obey the cooldown and the per-update cap.
 */
import type { CueLevel, SoundCue } from './types';

export interface LimiterOptions {
  /** Same id again within this many ms is dropped (default 150). */
  cooldownMs: number;
  /** Per-id cooldown overrides. */
  cooldowns: Readonly<Record<string, number>>;
  /** Most cues played from one update (default 3). */
  perUpdate: number;
  /** Rolling window for the normal / low budget (default 1000 ms). */
  windowMs: number;
  /** Normal / low cues allowed in the window, counted together: a normal cue plays while fewer than `normal` did, a low one while fewer than `low` did. */
  budget: Readonly<Record<Exclude<CueLevel, 'high'>, number>>;
}

export const DEFAULT_LIMITS: Readonly<LimiterOptions> = {
  cooldownMs: 150,
  cooldowns: { dice: 600, yourTurn: 1000, victory: 3000, defeat: 3000, timerWarn: 700 },
  perUpdate: 3,
  windowMs: 1000,
  budget: { normal: 4, low: 2 },
};

const RANK: Readonly<Record<CueLevel, number>> = { high: 0, normal: 1, low: 2 };

/** One cue per id with the loudest level, in first-seen order. */
export function coalesce(cues: readonly SoundCue[]): SoundCue[] {
  const out: SoundCue[] = [];
  for (const c of cues) {
    const seen = out.find((o) => o.id === c.id);
    if (!seen) out.push({ ...c });
    else if (RANK[c.level] < RANK[seen.level]) seen.level = c.level;
  }
  return out;
}

export class SoundLimiter {
  private readonly opts: LimiterOptions;
  private readonly last = new Map<string, number>();
  /** Times of the normal / low cues played inside the window. */
  private recent: number[] = [];

  constructor(opts: Partial<LimiterOptions> = {}) {
    this.opts = { ...DEFAULT_LIMITS, ...opts };
  }

  /** The cues to play now out of one update's `cues` (records them as played). */
  admit(cues: readonly SoundCue[], now: number): SoundCue[] {
    const o = this.opts;
    this.recent = this.recent.filter((t) => now - t < o.windowMs);
    // Stable sort: loudest first, the mapping's priority order within a level.
    const ranked = coalesce(cues).sort((a, b) => RANK[a.level] - RANK[b.level]);
    const out: SoundCue[] = [];
    for (const c of ranked) {
      if (out.length >= o.perUpdate) break;
      const prev = this.last.get(c.id);
      const cooldown = o.cooldowns[c.id] ?? o.cooldownMs;
      if (prev !== undefined && now - prev < cooldown) continue;
      if (c.level !== 'high' && this.recent.length >= o.budget[c.level]) continue;
      this.last.set(c.id, now);
      if (c.level !== 'high') this.recent.push(now);
      out.push(c);
    }
    return out;
  }

  reset(): void {
    this.last.clear();
    this.recent = [];
  }
}
