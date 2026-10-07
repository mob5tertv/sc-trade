import type { Market, PriceReading } from '../../src/core/types';

// Previous own price readings: fixtures for tests of `Market.ownPrev` and `Estimate.prev`.

/** A previous price reading; terminal 2, Gold (10), SELL side unless said otherwise, the same stock as the estimate tests use. */
export const previousReading = (partial: Partial<PriceReading> = {}): PriceReading => (
  { terminalId: 2, commodityId: 10, side: 'sell', ts: 0, price: 0, ...partial }
);

/**
 * The previous readings of `m` as `buildMarket` takes them. A helper that builds a changed copy of a market with
 * `buildMarket` has to hand them over, or the copy forgets every previous reading (like `quantitiesOf` does for
 * the quantity readings).
 */
export function previousOf(m: Market): PriceReading[] {
  return [...m.ownPrev].map(([key, { ts, price }]) => {
    const [terminalId, commodityId, side] = key.split(':');
    return { terminalId: Number(terminalId), commodityId: Number(commodityId), side: side as PriceReading['side'], ts, price };
  });
}
