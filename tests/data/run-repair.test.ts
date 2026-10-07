import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/data/db';
import { addRunEvent, getActiveRun, listRuns, startRun } from '../../src/data/repo/runs';
import { loseCargo, recordBuy, recordMark, recordSell, repairRuns } from '../../src/data/trade';
import type { TradeDeps } from '../../src/data/trade';
import { buyIn, NOW, sellIn, tradeFixture } from '../helpers/trade-fixtures';
import type { Clock, TradeFixture } from '../helpers/trade-fixtures';

// The two states of a run that a trade cut off half-way leaves (the plugin has no transactions): an active run without a
// single event (the run was started, its first purchase was never written) and an active run whose last sale was written
// but which was never closed. They are repaired when the application starts, and by the first call of the trade service.

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
    clock.advance(100);
    await recordMark(deps, 'arrive');
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

  it('is not repeated at every trade: a half-written run of this session is left for the next start', async () => {
    await recordBuy(deps, buyIn(10));
    await db.execute("UPDATE run SET status = 'lost', ended_at = 1");
    await emptyActiveRun();
    await recordMark(deps, 'depart');
    expect((await getActiveRun(db))!.events).toHaveLength(1);
    expect(repairLines()).toEqual([]);
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

  it('does not keep the other repair from being made', async () => {
    await soldOutButOpen();
    await repairRuns({ ...deps, db: failingOn(db, 'DELETE FROM run') });
    expect(await getActiveRun(db)).toBeNull(); // the close does not use DELETE
  });
});
