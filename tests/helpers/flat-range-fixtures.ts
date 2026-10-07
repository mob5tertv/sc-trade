import { buildMarket } from '../../src/core/market';
import type { Market, UexSideStats } from '../../src/core/types';
import { obs, px } from './factories';
import { NOW } from './terminal-fixtures';

// Fixtures for the three things the «Мин–макс» column can say about a price: a spread, one price (UEX gives the same
// number as minimum and maximum, for the week, the month and all time), or nothing. The shared `ref` of factories.ts
// has Gold 10, Titanium 20 and Tungsten 30; the terminal is 1.

export const SEVEN_DIGITS = 1_300_000;

/** UEX knows one price: the average, the minimum, the maximum and the last report are all the same number. */
export const flatStats = (price: number): Partial<UexSideStats> => ({
  last: price, avgWeek: price, minWeek: price, maxWeek: price, avgMonth: price, minMonth: price, maxMonth: price, avg: price, min: price, max: price,
});

/** UEX knows a price that moved between `low` and `high` in the week, the month and all time. */
export const spreadStats = (avg: number, low: number, high: number): Partial<UexSideStats> => ({
  last: avg, avgWeek: avg, minWeek: low, maxWeek: high, avgMonth: avg, minMonth: low, maxMonth: high, avg, min: low, max: high,
});

/**
 * Terminal 1 as UEX describes it:
 *  - Gold sells for 6500 (week 6300-6900), and nobody records my price on the other side: the sell side has a spread;
 *  - Titanium sells for 5500 with min = max = 5500 for the week, the month and all time: one price;
 *  - Tungsten sells for 1 300 000, one price too: seven digits;
 *  - Titanium is bought for 31 000 all week, but over the month it moved 30 000-31 000: the estimate takes the week,
 *    so what the table says is one price (the fallback order of src/core/estimate.ts, week first);
 *  - Gold is bought only at my own hot price of 6100: UEX has nothing about that side at all.
 */
export const rangeMarket: Market = buildMarket(
  [
    px(1, 10, { sell: spreadStats(6500, 6300, 6900), dateModified: NOW - 3600 }),
    px(1, 20, {
      sell: flatStats(5500),
      buy: { ...flatStats(31_000), avgMonth: 30_500, minMonth: 30_000, maxMonth: 31_000 },
      dateModified: NOW - 3600,
    }),
    px(1, 30, { sell: flatStats(SEVEN_DIGITS), dateModified: NOW - 3600 }),
  ],
  [obs({ id: 1, ts: NOW - 120, terminalId: 1, commodityId: 10, side: 'buy', price: 6100, scu: null })],
);
