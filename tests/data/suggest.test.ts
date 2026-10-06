import { beforeEach, describe, expect, it } from 'vitest';
import { distKey, obsKey, priceKey } from '../../src/core/types';
import type { Db } from '../../src/data/db';
import { createLogger, memorySink } from '../../src/data/logger';
import { addObservation } from '../../src/data/repo/diary';
import { getMeta, loadDistances } from '../../src/data/repo/uex-cache';
import { loadMarket, suggestFrom, suggestTo, type SuggestDeps } from '../../src/data/suggest';
import { ref, term } from '../helpers/factories';
import { FakeUex } from '../helpers/fake-uex';
import { GOLD, NOW } from '../helpers/route-fixtures';
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
