import type { Db } from '../data/db';
import type { DatasetName } from './datasets';
import { prepareDataset } from './seed';
import { extendForStats, removeDiary, removeRuns } from './seed-stats';
import { extendForWindow } from './seed-window';

/**
 * Fills a fresh database with a named dataset: the one place that knows how each name is made. `default`, `run` and
 * `empty` are written by `seed.ts`; `window` is the default dataset with the extras of `seed-window.ts` on top; `stats` is
 * `window` with a long history of runs, `no-runs` is `window` without any run, `no-records` is `window` without a run
 * and without a price of the player's own either (a first launch after the first sync); see `seed-stats.ts`.
 */
export async function prepareAnyDataset(db: Db, dataset: DatasetName, now: number): Promise<void> {
  if (dataset === 'window' || dataset === 'stats' || dataset === 'no-runs' || dataset === 'no-records') {
    await prepareDataset(db, 'default', now);
    await extendForWindow(db, now);
    if (dataset === 'stats') await extendForStats(db, now);
    if (dataset === 'no-runs' || dataset === 'no-records') await removeRuns(db);
    if (dataset === 'no-records') await removeDiary(db);
    return;
  }
  await prepareDataset(db, dataset, now);
}
