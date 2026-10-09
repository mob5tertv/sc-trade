import type { Run, RunEvent, RunWithEvents } from '../../core/types';
import type { Db } from '../db';

// Trade runs and their events. A run is the status row, its events are the trades and marks; what is
// in the hold, the money and the phases are all computed from the events (src/core/run.ts), never stored.
// Only one run can be active: the `run_one_active` index of the schema enforces it.
//
// The repository neither validates nor logs: the rules and the log lines belong to the trade service (../trade.ts).

interface RunRow {
  id: number; vehicle_id: number | null; scu_capacity: number; started_at: number; ended_at: number | null; status: Run['status'];
}

interface EventRow {
  id: number; run_id: number; ts: number; type: RunEvent['type'];
  terminal_id: number | null; commodity_id: number | null; scu: number | null; price: number | null;
}

const RUN_COLUMNS = 'id, vehicle_id, scu_capacity, started_at, ended_at, status';
const EVENT_COLUMNS = 'id, run_id, ts, type, terminal_id, commodity_id, scu, price';

const orNull = (v: number | null): number | null => (v === null ? null : Number(v));

function toRun(r: RunRow): Run {
  return {
    id: Number(r.id),
    vehicleId: orNull(r.vehicle_id),
    scuCapacity: Number(r.scu_capacity),
    startedAt: Number(r.started_at),
    endedAt: orNull(r.ended_at),
    status: r.status,
  };
}

function toEvent(r: EventRow): RunEvent {
  return {
    id: Number(r.id),
    runId: Number(r.run_id),
    ts: Number(r.ts),
    type: r.type,
    terminalId: orNull(r.terminal_id),
    commodityId: orNull(r.commodity_id),
    scu: orNull(r.scu),
    price: orNull(r.price),
  };
}

/** Events of one run, in time order; events of the same second keep the order they were written in. */
async function eventsOf(db: Db, runId: number): Promise<RunEvent[]> {
  const rows = await db.select<EventRow>(
    `SELECT ${EVENT_COLUMNS} FROM run_event WHERE run_id = ? ORDER BY ts, id`,
    [runId],
  );
  return rows.map(toEvent);
}

/** The first of the selected runs with its events, or `null` when none was selected. */
async function withEvents(db: Db, rows: RunRow[]): Promise<RunWithEvents | null> {
  if (rows.length === 0) return null;
  return { run: toRun(rows[0]), events: await eventsOf(db, Number(rows[0].id)) };
}

/** The run with the given id and its events, or `null` when there is none. */
export async function getRun(db: Db, id: number): Promise<RunWithEvents | null> {
  return withEvents(db, await db.select<RunRow>(`SELECT ${RUN_COLUMNS} FROM run WHERE id = ?`, [id]));
}

/** The run in progress with its events, or `null` between runs. At most one exists. */
export async function getActiveRun(db: Db): Promise<RunWithEvents | null> {
  return withEvents(db, await db.select<RunRow>(`SELECT ${RUN_COLUMNS} FROM run WHERE status = 'active'`));
}

/** Every run, the newest first (by start, the later id first on a tie), each with its events in time order, then by id. */
export async function listRuns(db: Db): Promise<RunWithEvents[]> {
  const runRows = await db.select<RunRow>(`SELECT ${RUN_COLUMNS} FROM run ORDER BY started_at DESC, id DESC`);
  // One query for all events: the `run_event_run` index (run_id, ts) already delivers them in the order needed.
  const eventRows = await db.select<EventRow>(`SELECT ${EVENT_COLUMNS} FROM run_event ORDER BY run_id, ts, id`);
  const byRun = new Map<number, RunEvent[]>();
  for (const row of eventRows) {
    const event = toEvent(row);
    const list = byRun.get(event.runId);
    if (list) list.push(event); else byRun.set(event.runId, [event]);
  }
  return runRows.map(row => ({ run: toRun(row), events: byRun.get(Number(row.id)) ?? [] }));
}

/** The time of every diary observation and every run event, ascending, duplicates kept: the raw material of sessions. */
export async function allRecordTimestamps(db: Db): Promise<number[]> {
  const rows = await db.select<{ ts: number }>(
    'SELECT ts FROM (SELECT ts FROM observation UNION ALL SELECT ts FROM run_event) ORDER BY ts',
  );
  return rows.map(r => Number(r.ts));
}

/** Starts an active run; returns its id. Fails when another run is already active. */
export async function startRun(db: Db, r: { vehicleId: number | null; scuCapacity: number; startedAt: number }): Promise<number> {
  const result = await db.execute(
    "INSERT INTO run (vehicle_id, scu_capacity, started_at, ended_at, status) VALUES (?, ?, ?, NULL, 'active')",
    [r.vehicleId, r.scuCapacity, r.startedAt],
  );
  return result.lastInsertId;
}

/**
 * Writes a run that is over already, `done`, in one statement; returns its id. It never takes the slot of the active run (the
 * `run_one_active` index only counts `active` rows), so it can be written while a run is going. Used for a sale of goods that
 * were never bought through the application.
 */
export async function addFinishedRun(db: Db, r: { vehicleId: number | null; scuCapacity: number; startedAt: number; endedAt: number }): Promise<number> {
  const result = await db.execute(
    "INSERT INTO run (vehicle_id, scu_capacity, started_at, ended_at, status) VALUES (?, ?, ?, ?, 'done')",
    [r.vehicleId, r.scuCapacity, r.startedAt, r.endedAt],
  );
  return result.lastInsertId;
}

// A run is "finished" when it is over, `done` or `lost`: the player's history. An `active` run is never one.
const FINISHED = "status IN ('done', 'lost')";

// A run without a single event (for the table `run`, whatever statement the clause stands in).
const NO_EVENT = 'NOT EXISTS (SELECT 1 FROM run_event WHERE run_event.run_id = run.id)';

// What `addFinishedRun` can leave behind when its sale is never written: a finished run without a single event. An active run
// without events is another thing (`EMPTY_ACTIVE_RUN` below), and a run with events is a record: neither is ever matched. A lost
// run is not matched by this either: the rollback of one income asks for the run it has just written, which is `done`.
const EMPTY_FINISHED_RUN = `status = 'done' AND ${NO_EVENT}`;

// What a clearing of the history (`removeFinishedRunEvents`, then `removeFinishedRuns`) leaves behind when its second statement
// fails: finished runs, done or lost, whose events are already gone. Nothing else makes a lost run without events (a run is lost
// by closing an active one, and an active run without events is removed before any lost cargo is written), so the sweep of the
// leftovers takes both.
const EMPTY_LEFTOVER_RUN = `${FINISHED} AND ${NO_EVENT}`;

// What `startRun` can leave behind when the first purchase is cut off before its event is written: an active run without a
// single event. It has no cargo and no trade, but it has a start time, which would be wrong for the next purchase.
const EMPTY_ACTIVE_RUN = "status = 'active' AND NOT EXISTS (SELECT 1 FROM run_event WHERE run_event.run_id = run.id)";

/** The active runs that have no event at all (there is at most one active run). */
export async function emptyActiveRuns(db: Db): Promise<Array<{ id: number; startedAt: number }>> {
  const rows = await db.select<{ id: number; started_at: number }>(`SELECT id, started_at FROM run WHERE ${EMPTY_ACTIVE_RUN}`);
  return rows.map(r => ({ id: Number(r.id), startedAt: Number(r.started_at) }));
}

/** Removes the run `id` when it is an active run without events. Any other run stays. */
export async function removeEmptyActiveRun(db: Db, id: number): Promise<void> {
  await db.execute(`DELETE FROM run WHERE id = ? AND ${EMPTY_ACTIVE_RUN}`, [id]);
}

/** Removes the run `id` when it is a finished run without events (what a write that failed half-way leaves). Any other run stays. */
export async function removeEmptyRun(db: Db, id: number): Promise<void> {
  await db.execute(`DELETE FROM run WHERE id = ? AND ${EMPTY_FINISHED_RUN}`, [id]);
}

/**
 * Removes every finished run, done or lost, that has no event (the leftovers of an income or of a clearing that was cut off);
 * returns how many there were.
 */
export async function removeEmptyFinishedRuns(db: Db): Promise<number> {
  return (await db.execute(`DELETE FROM run WHERE ${EMPTY_LEFTOVER_RUN}`)).rowsAffected;
}

// The clearing of the history (spec 14.14) is two statements, because the plugin has no transactions and `run_event.run_id`
// references `run(id)` without a cascade (the foreign keys are on): the events of the runs go first, the runs after them. Each of
// the two repeats in its own SQL what may be deleted (a run that is over and, when `endedBefore` is given, one that ended before
// that moment); neither takes a list of ids that was read earlier. The run that is going and the diary of prices are never matched.
function finishedBefore(endedBefore: number | null): { where: string; params: number[] } {
  return endedBefore === null ? { where: FINISHED, params: [] } : { where: `${FINISHED} AND ended_at < ?`, params: [endedBefore] };
}

/**
 * Deletes the events of the finished runs (all of them, or those that ended before `endedBefore`, unix seconds); returns how many.
 * The first half of a clearing: the runs themselves stay, empty, until `removeFinishedRuns`.
 */
export async function removeFinishedRunEvents(db: Db, endedBefore: number | null): Promise<number> {
  const { where, params } = finishedBefore(endedBefore);
  return (await db.execute(`DELETE FROM run_event WHERE run_id IN (SELECT id FROM run WHERE ${where})`, params)).rowsAffected;
}

/**
 * Deletes the finished runs (all of them, or those that ended before `endedBefore`) that have no event any more; returns how many.
 * The second half of a clearing. A run that still has an event is left, which is also what the foreign key would insist on.
 */
export async function removeFinishedRuns(db: Db, endedBefore: number | null): Promise<number> {
  const { where, params } = finishedBefore(endedBefore);
  return (await db.execute(`DELETE FROM run WHERE ${where} AND ${NO_EVENT}`, params)).rowsAffected;
}

/** Appends an event to a run; returns its id. */
export async function addRunEvent(db: Db, e: Omit<RunEvent, 'id'>): Promise<number> {
  const result = await db.execute(
    'INSERT INTO run_event (run_id, ts, type, terminal_id, commodity_id, scu, price) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [e.runId, e.ts, e.type, e.terminalId, e.commodityId, e.scu, e.price],
  );
  return result.lastInsertId;
}

/** Ends the active run `id` as done or lost. Only an active run can be closed; closing any other one changes nothing. */
export async function closeRun(db: Db, id: number, status: 'done' | 'lost', endedAt: number): Promise<void> {
  await db.execute("UPDATE run SET status = ?, ended_at = ? WHERE id = ? AND status = 'active'", [status, endedAt, id]);
}
