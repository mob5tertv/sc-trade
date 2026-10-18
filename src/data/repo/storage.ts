import type { StorageEntry, StorageKind } from '../../core/storage';
import type { Db } from '../db';

// The ledger of the storage (version 1.4, `core/storage.ts`). The repository neither validates nor logs: the rules and the log lines
// belong to the trade service (../trade.ts).

interface EntryRow {
  id: number; ts: number; terminal_id: number; commodity_id: number; scu: number; cost: number; kind: StorageKind;
  run_id: number | null; event_id: number | null;
}

const orNull = (v: number | null): number | null => (v === null ? null : Number(v));

function toEntry(r: EntryRow): StorageEntry {
  return {
    id: Number(r.id), ts: Number(r.ts), terminalId: Number(r.terminal_id), commodityId: Number(r.commodity_id),
    scu: Number(r.scu), cost: Number(r.cost), kind: r.kind, runId: orNull(r.run_id), eventId: orNull(r.event_id),
  };
}

/** Every entry, in the order they were written. */
export async function listStorageEntries(db: Db): Promise<StorageEntry[]> {
  const rows = await db.select<EntryRow>(
    'SELECT id, ts, terminal_id, commodity_id, scu, cost, kind, run_id, event_id FROM storage_entry ORDER BY ts, id',
  );
  return rows.map(toEntry);
}

/** Appends an entry; returns its id. */
export async function addStorageEntry(db: Db, e: Omit<StorageEntry, 'id'>): Promise<number> {
  const result = await db.execute(
    'INSERT INTO storage_entry (ts, terminal_id, commodity_id, scu, cost, kind, run_id, event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [e.ts, e.terminalId, e.commodityId, e.scu, e.cost, e.kind, e.runId, e.eventId],
  );
  return result.lastInsertId;
}

/** The entry that the event of a run is (a load, a putting back), or `null` when the event is a trade at the market. */
export async function entryOfEvent(db: Db, eventId: number): Promise<StorageEntry | null> {
  const rows = await db.select<EntryRow>(
    'SELECT id, ts, terminal_id, commodity_id, scu, cost, kind, run_id, event_id FROM storage_entry WHERE event_id = ? ORDER BY id LIMIT 1',
    [eventId],
  );
  return rows.length === 0 ? null : toEntry(rows[0]);
}

/** Changes the quantity and the money of an entry. */
export async function updateStorageEntry(db: Db, id: number, scu: number, cost: number): Promise<void> {
  await db.execute('UPDATE storage_entry SET scu = ?, cost = ? WHERE id = ?', [scu, cost, id]);
}
