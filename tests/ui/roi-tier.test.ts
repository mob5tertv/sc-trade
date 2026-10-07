import { describe, expect, it } from 'vitest';
import { ROI_TIERS, roiTier } from '../../src/ui/vm/roi-tier';

describe('roiTier', () => {
  it('cuts a ratio into five tiers at 30, 15, 5 and 0 percent', () => {
    expect(roiTier(0.62)).toBe('great');
    expect(roiTier(0.3)).toBe('great');
    expect(roiTier(0.2999)).toBe('good');
    expect(roiTier(0.15)).toBe('good');
    expect(roiTier(0.1499)).toBe('ok');
    expect(roiTier(0.05)).toBe('ok');
    expect(roiTier(0.0499)).toBe('poor');
    expect(roiTier(0)).toBe('poor');
    expect(roiTier(-0.0001)).toBe('loss');
    expect(roiTier(-0.5)).toBe('loss');
  });

  it('exports the thresholds it cuts at, best tier first', () => {
    expect(ROI_TIERS).toEqual([
      { tier: 'great', min: 0.3 }, { tier: 'good', min: 0.15 }, { tier: 'ok', min: 0.05 }, { tier: 'poor', min: 0 },
    ]);
  });

  it('never throws: a ratio that is not a number is the quiet tier', () => {
    expect(roiTier(Number.NaN)).toBe('poor');
    expect(roiTier(Number.POSITIVE_INFINITY)).toBe('great');
    expect(roiTier(Number.NEGATIVE_INFINITY)).toBe('loss');
  });
});
