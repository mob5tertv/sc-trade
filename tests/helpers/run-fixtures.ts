import { buildMarket } from '../../src/core/market';
import type { RouteCtx } from '../../src/core/routes';
import { distKey, priceKey } from '../../src/core/types';
import type { CargoLine, Market, UexSideStats } from '../../src/core/types';
import { obs, px } from './factories';
import { ctx as routeCtx, GOLD, NOW, withSell } from './route-fixtures';

// ---------------------------------------------------------------------------
// The sell-or-continue scenario of task 13. Terminals come from the shared reference: B=2 (system 68),
// C=3 (68), D=4 (99), A=1, A2=5, 6 (all 68). Commodity: Gold=10.
//
//   cargo      Gold, 340 SCU, bought at 6120
//   player     stands at C (3); the test types in the real price there; 1200 s have passed
//   B          UEX SELL 6900 (week 6400–7100)
//   C          own warm SELL 6840, old news: the real price replaces it, and C is never an alternative
//   D          UEX SELL 9000 (other system, cut by the system filter)
//   distances  C–B 10 Gm
// ---------------------------------------------------------------------------

const weekStats = (price: number, low = price, high = price): Partial<UexSideStats> => (
  { last: price, avgWeek: price, minWeek: low, maxWeek: high }
);

export const line: CargoLine = { commodityId: GOLD, scu: 340, avgBuyPrice: 6120 };

export const sellMarket: Market = buildMarket(
  [
    px(2, GOLD, { sell: weekStats(6900, 6400, 7100), dateModified: NOW - 3600 }),
    px(4, GOLD, { sell: weekStats(9000), dateModified: NOW - 3600 }),
  ],
  [obs({ id: 1, ts: NOW - 120 * 60, terminalId: 3, commodityId: GOLD, side: 'sell', price: 6840, scu: null })],
);

export const sellCtx: RouteCtx = { ...routeCtx, distances: new Map<string, number | null>([[distKey(3, 2), 10]]) };

/**
 * Copy of the market where terminals 1, 5 and 6 also buy Gold, each paying more than B (6900).
 * With only the C–B distance known, B is the one alternative that has a flight time.
 */
export function withManySellers(m: Market): Market {
  return withSell(withSell(withSell(m, 1, 7200), 5, 7100), 6, 7000);
}

/** Copy of the market where `terminalId` can take only `scu` more of Gold (the UEX SELL-side quantity). */
export function withDemand(m: Market, terminalId: number, scu: number, commodityId = GOLD): Market {
  const key = priceKey(terminalId, commodityId);
  const prices = new Map(m.uex);
  prices.set(key, { ...(m.uex.get(key) ?? px(terminalId, commodityId, { dateModified: NOW - 3600 })), scuSell: scu });
  return buildMarket([...prices.values()], [...m.own.values()]);
}
