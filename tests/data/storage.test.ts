import { beforeEach, describe, expect, it } from 'vitest';
import { runTotals } from '../../src/core/run';
import { routeStats, sessions } from '../../src/core/stats';
import { storageLines, storageLosses, linesAt, placeKey } from '../../src/core/storage';
import type { Terminal } from '../../src/core/types';
import type { Db } from '../../src/data/db';
import { latestObservations } from '../../src/data/repo/diary';
import { allRecordTimestamps, getActiveRun, listRuns } from '../../src/data/repo/runs';
import { listStorageEntries } from '../../src/data/repo/storage';
import {
  editTrade, fixStorage, loadFromStorage, loseCargo, recordMark, recordPurchase, recordSell, recordSellFromStorage, TradeError, writeOffStorage,
} from '../../src/data/trade';
import type { TradeDeps } from '../../src/data/trade';
import { NOW, sellIn, tradeFixture } from '../helpers/trade-fixtures';
import type { Clock } from '../helpers/trade-fixtures';

// Version 1.4: the storage of a place (party-mode.md sections 22–23). The Hercules of the fixture holds 696 SCU; Gold (10) is bought at
// terminal 1 and sold at terminal 2.

let db: Db;
let clock: Clock;
let deps: TradeDeps;

beforeEach(async () => {
  ({ db, clock, deps } = await tradeFixture());
});

const lines = async () => storageLines(await listStorageEntries(db));
const GOLD = { terminalId: 1, commodityId: 10 };

describe('a purchase over the hold', () => {
  it('takes into the hold what is not left at the storage, and the run invests only that', async () => {
    const run = await recordPurchase(deps, { ...GOLD, scu: 1000, price: 6000, knownScu: 1500, toStorage: 304 });
    expect(run?.events.map((e) => [e.type, e.scu, e.price])).toEqual([['buy', 696, 6000]]);
    expect(runTotals(run!.run, run!.events, NOW).invested).toBe(696 * 6000);
    expect(await lines()).toEqual([{ ...GOLD, scu: 304, cost: 304 * 6000, price: 6000, since: NOW }]);
    // the whole purchase left the seller: 1500 less 1000
    expect([...(await latestObservations(db)).values()][0]).toMatchObject({ side: 'buy', price: 6000, scu: 500 });
  });

  it('starts no run when everything is left at the storage', async () => {
    expect(await recordPurchase(deps, { ...GOLD, scu: 300, price: 6000, toStorage: 300 })).toBeNull();
    expect(await getActiveRun(db)).toBeNull();
    expect((await lines())[0]).toMatchObject({ scu: 300, price: 6000 });
  });

  it('still refuses what does not fit the hold, and a storage part above the purchase', async () => {
    await expect(recordPurchase(deps, { ...GOLD, scu: 1000, price: 6000, toStorage: 100 })).rejects.toMatchObject({ code: 'no_space' });
    await expect(recordPurchase(deps, { ...GOLD, scu: 10, price: 6000, toStorage: 11 })).rejects.toMatchObject({ code: 'bad_input' });
    expect(await lines()).toEqual([]);
  });
});

describe('«Погрузил»', () => {
  it('is a purchase of the run at the place of the storage and at its average price, and empties the line', async () => {
    await recordPurchase(deps, { ...GOLD, scu: 100, price: 6000, toStorage: 100 });
    clock.advance(60);
    await recordPurchase(deps, { ...GOLD, scu: 100, price: 5000, toStorage: 100 });
    clock.advance(60);
    const run = await loadFromStorage(deps, { ...GOLD, scu: 200 });
    expect(run.events.map((e) => [e.type, e.terminalId, e.scu, e.price, e.storage])).toEqual([['buy', 1, 200, 5500, 'load']]);
    expect(await lines()).toEqual([]);
  });

  it('is refused for more than lies there and for more than the hold takes', async () => {
    await recordPurchase(deps, { ...GOLD, scu: 900, price: 6000, toStorage: 900 });
    await expect(loadFromStorage(deps, { ...GOLD, scu: 901 })).rejects.toMatchObject({ code: 'no_stock' });
    await expect(loadFromStorage(deps, { ...GOLD, scu: 697 })).rejects.toMatchObject({ code: 'no_space' });
    await expect(loadFromStorage(deps, { ...GOLD, scu: 0 })).rejects.toBeInstanceOf(TradeError);
    expect((await lines())[0].scu).toBe(900);
  });

  it('makes the second trip a run of the same route, with its own money and time', async () => {
    await recordPurchase(deps, { ...GOLD, scu: 1000, price: 6000, toStorage: 304 });
    clock.advance(100);
    await recordMark(deps, 'depart');
    clock.advance(600);
    await recordMark(deps, 'arrive');
    await recordSell(deps, sellIn(696, 7000));
    clock.advance(900);
    await loadFromStorage(deps, { ...GOLD, scu: 304 });
    clock.advance(100);
    await recordMark(deps, 'depart');
    clock.advance(600);
    await recordMark(deps, 'arrive');
    await recordSell(deps, sellIn(304, 7000));
    const [stat] = routeStats(await listRuns(db));
    expect(stat).toMatchObject({ originId: 1, destId: 2, runs: 2, totalProfit: 1000 * 1000, medianDurationSec: 700 });
  });

  it('can be corrected in its quantity, and the storage follows; not in its price', async () => {
    await recordPurchase(deps, { ...GOLD, scu: 500, price: 6000, toStorage: 500 });
    const run = await loadFromStorage(deps, { ...GOLD, scu: 200 });
    const load = run.events[0];
    await editTrade(deps, { eventId: load.id, scu: 300, price: 6000 });
    expect((await lines())[0].scu).toBe(200);
    await expect(editTrade(deps, { eventId: load.id, scu: 300, price: 5000 })).rejects.toMatchObject({ code: 'bad_input' });
    await expect(editTrade(deps, { eventId: load.id, scu: 501, price: 6000 })).rejects.toMatchObject({ code: 'no_stock' });
  });
});

describe('a sale of goods that lie at the storage («Погрузил» forgotten)', () => {
  it('writes the load late and the sale: a run of the route, with its profit and out of every time', async () => {
    await recordPurchase(deps, { ...GOLD, scu: 400, price: 6000, toStorage: 400 });
    clock.advance(3600);
    const { run, finished } = await recordSellFromStorage(deps, sellIn(400, 7000), 1);
    expect(finished).toBe(true);
    expect(run.events.map((e) => [e.type, e.storage ?? null])).toEqual([['buy', 'late'], ['sell', null]]);
    expect(await lines()).toEqual([]);
    const [stat] = routeStats(await listRuns(db));
    expect(stat).toMatchObject({ runs: 1, totalProfit: 400 * 1000, uecPerHour: null });
  });
});

describe('«Груз потерян» with how much was aboard', () => {
  it('puts back what was never aboard and loses only the rest', async () => {
    await recordPurchase(deps, { ...GOLD, scu: 600, price: 6000, toStorage: 0 });
    const lost = await loseCargo(deps, 200);
    expect(lost.run.status).toBe('lost');
    expect(runTotals(lost.run, lost.events, NOW).profit).toBe(-200 * 6000);
    expect(lost.events.at(-1)).toMatchObject({ type: 'sell', terminalId: 1, scu: 400, price: 6000, storage: 'back' });
    expect((await lines())[0]).toMatchObject({ ...GOLD, scu: 400, price: 6000 });
  });

  it('loses everything without the number, as before', async () => {
    await recordPurchase(deps, { ...GOLD, scu: 600, price: 6000, toStorage: 0 });
    await loseCargo(deps);
    expect(await lines()).toEqual([]);
  });
});

describe('the lines of the storage', () => {
  it('are written off as a loss of the session of that moment, and corrected without one', async () => {
    await recordPurchase(deps, { ...GOLD, scu: 500, price: 6000, toStorage: 500 });
    clock.advance(60);
    await writeOffStorage(deps, { ...GOLD, scu: 100 });
    await expect(writeOffStorage(deps, { ...GOLD, scu: 401 })).rejects.toMatchObject({ code: 'no_stock' });
    const entries = await listStorageEntries(db);
    expect(storageLosses(entries)).toEqual([{ ts: NOW + 60, cost: 600_000 }]);
    const [session] = sessions(await allRecordTimestamps(db), await listRuns(db), undefined, storageLosses(entries));
    expect(session.profit).toBe(-600_000);

    await fixStorage(deps, { ...GOLD, scu: 350, price: 5000 });
    expect((await lines())[0]).toMatchObject({ scu: 350, price: 5000 });
    expect(storageLosses(await listStorageEntries(db))).toHaveLength(1);
  });

  it('belong to the place: two terminals of one station share them', () => {
    const at = (id: number, station: string | null): Terminal => ({ id, starSystemId: 68, spaceStationName: station, outpostName: null, cityName: null } as Terminal);
    const terminals = new Map([[1, at(1, 'Everus Harbor')], [2, at(2, 'Everus Harbor')], [3, at(3, null)]]);
    expect(placeKey(terminals.get(1)!)).toBe(placeKey(terminals.get(2)!));
    const line = { terminalId: 1, commodityId: 10, scu: 5, cost: 5, price: 1, since: 0 };
    expect(linesAt([line], terminals, 2)).toEqual([line]);
    expect(linesAt([line], terminals, 3)).toEqual([]);
  });
});
