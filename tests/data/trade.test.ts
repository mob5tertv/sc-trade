import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/data/db';
import { latestObservations } from '../../src/data/repo/diary';
import {
  addFinishedRun, addRunEvent, allRecordTimestamps, closeRun, getActiveRun, getRun, listRuns, removeEmptyFinishedRuns, removeEmptyRun, startRun,
} from '../../src/data/repo/runs';
import { loseCargo, recordBuy, recordIncome, recordMark, recordSell, TradeError } from '../../src/data/trade';
import type { TradeDeps } from '../../src/data/trade';
import { incomeIn } from '../helpers/income-fixtures';
import { TITA } from '../helpers/strip-fixtures';
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

describe('recordIncome', () => {
  it('records a sale that no purchase stands behind as a finished run of one sale, with no run going', async () => {
    clock.advance(30);
    const r = await recordIncome(deps, incomeIn(120, 3700));
    expect(r.run).toEqual({ id: 1, vehicleId: 7, scuCapacity: 696, startedAt: NOW + 30, endedAt: NOW + 30, status: 'done' });
    expect(r.events).toEqual([{ id: 1, runId: 1, ts: NOW + 30, type: 'sell', terminalId: 2, commodityId: TITA, scu: 120, price: 3700 }]);
    expect(await getActiveRun(db)).toBeNull();
    expect(await listRuns(db)).toEqual([r]);
  });

  it('does not touch a run that is going: its cargo, its events and its status stay, and no second run is active', async () => {
    await recordBuy(deps, buyIn(300)); clock.advance(60);
    await recordMark(deps, 'depart'); clock.advance(60);
    const before = (await getActiveRun(db))!;
    const r = await recordIncome(deps, incomeIn(50, 3700));
    expect(r.run.id).not.toBe(before.run.id);
    expect(r.run.status).toBe('done');
    expect(await getActiveRun(db)).toEqual(before);
    expect((await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM run WHERE status = 'active'"))[0].n).toBe(1);
    expect((await listRuns(db)).map(x => x.run.status).sort()).toEqual(['active', 'done']);
  });

  it('leaves the run that is going able to finish by its own sales', async () => {
    await recordBuy(deps, buyIn(300)); clock.advance(60);
    await recordIncome(deps, incomeIn(50, 3700)); clock.advance(60);
    const last = await recordSell(deps, sellIn(300, 7000));
    expect(last.finished).toBe(true);
    expect(last.run.events.map(e => e.type)).toEqual(['buy', 'sell']);
    expect(last.run.run).toMatchObject({ startedAt: NOW, endedAt: NOW + 120, status: 'done' });
  });

  it('takes any quantity: the hold of the ship is not what the goods were in', async () => {
    const r = await recordIncome(deps, incomeIn(5000, 100));
    expect(r.events[0].scu).toBe(5000);
    const loose = { ...deps, settings: { ...deps.settings, scuCapacity: 0, vehicleId: null } };
    expect((await recordIncome(loose, incomeIn(1, 100))).run).toMatchObject({ scuCapacity: 0, vehicleId: null, status: 'done' });
  });

  it('writes the buyer inventory by the rule of a sale: what was seen plus what was sold, nothing when it was not seen', async () => {
    await recordIncome(deps, incomeIn(120, 3700, { knownScu: 250 }));
    expect((await latestObservations(db)).find(o => o.side === 'sell')).toMatchObject({ terminalId: 2, commodityId: TITA, price: 3700, ts: NOW, scu: 370 });
    await recordIncome(deps, incomeIn(10, 3710, { knownScu: 0 }));
    expect((await latestObservations(db)).find(o => o.side === 'sell')).toMatchObject({ price: 3710, scu: 10 });
    await recordIncome(deps, incomeIn(10, 3720));
    expect((await latestObservations(db)).find(o => o.side === 'sell')).toMatchObject({ price: 3720, scu: null });
    expect((await latestObservations(db)).filter(o => o.side === 'buy')).toEqual([]);
  });

  it.each([[0, 3700], [-1, 3700], [10, 0], [10, -1], [NaN, 3700], [10, Infinity]])('rejects scu %d at price %d and writes nothing', async (scu, price) => {
    await expect(recordIncome(deps, incomeIn(scu, price))).rejects.toMatchObject({
      code: 'bad_input', message: 'Количество и цена должны быть больше нуля',
    });
    expect(await rowCounts()).toEqual({ runs: 0, events: 0, observations: 0 });
  });

  it('refuses goods that are in the hold of the run that is going: those are sold from the run, and writes nothing', async () => {
    await recordBuy(deps, buyIn(300));
    const before = await rowCounts();
    const err = await recordIncome(deps, incomeIn(10, 7000, { commodityId: 10 })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TradeError);
    expect(err).toMatchObject({ code: 'on_board', message: 'Этот товар числится в трюме: продай его из рейса' });
    expect(await rowCounts()).toEqual(before);
  });

  it('takes the goods whose purchase is all sold: they are no longer in the hold', async () => {
    await recordBuy(deps, buyIn(300));
    await recordBuy(deps, { ...buyIn(100), commodityId: 20 });
    await recordSell(deps, sellIn(300, 7000));
    expect((await recordIncome(deps, incomeIn(10, 3700, { commodityId: 10 }))).run.status).toBe('done');
  });

  it('keeps the old refusal for a sale of more than the hold has, and for a sale of what is not there', async () => {
    await recordBuy(deps, buyIn(300));
    await expect(recordSell(deps, sellIn(301, 7000))).rejects.toMatchObject({ code: 'oversell', message: 'В трюме только 300 SCU' });
    await expect(recordSell(deps, incomeIn(1, 3700))).rejects.toMatchObject({ code: 'oversell' });
    expect((await listRuns(db)).map(x => x.run.status)).toEqual(['active']);
  });

  it('writes two simultaneous sales as two runs, and a purchase that comes first makes the sale of the same goods a refusal', async () => {
    const [a, b] = await Promise.all([recordIncome(deps, incomeIn(10, 3700)), recordIncome(deps, incomeIn(20, 3700))]);
    expect(a.run.id).not.toBe(b.run.id);
    expect((await listRuns(db)).map(x => x.events.length)).toEqual([1, 1]);

    const [buy, income] = await Promise.allSettled([recordBuy(deps, { ...buyIn(100), commodityId: TITA }), recordIncome(deps, incomeIn(10, 3700))]);
    expect(buy.status).toBe('fulfilled');
    expect(income).toMatchObject({ status: 'rejected', reason: { code: 'on_board' } });
  });

  it('logs the sale under run with its numbers, and nothing when it is rejected', async () => {
    await expect(recordIncome(deps, incomeIn(0, 3700))).rejects.toBeInstanceOf(TradeError);
    expect(sink.lines.filter(l => l.line.startsWith('[run]'))).toEqual([]);
    clock.advance(5);
    await recordIncome(deps, incomeIn(120, 3700));
    expect(sink.lines.filter(l => l.line.startsWith('[run]')).map(l => l.line)).toEqual([
      `[run] income {"runId":1,"eventId":1,"ts":${NOW + 5},"terminalId":2,"commodityId":${TITA},"scu":120,"price":3700}`,
    ]);
  });

  it('removes the empty run again when the sale cannot be written, and keeps the true observation', async () => {
    const broken = { ...deps, db: failingOn(db, 'INSERT INTO run_event') };
    await expect(recordIncome(broken, incomeIn(120, 3700))).rejects.toThrow('disk full');
    expect(await rowCounts()).toEqual({ runs: 0, events: 0, observations: 1 });
    expect((await recordIncome(deps, incomeIn(120, 3700))).run.status).toBe('done');
  });

  it('says the original failure, and logs the second one, when the empty run cannot be removed either', async () => {
    const broken = { ...deps, db: failingOn(failingOn(db, 'INSERT INTO run_event'), 'DELETE FROM run') };
    await expect(recordIncome(broken, incomeIn(120, 3700))).rejects.toThrow('disk full');
    expect(await rowCounts()).toEqual({ runs: 1, events: 0, observations: 1 });
    expect(sink.lines.some(l => l.line.startsWith('[run] cannot remove the empty run {'))).toBe(true);        // the run of this sale (the sweep of leftovers has its own line)
  });

  it('writes nothing at all when the observation cannot be written', async () => {
    const broken = { ...deps, db: failingOn(db, 'INSERT INTO observation') };
    await expect(recordIncome(broken, incomeIn(120, 3700))).rejects.toThrow('disk full');
    expect(await rowCounts()).toEqual({ runs: 0, events: 0, observations: 0 });
  });
});

describe('addFinishedRun and removeEmptyRun', () => {
  const finishedRun = (at = NOW) => addFinishedRun(db, { vehicleId: 7, scuCapacity: 696, startedAt: at, endedAt: at });
  const activeRun = () => startRun(db, { vehicleId: 7, scuCapacity: 696, startedAt: NOW });
  const addSale = (runId: number) => addRunEvent(db, { runId, ts: NOW, type: 'sell', terminalId: 2, commodityId: TITA, scu: 10, price: 100 });
  const statusOf = async (id: number) => (await getRun(db, id))?.run.status ?? null;

  it('writes a run that is done, with the end it was given, and never an active one', async () => {
    const id = await finishedRun(NOW + 5);
    expect((await getRun(db, id))!.run).toEqual({ id, vehicleId: 7, scuCapacity: 696, startedAt: NOW + 5, endedAt: NOW + 5, status: 'done' });
    expect(await getActiveRun(db)).toBeNull();
  });

  it('can be written while a run is going: the slot of the active run is not touched, and a second one fits as well', async () => {
    const active = await activeRun();
    await finishedRun(); await finishedRun();
    expect((await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM run WHERE status = 'active'"))[0].n).toBe(1);
    expect((await getActiveRun(db))!.run.id).toBe(active);
    expect((await listRuns(db)).map(r => r.run.status).sort()).toEqual(['active', 'done', 'done']);
  });

  it('removes an empty finished run', async () => {
    const id = await finishedRun();
    await removeEmptyRun(db, id);
    expect(await statusOf(id)).toBeNull();
  });

  it('does not remove an empty ACTIVE run: a failed first purchase leaves one, and the next purchase joins it', async () => {
    const id = await activeRun();
    await removeEmptyRun(db, id);
    expect(await statusOf(id)).toBe('active');
  });

  it('does not remove a finished run that has an event', async () => {
    const id = await finishedRun();
    await addSale(id);
    await removeEmptyRun(db, id);
    expect(await statusOf(id)).toBe('done');
    expect((await getRun(db, id))!.events).toHaveLength(1);
  });

  it('does not remove a lost run, and removes only the run it was asked to', async () => {
    const lost = await activeRun();
    await closeRun(db, lost, 'lost', NOW + 1);
    const empty = await finishedRun(); const other = await finishedRun();
    await removeEmptyRun(db, lost); await removeEmptyRun(db, empty);
    expect([await statusOf(lost), await statusOf(empty), await statusOf(other)]).toEqual(['lost', null, 'done']);
    await removeEmptyRun(db, 999);                                             // an id that is not there changes nothing
    expect(await statusOf(other)).toBe('done');
  });
});

describe('removeEmptyFinishedRuns', () => {
  it('removes every empty finished run and says how many; the active, the lost and the ones with events stay', async () => {
    const runAt = (status: string, at: number) => db.execute('INSERT INTO run (vehicle_id, scu_capacity, started_at, ended_at, status) VALUES (7, 696, ?, ?, ?)', [at, status === 'active' ? null : at, status]);
    await runAt('done', 10); await runAt('done', 20);                          // ids 1 and 2: leftovers
    await runAt('lost', 30);                                                   // 3
    await runAt('done', 40);                                                   // 4: has an event
    await db.execute("INSERT INTO run_event (run_id, ts, type, terminal_id, commodity_id, scu, price) VALUES (4, 40, 'sell', 2, 20, 10, 100)");
    await runAt('active', 50);                                                 // 5
    expect(await removeEmptyFinishedRuns(db)).toBe(2);
    expect((await listRuns(db)).map(r => [r.run.id, r.run.status])).toEqual([[5, 'active'], [4, 'done'], [3, 'lost']]);
    expect(await removeEmptyFinishedRuns(db)).toBe(0);
  });
});

describe('the leftovers of an income that was cut off', () => {
  /** What a crash between the insert of the run and the insert of its sale leaves: a finished run of nothing. */
  const leftover = (at: number) => db.execute("INSERT INTO run (vehicle_id, scu_capacity, started_at, ended_at, status) VALUES (7, 696, ?, ?, 'done')", [at, at]);
  const emptyDoneRuns = async () => (await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM run WHERE status = 'done' AND NOT EXISTS (SELECT 1 FROM run_event WHERE run_id = run.id)"))[0].n;

  it('are removed when the trade service first touches the database, whatever the first call is, and logged once', async () => {
    await leftover(10); await leftover(20);
    await recordBuy(deps, buyIn(10));
    expect(await emptyDoneRuns()).toBe(0);
    expect(sink.lines.filter(l => l.line.startsWith('[run] removed')).map(l => l.line)).toEqual(['[run] removed the empty runs of an income that was cut off {"count":2}']);
  });

  it('are removed by a call that is refused as well: it is the first touch that counts', async () => {
    await leftover(10);
    await expect(recordSell(deps, sellIn(1, 7000))).rejects.toBeInstanceOf(TradeError);
    expect(await emptyDoneRuns()).toBe(0);
  });

  it('are looked for once per session of the application (one database), not at every trade', async () => {
    await recordBuy(deps, buyIn(10));
    await leftover(30);
    await recordBuy(deps, buyIn(10));
    expect(await emptyDoneRuns()).toBe(1);                                      // the second call did not look
    expect(sink.lines.some(l => l.line.startsWith('[run] removed'))).toBe(false);
  });

  it('are looked for again when the database is opened again (a new session)', async () => {
    await recordBuy(deps, buyIn(10));
    await leftover(30);
    await recordMark({ ...deps, db: failingOn(db, 'nothing starts with this') }, 'depart');   // another `Db` object over the same file: a new session
    expect(await emptyDoneRuns()).toBe(0);
  });

  it('keep an income that is complete, a run that is going and the sales of the runs that are over', async () => {
    await recordIncome(deps, incomeIn(10, 100));
    await leftover(30);
    await recordBuy({ ...deps, db: failingOn(db, 'nothing starts with this') }, buyIn(10));
    expect((await listRuns(db)).map(r => r.run.status)).toEqual(['active', 'done']);
    expect((await listRuns(db))[1].events).toHaveLength(1);
  });

  it('do not stop the trade when they cannot be removed: the failure is logged and the trade is written', async () => {
    await leftover(10);
    const broken = { ...deps, db: failingOn(db, 'DELETE FROM run') };
    expect((await recordBuy(broken, buyIn(10))).run.status).toBe('active');
    expect(sink.lines.some(l => l.line.startsWith('[run] cannot remove the empty runs of an income that was cut off'))).toBe(true);
    expect(await emptyDoneRuns()).toBe(1);
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
  it('leaves only a truthful observation and an empty active run when the event cannot be written, and the next buy starts its own run', async () => {
    // one session: the same `Db` object throughout; the next call of the service repairs the run before it looks at it
    let failing = true;
    const session = {
      ...deps,
      db: { select: <T>(sql: string, params?: unknown[]) => db.select<T>(sql, params), execute: (sql: string, params?: unknown[]) => (failing && sql.startsWith('INSERT INTO run_event') ? Promise.reject(new Error('disk full')) : db.execute(sql, params)) },
    };
    await expect(recordBuy(session, buyIn(300))).rejects.toThrow('disk full');
    expect(await rowCounts()).toEqual({ runs: 1, events: 0, observations: 1 });
    const left = (await getActiveRun(db))!;
    expect(left.events).toEqual([]);

    failing = false;
    clock.advance(30);
    const r = await recordBuy(session, buyIn(300));
    expect(r.run.startedAt).toBe(NOW + 30);    // not the old start: the empty run is gone and this one is new
    expect(r.events).toHaveLength(1);
    expect(await rowCounts()).toEqual({ runs: 1, events: 1, observations: 2 });
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
