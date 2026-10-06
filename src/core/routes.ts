import { estimate } from './estimate';
import type { EstimateCtx } from './estimate';
import { distKey, pairKey } from './types';
import type { Estimate, Market, Terminal } from './types';

const SEC_PER_MIN = 60;
const SEC_PER_HOUR = 3600;

/**
 * How many SCU one trip carries: the smallest of the free cargo space, the stock at the purchase
 * terminal, the demand at the selling terminal and what the budget buys. A zero or missing stock or
 * demand and an unset budget do not limit the amount. Never negative.
 */
export function quantity(i: { freeScu: number; stockScu: number | null; demandScu: number | null; budget: number | null; buyPrice: number }): number {
  const limits = [i.freeScu];
  if (i.stockScu !== null && i.stockScu > 0) limits.push(i.stockScu);
  if (i.demandScu !== null && i.demandScu > 0) limits.push(i.demandScu);
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
  topN: number; sort: 'uecPerHour' | 'roi';
}

export interface RouteCtx extends EstimateCtx {
  settings: RouteSettings; freeScu: number;
  terminals: Map<number, Terminal>;
  distances: Map<string, number | null>;   // distKey
  ownMedian: Map<string, number>;          // pairKey → seconds
}

export interface RouteOption {
  commodityId: number; originId: number; destId: number; buy: Estimate; sell: Estimate;
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
 */
export interface RouteTrace { considered: number; kept: number; dropped: { unknownTerminal: number; systemFilter: number; nonPositiveProfit: number; zeroQty: number } }
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
  dropped: { unknownTerminal: 0, systemFilter: 0, nonPositiveProfit: 0, zeroQty: 0 },
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

  const qty = quantity({ freeScu: ctx.freeScu, stockScu: buy.scu, demandScu: sell.scu, budget, buyPrice: buy.price });
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

type Compare = (a: RouteOption, b: RouteOption) => number;

const byRoi: Compare = (a, b) => b.roi - a.roi;
/** Higher UEC per hour first, routes without a time after all the others. */
const byUecPerHour: Compare = (a, b) => {
  if (a.uecPerHour === null || b.uecPerHour === null) return Number(a.uecPerHour === null) - Number(b.uecPerHour === null);
  return b.uecPerHour - a.uecPerHour;
};

/** Best first by the chosen metric, then by the other one; ids make a tie deterministic. */
function ranking(sort: RouteSettings['sort']): Compare {
  const [first, second] = sort === 'roi' ? [byRoi, byUecPerHour] : [byUecPerHour, byRoi];
  return (a, b) => first(a, b) || second(a, b) || a.originId - b.originId || a.destId - b.destId || a.commodityId - b.commodityId;
}

function finish(found: RouteOption[], trace: RouteTrace, settings: RouteSettings): RouteResult {
  trace.kept = found.length;
  return { options: found.sort(ranking(settings.sort)).slice(0, settings.topN), trace };
}

/**
 * Ranked trips that start at the given purchase terminals (the current one, and optionally its
 * neighbours): every commodity they sell, to every terminal that buys it. A purchase terminal other
 * than `currentTerminalId` costs an empty flight from the current one. `commodityId` narrows the search.
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
  return finish(found, trace, ctx.settings);
}

/**
 * Ranked trips that end at `destId`: every commodity the terminal buys, from every terminal that
 * sells it. Where the player stands is not known here, so there is no empty flight.
 */
export function routesTo(m: Market, destId: number, ctx: RouteCtx): RouteResult {
  const trace = newTrace();
  const found: RouteOption[] = [];
  for (const c of m.byTerminal.get(destId) ?? []) {
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
