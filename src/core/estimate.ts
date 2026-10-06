import { temperature } from './temperature';
import { obsKey, priceKey } from './types';
import type { Estimate, Market, Side, TempThresholds, UexSideStats } from './types';

export interface EstimateCtx { now: number; thresholds: TempThresholds; serverChangedAt: number | null }

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

/** Zero and a missing value both mean "unknown" for a quantity. */
function knownScu(scu: number | null): number | null {
  return scu !== null && scu > 0 ? scu : null;
}

const ageOf = (ts: number, now: number): number => Math.max(0, now - ts);

/**
 * The price to expect for a commodity at a terminal on one side, or null when nothing is known.
 * The own latest observation wins unless it is cold; then UEX statistics take over and the own
 * price is kept for reference. A cold own price with no usable UEX row is still returned
 * (`source: 'own'`, `temp: 'cold'`). The quantity follows the same rule: own if not cold, else UEX.
 */
export function estimate(m: Market, terminalId: number, commodityId: number, side: Side, ctx: EstimateCtx): Estimate | null {
  const own = m.own.get(obsKey(terminalId, commodityId, side));
  const row = m.uex.get(priceKey(terminalId, commodityId));
  const range = row ? priceRange(row[side]) : null;
  const uexScu = row ? knownScu(side === 'buy' ? row.scuBuy : row.scuSell) : null;

  const fromUex = (ownLast: Estimate['ownLast']): Estimate | null => (row && range
    ? { ...range, source: 'uex', temp: null, ageSec: ageOf(row.dateModified, ctx.now), ownLast, uexRange: null, scu: uexScu }
    : null);

  if (!own) return fromUex(null);

  const temp = temperature(own.ts, ctx.now, ctx.thresholds, ctx.serverChangedAt);
  const ownAge = ageOf(own.ts, ctx.now);
  if (temp !== 'cold') {
    return {
      price: own.price, low: own.price, high: own.price,
      source: 'own', temp, ageSec: ownAge,
      ownLast: null,
      uexRange: temp === 'cooling' && range ? { low: range.low, high: range.high } : null,
      scu: knownScu(own.scu) ?? uexScu,
    };
  }
  return fromUex({ price: own.price, ageSec: ownAge }) ?? {
    price: own.price, low: own.price, high: own.price,
    source: 'own', temp: 'cold', ageSec: ownAge,
    ownLast: null, uexRange: null, scu: uexScu,
  };
}
