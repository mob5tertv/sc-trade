import type { Temp, TempThresholds } from './types';

const SEC_PER_MIN = 60;

/**
 * How fresh an own price observation is, from its age `now − ts` (Unix seconds).
 * Under `hotMin` minutes it is hot, under `warmMin` warm, up to and including `coolingMin` cooling,
 * older cold. A negative age counts as zero. Data older than the last server change
 * (`ts < serverChangedAt`) is cold whatever its age.
 */
export function temperature(ts: number, now: number, th: TempThresholds, serverChangedAt: number | null): Temp {
  if (serverChangedAt !== null && ts < serverChangedAt) return 'cold';
  const age = Math.max(0, now - ts);
  if (age < th.hotMin * SEC_PER_MIN) return 'hot';
  if (age < th.warmMin * SEC_PER_MIN) return 'warm';
  if (age <= th.coolingMin * SEC_PER_MIN) return 'cooling';
  return 'cold';
}
