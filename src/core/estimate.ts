import { DEFAULT_REFILL_FULL_MIN, estimateStock } from './stock';
import { temperature } from './temperature';
import { obsKey, priceKey } from './types';
import type { Estimate, Market, Side, StockEstimate, TempThresholds, UexSideStats } from './types';

export interface EstimateCtx {
  now: number; thresholds: TempThresholds; serverChangedAt: number | null;
  /** Minutes a stock needs to refill from empty to its maximum while no rate is learned; `DEFAULT_REFILL_FULL_MIN` when absent. */
  refillFullMin?: number;
}

interface PriceRange { price: number; low: number; high: number }

/**
 * The expected price and its bounds from UEX statistics: the weekly average with the weekly
 * min and max, and when the week is empty the same for the month, then for all time, then
 * the last reported price. A zero average means "no data" for that period.
 */
function priceRange(s: UexSideStats): PriceRange | null {
  if (s.avgWeek > 0) return { price: s.avgWeek, low: s.minWeek, high: s.maxWeek };
  if (s.avgMonth > 0) return { price: s.avgMonth, low: s.minMonth, high: s.maxMonth };
  if (s.avg > 0) return { price: s.avg, low: s.min, high: s.max };
  if (s.last > 0) return { price: s.last, low: s.last, high: s.last };
  return null;
}

/** A UEX quantity: zero and a missing value both mean "unknown" (unlike my own, where zero is a known empty stock). */
const positive = (n: number | null | undefined): number | null => (n !== null && n !== undefined && n > 0 ? n : null);

const ageOf = (ts: number, now: number): number => Math.max(0, now - ts);

/**
 * How much stock a seller (BUY side) has now, counted from my own reading `base` of the quantity (`key` is the
 * `obsKey` of the stock). The largest stock is the bigger of what my diary has seen and what UEX has seen
 * (a zero means unknown); the rate is the one learned from my diary.
 */
function stockNow(m: Market, key: string, base: { ts: number; scu: number }, uexMax: number, ctx: EstimateCtx): StockEstimate {
  const stats = m.stock.get(key);
  return estimateStock({
    baseScu: base.scu, baseTs: base.ts, now: ctx.now,
    maxScu: positive(Math.max(stats?.maxScu ?? 0, uexMax)),
    learnedRatePerMin: stats?.ratePerMin ?? null,
    refillFullMin: ctx.refillFullMin ?? DEFAULT_REFILL_FULL_MIN,
  });
}

/**
 * The expected price of a commodity at a terminal on one side, with the quantity next to it, or null when no
 * price is known.
 *
 * The price: the own latest observation wins unless it is cold; then UEX statistics take over and the own
 * price is kept for reference. A cold own price with no usable UEX row is still returned (`source: 'own'`,
 * `temp: 'cold'`). The age of a UEX price is unknown (`ageKnown: false`) when its row has no modification date.
 *
 * The quantity is a reading of its own (spec 14.6): it comes from `Market.ownScu`, not from the observation the
 * price comes from, so an observation with only a price does not erase it. The reading is judged by its own time
 * (same thresholds, same server-change rule as for prices). While it is not cold it is mine (`scuOrigin: 'own'`),
 * even when the price is a UEX one; otherwise the UEX quantity stands in (`'uex'`, positive only), and without
 * one there is none (`null`). What the quantity means depends on the side (spec 14.5):
 *  - BUY: the stock at the seller, which can be bought. My own reading is a reading of the past, so it is
 *    brought up to date with the refill timer (`stock`); a zero there is a known empty stock, only `null`
 *    is unknown.
 *  - SELL: what the buyer already holds of the commodity (zero: out of stock, the best buyer). It is shown
 *    as recorded, a zero included, with no timer (`stock` is `null`), and it limits nothing.
 * A UEX quantity has no timer and a zero there means "unknown", on both sides.
 *
 * `prev` is the previous own reading of the price from `Market.ownPrev`, for the screen to tell whether my price
 * went up or down (an equal price is a previous reading too). It is there only while the price is mine and not
 * cold: a UEX price, and a cold own price (kept only because UEX has nothing), have none. A previous reading from
 * before the last server change (`serverChangedAt`) is not comparable with one after it, so it is dropped.
 */
export function estimate(m: Market, terminalId: number, commodityId: number, side: Side, ctx: EstimateCtx): Estimate | null {
  const key = obsKey(terminalId, commodityId, side);
  const own = m.own.get(key);
  const reading = m.ownScu.get(key);
  const row = m.uex.get(priceKey(terminalId, commodityId));
  const range = row ? priceRange(row[side]) : null;
  const uexScu = row ? positive(side === 'buy' ? row.scuBuy : row.scuSell) : null;
  const uexMax = row && side === 'buy' ? row.scuBuyMax : 0;

  const quantity = (): Pick<Estimate, 'scu' | 'scuOrigin' | 'stock'> => {
    if (reading && temperature(reading.ts, ctx.now, ctx.thresholds, ctx.serverChangedAt) !== 'cold') {
      const stock = side === 'buy' ? stockNow(m, key, reading, uexMax, ctx) : null;
      return { scu: stock ? stock.scu : reading.scu, scuOrigin: 'own', stock };
    }
    return { scu: uexScu, scuOrigin: uexScu === null ? null : 'uex', stock: null };
  };

  const previous = (): Estimate['prev'] => {
    const prev = m.ownPrev.get(key);
    if (!prev || (ctx.serverChangedAt !== null && prev.ts < ctx.serverChangedAt)) return null;
    return { price: prev.price, ageSec: ageOf(prev.ts, ctx.now) };
  };

  const fromUex = (ownLast: Estimate['ownLast']): Estimate | null => (row && range
    ? {
      ...range, source: 'uex', temp: null, ageSec: ageOf(row.dateModified, ctx.now), ageKnown: row.dateModified !== 0,
      ownLast, uexRange: null, ...quantity(), prev: null,
    }
    : null);

  if (!own) return fromUex(null);

  const temp = temperature(own.ts, ctx.now, ctx.thresholds, ctx.serverChangedAt);
  const ownAge = ageOf(own.ts, ctx.now);
  if (temp !== 'cold') {
    return {
      price: own.price, low: own.price, high: own.price,
      source: 'own', temp, ageSec: ownAge, ageKnown: true,
      ownLast: null,
      uexRange: temp === 'cooling' && range ? { low: range.low, high: range.high } : null,
      ...quantity(), prev: previous(),
    };
  }
  return fromUex({ price: own.price, ageSec: ownAge }) ?? {
    price: own.price, low: own.price, high: own.price,
    source: 'own', temp: 'cold', ageSec: ownAge, ageKnown: true,
    ownLast: null, uexRange: null, ...quantity(), prev: null,
  };
}
