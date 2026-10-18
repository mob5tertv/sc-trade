import type { Db } from '../data/db';
import type { Logger } from '../data/logger';
import { allRecordTimestamps, listRuns } from '../data/repo/runs';
import { listStorageEntries } from '../data/repo/storage';
import { storageLosses } from '../core/storage';
import type { History } from './vm/stats-view';

// Reading the run history for the statistics. A plain module (no runes), so that it runs in the tests too.

/** Every run with its events (newest first), the time of every record (observations, run events, the storage) and what was written off the storage. */
export async function loadHistory(db: Db): Promise<History> {
  const runs = await listRuns(db);
  const recordTs = await allRecordTimestamps(db);
  const losses = storageLosses(await listStorageEntries(db));
  return { runs, recordTs, losses };
}

/**
 * `loadHistory` that never throws: a failure is logged under `ui` (with the error, which the screen never shows) and
 * the answer is `null`, so the caller keeps what it had. The statistics must not be able to break the window.
 */
export async function loadHistorySafely(db: Db, log: Logger): Promise<History | null> {
  try {
    return await loadHistory(db);
  } catch (err) {
    log.error('ui', 'cannot load the statistics', { err });
    return null;
  }
}
