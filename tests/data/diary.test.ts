import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/data/db';
import { createLogger, memorySink } from '../../src/data/logger';
import { addObservation, latestObservations } from '../../src/data/repo/diary';
import { migratedDb } from '../helpers/test-db';

let db: Db;
let sink: ReturnType<typeof memorySink>;
let log: ReturnType<typeof createLogger>;

beforeEach(async () => {
  db = await migratedDb();
  sink = memorySink();
  log = createLogger(sink);
});

describe('addObservation', () => {
  it('returns the id of the new row, increasing with every write', async () => {
    const first = await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 1, scu: null });
    const second = await addObservation(db, log, { ts: 50, terminalId: 1, commodityId: 20, side: 'buy', price: 2, scu: null });
    expect(second).toBeGreaterThan(first);
    expect((await latestObservations(db)).find((o) => o.id === second)).toMatchObject({ ts: 50, commodityId: 20, price: 2 });
  });

  it('logs the written values', async () => {
    await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: 340 });
    expect(sink.lines.at(-1)!.line).toBe('[diary] observation {"ts":100,"terminalId":1,"commodityId":10,"side":"buy","price":6120,"scu":340}');
  });

  it('logs the values in a fixed order and a missing quantity as null', async () => {
    await addObservation(db, log, { scu: null, price: 5000, side: 'sell', commodityId: 20, terminalId: 2, ts: 7 });
    expect(sink.lines.at(-1)!.line).toBe('[diary] observation {"ts":7,"terminalId":2,"commodityId":20,"side":"sell","price":5000,"scu":null}');
  });

  it('logs nothing when the write fails', async () => {
    // The table accepts only the two sides: a bad value is rejected by the database itself.
    const bad = { ts: 1, terminalId: 1, commodityId: 10, side: 'both', price: 1, scu: null } as unknown as Parameters<typeof addObservation>[2];
    await expect(addObservation(db, log, bad)).rejects.toThrow();
    expect(sink.lines).toEqual([]);
  });
});

describe('latestObservations', () => {
  it('is empty for an empty diary', async () => {
    expect(await latestObservations(db)).toEqual([]);
  });

  it('returns only the latest observation per terminal, commodity and side', async () => {
    await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 300 });
    await addObservation(db, log, { ts: 200, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: null });
    await addObservation(db, log, { ts: 150, terminalId: 1, commodityId: 10, side: 'sell', price: 5000, scu: null });
    const l = await latestObservations(db);
    expect(l).toHaveLength(2);
    expect(l.find((o) => o.side === 'buy')).toMatchObject({ price: 6120, scu: null, ts: 200 });
  });

  it('takes the later timestamp even when it was written earlier', async () => {
    await addObservation(db, log, { ts: 200, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: null });
    await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: null });
    expect((await latestObservations(db)).map((o) => o.price)).toEqual([6120]);
  });

  it('breaks a timestamp tie by insertion order', async () => {
    await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 1, scu: null });
    await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 2, scu: null });
    expect((await latestObservations(db))[0].price).toBe(2);
  });

  it('keeps terminals, commodities and sides apart', async () => {
    await addObservation(db, log, { ts: 1, terminalId: 1, commodityId: 10, side: 'buy', price: 11, scu: null });
    await addObservation(db, log, { ts: 1, terminalId: 2, commodityId: 10, side: 'buy', price: 12, scu: null });
    await addObservation(db, log, { ts: 1, terminalId: 1, commodityId: 20, side: 'buy', price: 13, scu: null });
    await addObservation(db, log, { ts: 1, terminalId: 1, commodityId: 10, side: 'sell', price: 14, scu: null });
    expect((await latestObservations(db)).map((o) => o.price).sort()).toEqual([11, 12, 13, 14]);
  });

  it('returns whole observations with numeric fields', async () => {
    const id = await addObservation(db, log, { ts: 100, terminalId: 3, commodityId: 20, side: 'sell', price: 6840.5, scu: 340 });
    expect(await latestObservations(db)).toEqual([{ id, ts: 100, terminalId: 3, commodityId: 20, side: 'sell', price: 6840.5, scu: 340 }]);
  });
});
