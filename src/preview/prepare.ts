import type { Db } from '../data/db';
import type { DatasetName } from './datasets';
import { prepareDataset } from './seed';
import { extendForRun, isRunPhaseDataset, RUN_PHASE_DATASETS } from './seed-run';
import { extendForWindow } from './seed-window';

/**
 * Fills a fresh database with a named dataset: the one place that knows how each name is made. `default`, `run` and
 * `empty` are written by `seed.ts`; `window` is the default dataset with the extras of `seed-window.ts` on top, and
 * `run-loading`, `run-flight` and `run-unloading` are the default dataset with a run in that phase (`seed-run.ts`).
 */
export async function prepareAnyDataset(db: Db, dataset: DatasetName, now: number): Promise<void> {
  if (dataset === 'window') {
    await prepareDataset(db, 'default', now);
    await extendForWindow(db, now);
    return;
  }
  if (isRunPhaseDataset(dataset)) {
    await prepareDataset(db, 'default', now);
    await extendForRun(db, now, RUN_PHASE_DATASETS[dataset]);
    return;
  }
  await prepareDataset(db, dataset, now);
}
