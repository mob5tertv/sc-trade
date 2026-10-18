import { estimate } from './estimate';
import type { EstimateCtx } from './estimate';
import { distKey, pairKey } from './types';
import type { Estimate, Market, Terminal } from './types';

const SEC_PER_MIN = 60;
const SEC_PER_HOUR = 3600;

/**
 * How many SCU one trip carries: the smallest of the free cargo space, the stock at the purchase
 * terminal and what the budget buys. Only a missing (`null`) stock and an unset budget do not limit
 * the amount: a known zero limits it to nothing. The selling terminal never limits it: the quantity
 * the game shows there is what that terminal already holds, not what it is willing to buy (spec 14.5).
 * Never negative.
 */
export function quantity(i: { freeScu: number; stockScu: number | null; budget: number | null; buyPrice: number }): number {
  const limits = [i.freeScu];
  if (i.stockScu !== null) limits.push(i.stockScu);
  if (i.budget !== null && i.buyPrice > 0) limits.push(i.budget / i.buyPrice);
  return Math.max(0, Math.floor(Math.min(...limits)));
}

/** Seconds for a flight: the fixed overhead in minutes plus the quantum jump (Gm at kkm/s, i.e. Mm per second). */
export function travelSec(distanceGm: number, speedKkms: number, overheadMin: number): number {
  return overheadMin * SEC_PER_MIN + (distanceGm * 1000) / speedKkms;
}

export interface RouteSettings {
  starSystemId: number | null; budget: number | null;
  quantumSpeedKkms: number; overheadMin: number; overheadEmptyMin: number;
  topN: number; sort: 'profit' | 'roi';
  /**
   * «Выгоднее» (spec 14.19, item 7): how many minutes of an EMPTY flight a purchase at another terminal may cost. A trip bought
   * farther than that is not offered. Absent: no limit (the search of trips from one terminal has no other purchase places anyway).
   */
  nearbyMaxMin?: number;
}

export interface RouteCtx extends EstimateCtx {
  settings: RouteSettings; freeScu: number;
  terminals: Map<number, Terminal>;
  distances: Map<string, number | null>;   // distKey
  ownMedian: Map<string, number>;          // pairKey → seconds
  /** pairKey → seconds of flight and unloading there, by my runs of the pair that have both marks (`ownLegIndex`); absent: only the distance tells. */
  ownLeg?: Map<string, number>;
}

export interface RouteOption {
  commodityId: number; originId: number; destId: number; buy: Estimate;
  /** `sell.scu` is what the buyer already holds of the commodity: shown as information, it limits nothing. */
  sell: Estimate;
  qty: number; profit: number; roi: number; worstProfit: number;
  /** Origin to destination; `null` when the distance is unknown. */
  distanceGm: number | null;
  /** The empty flight to the purchase terminal; 0 when no such flight is needed or its length is unknown. */
  emptyLegSec: number;
  /** Whole trip including `emptyLegSec`; `null` when any needed distance is unknown (and no own median covers the trip). */
  timeSec: number | null; timeSource: 'own' | 'estimate' | null;
  uecPerHour: number | null;
}

/**
 * `considered` counts the origin → destination pairs per commodity where both prices are known
 * (the origin is never its own destination). Each one is either dropped, with the reason counted in
 * `dropped`, or kept: `considered = kept + Σ dropped`. `kept` is taken before the `topN` cut.
 * `zeroQty` is a trip with nothing to carry: no stock at the purchase terminal, no free space or a budget
 * that buys nothing. An empty selling terminal is not one of them. `tooFar` and `notBetter` are the trips bought at another
 * terminal that «Выгоднее» does not offer (`betterElsewhere`).
 */
export interface RouteTrace {
  considered: number; kept: number;
  dropped: {
    unknownTerminal: number; systemFilter: number; nonPositiveProfit: number; zeroQty: number;
    /** Bought at another terminal that is farther than the empty flight allowed (`nearbyMaxMin`), or whose distance is not known (to UEX, or yet). */
    tooFar: number;
    /** Bought at another terminal and bringing no more per trip than what the player's own terminal gives (`betterElsewhere`). */
    notBetter: number;
  };
}
export interface RouteResult { options: RouteOption[]; trace: RouteTrace }

/** The distance between two terminals, or `null` when it is not in the table or recorded as unknown. */
function distanceBetween(ctx: RouteCtx, a: number, b: number): number | null {
  return ctx.distances.get(distKey(a, b)) ?? null;
}

/** The buy price at a terminal; a zero price means "unknown", the same as for UEX statistics. */
function buyEstimate(m: Market, terminalId: number, commodityId: number, ctx: RouteCtx): Estimate | null {
  const buy = estimate(m, terminalId, commodityId, 'buy', ctx);
  return buy !== null && buy.price > 0 ? buy : null;
}

/**
 * Time of the whole trip. The main leg is my own median for this pair when there is one, else the
 * estimate from the distance. A purchase terminal other than the current one adds an empty flight;
 * if its distance is unknown the time of the whole trip is unknown.
 */
function tripTime(ctx: RouteCtx, originId: number, destId: number, currentTerminalId: number | null, distanceGm: number | null):
  Pick<RouteOption, 'emptyLegSec' | 'timeSec' | 'timeSource'> {
  const { quantumSpeedKkms, overheadMin, overheadEmptyMin } = ctx.settings;
  const ownSec = ctx.ownMedian.get(pairKey(originId, destId));
  let mainSec: number | null = null;
  let timeSource: RouteOption['timeSource'] = null;
  if (ownSec !== undefined && ownSec > 0) {
    mainSec = ownSec; timeSource = 'own';
  } else if (distanceGm !== null) {
    mainSec = travelSec(distanceGm, quantumSpeedKkms, overheadMin); timeSource = 'estimate';
  }

  let emptyLegSec = 0;
  let emptyLegKnown = true;
  if (currentTerminalId !== null && currentTerminalId !== originId) {
    const emptyDistance = distanceBetween(ctx, currentTerminalId, originId);
    if (emptyDistance === null) emptyLegKnown = false;
    else emptyLegSec = travelSec(emptyDistance, quantumSpeedKkms, overheadEmptyMin);
  }

  if (mainSec === null || !emptyLegKnown) return { emptyLegSec, timeSec: null, timeSource: null };
  return { emptyLegSec, timeSec: emptyLegSec + mainSec, timeSource };
}

/** A fresh trace; `kept` is filled in when the result is assembled. */
const newTrace = (): RouteTrace => ({
  considered: 0, kept: 0,
  dropped: { unknownTerminal: 0, systemFilter: 0, nonPositiveProfit: 0, zeroQty: 0, tooFar: 0, notBetter: 0 },
});

/** Prices both ends of one trip, or `null` after counting the reason it is dropped. */
function evaluate(
  trace: RouteTrace, ctx: RouteCtx, currentTerminalId: number | null,
  commodityId: number, originId: number, buy: Estimate, destId: number, sell: Estimate,
): RouteOption | null {
  trace.considered++;
  const origin = ctx.terminals.get(originId);
  const dest = ctx.terminals.get(destId);
  if (!origin || !dest) { trace.dropped.unknownTerminal++; return null; }

  const { starSystemId, budget } = ctx.settings;
  if (starSystemId !== null && (origin.starSystemId !== starSystemId || dest.starSystemId !== starSystemId)) {
    trace.dropped.systemFilter++; return null;
  }
  if (sell.price <= buy.price) { trace.dropped.nonPositiveProfit++; return null; }

  const qty = quantity({ freeScu: ctx.freeScu, stockScu: buy.scu, budget, buyPrice: buy.price });
  if (qty === 0) { trace.dropped.zeroQty++; return null; }

  const margin = sell.price - buy.price;
  const profit = qty * margin;
  const distanceGm = distanceBetween(ctx, originId, destId);
  const time = tripTime(ctx, originId, destId, currentTerminalId, distanceGm);
  return {
    commodityId, originId, destId, buy, sell,
    qty, profit, roi: margin / buy.price, worstProfit: qty * (sell.low - buy.high),
    distanceGm, ...time,
    uecPerHour: time.timeSec !== null && time.timeSec > 0 ? (profit * SEC_PER_HOUR) / time.timeSec : null,
  };
}

/**
 * Whether anything is known about the stock at the purchase terminal: a number there, a known zero included, and a stock counted by
 * the refill timer from my own reading. Only `null` is unknown: the volume of such a trip was counted with no stock to limit it
 * (the mark «?» of the option says so).
 */
export function stockKnown(option: Pick<RouteOption, 'buy'>): boolean {
  return option.buy.scu !== null;
}

type Compare = (a: RouteOption, b: RouteOption) => number;

/** Trips that rest on a known stock before those that rest on an unknown one, whatever the sort: a trip counted at the whole free space must not stand first. */
const byKnownStock: Compare = (a, b) => Number(!stockKnown(a)) - Number(!stockKnown(b));

const byRoi: Compare = (a, b) => b.roi - a.roi;
/**
 * What the trip brings first (plan item 17, the author 14.10.2026: "the profit and the time of the trip, not UEC per hour"). The
 * time stands beside the profit in the list and is the player's to weigh: an estimate of it is too rough to divide by.
 */
const byProfit: Compare = (a, b) => b.profit - a.profit;

/**
 * The trips with a known stock first, then those with an unknown one; inside each group best first by the chosen metric, then by the other
 * one; ids make a tie deterministic. The best N are taken from this order (`finish`), so an unknown stock fills only what the known ones leave.
 */
function ranking(sort: RouteSettings['sort']): Compare {
  const [first, second] = sort === 'roi' ? [byRoi, byProfit] : [byProfit, byRoi];
  return (a, b) => byKnownStock(a, b) || first(a, b) || second(a, b) || a.originId - b.originId || a.destId - b.destId || a.commodityId - b.commodityId;
}

/** How many trips bought at another terminal are offered beside the player's own: a few better ones, not a second list. */
export const ELSEWHERE_MAX = 3;

/**
 * The best `topN` trips. With `homeId` (the terminal the player asks from) the trips bought there come first and fill the
 * `topN`; the trips bought elsewhere follow them, the best `ELSEWHERE_MAX` at most: they are an addition to the player's own
 * options and must neither push them out nor be pushed out by them.
 */
function finish(found: RouteOption[], trace: RouteTrace, settings: RouteSettings, homeId: number | null = null): RouteResult {
  trace.kept = found.length;
  const sorted = found.sort(ranking(settings.sort));
  if (homeId === null) return { options: sorted.slice(0, settings.topN), trace };
  const own = sorted.filter((o) => o.originId === homeId);
  const elsewhere = sorted.filter((o) => o.originId !== homeId);
  // an uncut search (the candidates whose distances are asked for) keeps every trip bought elsewhere, too
  const more = Number.isFinite(settings.topN) ? Math.min(settings.topN, ELSEWHERE_MAX) : Number.POSITIVE_INFINITY;
  return { options: [...own.slice(0, settings.topN), ...elsewhere.slice(0, more)], trace };
}

/**
 * «Выгоднее» (spec 14.19, item 7): which of the trips bought at ANOTHER terminal than `homeId` are worth offering.
 *  - Near: the empty flight to the purchase is within `settings.nearbyMaxMin`. A distance UEX does not know is not near. A
 *    distance that is not in the table YET cannot be judged: the trip is not offered (a list cut to the best N is what the player
 *    sees), but it stays among the candidates of an uncut search (`topN` infinite), which is what the distances are asked for.
 *  - Better: it brings more per trip (its profit, counted with the stock there and the hold) than the best trip of the SAME
 *    commodity bought at `homeId`; when that commodity is not sold there (or does not pay), more than the best trip of
 *    anything bought at `homeId`. With nothing to buy at home every near trip is better. It was the ROI until plan item 17:
 *    a small batch with a fine percentage is not what is worth an empty flight. A trip whose stock NOBODY knows is counted at
 *    the whole free hold, and must not win by that guess alone: it has to have the higher ROI as well (a better price, not only
 *    an assumed quantity).
 * The trips bought at `homeId` are all kept. What is dropped is counted in the trace.
 */
function betterElsewhere(found: RouteOption[], homeId: number, ctx: RouteCtx, trace: RouteTrace): RouteOption[] {
  const limitSec = ctx.settings.nearbyMaxMin === undefined ? Number.POSITIVE_INFINITY : ctx.settings.nearbyMaxMin * SEC_PER_MIN;
  const NONE = Number.NEGATIVE_INFINITY;
  let bestHome = NONE;
  let bestHomeRoi = NONE;
  const bestHomeBy = new Map<number, number>();
  const bestHomeRoiBy = new Map<number, number>();
  for (const o of found) {
    if (o.originId !== homeId) continue;
    bestHome = Math.max(bestHome, o.profit);
    bestHomeRoi = Math.max(bestHomeRoi, o.roi);
    bestHomeBy.set(o.commodityId, Math.max(bestHomeBy.get(o.commodityId) ?? NONE, o.profit));
    bestHomeRoiBy.set(o.commodityId, Math.max(bestHomeRoiBy.get(o.commodityId) ?? NONE, o.roi));
  }
  return found.filter((o) => {
    if (o.originId === homeId) return true;
    const key = distKey(homeId, o.originId);
    const tooFar = ctx.distances.has(key)
      ? ctx.distances.get(key) === null || o.emptyLegSec > limitSec
      : Number.isFinite(ctx.settings.topN);
    if (tooFar) { trace.dropped.tooFar++; return false; }
    const brings = o.profit > (bestHomeBy.get(o.commodityId) ?? bestHome);
    const pays = stockKnown(o) || o.roi > (bestHomeRoiBy.get(o.commodityId) ?? bestHomeRoi);
    if (!brings || !pays) { trace.dropped.notBetter++; return false; }
    return true;
  });
}

/**
 * Ranked trips that start at the given purchase terminals (the current one, and optionally its
 * neighbours): every commodity they sell, to every terminal that buys it. A purchase terminal other
 * than `currentTerminalId` costs an empty flight from the current one, and its trips are offered only when they are
 * near and better (`betterElsewhere`); they follow the trips of the current terminal (`finish`). `commodityId` narrows the search.
 * A terminal that is missing from `ctx.terminals` is skipped and counted, never an error.
 */
export function routesFrom(m: Market, originIds: number[], currentTerminalId: number, ctx: RouteCtx, commodityId?: number): RouteResult {
  const trace = newTrace();
  const found: RouteOption[] = [];
  for (const originId of new Set(originIds)) {
    const commodityIds = commodityId === undefined ? [...(m.byTerminal.get(originId) ?? [])] : [commodityId];
    for (const c of commodityIds) {
      const buy = buyEstimate(m, originId, c, ctx);
      if (!buy) continue;
      for (const destId of m.byCommodity.get(c) ?? []) {
        if (destId === originId) continue;
        const sell = estimate(m, destId, c, 'sell', ctx);
        if (!sell) continue;
        const option = evaluate(trace, ctx, currentTerminalId, c, originId, buy, destId, sell);
        if (option) found.push(option);
      }
    }
  }
  return finish(betterElsewhere(found, currentTerminalId, ctx, trace), trace, ctx.settings, currentTerminalId);
}

/** A line of the storage to carry on: where it lies, what, how much, and the average price it was bought for. */
export interface StorageLot { terminalId: number; commodityId: number; scu: number; price: number }

/**
 * Where to carry a line of the storage (version 1.4, the author: «ищем оптимальный маршрут, необязательно же что я повезу его туда же»):
 * every terminal that buys the commodity, as a trip from the place of the storage. The purchase is the lot itself: its price is what
 * the goods cost, its stock is what lies there, and the budget limits nothing (it is paid already). The trips rank as any others.
 */
export function routesForLot(m: Market, lot: StorageLot, ctx: RouteCtx): RouteResult {
  const trace = newTrace();
  const found: RouteOption[] = [];
  const buy: Estimate = {
    price: lot.price, low: lot.price, high: lot.price, source: 'own', temp: null, ageSec: 0, ageKnown: true,
    ownLast: null, uexRange: null, scu: lot.scu, scuOrigin: 'own', stock: null, prev: null,
  };
  const paid: RouteCtx = { ...ctx, settings: { ...ctx.settings, budget: null } };
  for (const destId of m.byCommodity.get(lot.commodityId) ?? []) {
    if (destId === lot.terminalId) continue;
    const sell = estimate(m, destId, lot.commodityId, 'sell', ctx);
    if (!sell) continue;
    const option = evaluate(trace, paid, lot.terminalId, lot.commodityId, lot.terminalId, buy, destId, sell);
    if (option) found.push(option);
  }
  return finish(found, trace, ctx.settings);
}

/**
 * Ranked trips that end at `destId`: every commodity the terminal buys, from every terminal that
 * sells it. `commodityId` narrows the search to one commodity before the `topN` cut.
 * Where the player stands is not known here, so there is no empty flight.
 */
export function routesTo(m: Market, destId: number, ctx: RouteCtx, commodityId?: number): RouteResult {
  const trace = newTrace();
  const found: RouteOption[] = [];
  for (const c of commodityId === undefined ? m.byTerminal.get(destId) ?? [] : [commodityId]) {
    const sell = estimate(m, destId, c, 'sell', ctx);
    if (!sell) continue;
    for (const originId of m.byCommodity.get(c) ?? []) {
      if (originId === destId) continue;
      const buy = buyEstimate(m, originId, c, ctx);
      if (!buy) continue;
      const option = evaluate(trace, ctx, null, c, originId, buy, destId, sell);
      if (option) found.push(option);
    }
  }
  return finish(found, trace, ctx.settings);
}
