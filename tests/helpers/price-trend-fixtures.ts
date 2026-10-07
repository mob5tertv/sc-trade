import type { Side } from '../../src/core/types';
import type { Db } from '../../src/data/db';
import { latestObservations, previousPrices } from '../../src/data/repo/diary';
import { createLogger, memorySink } from '../../src/data/logger';
import { loadReference } from '../../src/data/repo/uex-cache';
import { createUexClient } from '../../src/data/uex-client';
import { loadGalleryData } from '../../src/preview/gallery/data';
import type { GalleryData } from '../../src/preview/gallery/data';
import { prepareDataset } from '../../src/preview/seed';
import { GALLERY_NOW } from './gallery-fixtures';
import { testDb } from './test-db';

// Fixtures for the tests of the triangle of my own price over the preview data: the data itself says which readings
// the diary holds, so a test can tell "the same price as before" from "a first reading".

/** One own price that has an earlier reading to be compared with: the stock, the earlier price and the latest one. */
export interface PriceMove { terminal: number; code: string; side: Side; was: number; now: number; gapSec: number }

/** Every price of mine that has a previous reading in the diary, by terminal, commodity code and side. */
export async function priceMoves(db: Db): Promise<PriceMove[]> {
  const ref = await loadReference(db);
  const latest = await latestObservations(db);
  const moves: PriceMove[] = [];
  for (const p of await previousPrices(db)) {
    const last = latest.find((o) => o.terminalId === p.terminalId && o.commodityId === p.commodityId && o.side === p.side);
    if (last === undefined) throw new Error(`no latest reading for ${p.terminalId}:${p.commodityId}:${p.side}`);
    moves.push({
      terminal: p.terminalId, code: ref.commodities.get(p.commodityId)?.code ?? `#${p.commodityId}`, side: p.side,
      was: p.price, now: last.price, gapSec: last.ts - p.ts,
    });
  }
  return moves;
}

/**
 * The gallery data over the `run` dataset together with the diary it was read from, as the tables saw it: the gallery
 * buys the cargo of its long mini line after the tables are made, at `now` (each purchase leaves a reading of the
 * price), so those readings are taken out again; nothing else is written at `now` or later.
 */
export async function galleryWithDiary(now: number = GALLERY_NOW): Promise<{ data: GalleryData; db: Db }> {
  const db = testDb();
  await prepareDataset(db, 'run', now);
  const log = createLogger(memorySink());
  const offline = createUexClient(async () => { throw new Error('offline'); }, log);
  const data = await loadGalleryData({ db, log, uex: offline, now });
  await db.execute('DELETE FROM observation WHERE ts >= ?', [now]);
  return { data, db };
}
