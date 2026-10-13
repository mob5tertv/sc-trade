import { describe, expect, it } from 'vitest';
import { fillHold, pairGoods } from '../../src/core/pair';
import type { PairGood } from '../../src/core/pair';
import type { Estimate } from '../../src/core/types';
import { ctx, GOLD, market, withBuy, withSell } from '../helpers/route-fixtures';

// The route scenario of route-fixtures.ts: A (1) sells Gold at my hot price 6120, stock 340; B (2) buys it at UEX 6900
// (6400–7100); C (3) at my 6840. Titanium (20) is added where a test needs a second commodity.
const TITA = 20;

/** A (1) also sells Titanium at UEX 2500 (no stock known) and B (2) buys it at 3000. */
const withTitanium = withSell(withBuy(market, 1, { last: 2500, avgWeek: 2500, minWeek: 2500, maxWeek: 2500 }, TITA), 2, 3000, TITA);

describe('pairGoods', () => {
  it('lists what the origin sells and the destination buys for more, with what a SCU brings', () => {
    const goods = pairGoods(market, 1, 2, ctx);
    expect(goods).toHaveLength(1);
    expect(goods[0]).toMatchObject({ commodityId: GOLD, margin: 780, buy: { price: 6120, scu: 340 }, sell: { price: 6900 } });
    expect(goods[0].roi).toBeCloseTo(780 / 6120, 9);
  });

  it('puts the commodity that brings most per SCU first', () => {
    expect(pairGoods(withTitanium, 1, 2, ctx).map((g) => [g.commodityId, g.margin])).toEqual([[GOLD, 780], [TITA, 500]]);
  });

  it('leaves out what would not pay: the same price, a lower one, a purchase price nobody knows', () => {
    expect(pairGoods(withSell(market, 2, 6120), 1, 2, ctx)).toEqual([]);
    expect(pairGoods(withSell(market, 2, 6000), 1, 2, ctx)).toEqual([]);
    expect(pairGoods(market, 2, 1, ctx)).toEqual([]);                // B does not sell Gold to the player
  });

  it('has no goods for one terminal at both ends, nor for a terminal that trades nothing', () => {
    expect(pairGoods(market, 1, 1, ctx)).toEqual([]);
    expect(pairGoods(market, 6, 2, ctx)).toEqual([]);
  });

  it('does not ask which system the terminals are in: the player chose both ends himself', () => {
    expect(pairGoods(market, 1, 4, ctx).map((g) => g.commodityId)).toEqual([GOLD]);   // D (4) is in another system than the filter of ctx
  });
});

const price = (p: number, scu: number | null): Estimate => ({
  price: p, low: p, high: p, source: 'uex', temp: null, ageSec: 0, ageKnown: true, ownLast: null, uexRange: null,
  scu, scuOrigin: scu === null ? null : 'uex', stock: null, prev: null,
});
/** A commodity bought at `buy` with `stock` SCU there and sold `margin` higher. */
const good = (commodityId: number, buy: number, margin: number, stock: number | null): PairGood => (
  { commodityId, buy: price(buy, stock), sell: price(buy + margin, null), margin, roi: margin / buy }
);

describe('fillHold', () => {
  it('takes the best commodity up to its stock and fills the rest with the next one', () => {
    const fill = fillHold(pairGoods(withTitanium, 1, 2, ctx), 696, null);
    expect(fill.picks).toEqual([
      { commodityId: GOLD, scu: 340, invested: 340 * 6120, profit: 340 * 780, limit: 'stock', stockKnown: true },
      { commodityId: TITA, scu: 356, invested: 356 * 2500, profit: 356 * 500, limit: 'space', stockKnown: false },
    ]);
    expect(fill).toMatchObject({ scu: 696, invested: 340 * 6120 + 356 * 2500, profit: 340 * 780 + 356 * 500, short: null });
    expect(fill.roi).toBeCloseTo(fill.profit / fill.invested, 9);
  });

  it('says the stock ran out when the goods of the pair do not fill the hold', () => {
    expect(fillHold(pairGoods(market, 1, 2, ctx), 696, null)).toMatchObject({ scu: 340, short: 'stock' });
  });

  it('stops at the money, and says so', () => {
    const fill = fillHold(pairGoods(market, 1, 2, ctx), 696, 1_000_000);
    expect(fill.picks).toEqual([{ commodityId: GOLD, scu: 163, invested: 163 * 6120, profit: 163 * 780, limit: 'budget', stockKnown: true }]);
    expect(fill.short).toBe('budget');
  });

  it('takes the goods whose stock is known before one counted on a stock nobody knows, whatever it would bring', () => {
    const fill = fillHold([good(1, 1000, 900, null), good(2, 1000, 100, 300)], 500, null);
    expect(fill.picks.map((p) => [p.commodityId, p.scu, p.stockKnown])).toEqual([[2, 300, true], [1, 200, false]]);
  });

  it('with a budget that runs out before the hold, prefers what brings most per UEC', () => {
    // 100 SCU of room and 10 000 UEC: the dear commodity brings more per SCU, but the money buys only 10 of it
    const dear = good(1, 1000, 100, 1000);
    const cheap = good(2, 100, 30, 1000);
    const fill = fillHold([dear, cheap], 100, 10_000);
    expect(fill.picks).toEqual([{ commodityId: 2, scu: 100, invested: 10_000, profit: 3000, limit: 'space', stockKnown: true }]);
    // without a budget the hold is what runs out, and the dear one is right
    expect(fillHold([dear, cheap], 100, null).picks[0]).toMatchObject({ commodityId: 1, scu: 100, profit: 10_000 });
  });

  it('skips a commodity that is known to be out of stock, and takes nothing into a hold that has no room', () => {
    expect(fillHold([good(1, 1000, 100, 0), good(2, 1000, 50, 80)], 100, null).picks.map((p) => p.commodityId)).toEqual([2]);
    expect(fillHold([good(1, 1000, 100, 50)], 0, null)).toMatchObject({ picks: [], scu: 0, roi: null, short: null });
    expect(fillHold([], 100, null)).toMatchObject({ picks: [], short: null });
  });

  it('never takes a fraction of a SCU', () => {
    expect(fillHold([good(1, 300, 100, 10.7)], 100.9, 1000).picks[0]).toMatchObject({ scu: 3, limit: 'budget' });
  });
});
