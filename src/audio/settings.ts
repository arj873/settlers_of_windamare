/** Sound settings: master volume + mute, saved in localStorage (every access in try/catch). */

export const SOUND_KEY = 'catan:sound';

export interface SoundSettings {
  /** Master volume 0..1. */
  volume: number;
  muted: boolean;
}

export const DEFAULT_SOUND: Readonly<SoundSettings> = { volume: 0.6, muted: false };

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The saved settings, or the defaults (missing, corrupt or unreadable storage). */
export function loadSoundSettings(store: Store | null): SoundSettings {
  try {
    const raw = store?.getItem(SOUND_KEY);
    if (!raw) return { ...DEFAULT_SOUND };
    const v = JSON.parse(raw) as Partial<SoundSettings> | null;
    return {
      volume:
        typeof v?.volume === 'number' && Number.isFinite(v.volume)
          ? clamp01(v.volume)
          : DEFAULT_SOUND.volume,
      muted: typeof v?.muted === 'boolean' ? v.muted : DEFAULT_SOUND.muted,
    };
  } catch {
    return { ...DEFAULT_SOUND };
  }
}

export function saveSoundSettings(store: Store | null, s: SoundSettings): void {
  try {
    store?.setItem(SOUND_KEY, JSON.stringify({ volume: clamp01(s.volume), muted: s.muted }));
  } catch {
    // Private mode / quota: the setting just doesn't stick.
  }
}

/** Master gain for the settings: perceptual (squared) volume, 0 when muted. */
export function masterGain(s: SoundSettings): number {
  return s.muted ? 0 : clamp01(s.volume) ** 2;
}

/**
 * Should sound stay off on this page whatever the settings say? The playtest harness and other
 * automation (`?debug=1`, `navigator.webdriver`) and `?mute=1`.
 */
export function isHeadless(search: string, nav: { webdriver?: boolean } | undefined): boolean {
  const p = new URLSearchParams(search);
  if (p.get('debug') === '1' || p.get('mute') === '1') return true;
  return nav?.webdriver === true;
}
