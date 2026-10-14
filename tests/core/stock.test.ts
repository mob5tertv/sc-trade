import { describe, expect, it } from 'vitest';
import { DEFAULT_REFILL_FULL_MIN, MAX_LEARN_GAP_SEC, MIN_LEARN_GAP_SEC, estimateStock, learnRatePerMin, maxSeenScu } from '../../src/core/stock';

const h = (...p: Array<[number, number | null]>) => p.map(([ts, scu]) => ({ ts, scu }));

describe('learnRatePerMin', () => {
  it('learns the average refill over a stretch where the stock only grew, not its fastest pair', () => {
    expect(learnRatePerMin(h([0, 40], [600, 140], [1200, 150]))).toBe(5.5);      // +110 in 20 min; the fastest pair alone would say 10
  });

  it('reads the measurement of 14.10.2026 as 14.7 a minute, not as the 35 of its first five minutes', () => {
    // Deakins, Medical Supplies: 158 at 02:49:27, 318 at 02:54, 438 at 03:08:30, still 438 at 03:13:30
    const rate = learnRatePerMin(h([0, 158], [273, 318], [1143, 438], [1443, 438]))!;
    expect(rate).toBeCloseTo(280 / (1143 / 60), 6);                              // the stand after the last growth is a full store: not counted
    expect(rate).toBeLessThan(15);
  });

  it('counts the stands between two steps of the refill: the game refills in steps', () => {
    // +40 every four minutes, read every two minutes: 80 in eight minutes
    expect(learnRatePerMin(h([0, 120], [120, 120], [240, 160], [360, 160], [480, 200]))).toBe(10);
  });

  it('ends a stretch where the stock fell (somebody bought) and joins what the stretches say', () => {
    // 100 → 200 in ten minutes, then the stock is bought out; 0 → 60 in ten minutes
    expect(learnRatePerMin(h([0, 100], [600, 200], [720, 0], [1320, 60]))).toBe(8);   // 160 in 20 min
  });

  it('takes two readings farther apart than half an hour for no measure: the store may have stood full', () => {
    expect(learnRatePerMin(h([0, 100], [MAX_LEARN_GAP_SEC + 1, 400]))).toBeNull();
    expect(learnRatePerMin(h([0, 100], [MAX_LEARN_GAP_SEC, 400]))).toBe(10);
    // a day apart, then a real measure: only the measure counts
    expect(learnRatePerMin(h([0, 100], [86_400, 300], [86_400 + 600, 350]))).toBe(5);
  });

  it('takes a reading typed again within two minutes for a correction of the one before it', () => {
    expect(learnRatePerMin(h([0, 158], [5, 518], [600, 618]))).toBe(10);         // 518 was meant: 100 in ten minutes
    expect(learnRatePerMin(h([0, 518], [5, 158], [600, 258]))).toBe(10);
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

  it('is one number for the whole stretch: 230 in half an hour, whatever its pairs say one by one', () => {
    expect(learnRatePerMin(h([0, 0], [600, 20], [1200, 220], [1800, 230]))).toBeCloseTo(230 / 30, 6);
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
