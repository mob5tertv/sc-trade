import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/data/db';
import { createLogger, memorySink } from '../../src/data/logger';
import { MIN_READING_GAP_SEC } from '../../src/core/market';
import { obsKey } from '../../src/core/types';
import { addObservation, latestObservations, latestQuantities, previousPrices, stockStats } from '../../src/data/repo/diary';
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

describe('latestQuantities', () => {
  it('is empty for an empty diary', async () => {
    expect(await latestQuantities(db)).toEqual([]);
  });

  it('returns the latest observation that carries a quantity, per terminal, commodity and side', async () => {
    await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 300 });
    await addObservation(db, log, { ts: 200, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: null });
    await addObservation(db, log, { ts: 150, terminalId: 1, commodityId: 10, side: 'sell', price: 5000, scu: null });
    expect(await latestQuantities(db)).toEqual([{ terminalId: 1, commodityId: 10, side: 'buy', ts: 100, scu: 300 }]);
  });

  it('keeps a recorded zero as a quantity reading', async () => {
    await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 0 });
    expect(await latestQuantities(db)).toEqual([{ terminalId: 1, commodityId: 10, side: 'buy', ts: 100, scu: 0 }]);
  });

  it('prefers a newer reading to an older one, and a zero that is the newest to a larger quantity before it', async () => {
    await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 300 });
    await addObservation(db, log, { ts: 300, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 0 });
    await addObservation(db, log, { ts: 200, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 150 });
    expect(await latestQuantities(db)).toEqual([{ terminalId: 1, commodityId: 10, side: 'buy', ts: 300, scu: 0 }]);
  });

  it('takes the later timestamp even when it was written earlier', async () => {
    await addObservation(db, log, { ts: 200, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 40 });
    await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 300 });
    expect((await latestQuantities(db)).map((q) => q.scu)).toEqual([40]);
  });

  it('breaks a timestamp tie by insertion order', async () => {
    await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 300 });
    await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 40 });
    expect((await latestQuantities(db)).map((q) => q.scu)).toEqual([40]);
  });

  it('keeps terminals, commodities and sides apart, ordered by terminal, commodity and side', async () => {
    await addObservation(db, log, { ts: 1, terminalId: 2, commodityId: 10, side: 'buy', price: 1, scu: 3 });
    await addObservation(db, log, { ts: 1, terminalId: 1, commodityId: 20, side: 'buy', price: 1, scu: 4 });
    await addObservation(db, log, { ts: 1, terminalId: 1, commodityId: 10, side: 'sell', price: 1, scu: 2 });
    await addObservation(db, log, { ts: 1, terminalId: 1, commodityId: 10, side: 'buy', price: 1, scu: 1 });
    expect((await latestQuantities(db)).map((q) => [q.terminalId, q.commodityId, q.side, q.scu])).toEqual([
      [1, 10, 'buy', 1], [1, 10, 'sell', 2], [1, 20, 'buy', 4], [2, 10, 'buy', 3],
    ]);
  });

  it('leaves out a stock whose observations all lack a quantity', async () => {
    await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: null });
    await addObservation(db, log, { ts: 200, terminalId: 1, commodityId: 10, side: 'buy', price: 6100, scu: null });
    expect(await latestQuantities(db)).toEqual([]);
  });
});

describe('previousPrices', () => {
  const T = 1_000_000;
  const write = (ts: number, price: number, o: { terminalId?: number; commodityId?: number; side?: 'buy' | 'sell'; scu?: number | null } = {}) => addObservation(
    db, log, { ts, terminalId: o.terminalId ?? 1, commodityId: o.commodityId ?? 10, side: o.side ?? 'buy', price, scu: o.scu ?? null },
  );
  const prices = async () => (await previousPrices(db)).map((p) => [p.ts - T, p.price]);

  it('is empty for an empty diary', async () => {
    expect(await previousPrices(db)).toEqual([]);
  });

  it('has no previous price after a single reading', async () => {
    await write(T, 6000);
    expect(await previousPrices(db)).toEqual([]);
  });

  it('takes the first of two readings that are far enough apart', async () => {
    await write(T, 6000);
    await write(T + 600, 6120);
    expect(await previousPrices(db)).toEqual([{ terminalId: 1, commodityId: 10, side: 'buy', ts: T, price: 6000 }]);
  });

  it('takes the second of three readings', async () => {
    await write(T, 5900);
    await write(T + 600, 6000);
    await write(T + 1200, 6120);
    expect(await prices()).toEqual([[600, 6000]]);
  });

  it('counts a gap of exactly the minimum, and not a second less', async () => {
    await write(T, 6000);
    await write(T + 120, 6120);
    expect(await prices()).toEqual([[0, 6000]]);

    await write(T + 5000, 7000, { commodityId: 20 });
    await write(T + 5000 + 119, 7100, { commodityId: 20 });
    expect(await previousPrices(db)).toHaveLength(1);
  });

  it('treats a reading seconds after another as a correction, not as a move of the market', async () => {
    await write(T, 6000);
    await write(T + 30, 6120);
    expect(await previousPrices(db)).toEqual([]);
  });

  it('does not take a correction made after a normal pair as the previous reading', async () => {
    await write(T, 6000);
    await write(T + 600, 6120);
    await write(T + 610, 6150);        // I typed 6120 wrong and fixed it ten seconds later
    expect(await prices()).toEqual([[0, 6000]]);
  });

  it('takes the corrected value of an earlier reading, not the typo that came before it', async () => {
    await write(T, 6000);
    await write(T + 10, 6010);         // a correction of the first reading
    await write(T + 700, 6120);
    expect(await prices()).toEqual([[10, 6010]]);
  });

  it('measures the gap against the latest reading, so a reading before a long run of corrections still counts', async () => {
    await write(T, 6000);
    await write(T + 600, 6100);
    await write(T + 610, 6110);
    await write(T + 620, 6120);
    expect(await prices()).toEqual([[0, 6000]]);
  });

  it('moves on to the reading before the pair once a later reading is far enough from it', async () => {
    await write(T, 6000);
    await write(T + 600, 6100);
    await write(T + 610, 6110);
    await write(T + 1400, 6200);
    expect(await prices()).toEqual([[610, 6110]]);
  });

  it('does not let readings of the same second be the previous of each other', async () => {
    await write(T, 6000);
    await write(T, 6120);
    expect(await previousPrices(db)).toEqual([]);
  });

  it('takes the later timestamp even when it was written earlier', async () => {
    await write(T + 600, 6120);
    await write(T, 6000);
    await write(T + 300, 6050);
    expect(await prices()).toEqual([[300, 6050]]);
  });

  it('keeps the two sides apart', async () => {
    await write(T, 6000, { side: 'buy' });
    await write(T + 600, 6120, { side: 'sell' });
    expect(await previousPrices(db)).toEqual([]);

    await write(T + 900, 6200, { side: 'buy' });
    expect(await previousPrices(db)).toEqual([{ terminalId: 1, commodityId: 10, side: 'buy', ts: T, price: 6000 }]);
  });

  it('keeps terminals and commodities apart', async () => {
    await write(T, 6000, { terminalId: 1 });
    await write(T + 600, 6120, { terminalId: 2 });
    await write(T + 900, 6130, { commodityId: 20 });
    expect(await previousPrices(db)).toEqual([]);
  });

  it('returns one price per stock, ordered by terminal, commodity and side', async () => {
    for (const [terminalId, commodityId, side] of [[2, 10, 'buy'], [1, 20, 'buy'], [1, 10, 'sell'], [1, 10, 'buy']] as const) {
      await write(T, terminalId * 1000 + commodityId, { terminalId, commodityId, side });
      await write(T + 600, 1, { terminalId, commodityId, side });
    }
    expect((await previousPrices(db)).map((p) => [p.terminalId, p.commodityId, p.side, p.price])).toEqual([
      [1, 10, 'buy', 1010], [1, 10, 'sell', 1010], [1, 20, 'buy', 1020], [2, 10, 'buy', 2010],
    ]);
  });

  it('is about the price only: a reading with or without a quantity counts the same', async () => {
    await write(T, 6000, { scu: 300 });
    await write(T + 600, 6120, { scu: null });
    await write(T + 1200, 6200, { scu: 0 });
    expect(await prices()).toEqual([[600, 6120]]);
  });

  it('returns whole readings with numeric fields', async () => {
    await write(T, 6840.5, { terminalId: 3, commodityId: 20, side: 'sell' });
    await write(T + 600, 6900, { terminalId: 3, commodityId: 20, side: 'sell' });
    expect(await previousPrices(db)).toEqual([{ terminalId: 3, commodityId: 20, side: 'sell', ts: T, price: 6840.5 }]);
  });

  it('is one SELECT with a bound parameter that never scans the diary table, only its index', async () => {
    const seen: Array<{ sql: string; params: unknown[] }> = [];
    const spy: Db = {
      select: (sql, params) => { seen.push({ sql, params: params ?? [] }); return db.select(sql, params); },
      execute: (sql, params) => db.execute(sql, params),
    };
    await previousPrices(spy);
    expect(seen).toHaveLength(1);
    expect(seen[0].sql.trimStart()).toMatch(/^SELECT /);
    expect(seen[0].params).toEqual([MIN_READING_GAP_SEC]);

    const plan = (await db.select<{ detail: string }>(`EXPLAIN QUERY PLAN ${seen[0].sql}`, seen[0].params)).map((r) => r.detail);
    expect(plan.filter((d) => /^SCAN (observation|o|i|p)$/.test(d))).toEqual([]);
    expect(plan.some((d) => d.includes('USING COVERING INDEX observation_lookup'))).toBe(true);
  });

  it('answers a diary of thousands of observations', async () => {
    // 200 stocks, 25 readings each, ten minutes apart: the previous one is always the second from the end
    for (let stock = 0; stock < 200; stock++) {
      for (let i = 0; i < 25; i++) {
        await write(T + i * 600, stock * 100 + i, { terminalId: 1 + (stock % 20), commodityId: 10 + Math.floor(stock / 20), side: stock % 2 === 0 ? 'buy' : 'sell' });
      }
    }
    const previous = await previousPrices(db);
    expect(previous).toHaveLength(200);
    expect(previous.every((p) => p.ts === T + 23 * 600 && p.price % 100 === 23)).toBe(true);
  });
});

describe('stockStats', () => {
  const write = (ts: number, scu: number | null, o: { terminalId?: number; commodityId?: number; side?: 'buy' | 'sell' } = {}) => addObservation(
    db, log, { ts, terminalId: o.terminalId ?? 1, commodityId: o.commodityId ?? 10, side: o.side ?? 'buy', price: 6000, scu },
  );

  it('derives the largest quantity and the fastest refill per terminal, commodity and side', async () => {
    for (const [ts, scu] of [[0, 40], [600, 140], [1200, 150]] as const)
      await addObservation(db, log, { ts, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu });
    await addObservation(db, log, { ts: 0, terminalId: 1, commodityId: 10, side: 'sell', price: 5000, scu: null });
    const s = await stockStats(db);
    expect(s.get(obsKey(1, 10, 'buy'))).toEqual({ maxScu: 150, ratePerMin: 10 });
    expect(s.has(obsKey(1, 10, 'sell'))).toBe(false);
  });

  it('is empty for an empty diary', async () => {
    expect((await stockStats(db)).size).toBe(0);
  });

  it('orders the readings by time, not by the order they were written in', async () => {
    await write(1200, 150);
    await write(0, 40);
    await write(600, 140);
    expect((await stockStats(db)).get(obsKey(1, 10, 'buy'))).toEqual({ maxScu: 150, ratePerMin: 10 });
  });

  it('keeps terminals, commodities and sides apart', async () => {
    await write(0, 0);
    await write(600, 60);                                                   // 6 per minute at 1/10/buy
    await write(0, 100, { terminalId: 2 });
    await write(600, 400, { terminalId: 2 });                               // 30 per minute at 2/10/buy
    await write(0, 5, { commodityId: 20 });
    await write(0, 7, { side: 'sell' });
    const s = await stockStats(db);
    expect(s.get(obsKey(1, 10, 'buy'))).toEqual({ maxScu: 60, ratePerMin: 6 });
    expect(s.get(obsKey(2, 10, 'buy'))).toEqual({ maxScu: 400, ratePerMin: 30 });
    expect(s.get(obsKey(1, 20, 'buy'))).toEqual({ maxScu: 5, ratePerMin: null });
    expect(s.get(obsKey(1, 10, 'sell'))).toEqual({ maxScu: 7, ratePerMin: null });
    expect(s.size).toBe(4);
  });

  it('skips readings without a quantity and keeps a known zero', async () => {
    await write(0, null);
    await write(300, 0);
    await write(600, null);
    await write(900, 30);
    expect((await stockStats(db)).get(obsKey(1, 10, 'buy'))).toEqual({ maxScu: 30, ratePerMin: 3 });   // +30 in 10 min, from 300 s to 900 s
  });

  it('leaves out a key whose readings all lack a quantity', async () => {
    await write(0, null);
    await write(600, null);
    expect((await stockStats(db)).size).toBe(0);
  });
});
