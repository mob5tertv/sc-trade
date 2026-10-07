import { buildMarket } from '../../src/core/market';
import type { RouteCtx } from '../../src/core/routes';
import { distKey, obsKey, priceKey } from '../../src/core/types';
import type { Market, UexSideStats } from '../../src/core/types';
import { obs, px, ref } from './factories';
import { previousOf } from './previous-price-fixtures';
import { quantitiesOf, readingsOf } from './quantity-fixtures';

// ---------------------------------------------------------------------------
// The route scenario of task 8. Terminals come from the shared reference: A=1 (system 68, planet 10),
// B=2 (68, 20), C=3 (68, 20), D=4 (99, 30), A2=5 (68, 10), 6 (68, 40). Commodity: Gold=10.
//
//   A  own hot BUY 6120, stock 340
//   B  UEX SELL 6900 (week 6400–7100)
//   C  own warm SELL 6840 (the quantity on a SELL side is the buyer's inventory, not demand: spec 14.5)
//   D  UEX SELL 9000 (other system)
//   distances: A–B 59 Gm, A–C 61 Gm
// ---------------------------------------------------------------------------

export const GOLD = 10;
export const NOW = 1_000_000;

const weekStats = (price: number, low = price, high = price): Partial<UexSideStats> => (
  { last: price, avgWeek: price, minWeek: low, maxWeek: high }
);

export const market: Market = buildMarket(
  [
    px(2, GOLD, { sell: weekStats(6900, 6400, 7100), dateModified: NOW - 3600 }),
    px(4, GOLD, { sell: weekStats(9000), dateModified: NOW - 3600 }),
  ],
  [
    obs({ id: 1, ts: NOW - 10 * 60, terminalId: 1, commodityId: GOLD, side: 'buy', price: 6120, scu: 340 }),
    obs({ id: 2, ts: NOW - 120 * 60, terminalId: 3, commodityId: GOLD, side: 'sell', price: 6840, scu: null }),
  ],
);

export const ctx: RouteCtx = {
  now: NOW,
  thresholds: { hotMin: 60, warmMin: 180, coolingMin: 240 },
  serverChangedAt: null,
  settings: { starSystemId: 68, budget: null, quantumSpeedKkms: 200, overheadMin: 12, overheadEmptyMin: 5, topN: 5, sort: 'uecPerHour' },
  freeScu: 696,
  terminals: ref.terminals,
  distances: new Map<string, number | null>([[distKey(1, 2), 59], [distKey(1, 3), 61]]),
  ownMedian: new Map<string, number>(),
};

/** Copy of the market where `terminalId` buys Gold from the player at `price` (UEX SELL side, week range = price). */
export function withSell(m: Market, terminalId: number, price: number, commodityId = GOLD): Market {
  const row = m.uex.get(priceKey(terminalId, commodityId)) ?? px(terminalId, commodityId, { dateModified: NOW - 3600 });
  const next = { ...row, sell: { ...row.sell, ...weekStats(price) } };
  return rebuild(m, priceKey(terminalId, commodityId), next);
}

/** Copy of the market where `terminalId` sells Gold to the player with the given UEX BUY-side statistics. */
export function withBuy(m: Market, terminalId: number, stats: Partial<UexSideStats>, commodityId = GOLD): Market {
  const row = m.uex.get(priceKey(terminalId, commodityId)) ?? px(terminalId, commodityId, { dateModified: NOW - 3600 });
  const next = { ...row, buy: { ...row.buy, ...stats } };
  return rebuild(m, priceKey(terminalId, commodityId), next);
}

/**
 * Copy of the market where the inventory the buyer shows on its SELL side (spec 14.5) is `scu` as the UEX row
 * reports it. A zero there means "unknown" for UEX, so it is also the way to put a row without a quantity.
 */
export function withUexSellScu(m: Market, terminalId: number, commodityId: number, scu: number): Market {
  const key = priceKey(terminalId, commodityId);
  const row = m.uex.get(key) ?? px(terminalId, commodityId, { dateModified: NOW - 3600 });
  return rebuild(m, key, { ...row, scuSell: scu });
}

/** The price of a made-up observation when neither the diary nor UEX knows one. */
const SELL_PRICE_WITHOUT_ANY = 1000;

/**
 * Copy of the market where my own SELL observation at the terminal records `scu` as the buyer's inventory
 * (0 is "out of stock", a known zero). An existing observation keeps its price and time; when there is none,
 * a fresh one (two minutes old, so hot) is made at the UEX weekly SELL price, or `price` when given.
 */
export function withOwnSellScu(m: Market, terminalId: number, commodityId: number, scu: number | null, price?: number): Market {
  const key = obsKey(terminalId, commodityId, 'sell');
  const known = m.own.get(key);
  const uexPrice = m.uex.get(priceKey(terminalId, commodityId))?.sell.avgWeek;
  const next = known
    ? { ...known, scu }
    : obs({ id: 1000, ts: NOW - 120, terminalId, commodityId, side: 'sell', price: price ?? (uexPrice || SELL_PRICE_WITHOUT_ANY), scu });
  const others = [...m.own].filter(([k]) => k !== key).map(([, o]) => o);
  return buildMarket([...m.uex.values()], [...others, next], m.stock, [...quantitiesOf(m, key), ...readingsOf(next)], previousOf(m));
}

function rebuild(m: Market, key: string, row: ReturnType<typeof px>): Market {
  const prices = new Map(m.uex);
  prices.set(key, row);
  return buildMarket([...prices.values()], [...m.own.values()], undefined, quantitiesOf(m), previousOf(m));
}
