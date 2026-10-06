import { pricesAreStale, referenceIsStale } from '../../data/sync';

// The marks `src/data/sync.ts` leaves in `uex_meta` (it keeps the names to itself).
export const META_REFERENCE_SYNCED_AT = 'reference_synced_at';
export const META_PRICES_SYNCED_AT = 'prices_synced_at';

/** A meta value holding Unix seconds, or null when it is missing or not a number. */
export function metaSeconds(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : null;
}

export interface SyncPlan { reference: boolean; prices: boolean }

/**
 * What the start has to download: the reference when it is older than a day, the prices when they are
 * older than an hour. A missing mark counts as stale; the schema migration deletes the price mark on
 * purpose to force a new download.
 */
export function syncPlan(referenceSyncedAt: string | null, pricesSyncedAt: string | null, now: number): SyncPlan {
  return {
    reference: referenceIsStale(metaSeconds(referenceSyncedAt), now),
    prices: pricesAreStale(metaSeconds(pricesSyncedAt), now),
  };
}
