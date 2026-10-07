import { pricesAreStale, referenceIsStale } from '../../data/sync';

// The marks `src/data/sync.ts` leaves in `uex_meta` (it keeps the names to itself).
export const META_REFERENCE_SYNCED_AT = 'reference_synced_at';
export const META_PRICES_SYNCED_AT = 'prices_synced_at';

/** A sync that fills a cache with no price of UEX in it reads the market again after every this many batches. */
export const FIRST_SYNC_RELOAD_EVERY = 10;

/**
 * Whether the price sync that has just finished the batch `progress.done` of `progress.total` is to have the market read again
 * now, so that the tables show what has come (the first launch: ~70 requests, and a table that says "Нет цен" until the last one).
 * Only a sync that STARTED with no price of UEX in the cache does it; every other sync reads the market once, at its end, as does
 * this one (so not at the last batch).
 */
export function reloadsMidSync(startedEmpty: boolean, progress: { done: number; total: number }): boolean {
  const { done, total } = progress;
  return startedEmpty && done > 0 && done < total && done % FIRST_SYNC_RELOAD_EVERY === 0;
}

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
