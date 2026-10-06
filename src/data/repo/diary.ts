import type { Observation, Side } from '../../core/types';
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
