import type { Db } from '../data/db';
import { createLogger } from '../data/logger';
import { migrate, MIGRATIONS } from '../data/migrations';
import { saveSetting } from '../data/repo/settings';
import type { DatasetName } from './datasets';
import { prepareDataset } from './seed';
import { extendForRun, isRunPhaseDataset, RUN_PHASE_DATASETS } from './seed-run';
import { extendForStats, removeDiary, removeRuns } from './seed-stats';
import { extendForWindow } from './seed-window';

/**
 * Fills a fresh database with a named dataset: the one place that knows how each name is made. `default`, `run` and
 * `empty` are written by `seed.ts`; `window` is the default dataset with the extras of `seed-window.ts` on top; `stats` is
 * `window` with a long history of runs, `no-runs` is `window` without any run, `no-records` is `window` without a run
 * and without a price of the player's own either (a first launch after the first sync); see `seed-stats.ts`.
 * `run-loading`, `run-flight` and `run-unloading` are the default dataset with a run in that phase (`seed-run.ts`).
 * `empty-no-strip` is a first launch of a player who has switched the mini line off: the database has its schema and that one
 * setting, and no reference, so the start fails (the preview has no network) AFTER the settings were read.
 * `newer-schema` is the default dataset in a database written by a NEWER version of the application (its schema version
 * is above the newest migration this build knows): the start refuses it before it touches anything.
 */
export async function prepareAnyDataset(db: Db, dataset: DatasetName, now: number): Promise<void> {
  if (dataset === 'empty-no-strip') {
    const log = createLogger({ write() {} });
    await migrate(db, log);
    await saveSetting(db, log, 'showStrip', false);
    return;
  }
  if (dataset === 'newer-schema') {
    await prepareDataset(db, 'default', now);
    // PRAGMA takes no bound parameters, and the number is our own
    await db.execute(`PRAGMA user_version = ${MIGRATIONS[MIGRATIONS.length - 1].version + 5}`);
    return;
  }
  if (dataset === 'window' || dataset === 'stats' || dataset === 'no-runs' || dataset === 'no-records') {
    await prepareDataset(db, 'default', now);
    await extendForWindow(db, now);
    if (dataset === 'stats') await extendForStats(db, now);
    if (dataset === 'no-runs' || dataset === 'no-records') await removeRuns(db);
    if (dataset === 'no-records') await removeDiary(db);
    return;
  }
  if (isRunPhaseDataset(dataset)) {
    await prepareDataset(db, 'default', now);
    await extendForRun(db, now, RUN_PHASE_DATASETS[dataset]);
    return;
  }
  await prepareDataset(db, dataset, now);
}
