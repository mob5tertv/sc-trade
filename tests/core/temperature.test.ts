import { describe, expect, it } from 'vitest';
import { temperature } from '../../src/core/temperature';

const th = { hotMin: 60, warmMin: 180, coolingMin: 240 };
const now = 1_000_000;
const min = 60;

describe('temperature', () => {
  it.each([
    [0, 'hot'], [59 * min + 59, 'hot'], [60 * min, 'warm'], [179 * min + 59, 'warm'],
    [180 * min, 'cooling'], [240 * min, 'cooling'], [240 * min + 1, 'cold'],
  ])('age %i s → %s', (age, temp) => expect(temperature(now - age, now, th, null)).toBe(temp));

  it('server change cools older data only', () => {
    expect(temperature(now - 1200, now, th, now - 600)).toBe('cold');
    expect(temperature(now - 300, now, th, now - 600)).toBe('hot');
  });

  it('treats a future timestamp as fresh', () => expect(temperature(now + 500, now, th, null)).toBe('hot'));

  it('keeps data from the very moment of the server change', () => {
    expect(temperature(now - 600, now, th, now - 600)).toBe('hot');
  });

  it('follows custom thresholds', () => {
    const custom = { hotMin: 5, warmMin: 10, coolingMin: 20 };
    expect(temperature(now - 4 * min, now, custom, null)).toBe('hot');
    expect(temperature(now - 5 * min, now, custom, null)).toBe('warm');
    expect(temperature(now - 20 * min, now, custom, null)).toBe('cooling');
    expect(temperature(now - 21 * min, now, custom, null)).toBe('cold');
  });
});
