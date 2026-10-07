import { beforeEach, describe, expect, it } from 'vitest';
import { distKey, priceKey } from '../../src/core/types';
import type { Db } from '../../src/data/db';
import { createLogger, memorySink } from '../../src/data/logger';
import { getMeta, loadDistances, loadReference, loadUexPrices, saveReference, upsertPrices } from '../../src/data/repo/uex-cache';
import {
  countDistanceRequests, ensureDistances, pricesAreStale, referenceIsStale, syncPrices, syncReference,
  type DistanceProgress, type PriceProgress, type SyncDeps,
} from '../../src/data/sync';
import { UexError } from '../../src/data/uex-client';
import { px, seedTerminals, term, veh } from '../helpers/factories';
import { FakeUex } from '../helpers/fake-uex';
import { countingDb } from '../helpers/suggest-progress-fixtures';
import { migratedDb } from '../helpers/test-db';
import {
  failDistancesAs, failPricesAs, failRoutesAs, failVehiclesAs, networkStall, rateLimit, serverRefusal,
} from '../helpers/uex-failure-fixtures';

const NOW = 1_800_000_000;

let db: Db;
let uex: FakeUex;
let sink: ReturnType<typeof memorySink>;
let clock: number;
let deps: SyncDeps;

beforeEach(async () => {
  db = await migratedDb();
  uex = new FakeUex();
  sink = memorySink();
  clock = NOW;
  deps = { db, uex, log: createLogger(sink), now: () => clock };
});

const warnings = () => sink.lines.filter((l) => l.level === 'warn' && l.line.includes('[sync]'));
const priceKeys = async () => (await loadUexPrices(db)).map((p) => priceKey(p.terminalId, p.commodityId));

describe('staleness', () => {
  it('has the documented boundaries', () => {
    expect(pricesAreStale(null, 5000)).toBe(true);
    expect(pricesAreStale(1000, 1000 + 3600)).toBe(false);
    expect(pricesAreStale(1000, 1000 + 3601)).toBe(true);
    expect(referenceIsStale(null, 5000)).toBe(true);
    expect(referenceIsStale(1000, 1000 + 86400)).toBe(false);
    expect(referenceIsStale(1000, 1000 + 86401)).toBe(true);
  });
});

describe('syncPrices', () => {
  it('requests prices in batches of two, the last one with the remainder', async () => {
    await seedTerminals(db, 25);
    expect(await syncPrices(deps)).toEqual({ batches: 13, failed: 0, unfetched: 0 });
    expect(uex.priceCalls.map((ids) => ids.length)).toEqual([...Array(12).fill(2), 1]);
    expect(uex.priceCalls.flat()).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(await getMeta(db, 'prices_synced_at')).toBe(String(NOW));
    expect(await priceKeys()).toHaveLength(25);
  });

  it('asks only for live terminals, one request at a time', async () => {
    await seedTerminals(db, 4);
    await db.execute('UPDATE uex_terminal SET is_available_live = 0 WHERE id = 2');
    expect(await syncPrices(deps)).toEqual({ batches: 2, failed: 0, unfetched: 0 });
    expect(uex.priceCalls).toEqual([[1, 3], [4]]);
    expect(uex.maxInFlight).toBe(1);
  });

  it('retries a batch that the server refused one terminal at a time', async () => {
    await seedTerminals(db, 2);
    await upsertPrices(db, [1, 2], [px(1, 10, { sell: { last: 1 } }), px(2, 10, { sell: { last: 1 } })], 50);
    uex.priceRows = (id) => [px(id, 10, { sell: { last: 999 } })];
    uex.failPrices = (ids) => ids.length === 2;
    failPricesAs(uex, serverRefusal);

    expect(await syncPrices(deps)).toEqual({ batches: 1, failed: 0, unfetched: 0 });
    expect(uex.priceCalls).toEqual([[1, 2], [1], [2]]);
    expect((await loadUexPrices(db)).map((p) => p.sell.last)).toEqual([999, 999]);
    expect(await getMeta(db, 'prices_synced_at')).toBe(String(NOW));
    expect(uex.maxInFlight).toBe(1);
  });

  it('keeps the old rows of a terminal that fails even alone, but updates the other terminal of the batch', async () => {
    await seedTerminals(db, 4);
    await upsertPrices(db, [3, 4], [px(3, 10, { sell: { last: 1 } }), px(3, 11), px(4, 10, { sell: { last: 1 } }), px(4, 11)], 50);
    uex.priceRows = (id) => [px(id, 10, { sell: { last: 999 } })];
    uex.failPrices = (ids) => ids.includes(4);
    failPricesAs(uex, serverRefusal);

    expect(await syncPrices(deps)).toEqual({ batches: 2, failed: 1, unfetched: 1 });
    expect(uex.priceCalls).toEqual([[1, 2], [3, 4], [3], [4]]);

    const rows = await loadUexPrices(db);
    expect(rows.map((p) => priceKey(p.terminalId, p.commodityId))).toEqual(['1:10', '2:10', '3:10', '4:10', '4:11']);
    expect(rows.find((p) => p.terminalId === 3)?.sell.last).toBe(999); // updated, its vanished commodity 11 is gone
    expect(rows.find((p) => p.terminalId === 4 && p.commodityId === 10)?.sell.last).toBe(1); // kept as it was

    expect(await getMeta(db, 'prices_synced_at')).toBeNull();
    expect(warnings().length).toBeGreaterThan(0);
  });

  it('counts every batch that has a terminal failing alone', async () => {
    await seedTerminals(db, 6);
    uex.failPrices = (ids) => ids.includes(2) || ids.includes(5);
    failPricesAs(uex, serverRefusal);
    expect(await syncPrices(deps)).toEqual({ batches: 3, failed: 2, unfetched: 2 });
    expect(await priceKeys()).toEqual(['1:10', '3:10', '4:10', '6:10']);
  });

  it('does not repeat a failed request for a batch of one terminal', async () => {
    await seedTerminals(db, 1);
    uex.failPrices = () => true;
    expect(await syncPrices(deps)).toEqual({ batches: 1, failed: 1, unfetched: 1 });
    expect(uex.priceCalls).toEqual([[1]]);
    expect(await getMeta(db, 'prices_synced_at')).toBeNull();
  });

  it('does not touch the cache or the freshness mark when there is no terminal to sync', async () => {
    expect(await syncPrices(deps)).toEqual({ batches: 0, failed: 0, unfetched: 0 });
    expect(uex.priceCalls).toEqual([]);
    expect(await getMeta(db, 'prices_synced_at')).toBeNull();
  });

  it('logs the start, every batch and the end', async () => {
    await seedTerminals(db, 3);
    await syncPrices(deps);
    const lines = sink.lines.filter((l) => l.line.startsWith('[sync]')).map((l) => l.line);
    expect(lines.length).toBeGreaterThanOrEqual(4); // start, two batches, end
    expect(lines[0]).toContain('prices');
    expect(lines.at(-1)).toContain('"batches":2');
  });
});

describe('syncPrices progress', () => {
  /** What the callback saw, with how many requests UEX had received at that moment. */
  const watch = () => {
    const seen: Array<PriceProgress & { requests: number }> = [];
    return { seen, onProgress: (p: PriceProgress) => void seen.push({ ...p, requests: uex.priceCalls.length }) };
  };

  it('says 0 of N before the first request and N of N after the last, one step per batch', async () => {
    await seedTerminals(db, 5);
    const { seen, onProgress } = watch();
    await syncPrices(deps, onProgress);
    expect(seen).toEqual([
      { done: 0, total: 3, requests: 0 },
      { done: 1, total: 3, requests: 1 },
      { done: 2, total: 3, requests: 2 },
      { done: 3, total: 3, requests: 3 },
    ]);
  });

  it('counts a batch that failed as done: the retry belongs to the batch, and the last step is still N of N', async () => {
    await seedTerminals(db, 4);
    uex.failPrices = () => true;
    failPricesAs(uex, serverRefusal);
    const { seen, onProgress } = watch();
    await syncPrices(deps, onProgress);
    expect(seen).toEqual([
      { done: 0, total: 2, requests: 0 },
      { done: 1, total: 2, requests: 3 }, // [1, 2], then 1 and 2 alone
      { done: 2, total: 2, requests: 6 },
    ]);
  });

  it('is complete (N of N) also when only some batches failed', async () => {
    await seedTerminals(db, 6);
    uex.failPrices = (ids) => ids.includes(3);
    const { seen, onProgress } = watch();
    await syncPrices(deps, onProgress);
    expect(seen.map((p) => p.done)).toEqual([0, 1, 2, 3]);
    expect(seen.every((p) => p.total === 3)).toBe(true);
  });

  it('does not stop, and does not lose a price, when the callback throws; every failure is logged', async () => {
    await seedTerminals(db, 4);
    const calls: number[] = [];
    const result = await syncPrices(deps, (p) => { calls.push(p.done); throw new Error('the screen is gone'); });
    expect(calls).toEqual([0, 1, 2]); // asked again after every throw
    expect(result).toEqual({ batches: 2, failed: 0, unfetched: 0 });
    expect(uex.priceCalls).toEqual([[1, 2], [3, 4]]);
    expect(await priceKeys()).toHaveLength(4);
    expect(await getMeta(db, 'prices_synced_at')).toBe(String(NOW));
    expect(warnings().filter((l) => l.line.includes('progress callback failed') && l.line.includes('the screen is gone'))).toHaveLength(3);
  });

  it('survives a thrown value that is not an Error', async () => {
    await seedTerminals(db, 2);
    await expect(syncPrices(deps, () => { throw 'plain text'; })).resolves.toEqual({ batches: 1, failed: 0, unfetched: 0 });
    expect(await priceKeys()).toHaveLength(2);
  });

  it('says nothing when there is no terminal to ask', async () => {
    const { seen, onProgress } = watch();
    await syncPrices(deps, onProgress);
    expect(seen).toEqual([]);
  });

  it('works without a callback, as before', async () => {
    await seedTerminals(db, 3);
    await expect(syncPrices(deps)).resolves.toEqual({ batches: 2, failed: 0, unfetched: 0 });
  });
});

describe('syncPrices: the terminals that could not be fetched', () => {
  it('counts terminals, not batches: a batch of two with one bad terminal leaves one', async () => {
    await seedTerminals(db, 4);
    uex.failPrices = (ids) => ids.includes(4);
    failPricesAs(uex, serverRefusal);
    expect(await syncPrices(deps)).toEqual({ batches: 2, failed: 1, unfetched: 1 });
  });

  it('counts both terminals of a batch where both fail even alone', async () => {
    await seedTerminals(db, 4);
    uex.failPrices = (ids) => ids.includes(1) || ids.includes(2);
    failPricesAs(uex, serverRefusal);
    expect(await syncPrices(deps)).toEqual({ batches: 2, failed: 1, unfetched: 2 });
  });

  it('is the sum over the batches', async () => {
    await seedTerminals(db, 6);
    uex.failPrices = () => true;
    expect(await syncPrices(deps)).toEqual({ batches: 3, failed: 3, unfetched: 6 });
  });
});

describe('syncPrices on a network that does not answer', () => {
  /** Lines of the sync at warn level: what the player of the log reads when the network is dead. */
  const syncWarnings = () => warnings().map((l) => l.line);

  it('does not repeat a batch that failed by the network one terminal at a time', async () => {
    await seedTerminals(db, 4);
    uex.failPrices = (ids) => ids.includes(2);
    expect(await syncPrices(deps)).toEqual({ batches: 2, failed: 1, unfetched: 2 });
    expect(uex.priceCalls).toEqual([[1, 2], [3, 4]]);
    expect(await getMeta(db, 'prices_synced_at')).toBeNull();
  });

  it('gives up after three network failures in a row: the rest is unfetched and no more request is made', async () => {
    await seedTerminals(db, 20);
    await upsertPrices(db, [1, 20], [px(1, 10, { sell: { last: 1 } }), px(20, 10, { sell: { last: 2 } })], 50);
    uex.failPrices = () => true;

    expect(await syncPrices(deps)).toEqual({ batches: 10, failed: 10, unfetched: 20 });

    expect(uex.priceCalls).toEqual([[1, 2], [3, 4], [5, 6]]);
    expect(await getMeta(db, 'prices_synced_at')).toBeNull();
    const rows = await loadUexPrices(db);
    expect(rows.map((p) => [p.terminalId, p.sell.last])).toEqual([[1, 1], [20, 2]]); // the old rows stay as they were
  });

  it('writes one line of the sync about it, not one per batch', async () => {
    await seedTerminals(db, 20);
    uex.failPrices = () => true;
    await syncPrices(deps);
    const lines = syncWarnings();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('gave up');
    expect(lines[0]).toContain('"unfetched":20');
    expect(lines[0]).toContain('"batches":10');
  });

  it('starts the count again after a batch that went through', async () => {
    await seedTerminals(db, 14); // batches [1,2] [3,4] [5,6] [7,8] [9,10] [11,12] [13,14]
    const bad = new Set([1, 3, 7, 9, 13]);
    uex.failPrices = (ids) => ids.some((id) => bad.has(id));

    expect(await syncPrices(deps)).toEqual({ batches: 7, failed: 5, unfetched: 10 });
    expect(uex.priceCalls).toHaveLength(7); // two failures, one success, two failures, one success, one failure: never three in a row
  });

  it('counts three in a row also after earlier batches that went through', async () => {
    await seedTerminals(db, 14);
    uex.failPrices = (ids) => ids.some((id) => id >= 5 && id <= 10);

    expect(await syncPrices(deps)).toEqual({ batches: 7, failed: 5, unfetched: 10 }); // three asked and failed, two batches never asked
    expect(uex.priceCalls).toEqual([[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]]);
    expect((await priceKeys()).sort()).toEqual(['1:10', '2:10', '3:10', '4:10']);
  });

  it('does not count a refusal of the server: the server is there, and its batches are still repeated one by one', async () => {
    await seedTerminals(db, 8); // four batches
    uex.failPrices = () => true;
    failPricesAs(uex, serverRefusal);

    expect(await syncPrices(deps)).toEqual({ batches: 4, failed: 4, unfetched: 8 });
    expect(uex.priceCalls).toHaveLength(12); // every batch and its two single requests
  });

  it('ends the count at a refusal of the server between two network failures', async () => {
    await seedTerminals(db, 10); // five batches
    uex.failPrices = (ids) => ids.some((id) => id !== 9 && id !== 10);
    failPricesAs(uex, (ids) => (ids.includes(5) || ids.includes(6) ? serverRefusal() : networkStall()));

    // [1,2] and [3,4] stall, [5,6] is refused (and its singles refused as well), [7,8] stalls, [9,10] goes through
    expect(await syncPrices(deps)).toEqual({ batches: 5, failed: 4, unfetched: 8 });
    expect(uex.priceCalls).toEqual([[1, 2], [3, 4], [5, 6], [5], [6], [7, 8], [9, 10]]);
  });

  it('ends with a complete progress report: N of N although the last batches were never asked', async () => {
    await seedTerminals(db, 20);
    uex.failPrices = () => true;
    const seen: PriceProgress[] = [];
    await syncPrices(deps, (p) => { seen.push({ ...p }); });
    expect(seen).toEqual([
      { done: 0, total: 10 }, { done: 1, total: 10 }, { done: 2, total: 10 }, { done: 3, total: 10 }, { done: 10, total: 10 },
    ]);
  });

  it('does not stop a run whose last batches are the failing ones: nothing is left to give up on, the end is the usual one', async () => {
    await seedTerminals(db, 6);
    uex.failPrices = () => true;
    expect(await syncPrices(deps)).toEqual({ batches: 3, failed: 3, unfetched: 6 });
    expect(uex.priceCalls).toHaveLength(3);
    expect(syncWarnings()).toHaveLength(1);
  });
});

describe('syncPrices when UEX says that the limit of requests is reached (HTTP 429)', () => {
  it('stops at once: the batch is not repeated, not split, and no later batch is asked', async () => {
    await seedTerminals(db, 10);
    await upsertPrices(db, [1], [px(1, 10, { sell: { last: 1 } })], 50);
    uex.failPrices = (ids) => ids.includes(3);
    failPricesAs(uex, rateLimit);

    expect(await syncPrices(deps)).toEqual({ batches: 5, failed: 4, unfetched: 8 });

    expect(uex.priceCalls).toEqual([[1, 2], [3, 4]]);
    expect(await getMeta(db, 'prices_synced_at')).toBeNull();
    expect((await priceKeys()).sort()).toEqual(['1:10', '2:10']);
  });

  it('writes one line that says it was the limit', async () => {
    await seedTerminals(db, 10);
    uex.failPrices = (ids) => ids.includes(3);
    failPricesAs(uex, rateLimit);
    await syncPrices(deps);

    const lines = warnings().map((l) => l.line);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('limit');
    expect(lines[0]).toContain('429');
    expect(lines[0]).toContain('"unfetched":8');
  });

  it('says so also when it is the last batch that was refused', async () => {
    await seedTerminals(db, 4);
    uex.failPrices = (ids) => ids.includes(3);
    failPricesAs(uex, rateLimit);
    expect(await syncPrices(deps)).toEqual({ batches: 2, failed: 1, unfetched: 2 });
    expect(warnings().map((l) => l.line).join('\n')).toContain('429');
  });

  it('stops the repeat terminal by terminal when it is a single request that meets the limit', async () => {
    await seedTerminals(db, 6);
    uex.failPrices = (ids) => ids.includes(3) || ids.includes(4);
    failPricesAs(uex, (ids) => (ids.length === 2 ? serverRefusal() : rateLimit()));

    // [3,4] is refused by the server and repeated; the request for 3 alone meets the limit: 4 is not asked, [5,6] neither
    expect(await syncPrices(deps)).toEqual({ batches: 3, failed: 2, unfetched: 4 });
    expect(uex.priceCalls).toEqual([[1, 2], [3, 4], [3]]);
  });

  it('ends with a complete progress report', async () => {
    await seedTerminals(db, 10);
    uex.failPrices = (ids) => ids.includes(3);
    failPricesAs(uex, rateLimit);
    const seen: PriceProgress[] = [];
    await syncPrices(deps, (p) => { seen.push({ ...p }); });
    expect(seen).toEqual([{ done: 0, total: 5 }, { done: 1, total: 5 }, { done: 2, total: 5 }, { done: 5, total: 5 }]);
  });
});

describe('the limit of requests (HTTP 429) in the other series', () => {
  it('stops the vehicles: the manufacturers after it are not asked, the reference is saved', async () => {
    await saveReference(db, { vehicles: [veh(9)] });
    uex.manufacturerIds = [195, 196, 197, 198];
    uex.failVehiclesOf = new Set([196]);
    failVehiclesAs(uex, rateLimit);

    await syncReference(deps);

    expect(uex.vehicleCalls).toEqual([195, 196]);
    const ref = await loadReference(db);
    expect(ref.commodities.size).toBe(2);
    expect(ref.vehicles.map((v) => v.id)).toEqual([1, 2, 9]); // what arrived is added, nothing is deleted
    expect(warnings().some((l) => l.line.includes('vehicles sync stopped') && l.line.includes('limit') && l.line.includes('429'))).toBe(true);
  });

  it('does not ask the pairs when the route list meets the limit, and still remembers the attempt', async () => {
    uex.failRoutes = true;
    failRoutesAs(uex, rateLimit);
    const points: DistanceProgress[] = [];

    const d = await ensureDistances(deps, 85, [[85, 1], [85, 2]], (p) => { points.push({ ...p }); });

    expect(uex.routeCalls).toEqual([85]);
    expect(uex.distanceCalls).toEqual([]);
    expect(d.size).toBe(0);
    expect(points.at(-1)).toEqual({ done: 1, total: 1 });
    expect(warnings().some((l) => l.line.includes('distance requests stopped') && l.line.includes('429'))).toBe(true);
    await ensureDistances(deps, 85, [[85, 1]]);
    expect(uex.routeCalls).toEqual([85]); // not asked again within a day
  });

  it('says that it was the limit when a pair request stops the series', async () => {
    uex.routes = [];
    uex.failDistances = (_a, b) => b === 2;
    failDistancesAs(uex, rateLimit);

    await ensureDistances(deps, 1, [[1, 2], [1, 3]]);

    expect(uex.distanceCalls).toEqual([[1, 2]]);
    expect(warnings().some((l) => l.line.includes('distance requests stopped') && l.line.includes('limit') && l.line.includes('429'))).toBe(true);
  });
});

describe('syncReference', () => {
  it('asks terminals once per live star system and vehicles once per manufacturer, strictly one at a time', async () => {
    await syncReference(deps);
    expect(uex.starSystemCalls).toBe(1);
    expect(uex.terminalCalls).toEqual([55, 64, 68]); // not 70: that system is not live
    expect(uex.commodityCalls).toBe(1);
    expect(uex.manufacturerCalls).toBe(1);
    expect(uex.vehicleCalls).toEqual([195, 196]);
    expect(uex.maxInFlight).toBe(1);
  });

  it('saves all four lists, drops rows that vanished and marks the reference fresh', async () => {
    await saveReference(db, { terminals: [term(1)], vehicles: [veh(9)] });
    await syncReference(deps);

    const ref = await loadReference(db);
    expect(ref.starSystems.map((s) => s.id)).toEqual([55, 64, 68, 70]);
    expect([...ref.terminals.keys()]).toEqual([5501, 6401, 6402, 6801, 6802, 6803]);
    expect([...ref.commodities.keys()]).toEqual([10, 20]);
    expect(ref.vehicles.map((v) => v.id)).toEqual([1, 2, 3]);
    expect(await getMeta(db, 'reference_synced_at')).toBe(String(NOW));
  });

  it.each([
    ['star systems', () => { uex.failStarSystems = true; }],
    ['terminals of one star system', () => { uex.failTerminalsOf.add(64); }],
    ['commodities', () => { uex.failCommodities = true; }],
  ])('writes nothing and throws a UexError when %s fail', async (_name, breakIt) => {
    await saveReference(db, { terminals: [term(1)], vehicles: [veh(9)] });
    breakIt();

    await expect(syncReference(deps)).rejects.toBeInstanceOf(UexError);

    const ref = await loadReference(db);
    expect([...ref.terminals.keys()]).toEqual([1]);
    expect(ref.starSystems).toEqual([]);
    expect(ref.commodities.size).toBe(0);
    expect(ref.vehicles.map((v) => v.id)).toEqual([9]);
    expect(await getMeta(db, 'reference_synced_at')).toBeNull();
  });

  it.each([
    ['an empty star system list', () => { uex.starSystemList = []; }],
    ['a star system list without a live system', () => { uex.starSystemList = uex.starSystemList.map((s) => ({ ...s, isAvailableLive: false })); }],
    ['no terminals in any live star system', () => { uex.terminalsBySystem = new Map(); }],
    ['an empty commodity list', () => { uex.commodityList = []; }],
  ])('refuses %s: throws a shape UexError, writes nothing, deletes nothing', async (_name, emptyIt) => {
    await saveReference(db, {
      starSystems: [{ id: 1, name: 'Old', code: '', isAvailableLive: true }],
      terminals: [term(1)],
      commodities: [{ id: 5, name: 'Old', code: 'OLD', isIllegal: false, isBuyable: true, isSellable: true, isAvailableLive: true }],
      vehicles: [veh(9)],
    });
    emptyIt();

    const failure = await syncReference(deps).then(() => null, (err: unknown) => err);

    expect(failure).toBeInstanceOf(UexError);
    expect((failure as UexError).kind).toBe('shape');
    const ref = await loadReference(db);
    expect(ref.starSystems.map((s) => s.id)).toEqual([1]);
    expect([...ref.terminals.keys()]).toEqual([1]);
    expect([...ref.commodities.keys()]).toEqual([5]);
    expect(ref.vehicles.map((v) => v.id)).toEqual([9]);
    expect(await getMeta(db, 'reference_synced_at')).toBeNull();
  });

  it('accepts a live star system without terminals as long as the others have some', async () => {
    uex.terminalsBySystem.set(64, []);
    await syncReference(deps);
    expect((await loadReference(db)).terminals.size).toBe(4);
    expect(await getMeta(db, 'reference_synced_at')).toBe(String(NOW));
  });

  it.each([
    ['an empty manufacturer list', () => { uex.manufacturerIds = []; }],
    ['manufacturers that have no vehicle at all', () => { uex.vehiclesByCompany = new Map(); }],
  ])('treats %s as an incomplete vehicle list: reference saved, stored vehicles kept, warning', async (_name, emptyIt) => {
    await saveReference(db, { vehicles: [veh(9)] });
    emptyIt();

    await syncReference(deps);

    const ref = await loadReference(db);
    expect(ref.commodities.size).toBe(2);
    expect(ref.terminals.size).toBe(6);
    expect(ref.vehicles.map((v) => v.id)).toEqual([9]);
    expect(await getMeta(db, 'reference_synced_at')).toBe(String(NOW));
    expect(warnings().length).toBeGreaterThan(0);
  });

  it('saves the reference and keeps the old vehicles when the manufacturer list fails', async () => {
    await saveReference(db, { vehicles: [veh(9)] });
    uex.failManufacturers = true;

    await syncReference(deps);

    const ref = await loadReference(db);
    expect(ref.commodities.size).toBe(2);
    expect(ref.terminals.size).toBe(6);
    expect(ref.vehicles.map((v) => v.id)).toEqual([9]);
    expect(await getMeta(db, 'reference_synced_at')).toBe(String(NOW));
    expect(warnings().length).toBeGreaterThan(0);
  });

  it('adds what arrived and keeps every old vehicle when one manufacturer fails', async () => {
    await saveReference(db, { vehicles: [veh(9)] });
    uex.failVehiclesOf.add(195);

    await syncReference(deps);

    expect(uex.vehicleCalls).toEqual([195, 196]); // the failure does not stop the next manufacturer
    expect((await loadReference(db)).vehicles.map((v) => v.id)).toEqual([3, 9]);
    expect(await getMeta(db, 'reference_synced_at')).toBe(String(NOW));
    expect(warnings().length).toBeGreaterThan(0);
  });

  it('stops asking the terminals after the first star system that fails: the reference fails and writes nothing', async () => {
    uex.failTerminalsOf.add(64);
    await expect(syncReference(deps)).rejects.toBeInstanceOf(UexError);
    expect(uex.terminalCalls).toEqual([55, 64]); // 68 is never asked
    expect(uex.commodityCalls).toBe(0);
  });

  describe('vehicles on a network that does not answer', () => {
    beforeEach(() => {
      uex.manufacturerIds = [195, 196, 197, 198, 199, 200, 201, 202];
    });

    it('gives up after three network failures in a row: the reference is saved, the stored vehicles are kept', async () => {
      await saveReference(db, { vehicles: [veh(9)] });
      uex.failVehiclesOf = new Set(uex.manufacturerIds);

      await syncReference(deps);

      expect(uex.vehicleCalls).toEqual([195, 196, 197]);
      const ref = await loadReference(db);
      expect(ref.commodities.size).toBe(2);
      expect(ref.vehicles.map((v) => v.id)).toEqual([9]);
      expect(await getMeta(db, 'reference_synced_at')).toBe(String(NOW));
      expect(warnings().some((l) => l.line.includes('gave up'))).toBe(true);
    });

    it('keeps what arrived before the network died, and still adds it to the stored vehicles', async () => {
      await saveReference(db, { vehicles: [veh(9)] });
      uex.vehiclesByCompany.set(197, [veh(4, { name: 'Caterpillar' })]);
      uex.failVehiclesOf = new Set([198, 199, 200, 201, 202]);

      await syncReference(deps);

      expect(uex.vehicleCalls).toEqual([195, 196, 197, 198, 199, 200]);
      expect((await loadReference(db)).vehicles.map((v) => v.id)).toEqual([1, 2, 3, 4, 9]);
    });

    it('starts the count again after a manufacturer that answered', async () => {
      uex.vehiclesByCompany.set(197, [veh(4)]);
      uex.vehiclesByCompany.set(200, [veh(5)]);
      uex.failVehiclesOf = new Set([195, 196, 198, 199, 201, 202]);

      await syncReference(deps);

      expect(uex.vehicleCalls).toEqual(uex.manufacturerIds);
      expect((await loadReference(db)).vehicles.map((v) => v.id)).toEqual([4, 5]);
    });

    it('does not count a refusal of the server', async () => {
      uex.failVehiclesOf = new Set(uex.manufacturerIds);
      failVehiclesAs(uex, serverRefusal);

      await syncReference(deps);

      expect(uex.vehicleCalls).toEqual(uex.manufacturerIds);
    });
  });

  it('logs the start and the end', async () => {
    await syncReference(deps);
    const lines = sink.lines.filter((l) => l.line.startsWith('[sync]')).map((l) => l.line);
    expect(lines[0]).toContain('reference');
    expect(lines.at(-1)).toContain('reference');
  });
});

describe('ensureDistances', () => {
  it('asks routes once, then only missing pairs, at most twenty', async () => {
    uex.routes = [{ destId: 12, gm: 59 }];
    const pairs = Array.from({ length: 30 }, (_, i) => [85, 100 + i] as [number, number]);

    const d = await ensureDistances(deps, 85, [[85, 12], ...pairs]);
    expect(d.get(distKey(85, 12))).toBe(59);
    expect(uex.routeCalls).toEqual([85]);
    expect(uex.distanceCalls).toHaveLength(20);

    await ensureDistances(deps, 85, [[85, 12], ...pairs.slice(0, 20)]);
    expect(uex.routeCalls).toEqual([85]);
    expect(uex.distanceCalls).toHaveLength(20);
    expect(uex.maxInFlight).toBe(1);
  });

  it('swallows a failure of the routes request and returns the cache', async () => {
    uex.failRoutes = true;
    await expect(ensureDistances(deps, 85, [[85, 12]])).resolves.toBeInstanceOf(Map);
  });

  it('remembers an origin whose routes failed: no second routes request, pair requests go on, capped at twenty', async () => {
    uex.failRoutes = true;
    const pairs = Array.from({ length: 25 }, (_, i) => [85, 100 + i] as [number, number]);

    const first = await ensureDistances(deps, 85, pairs);
    expect(uex.routeCalls).toEqual([85]);
    expect(uex.distanceCalls).toHaveLength(20);
    expect(first.size).toBe(20);
    expect(warnings().length).toBeGreaterThan(0);

    const second = await ensureDistances(deps, 85, pairs);
    expect(uex.routeCalls).toEqual([85]); // not asked again
    expect(uex.distanceCalls).toHaveLength(25); // the five pairs that were still missing
    expect(second.size).toBe(25);
  });

  it('asks the routes of an origin whose request failed again after a day, not before', async () => {
    uex.failRoutes = true;
    await ensureDistances(deps, 85, []);
    clock = NOW + 86400;
    await ensureDistances(deps, 85, []);
    expect(uex.routeCalls).toEqual([85]);
    clock = NOW + 86401;
    await ensureDistances(deps, 85, []);
    expect(uex.routeCalls).toEqual([85, 85]);
  });

  it('never asks the routes of an origin again once they were fetched', async () => {
    uex.routes = [{ destId: 12, gm: 59 }];
    await ensureDistances(deps, 85, []);
    clock = NOW + 25 * 3600;
    const d = await ensureDistances(deps, 85, [[85, 12]]);
    clock = NOW + 400 * 86400;
    await ensureDistances(deps, 85, []);
    expect(uex.routeCalls).toEqual([85]);
    expect(d.get(distKey(85, 12))).toBe(59);
  });

  it('retries a failed origin after a day and then keeps it for good once that succeeds', async () => {
    uex.failRoutes = true;
    await ensureDistances(deps, 85, []);
    uex.failRoutes = false;
    clock = NOW + 86401;
    await ensureDistances(deps, 85, []);
    clock = NOW + 3 * 86400;
    await ensureDistances(deps, 85, []);
    expect(uex.routeCalls).toEqual([85, 85]);
  });

  it('stores an unknown distance as NULL and never asks for it again', async () => {
    uex.distances.set(distKey(1, 2), null);
    const first = await ensureDistances(deps, 1, [[1, 2]]);
    expect(first.has(distKey(1, 2))).toBe(true);
    expect(first.get(distKey(1, 2))).toBeNull();
    await ensureDistances(deps, 1, [[2, 1]]);
    expect(uex.distanceCalls).toEqual([[1, 2]]);
    expect((await loadDistances(db)).get(distKey(1, 2))).toBeNull();
  });

  it('asks each pair once and not for a terminal paired with itself', async () => {
    await ensureDistances(deps, 1, [[1, 2], [2, 1], [3, 3], [1, 2]]);
    expect(uex.distanceCalls).toEqual([[1, 2]]);
  });

  it('stops asking pairs after the first failure, keeps what it got and stores nothing for the failed pair', async () => {
    const pairs: Array<[number, number]> = [[1, 2], [1, 3], [1, 4]];
    uex.distances.set(distKey(1, 2), 5);
    uex.failDistances = (_a, b) => b === 3;

    const d = await ensureDistances(deps, 1, pairs);

    expect(uex.distanceCalls).toEqual([[1, 2], [1, 3]]);
    expect(d.get(distKey(1, 2))).toBe(5);
    expect(d.has(distKey(1, 3))).toBe(false);
    expect((await loadDistances(db)).has(distKey(1, 3))).toBe(false);
    expect(warnings().length).toBeGreaterThan(0);
  });
});

describe('ensureDistances progress', () => {
  const run = async (originId: number, pairs: Array<[number, number]>) => {
    const points: DistanceProgress[] = [];
    await ensureDistances(deps, originId, pairs, (p) => { points.push({ ...p }); });
    return points;
  };

  it('reports the plan first, then each request, shrinking the plan by what the route list covered', async () => {
    uex.routes = [{ destId: 12, gm: 59 }];
    const points = await run(85, [[85, 12], [85, 100], [85, 101]]);
    // planned: the route list and three pairs; the route list answered one of them
    expect(points).toEqual([{ done: 0, total: 4 }, { done: 1, total: 3 }, { done: 2, total: 3 }, { done: 3, total: 3 }]);
  });

  it('reports a single point when there is nothing to ask', async () => {
    uex.routes = [{ destId: 12, gm: 59 }];
    await ensureDistances(deps, 85, [[85, 12]]);
    expect(await run(85, [[85, 12], [85, 85]])).toEqual([{ done: 0, total: 0 }]);
  });

  it('counts the route list that failed, and does not plan it again within a day', async () => {
    uex.failRoutes = true;
    expect(await run(85, [[85, 1]])).toEqual([{ done: 0, total: 2 }, { done: 1, total: 2 }, { done: 2, total: 2 }]);
    expect(await run(85, [[85, 2]])).toEqual([{ done: 0, total: 1 }, { done: 1, total: 1 }]);
  });

  it('drops the pairs a failure stops from the plan, so that the last point is complete', async () => {
    uex.routes = [];
    uex.failDistances = (_a, b) => b === 2;
    expect(await run(1, [[1, 1], [1, 2], [1, 3], [1, 4]])).toEqual([
      { done: 0, total: 4 }, { done: 1, total: 4 }, { done: 2, total: 2 },
    ]);
    expect(uex.distanceCalls).toEqual([[1, 2]]);
  });

  it('plans at most twenty pairs', async () => {
    uex.routes = [];
    const pairs = Array.from({ length: 30 }, (_, i) => [85, 100 + i] as [number, number]);
    const points = await run(85, pairs);
    expect(points[0]).toEqual({ done: 0, total: 21 });
    expect(points.at(-1)).toEqual({ done: 21, total: 21 });
  });

  it('still stores what it got and returns the cache without a callback', async () => {
    uex.routes = [{ destId: 12, gm: 59 }];
    const d = await ensureDistances(deps, 85, [[85, 12], [85, 100]]);
    expect(d.get(distKey(85, 12))).toBe(59);
    expect(d.get(distKey(85, 100))).toBe(7);
    expect((await loadDistances(db)).get(distKey(85, 100))).toBe(7);
  });
});

describe('ensureDistances progress callback that throws', () => {
  it('does not lose the pairs it already fetched, goes on asking and logs the failure', async () => {
    uex.routes = [];
    const calls: number[] = [];
    const d = await ensureDistances(deps, 1, [[1, 2], [1, 3]], (p) => { calls.push(p.done); throw new Error('the screen is gone'); });
    expect(calls).toEqual([0, 1, 2, 3]);                                 // called again after every throw
    expect(uex.distanceCalls).toEqual([[1, 2], [1, 3]]);
    expect(d.get(distKey(1, 2))).toBe(7);
    expect((await loadDistances(db)).get(distKey(1, 3))).toBe(7);        // stored although the callback threw each time
    const logged = warnings().filter((l) => l.line.includes('the screen is gone'));
    expect(logged).toHaveLength(4);
  });

  it('survives a thrown value that is not an Error', async () => {
    await expect(ensureDistances(deps, 1, [[1, 2]], () => { throw 'plain text'; })).resolves.toBeInstanceOf(Map);
    expect((await loadDistances(db)).get(distKey(1, 2))).toBe(7);
  });
});

describe('ensureDistances reads', () => {
  it('loads the distance table once, also when the route list is due, and still sees what the route list brought', async () => {
    uex.routes = [{ destId: 12, gm: 59 }];
    const counted = countingDb(db);
    const d = await ensureDistances({ ...deps, db: counted.db }, 85, [[85, 12], [85, 100]]);
    expect(counted.reads()).toEqual({ distances: 1, meta: 1 });
    expect(uex.distanceCalls).toEqual([[85, 100]]);                      // 85-12 came with the route list
    expect(d.get(distKey(85, 12))).toBe(59);
    expect(d.get(distKey(85, 100))).toBe(7);
    expect((await loadDistances(db)).get(distKey(85, 12))).toBe(59);     // and it is stored
  });

  it('keeps a route-list row that is the terminal itself out of the table, as the store does', async () => {
    uex.routes = [{ destId: 85, gm: 1 }, { destId: 12, gm: 59 }];
    const d = await ensureDistances(deps, 85, []);
    expect(d).toEqual(new Map([[distKey(85, 12), 59]]));
    expect(await loadDistances(db)).toEqual(d);
  });

  it('loads the table once when the route list is not due', async () => {
    uex.routes = [{ destId: 12, gm: 59 }];
    await ensureDistances(deps, 85, []);
    const counted = countingDb(db);
    await ensureDistances({ ...deps, db: counted.db }, 85, [[85, 12]]);
    expect(counted.reads()).toEqual({ distances: 1, meta: 1 });
  });
});

describe('countDistanceRequests', () => {
  const known = () => loadDistances(db);

  it('counts the route list and the unknown pairs, the same as ensureDistances then plans', async () => {
    uex.routes = [{ destId: 12, gm: 59 }];
    const pairs: Array<[number, number]> = [[85, 12], [12, 85], [85, 100], [85, 85]];
    expect(await countDistanceRequests(deps, 85, pairs, await known())).toBe(3);   // the route list, 85-12 and 85-100 (the repeat and the self pair do not count)
    expect(uex.routeCalls).toEqual([]);                                  // counting asks UEX nothing
    expect(uex.distanceCalls).toEqual([]);
    const points: DistanceProgress[] = [];
    await ensureDistances(deps, 85, pairs, (p) => { points.push({ ...p }); });
    expect(points[0]).toEqual({ done: 0, total: 3 });
  });

  it('counts by the distances it is given and reads only the meta table', async () => {
    const counted = countingDb(db);
    const pairs: Array<[number, number]> = [[85, 100], [85, 101]];
    const distances = new Map<string, number | null>([[distKey(85, 100), 5]]);   // not in the database
    expect(await countDistanceRequests({ ...deps, db: counted.db }, 85, pairs, distances)).toBe(2);
    expect(counted.reads()).toEqual({ distances: 0, meta: 1 });
  });

  it('does not count a route list that was fetched, nor one that failed less than a day ago', async () => {
    uex.routes = [{ destId: 12, gm: 59 }];
    await ensureDistances(deps, 85, []);
    expect(await countDistanceRequests(deps, 85, [[85, 100]], await known())).toBe(1);
    uex.failRoutes = true;
    await ensureDistances(deps, 86, []);
    expect(await countDistanceRequests(deps, 86, [[86, 100]], await known())).toBe(1);
    clock = NOW + 86401;
    expect(await countDistanceRequests(deps, 86, [[86, 100]], await known())).toBe(2);
  });

  it('counts at most twenty pairs', async () => {
    const pairs = Array.from({ length: 30 }, (_, i) => [85, 100 + i] as [number, number]);
    expect(await countDistanceRequests(deps, 85, pairs, await known())).toBe(21);
  });
});
