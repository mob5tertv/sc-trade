import { buildMarket } from '../../src/core/market';
import type { EstimateCtx } from '../../src/core/estimate';
import { obsKey, priceKey } from '../../src/core/types';
import type { Estimate, Market, Side } from '../../src/core/types';
import { obs, px } from './factories';
import { quantitiesOf, readingsOf } from './quantity-fixtures';

// Fixtures for the terminal-rows view model. The shared `ref` (Gold 10, Titanium 20, Tungsten 30) comes from factories.ts.

export const NOW = 1_000_000;
export const ctx: EstimateCtx = { now: NOW, thresholds: { hotMin: 60, warmMin: 180, coolingMin: 240 }, serverChangedAt: null };

/** A throwaway estimate to spread over in `badgeText` tests. */
export const est: Estimate = {
  price: 0, low: 0, high: 0, source: 'own', temp: 'hot', ageSec: 0, ageKnown: true, ownLast: null, uexRange: null, scu: null, scuOrigin: null, stock: null,
};

/**
 * Terminal 1: Gold has my BUY price 6120 / 340 SCU from two minutes ago and a UEX buy row (week 6000, 5900-6200);
 * Tungsten has only a UEX buy row (3980 flat, 410 SCU). No sell data, no all-time UEX bounds.
 */
export const market: Market = buildMarket(
  [
    px(1, 10, { buy: { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 }, dateModified: NOW - 3600 }),
    px(1, 30, { buy: { avgWeek: 3980, minWeek: 3980, maxWeek: 3980 }, scuBuy: 410, dateModified: NOW - 3600 }),
  ],
  [obs({ id: 1, ts: NOW - 120, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: 340 })],
);

/**
 * Terminal 1: Gold has my BUY price 6120 with 40 SCU seen twenty minutes ago, and a UEX buy row whose largest
 * stock is 340 SCU. With the default full-refill time of 75 minutes that is 340 / 75 per minute: 130 SCU now.
 */
export const marketWithStock: Market = buildMarket(
  [px(1, 10, { buy: { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 }, scuBuyMax: 340, dateModified: NOW - 3600 })],
  [obs({ id: 1, ts: NOW - 20 * 60, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: 40 })],
);

/**
 * Terminal 1, Gold, BUY: my quantity reading of 40 SCU twenty minutes ago, then an observation with only a price
 * (6120, no quantity) two minutes ago; the UEX maximum is 340. The quantity has to survive the price-only
 * observation: with a full-refill time of 75 minutes that is 130 SCU now, counted from the 40.
 */
export const marketAfterPriceOnlyEdit: Market = buildMarket(
  [px(1, 10, { buy: { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 }, scuBuyMax: 340, dateModified: NOW - 3600 })],
  [obs({ id: 2, ts: NOW - 120, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: null })],
  undefined,
  [{ terminalId: 1, commodityId: 10, side: 'buy', ts: NOW - 20 * 60, scu: 40 }],
);

/**
 * A copy of `m` where the latest own BUY observation of the commodity at the terminal is replaced by this one, and
 * so is the quantity reading of that stock: the new one is the observation's quantity, none without one.
 */
export function withOwnBuy(m: Market, terminalId: number, commodityId: number, price: number, ts: number, scu: number | null = null): Market {
  const key = obsKey(terminalId, commodityId, 'buy');
  const others = [...m.own].filter(([k]) => k !== key).map(([, o]) => o);
  const next = obs({ id: 1000, ts, terminalId, commodityId, side: 'buy', price, scu });
  return buildMarket([...m.uex.values()], [...others, next], m.stock, [...quantitiesOf(m, key), ...readingsOf(next)]);
}

/** A copy of `m` where the UEX row's all-time min and max of one side are set (the row is created when missing). */
export function withUexRange(m: Market, terminalId: number, commodityId: number, min: number, max: number, side: Side = 'buy'): Market {
  const key = priceKey(terminalId, commodityId);
  const row = m.uex.get(key) ?? px(terminalId, commodityId);
  const uex = new Map(m.uex).set(key, { ...row, [side]: { ...row[side], min, max } });
  return buildMarket([...uex.values()], [...m.own.values()], m.stock, quantitiesOf(m));
}
