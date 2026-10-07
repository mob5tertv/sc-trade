import { cargoOf, runTotals } from '../core/run';
import type { Settings } from '../core/settings';
import type { RunEvent, RunWithEvents } from '../core/types';
import type { Db } from './db';
import type { Logger } from './logger';
import { addObservation } from './repo/diary';
import { addFinishedRun, addRunEvent, closeRun, getActiveRun, getRun, removeEmptyFinishedRuns, removeEmptyRun, startRun } from './repo/runs';

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
//    computed from. A failure at the event leaves an empty active run: the next purchase joins it;
//  - the run is closed last, once its final sale is recorded. A failure there leaves the sale recorded
//    and the run active with an empty hold: nothing is lost, but the run has to be closed by hand ("cargo lost").
//  - an income sale (spec 14.10) is a run of its own, written already finished (so it never takes the slot of the run that is
//    going, and the schema needs nothing new), with one sale event. A failure at that event removes the empty run again; a
//    crash between the two inserts leaves it, and the first call of the service in the next session removes it (`sweepLeftovers`).
// Calls on one database run one after another, so two quick presses cannot both pass a check that only
// the first of them should pass.

const LOG = 'run';

export type TradeErrorCode = 'no_active_run' | 'oversell' | 'no_space' | 'bad_input' | 'on_board';

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

/** `knownScu` is the quantity the player saw at the terminal before the trade: the stock to buy from (when buying) or what the buyer already holds (when selling). */
export interface TradeInput { terminalId: number; commodityId: number; scu: number; price: number; knownScu?: number | null }

const noActiveRun = (): TradeError => new TradeError('no_active_run', 'Нет активного рейса');

// One queue per database: a call starts after the previous one has finished, whether it succeeded or not.
const queues = new WeakMap<Db, Promise<void>>();

// The databases the leftovers of an income that was cut off have been looked for in: once per session of the application, the
// session being the life of the `Db` object, at the first call of the service whatever that call is.
const swept = new WeakSet<Db>();

/**
 * A crash between the insert of an income's run and the insert of its sale leaves a finished run without events, which would
 * show as a row of nothing in the history for ever. The first call of the service on a database takes them away. Runs inside the
 * queue, so it never meets an income that is being written; a failure is logged and never stops the call.
 */
async function sweepLeftovers(d: TradeDeps): Promise<void> {
  if (swept.has(d.db)) return;
  swept.add(d.db);
  try {
    const count = await removeEmptyFinishedRuns(d.db);
    if (count > 0) d.log.info(LOG, 'removed the empty runs of an income that was cut off', { count });
  } catch (err) {
    d.log.warn(LOG, 'cannot remove the empty runs of an income that was cut off', { err });
  }
}

function serialized<T>(d: TradeDeps, job: () => Promise<T>): Promise<T> {
  const turn = (queues.get(d.db) ?? Promise.resolve()).then(async () => {
    await sweepLeftovers(d);
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

/** Closes the active run as lost, ending now, whatever is still in the hold; the slot is free for the next run. */
export function loseCargo(d: TradeDeps): Promise<RunWithEvents> {
  return serialized(d, async () => {
    const active = await requireActiveRun(d.db);
    const runId = active.run.id;
    const ts = d.now();
    await closeRun(d.db, runId, 'lost', ts);
    d.log.info(LOG, 'lost', { runId, endedAt: ts, cargo: cargoOf(active.events) });
    return reload(d.db, runId);
  });
}
