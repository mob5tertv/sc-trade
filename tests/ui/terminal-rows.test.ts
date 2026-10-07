import { describe, expect, it } from 'vitest';
import { badgeText, cellScu, sideCounts, terminalRows } from '../../src/ui/vm/terminal-rows';
import { buildMarket } from '../../src/core/market';
import { obsKey } from '../../src/core/types';
import { obs, px, ref } from '../helpers/factories';
import { withOwnSellScu } from '../helpers/route-fixtures';
import { NOW, ctx, est, market, marketAfterPriceOnlyEdit, marketWithStock, withOwnBuy, withUexRange } from '../helpers/terminal-fixtures';

describe('terminalRows', () => {
  it('shows own values with a temperature badge and UEX values as hints', () => {
    const rows = terminalRows(market, ref, 1, ctx);       // terminal 1: Gold — own buy 6120/340 two minutes ago; Tungsten — UEX only 3980/410, an hour old
    expect(rows.map(r => r.code)).toEqual(['GOLD', 'TUNG']);
    expect(rows[0].buy).toEqual({
      own: 6120, ownScu: 340, ownScuBase: null, ownScuRate: 'none', hint: null, hintScu: null, badge: { text: 'моя · 2 мин', kind: 'hot' },
      uexRange: null, range: { low: 5900, high: 6200 }, ownLast: null, warn: false,
    });
    expect(rows[0].sell).toBeNull();
    expect(rows[1].buy).toEqual({
      own: null, ownScu: null, ownScuBase: null, ownScuRate: null, hint: 3980, hintScu: 410, badge: { text: 'UEX · 1 ч', kind: 'uex' },
      uexRange: null, range: null, ownLast: null, warn: false,
    });
  });

  it('gives the range UEX knows for a cell, next to my own price and to a UEX one alike', () => {
    // Gold: my own hot price 6120; the UEX week says 5900-6200
    expect(terminalRows(market, ref, 1, ctx)[0].buy?.range).toEqual({ low: 5900, high: 6200 });
    // the same range stands next to a hint, whether UEX or my cold value gave the price
    const cold = terminalRows(withOwnBuy(market, 1, 10, 6120, NOW - 5 * 3600), ref, 1, ctx)[0].buy;
    expect(cold).toMatchObject({ own: null, hint: 6000, range: { low: 5900, high: 6200 } });
  });

  it('has no range when UEX has none: a flat price, no statistics, or no UEX row at all', () => {
    const flat = terminalRows(market, ref, 1, ctx)[1].buy; // Tungsten: 3980 flat
    expect(flat?.range).toBeNull();
    const noStats = buildMarket([px(1, 10, { buy: { avgWeek: 6500 } })], []); // the week has an average but no bounds
    expect(terminalRows(noStats, ref, 1, ctx)[0].buy?.range).toBeNull();
    const ownOnly = buildMarket([], [obs({ ts: NOW - 60, terminalId: 1, commodityId: 10, side: 'buy', price: 6100 })]);
    expect(terminalRows(ownOnly, ref, 1, ctx)[0].buy?.range).toBeNull();
  });

  it('takes the range of the side the cell is on', () => {
    const m = buildMarket([px(1, 10, { buy: { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 }, sell: { avgWeek: 6500, minWeek: 6300, maxWeek: 6900 } })], []);
    const [row] = terminalRows(m, ref, 1, ctx);
    expect(row.buy?.range).toEqual({ low: 5900, high: 6200 });
    expect(row.sell?.range).toEqual({ low: 6300, high: 6900 });
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
      badge: { text: 'UEX · 1 ч', kind: 'uex' }, uexRange: null, range: { low: 5900, high: 6200 }, ownLast: { price: 6120, age: '5 ч' }, warn: false,
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
      uexRange: null, range: null, ownLast: null, warn: false,
    });
  });

  it('keeps a cold own value as a grey hint when UEX has nothing for it', () => {
    const m = buildMarket([], [obs({ ts: NOW - 5 * 3600, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: 340 })]);
    expect(terminalRows(m, ref, 1, ctx)[0].buy).toEqual({
      own: null, ownScu: null, ownScuBase: null, ownScuRate: null, hint: 6120, hintScu: null, badge: { text: 'моя · 5 ч', kind: 'cold' },
      uexRange: null, range: null, ownLast: null, warn: false,
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
