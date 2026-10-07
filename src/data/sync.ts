import { distKey, type Commodity, type StarSystem, type Terminal, type UexPrice, type Vehicle } from '../core/types';
import type { Db } from './db';
import type { Logger } from './logger';
import { NETWORK_FAILURES_IN_A_ROW, Outage } from './outage';
import {
  getMeta, loadDistances, putDistances, saveReference, setMeta, upsertPrices, upsertVehicles,
} from './repo/uex-cache';
import { isRateLimit, isUnreachable, UexError, type UexClient } from './uex-client';

// Fills the local UEX cache. The network is throttled (see the amendment "UEX over a throttled
// network"): a response of more than ~24 KB stalls, so lists are requested in small pieces and
// strictly one request at a time. Failures of UEX never abort a run half-way unless the
// documented contract says so; a failure of the local database always propagates. A series of
// many requests (prices, vehicles) gives up when the network fails three times in a row (`outage.ts`):
// on a dead network every further request would cost the whole timeout and hold the queue of UEX.

export interface SyncDeps { db: Db; uex: UexClient; log: Logger; now: () => number }

const REFERENCE_MAX_AGE_SEC = 24 * 3600;
const PRICES_MAX_AGE_SEC = 60 * 60;
/** An origin whose routes request FAILED is not asked again for this long; a fetched origin is never asked again. */
const ROUTES_RETRY_AFTER_SEC = 24 * 3600;
/** The `routes_fetched:<id>` value of an origin whose routes were stored; after a failure it holds the attempt time. */
const ROUTES_FETCHED = 'ok';
/** Terminals per price request: the largest batch that reliably fits into one response. */
const PRICE_BATCH_SIZE = 2;
/** Pair requests per `ensureDistances` call, so a screen of routes never waits for a long series of requests. */
const MAX_PAIR_REQUESTS = 20;

const META_REFERENCE = 'reference_synced_at';
const META_PRICES = 'prices_synced_at';
const metaRoutesFetched = (originId: number) => `routes_fetched:${originId}`;

/** The two reasons for a series of requests to stop short, as the log tells them. */
const NETWORK_DEAD = `the network failed ${NETWORK_FAILURES_IN_A_ROW} times in a row`;
const LIMIT_REACHED = 'UEX request limit reached (HTTP 429), asking again later';

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

type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Runs one UEX request that may fail without failing the run: a failure is logged as a warning. */
async function attempt<T>(d: SyncDeps, what: string, ctx: object, call: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (err) {
    d.log.warn('sync', `${what} failed`, { ...ctx, reason: reason(err) });
    return { ok: false, error: err };
  }
}

/** Tells `outage` how a request of the series ended. */
function note(outage: Outage, result: Attempt<unknown>): void {
  if (result.ok) outage.reached();
  else outage.failed(result.error);
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

/**
 * Vehicles of every manufacturer. `complete` is false when any request failed: then the list is only a part. The series
 * gives up when the network fails three times in a row: the manufacturers that were not asked count as failed.
 */
async function fetchVehicles(d: SyncDeps): Promise<{ list: Vehicle[]; complete: boolean }> {
  const manufacturers = await attempt(d, 'vehicle manufacturers request', {}, () => d.uex.vehicleManufacturers());
  if (!manufacturers.ok) return { list: [], complete: false };

  const list: Vehicle[] = [];
  const outage = new Outage();
  let complete = true;
  let asked = 0;
  for (const companyId of manufacturers.value) {
    if (outage.over) break;
    const vehicles = await attempt(d, 'vehicles request', { companyId }, () => d.uex.vehicles(companyId));
    asked++;
    note(outage, vehicles);
    if (vehicles.ok) list.push(...vehicles.value);
    else complete = false;
  }
  if (asked < manufacturers.value.length) {
    complete = false;
    d.log.warn('sync', outage.limited ? `vehicles sync stopped: ${LIMIT_REACHED}` : `vehicles sync gave up: ${NETWORK_DEAD}`, {
      manufacturers: manufacturers.value.length, asked,
    });
  }
  // An answer without a single vehicle is not trusted: it would wipe the stored vehicles.
  if (list.length === 0) {
    d.log.warn('sync', 'no vehicles received, keeping the stored ones', { manufacturers: manufacturers.value.length });
    return { list, complete: false };
  }
  return { list, complete };
}

/**
 * Star systems, the terminals of every live star system and commodities; any failure throws. An empty
 * answer where data must exist (no star system, no live one, no terminal at all, no commodity) is
 * a failure too: written as it is, it would wipe the stored reference.
 */
async function fetchCoreLists(d: SyncDeps): Promise<{ starSystems: StarSystem[]; terminals: Terminal[]; commodities: Commodity[] }> {
  const starSystems = await d.uex.starSystems();
  if (starSystems.length === 0) throw new UexError('shape', 'UEX returned no star systems');
  const liveSystems = starSystems.filter((s) => s.isAvailableLive);
  if (liveSystems.length === 0) throw new UexError('shape', 'UEX returned no live star system');

  const terminals: Terminal[] = [];
  for (const system of liveSystems) terminals.push(...(await d.uex.terminals(system.id)));
  if (terminals.length === 0) throw new UexError('shape', 'UEX returned no terminals for the live star systems');

  const commodities = await d.uex.commodities();
  if (commodities.length === 0) throw new UexError('shape', 'UEX returned no commodities');
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

/**
 * Fetches the prices of `terminalIds` and stores them; `error` is what the request failed with. A failure of the network
 * (or the limit of requests) is not logged here: the client has written it, and the sync says it once, when the run ends.
 */
async function fetchAndStorePrices(
  d: SyncDeps, terminalIds: number[], syncedAt: number, outage: Outage,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  let prices: UexPrice[];
  try {
    prices = await d.uex.prices(terminalIds);
  } catch (err) {
    if (!isUnreachable(err)) d.log.warn('sync', 'price request failed', { terminalIds, reason: reason(err) });
    outage.failed(err);
    return { ok: false, error: err };
  }
  outage.reached();
  await upsertPrices(d.db, terminalIds, prices, syncedAt);
  return { ok: true };
}

/**
 * One batch of terminals. When its request fails because the SERVER refused it (an HTTP error, an unreadable answer) it
 * is repeated once terminal by terminal; when the NETWORK failed, or UEX asked to wait (429), it is not: the requests of
 * the single terminals would stall the same way, or only add to the load. The result lists the terminals that could not
 * be fetched even alone (their stored rows stay as they are).
 */
async function syncPriceBatch(d: SyncDeps, batch: number[], syncedAt: number, outage: Outage): Promise<number[]> {
  const first = await fetchAndStorePrices(d, batch, syncedAt, outage);
  if (first.ok) return [];
  // A batch of one terminal would repeat the very same request.
  if (batch.length === 1 || isUnreachable(first.error)) return batch;

  d.log.warn('sync', 'price batch failed, retrying one terminal at a time', { terminalIds: batch });
  const unresolved: number[] = [];
  for (const [i, terminalId] of batch.entries()) {
    // The limit may be met by a single request of the repeat: the rest of the batch is not asked.
    if (outage.over) {
      unresolved.push(...batch.slice(i));
      break;
    }
    if (!(await fetchAndStorePrices(d, [terminalId], syncedAt, outage)).ok) unresolved.push(terminalId);
  }
  return unresolved;
}

/**
 * How far one `syncPrices` run is, counted in price batches (two terminals each): a batch counts as done when it is
 * finished, fetched or not (its retry terminal by terminal belongs to it). When the run gives up on a dead network,
 * the batches that were never asked count as done at once, so the last report is still complete.
 */
export interface PriceProgress {
  /** Batches finished. */
  done: number;
  /** All the batches of this run; it does not change. */
  total: number;
}

/** What one `syncPrices` run did: `failed` is counted in batches, `unfetched` in terminals. */
export interface PriceSyncResult {
  /** All the batches of the run, those a dead network kept from being asked included. */
  batches: number;
  /** Batches with at least one terminal that could not be fetched even alone, or that were never asked. */
  failed: number;
  /** Terminals that could not be fetched (even alone) or were never asked: their stored rows stay as they were. */
  unfetched: number;
}

/**
 * Refreshes the prices of every live terminal, two terminals per request. Never throws because of UEX;
 * `failed` counts the batches with a terminal that could not be fetched even alone (`unfetched` counts those
 * terminals), and only a run without such a batch marks the prices fresh.
 *
 * A batch that failed because the network did (no answer, a timeout) is not repeated terminal by terminal: the single
 * requests would stall the same way; a batch the server refused is. After three failures of the network in a row (a request
 * that went through, or one the server answered with a refusal, starts the count again) the run gives up: the terminals
 * not asked yet are `unfetched`, and the log gets one warning about it instead of a line per batch.
 *
 * `onProgress` is called before the first request (`done: 0`) and after every batch; the last call is complete
 * (`done === total`). With no live terminal there is nothing to report and it is never called. A callback that
 * throws is logged and ignored, so the prices already fetched are never lost.
 */
export async function syncPrices(d: SyncDeps, onProgress?: (progress: PriceProgress) => void): Promise<PriceSyncResult> {
  const { db, log } = d;
  const syncedAt = d.now();
  const terminalIds = (await db.select<{ id: number }>('SELECT id FROM uex_terminal WHERE is_available_live = 1 ORDER BY id'))
    .map((r) => r.id);
  log.info('sync', 'prices sync started', { terminals: terminalIds.length });

  // Nothing was fetched, so there is nothing to call fresh.
  if (terminalIds.length === 0) {
    log.warn('sync', 'prices sync skipped: no live terminals in the cache');
    return { batches: 0, failed: 0, unfetched: 0 };
  }

  const total = Math.ceil(terminalIds.length / PRICE_BATCH_SIZE);
  const report = (done: number): void => {
    try {
      onProgress?.({ done, total });
    } catch (err) {
      log.warn('sync', 'progress callback failed', { reason: reason(err) });
    }
  };
  report(0);

  const outage = new Outage();
  let done = 0;
  let failed = 0;
  let unfetched = 0;
  let asked = 0; // terminals the run has gone through
  while (asked < terminalIds.length && !outage.over) {
    const batch = terminalIds.slice(asked, asked + PRICE_BATCH_SIZE);
    asked += batch.length;
    const unresolved = await syncPriceBatch(d, batch, syncedAt, outage);
    done++;
    if (unresolved.length > 0) {
      failed++;
      unfetched += unresolved.length;
      // A batch that ended in a failure of the network is already in the log (the client wrote it) and is counted at the end.
      if (outage.streak === 0) log.warn('sync', 'price batch incomplete, old rows kept', { batch: done, terminalIds: batch, unresolved });
    } else {
      log.info('sync', 'price batch done', { batch: done, terminalIds: batch });
    }
    report(done);
  }

  // The network is dead: the terminals that were not asked are unfetched, and the run is complete for the caller (N of N).
  const notAsked = terminalIds.length - asked;
  if (notAsked > 0) {
    failed += Math.ceil(notAsked / PRICE_BATCH_SIZE);
    unfetched += notAsked;
    report(total);
  }

  if (failed === 0) await setMeta(db, META_PRICES, String(syncedAt));
  const end = { batches: total, failed, unfetched, terminals: terminalIds.length };
  if (failed === 0) log.info('sync', 'prices sync finished', end);
  else if (outage.limited) log.warn('sync', `prices sync stopped: ${LIMIT_REACHED}`, { ...end, notAsked });
  else if (notAsked > 0) log.warn('sync', `prices sync gave up: ${NETWORK_DEAD}`, { ...end, notAsked });
  else log.warn('sync', 'prices sync finished with failures', end);
  return { batches: total, failed, unfetched };
}

// ---------------------------------------------------------------------------
// Distances
// ---------------------------------------------------------------------------

/** Whether the route list of `originId` is still to be asked: never fetched, and not tried within a day. */
async function routesAreDue(d: SyncDeps, originId: number, now: number): Promise<boolean> {
  const attempted = await getMeta(d.db, metaRoutesFetched(originId));
  return attempted !== ROUTES_FETCHED && isStale(parseSeconds(attempted), now, ROUTES_RETRY_AFTER_SEC);
}

/** The pairs to ask one by one: each unknown pair once, never a terminal with itself, at most `MAX_PAIR_REQUESTS`. */
function pairsToAsk(distances: Map<string, number | null>, pairs: Array<[number, number]>): Array<[number, number]> {
  const missing: Array<[number, number]> = [];
  const queued = new Set<string>();
  for (const [a, b] of pairs) {
    if (missing.length >= MAX_PAIR_REQUESTS) break;
    const key = distKey(a, b);
    if (a === b || distances.has(key) || queued.has(key)) continue;
    queued.add(key);
    missing.push([a, b]);
  }
  return missing;
}

/**
 * How many UEX requests `ensureDistances(d, originId, pairs)` would make now, at most, if the cache held
 * `distances`. Asks UEX nothing and reads only the one meta row of the route list; the caller has the table.
 */
export async function countDistanceRequests(
  d: SyncDeps, originId: number, pairs: Array<[number, number]>, distances: Map<string, number | null>,
): Promise<number> {
  const routes = await routesAreDue(d, originId, d.now());
  return (routes ? 1 : 0) + pairsToAsk(distances, pairs).length;
}

/**
 * How far one `ensureDistances` call is, counted in UEX requests: the route list and the single pairs, whether
 * they succeeded or not.
 */
export interface DistanceProgress {
  /** Requests finished. */
  done: number;
  /**
   * Requests finished plus those still to come. It never grows: it drops when the route list answers pairs
   * and when a failure stops the series.
   */
  total: number;
}

/**
 * Makes the distance cache as complete as it can cheaply be for `pairs`: one `distancesFrom(originId)` request
 * (never repeated once it succeeded, not repeated for a day after a failure: hub terminals may stall), then at most twenty
 * single-pair requests for the pairs that are still unknown (the first failure stops them; and when the route list is answered
 * with "too many requests" (429) there are none). Never throws because of UEX; returns the cache.
 *
 * `onProgress` is called with the plan before the first request and after every request; the last call is complete
 * (`done === total`). A callback that throws is logged and ignored, so what was fetched is never lost.
 */
export async function ensureDistances(
  d: SyncDeps,
  originId: number,
  pairs: Array<[number, number]>,
  onProgress?: (progress: DistanceProgress) => void,
): Promise<Map<string, number | null>> {
  const { db, uex, log } = d;
  const now = d.now();

  const routesDue = await routesAreDue(d, originId, now);
  // The table is read once: the route list is merged into this copy, as it is stored.
  const distances = await loadDistances(db);
  let missing = pairsToAsk(distances, pairs);
  let done = 0;
  let total = (routesDue ? 1 : 0) + missing.length;
  const report = (): void => {
    try {
      onProgress?.({ done, total });
    } catch (err) {
      log.warn('sync', 'progress callback failed', { originId, reason: reason(err) });
    }
  };
  report();

  if (routesDue) {
    const routes = await attempt(d, 'routes request', { originId }, () => uex.distancesFrom(originId));
    if (routes.ok) {
      await putDistances(db, routes.value.map(({ destId, gm }) => ({ a: originId, b: destId, gm })));
      // `putDistances` keeps no row of a terminal with itself either.
      for (const { destId, gm } of routes.value) if (destId !== originId) distances.set(distKey(originId, destId), gm);
      log.info('sync', 'routes stored', { originId, destinations: routes.value.length });
    }
    // A failure is remembered too, so a stalling hub is not asked again at every call.
    await setMeta(db, metaRoutesFetched(originId), routes.ok ? ROUTES_FETCHED : String(now));

    // A stalled route list falls back to the small pair requests; "too many requests" does not: UEX asked to wait.
    const limited = !routes.ok && isRateLimit(routes.error);
    if (limited) log.warn('sync', `distance requests stopped: ${LIMIT_REACHED}`, { originId, planned: missing.length });
    missing = limited ? [] : pairsToAsk(distances, pairs);
    done = 1;
    total = done + missing.length;
    report();
  }

  const found: Array<{ a: number; b: number; gm: number | null }> = [];
  for (const [a, b] of missing) {
    const answer = await attempt(d, 'distance request', { a, b }, () => uex.distance(a, b));
    done++;
    if (!answer.ok) {
      // A failure is most likely the network, not this pair: do not wait for the next timeouts.
      const what = isRateLimit(answer.error) ? `distance requests stopped: ${LIMIT_REACHED}` : 'distance requests stopped after a failure';
      log.warn('sync', what, { originId, asked: found.length + 1, planned: missing.length });
      total = done;
      report();
      break;
    }
    found.push({ a, b, gm: answer.value });
    distances.set(distKey(a, b), answer.value);
    report();
  }
  await putDistances(db, found);
  log.info('sync', 'distances ensured', { originId, pairs: pairs.length, requested: found.length, planned: missing.length });
  return distances;
}
