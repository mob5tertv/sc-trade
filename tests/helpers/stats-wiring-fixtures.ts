import type { Db } from '../../src/data/db';
import { addRunEvent, closeRun, startRun } from '../../src/data/repo/runs';
import { migratedDb } from './test-db';

// Fixtures of the statistics wiring (task 16b + 17c): a database with runs and no diary at all, and databases that fail.

export interface RunSpec {
  /** Unix seconds of the first purchase; the run is closed `lastsSec` later, or stays active when `lastsSec` is `null`. */
  startedAt: number;
  lastsSec: number | null;
  status?: 'done' | 'lost';
}

/**
 * A migrated database that holds the given runs written by the repository functions: Gold from terminal 1 (a buy) and,
 * for a run that ends, a sale at terminal 2 at the end time. NOTHING is written to the diary (the trade service would
 * add an observation with every trade), so the only records in it are the events of the runs: the rule "sessions are cut
 * from the timestamps of ALL records" is visible in exactly this case.
 */
export async function dbWithRuns(specs: RunSpec[]): Promise<Db> {
  const db = await migratedDb();
  for (const spec of specs) {
    const runId = await startRun(db, { vehicleId: null, scuCapacity: 100, startedAt: spec.startedAt });
    await addRunEvent(db, { runId, ts: spec.startedAt, type: 'buy', terminalId: 1, commodityId: 10, scu: 100, price: 5000 });
    if (spec.lastsSec === null) continue;
    const endedAt = spec.startedAt + spec.lastsSec;
    await addRunEvent(db, { runId, ts: endedAt, type: 'sell', terminalId: 2, commodityId: 10, scu: 100, price: 5600 });
    await closeRun(db, runId, spec.status ?? 'done', endedAt);
  }
  return db;
}

/** The same database, but every statement that starts with `prefix` fails like a broken disk. */
export function failingOn(inner: Db, prefix: string): Db {
  return {
    select: <T>(sql: string, params?: unknown[]) => (sql.startsWith(prefix) ? Promise.reject(new Error('disk image is malformed')) : inner.select<T>(sql, params)),
    execute: (sql, params) => inner.execute(sql, params),
  };
}
