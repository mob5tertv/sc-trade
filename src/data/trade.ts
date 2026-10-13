import { cargoOf, runTotals } from '../core/run';
import type { Settings } from '../core/settings';
import type { RunEvent, RunWithEvents } from '../core/types';
import type { Db } from './db';
import type { Logger } from './logger';
import { addObservation, amendTradeObservation } from './repo/diary';
import {
  addFinishedRun, addRunEvent, closeRun, emptyActiveRuns, getActiveRun, getRun, removeEmptyActiveRun, removeEmptyFinishedRuns, removeEmptyRun,
  removeFinishedRun, removeFinishedRunEvents, removeFinishedRuns, removeOrphanRunTargets, removeRunEventsOf, runOfEvent, setRunTarget, startRun,
  updateTradeEvent,
} from './repo/runs';

// The trade service: records a purchase, a sale, a sale of goods that were never bought here (income), a depart or arrive
// mark or a lost cargo.
// The first purchase starts the run, the sale that empties the hold finishes it, and trades that cannot
// happen (selling what is not on board, buying more than fits, no run, bad numbers) are rejected with a
// `TradeError` whose message is shown to the player. A rejected call writes nothing.
//
// Every write is a separate statement (no transactions), so each operation writes in an order that
// keeps the data usable if a later write fails:
//  - the diary observation goes first: it is true whether or not the trade gets recorded, so a failure
//    right after it leaves only a harmless extra observation, and a failure of the observation itself
//    leaves nothing at all;
//  - then the run (first purchase only), then the event, which is the record the money and the hold are
//    computed from. A failure at the event leaves an empty active run: the next call of the service removes it, so the next
//    purchase starts its own run (with its own start time);
//  - the run is closed last, once its final sale is recorded. A failure there leaves the sale recorded
//    and the run active with an empty hold: nothing is lost, and the next call of the service closes the run at the time of
//    that sale, before it looks at the run (`repairHalfWrittenRuns`, also called at the start: `repairRuns`).
//  - an income sale (spec 14.10) is a run of its own, written already finished (so it never takes the slot of the run that is
//    going, and the schema needs nothing new), with one sale event. A failure at that event removes the empty run again; a
//    crash between the two inserts leaves it, and the first call of the service in the next session removes it (`sweepLeftovers`).
//  - the clearing of the history (spec 14.14, `clearHistory`) deletes the events of the finished runs first and the runs after
//    them (the events reference their run without a cascade). A failure of the second statement leaves finished runs without
//    events: it is tried once more at once, and what still remains is removed by the next clearing or by `sweepLeftovers`.
// Calls on one database run one after another, so two quick presses cannot both pass a check that only
// the first of them should pass.

const LOG = 'run';

export type TradeErrorCode = 'no_active_run' | 'oversell' | 'no_space' | 'bad_input' | 'on_board' | 'no_trade' | 'run_active';

/** A trade that cannot happen. `message` is meant for the player; `code` is for the caller's logic. */
export class TradeError extends Error {
  readonly code: TradeErrorCode;

  constructor(code: TradeErrorCode, message: string) {
    super(message);
    this.name = 'TradeError';
    this.code = code;
  }
}

export interface TradeDeps { db: Db; log: Logger; now: () => number; settings: Settings }

/** What the repair of the runs needs: no clock (a run is closed at the time of its own last sale) and no settings. */
export type RepairDeps = Pick<TradeDeps, 'db' | 'log'>;

/** `knownScu` is the quantity the player saw at the terminal before the trade: the stock to buy from (when buying) or what the buyer already holds (when selling). */
export interface TradeInput { terminalId: number; commodityId: number; scu: number; price: number; knownScu?: number | null }

const noActiveRun = (): TradeError => new TradeError('no_active_run', 'Нет активного рейса');

// One queue per database: a call starts after the previous one has finished, whether it succeeded or not.
const queues = new WeakMap<Db, Promise<void>>();

// The databases the leftovers of an income that was cut off have been looked for in: once per session of the application, the
// session being the life of the `Db` object, at the first call of the service whatever that call is.
const swept = new WeakSet<Db>();

/** The time of the last sale in `events`, or `null` when there is none. */
const lastSaleAt = (events: RunEvent[]): number | null => events.reduce<number | null>(
  (last, e) => (e.type === 'sell' && (last === null || e.ts > last) ? e.ts : last), null,
);

/**
 * Repairs the two states of a run that a write cut off between two statements leaves (there are no transactions), each
 * with a warning that names the run:
 *  - an active run without a single event (the run was started, the first purchase was never written): it is removed, or the
 *    player would see a loading run with an empty hold, and the next purchase would join it with the old start time;
 *  - an active run that has a sale and an empty hold (the last sale was written, the run was never closed): it is closed as
 *    done at the time of its last sale, as `recordSell` would have closed it.
 * Everything else is left as it is. Not queued: it is for the places that already hold a turn (`serialized` repairs before
 * EVERY job, so a write that is cut off in the middle of a session is repaired by the next call, not at the next start).
 * It reads twice and writes only when something is broken. A failure is logged only.
 */
async function repairHalfWrittenRuns(d: RepairDeps): Promise<void> {
  try {
    for (const { id, startedAt } of await emptyActiveRuns(d.db)) {
      await removeEmptyActiveRun(d.db, id);
      d.log.warn(LOG, 'repaired a run without events: removed it', { runId: id, startedAt });
    }
    const active = await getActiveRun(d.db);
    if (active === null || cargoOf(active.events).length > 0) return;
    const endedAt = lastSaleAt(active.events);
    if (endedAt === null) return;
    await closeRun(d.db, active.run.id, 'done', endedAt);
    d.log.warn(LOG, 'repaired a run that was sold out: closed it as done', { runId: active.run.id, endedAt });
  } catch (err) {
    d.log.warn(LOG, 'cannot repair the runs that a trade cut off', { err });
  }
}

/**
 * The first call of the service on a database clears away what a write that was cut off left behind: a finished run, done or
 * lost, without a single event. An income that was cut off (a crash between the insert of the run and the insert of its sale)
 * and a clearing of the history whose second statement failed (the events are gone, the runs are not) both leave such runs, and
 * each would show as a row of nothing in the history for ever. Once per session, not at every call: `recordIncome` takes its
 * run back itself when its sale fails, and `clearHistory` repeats its second statement, so only a crash (a new session) or a
 * removal that failed twice leaves one, and it touches no trade. Runs inside the queue, so it never meets an income that is being
 * written nor a clearing; a failure is logged and never stops the call.
 */
async function sweepLeftovers(d: RepairDeps): Promise<void> {
  if (swept.has(d.db)) return;
  swept.add(d.db);
  try {
    const count = await removeEmptyFinishedRuns(d.db);
    if (count > 0) d.log.info(LOG, 'removed the finished runs without events (an income or a clearing that was cut off)', { count });
  } catch (err) {
    d.log.warn(LOG, 'cannot remove the finished runs without events (an income or a clearing that was cut off)', { err });
  }
}

/**
 * Repairs the runs that a write cut off half-way (see `repairHalfWrittenRuns`) now, inside the queue of the trade service. The
 * application calls it at the start, BEFORE it reads the active run, so the player is never shown a half-written run. Every
 * other call of the service does the same before its own work, so this is the same as a call that does nothing. Never rejects:
 * a start must not fail because of it.
 */
export function repairRuns(d: RepairDeps): Promise<void> {
  return serialized(d, async () => undefined);
}

/**
 * Runs `job` in the queue of its database, after the previous job has ended whether it succeeded or not. Before the job: the
 * leftovers of an income once per session, and the repair of the half-written runs EVERY time. A write that is cut off in the
 * middle of a session (a failed event after the run was started, a failed close after the last sale) leaves a state that the
 * next purchase would join, and that a sale would call an oversell; it is repaired here, before any call sees it.
 */
function serialized<T>(d: RepairDeps, job: () => Promise<T>): Promise<T> {
  const turn = (queues.get(d.db) ?? Promise.resolve()).then(async () => {
    await sweepLeftovers(d);
    await repairHalfWrittenRuns(d);
    return job();
  });
  queues.set(d.db, turn.then(() => undefined, () => undefined));
  return turn;
}

function checkInput(t: TradeInput): void {
  if (!(Number.isFinite(t.scu) && t.scu > 0 && Number.isFinite(t.price) && t.price > 0)) {
    throw new TradeError('bad_input', 'Количество и цена должны быть больше нуля');
  }
}

async function requireActiveRun(db: Db): Promise<RunWithEvents> {
  const active = await getActiveRun(db);
  if (active === null) throw noActiveRun();
  return active;
}

async function reload(db: Db, runId: number): Promise<RunWithEvents> {
  const run = await getRun(db, runId);
  if (run === null) throw new Error(`run ${runId} is missing right after it was written`);
  return run;
}

/** SCU in the hold, all commodities together. */
const holdScu = (events: RunEvent[]): number => cargoOf(events).reduce((sum, line) => sum + line.scu, 0);

/**
 * What the diary stores as the quantity once the trade is done, `null` when the quantity before it was not seen
 * (spec 14.5). After a purchase it is the stock left at the seller: what was known less what was bought, never
 * below zero. After a sale it is what the buyer now holds: what was known plus what was sold, since the buyer
 * took the cargo into its inventory.
 */
function scuAfter(side: 'buy' | 'sell', t: TradeInput): number | null {
  const known = t.knownScu;
  if (known === undefined || known === null || !Number.isFinite(known)) return null;
  return side === 'buy' ? Math.max(0, known - t.scu) : known + t.scu;
}

/** The price the player saw is a diary observation on the side of the trade: buying reads the BUY price, selling the SELL price. */
async function writeObservation(d: TradeDeps, side: 'buy' | 'sell', t: TradeInput, ts: number): Promise<void> {
  await addObservation(d.db, d.log, { ts, terminalId: t.terminalId, commodityId: t.commodityId, side, price: t.price, scu: scuAfter(side, t) });
}

/** Writes a buy or sell event and logs it (`logAs` names the line, the type of the event by default); returns the event with its new id. */
async function writeTrade(d: TradeDeps, runId: number, type: 'buy' | 'sell', t: TradeInput, ts: number, logAs: string = type): Promise<RunEvent> {
  const draft: Omit<RunEvent, 'id'> = { runId, ts, type, terminalId: t.terminalId, commodityId: t.commodityId, scu: t.scu, price: t.price };
  const id = await addRunEvent(d.db, draft);
  d.log.info(LOG, logAs, { runId, eventId: id, ts, terminalId: t.terminalId, commodityId: t.commodityId, scu: t.scu, price: t.price });
  return { id, ...draft };
}

/**
 * Buys into the active run, starting one when there is none (with the ship and capacity from the settings).
 * Rejects the purchase when it does not fit the hold: the free space is checked only when the settings know a capacity.
 */
export function recordBuy(d: TradeDeps, t: TradeInput): Promise<RunWithEvents> {
  return serialized(d, async () => {
    checkInput(t);
    const active = await getActiveRun(d.db);
    if (d.settings.scuCapacity > 0) {
      const free = d.settings.scuCapacity - holdScu(active?.events ?? []);
      if (t.scu > free) throw new TradeError('no_space', `Свободно только ${Math.max(0, free)} SCU`);
    }

    const ts = d.now();
    await writeObservation(d, 'buy', t, ts);
    let runId: number;
    if (active === null) {
      const { vehicleId, scuCapacity } = d.settings;
      runId = await startRun(d.db, { vehicleId, scuCapacity, startedAt: ts });
      d.log.info(LOG, 'started', { runId, vehicleId, scuCapacity, startedAt: ts });
    } else {
      runId = active.run.id;
    }
    await writeTrade(d, runId, 'buy', t, ts);
    return reload(d.db, runId);
  });
}

/**
 * Sells from the hold of the active run, at one terminal and in any part. The sale that leaves the hold
 * empty finishes the run (`done`, ending at the time of that sale). `finished` tells whether it did.
 */
export function recordSell(d: TradeDeps, t: TradeInput): Promise<{ run: RunWithEvents; finished: boolean }> {
  return serialized(d, async () => {
    checkInput(t);
    const active = await requireActiveRun(d.db);
    const onBoard = cargoOf(active.events).find(line => line.commodityId === t.commodityId)?.scu ?? 0;
    if (t.scu > onBoard) throw new TradeError('oversell', `В трюме только ${onBoard} SCU`);

    const runId = active.run.id;
    const ts = d.now();
    await writeObservation(d, 'sell', t, ts);
    const sale = await writeTrade(d, runId, 'sell', t, ts);

    const finished = cargoOf([...active.events, sale]).length === 0;
    if (finished) await closeRun(d.db, runId, 'done', ts);
    const run = await reload(d.db, runId);
    if (finished) {
      const { invested, revenue, profit, durationSec } = runTotals(run.run, run.events, ts);
      d.log.info(LOG, 'finished', { runId, endedAt: ts, invested, revenue, profit, durationSec });
    }
    return { run, finished };
  });
}

/**
 * Records a sale of goods that were never bought through the application (bought before it ran, mined, assembled): an
 * income. It is a run of its own, finished at the moment of the sale, with that one sale: nothing invested, the profit is the
 * revenue. The run that is going (if any) is not touched. Rejected for goods that are in the hold of the run that is going:
 * those are sold from the run, or the cargo would be counted twice. The quantity is not checked against any hold.
 * The buyer's inventory goes to the diary by the rule of a sale (`knownScu` plus what was sold).
 */
export function recordIncome(d: TradeDeps, t: TradeInput): Promise<RunWithEvents> {
  return serialized(d, async () => {
    checkInput(t);
    const active = await getActiveRun(d.db);
    if (cargoOf(active?.events ?? []).some(line => line.commodityId === t.commodityId)) {
      throw new TradeError('on_board', 'Этот товар числится в трюме: продай его из рейса');
    }

    const ts = d.now();
    await writeObservation(d, 'sell', t, ts);
    const { vehicleId, scuCapacity } = d.settings;
    const runId = await addFinishedRun(d.db, { vehicleId, scuCapacity, startedAt: ts, endedAt: ts });
    try {
      await writeTrade(d, runId, 'sell', t, ts, 'income');
    } catch (err) {
      // an empty finished run would be a row of nothing in the history: take it back (the failure of that is only logged)
      await removeEmptyRun(d.db, runId).catch((removeErr: unknown) => d.log.warn(LOG, 'cannot remove the empty run', { runId, err: removeErr }));
      throw err;
    }
    return reload(d.db, runId);
  });
}

/** Marks the take-off or the arrival of the active run. A mark belongs to no terminal and carries no cargo. */
export function recordMark(d: TradeDeps, type: 'depart' | 'arrive'): Promise<void> {
  return serialized(d, async () => {
    const active = await requireActiveRun(d.db);
    const runId = active.run.id;
    const ts = d.now();
    const eventId = await addRunEvent(d.db, { runId, ts, type, terminalId: null, commodityId: null, scu: null, price: null });
    d.log.info(LOG, type, { runId, eventId, ts });
  });
}

/**
 * Closes the active run as lost, ending now, whatever is still in the hold; the slot is free for the next run. The target the
 * player had is recorded with the run first (spec 14.19): it says which route the lost run was an attempt at. A target that
 * cannot be written is only logged: the cargo is lost all the same, and the run then belongs to no route.
 */
export function loseCargo(d: TradeDeps): Promise<RunWithEvents> {
  return serialized(d, async () => {
    const active = await requireActiveRun(d.db);
    const runId = active.run.id;
    const ts = d.now();
    const targetId = d.settings.targetTerminalId;
    if (targetId !== null) {
      await setRunTarget(d.db, runId, targetId).catch((err: unknown) => d.log.warn(LOG, 'cannot record the target of the lost run', { runId, targetId, err }));
    }
    await closeRun(d.db, runId, 'lost', ts);
    d.log.info(LOG, 'lost', { runId, endedAt: ts, targetId, cargo: cargoOf(active.events) });
    return reload(d.db, runId);
  });
}

/** A correction of one trade: the event, and the quantity and the price it should have had. */
export interface TradeEdit { eventId: number; scu: number; price: number }

/**
 * Corrects a purchase or a sale that was typed in wrong (spec 14.19, item 5), in the run that is going or in a finished one. The
 * hold, the money of the run, the routes and the sessions are all counted from the events, so they follow by themselves; the
 * observation the trade wrote into the diary is corrected with it (the price, and the quantity left after the trade by as much as
 * the traded quantity changed). What is refused, and nothing is written then:
 *  - a quantity or a price that is not above zero, an event that is no trade;
 *  - a correction after which more of the commodity would be sold than was bought in that run;
 *  - in the run that is going, a purchase that no longer fits the hold (when the settings know a capacity).
 * A run that is going and whose hold the correction empties is closed as done at the time of its last sale, as a sale would
 * close it. The observation is corrected after the event: a failure there is logged, and the trade stays corrected.
 */
export function editTrade(d: TradeDeps, edit: TradeEdit): Promise<RunWithEvents> {
  return serialized(d, async () => {
    if (!(Number.isFinite(edit.scu) && edit.scu > 0 && Number.isFinite(edit.price) && edit.price > 0)) {
      throw new TradeError('bad_input', 'Количество и цена должны быть больше нуля');
    }
    const runId = await runOfEvent(d.db, edit.eventId);
    const before = runId === null ? null : await getRun(d.db, runId);
    const event = before?.events.find(e => e.id === edit.eventId);
    if (before === null || event === undefined || (event.type !== 'buy' && event.type !== 'sell') || event.commodityId === null || event.scu === null || event.price === null) {
      throw new TradeError('no_trade', 'Такой сделки нет: она уже удалена или изменена');
    }

    const after = before.events.map(e => (e.id === edit.eventId ? { ...e, scu: edit.scu, price: edit.price } : e));
    const traded = (type: 'buy' | 'sell'): number => after
      .filter(e => e.type === type && e.commodityId === event.commodityId)
      .reduce((sum, e) => sum + (e.scu ?? 0), 0);
    if (traded('sell') > traded('buy')) {
      throw new TradeError('oversell', `Так выйдет, что продано ${traded('sell')} SCU, а куплено только ${traded('buy')}`);
    }
    if (before.run.status === 'active' && d.settings.scuCapacity > 0 && holdScu(after) > d.settings.scuCapacity) {
      throw new TradeError('no_space', `В трюм не поместится: вместимость ${d.settings.scuCapacity} SCU`);
    }

    await updateTradeEvent(d.db, edit.eventId, edit.scu, edit.price);
    d.log.info(LOG, 'edited', {
      runId: before.run.id, eventId: edit.eventId, type: event.type, terminalId: event.terminalId, commodityId: event.commodityId,
      was: { scu: event.scu, price: event.price }, now: { scu: edit.scu, price: edit.price },
    });
    if (event.terminalId !== null) {
      // after a purchase the diary holds the stock that was left, after a sale what the buyer then held
      const scuDelta = event.type === 'buy' ? event.scu - edit.scu : edit.scu - event.scu;
      const was = { ts: event.ts, terminalId: event.terminalId, commodityId: event.commodityId, side: event.type, price: event.price };
      await amendTradeObservation(d.db, d.log, was, edit.price, scuDelta)
        .catch((err: unknown) => d.log.warn(LOG, 'cannot correct the observation of the edited trade', { eventId: edit.eventId, err }));
    }
    if (before.run.status === 'active' && cargoOf(after).length === 0) {
      const endedAt = lastSaleAt(after);
      if (endedAt !== null) {
        await closeRun(d.db, before.run.id, 'done', endedAt);
        d.log.info(LOG, 'finished', { runId: before.run.id, endedAt, by: 'edit' });
      }
    }
    return reload(d.db, before.run.id);
  });
}

/**
 * Removes ONE finished run from the history (spec 14.19, item 5): its events, then the run. The run that is going is refused: it
 * is ended first (sold, or written off). The diary of prices is not touched: what was seen at a terminal was seen. A failure of
 * the second statement leaves a finished run without events, which the sweep of the next call removes.
 */
export function removeRunRecord(d: RepairDeps, runId: number): Promise<{ events: number }> {
  return serialized(d, async () => {
    const run = await getRun(d.db, runId);
    if (run === null) throw new TradeError('no_trade', 'Такого рейса в истории нет');
    if (run.run.status === 'active') throw new TradeError('run_active', 'Идущий рейс удалить нельзя: сначала продай груз или отметь «Груз потерян»');
    const events = await removeRunEventsOf(d.db, runId);
    await removeFinishedRun(d.db, runId);
    await removeOrphanRunTargets(d.db).catch((err: unknown) => d.log.warn(LOG, 'cannot sweep the target of the removed run', { runId, err }));
    d.log.info(LOG, 'run removed from the history', { runId, status: run.run.status, events });
    return { events };
  });
}

/** What a clearing of the history deleted: the runs, and the events of those runs. */
export interface ClearedHistory { runs: number; events: number }

/**
 * A clearing of the history that did not work to the end. `message` is meant for the player. `partial` tells whether the events
 * of the runs were deleted already (the runs stay in the history, empty, until the next clearing or the next start of the
 * application) or nothing was deleted at all; `events` is how many events were deleted.
 */
export class ClearHistoryError extends Error {
  readonly partial: boolean;
  readonly events: number;

  constructor(partial: boolean, events: number) {
    super(partial
      ? 'История очищена не до конца: в списке остались пустые рейсы. Нажми кнопку ещё раз. Подробности в логе.'
      : 'Не удалось очистить историю: ничего не удалено. Подробности в логе.');
    this.name = 'ClearHistoryError';
    this.partial = partial;
    this.events = events;
  }
}

/**
 * Clears the history of the player's runs (spec 14.14): every finished run, done or lost (a sale without a purchase is a done run),
 * or, with `endedBefore` (unix seconds), those that ENDED before that moment. The run that is going and the diary of prices are
 * never touched: both statements repeat the condition in their own SQL. In the queue of the service, so it never meets a trade
 * that is being written nor the repair of a half-written run (that repair runs first, as before every job).
 *
 * Two statements, the events of the runs first, the runs after them (see `removeFinishedRunEvents`). A failure of the first
 * deletes nothing. A failure of the second is tried once more at once; when that fails too, the runs stay as finished runs
 * without events, and the error says so (`partial`): a second press of the button, or the sweep of the next start, finishes it.
 */
export function clearHistory(d: RepairDeps, endedBefore: number | null): Promise<ClearedHistory> {
  return serialized(d, async () => {
    let events: number;
    try {
      events = await removeFinishedRunEvents(d.db, endedBefore);
    } catch (err) {
      d.log.error(LOG, 'cannot delete the events of the cleared runs: nothing was deleted', { endedBefore, err });
      throw new ClearHistoryError(false, 0);
    }
    let runs: number;
    try {
      runs = await removeFinishedRuns(d.db, endedBefore);
    } catch (first) {
      d.log.warn(LOG, 'cannot delete the cleared runs, trying once more', { endedBefore, events, err: first });
      try {
        runs = await removeFinishedRuns(d.db, endedBefore);
      } catch (second) {
        d.log.error(LOG, 'cannot delete the cleared runs: their events are gone, the runs stay empty', { endedBefore, events, err: second });
        throw new ClearHistoryError(true, events);
      }
    }
    // the targets recorded for the runs that are gone mean nothing now; a failure leaves rows nobody reads, for the next clearing
    await removeOrphanRunTargets(d.db).catch((err: unknown) => d.log.warn(LOG, 'cannot sweep the targets of the cleared runs', { err }));
    d.log.info(LOG, 'history cleared', { endedBefore, runs, events });
    return { runs, events };
  });
}
