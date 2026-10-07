import type { Db } from '../data/db';
import type { DatasetName } from './datasets';
import { prepareDataset } from './seed';
import { extendForWindow } from './seed-window';

/**
 * Fills a fresh database with a named dataset: the one place that knows how each name is made. `default`, `run` and
 * `empty` are written by `seed.ts`; `window` is the default dataset with the extras of `seed-window.ts` on top.
 */
export async function prepareAnyDataset(db: Db, dataset: DatasetName, now: number): Promise<void> {
  if (dataset === 'window') {
    await prepareDataset(db, 'default', now);
    await extendForWindow(db, now);
    return;
  }
  await prepareDataset(db, dataset, now);
}
