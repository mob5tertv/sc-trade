import { obsKey, priceKey } from './types';
import type { Market, Observation, QuantityReading, StockStats, UexPrice } from './types';

function isNewer(candidate: Observation, current: Observation): boolean {
  return candidate.ts > current.ts || (candidate.ts === current.ts && candidate.id > current.id);
}

type WithQuantity = Observation & { scu: number };
const hasQuantity = (o: Observation): o is WithQuantity => o.scu !== null;

/** The newest observation that carries a quantity, per terminal, commodity and side (a known zero is a quantity). */
function latestWithQuantity(latestObs: Observation[]): WithQuantity[] {
  const newest = new Map<string, WithQuantity>();
  for (const o of latestObs) {
    if (!hasQuantity(o)) continue;
    const key = obsKey(o.terminalId, o.commodityId, o.side);
    const current = newest.get(key);
    if (!current || isNewer(o, current)) newest.set(key, o);
  }
  return [...newest.values()];
}

/**
 * Indexes the cached UEX prices and the own observations for lookups by terminal and commodity.
 * `own` keeps only the newest observation per terminal, commodity and side (the later `ts`,
 * the higher `id` on a tie); `byTerminal` and `byCommodity` cover both sources. `stock` is what the
 * whole diary says about each stock (see `stockStats`); without it the map is empty.
 *
 * `ownScu` holds the newest own reading of the quantity per terminal, commodity and side, kept apart from
 * the price: an observation with only a price is not a reading of the quantity, so the latest observation
 * can be newer than the reading (spec 14.6). `quantities` are those readings (see `latestQuantities`; the
 * newest wins when a stock appears more than once). Without `quantities` they are derived from `latestObs`:
 * the newest observation of each stock that has a quantity.
 */
export function buildMarket(
  prices: UexPrice[], latestObs: Observation[], stock: Map<string, StockStats> = new Map(), quantities?: QuantityReading[],
): Market {
  const market: Market = { uex: new Map(), own: new Map(), ownScu: new Map(), byTerminal: new Map(), byCommodity: new Map(), stock };

  const index = (terminalId: number, commodityId: number): void => {
    let commodities = market.byTerminal.get(terminalId);
    if (!commodities) market.byTerminal.set(terminalId, (commodities = new Set()));
    commodities.add(commodityId);
    let terminals = market.byCommodity.get(commodityId);
    if (!terminals) market.byCommodity.set(commodityId, (terminals = new Set()));
    terminals.add(terminalId);
  };

  for (const price of prices) {
    market.uex.set(priceKey(price.terminalId, price.commodityId), price);
    index(price.terminalId, price.commodityId);
  }
  for (const o of latestObs) {
    const key = obsKey(o.terminalId, o.commodityId, o.side);
    const current = market.own.get(key);
    if (!current || isNewer(o, current)) market.own.set(key, o);
    index(o.terminalId, o.commodityId);
  }

  for (const { terminalId, commodityId, side, ts, scu } of quantities ?? latestWithQuantity(latestObs)) {
    const key = obsKey(terminalId, commodityId, side);
    const current = market.ownScu.get(key);
    if (!current || ts > current.ts) market.ownScu.set(key, { ts, scu });
  }
  return market;
}
