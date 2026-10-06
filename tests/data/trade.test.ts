import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/data/db';
import { latestObservations } from '../../src/data/repo/diary';
import { allRecordTimestamps, getActiveRun, listRuns } from '../../src/data/repo/runs';
import { loseCargo, recordBuy, recordMark, recordSell, TradeError } from '../../src/data/trade';
import type { TradeDeps } from '../../src/data/trade';
import { buyIn, NOW, sellIn, tradeFixture } from '../helpers/trade-fixtures';
import type { Clock, TradeFixture } from '../helpers/trade-fixtures';

let db: Db;
let sink: TradeFixture['sink'];
let clock: Clock;
let deps: TradeDeps;

beforeEach(async () => {
  ({ db, sink, clock, deps } = await tradeFixture());
});

/** How many rows each table holds: what "nothing was written" is measured by. */
async function rowCounts(): Promise<{ runs: number; events: number; observations: number }> {
  const count = async (table: string) => (await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0].n;
  return { runs: await count('run'), events: await count('run_event'), observations: await count('observation') };
}

/** The same database, but every statement that starts with `prefix` fails. */
function failingOn(inner: Db, prefix: string): Db {
  return {
    select: <T>(sql: string, params?: unknown[]) => inner.select<T>(sql, params),
    execute: (sql, params) => (sql.startsWith(prefix) ? Promise.reject(new Error('disk full')) : inner.execute(sql, params)),
  };
}

describe('recordBuy', () => {
  it('starts a run on the first buy with the ship from settings', async () => {
    const r = await recordBuy(deps, { terminalId: 1, commodityId: 10, scu: 300, price: 6000 });
    expect(r.run).toMatchObject({ status: 'active', startedAt: NOW, scuCapacity: 696, vehicleId: 7, endedAt: null });
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ runId: r.run.id, ts: NOW, type: 'buy', terminalId: 1, commodityId: 10, scu: 300, price: 6000 });
  });

  it('adds further buys to the same run', async () => {
    await recordBuy(deps, buyIn(300)); clock.advance(100);
    const r = await recordBuy(deps, buyIn(100, 6400));
    expect(r.events).toHaveLength(2); expect(r.run.startedAt).toBe(NOW);
    expect(r.events[1]).toMatchObject({ ts: NOW + 100, scu: 100, price: 6400 });
  });

  it('writes the stock left at the terminal, not the traded amount, and nothing when the stock is unknown', async () => {
    await recordBuy(deps, { ...buyIn(300), knownScu: 340 });
    expect((await latestObservations(db)).find(x => x.side === 'buy')).toMatchObject({ terminalId: 1, commodityId: 10, price: 6000, ts: NOW, scu: 40 });
    await recordBuy(deps, { ...buyIn(10, 6100), terminalId: 3 });
    expect((await latestObservations(db)).find(x => x.side === 'buy' && x.terminalId === 3)).toMatchObject({ price: 6100, scu: null });
  });

  it('never writes a negative stock when more was bought than the stock seen', async () => {
    await recordBuy(deps, { ...buyIn(300), knownScu: 100 });
    expect((await latestObservations(db))[0]).toMatchObject({ side: 'buy', scu: 0 });
  });

  it('starts a new run after the previous one is done', async () => {
    const first = await recordBuy(deps, buyIn(300));
    await recordSell(deps, sellIn(300, 7000)); clock.advance(60);
    const second = await recordBuy(deps, buyIn(50));
    expect(second.run.id).not.toBe(first.run.id);
    expect(second.run).toMatchObject({ status: 'active', startedAt: NOW + 60 });
    expect(second.events).toHaveLength(1);
  });

  it('rejects buying beyond free space, unless capacity is unset', async () => {
    await recordBuy(deps, buyIn(600));
    await expect(recordBuy(deps, buyIn(97))).rejects.toMatchObject({ code: 'no_space', message: 'Свободно только 96 SCU' });
    const loose = { ...deps, settings: { ...deps.settings, scuCapacity: 0 } };
    await expect(recordBuy(loose, buyIn(5000))).resolves.toBeDefined();
  });

  it('accepts a purchase that fills the hold exactly', async () => {
    await recordBuy(deps, buyIn(600));
    expect((await recordBuy(deps, buyIn(96))).events).toHaveLength(2);
    await expect(recordBuy(deps, buyIn(1))).rejects.toMatchObject({ code: 'no_space', message: 'Свободно только 0 SCU' });
  });

  it('counts every commodity on board against the free space', async () => {
    await recordBuy(deps, buyIn(400));
    await recordBuy(deps, { ...buyIn(200), commodityId: 20 });
    await expect(recordBuy(deps, { ...buyIn(97), commodityId: 30 })).rejects.toMatchObject({ code: 'no_space', message: 'Свободно только 96 SCU' });
  });

  it('reports no free space when the hold already exceeds a capacity lowered in settings', async () => {
    await recordBuy({ ...deps, settings: { ...deps.settings, scuCapacity: 0 } }, buyIn(800));
    await expect(recordBuy(deps, buyIn(1))).rejects.toMatchObject({ code: 'no_space', message: 'Свободно только 0 SCU' });
  });

  it('checks the space of the very first buy before a run is started', async () => {
    await expect(recordBuy(deps, buyIn(697))).rejects.toMatchObject({ code: 'no_space', message: 'Свободно только 696 SCU' });
    expect(await getActiveRun(db)).toBeNull();
    expect(await rowCounts()).toEqual({ runs: 0, events: 0, observations: 0 });
  });

  it.each([[0, 6000], [-1, 6000], [10, 0]])('rejects scu %i at price %i', async (scu, price) => {
    await expect(recordBuy(deps, { terminalId: 1, commodityId: 10, scu, price })).rejects.toMatchObject({ code: 'bad_input' });
  });

  it('rejects input that is not a finite number, with the message of the brief, and writes nothing', async () => {
    for (const bad of [{ scu: NaN, price: 6000 }, { scu: Infinity, price: 6000 }, { scu: 10, price: NaN }, { scu: 10, price: -5 }]) {
      await expect(recordBuy(deps, { terminalId: 1, commodityId: 10, ...bad })).rejects.toMatchObject({
        code: 'bad_input', message: 'Количество и цена должны быть больше нуля',
      });
    }
    expect(await rowCounts()).toEqual({ runs: 0, events: 0, observations: 0 });
  });

  it('throws TradeError instances', async () => {
    const err = await recordBuy(deps, buyIn(0)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TradeError);
    expect(err).toBeInstanceOf(Error);
    expect((err as TradeError).name).toBe('TradeError');
  });
});

describe('recordSell', () => {
  it('writes no quantity for a sale when the buyer inventory was not seen, and still the stock left at the purchase', async () => {
    await recordBuy(deps, { ...buyIn(300), knownScu: 340 });
    await recordSell(deps, sellIn(100, 6900));
    const o = await latestObservations(db);
    expect(o.find(x => x.side === 'buy')).toMatchObject({ terminalId: 1, price: 6000, scu: 40 });
    expect(o.find(x => x.side === 'sell')).toMatchObject({ terminalId: 2, price: 6900, scu: null });
  });

  it('a sale records the buyer inventory after the sale', async () => {
    await recordBuy(deps, buyIn(300));
    await recordSell(deps, { ...sellIn(100, 6900), knownScu: 250 });
    expect((await latestObservations(db)).find(o => o.side === 'sell')).toMatchObject({ scu: 350 });
  });

  it('adds what was sold to the inventory seen, whatever it was, an empty buyer included', async () => {
    await recordBuy(deps, buyIn(300));
    await recordSell(deps, { ...sellIn(100, 6900), knownScu: 250 });
    expect((await latestObservations(db)).find(x => x.side === 'sell')).toMatchObject({ terminalId: 2, price: 6900, scu: 350 });
    await recordSell(deps, { ...sellIn(100, 6950), knownScu: 60 });
    expect((await latestObservations(db)).find(x => x.side === 'sell')).toMatchObject({ price: 6950, scu: 160 });
    await recordBuy(deps, buyIn(50));
    await recordSell(deps, { ...sellIn(50, 7000), knownScu: 0 });          // "0 SCU, out of stock": the best buyer
    expect((await latestObservations(db)).find(x => x.side === 'sell')).toMatchObject({ price: 7000, scu: 50 });
  });

  it('finishes the run when the hold is empty', async () => {
    await recordBuy(deps, buyIn(300)); clock.advance(2000);
    expect((await recordSell(deps, sellIn(100, 6900))).finished).toBe(false);
    clock.advance(400);
    const r = await recordSell(deps, sellIn(200, 7000));
    expect(r.finished).toBe(true); expect(r.run.run).toMatchObject({ status: 'done', endedAt: NOW + 2400 });
    expect(await getActiveRun(db)).toBeNull();
  });

  it('returns the run with all its events, the sale last', async () => {
    await recordBuy(deps, buyIn(300)); clock.advance(10);
    const r = await recordSell(deps, sellIn(100, 6900));
    expect(r.run.events.map(e => e.type)).toEqual(['buy', 'sell']);
    expect(r.run.events[1]).toMatchObject({ ts: NOW + 10, terminalId: 2, commodityId: 10, scu: 100, price: 6900 });
    expect(r.run.run.status).toBe('active');
  });

  it('keeps the run open while another commodity is still on board', async () => {
    await recordBuy(deps, buyIn(100));
    await recordBuy(deps, { ...buyIn(50, 3000), commodityId: 20 });
    expect((await recordSell(deps, sellIn(100, 7000))).finished).toBe(false);
    await expect(recordSell(deps, sellIn(1, 7000))).rejects.toMatchObject({ code: 'oversell', message: 'В трюме только 0 SCU' });
    const last = await recordSell(deps, { ...sellIn(50, 3500), commodityId: 20 });
    expect(last.finished).toBe(true);
    expect(last.run.run.status).toBe('done');
  });

  it('rejects overselling without writing anything', async () => {
    await recordBuy(deps, buyIn(300));
    const before = await rowCounts();
    await expect(recordSell(deps, sellIn(301, 7000))).rejects.toMatchObject({ code: 'oversell', message: 'В трюме только 300 SCU' });
    expect((await getActiveRun(db))!.events).toHaveLength(1);
    expect(await rowCounts()).toEqual(before);
    expect((await latestObservations(db)).filter(x => x.side === 'sell')).toEqual([]);
  });

  it('rejects selling more than what is left after a partial sale', async () => {
    await recordBuy(deps, buyIn(300));
    await recordSell(deps, sellIn(250, 7000));
    await expect(recordSell(deps, sellIn(51, 7000))).rejects.toMatchObject({ code: 'oversell', message: 'В трюме только 50 SCU' });
    expect((await recordSell(deps, sellIn(50, 7000))).finished).toBe(true);
  });

  it('rejects selling a commodity that is not on board and selling without a run', async () => {
    await expect(recordSell(deps, sellIn(1, 7000))).rejects.toMatchObject({ code: 'no_active_run', message: 'Нет активного рейса' });
    await recordBuy(deps, buyIn(300));
    await expect(recordSell(deps, { ...sellIn(1, 7000), commodityId: 11 })).rejects.toMatchObject({ code: 'oversell' });
  });

  it('rejects a sale into a finished run', async () => {
    await recordBuy(deps, buyIn(300));
    await recordSell(deps, sellIn(300, 7000));
    await expect(recordSell(deps, sellIn(1, 7000))).rejects.toMatchObject({ code: 'no_active_run' });
  });

  it.each([[0, 7000], [-1, 7000], [10, 0], [10, -1]])('rejects scu %i at price %i and writes nothing', async (scu, price) => {
    await recordBuy(deps, buyIn(300));
    const before = await rowCounts();
    await expect(recordSell(deps, { terminalId: 2, commodityId: 10, scu, price })).rejects.toMatchObject({
      code: 'bad_input', message: 'Количество и цена должны быть больше нуля',
    });
    expect(await rowCounts()).toEqual(before);
  });

  it('reports bad input before a missing run', async () => {
    await expect(recordSell(deps, sellIn(0, 7000))).rejects.toMatchObject({ code: 'bad_input' });
  });
});

describe('recordMark', () => {
  it('records marks only inside a run', async () => {
    await expect(recordMark(deps, 'depart')).rejects.toMatchObject({ code: 'no_active_run' });
    await recordBuy(deps, buyIn(300)); await recordMark(deps, 'depart');
    expect((await getActiveRun(db))!.events.at(-1)).toMatchObject({ type: 'depart', terminalId: null });
  });

  it('writes the time of the mark and no commodity, quantity or price', async () => {
    await recordBuy(deps, buyIn(300)); clock.advance(90);
    await recordMark(deps, 'arrive');
    expect((await getActiveRun(db))!.events.at(-1)).toMatchObject({ ts: NOW + 90, type: 'arrive', terminalId: null, commodityId: null, scu: null, price: null });
  });

  it('writes no observation', async () => {
    await recordBuy(deps, buyIn(300));
    const before = await rowCounts();
    await recordMark(deps, 'depart');
    expect(await rowCounts()).toEqual({ ...before, events: before.events + 1 });
  });

  it('rejects a mark after the run is done', async () => {
    await recordBuy(deps, buyIn(300));
    await recordSell(deps, sellIn(300, 7000));
    await expect(recordMark(deps, 'arrive')).rejects.toMatchObject({ code: 'no_active_run', message: 'Нет активного рейса' });
  });
});

describe('loseCargo', () => {
  it('closes a lost run and frees the slot', async () => {
    await recordBuy(deps, buyIn(300)); clock.advance(500);
    expect((await loseCargo(deps)).run).toMatchObject({ status: 'lost', endedAt: NOW + 500 });
    expect((await recordBuy(deps, buyIn(10))).run.status).toBe('active');
  });

  it('keeps the events of the lost run', async () => {
    await recordBuy(deps, buyIn(300)); clock.advance(500);
    const lost = await loseCargo(deps);
    expect(lost.events.map(e => e.type)).toEqual(['buy']);
    expect(await getActiveRun(db)).toBeNull();
  });

  it('needs an active run', async () => {
    await expect(loseCargo(deps)).rejects.toMatchObject({ code: 'no_active_run', message: 'Нет активного рейса' });
    await recordBuy(deps, buyIn(300));
    await recordSell(deps, sellIn(300, 7000));
    await expect(loseCargo(deps)).rejects.toMatchObject({ code: 'no_active_run' });
  });
});

describe('restart and logging', () => {
  it('restores an active run after a restart', async () => {
    await recordBuy(deps, buyIn(300));
    expect((await getActiveRun(db))!.run.startedAt).toBe(NOW);       // таймер считается от значения в базе
  });

  it('logs start, trades, marks, finish and loss', async () => {
    await recordBuy(deps, buyIn(300)); await recordMark(deps, 'depart'); await recordSell(deps, sellIn(300, 7000));
    const msgs = sink.lines.filter(l => l.line.startsWith('[run]')).map(l => l.line.split(' ')[1]);
    expect(msgs).toEqual(['started', 'buy', 'depart', 'sell', 'finished']);
  });

  it('logs the arrival mark and the lost cargo', async () => {
    await recordBuy(deps, buyIn(300)); await recordMark(deps, 'arrive'); await loseCargo(deps);
    const msgs = sink.lines.filter(l => l.line.startsWith('[run]')).map(l => l.line.split(' ')[1]);
    expect(msgs).toEqual(['started', 'buy', 'arrive', 'lost']);
  });

  it('logs the values of a trade and the result of a finished run', async () => {
    await recordBuy(deps, buyIn(300, 6000)); clock.advance(600);
    await recordSell(deps, sellIn(300, 7000));
    const lines = sink.lines.filter(l => l.line.startsWith('[run]')).map(l => l.line);
    expect(lines[0]).toBe(`[run] started {"runId":1,"vehicleId":7,"scuCapacity":696,"startedAt":${NOW}}`);
    expect(lines[1]).toBe(`[run] buy {"runId":1,"eventId":1,"ts":${NOW},"terminalId":1,"commodityId":10,"scu":300,"price":6000}`);
    expect(lines[2]).toBe(`[run] sell {"runId":1,"eventId":2,"ts":${NOW + 600},"terminalId":2,"commodityId":10,"scu":300,"price":7000}`);
    expect(lines[3]).toBe(`[run] finished {"runId":1,"endedAt":${NOW + 600},"invested":1800000,"revenue":2100000,"profit":300000,"durationSec":600}`);
  });

  it('logs nothing under run when a trade is rejected', async () => {
    await expect(recordBuy(deps, buyIn(0))).rejects.toBeInstanceOf(TradeError);
    await expect(recordSell(deps, sellIn(1, 7000))).rejects.toBeInstanceOf(TradeError);
    expect(sink.lines.filter(l => l.line.startsWith('[run]'))).toEqual([]);
  });
});

describe('overlapping calls', () => {
  it('lets two simultaneous first buys share one run', async () => {
    const [a, b] = await Promise.all([recordBuy(deps, buyIn(100)), recordBuy(deps, buyIn(100))]);
    expect(a.run.id).toBe(b.run.id);
    expect((await getActiveRun(db))!.events).toHaveLength(2);
  });

  it('never sells more than is on board when two sales arrive together', async () => {
    await recordBuy(deps, buyIn(600));
    const [a, b] = await Promise.allSettled([recordSell(deps, sellIn(400, 7000)), recordSell(deps, sellIn(400, 7000))]);
    expect(a.status).toBe('fulfilled');
    expect(b).toMatchObject({ status: 'rejected', reason: { code: 'oversell', message: 'В трюме только 200 SCU' } });
    expect((await getActiveRun(db))!.events.map(e => e.type)).toEqual(['buy', 'sell']);
  });

  it('never buys beyond free space when two purchases arrive together', async () => {
    const [a, b] = await Promise.allSettled([recordBuy(deps, buyIn(400)), recordBuy(deps, buyIn(400))]);
    expect(a.status).toBe('fulfilled');
    expect(b).toMatchObject({ status: 'rejected', reason: { code: 'no_space', message: 'Свободно только 296 SCU' } });
  });

  it('keeps working after a call failed', async () => {
    await expect(recordSell(deps, sellIn(1, 7000))).rejects.toBeInstanceOf(TradeError);
    expect((await recordBuy(deps, buyIn(10))).run.status).toBe('active');
  });
});

describe('a write that fails half-way', () => {
  it('leaves only a truthful observation and an empty active run when the event cannot be written, and the next buy joins that run', async () => {
    const broken = { ...deps, db: failingOn(db, 'INSERT INTO run_event') };
    await expect(recordBuy(broken, buyIn(300))).rejects.toThrow('disk full');
    expect(await rowCounts()).toEqual({ runs: 1, events: 0, observations: 1 });
    const left = (await getActiveRun(db))!;
    expect(left.events).toEqual([]);

    clock.advance(30);
    const r = await recordBuy(deps, buyIn(300));
    expect(r.run.id).toBe(left.run.id);
    expect(r.events).toHaveLength(1);
  });

  it('writes nothing at all when the observation cannot be written', async () => {
    const broken = { ...deps, db: failingOn(db, 'INSERT INTO observation') };
    await expect(recordBuy(broken, buyIn(300))).rejects.toThrow('disk full');
    expect(await rowCounts()).toEqual({ runs: 0, events: 0, observations: 0 });
  });

  it('keeps the sale and the run open when the run cannot be closed after the last sale', async () => {
    await recordBuy(deps, buyIn(300));
    const broken = { ...deps, db: failingOn(db, 'UPDATE run') };
    await expect(recordSell(broken, sellIn(300, 7000))).rejects.toThrow('disk full');
    const left = (await getActiveRun(db))!;
    expect(left.events.map(e => e.type)).toEqual(['buy', 'sell']);
    expect(left.run).toMatchObject({ status: 'active', endedAt: null });
  });
});

describe('listRuns', () => {
  it('is empty without runs', async () => {
    expect(await listRuns(db)).toEqual([]);
    expect(await getActiveRun(db)).toBeNull();
  });

  it('lists the newest run first, each with its own events', async () => {
    await recordBuy(deps, buyIn(300)); clock.advance(100);
    await recordSell(deps, sellIn(300, 7000)); clock.advance(100);
    await recordBuy(deps, buyIn(50)); await recordMark(deps, 'depart');
    const runs = await listRuns(db);
    expect(runs.map(r => r.run.status)).toEqual(['active', 'done']);
    expect(runs.map(r => r.run.startedAt)).toEqual([NOW + 200, NOW]);
    expect(runs[0].events.map(e => e.type)).toEqual(['buy', 'depart']);
    expect(runs[1].events.map(e => e.type)).toEqual(['buy', 'sell']);
    expect(runs.every(r => r.events.every(e => e.runId === r.run.id))).toBe(true);
  });

  it('returns whole runs with numeric fields', async () => {
    await recordBuy(deps, buyIn(300, 6000.5));
    const [r] = await listRuns(db);
    expect(r.run).toEqual({ id: 1, vehicleId: 7, scuCapacity: 696, startedAt: NOW, endedAt: null, status: 'active' });
    expect(r.events).toEqual([{ id: 1, runId: 1, ts: NOW, type: 'buy', terminalId: 1, commodityId: 10, scu: 300, price: 6000.5 }]);
  });

  it('keeps a missing ship as null', async () => {
    await recordBuy({ ...deps, settings: { ...deps.settings, vehicleId: null } }, buyIn(10));
    expect((await getActiveRun(db))!.run.vehicleId).toBeNull();
  });

  it('orders events by time, then by id', async () => {
    await db.execute("INSERT INTO run (vehicle_id, scu_capacity, started_at, status) VALUES (NULL, 0, 10, 'active')");
    const add = (ts: number, type: string) => db.execute('INSERT INTO run_event (run_id, ts, type) VALUES (?, ?, ?)', [1, ts, type]);
    await add(300, 'arrive'); await add(100, 'depart'); await add(300, 'depart'); await add(200, 'arrive');
    const expected = [[100, 'depart'], [200, 'arrive'], [300, 'arrive'], [300, 'depart']];
    expect((await listRuns(db))[0].events.map(e => [e.ts, e.type])).toEqual(expected);
    expect((await getActiveRun(db))!.events.map(e => [e.ts, e.type])).toEqual(expected);
  });

  it('lists a run without events', async () => {
    await db.execute("INSERT INTO run (vehicle_id, scu_capacity, started_at, status) VALUES (NULL, 0, 10, 'done')");
    expect((await listRuns(db))[0].events).toEqual([]);
  });
});

describe('allRecordTimestamps', () => {
  it('is empty without records', async () => {
    expect(await allRecordTimestamps(db)).toEqual([]);
  });

  it('holds the time of every observation and every run event, ascending, duplicates kept', async () => {
    await recordBuy(deps, buyIn(300)); clock.advance(60);
    await recordMark(deps, 'depart'); clock.advance(60);
    await recordSell(deps, sellIn(300, 7000));
    expect(await allRecordTimestamps(db)).toEqual([NOW, NOW, NOW + 60, NOW + 120, NOW + 120]);
  });

  it('sorts across the two tables', async () => {
    await db.execute('INSERT INTO observation (ts, terminal_id, commodity_id, side, price, scu) VALUES (?, 1, 10, ?, 1, NULL)', [500, 'buy']);
    await db.execute("INSERT INTO run (vehicle_id, scu_capacity, started_at, status) VALUES (NULL, 0, 10, 'done')");
    await db.execute("INSERT INTO run_event (run_id, ts, type) VALUES (1, 100, 'depart')");
    await db.execute("INSERT INTO run_event (run_id, ts, type) VALUES (1, 900, 'arrive')");
    await db.execute('INSERT INTO observation (ts, terminal_id, commodity_id, side, price, scu) VALUES (?, 1, 10, ?, 1, NULL)', [300, 'sell']);
    expect(await allRecordTimestamps(db)).toEqual([100, 300, 500, 900]);
  });
});
