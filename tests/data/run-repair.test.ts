import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/data/db';
import { addRunEvent, emptyActiveRuns, getActiveRun, getRun, listRuns, removeEmptyActiveRun, startRun } from '../../src/data/repo/runs';
import { loseCargo, recordBuy, recordIncome, recordMark, recordSell, repairRuns } from '../../src/data/trade';
import type { TradeDeps } from '../../src/data/trade';
import { incomeIn } from '../helpers/income-fixtures';
import { buyIn, NOW, sellIn, tradeFixture } from '../helpers/trade-fixtures';
import type { Clock, TradeFixture } from '../helpers/trade-fixtures';

// The two states of a run that a trade cut off half-way leaves (the plugin has no transactions): an active run without a
// single event (the run was started, its first purchase was never written) and an active run whose last sale was written
// but which was never closed. They are repaired when the application starts, and before EVERY call of the trade service (a
// write can be cut off in the middle of a session as well).

let db: Db;
let sink: TradeFixture['sink'];
let clock: Clock;
let deps: TradeDeps;

beforeEach(async () => {
  ({ db, sink, clock, deps } = await tradeFixture());
});

/** The same database, but every statement that starts with `prefix` fails. */
function failingOn(inner: Db, prefix: string): Db {
  return {
    select: <T>(sql: string, params?: unknown[]) => inner.select<T>(sql, params),
    execute: (sql, params) => (sql.startsWith(prefix) ? Promise.reject(new Error('disk full')) : inner.execute(sql, params)),
  };
}

/** The lines of the trade service that tell a repair was made. */
const repairLines = () => sink.lines.filter(l => l.level === 'warn' && l.line.startsWith('[run]')).map(l => l.line);

/** What a crash after the first `INSERT INTO run` leaves: an active run, no event. */
const emptyActiveRun = (at = NOW) => startRun(db, { vehicleId: 7, scuCapacity: 696, startedAt: at });

/** What a crash after the last sale leaves: bought at NOW, sold at NOW + 60, the run still active. Returns the run id. */
async function soldOutButOpen(): Promise<number> {
  await recordBuy(deps, buyIn(300));
  clock.advance(60);
  await expect(recordSell({ ...deps, db: failingOn(db, 'UPDATE run') }, sellIn(300, 7000))).rejects.toThrow('disk full');
  return (await getActiveRun(db))!.run.id;
}

describe('repairRuns: an active run without events', () => {
  it('is removed, and the player is left with no run', async () => {
    await emptyActiveRun();
    await repairRuns(deps);
    expect(await getActiveRun(db)).toBeNull();
    expect(await listRuns(db)).toEqual([]);
  });

  it('is told in the log: the number of the run and what was done', async () => {
    const id = await emptyActiveRun();
    await repairRuns(deps);
    expect(repairLines()).toEqual([`[run] repaired a run without events: removed it {"runId":${id},"startedAt":${NOW}}`]);
  });

  it('leaves the observation of the purchase alone: it is true whether or not the trade was recorded', async () => {
    await expect(recordBuy({ ...deps, db: failingOn(db, 'INSERT INTO run_event') }, buyIn(300))).rejects.toThrow('disk full');
    await repairRuns(deps);
    expect(await getActiveRun(db)).toBeNull();
    expect((await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM observation'))[0].n).toBe(1);
  });

  it('does not start the next purchase with the old start: the new run begins at the time of the purchase', async () => {
    await emptyActiveRun();
    clock.advance(600);
    const r = await recordBuy(deps, buyIn(100));
    expect(r.run.startedAt).toBe(NOW + 600);
    expect(r.events).toHaveLength(1);
    expect(await listRuns(db)).toHaveLength(1);
  });
});

describe('repairRuns: an active run that is sold out but was never closed', () => {
  it('is closed as done at the time of its last sale, not at the time of the repair', async () => {
    const id = await soldOutButOpen();
    clock.advance(5000);
    await repairRuns(deps);
    const run = (await listRuns(db))[0];
    expect(run.run).toMatchObject({ id, status: 'done', endedAt: NOW + 60 });
    expect(run.events.map(e => e.type)).toEqual(['buy', 'sell']);
    expect(await getActiveRun(db)).toBeNull();
  });

  it('is told in the log: the number of the run and what was done', async () => {
    const id = await soldOutButOpen();
    sink.lines.length = 0;
    await repairRuns(deps);
    expect(repairLines()).toEqual([`[run] repaired a run that was sold out: closed it as done {"runId":${id},"endedAt":${NOW + 60}}`]);
  });

  it('ends at the LAST sale when the hold was emptied in several, and not at a mark that came later', async () => {
    await recordBuy(deps, buyIn(300));
    clock.advance(30);
    await recordSell(deps, sellIn(100, 7000));
    clock.advance(30);
    await expect(recordSell({ ...deps, db: failingOn(db, 'UPDATE run') }, sellIn(200, 7000))).rejects.toThrow('disk full');
    // a mark that is later than the last sale (written some other way: the service itself repairs the run before it records one)
    await addRunEvent(db, { runId: (await getActiveRun(db))!.run.id, ts: NOW + 160, type: 'arrive', terminalId: null, commodityId: null, scu: null, price: null });
    await repairRuns(deps);
    expect((await listRuns(db))[0].run).toMatchObject({ status: 'done', endedAt: NOW + 60 });
  });

  it('counts every commodity: a hold with one of two commodities left is not sold out', async () => {
    await recordBuy(deps, buyIn(100));
    await recordBuy(deps, { terminalId: 1, commodityId: 20, scu: 50, price: 3000 });
    clock.advance(10);
    await recordSell(deps, sellIn(100, 7000));
    await repairRuns(deps);
    expect((await getActiveRun(db))!.run.status).toBe('active');
    expect(repairLines()).toEqual([]);
  });
});

describe('repairRuns leaves a run that is as it should be', () => {
  /** Every run with its events, to compare before and after. */
  const snapshot = async () => JSON.stringify(await listRuns(db));

  it('an active run with a purchase and cargo', async () => {
    await recordBuy(deps, buyIn(300));
    const before = await snapshot();
    await repairRuns(deps);
    expect(await snapshot()).toBe(before);
    expect(repairLines()).toEqual([]);
  });

  it('an active run that was sold in part, with marks', async () => {
    await recordBuy(deps, buyIn(300));
    await recordMark(deps, 'depart');
    clock.advance(40);
    await recordSell(deps, sellIn(100, 7000));
    const before = await snapshot();
    await repairRuns(deps);
    expect(await snapshot()).toBe(before);
    expect(repairLines()).toEqual([]);
  });

  // The repair is about ACTIVE runs. A lost run without events is not its business either; the sweep of the leftovers (once per
  // session, already made on this database by the first purchase) is the one that takes it: tests/data/clear-history.test.ts.
  it('runs that are done or lost, and a lost one that was never given an event', async () => {
    await recordBuy(deps, buyIn(300));
    clock.advance(10);
    await recordSell(deps, sellIn(300, 7000));
    clock.advance(10);
    await recordBuy(deps, buyIn(50));
    await loseCargo(deps);
    await db.execute("INSERT INTO run (vehicle_id, scu_capacity, started_at, ended_at, status) VALUES (7, 696, 5, 6, 'lost')");
    const before = await snapshot();
    await repairRuns(deps);
    expect(await snapshot()).toBe(before);
    expect(repairLines()).toEqual([]);
  });

  it('an active run with marks only is not a run that was sold out: it has no sale', async () => {
    const id = await emptyActiveRun();
    await addRunEvent(db, { runId: id, ts: NOW, type: 'depart', terminalId: null, commodityId: null, scu: null, price: null });
    await repairRuns(deps);
    expect((await getActiveRun(db))!.run.id).toBe(id);
    expect(repairLines()).toEqual([]);
  });

  it('nothing at all: no run, no line', async () => {
    await repairRuns(deps);
    expect(repairLines()).toEqual([]);
  });

  it('is done once: a second call finds nothing to do and says nothing', async () => {
    await emptyActiveRun();
    await repairRuns(deps);
    await repairRuns(deps);
    expect(repairLines()).toHaveLength(1);
  });
});

describe('the repair at the first call of the trade service', () => {
  it('runs before whatever the first call is: an empty active run is gone when the first purchase starts its own', async () => {
    await emptyActiveRun();
    clock.advance(900);
    await recordBuy(deps, buyIn(10));
    expect((await listRuns(db)).map(r => [r.run.startedAt, r.events.length])).toEqual([[NOW + 900, 1]]);
    expect(repairLines()).toHaveLength(1);
  });

  it('closes a run that was sold out before a purchase can merge the two runs into one', async () => {
    const id = await soldOutButOpen();
    // a new session: the same file, another `Db` object, so the service looks again
    const again = { ...deps, db: failingOn(db, 'nothing starts with this') };
    clock.advance(600);
    const r = await recordBuy(again, buyIn(100));
    expect(r.run.id).not.toBe(id);
    expect(r.run.startedAt).toBe(NOW + 660);
    const runs = await listRuns(db);
    expect(runs.map(x => x.run.status)).toEqual(['active', 'done']);
    expect(runs[1].run).toMatchObject({ id, endedAt: NOW + 60 });
  });

  it('is done by the first call that is refused as well', async () => {
    await emptyActiveRun();
    await expect(recordSell(deps, sellIn(1, 7000))).rejects.toMatchObject({ code: 'no_active_run' });
    expect(await listRuns(db)).toEqual([]);
  });

  it('is repeated at every call, not only at the first: a run broken in the middle of the session is repaired by the next call, whatever it is', async () => {
    await recordBuy(deps, buyIn(10));                                          // the first call is over, the sweep has been made
    await db.execute("UPDATE run SET status = 'lost', ended_at = 1");
    const id = await emptyActiveRun();
    await expect(recordMark(deps, 'depart')).rejects.toMatchObject({ code: 'no_active_run' });
    expect((await listRuns(db)).map(r => r.run.id).includes(id)).toBe(false);
    expect(repairLines()).toEqual([`[run] repaired a run without events: removed it {"runId":${id},"startedAt":${NOW}}`]);
  });

  it('writes nothing and reads little when there is nothing to repair', async () => {
    await recordBuy(deps, buyIn(10));
    const statements = { selects: 0, executes: 0 };
    const counted: Db = {
      select: (sql, params) => { statements.selects++; return db.select(sql, params); },
      execute: (sql, params) => { statements.executes++; return db.execute(sql, params); },
    };
    await repairRuns({ ...deps, db: counted });
    await repairRuns({ ...deps, db: counted });
    // the first call on `counted` is the sweep of the leftovers of an income (one write); the second is the repair alone
    statements.selects = 0; statements.executes = 0;
    await repairRuns({ ...deps, db: counted });
    expect(statements.executes).toBe(0);
    expect(statements.selects).toBeLessThanOrEqual(3);                         // the empty runs, the active run and its events
  });
});

describe('a half-written run in the middle of a session', () => {
  /** One session: one `Db` object whose statements that start with `prefix` fail until `heal()`. */
  function flaky(prefix: string) {
    let broken = true;
    const session: Db = {
      select: <T>(sql: string, params?: unknown[]) => db.select<T>(sql, params),
      execute: (sql, params) => (broken && sql.startsWith(prefix) ? Promise.reject(new Error('disk full')) : db.execute(sql, params)),
    };
    return { deps: { ...deps, db: session }, heal: () => { broken = false; } };
  }

  /** A sale whose close failed: bought 300 at NOW, sold at NOW + 60, the run still active; the failure is over. */
  async function closeFailed() {
    const s = flaky('UPDATE run');
    await recordBuy(s.deps, buyIn(300));
    clock.advance(60);
    await expect(recordSell(s.deps, sellIn(300, 7000))).rejects.toThrow('disk full');
    s.heal();
    const stuck = (await getActiveRun(db))!;
    expect(stuck.events.map(e => e.type)).toEqual(['buy', 'sell']);            // what the player was left with
    return { ...s, id: stuck.run.id };
  }

  it('is an empty run (the first event failed): the next purchase starts its own run, at its own time', async () => {
    const s = flaky('INSERT INTO run_event');
    await expect(recordBuy(s.deps, buyIn(300))).rejects.toThrow('disk full');
    s.heal();
    clock.advance(30);
    const r = await recordBuy(s.deps, buyIn(100));
    expect(r.run.startedAt).toBe(NOW + 30);
    expect(r.events).toHaveLength(1);
    expect(await listRuns(db)).toHaveLength(1);
  });

  it('is a sold-out run (the close failed): the next purchase starts a new run, and the old one is closed as done at its last sale', async () => {
    const { deps: s, id } = await closeFailed();
    clock.advance(10);
    const r = await recordBuy(s, buyIn(100));
    expect(r.run.id).not.toBe(id);
    expect(r.run).toMatchObject({ status: 'active', startedAt: NOW + 70 });
    expect(r.events.map(e => e.type)).toEqual(['buy']);                        // not merged into the old run
    const runs = await listRuns(db);
    expect(runs.map(x => x.run.status)).toEqual(['active', 'done']);
    expect(runs[1].run).toMatchObject({ id, endedAt: NOW + 60 });
    expect(runs[1].events.map(e => e.type)).toEqual(['buy', 'sell']);
    expect(repairLines()).toEqual([`[run] repaired a run that was sold out: closed it as done {"runId":${id},"endedAt":${NOW + 60}}`]);
  });

  it('is a sold-out run: a sale right after it is refused as "no active run", not as an oversell of 0 SCU', async () => {
    const { deps: s } = await closeFailed();
    await expect(recordSell(s, sellIn(1, 7000))).rejects.toMatchObject({ code: 'no_active_run', message: 'Нет активного рейса' });
  });

  it('is a sold-out run: a mark right after it is refused, and the run is not marked', async () => {
    const { deps: s, id } = await closeFailed();
    await expect(recordMark(s, 'depart')).rejects.toMatchObject({ code: 'no_active_run' });
    expect((await listRuns(db))[0].events.map(e => e.type)).toEqual(['buy', 'sell']);
    expect((await listRuns(db))[0].run.id).toBe(id);
  });

  it('is a sold-out run: "cargo lost" right after it does not file a sold-out run as lost, it has already been closed as done', async () => {
    const { deps: s, id } = await closeFailed();
    await expect(loseCargo(s)).rejects.toMatchObject({ code: 'no_active_run' });
    expect((await listRuns(db))[0].run).toMatchObject({ id, status: 'done', endedAt: NOW + 60 });
  });

  it('is a sold-out run: an income right after it is written, and the run that was sold out is closed', async () => {
    const { deps: s, id } = await closeFailed();
    await recordIncome(s, incomeIn(10, 100));
    expect((await listRuns(db)).map(r => [r.run.id === id, r.run.status])).toEqual([[false, 'done'], [true, 'done']]);
  });
});

describe('emptyActiveRuns and removeEmptyActiveRun: the guard of the SQL, not only of the service', () => {
  const runAt = (status: 'active' | 'done' | 'lost', at: number) => db.execute(
    'INSERT INTO run (vehicle_id, scu_capacity, started_at, ended_at, status) VALUES (7, 696, ?, ?, ?)', [at, status === 'active' ? null : at + 1, status],
  ).then(r => r.lastInsertId);
  const addBuy = (runId: number) => addRunEvent(db, { runId, ts: NOW, type: 'buy', terminalId: 1, commodityId: 10, scu: 10, price: 100 });
  const addMark = (runId: number) => addRunEvent(db, { runId, ts: NOW, type: 'depart', terminalId: null, commodityId: null, scu: null, price: null });
  const statusOf = async (id: number) => (await db.select<{ status: string }>('SELECT status FROM run WHERE id = ?', [id]))[0]?.status ?? null;

  it('find an active run without events, and only that', async () => {
    const empty = await runAt('active', 10);
    expect(await emptyActiveRuns(db)).toEqual([{ id: empty, startedAt: 10 }]);

    await db.execute("UPDATE run SET status = 'done', ended_at = 11");          // a finished run without events is another thing
    expect(await emptyActiveRuns(db)).toEqual([]);
    await db.execute("UPDATE run SET status = 'lost'");
    expect(await emptyActiveRuns(db)).toEqual([]);
  });

  it('do not find an active run that has an event, a purchase or a mark alike', async () => {
    const withBuy = await runAt('active', 10);
    await addBuy(withBuy);
    expect(await emptyActiveRuns(db)).toEqual([]);

    await db.execute("UPDATE run SET status = 'done', ended_at = 11");
    const withMark = await runAt('active', 20);
    await addMark(withMark);
    expect(await emptyActiveRuns(db)).toEqual([]);
  });

  it('removeEmptyActiveRun removes an active run without events', async () => {
    const empty = await runAt('active', 10);
    await removeEmptyActiveRun(db, empty);
    expect(await statusOf(empty)).toBeNull();
  });

  it('removeEmptyActiveRun leaves an active run that has events, even when it is asked for it by its id', async () => {
    const withBuy = await runAt('active', 10);
    await addBuy(withBuy);
    await removeEmptyActiveRun(db, withBuy);
    expect(await statusOf(withBuy)).toBe('active');
    expect((await getRun(db, withBuy))!.events).toHaveLength(1);
  });

  it('removeEmptyActiveRun leaves a done run and a lost one, with or without events, and only removes the run it is asked for', async () => {
    const done = await runAt('done', 10);
    const lost = await runAt('lost', 20);
    const doneWithEvent = await runAt('done', 30);
    await addBuy(doneWithEvent);
    for (const id of [done, lost, doneWithEvent]) await removeEmptyActiveRun(db, id);
    expect([await statusOf(done), await statusOf(lost), await statusOf(doneWithEvent)]).toEqual(['done', 'lost', 'done']);

    const empty = await runAt('active', 40);
    await removeEmptyActiveRun(db, 999);                                        // an id that is not there changes nothing
    expect(await statusOf(empty)).toBe('active');
  });
});

describe('a repair that cannot be made', () => {
  it('is logged and does not stop the trade: the purchase joins the run as it did before', async () => {
    const id = await emptyActiveRun();
    const broken = { ...deps, db: failingOn(db, 'DELETE FROM run') };
    const r = await recordBuy(broken, buyIn(10));
    expect(r.run.id).toBe(id);
    expect(sink.lines.some(l => l.level === 'warn' && l.line.startsWith('[run] cannot repair'))).toBe(true);
  });

  it('is logged, and repairRuns does not throw: a start must not fail because of it', async () => {
    await soldOutButOpen();
    sink.lines.length = 0;
    await expect(repairRuns({ ...deps, db: failingOn(db, 'UPDATE run') })).resolves.toBeUndefined();
    expect(sink.lines.some(l => l.level === 'warn' && l.line.startsWith('[run] cannot repair'))).toBe(true);
    expect((await getActiveRun(db))!.run.status).toBe('active');
  });

  it('closing a sold-out run does not depend on the DELETE that removes an empty one: it is an UPDATE of its own', async () => {
    await soldOutButOpen();
    await repairRuns({ ...deps, db: failingOn(db, 'DELETE FROM run') });
    expect(await getActiveRun(db)).toBeNull();
    expect((await listRuns(db))[0].run.status).toBe('done');
  });
});
