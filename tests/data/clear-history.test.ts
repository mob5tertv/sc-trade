import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/data/db';
import {
  addRunEvent, getActiveRun, listRuns, removeEmptyFinishedRuns, removeEmptyRun, removeFinishedRunEvents, removeFinishedRuns, startRun,
} from '../../src/data/repo/runs';
import { clearHistory, ClearHistoryError, loseCargo, recordBuy, recordIncome, recordMark, recordSell, repairRuns } from '../../src/data/trade';
import type { TradeDeps } from '../../src/data/trade';
import { incomeIn } from '../helpers/income-fixtures';
import { buyIn, NOW, sellIn, tradeFixture } from '../helpers/trade-fixtures';
import type { Clock, TradeFixture } from '../helpers/trade-fixtures';

// Spec 14.14: the history of the player's runs can be cleared, all of it or what ended more than thirty days ago. The player's
// data is deleted here, so the tests are strict about what stays: the run that is going and its events, the runs that are not
// old, the events of the runs that stay, the diary of prices. There are no transactions (one statement per call): the events
// of the runs go first, the runs after them, and what is left when the second statement fails is proved here as well.

const DAY = 86_400;
/** The moment of the clearing, and the threshold of "old" at that moment. */
const CLEAR_AT = NOW + 100 * DAY;
const OLD_BEFORE = CLEAR_AT - 30 * DAY;

let db: Db;
let sink: TradeFixture['sink'];
let clock: Clock;
let deps: TradeDeps;

beforeEach(async () => {
  ({ db, sink, clock, deps } = await tradeFixture());
});

/** Sets the clock of the trade service to `t` (it may go back: the runs are written in any order of their times). */
const at = (t: number): void => clock.advance(t - clock.now());

/**
 * A flight of Gold that began at `start` and ended at `end`: sold (done) or lost; the marks in between when asked. It needs
 * no run to be going: write the run that is going LAST.
 */
async function flight(start: number, end: number, how: 'done' | 'lost' = 'done', marks = false): Promise<number> {
  at(start);
  const { run } = await recordBuy(deps, buyIn(100));
  if (marks) {
    at(start + 10); await recordMark(deps, 'depart');
    at(start + 20); await recordMark(deps, 'arrive');
  }
  at(end);
  if (how === 'done') await recordSell(deps, sellIn(100, 7000));
  else await loseCargo(deps);
  return run.id;
}

/** The run that is going: bought at `start`, still in the hold. */
async function goingRun(start: number): Promise<number> {
  at(start);
  return (await recordBuy(deps, buyIn(50))).run.id;
}

const count = async (table: string): Promise<number> => (await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0].n;
const runIds = async (): Promise<number[]> => (await db.select<{ id: number }>('SELECT id FROM run ORDER BY id')).map(r => r.id);
const eventsOfRun = async (runId: number) => db.select('SELECT * FROM run_event WHERE run_id = ? ORDER BY id', [runId]);
const diary = async () => db.select('SELECT * FROM observation ORDER BY id');

/**
 * The same database behind another `Db` object whose statements that start with `prefix` fail once it is armed: `times` times,
 * always when `times` is not given. `arm()` first lets the trade service make its sweep of the leftovers on this object (it does
 * that at its first call, with a DELETE of its own) so that the sweep is not what fails.
 */
function failing(prefix: string, times = Infinity) {
  let armed = false;
  let failed = 0;
  const wrapper: Db = {
    select: <T>(sql: string, params?: unknown[]) => db.select<T>(sql, params),
    execute: (sql, params) => {
      if (armed && sql.startsWith(prefix) && failed < times) {
        failed++;
        return Promise.reject(new Error('disk full'));
      }
      return db.execute(sql, params);
    },
  };
  return {
    deps: { ...deps, db: wrapper } as TradeDeps,
    failures: () => failed,
    async arm() {
      await repairRuns({ ...deps, db: wrapper });
      armed = true;
      return this;
    },
  };
}

/** What a new session of the application sees: the same file behind another `Db` object. */
const newSession = (): TradeDeps => ({ ...deps, db: { select: (sql, params) => db.select(sql, params), execute: (sql, params) => db.execute(sql, params) } });

const SECOND_STATEMENT = 'DELETE FROM run WHERE';
const FIRST_STATEMENT = 'DELETE FROM run_event';

describe('clearHistory: the whole history', () => {
  it('deletes every finished run, lost ones and the sales without a purchase too, with all their events', async () => {
    await flight(NOW, NOW + 600, 'done', true);
    await flight(NOW + 1000, NOW + 1500, 'lost');
    at(NOW + 2000); await recordIncome(deps, incomeIn(10, 100));
    expect(await runIds()).toHaveLength(3);

    const cleared = await clearHistory(deps, null);

    expect(await runIds()).toEqual([]);
    expect(await count('run_event')).toBe(0);
    // 4 events of the first run (buy, two marks, sell), 1 of the lost one (the purchase; the loss writes none), 1 of the income
    expect(cleared).toEqual({ runs: 3, events: 4 + 1 + 1 });
  });

  it('never deletes the run that is going, nor its events, nor its start', async () => {
    await flight(NOW, NOW + 600);
    const going = await goingRun(NOW + 1000);
    const before = (await getActiveRun(db))!;

    const cleared = await clearHistory(deps, null);

    expect(cleared.runs).toBe(1);
    expect(await getActiveRun(db)).toEqual(before);
    expect(await runIds()).toEqual([going]);
    expect((await eventsOfRun(going)).length).toBe(1);
  });

  it('keeps the run that is going even when it began before everything else and its events are older than thirty days', async () => {
    await flight(NOW, NOW + 600);
    const going = await goingRun(NOW - 90 * DAY);
    await clearHistory(deps, null);
    expect(await runIds()).toEqual([going]);
    expect(await count('run_event')).toBe(1);
  });

  it('does nothing and says zero when there is no finished run', async () => {
    const going = await goingRun(NOW);
    expect(await clearHistory(deps, null)).toEqual({ runs: 0, events: 0 });
    expect(await runIds()).toEqual([going]);
    expect(await count('run_event')).toBe(1);
  });

  it('does nothing and says zero on an empty database', async () => {
    expect(await clearHistory(deps, null)).toEqual({ runs: 0, events: 0 });
  });
});

describe('clearHistory: what ended more than thirty days ago', () => {
  it('deletes the runs that ended before the threshold and keeps the ones that ended after it', async () => {
    const old1 = await flight(NOW, NOW + 600);
    const old2 = await flight(NOW + 1000, NOW + 1200, 'lost');
    const recent = await flight(CLEAR_AT - 2 * DAY, CLEAR_AT - 2 * DAY + 600);
    expect(await runIds()).toEqual([old1, old2, recent]);

    const cleared = await clearHistory(deps, OLD_BEFORE);

    expect(await runIds()).toEqual([recent]);
    expect(cleared).toEqual({ runs: 2, events: 2 + 1 });
  });

  it('counts by the time the run ENDED: begun 31 days ago and ended 29 days ago stays', async () => {
    const stays = await flight(CLEAR_AT - 31 * DAY, CLEAR_AT - 29 * DAY);
    const goes = await flight(CLEAR_AT - 33 * DAY, CLEAR_AT - 32 * DAY);
    await clearHistory(deps, OLD_BEFORE);
    expect(await runIds()).toEqual([stays]);
    expect(goes).not.toBe(stays);
  });

  it('is strict: a run that ended exactly at the threshold stays, one second before it goes', async () => {
    const exact = await flight(OLD_BEFORE - 600, OLD_BEFORE);
    const before = await flight(OLD_BEFORE - 700, OLD_BEFORE - 1);
    await clearHistory(deps, OLD_BEFORE);
    expect(await runIds()).toEqual([exact]);
    expect(before).not.toBe(exact);
  });

  it('keeps the run that is going and its events, however old it is', async () => {
    await flight(NOW, NOW + 600);
    const going = await goingRun(NOW - 60 * DAY);
    const cleared = await clearHistory(deps, OLD_BEFORE);
    expect(cleared.runs).toBe(1);
    expect(await runIds()).toEqual([going]);
    expect(await count('run_event')).toBe(1);
  });

  it('deletes the events of the deleted runs only: the events of the runs that stay are the very same rows', async () => {
    await flight(NOW, NOW + 600, 'done', true);
    const stays = await flight(CLEAR_AT - 5 * DAY, CLEAR_AT - 5 * DAY + 900, 'done', true);
    const going = await goingRun(CLEAR_AT - 1000);
    const before = { stays: await eventsOfRun(stays), going: await eventsOfRun(going) };
    expect(before.stays).toHaveLength(4);

    await clearHistory(deps, OLD_BEFORE);

    expect(await eventsOfRun(stays)).toEqual(before.stays);
    expect(await eventsOfRun(going)).toEqual(before.going);
    expect(await count('run_event')).toBe(5);
  });

  it('says zero when nothing is old', async () => {
    const recent = await flight(CLEAR_AT - DAY, CLEAR_AT - DAY + 600);
    expect(await clearHistory(deps, OLD_BEFORE)).toEqual({ runs: 0, events: 0 });
    expect(await runIds()).toEqual([recent]);
  });
});

describe('clearHistory never touches the diary of prices', () => {
  it('leaves every observation as it was, for both scopes', async () => {
    await flight(NOW, NOW + 600);
    await flight(NOW + 1000, NOW + 1600);
    await goingRun(CLEAR_AT - 100);
    at(CLEAR_AT - 50); await recordIncome(deps, incomeIn(5, 100));
    const before = await diary();
    expect(before.length).toBeGreaterThan(4);

    await clearHistory(deps, OLD_BEFORE);
    expect(await diary()).toEqual(before);
    await clearHistory(deps, null);
    expect(await diary()).toEqual(before);
  });

  it('touches no table but the runs and their events', async () => {
    await flight(NOW, NOW + 600);
    const tables = ['observation', 'setting', 'uex_price', 'uex_meta', 'uex_distance'];
    const before = await Promise.all(tables.map(count));
    await clearHistory(deps, null);
    expect(await Promise.all(tables.map(count))).toEqual(before);
  });
});

describe('the SQL of the deletion repeats its conditions in every statement', () => {
  /** Every statement that is executed from now on, with its parameters (the sweep of the first call is made before). */
  async function spied() {
    const executed: Array<{ sql: string; params: unknown[] }> = [];
    const spy: Db = {
      select: (sql, params) => db.select(sql, params),
      execute: (sql, params) => { executed.push({ sql, params: params ?? [] }); return db.execute(sql, params); },
    };
    const spiedDeps = { ...deps, db: spy };
    await repairRuns(spiedDeps);
    executed.length = 0;
    return { deps: spiedDeps, deletes: () => executed.filter(e => e.sql.startsWith('DELETE')) };
  }

  it('the whole history: two DELETEs, events first; both name the finished statuses, neither holds a list of numbers', async () => {
    await flight(NOW, NOW + 600);
    const s = await spied();
    await clearHistory(s.deps, null);
    const [events, runs, targets, ...rest] = s.deletes();
    expect(rest).toEqual([]);
    // then the targets whose run is gone (spec 14.19): its own table only, by what is left in `run`, no list of numbers either
    expect(targets).toEqual({ sql: 'DELETE FROM run_target WHERE run_id NOT IN (SELECT id FROM run)', params: [] });
    expect(events.sql).toBe("DELETE FROM run_event WHERE run_id IN (SELECT id FROM run WHERE status IN ('done', 'lost'))");
    expect(runs.sql).toBe("DELETE FROM run WHERE status IN ('done', 'lost') AND NOT EXISTS (SELECT 1 FROM run_event WHERE run_event.run_id = run.id)");
    expect(events.params).toEqual([]);
    expect(runs.params).toEqual([]);
  });

  it('what ended before the threshold: both DELETEs carry the time condition, with the same threshold', async () => {
    await flight(NOW, NOW + 600);
    const s = await spied();
    await clearHistory(s.deps, OLD_BEFORE);
    const [events, runs, targets, ...rest] = s.deletes();
    expect(rest).toEqual([]);
    // then the targets whose run is gone (spec 14.19): its own table only, by what is left in `run`, no list of numbers either
    expect(targets).toEqual({ sql: 'DELETE FROM run_target WHERE run_id NOT IN (SELECT id FROM run)', params: [] });
    expect(events.sql).toBe("DELETE FROM run_event WHERE run_id IN (SELECT id FROM run WHERE status IN ('done', 'lost') AND ended_at < ?)");
    expect(runs.sql).toBe("DELETE FROM run WHERE status IN ('done', 'lost') AND ended_at < ? AND NOT EXISTS (SELECT 1 FROM run_event WHERE run_event.run_id = run.id)");
    expect(events.params).toEqual([OLD_BEFORE]);
    expect(runs.params).toEqual([OLD_BEFORE]);
  });
});

describe('the repository statements guard themselves, whoever calls them', () => {
  const runAt = (status: 'active' | 'done' | 'lost', start: number, end: number | null) => db.execute(
    'INSERT INTO run (vehicle_id, scu_capacity, started_at, ended_at, status) VALUES (7, 696, ?, ?, ?)', [start, end, status],
  ).then(r => r.lastInsertId);
  const buyEvent = (runId: number) => addRunEvent(db, { runId, ts: NOW, type: 'buy', terminalId: 1, commodityId: 10, scu: 10, price: 100 });

  it('removeFinishedRunEvents leaves the events of an active run, whatever the threshold', async () => {
    const active = await runAt('active', 1, null);
    await buyEvent(active);
    expect(await removeFinishedRunEvents(db, null)).toBe(0);
    expect(await removeFinishedRunEvents(db, Number.MAX_SAFE_INTEGER)).toBe(0);
    expect(await count('run_event')).toBe(1);
  });

  it('removeFinishedRunEvents removes the events of done and lost runs, and says how many', async () => {
    const done = await runAt('done', 1, 2);
    const lost = await runAt('lost', 3, 4);
    await buyEvent(done); await buyEvent(done); await buyEvent(lost);
    expect(await removeFinishedRunEvents(db, null)).toBe(3);
    expect(await count('run_event')).toBe(0);
    expect(await runIds()).toEqual([done, lost]);
  });

  it('removeFinishedRuns removes the finished runs without events, and leaves an active run (empty or not)', async () => {
    const active = await runAt('active', 1, null);
    const doneWithEvent = await runAt('done', 4, 5);
    await buyEvent(doneWithEvent);
    await runAt('lost', 6, 7);
    await runAt('done', 8, 9);
    expect(await removeFinishedRuns(db, null)).toBe(2);
    expect(await runIds()).toEqual([active, doneWithEvent]);
  });

  it('removeFinishedRuns leaves an active run that has events, and never raises on the foreign key of a finished run that still has some', async () => {
    const active = await runAt('active', 1, null);
    await buyEvent(active);
    const done = await runAt('done', 2, 3);
    await buyEvent(done);
    await expect(removeFinishedRuns(db, null)).resolves.toBe(0);
    expect(await runIds()).toEqual([active, done]);
  });

  it('the foreign key is on: a run with events cannot be deleted by a bare DELETE, which is why the events go first', async () => {
    const done = await runAt('done', 1, 2);
    await buyEvent(done);
    await expect(db.execute('DELETE FROM run WHERE id = ?', [done])).rejects.toThrow(/FOREIGN KEY/i);
  });

  it('removeFinishedRuns by time leaves the runs that ended at or after the threshold', async () => {
    const exact = await runAt('done', 1, 100);
    await runAt('lost', 1, 99);
    expect(await removeFinishedRuns(db, 100)).toBe(1);
    expect(await runIds()).toEqual([exact]);
  });
});

describe('when the second statement fails (there are no transactions)', () => {
  /** One finished run of each kind, a lost run, an income, a run that is going. */
  async function history() {
    const done = await flight(NOW, NOW + 600, 'done', true);
    const lost = await flight(NOW + 1000, NOW + 1500, 'lost');
    at(NOW + 2000); const income = (await recordIncome(deps, incomeIn(10, 100))).run.id;
    const going = await goingRun(NOW + 3000);
    return { done, lost, income, going };
  }

  it('is tried once more, and the clearing is complete when the second try works', async () => {
    const { going } = await history();
    const flaky = await failing(SECOND_STATEMENT, 1).arm();

    const cleared = await clearHistory(flaky.deps, null);

    expect(flaky.failures()).toBe(1);
    expect(cleared).toEqual({ runs: 3, events: 4 + 1 + 1 });
    expect(await runIds()).toEqual([going]);
    expect(sink.lines.filter(l => l.level === 'warn' && l.line.startsWith('[run] cannot delete the cleared runs')).length).toBe(1);
  });

  it('is tried ONCE more, not more often: two failures end the clearing with an error', async () => {
    await history();
    const broken = await failing(SECOND_STATEMENT).arm();
    await expect(clearHistory(broken.deps, null)).rejects.toBeInstanceOf(ClearHistoryError);
    expect(broken.failures()).toBe(2);
  });

  it('after two failures the events are gone and the runs stay as empty finished runs; the run that is going and the diary are untouched', async () => {
    const { done, lost, income, going } = await history();
    const goingBefore = (await getActiveRun(db))!;
    const diaryBefore = await diary();
    const broken = await failing(SECOND_STATEMENT).arm();

    const err = await clearHistory(broken.deps, null).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ClearHistoryError);
    expect(err).toMatchObject({ partial: true, events: 6 });
    // what is left: the three finished runs with no event, exactly what the sweep looks for
    expect(await runIds()).toEqual([done, lost, income, going]);
    expect((await listRuns(db)).filter(r => r.run.status !== 'active').map(r => [r.run.id, r.events.length])).toEqual([[income, 0], [lost, 0], [done, 0]]);
    expect(await getActiveRun(db)).toEqual(goingBefore);
    expect(await diary()).toEqual(diaryBefore);
    expect(sink.lines.some(l => l.level === 'error' && l.line.startsWith('[run] cannot delete the cleared runs'))).toBe(true);
  });

  it('the next start finishes the job: the sweep of the first call of the service removes the empty done AND lost runs, and only them', async () => {
    const { going } = await history();
    await clearHistory((await failing(SECOND_STATEMENT).arm()).deps, null).catch(() => undefined);
    const goingBefore = (await getActiveRun(db))!;
    const diaryBefore = await diary();
    sink.lines.length = 0;

    await repairRuns(newSession());                                              // the first call of the service in a new session

    expect(await runIds()).toEqual([going]);
    expect(await getActiveRun(db)).toEqual(goingBefore);
    expect(await diary()).toEqual(diaryBefore);
    expect(sink.lines.filter(l => l.line.startsWith('[run] removed')).map(l => l.line))
      .toEqual(['[run] removed the finished runs without events (an income or a clearing that was cut off) {"count":3}']);
  });

  it('a second press of the button finishes the job as well', async () => {
    const { going } = await history();
    await clearHistory((await failing(SECOND_STATEMENT).arm()).deps, null).catch(() => undefined);
    expect(await clearHistory(deps, null)).toEqual({ runs: 3, events: 0 });
    expect(await runIds()).toEqual([going]);
  });

  it('with a threshold: the runs that were not old are not touched, the old ones are left empty and the sweep takes them', async () => {
    const old = await flight(NOW, NOW + 600);
    const recent = await flight(CLEAR_AT - DAY, CLEAR_AT - DAY + 600);
    await clearHistory((await failing(SECOND_STATEMENT).arm()).deps, OLD_BEFORE).catch(() => undefined);
    expect(await runIds()).toEqual([old, recent]);
    expect((await eventsOfRun(old)).length).toBe(0);
    expect((await eventsOfRun(recent)).length).toBe(2);
    await repairRuns(newSession());
    expect(await runIds()).toEqual([recent]);
    expect((await eventsOfRun(recent)).length).toBe(2);
  });

  it('a failure of the FIRST statement deletes nothing, and says so', async () => {
    await history();
    const runsBefore = await runIds();
    const eventsBefore = await count('run_event');
    const broken = await failing(FIRST_STATEMENT).arm();

    const err = await clearHistory(broken.deps, null).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ClearHistoryError);
    expect(err).toMatchObject({ partial: false });
    expect(broken.failures()).toBe(1);                                           // the second statement is never tried
    expect(await runIds()).toEqual(runsBefore);
    expect(await count('run_event')).toBe(eventsBefore);
  });

  it('tells the player in a sentence of his own: what happened and what to do', async () => {
    await history();
    const failure = (p: Promise<unknown>): Promise<ClearHistoryError> => p.then(() => { throw new Error('the clearing did not fail'); }, (e: unknown) => e as ClearHistoryError);
    const partial = await failure(clearHistory((await failing(SECOND_STATEMENT).arm()).deps, null));
    expect(partial.message).toBe('История очищена не до конца: в списке остались пустые рейсы. Нажми кнопку ещё раз. Подробности в логе.');
    const none = await failure(clearHistory((await failing(FIRST_STATEMENT).arm()).deps, null));
    expect(none.message).toBe('Не удалось очистить историю: ничего не удалено. Подробности в логе.');
  });
});

describe('the sweep of the leftovers', () => {
  const runAt = (status: 'active' | 'done' | 'lost', start: number, end: number | null) => db.execute(
    'INSERT INTO run (vehicle_id, scu_capacity, started_at, ended_at, status) VALUES (7, 696, ?, ?, ?)', [start, end, status],
  ).then(r => r.lastInsertId);

  it('takes an empty lost run as well now: a clearing that was cut off is the only thing that can leave one', async () => {
    await runAt('done', 1, 2);
    await runAt('lost', 3, 4);
    const activeEmpty = await runAt('active', 5, null);
    const lostWithEvent = await runAt('lost', 6, 7);
    await addRunEvent(db, { runId: lostWithEvent, ts: 6, type: 'buy', terminalId: 1, commodityId: 10, scu: 10, price: 100 });
    expect(await removeEmptyFinishedRuns(db)).toBe(2);
    expect(await runIds()).toEqual([activeEmpty, lostWithEvent]);
  });

  it('removeEmptyRun, the rollback of one income, still removes the done run it is asked for and no lost one', async () => {
    const lostEmpty = await runAt('lost', 3, 4);
    const doneEmpty = await runAt('done', 1, 2);
    await removeEmptyRun(db, lostEmpty);
    await removeEmptyRun(db, doneEmpty);
    expect(await runIds()).toEqual([lostEmpty]);
  });
});

describe('the clearing goes through the queue of the trade service', () => {
  /**
   * Every statement of the database in the order it STARTS, each one slow enough for another job to get in if there were no queue
   * (a DELETE is the slowest: a purchase that is not kept waiting would write all its rows while the first DELETE is going).
   */
  async function slowLog() {
    const log: string[] = [];
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
    const slow: Db = {
      select: async (sql, params) => { log.push(`select ${sql.slice(0, 24)}`); await wait(2); return db.select(sql, params); },
      execute: async (sql, params) => { log.push(sql.slice(0, 24)); await wait(sql.startsWith('DELETE') ? 60 : 2); return db.execute(sql, params); },
    };
    const slowDeps = { ...deps, db: slow };
    await repairRuns(slowDeps);                                                  // the sweep of the first call is not what is looked at
    log.length = 0;
    return { log, deps: slowDeps };
  }

  it('does not cut into a purchase that is being written: all statements of the purchase come first, then those of the clearing', async () => {
    await flight(NOW, NOW + 600);
    const s = await slowLog();
    at(CLEAR_AT);
    await Promise.all([recordBuy(s.deps, buyIn(10)), clearHistory(s.deps, null)]);
    const firstDelete = s.log.findIndex(l => l.startsWith('DELETE'));
    const lastInsert = s.log.map((l, i) => (l.startsWith('INSERT') ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    expect(lastInsert).toBeGreaterThan(0);
    expect(firstDelete).toBeGreaterThan(lastInsert);
    // the purchase started a run of its own, and the clearing left it: it was going
    expect((await getActiveRun(db))!.events).toHaveLength(1);
    expect(await runIds()).toHaveLength(1);
  });

  it('does not let a purchase cut into the clearing: the two DELETEs follow each other with nothing of the purchase between them', async () => {
    await flight(NOW, NOW + 600);
    const s = await slowLog();
    await Promise.all([clearHistory(s.deps, null), recordBuy(s.deps, buyIn(10))]);
    const deletes = s.log.map((l, i) => (l.startsWith('DELETE') ? i : -1)).filter(i => i >= 0);
    expect(deletes).toHaveLength(3);                                    // the events, the runs, the sweep of the targets
    expect(s.log.slice(deletes[0] + 1, deletes[2]).filter(l => l.startsWith('INSERT'))).toEqual([]);
  });

  it('repairs a half-written run before it clears, never while: a run whose close failed is closed as done first, and is then history', async () => {
    await flight(NOW, NOW + 600);
    at(NOW + 1000); await recordBuy(deps, buyIn(300));
    at(NOW + 1060);
    const cut = await failing('UPDATE run').arm();
    await expect(recordSell(cut.deps, sellIn(300, 7000))).rejects.toThrow('disk full');
    expect((await getActiveRun(db))!.events.map(e => e.type)).toEqual(['buy', 'sell']);   // sold out, never closed

    const cleared = await clearHistory(deps, null);

    expect(cleared.runs).toBe(2);
    expect(await runIds()).toEqual([]);
    expect(sink.lines.some(l => l.line.startsWith('[run] repaired a run that was sold out'))).toBe(true);
  });

  it('removes an empty active run (a purchase that was cut off) as the repair does, and the clearing never counts it', async () => {
    await flight(NOW, NOW + 600);
    await startRun(db, { vehicleId: 7, scuCapacity: 696, startedAt: NOW + 5000 });
    const cleared = await clearHistory(deps, null);
    expect(cleared.runs).toBe(1);
    expect(await runIds()).toEqual([]);
  });
});

describe('the line of the service', () => {
  it('says how many runs and events were deleted, and the threshold', async () => {
    await flight(NOW, NOW + 600);
    sink.lines.length = 0;
    await clearHistory(deps, OLD_BEFORE);
    expect(sink.lines.filter(l => l.line.startsWith('[run] history cleared')).map(l => l.line))
      .toEqual([`[run] history cleared {"endedBefore":${OLD_BEFORE},"runs":1,"events":2}`]);
  });

  it('says null for the threshold when the whole history was cleared', async () => {
    await flight(NOW, NOW + 600);
    sink.lines.length = 0;
    await clearHistory(deps, null);
    expect(sink.lines.filter(l => l.line.startsWith('[run] history cleared')).map(l => l.line))
      .toEqual(['[run] history cleared {"endedBefore":null,"runs":1,"events":2}']);
  });
});

describe('the targets of lost runs', () => {
  it('are swept with the runs they belonged to, and kept for the runs that stay', async () => {
    const aimed = { ...deps, settings: { ...deps.settings, targetTerminalId: 2 } };
    await recordBuy(deps, buyIn(300)); await loseCargo(aimed);          // an old lost run
    clock.advance(90 * DAY);
    await recordBuy(deps, buyIn(300)); await loseCargo(aimed);          // a recent one
    const targets = async () => (await db.select<{ run_id: number }>('SELECT run_id FROM run_target ORDER BY run_id')).length;
    expect(await targets()).toBe(2);

    clock.advance(10 * DAY);
    await clearHistory(deps, OLD_BEFORE);
    expect(await targets()).toBe(1);
    expect((await listRuns(db)).map(r => r.run.targetId)).toEqual([2]);

    await clearHistory(deps, null);
    expect(await targets()).toBe(0);
  });
});
