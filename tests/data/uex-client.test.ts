import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLogger, memorySink } from '../../src/data/logger';
import {
  UEX_BASE, UEX_MIN_GAP_MS, UexError, createUexClient, isNetworkFailure, isRateLimit, isUnreachable,
} from '../../src/data/uex-client';

// Real UEX responses, trimmed to the first rows by hand (see tests/fixtures/uex).
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/uex/${name}.json`, import.meta.url), 'utf8'));

const starSystemsFx = fixture('star_systems');
const terminalsFx = fixture('terminals');
const commoditiesFx = fixture('commodities');
const vehiclesFx = fixture('vehicles');
const companiesFx = fixture('companies');
const pricesFx = fixture('prices');
const routesFx = fixture('routes');

let sink: ReturnType<typeof memorySink>;
let log: ReturnType<typeof createLogger>;
let calls: string[];

beforeEach(() => {
  sink = memorySink();
  log = createLogger(sink);
  calls = [];
});

// Answers any URL that contains one of the fixture keys with that fixture.
const client = (fixtures: Record<string, unknown>, status = 200) =>
  createUexClient(async (url) => {
    const key = Object.keys(fixtures).find((k) => url.includes(k));
    calls.push(url);
    return { status, body: fixtures[key!] };
  }, log);

describe('uex client: reference data', () => {
  it('maps star systems', async () => {
    const all = await client({ star_systems: starSystemsFx }).starSystems();
    expect(all.find((s) => s.id === 68)).toEqual({ id: 68, name: 'Stanton', code: 'ST', isAvailableLive: true });
    expect(all.find((s) => s.id === 1)).toMatchObject({ name: '78 Leonis', isAvailableLive: false });
    expect(calls.at(-1)).toBe(`${UEX_BASE}/star_systems`);
  });

  it('maps terminals', async () => {
    const c = client({ 'terminals?type=commodity': terminalsFx });
    const t = (await c.terminals(68)).find((x) => x.id === 1)!;
    expect(t).toMatchObject({
      nickname: 'ARC-L1', code: 'ARCL1', starSystemId: 68, starSystemName: 'Stanton',
      hasFreightElevator: true, isAutoLoad: true,
    });
    expect(t).toMatchObject({
      planetId: 4, orbitId: 326, displayname: 'ARC-L1 Wide Forest Station', name: 'Admin - ARC-L1',
      planetName: 'ArcCorp', orbitName: 'ArcCorp Lagrange Point 1', spaceStationName: 'ARC-L1 Wide Forest Station',
      moonName: null, outpostName: null, cityName: null, hasLoadingDock: false, isAvailableLive: true,
    });
    // Never the unfiltered list: it is too big for a throttled network. One request per star system.
    expect(calls.at(-1)).toBe(`${UEX_BASE}/terminals?type=commodity&id_star_system=68`);
  });

  it('asks for the terminals of the requested star system', async () => {
    await client({ terminals: { status: 'ok', data: [] } }).terminals(64);
    expect(calls.at(-1)).toBe('https://api.uexcorp.uk/2.0/terminals?type=commodity&id_star_system=64');
  });

  it('maps commodities', async () => {
    const all = await client({ commodities: commoditiesFx }).commodities();
    expect(all.find((x) => x.id === 1)).toEqual({
      id: 1, name: 'Agricium', code: 'AGRI', isIllegal: false, isBuyable: true, isSellable: true, isAvailableLive: true,
    });
    expect(all.find((x) => x.id === 4)).toMatchObject({ name: 'Altruciatoxin', isIllegal: true });
    expect(calls.at(-1)).toBe(`${UEX_BASE}/commodities`);
  });

  it('maps vehicles', async () => {
    const all = await client({ vehicles: vehiclesFx }).vehicles(195);
    expect(all.find((v) => v.id === 13)).toEqual({ id: 13, name: '890 Jump', nameFull: 'Origin 890 Jump', scu: 388 });
    // Never the unfiltered list: it stalls on a throttled network. One request per manufacturer.
    expect(calls.at(-1)).toBe('https://api.uexcorp.uk/2.0/vehicles?id_company=195');
  });

  it('maps vehicle manufacturers to company ids', async () => {
    const ids = await client({ companies: companiesFx }).vehicleManufacturers();
    expect(ids).toHaveLength(19);
    expect(ids).toEqual(expect.arrayContaining([8, 195, 217, 318]));
    expect(ids.every((id) => Number.isInteger(id))).toBe(true);
    expect(calls.at(-1)).toBe('https://api.uexcorp.uk/2.0/companies?is_vehicle_manufacturer=1');
  });

  it('coerces company ids and skips companies without one', async () => {
    const data = [{ id: '8', name: 'Aegis' }, { id: null }, { name: 'No id' }, 'junk', { id: 195 }];
    const ids = await client({ companies: { status: 'ok', data } }).vehicleManufacturers();
    expect(ids).toEqual([8, 195]);
    expect(sink.lines.map((l) => l.line)).toContain(
      '[uex] skipped malformed rows {"url":"https://api.uexcorp.uk/2.0/companies?is_vehicle_manufacturer=1","skipped":3}',
    );
  });
});

describe('uex client: prices', () => {
  it('maps prices with weekly, monthly and all-time stats', async () => {
    const p = (await client({ commodities_prices: pricesFx }).prices([12, 85])).find(
      (x) => x.terminalId === 12 && x.commodityId === 33,
    )!;
    expect(p.sell).toMatchObject({ last: 31000, avgWeek: 31000, minWeek: 31000, maxWeek: 31000 });
    expect(p.scuSell).toBe(840);
    expect(p.buy.last).toBe(0);
    expect(calls.at(-1)).toBe('https://api.uexcorp.uk/2.0/commodities_prices?id_terminal=12,85');
  });

  it('maps every stat column of a side to its own field', async () => {
    const row = {
      id_terminal: 7, id_commodity: 9, date_modified: 1700000000, scu_buy: 11, scu_sell: 22,
      scu_buy_max_week: 33, scu_buy_max: 330, scu_sell_max_week: 44, scu_sell_max: 440,
      price_buy: 1, price_buy_min_week: 2, price_buy_max_week: 3, price_buy_avg_week: 4,
      price_buy_min_month: 5, price_buy_max_month: 6, price_buy_avg_month: 7,
      price_buy_min: 8, price_buy_max: 9, price_buy_avg: 10,
      price_sell: 101, price_sell_min_week: 102, price_sell_max_week: 103, price_sell_avg_week: 104,
      price_sell_min_month: 105, price_sell_max_month: 106, price_sell_avg_month: 107,
      price_sell_min: 108, price_sell_max: 109, price_sell_avg: 110,
    };
    const [p] = await client({ commodities_prices: { status: 'ok', data: [row] } }).prices([7]);
    expect(p).toEqual({
      terminalId: 7, commodityId: 9, scuBuy: 11, scuSell: 22, scuBuyMax: 33, scuSellMax: 44, dateModified: 1700000000,
      buy: { last: 1, minWeek: 2, maxWeek: 3, avgWeek: 4, minMonth: 5, maxMonth: 6, avgMonth: 7, min: 8, max: 9, avg: 10 },
      sell: { last: 101, minWeek: 102, maxWeek: 103, avgWeek: 104, minMonth: 105, maxMonth: 106, avgMonth: 107, min: 108, max: 109, avg: 110 },
    });
  });

  it('maps the stock maximum from the week, falling back to all-time', async () => {
    const rows = [{ id_terminal: 1, id_commodity: 2, scu_buy_max_week: 0, scu_buy_max: 900, scu_sell_max_week: 1088, scu_sell_max: 2000 }];
    const [p] = await client({ commodities_prices: { status: 'ok', data: rows } }).prices([1]);
    expect(p.scuBuyMax).toBe(900); expect(p.scuSellMax).toBe(1088);
  });

  it('leaves the stock maximum at zero when UEX sends none, and reads numeric strings', async () => {
    const rows = [
      { id_terminal: 1, id_commodity: 2 },
      { id_terminal: 1, id_commodity: 3, scu_buy_max_week: null, scu_buy_max: null, scu_sell_max_week: '640', scu_sell_max: 'abc' },
    ];
    const [none, text] = await client({ commodities_prices: { status: 'ok', data: rows } }).prices([1]);
    expect(none).toMatchObject({ scuBuyMax: 0, scuSellMax: 0 });
    expect(text).toMatchObject({ scuBuyMax: 0, scuSellMax: 640 });
  });

  it('rejects an empty list and more than ten terminals', async () => {
    await expect(client({}).prices([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).rejects.toBeInstanceOf(RangeError);
    await expect(client({}).prices([])).rejects.toBeInstanceOf(RangeError);
    expect(calls).toEqual([]);
  });

  it('accepts exactly ten terminals', async () => {
    await client({ commodities_prices: { status: 'ok', data: [] } }).prices([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(calls.at(-1)).toBe(`${UEX_BASE}/commodities_prices?id_terminal=1,2,3,4,5,6,7,8,9,10`);
  });

  it('skips rows without a usable id and says so in the log', async () => {
    const data = [
      { id_terminal: 1, id_commodity: 2, price_sell: 5 },
      { id_terminal: null, id_commodity: 2 },
      { id_terminal: 3 },
      'junk',
      null,
    ];
    const prices = await client({ commodities_prices: { status: 'ok', data } }).prices([1]);
    expect(prices.map((p) => [p.terminalId, p.commodityId])).toEqual([[1, 2]]);
    expect(sink.lines.map((l) => l.line)).toContain('[uex] skipped malformed rows {"url":"https://api.uexcorp.uk/2.0/commodities_prices?id_terminal=1","skipped":4}');
    expect(sink.lines.at(-1)!.line).toMatch(/"rows":5\}$/);
  });
});

describe('uex client: coercion', () => {
  it('coerces numeric strings and nulls', async () => {
    expect(
      await client({ terminals_distances: { status: 'ok', data: { distance: '59' } } }).distance(85, 12),
    ).toBe(59);
    const [p] = await client({
      commodities_prices: {
        status: 'ok',
        data: [{ id_terminal: 1, id_commodity: 2, price_buy: '120', price_sell: null, scu_buy: null }],
      },
    }).prices([1]);
    expect(p.buy.last).toBe(120);
    expect(p.sell.last).toBe(0);
    expect(p.scuBuy).toBe(0);
    expect(p.sell.avgWeek).toBe(0);
  });

  it('turns garbage numbers into zero and flags into booleans', async () => {
    const [p] = await client({
      commodities_prices: {
        status: 'ok',
        data: [{ id_terminal: '5', id_commodity: '6', price_buy: 'abc', price_sell: '', scu_buy: NaN, scu_sell: {}, date_modified: undefined }],
      },
    }).prices([5]);
    expect(p).toMatchObject({ terminalId: 5, commodityId: 6, scuBuy: 0, scuSell: 0, dateModified: 0 });
    expect(p.buy.last).toBe(0);
    expect(p.sell.last).toBe(0);

    const [t] = await client({
      'terminals?type=commodity': {
        status: 'ok',
        data: [{ id: 9, has_freight_elevator: '1', has_loading_dock: '0', is_auto_load: true, is_available_live: null, nickname: null }],
      },
    }).terminals(68);
    expect(t).toMatchObject({
      id: 9, hasFreightElevator: true, hasLoadingDock: false, isAutoLoad: true, isAvailableLive: false,
      nickname: '', starSystemName: null,
    });
  });

  it('returns null for an unknown distance', async () => {
    expect(
      await client({ terminals_distances: { status: 'ok', data: { distance: null } } }).distance(1, 2),
    ).toBeNull();
  });

  it('returns null when UEX answers `data: false` for an unknown pair', async () => {
    // Observed on the real API: terminals_distances for a pair it does not know.
    expect(await client({ terminals_distances: { status: 'ok', data: false } }).distance(85, 999999)).toBeNull();
  });

  it('reads the saved distance response', async () => {
    const fx = fixture('distance');
    expect(await client({ terminals_distances: fx }).distance(85, 12)).toBe(59);
    expect(calls.at(-1)).toBe(`${UEX_BASE}/terminals_distances?id_terminal_origin=85&id_terminal_destination=12`);
  });
});

describe('uex client: distances from routes', () => {
  it('reads distances from routes', async () => {
    const d = await client({ commodities_routes: routesFx }).distancesFrom(85);
    expect(d).toContainEqual({ destId: 12, gm: 59 });
    expect(calls.at(-1)).toBe(`${UEX_BASE}/commodities_routes?id_terminal_origin=85`);
  });

  it('lists each destination once even though routes repeat it per commodity', async () => {
    const d = await client({ commodities_routes: routesFx }).distancesFrom(85);
    const ids = d.map((x) => x.destId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps a known distance when another row of the same destination has none', async () => {
    const data = [
      { id_terminal_destination: 3, distance: null },
      { id_terminal_destination: 3, distance: '41' },
      { id_terminal_destination: 3, distance: 42 },
      { id_terminal_destination: 4, distance: null },
      { id_terminal_destination: 5, distance: 0 },
    ];
    const d = await client({ commodities_routes: { status: 'ok', data } }).distancesFrom(1);
    expect(d).toEqual([{ destId: 3, gm: 41 }, { destId: 5, gm: 0 }]);
  });
});

describe('uex client: errors', () => {
  it.each([
    ['status', 200, { status: 'requests_limit_reached', data: [] }],
    ['http', 500, 'Internal Server Error'],
    ['http', 429, { status: 'requests_limit_reached', data: [] }],
    ['shape', 200, { status: 'ok', data: 'nope' }],
    ['shape', 200, { status: 'ok' }],
    ['shape', 200, '<html>'],
    ['shape', 200, null],
    ['shape', 200, { data: [] }],
  ])('throws UexError kind %s (HTTP %i)', async (kind, status, body) => {
    const err = await client({ commodities: body }, status).commodities().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UexError);
    expect(err).toMatchObject({ kind, name: 'UexError' });
  });

  it('wraps network failures', async () => {
    const c = createUexClient(async () => {
      throw new Error('ECONNRESET');
    }, log);
    const err = await c.vehicles(195).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'network' });
    expect((err as UexError).message).toContain('ECONNRESET');
    expect(((err as UexError).cause as Error).message).toBe('ECONNRESET');
  });

  it('rejects a non-object distance payload as a shape error', async () => {
    await expect(client({ terminals_distances: { status: 'ok', data: 'x' } }).distance(1, 2)).rejects.toMatchObject({
      kind: 'shape',
    });
  });

  it('logs failures at warn level with the url and the kind', async () => {
    await client({ commodities: { status: 'requests_limit_reached', data: [] } }).commodities().catch(() => {});
    const last = sink.lines.at(-1)!;
    expect(last.level).toBe('warn');
    expect(last.line).toMatch(/^\[uex\] request failed \{"url":"https:\/\/api\.uexcorp\.uk\/2\.0\/commodities","kind":"status","status":200,"ms":\d+,"message":".*requests_limit_reached.*"\}$/);

    sink.lines.length = 0;
    await createUexClient(async () => {
      throw new Error('ECONNRESET');
    }, log).vehicles(195).catch(() => {});
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0].level).toBe('warn');
    expect(sink.lines[0].line).toContain('"kind":"network"');
    expect(sink.lines[0].line).toContain('/vehicles');
    expect(sink.lines[0].line).not.toContain('"status"');
  });
});

describe('uex client: logging', () => {
  it('logs every request with status, duration and row count', async () => {
    await client({ vehicles: vehiclesFx }).vehicles(195);
    expect(sink.lines.at(-1)!.line).toMatch(/^\[uex\] request \{"url":".*vehicles\?id_company=195","status":200,"ms":\d+,"rows":21\}$/);
    expect(sink.lines).toHaveLength(1);
  });

  it('measures the duration with the injected clock', async () => {
    const ticks = [1000, 1250];
    const c = createUexClient(
      async () => ({ status: 200, body: { status: 'ok', data: [{ id: 1 }, { id: 2 }, { id: 3 }] } }),
      log,
      () => ticks.shift()!,
    );
    await c.commodities();
    expect(sink.lines.at(-1)!.line).toBe(
      '[uex] request {"url":"https://api.uexcorp.uk/2.0/commodities","status":200,"ms":250,"rows":3}',
    );
  });
});

describe('uex client: the request limit (HTTP 429)', () => {
  it('is an http error that says which status it was and names the limit', async () => {
    const err = await client({ commodities: { status: 'requests_limit_reached', data: [] } }, 429).commodities().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UexError);
    expect(err).toMatchObject({ kind: 'http', httpStatus: 429 });
    expect((err as UexError).message).toContain('429');
    expect((err as UexError).message).toContain('limit');
    expect(isRateLimit(err)).toBe(true);
    expect(isNetworkFailure(err)).toBe(false);
    expect(isUnreachable(err)).toBe(true);
  });

  it('is written to the log as a failed request with the status 429, and not asked again by the client', async () => {
    await client({ commodities: { status: 'requests_limit_reached', data: [] } }, 429).commodities().catch(() => {});
    expect(calls).toHaveLength(1);
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0].level).toBe('warn');
    expect(sink.lines[0].line).toContain('"status":429');
    expect(sink.lines[0].line).toContain('limit');
  });

  it('is told apart from the other failures', async () => {
    const refused = await client({ commodities: 'oops' }, 503).commodities().catch((e: unknown) => e);
    expect(refused).toMatchObject({ kind: 'http', httpStatus: 503 });
    expect(isRateLimit(refused)).toBe(false);
    expect(isUnreachable(refused)).toBe(false);

    const stalled = await createUexClient(async () => { throw new Error('timed out after 15 s'); }, log).commodities().catch((e: unknown) => e);
    expect(stalled).toMatchObject({ kind: 'network', httpStatus: null });
    expect(isNetworkFailure(stalled)).toBe(true);
    expect(isUnreachable(stalled)).toBe(true);
    expect(isRateLimit(stalled)).toBe(false);

    expect(isRateLimit(new Error('HTTP 429'))).toBe(false); // only the client's own error counts
  });
});

describe('uex client: the gap between requests', () => {
  /**
   * A clock the test moves. `sleep` moves it by what it is asked to wait; an answer that takes `took` ms moves it as well.
   * `starts` is the time every request began.
   */
  function timeline(took: number | ((n: number) => number) = 0) {
    let now = 50_000;
    const sleeps: number[] = [];
    const starts: number[] = [];
    const fetchJson = async (_url: string) => {
      starts.push(now);
      now += typeof took === 'number' ? took : took(starts.length);
      return { status: 200, body: { status: 'ok', data: [] } };
    };
    return {
      clock: () => now, sleeps, starts, fetchJson,
      sleep: async (ms: number) => { sleeps.push(ms); now += ms; },
    };
  }

  const paced = (t: ReturnType<typeof timeline>, minGapMs?: number) =>
    createUexClient(t.fetchJson, log, t.clock, { sleep: t.sleep, ...(minGapMs === undefined ? {} : { minGapMs }) });

  it('sends the first request at once', async () => {
    const t = timeline();
    await paced(t).commodities();
    expect(t.sleeps).toEqual([]);
    expect(t.starts).toEqual([50_000]);
  });

  it('keeps quick answers at least 500 ms apart by default: a start every half second, 120 a minute at most', async () => {
    const t = timeline();
    const c = paced(t);
    for (let i = 0; i < 4; i++) await c.commodities();
    expect(t.sleeps).toEqual([500, 500, 500]);
    expect(t.starts).toEqual([50_000, 50_500, 51_000, 51_500]);
  });

  it('adds nothing when the previous request itself took longer than the gap', async () => {
    const t = timeline(800);
    const c = paced(t);
    for (let i = 0; i < 3; i++) await c.commodities();
    expect(t.sleeps).toEqual([]);
    expect(t.starts).toEqual([50_000, 50_800, 51_600]);
  });

  it('adds only what is left of the gap after a request of 200 ms', async () => {
    const t = timeline(200);
    const c = paced(t);
    await c.commodities();
    await c.commodities();
    expect(t.sleeps).toEqual([300]);
    expect(t.starts).toEqual([50_000, 50_500]);
  });

  it('counts from the START of the previous request, so a slow one and a quick one alternate without a double wait', async () => {
    const t = timeline((n) => (n % 2 === 1 ? 700 : 50));
    const c = paced(t);
    for (let i = 0; i < 4; i++) await c.commodities();
    expect(t.starts).toEqual([50_000, 50_700, 51_200, 51_900]);
    expect(t.sleeps).toEqual([450]);
  });

  it('takes the gap from the option: any interval, and none at 0', async () => {
    const slow = timeline();
    const c = paced(slow, 2000);
    await c.commodities();
    await c.commodities();
    expect(slow.sleeps).toEqual([2000]);

    const none = timeline();
    const d = paced(none, 0);
    for (let i = 0; i < 3; i++) await d.commodities();
    expect(none.sleeps).toEqual([]);
    expect(none.starts).toEqual([50_000, 50_000, 50_000]);
  });

  it('keeps no gap without the option, and then asks the clock only twice per request, as it always did', async () => {
    let reads = 0;
    const c = createUexClient(async () => ({ status: 200, body: { status: 'ok', data: [] } }), log, () => { reads++; return 1000; });
    await c.commodities();
    await c.commodities();
    expect(reads).toBe(4);
  });

  it('counts a failed request as a start too', async () => {
    const t = timeline();
    let n = 0;
    const c = createUexClient(async (url) => {
      if (n++ === 0) { t.starts.push(t.clock()); throw new Error('ECONNRESET'); }
      return t.fetchJson(url);
    }, log, t.clock, { sleep: t.sleep });
    await c.commodities().catch(() => {});
    await c.commodities();
    expect(t.starts).toEqual([50_000, 50_500]);
  });

  it('holds back requests that are asked for at once: they start one after another, a gap apart', async () => {
    const t = timeline();
    const c = paced(t);
    await Promise.all([c.commodities(), c.starSystems(), c.vehicles(195)]);
    expect(t.starts).toEqual([50_000, 50_500, 51_000]);
  });

  it('writes the duration of the request without the wait before it', async () => {
    const t = timeline(120);
    const c = paced(t);
    await c.commodities();
    await c.commodities();
    expect(sink.lines.map((l) => /"ms":(\d+)/.exec(l.line)?.[1])).toEqual(['120', '120']);
  });

  it('never waits for longer than the gap, even when the clock jumped back', async () => {
    let now = 50_000;
    const sleeps: number[] = [];
    const c = createUexClient(async () => ({ status: 200, body: { status: 'ok', data: [] } }), log, () => now, {
      sleep: async (ms) => { sleeps.push(ms); },
    });
    await c.commodities();
    now -= 3_600_000; // the player changed the system clock
    await c.commodities();
    expect(sleeps).toEqual([500]);
  });

  it('exports the default gap: 500 ms is 120 requests a minute', () => {
    expect(UEX_MIN_GAP_MS).toBe(500);
    expect(60_000 / UEX_MIN_GAP_MS).toBe(120);
  });
});
