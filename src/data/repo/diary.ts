import { MIN_READING_GAP_SEC } from '../../core/market';
import { learnRatePerMin, maxSeenScu } from '../../core/stock';
import { obsKey } from '../../core/types';
import type { Observation, PriceReading, QuantityReading, Side, StockStats } from '../../core/types';
import type { Db } from '../db';
import type { Logger } from '../logger';

// The price diary: the prices the player saw with their own eyes, one row per entry.
// Rows are never updated or deleted; the newest one per terminal, commodity and side is what counts.

interface ObservationRow {
  id: number; ts: number; terminal_id: number; commodity_id: number; side: Side; price: number; scu: number | null;
}

/** Appends an observation and logs the written values; returns the id of the new row. */
export async function addObservation(db: Db, log: Logger, o: Omit<Observation, 'id'>): Promise<number> {
  const { ts, terminalId, commodityId, side, price, scu } = o;
  const result = await db.execute(
    'INSERT INTO observation (ts, terminal_id, commodity_id, side, price, scu) VALUES (?, ?, ?, ?, ?, ?)',
    [ts, terminalId, commodityId, side, price, scu],
  );
  log.info('diary', 'observation', { ts, terminalId, commodityId, side, price, scu });
  return result.lastInsertId;
}

/**
 * Removes the LATEST observation of one cell of the diary (a terminal, a commodity, a side): a price that was typed in at the
 * wrong terminal or for the wrong commodity (spec 14.19). The reading before it, when there is one, is the player's price there
 * again; with none left the cell falls back to UEX, or goes when UEX has nothing either. Returns how many rows went (0 or 1).
 */
export async function removeLatestObservation(db: Db, log: Logger, cell: Pick<Observation, 'terminalId' | 'commodityId' | 'side'>): Promise<number> {
  const result = await db.execute(
    `DELETE FROM observation
      WHERE id = (SELECT id FROM observation WHERE terminal_id = ? AND commodity_id = ? AND side = ? ORDER BY ts DESC, id DESC LIMIT 1)`,
    [cell.terminalId, cell.commodityId, cell.side],
  );
  log.info('diary', 'observation removed', { ...cell, rows: result.rowsAffected });
  return result.rowsAffected;
}

/** The observation a trade wrote: the moment, the place, the commodity, the side and the price of that trade. */
export type TradeObservation = Pick<Observation, 'ts' | 'terminalId' | 'commodityId' | 'side' | 'price'>;

/**
 * Corrects the observation a trade wrote when that trade is corrected (spec 14.19, item 5): the price becomes `price`, and the
 * quantity after the trade moves by `scuDelta` (never below zero; a quantity that was not recorded stays unrecorded). The row is
 * found by what the trade wrote (`was`); when several match, the last one written. Returns how many rows were changed: 0 when
 * the trade left no observation that still matches (it was written by an older version, or corrected by hand since).
 */
export async function amendTradeObservation(db: Db, log: Logger, was: TradeObservation, price: number, scuDelta: number): Promise<number> {
  const result = await db.execute(
    `UPDATE observation SET price = ?, scu = CASE WHEN scu IS NULL THEN NULL ELSE MAX(0, scu + ?) END
      WHERE id = (SELECT id FROM observation WHERE ts = ? AND terminal_id = ? AND commodity_id = ? AND side = ? AND price = ? ORDER BY id DESC LIMIT 1)`,
    [price, scuDelta, was.ts, was.terminalId, was.commodityId, was.side, was.price],
  );
  log.info('diary', 'observation corrected', { ...was, price, scuDelta, rows: result.rowsAffected });
  return result.rowsAffected;
}

/**
 * One observation per terminal, commodity and side: the one with the greatest `ts`, the greatest `id`
 * when several share it. The correlated subquery is answered by the `observation_lookup` index.
 */
export async function latestObservations(db: Db): Promise<Observation[]> {
  const rows = await db.select<ObservationRow>(
    `SELECT o.id, o.ts, o.terminal_id, o.commodity_id, o.side, o.price, o.scu
     FROM observation o
     WHERE o.id = (
       SELECT i.id FROM observation i
       WHERE i.terminal_id = o.terminal_id AND i.commodity_id = o.commodity_id AND i.side = o.side
       ORDER BY i.ts DESC, i.id DESC LIMIT 1)
     ORDER BY o.terminal_id, o.commodity_id, o.side`,
  );
  return rows.map((r): Observation => ({
    id: Number(r.id),
    ts: Number(r.ts),
    terminalId: Number(r.terminal_id),
    commodityId: Number(r.commodity_id),
    side: r.side,
    price: Number(r.price),
    scu: r.scu === null ? null : Number(r.scu),
  }));
}

/**
 * The latest reading of the quantity per terminal, commodity and side: the observation with the greatest `ts`
 * (the greatest `id` on a tie) among those that carry a quantity (`scu IS NOT NULL`, a known zero included),
 * however many price-only observations came after it (spec 14.6). A stock whose observations all lack a quantity
 * has no reading. The correlated subquery is answered by the `observation_lookup` index.
 */
export async function latestQuantities(db: Db): Promise<QuantityReading[]> {
  const rows = await db.select<{ terminal_id: number; commodity_id: number; side: Side; ts: number; scu: number }>(
    `SELECT o.terminal_id, o.commodity_id, o.side, o.ts, o.scu
     FROM observation o
     WHERE o.id = (
       SELECT i.id FROM observation i
       WHERE i.terminal_id = o.terminal_id AND i.commodity_id = o.commodity_id AND i.side = o.side AND i.scu IS NOT NULL
       ORDER BY i.ts DESC, i.id DESC LIMIT 1)
     ORDER BY o.terminal_id, o.commodity_id, o.side`,
  );
  return rows.map((r): QuantityReading => ({
    terminalId: Number(r.terminal_id),
    commodityId: Number(r.commodity_id),
    side: r.side,
    ts: Number(r.ts),
    scu: Number(r.scu),
  }));
}

/**
 * The previous reading of the price per terminal, commodity and side: the latest observation that is at least
 * `MIN_READING_GAP_SEC` older than the latest one of the stock. A reading made seconds after another is a
 * correction of a typo, not a move of the market, so it is never the previous reading of the one it corrects
 * (and a normal pair followed by a correction is compared as it was before the correction). Whether an
 * observation carries a quantity does not matter. A stock with a single reading, or with all its readings
 * within the gap of its latest, has none.
 *
 * One statement, answered by the `observation_lookup` index alone: the latest `ts` of every stock comes from
 * a grouped scan of the index, and the previous reading of each is one more search of it, as in `latestObservations`.
 */
export async function previousPrices(db: Db): Promise<PriceReading[]> {
  const rows = await db.select<{ terminal_id: number; commodity_id: number; side: Side; ts: number; price: number }>(
    `SELECT p.terminal_id, p.commodity_id, p.side, p.ts, p.price
     FROM (SELECT terminal_id, commodity_id, side, MAX(ts) AS last_ts FROM observation GROUP BY terminal_id, commodity_id, side) s
     JOIN observation p ON p.id = (
       SELECT i.id FROM observation i
       WHERE i.terminal_id = s.terminal_id AND i.commodity_id = s.commodity_id AND i.side = s.side AND i.ts <= s.last_ts - ?
       ORDER BY i.ts DESC, i.id DESC LIMIT 1)
     ORDER BY p.terminal_id, p.commodity_id, p.side`,
    [MIN_READING_GAP_SEC],
  );
  return rows.map((r): PriceReading => ({
    terminalId: Number(r.terminal_id),
    commodityId: Number(r.commodity_id),
    side: r.side,
    ts: Number(r.ts),
    price: Number(r.price),
  }));
}

/**
 * What the whole diary says about each stock: the largest quantity ever seen and the average refill over the stretches where
 * it grew (`learnRatePerMin`), per terminal, commodity and side (`obsKey`). Only readings with a quantity take part, so a
 * key whose readings all lack one is left out. Reads the whole history, oldest reading first.
 */
export async function stockStats(db: Db): Promise<Map<string, StockStats>> {
  const rows = await db.select<{ terminal_id: number; commodity_id: number; side: Side; ts: number; scu: number }>(
    `SELECT terminal_id, commodity_id, side, ts, scu FROM observation
     WHERE scu IS NOT NULL
     ORDER BY terminal_id, commodity_id, side, ts, id`,
  );
  const histories = new Map<string, Array<{ ts: number; scu: number }>>();
  for (const r of rows) {
    const key = obsKey(Number(r.terminal_id), Number(r.commodity_id), r.side);
    const history = histories.get(key);
    const reading = { ts: Number(r.ts), scu: Number(r.scu) };
    if (history) history.push(reading);
    else histories.set(key, [reading]);
  }

  const stats = new Map<string, StockStats>();
  for (const [key, history] of histories) {
    stats.set(key, { maxScu: maxSeenScu(history), ratePerMin: learnRatePerMin(history) });
  }
  return stats;
}
