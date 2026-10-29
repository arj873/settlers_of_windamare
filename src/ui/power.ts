/**
 * The "Performance" setting (s17, HUD menu, saved like the theme): Auto / High quality / Low
 * power. Low power is for weak phones, cheap Chromebooks and integrated GPUs: the board draws at
 * most at 1.5× resolution without antialiasing and holds still (render/BoardView `setStill`),
 * production cards do not fly, and `html.is-low-power` drops the HUD's decorative motion and
 * blur. Auto picks it on weak hardware (few cores, little memory) or once the board's frames
 * turn out slow (that verdict is remembered); High quality never does. Rules never change.
 */
import { browserThemeStorage, type ThemeStorage } from './theme';

export const POWER_SETTINGS = ['auto', 'high', 'low'] as const;
export type PowerSetting = (typeof POWER_SETTINGS)[number];
export const POWER_LABEL: Record<PowerSetting, string> = {
  auto: 'Auto',
  high: 'High quality',
  low: 'Low power',
};

export const POWER_KEY = 'catan.performance';
/** Auto found this device slow (frame rate): low power from the next load on, antialias too. */
export const POWER_SLOW_KEY = 'catan.performance.slow';
/** Highest canvas resolution in low power (CSS px → device px). */
export const LOW_POWER_RESOLUTION = 1.5;

/** `navigator` fields that hint at the hardware (deviceMemory: Chromium only, in GB). */
export interface HardwareHints {
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

/**
 * Weak hardware: 2 GB of memory or less, 2 cores or less, or 4 cores with 4 GB or less (old
 * Android phones, cheap Chromebooks). Unknown values count as fine: a 4-core laptop that does
 * not report its memory keeps high quality unless its frames turn out slow.
 */
export function weakHardware(h: HardwareHints): boolean {
  const cores = h.hardwareConcurrency ?? Infinity;
  const mem = h.deviceMemory;
  if (mem !== undefined && mem <= 2) return true;
  if (cores <= 2) return true;
  return cores <= 4 && mem !== undefined && mem <= 4;
}

/** Whether a setting means low power, given Auto's verdict for this device. */
export function lowPowerFor(setting: PowerSetting, slowDevice: boolean): boolean {
  return setting === 'low' || (setting === 'auto' && slowDevice);
}

export function loadPowerSetting(storage: ThemeStorage | null): PowerSetting {
  try {
    const v = storage?.getItem(POWER_KEY);
    return (POWER_SETTINGS as readonly string[]).includes(v ?? '') ? (v as PowerSetting) : 'auto';
  } catch {
    return 'auto';
  }
}

function store(storage: ThemeStorage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Full or blocked storage: the choice just isn't remembered.
  }
}

// ---------------------------------------------------------------------------
// The page's setting
// ---------------------------------------------------------------------------

let storage: ThemeStorage | null = null;
let setting: PowerSetting = 'auto';
let slowDevice = false;
const listeners = new Set<(low: boolean) => void>();

/** Read the saved setting and the device's hints; sets `html.is-low-power`. Call once at boot. */
export function initPower(
  hints: HardwareHints = typeof navigator === 'undefined' ? {} : navigator,
  from: ThemeStorage | null = browserThemeStorage(),
): void {
  storage = from;
  setting = loadPowerSetting(storage);
  let remembered = false;
  try {
    remembered = storage?.getItem(POWER_SLOW_KEY) === '1';
  } catch {
    // no storage: decide again
  }
  slowDevice = remembered || weakHardware(hints);
  apply();
}

export function powerSetting(): PowerSetting {
  return setting;
}

/** Low power right now (the setting, or Auto on a slow device). */
export function isLowPower(): boolean {
  return lowPowerFor(setting, slowDevice);
}

/** Picked in the menu. Picking Auto again forgets an earlier slow-frames verdict. */
export function setPowerSetting(next: PowerSetting): void {
  const was = isLowPower();
  setting = next;
  store(storage, POWER_KEY, next);
  if (next === 'auto' && slowDevice) {
    store(storage, POWER_SLOW_KEY, '0');
    slowDevice = weakHardware(typeof navigator === 'undefined' ? {} : navigator);
  }
  if (isLowPower() !== was) apply();
}

/** The board's frames were slow (render/frames.ts `FrameRateProbe`): Auto turns low power on. */
export function reportSlowDevice(): void {
  if (slowDevice) return;
  const was = isLowPower();
  slowDevice = true;
  store(storage, POWER_SLOW_KEY, '1');
  if (isLowPower() !== was) apply();
}

/** Called with the new state whenever low power turns on or off. Returns an unsubscribe. */
export function onPowerChange(cb: (low: boolean) => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

function apply(): void {
  const low = isLowPower();
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('is-low-power', low);
  }
  for (const cb of listeners) cb(low);
}
