import type { CargoLine, Run, RunEvent } from './types';

const SEC_PER_HOUR = 3600;

/** A buy or a sell that names a commodity, a positive quantity and a price. */
interface Trade { ts: number; type: 'buy' | 'sell'; terminalId: number | null; commodityId: number; scu: number; price: number }

/** The usable trades of a run, in the given order. Marks and half-filled rows carry no money or cargo and are skipped. */
function tradesOf(events: RunEvent[]): Trade[] {
  const trades: Trade[] = [];
  for (const e of events) {
    if ((e.type !== 'buy' && e.type !== 'sell') || e.commodityId === null || e.scu === null || e.scu <= 0 || e.price === null) continue;
    trades.push({ ts: e.ts, type: e.type, terminalId: e.terminalId, commodityId: e.commodityId, scu: e.scu, price: e.price });
  }
  return trades;
}

/**
 * What is in the hold: per commodity the SCU bought minus the SCU sold, for the lines that still
 * have some. The price is the weighted average over all purchases of the commodity, whatever was
 * sold since. Selling more than was bought never makes a negative line.
 */
export function cargoOf(events: RunEvent[]): CargoLine[] {
  const perCommodity = new Map<number, { bought: number; sold: number; cost: number }>();
  for (const t of tradesOf(events)) {
    let sums = perCommodity.get(t.commodityId);
    if (!sums) perCommodity.set(t.commodityId, (sums = { bought: 0, sold: 0, cost: 0 }));
    if (t.type === 'buy') { sums.bought += t.scu; sums.cost += t.scu * t.price; } else sums.sold += t.scu;
  }
  const lines: CargoLine[] = [];
  for (const [commodityId, { bought, sold, cost }] of perCommodity) {
    if (bought > sold) lines.push({ commodityId, scu: bought - sold, avgBuyPrice: cost / bought });
  }
  return lines;
}

export interface RunTotals {
  invested: number; revenue: number; profit: number;
  /** `null` when nothing was invested. */
  roi: number | null;
  durationSec: number;
  /** `null` when the run took no time. */
  uecPerHour: number | null;
}

/**
 * Money and time of a run: invested is everything bought, revenue everything sold, profit their
 * difference (negative while cargo is still in the hold or after it was lost). The run lasts from its
 * start to its end, or to `now` while it has none; a run that ends before it starts lasts zero.
 */
export function runTotals(run: Run, events: RunEvent[], now: number): RunTotals {
  let invested = 0;
  let revenue = 0;
  for (const t of tradesOf(events)) {
    if (t.type === 'buy') invested += t.scu * t.price; else revenue += t.scu * t.price;
  }
  const profit = revenue - invested;
  const durationSec = Math.max(0, (run.endedAt ?? now) - run.startedAt);
  return {
    invested, revenue, profit,
    roi: invested > 0 ? profit / invested : null,
    durationSec,
    uecPerHour: durationSec > 0 ? (profit * SEC_PER_HOUR) / durationSec : null,
  };
}

/**
 * The route of a simple run: one commodity bought at one terminal and sold at another one.
 * `null` for anything else: no sale yet, several commodities or terminals, a trade whose terminal
 * is unknown, or a purchase and a sale at the same terminal.
 */
export function simpleRoute(events: RunEvent[]): { originId: number; destId: number; commodityId: number } | null {
  const trades = tradesOf(events);
  const commodityIds = new Set(trades.map(t => t.commodityId));
  const originIds = new Set(trades.filter(t => t.type === 'buy').map(t => t.terminalId));
  const destIds = new Set(trades.filter(t => t.type === 'sell').map(t => t.terminalId));
  if (commodityIds.size !== 1 || originIds.size !== 1 || destIds.size !== 1) return null;
  const [commodityId] = commodityIds;
  const [originId] = originIds;
  const [destId] = destIds;
  if (originId === null || destId === null || originId === destId) return null;
  return { originId, destId, commodityId };
}

export interface Phases { loadingSec: number; flightSec: number; unloadingSec: number }

/**
 * Splits a simple run into loading (first purchase to departure), flight (departure to arrival) and
 * unloading (arrival to last sale). Needs exactly one departure and one arrival, in that order and
 * between the first purchase and the last sale; otherwise only the total time is known and the answer is `null`.
 */
export function phases(events: RunEvent[]): Phases | null {
  if (simpleRoute(events) === null) return null;
  const departs = events.filter(e => e.type === 'depart');
  const arrives = events.filter(e => e.type === 'arrive');
  if (departs.length !== 1 || arrives.length !== 1) return null;

  const trades = tradesOf(events);
  const firstBuy = Math.min(...trades.filter(t => t.type === 'buy').map(t => t.ts));
  const lastSell = Math.max(...trades.filter(t => t.type === 'sell').map(t => t.ts));
  const depart = departs[0].ts;
  const arrive = arrives[0].ts;
  if (!(firstBuy <= depart && depart <= arrive && arrive <= lastSell)) return null;
  return { loadingSec: depart - firstBuy, flightSec: arrive - depart, unloadingSec: lastSell - arrive };
}
