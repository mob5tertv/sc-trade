import { cargoOf, runTotals } from '../core/run';
import type { Settings } from '../core/settings';
import type { RunEvent, RunWithEvents } from '../core/types';
import type { Db } from './db';
import type { Logger } from './logger';
import { addObservation } from './repo/diary';
import { addRunEvent, closeRun, getActiveRun, getRun, startRun } from './repo/runs';

// The trade service: records a purchase, a sale, a depart or arrive mark or a lost cargo.
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
// Calls on one database run one after another, so two quick presses cannot both pass a check that only
// the first of them should pass.

const LOG = 'run';

export type TradeErrorCode = 'no_active_run' | 'oversell' | 'no_space' | 'bad_input';

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

/** `knownScu` is the stock (when buying) or the demand (when selling) the player saw at the terminal before the trade. */
export interface TradeInput { terminalId: number; commodityId: number; scu: number; price: number; knownScu?: number | null }

const noActiveRun = (): TradeError => new TradeError('no_active_run', 'Нет активного рейса');

// One queue per database: a call starts after the previous one has finished, whether it succeeded or not.
const queues = new WeakMap<Db, Promise<void>>();

function serialized<T>(db: Db, job: () => Promise<T>): Promise<T> {
  const turn = (queues.get(db) ?? Promise.resolve()).then(job);
  queues.set(db, turn.then(() => undefined, () => undefined));
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

/** What the diary stores as the quantity: what is left at the terminal after the trade, `null` when the quantity before it was not seen. */
function leftAfter(t: TradeInput): number | null {
  const known = t.knownScu;
  if (known === undefined || known === null || !Number.isFinite(known)) return null;
  return Math.max(0, known - t.scu);
}

/** The price the player saw is a diary observation on the side of the trade: buying reads the BUY price, selling the SELL price. */
async function writeObservation(d: TradeDeps, side: 'buy' | 'sell', t: TradeInput, ts: number): Promise<void> {
  await addObservation(d.db, d.log, { ts, terminalId: t.terminalId, commodityId: t.commodityId, side, price: t.price, scu: leftAfter(t) });
}

/** Writes a buy or sell event and logs it; returns the event with its new id. */
async function writeTrade(d: TradeDeps, runId: number, type: 'buy' | 'sell', t: TradeInput, ts: number): Promise<RunEvent> {
  const draft: Omit<RunEvent, 'id'> = { runId, ts, type, terminalId: t.terminalId, commodityId: t.commodityId, scu: t.scu, price: t.price };
  const id = await addRunEvent(d.db, draft);
  d.log.info(LOG, type, { runId, eventId: id, ts, terminalId: t.terminalId, commodityId: t.commodityId, scu: t.scu, price: t.price });
  return { id, ...draft };
}

/**
 * Buys into the active run, starting one when there is none (with the ship and capacity from the settings).
 * Rejects the purchase when it does not fit the hold: the free space is checked only when the settings know a capacity.
 */
export function recordBuy(d: TradeDeps, t: TradeInput): Promise<RunWithEvents> {
  return serialized(d.db, async () => {
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
  return serialized(d.db, async () => {
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

/** Marks the take-off or the arrival of the active run. A mark belongs to no terminal and carries no cargo. */
export function recordMark(d: TradeDeps, type: 'depart' | 'arrive'): Promise<void> {
  return serialized(d.db, async () => {
    const active = await requireActiveRun(d.db);
    const runId = active.run.id;
    const ts = d.now();
    const eventId = await addRunEvent(d.db, { runId, ts, type, terminalId: null, commodityId: null, scu: null, price: null });
    d.log.info(LOG, type, { runId, eventId, ts });
  });
}

/** Closes the active run as lost, ending now, whatever is still in the hold; the slot is free for the next run. */
export function loseCargo(d: TradeDeps): Promise<RunWithEvents> {
  return serialized(d.db, async () => {
    const active = await requireActiveRun(d.db);
    const runId = active.run.id;
    const ts = d.now();
    await closeRun(d.db, runId, 'lost', ts);
    d.log.info(LOG, 'lost', { runId, endedAt: ts, cargo: cargoOf(active.events) });
    return reload(d.db, runId);
  });
}
