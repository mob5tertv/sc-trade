import { createLogger, memorySink } from '../../src/data/logger';
import { createUexClient } from '../../src/data/uex-client';
import { loadGalleryData, type GalleryData } from '../../src/preview/gallery/data';
import { prepareDataset } from '../../src/preview/seed';
import { testDb } from './test-db';

// The data of the component gallery over the preview dataset `run`, made in Node: a real SQLite database filled by
// the real seed, the real loaders and services behind it, and a UEX client that is offline (the dataset holds every
// distance a suggestion needs, so nothing may reach for the network).

/** The moment the dataset is made and the gallery data is read. */
export const GALLERY_NOW = 1_800_000_000;

export async function galleryData(now: number = GALLERY_NOW): Promise<GalleryData> {
  const db = testDb();
  await prepareDataset(db, 'run', now);
  const log = createLogger(memorySink());
  const offline = createUexClient(async () => { throw new Error('offline'); }, log);
  return loadGalleryData({ db, log, uex: offline, now });
}
