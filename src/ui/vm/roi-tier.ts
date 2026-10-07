// How good a trip is at a glance: its ROI (a ratio, 0.15 is 15%) cut into five tiers. The interface colours the
// bar at the edge of an option and its ROI number by the tier (theme tokens `--sc-roi-<tier>`).

export type RoiTier = 'great' | 'good' | 'ok' | 'poor' | 'loss';

/** The lower bound of each tier except the last, best tier first. A ratio below zero is a loss. */
export const ROI_TIERS: ReadonlyArray<{ tier: Exclude<RoiTier, 'loss'>; min: number }> = [
  { tier: 'great', min: 0.3 },
  { tier: 'good', min: 0.15 },
  { tier: 'ok', min: 0.05 },
  { tier: 'poor', min: 0 },
];

/** A ratio that is not a number (nothing was invested, say) is the quiet tier: it is neither good nor bad news. */
export function roiTier(roi: number): RoiTier {
  if (Number.isNaN(roi)) return 'poor';
  for (const { tier, min } of ROI_TIERS) {
    if (roi >= min) return tier;
  }
  return 'loss';
}
