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
 * A run of goods the application never saw bought (spec 14.10): at least one sale and no purchase at all. It is the one
 * rule that tells such a run from a flight: it has no cargo, no route and no phases, and it is not counted as a run. Like every
 * number of a run it looks only at the trades that name a commodity, a quantity and a price: a half-filled row is neither a sale nor a purchase.
 */
export function isIncomeRun(events: RunEvent[]): boolean {
  const trades = tradesOf(events);
  return trades.some(t => t.type === 'sell') && !trades.some(t => t.type === 'buy');
}

/** The two ends of a run that buys everything at one terminal and sells everything at another one, and the goods it carries. */
export interface RunRoute {
  originId: number; destId: number;
  /** Every commodity the run trades in, once, the smallest id first: a set, the order of the trades does not matter. */
  commodityIds: number[];
}

/**
 * The route of a run whose purchases are ALL at one terminal and whose sales are ALL at another one, whatever it carries
 * (task 51): one commodity is a simple run, several are a run of mixed cargo; both are a route of the statistics.
 * `null` for anything else: no sale yet or no purchase, purchases or sales at several terminals, a trade whose terminal
 * is unknown, or a purchase and a sale at the same terminal.
 */
export function routeOf(events: RunEvent[]): RunRoute | null {
  const trades = tradesOf(events);
  const originIds = new Set(trades.filter(t => t.type === 'buy').map(t => t.terminalId));
  const destIds = new Set(trades.filter(t => t.type === 'sell').map(t => t.terminalId));
  if (originIds.size !== 1 || destIds.size !== 1) return null;
  const [originId] = originIds;
  const [destId] = destIds;
  if (originId === null || destId === null || originId === destId) return null;
  return { originId, destId, commodityIds: [...new Set(trades.map(t => t.commodityId))].sort((a, b) => a - b) };
}

/**
 * The route of a simple run: one commodity bought at one terminal and sold at another one. `routeOf` of a run of one commodity;
 * `null` for a run of several commodities and for everything that has no route.
 */
export function simpleRoute(events: RunEvent[]): { originId: number; destId: number; commodityId: number } | null {
  const route = routeOf(events);
  if (route === null || route.commodityIds.length !== 1) return null;
  return { originId: route.originId, destId: route.destId, commodityId: route.commodityIds[0] };
}

export interface Phases { loadingSec: number; flightSec: number; unloadingSec: number }

/**
 * Splits a run that has a route (`routeOf`: one commodity or several between the same two terminals) into loading (first purchase to
 * departure), flight (departure to arrival) and unloading (arrival to last sale). Needs exactly one departure and one arrival, in that
 * order and between the first purchase and the last sale; otherwise only the total time is known and the answer is `null`.
 */
export function phases(events: RunEvent[]): Phases | null {
  if (routeOf(events) === null) return null;
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
