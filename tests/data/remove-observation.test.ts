import { describe, expect, it } from 'vitest';
import { createLogger, memorySink } from '../../src/data/logger';
import { addObservation, editObservation, latestObservations, removeLatestObservation } from '../../src/data/repo/diary';
import { migratedDb } from '../helpers/test-db';

// Spec 14.19: a price typed in at the wrong terminal (the quick entry takes any commodity for the terminal that is viewed) can be
// taken out of the diary. The latest record of that one cell goes; everything else stays.
const log = createLogger(memorySink());
const cell = { terminalId: 486, commodityId: 51, side: 'buy' as const };

describe('removeLatestObservation', () => {
  it('removes the one record of a cell: the cell is gone from the diary', async () => {
    const db = await migratedDb();
    await addObservation(db, log, { ts: 1000, ...cell, price: 3333, scu: 15 });
    expect(await removeLatestObservation(db, log, cell)).toBe(1);
    expect(await latestObservations(db)).toEqual([]);
  });

  it('removes only the latest record: the reading before it is the price there again', async () => {
    const db = await migratedDb();
    await addObservation(db, log, { ts: 1000, ...cell, price: 3000, scu: 40 });
    await addObservation(db, log, { ts: 2000, ...cell, price: 3333, scu: 15 });
    await removeLatestObservation(db, log, cell);
    expect(await latestObservations(db)).toMatchObject([{ ts: 1000, price: 3000, scu: 40 }]);
  });

  it('touches no other terminal, commodity or side', async () => {
    const db = await migratedDb();
    await addObservation(db, log, { ts: 1000, ...cell, price: 3333, scu: 15 });
    await addObservation(db, log, { ts: 1000, ...cell, terminalId: 25, price: 3333, scu: 35 });
    await addObservation(db, log, { ts: 1000, ...cell, commodityId: 132, price: 2222, scu: 222 });
    await addObservation(db, log, { ts: 1000, ...cell, side: 'sell', price: 4000, scu: null });
    await removeLatestObservation(db, log, cell);
    const left = (await latestObservations(db)).map((o) => [o.terminalId, o.commodityId, o.side]).sort();
    expect(left).toEqual([[25, 51, 'buy'], [486, 132, 'buy'], [486, 51, 'sell']]);
  });

  it('removes nothing where there is no record', async () => {
    const db = await migratedDb();
    expect(await removeLatestObservation(db, log, cell)).toBe(0);
  });
});
