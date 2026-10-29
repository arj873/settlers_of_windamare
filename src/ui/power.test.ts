// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  initPower,
  isLowPower,
  loadPowerSetting,
  lowPowerFor,
  onPowerChange,
  POWER_KEY,
  POWER_SLOW_KEY,
  powerSetting,
  reportSlowDevice,
  setPowerSetting,
  weakHardware,
} from './power';

function memoryStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    map: m,
  };
}

const GOOD = { hardwareConcurrency: 8, deviceMemory: 8 };

describe('weakHardware (s17)', () => {
  it('flags little memory, two cores, or four cores with 4 GB', () => {
    expect(weakHardware({ hardwareConcurrency: 8, deviceMemory: 2 })).toBe(true);
    expect(weakHardware({ hardwareConcurrency: 2 })).toBe(true);
    expect(weakHardware({ hardwareConcurrency: 4, deviceMemory: 4 })).toBe(true);
  });

  it('keeps good or unknown hardware on high quality', () => {
    expect(weakHardware(GOOD)).toBe(false);
    expect(weakHardware({ hardwareConcurrency: 4, deviceMemory: 8 })).toBe(false);
    expect(weakHardware({ hardwareConcurrency: 4 })).toBe(false); // Safari / Firefox: no memory
    expect(weakHardware({})).toBe(false);
  });
});

describe('Performance setting (s17)', () => {
  it('maps a setting and the device verdict to low power', () => {
    expect(lowPowerFor('low', false)).toBe(true);
    expect(lowPowerFor('high', true)).toBe(false);
    expect(lowPowerFor('auto', true)).toBe(true);
    expect(lowPowerFor('auto', false)).toBe(false);
  });

  it('reads a saved setting, Auto when missing or unknown', () => {
    expect(loadPowerSetting(memoryStorage({ [POWER_KEY]: 'low' }))).toBe('low');
    expect(loadPowerSetting(memoryStorage({ [POWER_KEY]: 'turbo' }))).toBe('auto');
    expect(loadPowerSetting(null)).toBe('auto');
  });

  it('Auto follows the hardware, then the frame-rate verdict, which is remembered', () => {
    const store = memoryStorage();
    initPower(GOOD, store);
    expect(powerSetting()).toBe('auto');
    expect(isLowPower()).toBe(false);
    expect(document.documentElement.classList.contains('is-low-power')).toBe(false);
    const seen: boolean[] = [];
    const off = onPowerChange((low) => seen.push(low));
    reportSlowDevice();
    expect(isLowPower()).toBe(true);
    expect(document.documentElement.classList.contains('is-low-power')).toBe(true);
    expect(store.map.get(POWER_SLOW_KEY)).toBe('1');
    reportSlowDevice(); // once only
    off();
    expect(seen).toEqual([true]);
    // Next page load: low power from the start.
    initPower(GOOD, store);
    expect(isLowPower()).toBe(true);
  });

  it('High quality wins over a slow verdict; picking Auto again forgets it', () => {
    const store = memoryStorage({ [POWER_SLOW_KEY]: '1' });
    initPower(GOOD, store);
    expect(isLowPower()).toBe(true);
    setPowerSetting('high');
    expect(isLowPower()).toBe(false);
    expect(store.map.get(POWER_KEY)).toBe('high');
    setPowerSetting('auto');
    expect(isLowPower()).toBe(false); // jsdom's navigator: no weak hints
    setPowerSetting('low');
    expect(isLowPower()).toBe(true);
    expect(document.documentElement.classList.contains('is-low-power')).toBe(true);
  });
});
