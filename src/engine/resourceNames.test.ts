import { describe, expect, it } from 'vitest';
import { RESOURCES, RESOURCE_NAME, resourceId, resourceWord } from './constants';
import { describeBundle, describeCards } from './rules/text';

describe('resource display names (#47)', () => {
  it('wool shows as Sheep and grain as Wheat; ids are untouched', () => {
    expect(RESOURCE_NAME.wool).toBe('Sheep');
    expect(RESOURCE_NAME.grain).toBe('Wheat');
    expect(RESOURCES).toEqual(['brick', 'lumber', 'wool', 'grain', 'ore']);
    expect(resourceWord('wool')).toBe('sheep');
    expect(resourceWord('cloth')).toBe('cloth');
  });

  it('resourceId reads ids, new names and old log words', () => {
    expect(resourceId('sheep')).toBe('wool');
    expect(resourceId('Wheat')).toBe('grain');
    expect(resourceId('wool')).toBe('wool');
    expect(resourceId('grain')).toBe('grain');
    expect(resourceId('fish')).toBeNull();
  });

  it('log helpers use the display names', () => {
    expect(describeBundle({ wool: 2, grain: 1 })).toBe('2 sheep, 1 wheat');
    expect(describeCards(['grain', 'ore', 'grain'])).toBe('2 wheat, 1 ore');
  });
});
