import { obsKey, priceKey } from './types';
import type { Market, Observation, StockStats, UexPrice } from './types';

function isNewer(candidate: Observation, current: Observation): boolean {
  return candidate.ts > current.ts || (candidate.ts === current.ts && candidate.id > current.id);
}

/**
 * Indexes the cached UEX prices and the own observations for lookups by terminal and commodity.
 * `own` keeps only the newest observation per terminal, commodity and side (the later `ts`,
 * the higher `id` on a tie); `byTerminal` and `byCommodity` cover both sources. `stock` is what the
 * whole diary says about each stock (see `stockStats`); without it the map is empty.
 */
export function buildMarket(prices: UexPrice[], latestObs: Observation[], stock: Map<string, StockStats> = new Map()): Market {
  const market: Market = { uex: new Map(), own: new Map(), byTerminal: new Map(), byCommodity: new Map(), stock };

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
  return market;
}
