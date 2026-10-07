import type { Settings } from '../../src/core/settings';
import type { Reference } from '../../src/core/types';
import type { Db } from '../../src/data/db';
import { createLogger, memorySink } from '../../src/data/logger';
import { addRunEvent, closeRun, startRun } from '../../src/data/repo/runs';
import { loadSettings } from '../../src/data/repo/settings';
import { loadReference } from '../../src/data/repo/uex-cache';
import type { SuggestDeps } from '../../src/data/suggest';
import { createUexClient } from '../../src/data/uex-client';
import { prepareAnyDataset } from '../../src/preview/prepare';
import { loadHistory } from '../../src/ui/stats-history';
import { figuresOf } from '../../src/ui/vm/stats-view';
import { migratedDb, testDb } from './test-db';

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

// ---------------------------------------------------------------------------
// The preview datasets of the section ("stats", "no-runs"), read the way the application reads them.
// ---------------------------------------------------------------------------

/** The moment the preview data of the statistics is made and read. */
export const STATS_NOW = 1_800_000_000;

export interface StatsData { db: Db; reference: Reference; settings: Settings; deps: SuggestDeps }

/**
 * A dataset in Node: a real SQLite database filled by the real seed, with a UEX client that is offline (the datasets
 * hold every distance). The medians of the player's own runs are in the dependencies, as `app.suggestDeps()` gives them.
 */
export async function statsData(dataset: 'stats' | 'no-runs' | 'no-records' | 'window', now: number = STATS_NOW): Promise<StatsData> {
  const db = testDb();
  await prepareAnyDataset(db, dataset, now);
  const log = createLogger(memorySink());
  const reference = await loadReference(db);
  const settings = await loadSettings(db, log);
  const uex = createUexClient(async () => { throw new Error('offline'); }, log);
  const ownMedian = figuresOf(await loadHistory(db)).ownMedian;
  return { db, reference, settings, deps: { db, uex, log, now: () => now, reference, settings, ownMedian } };
}
