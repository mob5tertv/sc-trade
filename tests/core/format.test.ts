import { describe, expect, it } from 'vitest';
import { formatAge, formatCompact, formatDuration, formatPct, formatUec } from '../../src/core/format';

describe('format', () => {
  it('formatUec', () => { expect(formatUec(6120)).toBe('6 120'); expect(formatUec(318)).toBe('318'); expect(formatUec(1234567)).toBe('1 234 567'); });
  it('formatUec handles zero, negatives and fractions', () => {
    expect(formatUec(0)).toBe('0');
    expect(formatUec(-95200)).toBe('-95 200');
    expect(formatUec(6119.6)).toBe('6 120');
  });
  it.each([[612, '612'], [936000, '936k'], [1250000, '1,25M'], [999950, '1M'], [-95200, '-95k']])('formatCompact(%i)', (n, s) => expect(formatCompact(n)).toBe(s));
  it.each([[0, '0'], [999, '999'], [999.6, '1k'], [1000, '1k'], [2000000, '2M'], [12300000, '12,3M'], [-0.2, '0']])('formatCompact(%f) at the edges', (n, s) => expect(formatCompact(n)).toBe(s));
  it('formatPct', () => expect(formatPct(0.12745)).toBe('12,7%'));
  it.each([[0, '0,0%'], [1, '100,0%'], [-0.05, '-5,0%'], [-0.0001, '0,0%']])('formatPct(%f) at the edges', (r, s) => expect(formatPct(r)).toBe(s));
  it.each([[30, 'сейчас'], [2400, '40 мин'], [3599, '59 мин'], [3600, '1 ч'], [5400, '1,5 ч'], [12600, '3,5 ч'], [172800, '2 д']])('formatAge(%i)', (s, t) => expect(formatAge(s)).toBe(t));
  it.each([[0, 'сейчас'], [59, 'сейчас'], [60, '1 мин'], [5399, '1 ч'], [86399, '23,5 ч'], [86400, '1 д'], [129600, '1 д'], [-10, 'сейчас']])('formatAge(%i) at the edges', (s, t) => expect(formatAge(s)).toBe(t));
  it.each([[5, '0:05'], [872, '14:32'], [3872, '1:04:32']])('formatDuration(%i)', (s, t) => expect(formatDuration(s)).toBe(t));
  it.each([[0, '0:00'], [59, '0:59'], [3599, '59:59'], [3600, '1:00:00'], [-5, '0:00']])('formatDuration(%i) at the edges', (s, t) => expect(formatDuration(s)).toBe(t));
});
