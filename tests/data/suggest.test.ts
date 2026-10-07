import { beforeEach, describe, expect, it } from 'vitest';
import { distKey, obsKey, priceKey } from '../../src/core/types';
import type { Db } from '../../src/data/db';
import { createLogger, memorySink } from '../../src/data/logger';
import { addObservation } from '../../src/data/repo/diary';
import { getMeta, loadDistances, putDistances } from '../../src/data/repo/uex-cache';
import {
  loadMarket, suggestFrom, suggestFromDetailed, suggestTo, suggestToDetailed, type SuggestDeps,
} from '../../src/data/suggest';
import { ref, term } from '../helpers/factories';
import { FakeUex } from '../helpers/fake-uex';
import { GOLD, NOW } from '../helpers/route-fixtures';
import { countingDb, expectSoundProgress, recordProgress } from '../helpers/suggest-progress-fixtures';
import { addUexBuy, addUexSell, seedRouteScenario, suggestDeps } from '../helpers/suggest-fixtures';
import { migratedDb } from '../helpers/test-db';

// The route scenario of task 8, but stored in the database and with an empty distance cache.
// Terminals: A=1 (system 68, planet 10), B=2 (68, 20), C=3 (68, 20), D=4 (99, 30), A2=5 (68, 10). Commodity Gold=10.
// A: own hot BUY 6120, stock 340. B: UEX SELL 6900. C: own warm SELL 6840. D: UEX SELL 9000 (other system).

let db: Db;
let uex: FakeUex;
let sink: ReturnType<typeof memorySink>;
let log: ReturnType<typeof createLogger>;
let deps: SuggestDeps;

beforeEach(async () => {
  db = await migratedDb();
  uex = new FakeUex();
  sink = memorySink();
  log = createLogger(sink);
  await seedRouteScenario(db, log);
  deps = suggestDeps(db, uex, log);
  uex.routes = [{ destId: 2, gm: 59 }, { destId: 3, gm: 61 }];
});

const suggestLines = (kind: string) => sink.lines.filter((l) => l.line.startsWith(`[suggest] ${kind} `));
const withNearby = (d: SuggestDeps): SuggestDeps => ({ ...d, settings: { ...d.settings, nearby: true } });

describe('loadMarket', () => {
  it('indexes the cached UEX rows and only the latest diary row of each kind', async () => {
    await addObservation(db, log, { ts: NOW - 5, terminalId: 1, commodityId: GOLD, side: 'buy', price: 6200, scu: null });
    const m = await loadMarket(db);
    expect([...m.uex.keys()].sort()).toEqual([priceKey(2, GOLD), priceKey(4, GOLD)]);
    expect(m.own.get(obsKey(1, GOLD, 'buy'))).toMatchObject({ price: 6200, ts: NOW - 5 });
    expect(m.own.get(obsKey(3, GOLD, 'sell'))).toMatchObject({ price: 6840 });
    expect([...m.byCommodity.get(GOLD)!].sort()).toEqual([1, 2, 3, 4]);
  });

  it('carries the stock statistics of the whole diary, not only of its latest rows', async () => {
    await addObservation(db, log, { ts: NOW - 7200, terminalId: 1, commodityId: GOLD, side: 'buy', price: 6000, scu: 100 });
    await addObservation(db, log, { ts: NOW - 6600, terminalId: 1, commodityId: GOLD, side: 'buy', price: 6000, scu: 160 });
    const m = await loadMarket(db);
    expect(m.stock.get(obsKey(1, GOLD, 'buy'))).toEqual({ maxScu: 340, ratePerMin: 6 });     // 100 → 160 in ten minutes; the seeded 340 is the maximum
    expect(m.stock.has(obsKey(3, GOLD, 'sell'))).toBe(false);                                 // seeded without a quantity
  });

  it('carries the latest quantity reading of each stock, also when a later observation has only a price', async () => {
    await addObservation(db, log, { ts: NOW - 5, terminalId: 1, commodityId: GOLD, side: 'buy', price: 6200, scu: null });
    const m = await loadMarket(db);
    expect(m.own.get(obsKey(1, GOLD, 'buy'))).toMatchObject({ price: 6200, scu: null });
    expect(m.ownScu.get(obsKey(1, GOLD, 'buy'))).toEqual({ ts: NOW - 600, scu: 340 });        // the seeded reading
    expect(m.ownScu.has(obsKey(3, GOLD, 'sell'))).toBe(false);                                // seeded without a quantity
  });
});

describe('suggestFrom', () => {
  it('fetches missing distances once and returns timed options', async () => {
    const o = await suggestFrom(deps, 1, 696);
    expect(o.map((x) => x.destId)).toEqual([2, 3]);
    expect(o[0].timeSec).toBe(1015);
    await suggestFrom(deps, 1, 696);
    expect(uex.routeCalls).toEqual([1]);
  });

  it('stores what it fetched in the distance cache', async () => {
    await suggestFrom(deps, 1, 696);
    expect(await loadDistances(db)).toEqual(new Map([[distKey(1, 2), 59], [distKey(1, 3), 61]]));
    // A successful route list is remembered forever as 'ok'; only a failed attempt keeps its time.
    expect(await getMeta(db, 'routes_fetched:1')).toBe('ok');
  });

  it('remembers the time of a failed route request and does not repeat it at once', async () => {
    uex.failRoutes = true;
    await suggestFrom(deps, 1, 696);
    expect(await getMeta(db, 'routes_fetched:1')).toBe(String(NOW));
    await suggestFrom(deps, 1, 696);
    expect(uex.routeCalls).toEqual([1]);
  });

  it('asks for the single pair that the route list lacks', async () => {
    uex.routes = [{ destId: 2, gm: 59 }];
    uex.distances.set(distKey(1, 3), 61);
    const o = await suggestFrom(deps, 1, 696);
    expect(uex.distanceCalls).toEqual([[1, 3]]);
    expect(o.map((x) => x.timeSec)).toEqual([1015, 1025]);
  });

  it('still answers when UEX is down', async () => {
    uex.failRoutes = true;
    uex.failDistances = () => true;
    const o = await suggestFrom(deps, 1, 696);
    expect(o).toHaveLength(2);
    expect(o[0].uecPerHour).toBeNull();
  });

  it('does not ask UEX again for a pair it knows to be unknown', async () => {
    uex.routes = [];
    uex.distanceDefault = null;
    const first = await suggestFrom(deps, 1, 696);
    expect(first.map((x) => x.timeSec)).toEqual([null, null]);
    const asked = uex.distanceCalls.length;
    expect(asked).toBe(2);
    await suggestFrom(deps, 1, 696);
    expect(uex.distanceCalls).toHaveLength(asked);
    expect(uex.routeCalls).toEqual([1]);
  });

  it('asks UEX nothing when there is nothing to rank', async () => {
    const empty = suggestDeps(await migratedDb(), uex, log);
    expect(await suggestFrom(empty, 1, 696)).toEqual([]);
    expect(uex.routeCalls).toEqual([]);
    expect(uex.distanceCalls).toEqual([]);
  });

  it('uses my own median time for a pair', async () => {
    const o = await suggestFrom({ ...deps, ownMedian: new Map([['1>3', 600]]) }, 1, 696);
    expect(o[0]).toMatchObject({ destId: 3, timeSec: 600, timeSource: 'own' });
  });

  it('measures the distances of the 20 best options by ROI, however few are shown', async () => {
    // 25 more terminals buy Gold, the higher the id the better the price; no route list is available.
    const reference = { ...ref, terminals: new Map(ref.terminals) };
    for (let id = 101; id <= 125; id++) {
      reference.terminals.set(id, term(id, { starSystemId: 68 }));
      await addUexSell(db, id, GOLD, 7000 + id);
    }
    uex.failRoutes = true;
    const o = await suggestFrom({ ...deps, reference }, 1, 696);
    const asked = uex.distanceCalls.map(([a, b]) => `${a}>${b}`);
    expect(asked).toEqual(Array.from({ length: 20 }, (_, i) => `1>${125 - i}`));
    expect(o).toHaveLength(5);
    expect(o.every((x) => x.timeSec !== null)).toBe(true);
  });

  it('includes same-planet origins when nearby is on', async () => {
    await addUexBuy(db, 5, 10, 6000);
    const o = await suggestFrom(withNearby(deps), 1, 696);
    expect(o.some((x) => x.originId === 5)).toBe(true);
    // The planet is the planet of the current terminal: terminals 2 and 3 (planet 20) are not origins.
    expect(suggestLines('from').at(-1)!.line).toContain('"origins":[1,5]');
  });

  it('keeps to the current terminal when nearby is off', async () => {
    await addUexBuy(db, 5, 10, 6000);
    const o = await suggestFrom(deps, 1, 696);
    expect(o.every((x) => x.originId === 1)).toBe(true);
    expect(suggestLines('from').at(-1)!.line).toContain('"origins":[1]');
  });

  it('asks the distances of each origin in turn, the empty flight to the neighbour from the current terminal', async () => {
    await addUexBuy(db, 5, 10, 6000);
    await suggestFrom(withNearby(deps), 1, 696);
    expect(uex.maxInFlight).toBe(1);
    expect([...uex.routeCalls].sort()).toEqual([1, 5]);
    const distances = await loadDistances(db);
    expect(distances.has(distKey(1, 5))).toBe(true);
  });

  it('does not add neighbours for a terminal without a planet', async () => {
    const reference = { ...ref, terminals: new Map(ref.terminals) };
    reference.terminals.set(7, term(7, { starSystemId: 68, planetId: 0 }));
    reference.terminals.set(8, term(8, { starSystemId: 68, planetId: 0 }));
    await addUexBuy(db, 7, GOLD, 6000);
    await addUexBuy(db, 8, GOLD, 6000);
    const o = await suggestFrom(withNearby({ ...deps, reference }), 7, 696);
    expect(o.length).toBeGreaterThan(0);
    expect(o.every((x) => x.originId === 7)).toBe(true);
    expect(suggestLines('from').at(-1)!.line).toContain('"origins":[7]');
  });

  it('does not add neighbours for a terminal that is not in the reference', async () => {
    const o = await suggestFrom(withNearby(deps), 777, 696);
    expect(o).toEqual([]);
    expect(suggestLines('from').at(-1)!.line).toContain('"origins":[777]');
  });

  it('ignores diary rows whose terminal left the reference', async () => {
    await addObservation(db, log, { ts: NOW, terminalId: 777, commodityId: 10, side: 'sell', price: 99999, scu: null });
    const o = await suggestFrom(deps, 1, 696);
    expect(o.every((x) => x.destId !== 777)).toBe(true);
    expect(o.map((x) => x.destId)).toEqual([2, 3]);
    expect(suggestLines('from').at(-1)!.line).toContain('"unknownTerminal":1');
  });

  it('narrows to one commodity', async () => {
    expect(await suggestFrom(deps, 1, 696, 999)).toEqual([]);
    expect((await suggestFrom(deps, 1, 696, GOLD)).map((x) => x.destId)).toEqual([2, 3]);
  });

  it('logs inputs, trace and results', async () => {
    await suggestFrom(deps, 1, 696);
    const lines = suggestLines('from');
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('debug');
    const line = lines[0].line;
    expect(line).toContain('"considered":3');
    expect(line).toContain('"systemFilter":1');
    expect(line).toContain('"source":"own"');
  });

  it('logs enough to reconstruct the answer', async () => {
    await suggestFrom(deps, 1, 696, GOLD);
    const line = suggestLines('from').at(-1)!.line;
    const ctx = JSON.parse(line.slice(line.indexOf('{')));
    expect(ctx).toMatchObject({
      now: NOW, currentTerminalId: 1, origins: [1], freeScu: 696,
      filters: { commodityId: GOLD, starSystemId: 68, budget: null, nearby: false, sort: 'uecPerHour', topN: 5 },
      trace: { considered: 3, kept: 2, dropped: { unknownTerminal: 0, systemFilter: 1, nonPositiveProfit: 0, zeroQty: 0 } },
    });
    expect(ctx.options).toHaveLength(2);
    expect(ctx.options[0]).toMatchObject({
      commodity: 'GOLD', commodityId: GOLD, originId: 1, destId: 2, qty: 340, timeSec: 1015,
      buy: { price: 6120, source: 'own', temp: 'hot' },
      sell: { price: 6900, source: 'uex', temp: null },
    });
    expect(ctx.options[1]).toMatchObject({ destId: 3, sell: { price: 6840, source: 'own', temp: 'warm' } });
  });

  it('logs the stock estimate of the purchase and the rate it came from', async () => {
    // two readings of the quantity in the diary teach a rate: 100 → 160 in ten minutes is 6 per minute
    await addObservation(db, log, { ts: NOW - 7200, terminalId: 1, commodityId: GOLD, side: 'buy', price: 6000, scu: 100 });
    await addObservation(db, log, { ts: NOW - 6600, terminalId: 1, commodityId: GOLD, side: 'buy', price: 6000, scu: 160 });
    await suggestFrom(deps, 1, 696, GOLD);
    const line = suggestLines('from').at(-1)!.line;
    expect(line).toContain('"rateSource":"learned"');
    const ctx = JSON.parse(line.slice(line.indexOf('{')));
    expect(ctx.options[0].buy.stock).toEqual({ scu: 340, baseScu: 340, baseAgeSec: 600, ratePerMin: 6, rateSource: 'learned', maxScu: 340 });
    expect(ctx.options[0].sell).not.toHaveProperty('stock');        // a UEX price has no timer
  });

  it('keeps the stock estimate in the log after an observation with only a price', async () => {
    // I corrected only the price a minute ago: the quantity of ten minutes ago (340) is still the base of the timer
    await addObservation(db, log, { ts: NOW - 60, terminalId: 1, commodityId: GOLD, side: 'buy', price: 6200, scu: null });
    const o = await suggestFrom(deps, 1, 696, GOLD);
    expect(o[0].buy).toMatchObject({ price: 6200, source: 'own', scu: 340, scuOrigin: 'own' });
    const line = suggestLines('from').at(-1)!.line;
    expect(line).toContain('"stock":');
    const ctx = JSON.parse(line.slice(line.indexOf('{')));
    expect(ctx.options[0].buy).toMatchObject({
      price: 6200, source: 'own', scu: 340, scuOrigin: 'own', ageKnown: true,
      stock: { scu: 340, baseScu: 340, baseAgeSec: 600, ratePerMin: 4.53, rateSource: 'default', maxScu: 340 },
    });
  });

  it('logs where the quantity comes from and whether the age of the price is known', async () => {
    await suggestFrom(deps, 1, 696, GOLD);
    const line = suggestLines('from').at(-1)!.line;
    const ctx = JSON.parse(line.slice(line.indexOf('{')));
    expect(ctx.options[0].buy).toMatchObject({ source: 'own', scuOrigin: 'own', ageKnown: true });
    expect(ctx.options[0].sell).toMatchObject({ source: 'uex', scu: null, scuOrigin: null, ageKnown: true });
  });

  it('feeds the refill timer into the quantity, with the full-refill time from the settings', async () => {
    // the diary once showed 1000 SCU, then 340 (after buying): 340 + 10 minutes of refilling
    await addObservation(db, log, { ts: NOW - 7200, terminalId: 1, commodityId: GOLD, side: 'buy', price: 6000, scu: 1000 });
    const withMinutes = (refillFullMin: number): SuggestDeps => ({ ...deps, settings: { ...deps.settings, refillFullMin } });
    expect((await suggestFrom(withMinutes(100), 1, 696, GOLD))[0].qty).toBe(440);      // 1000 / 100 = 10 per minute
    expect((await suggestFrom(withMinutes(200), 1, 696, GOLD))[0].qty).toBe(390);      // 1000 / 200 = 5 per minute
  });

  it('drops a trip whose purchase terminal is known to be empty', async () => {
    await addObservation(db, log, { ts: NOW, terminalId: 1, commodityId: GOLD, side: 'buy', price: 6120, scu: 0 });
    expect(await suggestFrom(deps, 1, 696, GOLD)).toEqual([]);
    expect(suggestLines('from').at(-1)!.line).toContain('"zeroQty":2');
  });

  it('keeps a buyer that reports an empty inventory, and logs that inventory with the trip', async () => {
    // "0 SCU, out of stock" at terminal 3 is the best buyer: the whole load goes there, the zero is only information
    await addObservation(db, log, { ts: NOW - 60, terminalId: 3, commodityId: GOLD, side: 'sell', price: 6840, scu: 0 });
    const o = await suggestFrom(deps, 1, 696, GOLD);
    expect(o.map((x) => [x.destId, x.qty])).toEqual([[2, 340], [3, 340]]);
    expect(o[1].sell.scu).toBe(0);
    const line = suggestLines('from').at(-1)!.line;
    const ctx = JSON.parse(line.slice(line.indexOf('{')));
    expect(ctx.trace.dropped.zeroQty).toBe(0);
    expect(ctx.options[1]).toMatchObject({ destId: 3, qty: 340, sell: { price: 6840, source: 'own', scu: 0 } });
    expect(ctx.options[1].sell).not.toHaveProperty('stock');          // the buyer's inventory has no refill timer
    expect(ctx.options[0].buy).toMatchObject({ scu: 340, stock: { scu: 340 } });
  });

  it('writes the log line once the distances are known, and nothing at info level', async () => {
    await suggestFrom(deps, 1, 696);
    expect(suggestLines('from')[0].line).toContain('"timeSec":1015');
    expect(sink.lines.filter((l) => l.level === 'info' && l.line.startsWith('[suggest]'))).toEqual([]);
  });
});

describe('suggestTo', () => {
  it('lists origins for what the terminal buys', async () => {
    expect((await suggestTo(deps, 2, 696))[0]).toMatchObject({ originId: 1, destId: 2 });
  });

  it('asks the distances from the destination, once for all origins', async () => {
    await addUexBuy(db, 5, 10, 6000);
    uex.routes = [{ destId: 1, gm: 59 }, { destId: 5, gm: 58 }];
    const o = await suggestTo(deps, 2, 696);
    expect(uex.routeCalls).toEqual([2]);
    expect(uex.distanceCalls).toEqual([]);
    expect(o.map((x) => [x.originId, x.timeSec])).toEqual([[5, 1010], [1, 1015]]);
  });

  it('still answers when UEX is down', async () => {
    uex.failRoutes = true;
    uex.failDistances = () => true;
    const o = await suggestTo(deps, 2, 696);
    expect(o).toHaveLength(1);
    expect(o[0].uecPerHour).toBeNull();
  });

  it('ignores diary rows of a terminal that left the reference', async () => {
    await addObservation(db, log, { ts: NOW, terminalId: 777, commodityId: 10, side: 'buy', price: 1000, scu: null });
    await addObservation(db, log, { ts: NOW, terminalId: 777, commodityId: 10, side: 'sell', price: 99999, scu: null });
    expect((await suggestTo(deps, 2, 696)).map((x) => x.originId)).toEqual([1]);
    expect(await suggestTo(deps, 777, 696)).toEqual([]);
  });

  it('finds nothing for a commodity the terminal does not buy', async () => {
    expect(await suggestTo(deps, 2, 696, 999)).toEqual([]);
    expect(await suggestTo(deps, 2, 696, 20)).toEqual([]);
  });

  it('returns the same as the unfiltered list for the one commodity the terminal buys', async () => {
    const all = await suggestTo(deps, 2, 696);
    expect(all).toHaveLength(1);
    expect(await suggestTo(deps, 2, 696, GOLD)).toEqual(all);
  });

  it('narrows the list of a terminal that buys several commodities', async () => {
    await addUexSell(db, 2, 20, 5000);
    await addUexBuy(db, 1, 20, 4000);
    const titanium = await suggestTo(deps, 2, 696, 20);
    expect(titanium.map((x) => x.commodityId)).toEqual([20]);
    const both = await suggestTo(deps, 2, 696);
    expect(both.map((x) => x.commodityId).sort()).toEqual([10, 20]);
  });

  it('logs the destination, the filter, the trace and the results', async () => {
    await suggestTo(deps, 2, 696, GOLD);
    const lines = suggestLines('to');
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('debug');
    const ctx = JSON.parse(lines[0].line.slice(lines[0].line.indexOf('{')));
    expect(ctx).toMatchObject({
      now: NOW, destId: 2, freeScu: 696,
      filters: { commodityId: GOLD, starSystemId: 68, budget: null, sort: 'uecPerHour', topN: 5 },
      trace: { considered: 1, kept: 1 },
    });
    expect(ctx.options[0]).toMatchObject({
      commodity: 'GOLD', originId: 1, destId: 2,
      buy: { price: 6120, source: 'own', temp: 'hot' }, sell: { price: 6900, source: 'uex' },
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Task 25a: answer from the cache first, report the progress of the distance requests
// ---------------------------------------------------------------------------------------------

const cached = { distances: 'cached' } as const;
const noUexCalls = () => expect([uex.routeCalls, uex.distanceCalls]).toEqual([[], []]);
const seedDistances = (rows: Array<[number, number, number | null]>) => putDistances(db, rows.map(([a, b, gm]) => ({ a, b, gm })));
const warnings = () => sink.lines.filter((l) => l.level === 'warn' && l.line.startsWith('[suggest]'));

describe("suggestFromDetailed, distances 'cached'", () => {
  it('asks UEX nothing, answers without a time and counts the distances it lacks', async () => {
    const r = await suggestFromDetailed(deps, 1, 696, undefined, cached);
    expect(r.options.map((x) => x.destId)).toEqual([2, 3]);
    expect(r.options.map((x) => [x.timeSec, x.timeSource, x.uecPerHour])).toEqual([[null, null, null], [null, null, null]]);
    expect(r.missing).toBe(2);
    noUexCalls();
    expect(await getMeta(db, 'routes_fetched:1')).toBeNull();      // not even an attempt is recorded
    expect(await loadDistances(db)).toEqual(new Map());
  });

  it('times the trips whose distance is in the cache and counts only the others', async () => {
    await seedDistances([[1, 2, 59]]);
    const r = await suggestFromDetailed(deps, 1, 696, undefined, cached);
    expect(r.options.map((x) => [x.destId, x.timeSec])).toEqual([[2, 1015], [3, null]]);
    expect(r.missing).toBe(1);
    noUexCalls();
  });

  it('counts nothing for a distance that is recorded as unknown', async () => {
    await seedDistances([[1, 2, null], [1, 3, null]]);
    const r = await suggestFromDetailed(deps, 1, 696, undefined, cached);
    expect(r.missing).toBe(0);
    expect(r.options.map((x) => x.timeSec)).toEqual([null, null]);
    noUexCalls();
  });

  it('keeps my own median time as the time of a trip without a distance', async () => {
    const r = await suggestFromDetailed({ ...deps, ownMedian: new Map([['1>3', 600]]) }, 1, 696, undefined, cached);
    expect(r.options.find((x) => x.destId === 3)).toMatchObject({ timeSec: 600, timeSource: 'own' });
    expect(r.options.find((x) => x.destId === 2)).toMatchObject({ timeSec: null });
  });

  it('counts the distances of the 20 best candidates only, as the fetching mode would ask them', async () => {
    const reference = { ...ref, terminals: new Map(ref.terminals) };
    for (let id = 101; id <= 125; id++) {
      reference.terminals.set(id, term(id, { starSystemId: 68 }));
      await addUexSell(db, id, GOLD, 7000 + id);
    }
    const r = await suggestFromDetailed({ ...deps, reference }, 1, 696, undefined, cached);
    expect(r.missing).toBe(20);
    noUexCalls();
  });

  it('counts a pair needed by two terminals once', async () => {
    // From 5 to 1 needs the pair 5-1 (asked of 5) and, because 5 is not where I stand, the empty flight 1-5 (asked of 1).
    await addUexBuy(db, 5, GOLD, 6000);
    await addUexSell(db, 1, GOLD, 7000);
    const r = await suggestFromDetailed(withNearby(deps), 1, 696, undefined, cached);
    // 1-2, 1-3, 1-5 (= 5-1), 5-2, 5-3
    expect(r.missing).toBe(5);
    noUexCalls();
  });

  it('never calls onProgress', async () => {
    const { points, onProgress } = recordProgress();
    await suggestFromDetailed(deps, 1, 696, undefined, { ...cached, onProgress });
    expect(points).toEqual([]);
  });

  it('logs the mode and what is missing, and no distance was ensured', async () => {
    await suggestFromDetailed(deps, 1, 696, undefined, cached);
    const ctx = JSON.parse(suggestLines('from').at(-1)!.line.replace(/^[^{]*/, ''));
    expect(ctx).toMatchObject({ distances: 'cached', missing: 2, ensured: [] });
  });
});

describe("suggestFromDetailed, distances 'fetch'", () => {
  it('is the default and answers as suggestFrom does', async () => {
    const r = await suggestFromDetailed(deps, 1, 696);
    expect(r.options.map((x) => [x.destId, x.timeSec])).toEqual([[2, 1015], [3, 1025]]);
    expect(r.missing).toBe(0);
    expect(uex.routeCalls).toEqual([1]);
    const explicit = await suggestFromDetailed(deps, 1, 696, undefined, { distances: 'fetch' });
    expect(explicit).toEqual(r);
  });

  it('makes suggestFrom the options of the detailed answer', async () => {
    const detailed = await suggestFromDetailed(deps, 1, 696, GOLD);
    expect(await suggestFrom(deps, 1, 696, GOLD)).toEqual(detailed.options);
  });

  it('is followed by the same answer from the cache, with nothing missing', async () => {
    const fetched = await suggestFromDetailed(deps, 1, 696);
    uex.routeCalls.length = 0;
    expect(await suggestFromDetailed(deps, 1, 696, undefined, cached)).toEqual(fetched);
    expect(fetched.missing).toBe(0);
    noUexCalls();
  });

  it('reports what is still missing when UEX is down, and the cache says the same', async () => {
    uex.failRoutes = true;
    uex.failDistances = () => true;
    const fetched = await suggestFromDetailed(deps, 1, 696);
    expect(fetched.missing).toBe(2);
    expect(fetched.options.map((x) => x.timeSec)).toEqual([null, null]);
    expect(await suggestFromDetailed(deps, 1, 696, undefined, cached)).toEqual(fetched);
  });

  it('reports the best candidates the 20-candidate limit left out, which the next run would ask', async () => {
    const reference = { ...ref, terminals: new Map(ref.terminals) };
    for (let id = 101; id <= 125; id++) {
      reference.terminals.set(id, term(id, { starSystemId: 68 }));
      await addUexSell(db, id, GOLD, 7000 + id);
    }
    uex.failRoutes = true;
    const d = { ...deps, reference };
    const fetched = await suggestFromDetailed(d, 1, 696);
    expect(uex.distanceCalls).toHaveLength(20);
    expect(fetched.missing).toBe(7);                        // 101-105 and the terminals 2 and 3
    expect(await suggestFromDetailed(d, 1, 696, undefined, cached)).toEqual(fetched);
  });

  it('logs the mode and what is missing after the requests', async () => {
    uex.routes = [{ destId: 2, gm: 59 }];
    uex.failDistances = () => true;
    await suggestFromDetailed(deps, 1, 696);
    const ctx = JSON.parse(suggestLines('from').at(-1)!.line.replace(/^[^{]*/, ''));
    expect(ctx).toMatchObject({ distances: 'fetch', missing: 1, ensured: [{ from: 1, pairs: 2 }] });
  });
});

describe('suggestFromDetailed progress', () => {
  it('counts the route list and every pair, and shrinks the plan when the route list covers the pairs', async () => {
    const { points, onProgress } = recordProgress();
    await suggestFromDetailed(deps, 1, 696, undefined, { onProgress });
    // planned: the route list and two pairs; the route list answered both pairs
    expect(points).toEqual([{ done: 0, total: 3 }, { done: 1, total: 1 }]);
    expectSoundProgress(points);
  });

  it('counts each single pair that the route list did not cover', async () => {
    uex.routes = [{ destId: 2, gm: 59 }];
    const { points, onProgress } = recordProgress();
    await suggestFromDetailed(deps, 1, 696, undefined, { onProgress });
    expect(points).toEqual([{ done: 0, total: 3 }, { done: 1, total: 2 }, { done: 2, total: 2 }]);
    expect(uex.distanceCalls).toEqual([[1, 3]]);
  });

  it('counts a failed request as done and drops the pairs it stopped', async () => {
    uex.routes = [];
    uex.failDistances = (_a, b) => b === 2;                 // the first pair fails: the second is not asked
    const { points, onProgress } = recordProgress();
    const r = await suggestFromDetailed(deps, 1, 696, undefined, { onProgress });
    expect(points).toEqual([{ done: 0, total: 3 }, { done: 1, total: 3 }, { done: 2, total: 2 }]);
    expectSoundProgress(points);
    expect(r.missing).toBe(2);
    expect(uex.distanceCalls).toEqual([[1, 2]]);
  });

  it('keeps the plan when a request that is not the last fails', async () => {
    uex.routes = [];
    uex.failDistances = (_a, b) => b === 3;
    const { points, onProgress } = recordProgress();
    const r = await suggestFromDetailed(deps, 1, 696, undefined, { onProgress });
    expect(points).toEqual([{ done: 0, total: 3 }, { done: 1, total: 3 }, { done: 2, total: 3 }, { done: 3, total: 3 }]);
    expect(r.missing).toBe(1);
  });

  it('counts a route list that failed, and goes on with the pairs', async () => {
    uex.failRoutes = true;
    const { points, onProgress } = recordProgress();
    const r = await suggestFromDetailed(deps, 1, 696, undefined, { onProgress });
    expect(points).toEqual([{ done: 0, total: 3 }, { done: 1, total: 3 }, { done: 2, total: 3 }, { done: 3, total: 3 }]);
    expect(r.missing).toBe(0);
  });

  it('with everything failing still ends at done === total', async () => {
    uex.failRoutes = true;
    uex.failDistances = () => true;
    const { points, onProgress } = recordProgress();
    await suggestFromDetailed(deps, 1, 696, undefined, { onProgress });
    expectSoundProgress(points);
    expect(points.at(-1)).toEqual({ done: 2, total: 2 });    // the route list and the first pair
  });

  it('is not called when nothing has to be requested', async () => {
    await seedDistances([[1, 2, 59], [1, 3, 61]]);
    const { points, onProgress } = recordProgress();
    const r = await suggestFromDetailed(deps, 1, 696, undefined, { onProgress });
    expect(points).toEqual([]);
    expect(r.missing).toBe(0);
    noUexCalls();
  });

  it('covers the whole series of several terminals, one request at a time', async () => {
    await addUexBuy(db, 5, GOLD, 6000);
    const { points, onProgress } = recordProgress();
    await suggestFromDetailed(withNearby(deps), 1, 696, undefined, { onProgress });
    expectSoundProgress(points);
    const requests = uex.routeCalls.length + uex.distanceCalls.length;
    expect(points.at(-1)).toEqual({ done: requests, total: requests });
    expect(points[0].total).toBeGreaterThan(requests);       // the plan was larger: the route lists covered pairs
    expect(uex.maxInFlight).toBe(1);
  });

  it('lowers the total when a pair asked of one terminal was already answered for another', async () => {
    await addUexBuy(db, 5, GOLD, 6000);
    await addUexSell(db, 1, GOLD, 7000);
    uex.failRoutes = true;                                   // pairs only: 5-1 is asked once, 1-5 is the same pair
    const { points, onProgress } = recordProgress();
    const r = await suggestFromDetailed(withNearby(deps), 1, 696, undefined, { onProgress });
    expectSoundProgress(points);
    expect(points[0]).toEqual({ done: 0, total: 8 });        // two groups: the route list and three pairs each
    expect(points.at(-1)).toEqual({ done: 7, total: 7 });
    expect(uex.routeCalls).toHaveLength(2);
    expect(uex.distanceCalls).toHaveLength(5);
    expect(r.missing).toBe(0);
  });

  it('survives a callback that throws: the answer, the cache and every request are as without it', async () => {
    const calls: number[] = [];
    const r = await suggestFromDetailed(deps, 1, 696, undefined, {
      onProgress: (p) => { calls.push(p.done); throw new Error('the screen is gone'); },
    });
    expect(calls).toEqual([0, 1]);                           // it is called again after it threw
    expect(r.options.map((x) => [x.destId, x.timeSec])).toEqual([[2, 1015], [3, 1025]]);
    expect(r.missing).toBe(0);
    expect(await loadDistances(db)).toEqual(new Map([[distKey(1, 2), 59], [distKey(1, 3), 61]]));
    expect(warnings()).toHaveLength(2);
    expect(warnings()[0].line).toContain('the screen is gone');
  });

  it('survives a callback that throws a value that is not an Error', async () => {
    const r = await suggestFromDetailed(deps, 1, 696, undefined, { onProgress: () => { throw 'plain text'; } });
    expect(r.options).toHaveLength(2);
    expect(warnings()[0].line).toContain('plain text');
  });
});

describe('suggestFromDetailed progress across terminals', () => {
  it('stays sound and ends complete when a request of an earlier terminal fails and a later one still runs', async () => {
    await addUexBuy(db, 5, GOLD, 6000);
    uex.failRoutes = true;                                   // pairs only
    uex.failDistances = (a) => a === 5;                      // the pairs asked of terminal 5 (the first group) fail
    const { points, onProgress } = recordProgress();
    const r = await suggestFromDetailed(withNearby(deps), 1, 696, undefined, { onProgress });
    // terminal 5: the route list and two pairs planned (3), terminal 1: the route list and three pairs (4);
    // the first pair of 5 fails, so its second pair is dropped; terminal 1 goes on with all of its own
    expect(points).toEqual([
      { done: 0, total: 7 }, { done: 1, total: 7 }, { done: 2, total: 6 },
      { done: 3, total: 6 }, { done: 4, total: 6 }, { done: 5, total: 6 }, { done: 6, total: 6 },
    ]);
    expectSoundProgress(points);
    expect(uex.routeCalls).toEqual([5, 1]);
    expect(uex.distanceCalls).toEqual([[5, 2], [1, 5], [1, 2], [1, 3]]);
    expect(uex.maxInFlight).toBe(1);
    expect(r.missing).toBe(2);                               // 5-2 and 5-3 are still unknown
  });
});

describe('suggestFromDetailed, cached then fetch then cached', () => {
  it('leaves no trace in the first call, and the third call returns what the second did', async () => {
    const first = await suggestFromDetailed(deps, 1, 696, undefined, cached);
    expect(first.missing).toBe(2);
    noUexCalls();
    expect(await loadDistances(db)).toEqual(new Map());
    expect(await getMeta(db, 'routes_fetched:1')).toBeNull();

    const second = await suggestFromDetailed(deps, 1, 696);
    expect(second.missing).toBe(0);
    expect(second.options.map((x) => x.timeSec)).toEqual([1015, 1025]);
    expect(uex.routeCalls).toEqual([1]);

    uex.routeCalls.length = 0;
    const third = await suggestFromDetailed(deps, 1, 696, undefined, cached);
    expect(third).toEqual(second);
    noUexCalls();
    expect(third.options).not.toEqual(first.options);        // the first answer had no times
  });
});

describe('what a suggestion spends on planning', () => {
  it('reads nothing for a plan when nobody asked for progress', async () => {
    const counted = countingDb(db);
    await suggestFromDetailed({ ...deps, db: counted.db }, 1, 696);
    // the table once for the ranking and once in the one terminal's ensureDistances; the meta once (is its route list due)
    expect(counted.reads()).toEqual({ distances: 2, meta: 1 });
  });

  it('with progress the plan costs one meta read per terminal and no read of the distance table', async () => {
    const counted = countingDb(db);
    const { onProgress } = recordProgress();
    await suggestFromDetailed({ ...deps, db: counted.db }, 1, 696, undefined, { onProgress });
    expect(counted.reads()).toEqual({ distances: 2, meta: 2 });
  });

  it('reads the table once per terminal, however many terminals are asked', async () => {
    await addUexBuy(db, 5, GOLD, 6000);
    const counted = countingDb(db);
    await suggestFromDetailed(withNearby({ ...deps, db: counted.db }), 1, 696);
    expect(uex.routeCalls.sort()).toEqual([1, 5]);
    expect(counted.reads()).toEqual({ distances: 3, meta: 2 });
  });

  it("reads nothing but the table once in the 'cached' mode", async () => {
    const counted = countingDb(db);
    await suggestFromDetailed({ ...deps, db: counted.db }, 1, 696, undefined, cached);
    expect(counted.reads()).toEqual({ distances: 1, meta: 0 });
  });
});

describe('suggestToDetailed', () => {
  it("'cached' asks UEX nothing and counts the pair of every origin", async () => {
    const r = await suggestToDetailed(deps, 2, 696, undefined, cached);
    expect(r.options.map((x) => [x.originId, x.timeSec])).toEqual([[1, null]]);
    expect(r.missing).toBe(1);
    noUexCalls();
    const ctx = JSON.parse(suggestLines('to').at(-1)!.line.replace(/^[^{]*/, ''));
    expect(ctx).toMatchObject({ distances: 'cached', missing: 1 });
  });

  it("'cached' times what the cache knows", async () => {
    await seedDistances([[1, 2, 59]]);
    const r = await suggestToDetailed(deps, 2, 696, undefined, cached);
    expect(r.options.map((x) => [x.originId, x.timeSec])).toEqual([[1, 1015]]);
    expect(r.missing).toBe(0);
  });

  it("'fetch' reports progress and is followed by the same answer from the cache", async () => {
    await addUexBuy(db, 5, GOLD, 6000);
    uex.routes = [{ destId: 1, gm: 59 }];                    // the route list of 2 covers 1-2 but not 5-2
    const { points, onProgress } = recordProgress();
    const fetched = await suggestToDetailed(deps, 2, 696, undefined, { onProgress });
    expect(points).toEqual([{ done: 0, total: 3 }, { done: 1, total: 2 }, { done: 2, total: 2 }]);
    expectSoundProgress(points);
    expect(fetched.missing).toBe(0);
    expect(uex.routeCalls).toEqual([2]);
    expect(uex.distanceCalls).toEqual([[5, 2]]);
    expect(await suggestToDetailed(deps, 2, 696, undefined, cached)).toEqual(fetched);
    const ctx = JSON.parse(suggestLines('to').at(0)!.line.replace(/^[^{]*/, ''));
    expect(ctx).toMatchObject({ distances: 'fetch', missing: 0 });
  });

  it('makes suggestTo the options of the detailed answer', async () => {
    const detailed = await suggestToDetailed(deps, 2, 696);
    expect(await suggestTo(deps, 2, 696)).toEqual(detailed.options);
  });

  it('survives a callback that throws', async () => {
    const r = await suggestToDetailed(deps, 2, 696, undefined, { onProgress: () => { throw new Error('boom'); } });
    expect(r.options.map((x) => x.originId)).toEqual([1]);
    expect(warnings().length).toBeGreaterThan(0);
  });
});
