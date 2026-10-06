import { describe, expect, it } from 'vitest';
import { DEFAULT_REFILL_FULL_MIN, MIN_LEARN_GAP_SEC, estimateStock, learnRatePerMin, maxSeenScu } from '../../src/core/stock';

const h = (...p: Array<[number, number | null]>) => p.map(([ts, scu]) => ({ ts, scu }));

describe('learnRatePerMin', () => {
  it('learns the fastest refill seen between neighbouring readings', () => {
    expect(learnRatePerMin(h([0, 40], [600, 140], [1200, 150]))).toBe(10);       // +100 in 10 min and +10 in 10 min
  });

  it('ignores drops, unknown readings and readings closer than two minutes', () => {
    expect(learnRatePerMin(h([0, 300], [600, 40]))).toBeNull();
    expect(learnRatePerMin(h([0, 40], [600, null], [1200, 100]))).toBeNull();
    expect(learnRatePerMin(h([0, 40], [119, 100]))).toBeNull();
    expect(learnRatePerMin(h([0, 40], [120, 100]))).toBe(30);
    expect(learnRatePerMin([])).toBeNull();
  });

  it('ignores a reading that did not grow and a single reading', () => {
    expect(learnRatePerMin(h([0, 40], [600, 40]))).toBeNull();
    expect(learnRatePerMin(h([0, 40]))).toBeNull();
  });

  it('learns from a known empty stock', () => {
    expect(learnRatePerMin(h([0, 0], [600, 50]))).toBe(5);
  });

  it('keeps the fastest pair, not the first or the last', () => {
    expect(learnRatePerMin(h([0, 0], [600, 20], [1200, 220], [1800, 230]))).toBe(20);
  });
});

describe('maxSeenScu', () => {
  it('reports the largest known reading, zero included', () => {
    expect(maxSeenScu(h([0, 40], [1, null], [2, 340]))).toBe(340);
    expect(maxSeenScu(h([0, 0]))).toBe(0);
    expect(maxSeenScu(h([0, null]))).toBeNull();
    expect(maxSeenScu([])).toBeNull();
  });
});

describe('estimateStock', () => {
  const base = { baseScu: 40, baseTs: 1000, now: 1000 + 20 * 60, maxScu: 340, learnedRatePerMin: null, refillFullMin: 75 };

  it('falls back to max / full-refill time while no rate is learned', () => {
    expect(estimateStock(base)).toEqual({ scu: 130, baseScu: 40, baseAgeSec: 1200, ratePerMin: 340 / 75, rateSource: 'default', maxScu: 340 });
  });

  it('uses the learned rate and never exceeds the maximum', () => {
    expect(estimateStock({ ...base, learnedRatePerMin: 10 })).toMatchObject({ scu: 240, rateSource: 'learned', ratePerMin: 10 });
    expect(estimateStock({ ...base, learnedRatePerMin: 10, now: 1000 + 60 * 60 }).scu).toBe(340);
  });

  it('keeps the base when nothing is known, and grows without a cap when only the rate is', () => {
    expect(estimateStock({ ...base, maxScu: null })).toMatchObject({ scu: 40, rateSource: 'none', ratePerMin: 0, maxScu: null });
    expect(estimateStock({ ...base, maxScu: null, learnedRatePerMin: 10 }).scu).toBe(240);
  });

  it('treats a base above the known maximum as the new maximum, and a clock running backwards as no time passed', () => {
    expect(estimateStock({ ...base, baseScu: 400 })).toMatchObject({ scu: 400, maxScu: 400 });
    expect(estimateStock({ ...base, now: 500 })).toMatchObject({ scu: 40, baseAgeSec: 0 });
  });

  it('starts from a known empty stock', () => {
    expect(estimateStock({ ...base, baseScu: 0, learnedRatePerMin: 10 }).scu).toBe(200);
  });

  it('has no fallback rate when the full-refill time is not positive', () => {
    expect(estimateStock({ ...base, refillFullMin: 0 })).toMatchObject({ scu: 40, rateSource: 'none', ratePerMin: 0, maxScu: 340 });
  });

  it('rounds the estimate down to a whole number', () => {
    expect(estimateStock({ ...base, learnedRatePerMin: 0.07 }).scu).toBe(41);   // 40 + 1.4
  });

  it('exports the documented constants', () => {
    expect(MIN_LEARN_GAP_SEC).toBe(120);
    expect(DEFAULT_REFILL_FULL_MIN).toBe(75);
  });
});
