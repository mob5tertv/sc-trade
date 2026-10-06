import { buildMarket } from '../core/market';
import { routesFrom, routesTo } from '../core/routes';
import type { RouteCtx, RouteOption, RouteResult } from '../core/routes';
import type { Settings } from '../core/settings';
import { distKey } from '../core/types';
import type { Estimate, Market, Reference } from '../core/types';
import type { Db } from './db';
import { latestObservations, latestQuantities, stockStats } from './repo/diary';
import { loadDistances, loadUexPrices } from './repo/uex-cache';
import { ensureDistances, type SyncDeps } from './sync';

// The suggestion service: loads the market from the database, fetches the distances the answer
// needs and has not got yet, asks the pure core for the ranked trips and logs why they were shown.

export interface SuggestDeps extends SyncDeps {
  reference: Reference;
  settings: Settings;
  /** Median trip time of my own runs, by `pairKey`. */
  ownMedian: Map<string, number>;
}

/** How many of the best candidates (by ROI) get their missing distances fetched in one suggestion. */
const MAX_MEASURED_OPTIONS = 20;

/**
 * The cached UEX prices, the newest diary observation of each kind, what the whole diary says about each stock
 * and the latest reading of each quantity (which may be older than the latest observation: spec 14.6).
 */
export async function loadMarket(db: Db): Promise<Market> {
  return buildMarket(await loadUexPrices(db), await latestObservations(db), await stockStats(db), await latestQuantities(db));
}

function routeCtx(d: SuggestDeps, now: number, freeScu: number, distances: Map<string, number | null>, topN: number): RouteCtx {
  const s = d.settings;
  return {
    now,
    thresholds: { hotMin: s.hotMin, warmMin: s.warmMin, coolingMin: s.coolingMin },
    serverChangedAt: s.serverChangedAt,
    refillFullMin: s.refillFullMin,
    settings: {
      starSystemId: s.starSystemId, budget: s.budget,
      quantumSpeedKkms: s.quantumSpeedKkms, overheadMin: s.overheadMin, overheadEmptyMin: s.overheadEmptyMin,
      topN, sort: s.sort,
    },
    freeScu,
    terminals: d.reference.terminals,
    distances,
    ownMedian: d.ownMedian,
  };
}

/** A distance an option needs: `from` is the terminal whose route list may hold it, `pair` the two terminals. */
interface Need { from: number; pair: [number, number] }

const byRoi = (a: RouteOption, b: RouteOption): number => (
  b.roi - a.roi || a.originId - b.originId || a.destId - b.destId || a.commodityId - b.commodityId
);

/**
 * The distances that are not in the cache yet, for the best `MAX_MEASURED_OPTIONS` candidates that
 * lack any, grouped by the terminal UEX is asked from. A pair recorded as unknown counts as known.
 */
function missingDistances(
  candidates: RouteOption[], distances: Map<string, number | null>, needs: (o: RouteOption) => Need[],
): Map<number, Map<string, [number, number]>> {
  const groups = new Map<number, Map<string, [number, number]>>();
  let measured = 0;
  for (const option of [...candidates].sort(byRoi)) {
    if (measured === MAX_MEASURED_OPTIONS) break;
    const lacking = needs(option).filter(({ pair: [a, b] }) => !distances.has(distKey(a, b)));
    if (lacking.length === 0) continue;
    measured++;
    for (const { from, pair } of lacking) {
      let pairs = groups.get(from);
      if (!pairs) groups.set(from, (pairs = new Map()));
      pairs.set(distKey(...pair), pair);
    }
  }
  return groups;
}

/**
 * Ranks every candidate first, fetches the distances the best of them lack (one terminal at a time,
 * UEX failures never abort) and ranks again with what the cache holds then.
 */
async function rank(
  d: SuggestDeps, now: number, freeScu: number,
  search: (ctx: RouteCtx) => RouteResult, needs: (o: RouteOption) => Need[],
): Promise<{ result: RouteResult; ensured: Array<{ from: number; pairs: number }> }> {
  let distances = await loadDistances(d.db);
  const candidates = search(routeCtx(d, now, freeScu, distances, Infinity)).options;
  const missing = missingDistances(candidates, distances, needs);
  for (const [from, pairs] of missing) distances = await ensureDistances(d, from, [...pairs.values()]);
  return {
    result: search(routeCtx(d, now, freeScu, distances, d.settings.topN)),
    ensured: [...missing].map(([from, pairs]) => ({ from, pairs: pairs.size })),
  };
}

const round = (value: number, digits: number): number => Number(value.toFixed(digits));

function describeOption(d: SuggestDeps, o: RouteOption) {
  // `scu` is the quantity shown with the price: the stock at the seller on the buy side, what the buyer already holds
  // on the sell side (information only, it limits no trip); `scuOrigin` says whose reading it is, which need not be
  // the observation the price comes from. `ageKnown` is false for a UEX price whose row has no modification date
  // (`ageSec` means nothing then). `stock` is the refill-timer estimate of my own stock at a seller; a price
  // without one (no reading of mine, or any sell side) has no such key.
  const price = (e: Estimate) => ({
    price: e.price, source: e.source, temp: e.temp, ageSec: e.ageSec, ageKnown: e.ageKnown, scu: e.scu, scuOrigin: e.scuOrigin,
    ...(e.stock === null ? {} : { stock: { ...e.stock, ratePerMin: round(e.stock.ratePerMin, 2) } }),
  });
  return {
    commodity: d.reference.commodities.get(o.commodityId)?.code ?? null,
    commodityId: o.commodityId, originId: o.originId, destId: o.destId,
    buy: price(o.buy), sell: price(o.sell),
    qty: o.qty, roi: round(o.roi, 4), timeSec: o.timeSec, timeSource: o.timeSource,
    uecPerHour: o.uecPerHour === null ? null : Math.round(o.uecPerHour),
  };
}

function describeFilters(s: Settings, commodityId: number | undefined) {
  return { commodityId: commodityId ?? null, starSystemId: s.starSystemId, budget: s.budget, sort: s.sort, topN: s.topN };
}

/** The current terminal and, when `settings.nearby` is on, the other terminals of its planet (never planet 0). */
function purchaseOrigins(d: SuggestDeps, currentTerminalId: number): number[] {
  const current = d.reference.terminals.get(currentTerminalId);
  if (!d.settings.nearby || !current || current.planetId === 0) return [currentTerminalId];
  const neighbours = [...d.reference.terminals.values()]
    .filter((t) => t.planetId === current.planetId && t.id !== currentTerminalId)
    .map((t) => t.id)
    .sort((a, b) => a - b);
  return [currentTerminalId, ...neighbours];
}

/**
 * Where to take cargo from `currentTerminalId` (and, with `settings.nearby`, from the terminals of its
 * planet): ranked trips to every terminal that buys what is sold there. `commodityId` narrows the
 * search to one commodity.
 */
export async function suggestFrom(d: SuggestDeps, currentTerminalId: number, freeScu: number, commodityId?: number): Promise<RouteOption[]> {
  const now = d.now();
  const market = await loadMarket(d.db);
  const origins = purchaseOrigins(d, currentTerminalId);
  const { result, ensured } = await rank(
    d, now, freeScu,
    (ctx) => routesFrom(market, origins, currentTerminalId, ctx, commodityId),
    (o) => {
      const needs: Need[] = [{ from: o.originId, pair: [o.originId, o.destId] }];
      // Another purchase terminal costs an empty flight from where the player stands.
      if (o.originId !== currentTerminalId) needs.push({ from: currentTerminalId, pair: [currentTerminalId, o.originId] });
      return needs;
    },
  );
  d.log.debug('suggest', 'from', {
    now, currentTerminalId, origins, freeScu,
    filters: { ...describeFilters(d.settings, commodityId), nearby: d.settings.nearby },
    ensured, trace: result.trace, options: result.options.map((o) => describeOption(d, o)),
  });
  return result.options;
}

/**
 * Where to buy for `destId`: ranked trips that end at that terminal, from every terminal that sells
 * what it buys. `commodityId` narrows the search to one commodity. The terminal need not be where the
 * player is, so there is no empty flight.
 */
export async function suggestTo(d: SuggestDeps, destId: number, freeScu: number, commodityId?: number): Promise<RouteOption[]> {
  const now = d.now();
  const market = await loadMarket(d.db);
  const { result, ensured } = await rank(
    d, now, freeScu,
    (ctx) => routesTo(market, destId, ctx, commodityId),
    // The destination's own route list covers the pair of every origin at once.
    (o) => [{ from: destId, pair: [o.originId, destId] }],
  );
  d.log.debug('suggest', 'to', {
    now, destId, freeScu,
    filters: describeFilters(d.settings, commodityId),
    ensured, trace: result.trace, options: result.options.map((o) => describeOption(d, o)),
  });
  return result.options;
}
