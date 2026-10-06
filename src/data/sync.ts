import { distKey, type Commodity, type StarSystem, type Terminal, type Vehicle } from '../core/types';
import type { Db } from './db';
import type { Logger } from './logger';
import {
  getMeta, loadDistances, putDistances, saveReference, setMeta, upsertPrices, upsertVehicles,
} from './repo/uex-cache';
import type { UexClient } from './uex-client';

// Fills the local UEX cache. The network is throttled (see the amendment "UEX over a throttled
// network"): a response of more than ~24 KB stalls, so lists are requested in small pieces and
// strictly one request at a time. Failures of UEX never abort a run half-way unless the
// documented contract says so; a failure of the local database always propagates.

export interface SyncDeps { db: Db; uex: UexClient; log: Logger; now: () => number }

const REFERENCE_MAX_AGE_SEC = 24 * 3600;
const PRICES_MAX_AGE_SEC = 60 * 60;
/** An origin whose routes were requested is not asked again for this long, even when the request failed. */
const ROUTES_MAX_AGE_SEC = 24 * 3600;
/** Terminals per price request: the largest batch that reliably fits into one response. */
const PRICE_BATCH_SIZE = 2;
/** Pair requests per `ensureDistances` call, so a screen of routes never waits for a long series of requests. */
const MAX_PAIR_REQUESTS = 20;

const META_REFERENCE = 'reference_synced_at';
const META_PRICES = 'prices_synced_at';
const metaRoutesFetched = (originId: number) => `routes_fetched:${originId}`;

const isStale = (syncedAt: number | null, now: number, maxAge: number): boolean => syncedAt === null || now - syncedAt > maxAge;

export const referenceIsStale = (syncedAt: number | null, now: number): boolean => isStale(syncedAt, now, REFERENCE_MAX_AGE_SEC);
export const pricesAreStale = (syncedAt: number | null, now: number): boolean => isStale(syncedAt, now, PRICES_MAX_AGE_SEC);

/** A meta value holding Unix seconds, or null when it is missing or not a number. */
function parseSeconds(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : null;
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

type Attempt<T> = { ok: true; value: T } | { ok: false };

/** Runs one UEX request that may fail without failing the run: a failure is logged as a warning. */
async function attempt<T>(d: SyncDeps, what: string, ctx: object, call: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (err) {
    d.log.warn('sync', `${what} failed`, { ...ctx, reason: reason(err) });
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

/** Vehicles of every manufacturer. `complete` is false when any request failed: then the list is only a part. */
async function fetchVehicles(d: SyncDeps): Promise<{ list: Vehicle[]; complete: boolean }> {
  const manufacturers = await attempt(d, 'vehicle manufacturers request', {}, () => d.uex.vehicleManufacturers());
  if (!manufacturers.ok) return { list: [], complete: false };

  const list: Vehicle[] = [];
  let complete = true;
  for (const companyId of manufacturers.value) {
    const vehicles = await attempt(d, 'vehicles request', { companyId }, () => d.uex.vehicles(companyId));
    if (vehicles.ok) list.push(...vehicles.value);
    else complete = false;
  }
  return { list, complete };
}

/** Star systems, the terminals of every live star system and commodities; any failure throws. */
async function fetchCoreLists(d: SyncDeps): Promise<{ starSystems: StarSystem[]; terminals: Terminal[]; commodities: Commodity[] }> {
  const starSystems = await d.uex.starSystems();
  const terminals: Terminal[] = [];
  for (const system of starSystems) {
    if (system.isAvailableLive) terminals.push(...(await d.uex.terminals(system.id)));
  }
  const commodities = await d.uex.commodities();
  return { starSystems, terminals, commodities };
}

/**
 * Downloads star systems, the terminals of every live star system, commodities and vehicles, and only
 * then writes. A failure of the first three throws the `UexError` and writes nothing; a failure of the
 * vehicles is a warning: what arrived is saved and no stored vehicle is deleted.
 */
export async function syncReference(d: SyncDeps): Promise<void> {
  const { db, log } = d;
  const syncedAt = d.now();
  log.info('sync', 'reference sync started');

  let core: Awaited<ReturnType<typeof fetchCoreLists>>;
  try {
    core = await fetchCoreLists(d);
  } catch (err) {
    log.error('sync', 'reference sync failed, nothing was written', { reason: reason(err) });
    throw err;
  }
  const { starSystems, terminals, commodities } = core;
  const vehicles = await fetchVehicles(d);

  await saveReference(db, { ...core, ...(vehicles.complete ? { vehicles: vehicles.list } : {}) });
  if (!vehicles.complete) await upsertVehicles(db, vehicles.list);
  await setMeta(db, META_REFERENCE, String(syncedAt));

  log.info('sync', 'reference sync finished', {
    starSystems: starSystems.length,
    terminals: terminals.length,
    commodities: commodities.length,
    vehicles: vehicles.list.length,
    vehiclesComplete: vehicles.complete,
  });
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/** Fetches the prices of `terminalIds` and stores them; false when the request failed. */
async function fetchAndStorePrices(d: SyncDeps, terminalIds: number[], syncedAt: number): Promise<boolean> {
  const prices = await attempt(d, 'price request', { terminalIds }, () => d.uex.prices(terminalIds));
  if (!prices.ok) return false;
  await upsertPrices(d.db, terminalIds, prices.value, syncedAt);
  return true;
}

/**
 * One batch of terminals. When its request fails it is repeated once terminal by terminal; the result
 * lists the terminals that could not be fetched even alone (their stored rows stay as they are).
 */
async function syncPriceBatch(d: SyncDeps, batch: number[], syncedAt: number): Promise<number[]> {
  if (await fetchAndStorePrices(d, batch, syncedAt)) return [];
  // A batch of one terminal would repeat the very same request.
  if (batch.length === 1) return batch;

  d.log.warn('sync', 'price batch failed, retrying one terminal at a time', { terminalIds: batch });
  const unresolved: number[] = [];
  for (const terminalId of batch) {
    if (!(await fetchAndStorePrices(d, [terminalId], syncedAt))) unresolved.push(terminalId);
  }
  return unresolved;
}

/**
 * Refreshes the prices of every live terminal, two terminals per request. Never throws because of UEX;
 * `failed` counts the batches with a terminal that could not be fetched even alone, and only a run
 * without such a batch marks the prices fresh.
 */
export async function syncPrices(d: SyncDeps): Promise<{ batches: number; failed: number }> {
  const { db, log } = d;
  const syncedAt = d.now();
  const terminalIds = (await db.select<{ id: number }>('SELECT id FROM uex_terminal WHERE is_available_live = 1 ORDER BY id'))
    .map((r) => r.id);
  log.info('sync', 'prices sync started', { terminals: terminalIds.length });

  // Nothing was fetched, so there is nothing to call fresh.
  if (terminalIds.length === 0) {
    log.warn('sync', 'prices sync skipped: no live terminals in the cache');
    return { batches: 0, failed: 0 };
  }

  let batches = 0;
  let failed = 0;
  for (let i = 0; i < terminalIds.length; i += PRICE_BATCH_SIZE) {
    const batch = terminalIds.slice(i, i + PRICE_BATCH_SIZE);
    const unresolved = await syncPriceBatch(d, batch, syncedAt);
    batches++;
    if (unresolved.length > 0) {
      failed++;
      log.warn('sync', 'price batch incomplete, old rows kept', { batch: batches, terminalIds: batch, unresolved });
    } else {
      log.info('sync', 'price batch done', { batch: batches, terminalIds: batch });
    }
  }

  if (failed === 0) await setMeta(db, META_PRICES, String(syncedAt));
  const end = { batches, failed, terminals: terminalIds.length };
  if (failed === 0) log.info('sync', 'prices sync finished', end);
  else log.warn('sync', 'prices sync finished with failures', end);
  return { batches, failed };
}

// ---------------------------------------------------------------------------
// Distances
// ---------------------------------------------------------------------------

/**
 * Makes the distance cache as complete as it can cheaply be for `pairs`: one `distancesFrom(originId)` request
 * (not repeated for a day, whether it succeeded or not: hub terminals may stall), then at most twenty
 * single-pair requests for the pairs that are still unknown. Never throws because of UEX; returns the cache.
 */
export async function ensureDistances(
  d: SyncDeps,
  originId: number,
  pairs: Array<[number, number]>,
): Promise<Map<string, number | null>> {
  const { db, uex, log } = d;
  const now = d.now();

  const routesKey = metaRoutesFetched(originId);
  if (isStale(parseSeconds(await getMeta(db, routesKey)), now, ROUTES_MAX_AGE_SEC)) {
    const routes = await attempt(d, 'routes request', { originId }, () => uex.distancesFrom(originId));
    if (routes.ok) {
      await putDistances(db, routes.value.map(({ destId, gm }) => ({ a: originId, b: destId, gm })));
      log.info('sync', 'routes stored', { originId, destinations: routes.value.length });
    }
    // Remembered also after a failure, so a stalling hub is not asked again at every call.
    await setMeta(db, routesKey, String(now));
  }

  const distances = await loadDistances(db);
  const missing: Array<[number, number]> = [];
  const queued = new Set<string>();
  for (const [a, b] of pairs) {
    if (missing.length >= MAX_PAIR_REQUESTS) break;
    const key = distKey(a, b);
    if (a === b || distances.has(key) || queued.has(key)) continue;
    queued.add(key);
    missing.push([a, b]);
  }

  const found: Array<{ a: number; b: number; gm: number | null }> = [];
  for (const [a, b] of missing) {
    const answer = await attempt(d, 'distance request', { a, b }, () => uex.distance(a, b));
    if (!answer.ok) {
      // A failure is most likely the network, not this pair: do not wait for the next timeouts.
      log.warn('sync', 'distance requests stopped after a failure', { originId, asked: found.length + 1, planned: missing.length });
      break;
    }
    found.push({ a, b, gm: answer.value });
    distances.set(distKey(a, b), answer.value);
  }
  await putDistances(db, found);
  log.info('sync', 'distances ensured', { originId, pairs: pairs.length, requested: found.length, planned: missing.length });
  return distances;
}
