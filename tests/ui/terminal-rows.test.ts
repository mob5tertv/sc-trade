import { describe, expect, it } from 'vitest';
import {
  badgeText, cellScu, isOwnPrice, rangeOfEstimate, rangeView, sideCounts, terminalRows, uexRangeOf, unknownScuTitle,
} from '../../src/ui/vm/terminal-rows';
import { buildMarket } from '../../src/core/market';
import { obsKey } from '../../src/core/types';
import type { UexSideStats } from '../../src/core/types';
import { obs, px, ref } from '../helpers/factories';
import { SEVEN_DIGITS, rangeMarket } from '../helpers/flat-range-fixtures';
import { withOwnSellScu } from '../helpers/route-fixtures';
import { NOW, ctx, est, market, marketAfterPriceOnlyEdit, marketWithStock, withOwnBuy, withUexRange } from '../helpers/terminal-fixtures';

// formatUec separates thousands with a non-breaking space
const nb = (s: string) => s.replace(/ /g, String.fromCharCode(0xa0));
/** The three things the «Мин–макс» cell can hold. */
const SPREAD = { kind: 'spread', low: 5900, high: 6200 } as const;
const NONE = { kind: 'none' } as const;
const NO_BOUNDS = { kind: 'no-bounds' } as const;

describe('terminalRows', () => {
  it('shows own values with a temperature badge and UEX values as hints', () => {
    const rows = terminalRows(market, ref, 1, ctx);       // terminal 1: Gold — own buy 6120/340 two minutes ago; Tungsten — UEX only 3980/410, an hour old
    expect(rows.map(r => r.code)).toEqual(['GOLD', 'TUNG']);
    expect(rows[0].buy).toEqual({
      own: 6120, ownScu: 340, ownScuBase: null, ownScuRate: 'none', hint: null, hintScu: null, badge: { text: 'моя · 2 мин', kind: 'hot' },
      uexRange: null, range: SPREAD, ownLast: null, trend: null, warn: false,
    });
    expect(rows[0].sell).toBeNull();
    expect(rows[1].buy).toEqual({
      own: null, ownScu: null, ownScuBase: null, ownScuRate: null, hint: 3980, hintScu: 410, badge: { text: 'UEX · 1 ч', kind: 'uex' },
      uexRange: null, range: { kind: 'flat', price: 3980 }, ownLast: null, trend: null, warn: false,
    });
  });

  it('gives the range UEX knows for a cell, next to my own price and to a UEX one alike', () => {
    // Gold: my own hot price 6120; the UEX week says 5900-6200
    expect(terminalRows(market, ref, 1, ctx)[0].buy?.range).toEqual(SPREAD);
    // the same range stands next to a hint, whether UEX or my cold value gave the price
    const cold = terminalRows(withOwnBuy(market, 1, 10, 6120, NOW - 5 * 3600), ref, 1, ctx)[0].buy;
    expect(cold).toMatchObject({ own: null, hint: 6000, range: SPREAD });
  });

  it('has no range when UEX has no price for the side, or has one without bounds', () => {
    const noStats = buildMarket([px(1, 10, { buy: { avgWeek: 6500 } })], []); // the week has an average but no bounds
    expect(terminalRows(noStats, ref, 1, ctx)[0].buy?.range).toEqual(NO_BOUNDS);
    const ownOnly = buildMarket([], [obs({ ts: NOW - 60, terminalId: 1, commodityId: 10, side: 'buy', price: 6100 })]);
    expect(terminalRows(ownOnly, ref, 1, ctx)[0].buy?.range).toEqual(NONE);
  });

  it('takes the range of the side the cell is on', () => {
    const m = buildMarket([px(1, 10, { buy: { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 }, sell: { avgWeek: 6500, minWeek: 6300, maxWeek: 6900 } })], []);
    const [row] = terminalRows(m, ref, 1, ctx);
    expect(row.buy?.range).toEqual(SPREAD);
    expect(row.sell?.range).toEqual({ kind: 'spread', low: 6300, high: 6900 });
  });

  it('shows the estimated stock with its base when the timer has moved it', () => {
    // my buy 6120, quantity 40, twenty minutes ago; the UEX maximum is 340; refillFullMin 75 → 130
    const rows = terminalRows(marketWithStock, ref, 1, ctx);
    expect(rows[0].buy).toMatchObject({ ownScu: 130, ownScuBase: { scu: 40, age: '20 мин' }, ownScuRate: 'default' });
  });

  it('keeps my stock estimate on screen after I correct only the price', () => {
    // quantity 40 twenty minutes ago, then an observation with only a price two minutes ago; UEX maximum 340, refill 75 min
    const rows = terminalRows(marketAfterPriceOnlyEdit, ref, 1, ctx);
    expect(rows[0].buy).toMatchObject({ own: 6120, ownScu: 130, ownScuBase: { scu: 40, age: '20 мин' } });
  });

  it('warns about a typo in a price-only correction without losing the stock estimate', () => {
    // a UEX history of 1000-2000 makes 6120 a typo; the quantity reading of twenty minutes ago is still there
    const typo = withUexRange(marketAfterPriceOnlyEdit, 1, 10, 1000, 2000);
    expect(terminalRows(typo, ref, 1, ctx)[0].buy).toMatchObject({ own: 6120, warn: true, ownScu: 130, ownScuBase: { scu: 40, age: '20 мин' } });
  });

  it('keeps the quantity of an earlier reading on the sell side after a price-only correction', () => {
    const m = buildMarket(
      [px(1, 10, { sell: { avgWeek: 6500 }, scuSell: 90, dateModified: NOW - 7200 })],
      [obs({ id: 2, ts: NOW - 60, terminalId: 1, commodityId: 10, side: 'sell', price: 6600, scu: null })],
      undefined,
      [{ terminalId: 1, commodityId: 10, side: 'sell', ts: NOW - 1200, scu: 3048 }],
    );
    expect(terminalRows(m, ref, 1, ctx)[0].sell).toMatchObject({ own: 6600, ownScu: 3048, ownScuBase: null, ownScuRate: null, hintScu: null });
  });

  it('shows my quantity next to a UEX price when my own price has gone cold but the quantity reading has not', () => {
    // the price was seen five hours ago, the quantity twenty minutes ago (the thresholds make that impossible in
    // practice, but the table must not rely on it): the price is the UEX hint, the quantity is still mine
    const m = buildMarket(
      [px(1, 10, { buy: { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 }, scuBuy: 410, scuBuyMax: 340, dateModified: NOW - 3600 })],
      [obs({ id: 2, ts: NOW - 5 * 3600, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: null })],
      undefined,
      [{ terminalId: 1, commodityId: 10, side: 'buy', ts: NOW - 20 * 60, scu: 40 }],
    );
    expect(terminalRows(m, ref, 1, ctx)[0].buy).toEqual({
      own: null, ownScu: 130, ownScuBase: { scu: 40, age: '20 мин' }, ownScuRate: 'default', hint: 6000, hintScu: null,
      badge: { text: 'UEX · 1 ч', kind: 'uex' }, uexRange: null, range: SPREAD, ownLast: { price: 6120, age: '5 ч' }, trend: null, warn: false,
    });
  });

  it('shows no base when the estimate equals what I saw', () => {
    expect(terminalRows(market, ref, 1, ctx)[0].buy).toMatchObject({ ownScu: 340, ownScuBase: null });
  });

  it('follows the full-refill time of the context and a rate learned from my diary', () => {
    expect(terminalRows(marketWithStock, ref, 1, { ...ctx, refillFullMin: 170 })[0].buy)         // 340 / 170 = 2 per minute
      .toMatchObject({ ownScu: 80, ownScuBase: { scu: 40, age: '20 мин' }, ownScuRate: 'default' });
    const learned = buildMarket([...marketWithStock.uex.values()], [...marketWithStock.own.values()], new Map([[obsKey(1, 10, 'buy'), { maxScu: 340, ratePerMin: 5 }]]));
    expect(terminalRows(learned, ref, 1, ctx)[0].buy).toMatchObject({ ownScu: 140, ownScuBase: { scu: 40, age: '20 мин' }, ownScuRate: 'learned' });
  });

  it('shows a known empty stock as zero, with a base once it has refilled', () => {
    const empty = (ageMin: number) => terminalRows(withOwnBuy(marketWithStock, 1, 10, 6120, NOW - ageMin * 60, 0), ref, 1, ctx)[0].buy;
    expect(empty(0)).toMatchObject({ own: 6120, ownScu: 0, ownScuBase: null, hintScu: null });
    expect(empty(10)).toMatchObject({ ownScu: 45, ownScuBase: { scu: 0, age: '10 мин' } });      // 340 / 75 × 10
  });

  it('shows the buyer inventory on the sell side without an estimate', () => {
    const rows = terminalRows(withOwnSellScu(market, 1, 10, 3048), ref, 1, ctx);
    expect(rows.find(r => r.commodityId === 10)!.sell).toMatchObject({ ownScu: 3048, ownScuBase: null, ownScuRate: null });
  });

  it('shows an empty buyer as 0 and never moves the recorded inventory with the refill timer', () => {
    const sellOf = (scu: number | null) => terminalRows(
      buildMarket(
        [px(1, 10, { sell: { avgWeek: 6500 }, scuSell: 90, scuSellMax: 4000, dateModified: NOW - 7200 })],
        [obs({ ts: NOW - 20 * 60, terminalId: 1, commodityId: 10, side: 'sell', price: 6600, scu })],
      ), ref, 1, ctx,
    )[0].sell;
    // twenty minutes old, a maximum of 4000 known: the buy side would have moved it, the sell side keeps what was recorded
    expect(sellOf(0)).toMatchObject({ own: 6600, ownScu: 0, ownScuBase: null, ownScuRate: null, hintScu: null });
    expect(sellOf(100)).toMatchObject({ own: 6600, ownScu: 100, ownScuBase: null, ownScuRate: null, hintScu: null });
    // no quantity recorded: the UEX one stays a grey hint, never my own
    expect(sellOf(null)).toMatchObject({ own: 6600, ownScu: null, ownScuBase: null, ownScuRate: null, hintScu: 90 });
  });

  it('demotes a cold own value to a hint', () => {
    const rows = terminalRows(withOwnBuy(market, 1, 10, 6120, NOW - 5 * 3600), ref, 1, ctx);
    expect(rows[0].buy).toMatchObject({ own: null, hint: 6000, badge: { text: 'UEX · 1 ч', kind: 'uex' } });
  });

  it('keeps a cold own value as a reference next to the UEX hint', () => {
    const rows = terminalRows(withOwnBuy(market, 1, 10, 6120, NOW - 5 * 3600), ref, 1, ctx);
    expect(rows[0].buy).toMatchObject({ own: null, hint: 6000, ownLast: { price: 6120, age: '5 ч' }, uexRange: null });
  });

  it('shows the UEX range next to a cooling own value', () => {
    const rows = terminalRows(withOwnBuy(market, 1, 10, 6120, NOW - 200 * 60), ref, 1, ctx);
    expect(rows[0].buy).toMatchObject({ own: 6120, hint: null, badge: { text: 'моя · 3 ч', kind: 'cooling' }, uexRange: { low: 5900, high: 6200 }, ownLast: null });
  });

  it('flags a likely typo', () => {
    const rows = terminalRows(withOwnBuy(withUexRange(market, 1, 10, 5000, 7000), 1, 10, 61200, NOW - 60), ref, 1, ctx);
    expect(rows[0].buy!.warn).toBe(true);
  });

  it('lists a commodity known only from my diary', () => {
    expect(terminalRows(withOwnBuy(market, 1, 20, 300, NOW - 60), ref, 1, ctx).map(r => r.commodityId)).toContain(20);
  });

  it('skips commodities missing from the reference', () => {
    expect(terminalRows(withOwnBuy(market, 1, 999, 300, NOW - 60), ref, 1, ctx).some(r => r.commodityId === 999)).toBe(false);
  });

  it('skips a commodity with nothing to show on either side', () => {
    const m = buildMarket([px(1, 10), px(1, 30, { buy: { avgWeek: 100 } })], []);
    expect(terminalRows(m, ref, 1, ctx).map(r => r.commodityId)).toEqual([30]);
    expect(terminalRows(buildMarket([px(1, 10)], []), ref, 1, ctx)).toEqual([]);
  });

  it('badgeText', () => {
    expect(badgeText({ ...est, source: 'own', temp: 'cooling', ageSec: 12600 })).toEqual({ text: 'моя · 3,5 ч', kind: 'cooling' });
    expect(badgeText({ ...est, source: 'own', temp: 'cold', ageSec: 18000 })).toEqual({ text: 'моя · 5 ч', kind: 'cold' });
  });

  it('badgeText for a UEX estimate carries its age, unless the age is unknown', () => {
    expect(badgeText({ ...est, source: 'uex', temp: null, ageSec: 7200 })).toEqual({ text: 'UEX · 2 ч', kind: 'uex' });
    expect(badgeText({ ...est, source: 'uex', temp: null, ageSec: 7200, ageKnown: false })).toEqual({ text: 'UEX', kind: 'uex' });
  });

  it('labels a UEX price of unknown age without an age', () => {
    expect(badgeText({ ...est, source: 'uex', temp: null, ageKnown: false })).toEqual({ text: 'UEX', kind: 'uex' });
  });

  it('labels a UEX row of unknown age (dateModified 0) with a plain UEX badge', () => {
    const m = buildMarket([px(1, 10, { buy: { avgWeek: 6000 } })], []);
    expect(terminalRows(m, ref, 1, ctx)[0].buy!.badge).toEqual({ text: 'UEX', kind: 'uex' });
  });

  it('is empty for a terminal nothing is known about', () => {
    expect(terminalRows(market, ref, 2, ctx)).toEqual([]);
  });

  it('sorts rows by commodity name', () => {
    const m = buildMarket(
      [px(1, 30, { buy: { avgWeek: 100 } }), px(1, 10, { buy: { avgWeek: 100 } })],
      [obs({ ts: NOW - 60, terminalId: 1, commodityId: 20, side: 'buy', price: 300 })],
    );
    expect(terminalRows(m, ref, 1, ctx).map(r => r.name)).toEqual(['Gold', 'Titanium', 'Tungsten']);
  });

  it('puts both sides of a commodity on one row', () => {
    const m = buildMarket(
      [px(1, 10, { buy: { avgWeek: 6000 }, sell: { avgWeek: 6500 }, scuSell: 90, dateModified: NOW - 7200 })],
      [obs({ ts: NOW - 60, terminalId: 1, commodityId: 10, side: 'buy', price: 6100, scu: 200 })],
    );
    const [row] = terminalRows(m, ref, 1, ctx);
    expect(row.buy).toMatchObject({ own: 6100, ownScu: 200 });
    expect(row.sell).toEqual({
      own: null, ownScu: null, ownScuBase: null, ownScuRate: null, hint: 6500, hintScu: 90, badge: { text: 'UEX · 2 ч', kind: 'uex' },
      uexRange: null, range: NO_BOUNDS, ownLast: null, trend: null, warn: false,
    });
  });

  it('keeps a cold own value as a grey hint when UEX has nothing for it', () => {
    const m = buildMarket([], [obs({ ts: NOW - 5 * 3600, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: 340 })]);
    expect(terminalRows(m, ref, 1, ctx)[0].buy).toEqual({
      own: null, ownScu: null, ownScuBase: null, ownScuRate: null, hint: 6120, hintScu: null, badge: { text: 'моя · 5 ч', kind: 'cold' },
      uexRange: null, range: NONE, ownLast: null, trend: null, warn: false,
    });
  });

  it('never presents the UEX quantity as my own', () => {
    const uex = [px(1, 10, { buy: { avgWeek: 6000 }, scuBuy: 410 })];
    const ownScuOf = (scu: number | null) => terminalRows(
      buildMarket(uex, [obs({ ts: NOW - 60, terminalId: 1, commodityId: 10, side: 'buy', price: 6100, scu })]), ref, 1, ctx,
    )[0].buy;
    expect(ownScuOf(null)).toMatchObject({ own: 6100, ownScu: null, hint: null, hintScu: 410 });
    // my own zero is a known empty stock now, shown as 0 (it used to fall through to the UEX quantity)
    expect(ownScuOf(0)).toMatchObject({ own: 6100, ownScu: 0, hint: null, hintScu: null });
    expect(ownScuOf(340)).toMatchObject({ own: 6100, ownScu: 340, hint: null, hintScu: null });
  });

  it('warns on the bounds of the cell\'s own side and never on a hint', () => {
    const base = buildMarket(
      [px(1, 10, { buy: { avgWeek: 6000, min: 5000, max: 7000 }, sell: { avgWeek: 6500, min: 6000, max: 7000 } })],
      [obs({ ts: NOW - 60, terminalId: 1, commodityId: 10, side: 'sell', price: 6800 })],
    );
    expect(terminalRows(base, ref, 1, ctx)[0].sell!.warn).toBe(false);
    expect(terminalRows(withUexRange(base, 1, 10, 6000, 7000, 'buy'), ref, 1, ctx)[0].sell!.warn).toBe(false);
    expect(terminalRows(withUexRange(base, 1, 10, 100, 300, 'sell'), ref, 1, ctx)[0].sell!.warn).toBe(true);
    // a wild UEX-derived hint is only a hint: nothing to warn about
    expect(terminalRows(withUexRange(market, 1, 30, 10, 20), ref, 1, ctx)[1].buy).toMatchObject({ own: null, warn: false });
  });
});

describe('uexRangeOf', () => {
  it('is no-bounds when UEX has a price for the side and no usable bounds for it, beside my own price too', () => {
    const m = buildMarket([px(1, 10, { buy: { avgWeek: 6500 } })], [obs({ ts: NOW - 60, terminalId: 1, commodityId: 10, side: 'buy', price: 6100 })]);
    expect(uexRangeOf(m, 1, 10, 'buy', ctx)).toEqual(NO_BOUNDS);
  });

  it('is the range UEX knows for a side of a terminal, whatever my diary says there', () => {
    expect(uexRangeOf(market, 1, 10, 'buy', ctx)).toEqual(SPREAD); // Gold: my own hot price, UEX week 5900–6200
    expect(uexRangeOf(withOwnBuy(market, 1, 10, 6120, NOW - 5 * 3600), 1, 10, 'buy', ctx)).toEqual(SPREAD);
  });

  it('is the one price UEX knows when it gives the same number as minimum and maximum', () => {
    expect(uexRangeOf(market, 1, 30, 'buy', ctx)).toEqual({ kind: 'flat', price: 3980 }); // Tungsten 3980 flat
  });

  it('is none for a side UEX knows nothing about and for a place without a UEX row', () => {
    expect(uexRangeOf(market, 1, 10, 'sell', ctx)).toEqual(NONE); // nobody buys Gold here according to UEX
    expect(uexRangeOf(market, 4, 10, 'buy', ctx)).toEqual(NONE); // no row for terminal 4
  });
});

describe('the «Мин–макс» cell: a spread, one price, or nothing', () => {
  // UEX gave min = max = price for the week, the month and all time (a terminal like CBD Lorville: every row of it)
  const sellOf = (commodityId: number) => terminalRows(rangeMarket, ref, 1, ctx).find((r) => r.commodityId === commodityId)?.sell;
  const buyOf = (commodityId: number) => terminalRows(rangeMarket, ref, 1, ctx).find((r) => r.commodityId === commodityId)?.buy;

  it('tells a price that moved from a price UEX knows as one number from a price UEX does not know', () => {
    expect(sellOf(10)?.range).toEqual({ kind: 'spread', low: 6300, high: 6900 });
    expect(sellOf(20)?.range).toEqual({ kind: 'flat', price: 5500 });
    expect(buyOf(10)?.range).toEqual(NONE); // my own hot price, and UEX has nothing about buying Gold here
  });

  it('gives the price itself for a flat range, whatever the size of the number', () => {
    expect(sellOf(30)).toMatchObject({ hint: SEVEN_DIGITS, range: { kind: 'flat', price: SEVEN_DIGITS } });
  });

  it('follows the order of the estimate: the week decides, the month is not looked at while the week has a price', () => {
    // Titanium, buy: week 31 000-31 000, month 30 000-31 000
    expect(buyOf(20)?.range).toEqual({ kind: 'flat', price: 31_000 });
  });

  it('falls back to the month, then to all time, then to the last price, as the estimate does', () => {
    const rangeOf = (buy: Partial<UexSideStats>) => terminalRows(buildMarket([px(1, 10, { buy })], []), ref, 1, ctx)[0].buy?.range;
    expect(rangeOf({ avgMonth: 4000, minMonth: 3800, maxMonth: 4200 })).toEqual({ kind: 'spread', low: 3800, high: 4200 });
    expect(rangeOf({ avgMonth: 4000, minMonth: 4000, maxMonth: 4000 })).toEqual({ kind: 'flat', price: 4000 });
    expect(rangeOf({ avg: 4100, min: 4100, max: 4100 })).toEqual({ kind: 'flat', price: 4100 });
    expect(rangeOf({ last: 4300 })).toEqual({ kind: 'flat', price: 4300 }); // only the last report: one number
  });

  it('shows one price next to my own, as a reference from UEX', () => {
    const own = withOwnBuy(rangeMarket, 1, 20, 31_500, NOW - 60); // my hot price for Titanium; UEX says 31 000 and nothing else
    expect(terminalRows(own, ref, 1, ctx).find((r) => r.commodityId === 20)?.buy).toMatchObject({ own: 31_500, range: { kind: 'flat', price: 31_000 } });
  });

  it('does not take a price without usable bounds for one price: UEX gives a price and no bounds for it', () => {
    const rangeOf = (buy: Partial<UexSideStats>) => terminalRows(buildMarket([px(1, 10, { buy })], []), ref, 1, ctx)[0].buy?.range;
    expect(rangeOf({ avgWeek: 6500 })).toEqual(NO_BOUNDS); // an average and no bounds
    expect(rangeOf({ avgWeek: 6500, minWeek: 0, maxWeek: 6900 })).toEqual(NO_BOUNDS); // one bound missing
    expect(rangeOf({ avgWeek: 6500, minWeek: 7000, maxWeek: 6900 })).toEqual(NO_BOUNDS); // upside down
  });
});

describe('rangeOfEstimate', () => {
  const uexEstimate = (low: number, high: number) => ({ ...est, source: 'uex' as const, temp: null, price: 6000, low, high });

  it('is a spread when the bounds differ, one price when they are the same, no bounds when they are unusable, none without a UEX price', () => {
    expect(rangeOfEstimate(uexEstimate(5900, 6200))).toEqual(SPREAD);
    expect(rangeOfEstimate(uexEstimate(5500, 5500))).toEqual({ kind: 'flat', price: 5500 });
    expect(rangeOfEstimate(uexEstimate(0, 0))).toEqual(NO_BOUNDS);
    expect(rangeOfEstimate(uexEstimate(0, 6200))).toEqual(NO_BOUNDS);
    expect(rangeOfEstimate(uexEstimate(Number.NaN, Number.NaN))).toEqual(NO_BOUNDS);
    expect(rangeOfEstimate(null)).toEqual(NONE);
  });

  it('is none for a price of mine: it has no bounds of its own, the range of UEX is asked for apart', () => {
    expect(rangeOfEstimate({ ...est, source: 'own', temp: 'hot', price: 6120, low: 6120, high: 6120 })).toEqual(NONE);
  });
});

describe('rangeView', () => {
  it('writes a spread as low–high with the old tooltip', () => {
    expect(rangeView(SPREAD)).toEqual({ kind: 'spread', text: `${nb('5 900')}–${nb('6 200')}`, title: 'Диапазон цен по данным UEX' });
  });

  it('writes one price with a sign of equality and says that there is no spread', () => {
    expect(rangeView({ kind: 'flat', price: 5500 })).toEqual({ kind: 'flat', text: `= ${nb('5 500')}`, title: 'UEX: одна цена за период, разброса нет' });
  });

  it('writes a dash and says that UEX does not know the price when there is nothing', () => {
    expect(rangeView(NONE)).toEqual({ kind: 'none', text: '—', title: 'UEX не знает цену' });
  });

  it('writes the same dash but another tooltip when UEX has a price and gives no bounds for it', () => {
    expect(rangeView(NO_BOUNDS)).toEqual({ kind: 'no-bounds', text: '—', title: 'UEX не даёт границ цены' });
  });

  it('keeps a seven-digit price whole', () => {
    expect(rangeView({ kind: 'flat', price: SEVEN_DIGITS }).text).toBe(`= ${nb('1 300 000')}`);
  });
});

describe('sideCounts', () => {
  it('counts the rows that have each side: what can be bought here and what can be sold here', () => {
    const m = buildMarket(
      [
        px(1, 10, { buy: { avgWeek: 6000 }, dateModified: NOW - 3600 }),
        px(1, 20, { sell: { avgWeek: 9000 }, dateModified: NOW - 3600 }),
        px(1, 30, { buy: { avgWeek: 3000 }, sell: { avgWeek: 3500 }, dateModified: NOW - 3600 }),
      ],
      [],
    );
    expect(sideCounts(terminalRows(m, ref, 1, ctx))).toEqual({ buy: 2, sell: 2 });
  });

  it('counts a side that only my diary knows', () => {
    const m = buildMarket([], [obs({ ts: NOW - 60, terminalId: 1, commodityId: 10, side: 'sell', price: 6800 })]);
    expect(sideCounts(terminalRows(m, ref, 1, ctx))).toEqual({ buy: 0, sell: 1 });
  });

  it('is zero and zero without rows', () => {
    expect(sideCounts([])).toEqual({ buy: 0, sell: 0 });
  });
});

describe('cellScu', () => {
  const nb = (s: string) => s.replace(/ /g, String.fromCharCode(0xa0));
  const buyOf = (m: Parameters<typeof terminalRows>[0], index = 0) => terminalRows(m, ref, 1, ctx)[index].buy;

  it('shows the quantity I measured at the seller as my own', () => {
    expect(cellScu(buyOf(market), 'buy')).toEqual({ text: '340', own: true, estimated: false, title: 'Остаток у продавца по твоему замеру, SCU' });
  });

  it('shows a UEX quantity as a hint, not as mine', () => {
    expect(cellScu(buyOf(market, 1), 'buy')).toEqual({ text: '410', own: false, estimated: false, title: 'Остаток у продавца по данным UEX, SCU' });
  });

  it('shows the stock moved by the refill timer as an estimate and says so', () => {
    expect(cellScu(buyOf(marketWithStock), 'buy')).toEqual({
      text: '130', own: true, estimated: true, title: 'Оценка по таймеру пополнения: сколько там сейчас',
    });
  });

  it('groups thousands like every other number', () => {
    const m = buildMarket([px(1, 10, { buy: { avgWeek: 6000 }, scuBuy: 1245 })], []);
    expect(cellScu(buyOf(m), 'buy')?.text).toBe(nb('1 245'));
  });

  it('shows a known empty stock as 0', () => {
    const m = buildMarket([], [obs({ ts: NOW - 60, terminalId: 1, commodityId: 10, side: 'buy', price: 6100, scu: 0 })]);
    expect(cellScu(buyOf(m), 'buy')).toMatchObject({ text: '0', own: true });
  });

  it("shows the buyer's inventory on the sell side", () => {
    const m = buildMarket([px(1, 10, { sell: { avgWeek: 6500 }, scuSell: 90, dateModified: NOW - 7200 })], []);
    expect(cellScu(terminalRows(m, ref, 1, ctx)[0].sell, 'sell')).toEqual({
      text: '90', own: false, estimated: false, title: 'Склад у покупателя по данным UEX, SCU',
    });
  });

  it('takes the quantity of the side it is asked for, whatever the other side of the row holds', () => {
    const m = buildMarket(
      [px(1, 10, { buy: { avgWeek: 6000 }, sell: { avgWeek: 6500 }, scuBuy: 200, scuSell: 90, dateModified: NOW - 7200 })], [],
    );
    const [row] = terminalRows(m, ref, 1, ctx);
    expect(cellScu(row.buy, 'buy')?.text).toBe('200');
    expect(cellScu(row.sell, 'sell')?.text).toBe('90');
  });

  it('is null for a cell without a quantity, and for no cell', () => {
    const m = buildMarket([px(1, 10, { buy: { avgWeek: 6000 }, dateModified: NOW - 7200 })], []);
    expect(cellScu(buyOf(m), 'buy')).toBeNull();
    expect(cellScu(null, 'sell')).toBeNull();
  });
});

describe('unknownScuTitle: what the dash of the SCU column says', () => {
  it('says that the stock is unknown, and why: neither a measure of mine nor data of UEX', () => {
    expect(unknownScuTitle('buy')).toBe('Запас неизвестен: ни своего замера, ни данных UEX');
  });

  it('says the same of the buyer on the sell side, where the number is what the buyer already holds', () => {
    expect(unknownScuTitle('sell')).toBe('Склад у покупателя неизвестен: ни своего замера, ни данных UEX');
  });

  it('is for the dash only: a known zero is written 0 and keeps its own tooltip', () => {
    const m = buildMarket([], [obs({ ts: NOW - 60, terminalId: 1, commodityId: 10, side: 'buy', price: 6100, scu: 0 })]);
    expect(cellScu(terminalRows(m, ref, 1, ctx)[0].buy, 'buy')).toMatchObject({ text: '0', title: 'Остаток у продавца по твоему замеру, SCU' });
  });
});

describe('isOwnPrice', () => {
  it('is true for my own price while it is hot, warm or cooling', () => {
    for (const temp of ['hot', 'warm', 'cooling'] as const) expect(isOwnPrice({ ...est, source: 'own', temp }), temp).toBe(true);
  });

  it('is false for my cold price and for a UEX price', () => {
    expect(isOwnPrice({ ...est, source: 'own', temp: 'cold' })).toBe(false);
    expect(isOwnPrice({ ...est, source: 'uex', temp: null })).toBe(false);
  });
});

describe('terminalRows: how my own price moved since my previous reading', () => {
  const HOUR = 3600;
  const nbsp = (s: string) => s.replace(/ /g, String.fromCharCode(0xa0));
  const reading = (side: 'buy' | 'sell', price: number, agoSec: number) => ({ terminalId: 1, commodityId: 10, side, price, ts: NOW - agoSec });
  const mine = (side: 'buy' | 'sell', price: number, agoSec: number) => obs({ ts: NOW - agoSec, terminalId: 1, commodityId: 10, side, price });
  const uex = px(1, 10, { buy: { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 }, sell: { avgWeek: 6500 }, dateModified: NOW - 3600 });

  it('puts a trend on a price of mine that has a different previous reading: up where I buy is bad', () => {
    const m = buildMarket([uex], [mine('buy', 6120, 120)], undefined, undefined, [reading('buy', 6000, 3 * HOUR)]);
    expect(terminalRows(m, ref, 1, ctx)[0].buy?.trend).toEqual({ dir: 'up', good: false, title: `было ${nbsp('6 000')} · 3 ч назад (+120)` });
  });

  it('judges the sell side the other way round: up where I sell is good', () => {
    const m = buildMarket([uex], [mine('sell', 6600, 120)], undefined, undefined, [reading('sell', 6500, 3 * HOUR)]);
    expect(terminalRows(m, ref, 1, ctx)[0].sell?.trend).toEqual({ dir: 'up', good: true, title: `было ${nbsp('6 500')} · 3 ч назад (+100)` });
  });

  it('judges each side of one commodity on its own side', () => {
    // both prices fell: the buy price falling is good, the sell price falling is bad
    const m = buildMarket(
      [uex], [mine('buy', 6120, 120), mine('sell', 6600, 120)], undefined, undefined,
      [reading('buy', 6200, 3 * HOUR), reading('sell', 6700, 3 * HOUR)],
    );
    const [row] = terminalRows(m, ref, 1, ctx);
    expect(row.buy?.trend).toMatchObject({ dir: 'down', good: true });
    expect(row.sell?.trend).toMatchObject({ dir: 'down', good: false });
  });

  it('has no trend for a price of mine without a previous reading, or with the same price', () => {
    const single = buildMarket([uex], [mine('buy', 6120, 120)]);
    expect(terminalRows(single, ref, 1, ctx)[0].buy?.trend).toBeNull();
    const same = buildMarket([uex], [mine('buy', 6120, 120)], undefined, undefined, [reading('buy', 6120, 3 * HOUR)]);
    expect(terminalRows(same, ref, 1, ctx)[0].buy?.trend).toBeNull();
  });

  it('has no trend for a UEX price, nor for my own price that went cold and gave way to UEX', () => {
    expect(terminalRows(buildMarket([uex], []), ref, 1, ctx)[0].buy?.trend).toBeNull();
    const cold = buildMarket([uex], [mine('buy', 6120, 5 * HOUR)], undefined, undefined, [reading('buy', 6000, 8 * HOUR)]);
    expect(terminalRows(cold, ref, 1, ctx)[0].buy).toMatchObject({ own: null, hint: 6000, trend: null });
  });

  it('has no trend for my cold price kept only because UEX has no row', () => {
    const cold = buildMarket([], [mine('buy', 6120, 5 * HOUR)], undefined, undefined, [reading('buy', 6000, 8 * HOUR)]);
    expect(terminalRows(cold, ref, 1, ctx)[0].buy).toMatchObject({ own: null, hint: 6120, trend: null });
  });

  it('keeps the previous reading through the helpers that copy a market', () => {
    const m = buildMarket([uex], [mine('buy', 6120, 120)], undefined, undefined, [reading('buy', 6000, 3 * HOUR)]);
    expect(terminalRows(withUexRange(m, 1, 10, 1000, 9000), ref, 1, ctx)[0].buy?.trend).toMatchObject({ dir: 'up' });
    expect(terminalRows(withOwnBuy(m, 1, 10, 6120, NOW - 120), ref, 1, ctx)[0].buy?.trend).toMatchObject({ dir: 'up' });
  });
});
