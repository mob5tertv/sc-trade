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
 * What the whole diary says about each stock: the largest quantity ever seen and the fastest refill between
 * two readings, per terminal, commodity and side (`obsKey`). Only readings with a quantity take part, so a
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
