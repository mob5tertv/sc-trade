import { describe, expect, it } from 'vitest';
import { estimate } from '../../src/core/estimate';
import { buildMarket } from '../../src/core/market';
import { obsKey } from '../../src/core/types';
import { obs, px } from '../helpers/factories';

// terminal 2, commodity 10, side sell
const th = { hotMin: 60, warmMin: 180, coolingMin: 240 };
const now = 1_000_000;
const week = { avgWeek: 6900, minWeek: 6400, maxWeek: 7100 };
const ctx = { now, thresholds: th, serverChangedAt: null };
const buyWeek = { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 };
const own = (ageMin: number, scu: number | null = 200) => obs({ ts: now - ageMin * 60, terminalId: 2, commodityId: 10, side: 'sell', price: 6840, scu });
const ownBuy = (ageMin: number, scu: number | null = 200) => obs({ ts: now - ageMin * 60, terminalId: 2, commodityId: 10, side: 'buy', price: 6100, scu });

describe('estimate', () => {
  it('uses a hot own price as is', () => {
    expect(estimate(buildMarket([px(2, 10, { sell: week, scuSell: 500 })], [own(10)]), 2, 10, 'sell', ctx))
      .toEqual({
        price: 6840, low: 6840, high: 6840, source: 'own', temp: 'hot', ageSec: 600, ownLast: null, uexRange: null, scu: 200,
        stock: null,
      });
  });

  it('keeps the timer estimate on a hot own buy price', () => {
    expect(estimate(buildMarket([px(2, 10, { buy: buyWeek })], [ownBuy(10)]), 2, 10, 'buy', ctx))
      .toEqual({
        price: 6100, low: 6100, high: 6100, source: 'own', temp: 'hot', ageSec: 600, ownLast: null, uexRange: null, scu: 200,
        stock: { scu: 200, baseScu: 200, baseAgeSec: 600, ratePerMin: 0, rateSource: 'none', maxScu: null },
      });
  });

  it('attaches the UEX range while cooling', () => {
    expect(estimate(buildMarket([px(2, 10, { sell: week })], [own(200)]), 2, 10, 'sell', ctx))
      .toMatchObject({ price: 6840, source: 'own', temp: 'cooling', uexRange: { low: 6400, high: 7100 } });
  });

  it('shows no UEX range while the own price is hot or warm', () => {
    const market = (ageMin: number) => buildMarket([px(2, 10, { sell: week })], [own(ageMin)]);
    expect(estimate(market(10), 2, 10, 'sell', ctx)!.uexRange).toBeNull();
    expect(estimate(market(100), 2, 10, 'sell', ctx)).toMatchObject({ source: 'own', temp: 'warm', uexRange: null });
  });

  it('has no UEX range to attach while cooling when UEX knows nothing', () => {
    expect(estimate(buildMarket([], [own(200)]), 2, 10, 'sell', ctx))
      .toMatchObject({ price: 6840, source: 'own', temp: 'cooling', uexRange: null });
  });

  it('falls back to UEX weekly stats when own is cold, keeping own for reference', () => {
    expect(estimate(buildMarket([px(2, 10, { sell: week })], [own(300)]), 2, 10, 'sell', ctx))
      .toMatchObject({ price: 6900, low: 6400, high: 7100, source: 'uex', temp: null, ownLast: { price: 6840, ageSec: 18000 } });
  });

  it('treats own data from before a server change as cold whatever its age', () => {
    const changed = { ...ctx, serverChangedAt: now - 300 };
    expect(estimate(buildMarket([px(2, 10, { sell: week })], [own(10)]), 2, 10, 'sell', changed))
      .toMatchObject({ price: 6900, source: 'uex', temp: null, ownLast: { price: 6840, ageSec: 600 } });
  });

  it.each([
    [{ avgMonth: 6800, minMonth: 6000, maxMonth: 7200 }, [6800, 6000, 7200]],
    [{ avg: 6500, min: 5000, max: 8000 }, [6500, 5000, 8000]],
    [{ last: 6300 }, [6300, 6300, 6300]],
  ])('falls back through month, all-time, last', (sell, [price, low, high]) => {
    expect(estimate(buildMarket([px(2, 10, { sell })], []), 2, 10, 'sell', ctx)).toMatchObject({ price, low, high, source: 'uex' });
  });

  it('prefers the week over coarser UEX periods', () => {
    const sell = { ...week, avgMonth: 6800, minMonth: 6000, maxMonth: 7200, avg: 6500, min: 5000, max: 8000, last: 6300 };
    expect(estimate(buildMarket([px(2, 10, { sell })], []), 2, 10, 'sell', ctx))
      .toMatchObject({ price: 6900, low: 6400, high: 7100 });
  });

  it('measures the age of a UEX estimate from the row modification time', () => {
    const row = px(2, 10, { sell: week, dateModified: now - 7200 });
    expect(estimate(buildMarket([row], []), 2, 10, 'sell', ctx))
      .toMatchObject({ source: 'uex', temp: null, ageSec: 7200, ownLast: null, uexRange: null });
  });

  it('returns null when nothing is known', () => {
    expect(estimate(buildMarket([px(2, 10)], []), 2, 10, 'sell', ctx)).toBeNull();
    expect(estimate(buildMarket([], []), 2, 10, 'sell', ctx)).toBeNull();
  });

  it('keeps the two sides apart', () => {
    expect(estimate(buildMarket([px(2, 10, { buy: { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 } })], [own(10)]), 2, 10, 'buy', ctx))
      .toMatchObject({ price: 6000, source: 'uex' });
    expect(estimate(buildMarket([], [own(10)]), 2, 10, 'buy', ctx)).toBeNull();
  });

  it('keeps a cold own price when UEX has no row', () => {
    expect(estimate(buildMarket([], [own(300)]), 2, 10, 'sell', ctx))
      .toMatchObject({ price: 6840, low: 6840, high: 6840, source: 'own', temp: 'cold', ageSec: 18000, ownLast: null, uexRange: null });
  });

  it('keeps a cold own price when the UEX row has no usable price for the side', () => {
    expect(estimate(buildMarket([px(2, 10, { buy: { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 } })], [own(300)]), 2, 10, 'sell', ctx))
      .toMatchObject({ price: 6840, source: 'own', temp: 'cold' });
  });

  it('takes quantity from own when known, else UEX, else null', () => {
    const m = (scu: number | null, scuSell: number) => buildMarket([px(2, 10, { sell: week, scuSell })], [own(10, scu)]);
    expect(estimate(m(null, 500), 2, 10, 'sell', ctx)!.scu).toBe(500);
    expect(estimate(m(null, 0), 2, 10, 'sell', ctx)!.scu).toBeNull();
    // my own zero is a known value, not "unknown": it is kept and the UEX quantity does not replace it
    expect(estimate(m(0, 500), 2, 10, 'sell', ctx)).toMatchObject({ scu: 0, stock: null });
  });

  it('reports the buyer inventory as recorded, without the refill timer', () => {
    const m = buildMarket([px(2, 10, { sell: week, scuSell: 500, scuSellMax: 800 })], [own(20, 100)]);
    expect(estimate(m, 2, 10, 'sell', ctx)).toMatchObject({ scu: 100, stock: null });
  });

  it('keeps a recorded zero on the sell side', () => {
    expect(estimate(buildMarket([px(2, 10, { sell: week, scuSell: 500 })], [own(10, 0)]), 2, 10, 'sell', ctx))
      .toMatchObject({ scu: 0, stock: null });
  });

  it('takes the buyer inventory from UEX on the sell side only while it is positive, and never starts a timer from it', () => {
    expect(estimate(buildMarket([px(2, 10, { sell: week, scuSell: 500 })], []), 2, 10, 'sell', ctx)).toMatchObject({ scu: 500, stock: null });
    expect(estimate(buildMarket([px(2, 10, { sell: week, scuSell: 0 })], []), 2, 10, 'sell', ctx)).toMatchObject({ scu: null, stock: null });
    expect(estimate(buildMarket([px(2, 10, { sell: week, scuSell: 500 })], [own(10, null)]), 2, 10, 'sell', ctx)).toMatchObject({ scu: 500, stock: null });
  });

  it('ignores the quantity of a cold own observation', () => {
    expect(estimate(buildMarket([px(2, 10, { sell: week, scuSell: 500 })], [own(300, 200)]), 2, 10, 'sell', ctx)!.scu).toBe(500);
    expect(estimate(buildMarket([px(2, 10, { sell: week })], [own(300, 200)]), 2, 10, 'sell', ctx)!.scu).toBeNull();
  });

  it('reads buy stats and stock for the buy side', () => {
    expect(estimate(buildMarket([px(2, 10, { buy: { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 }, scuBuy: 340 })], []), 2, 10, 'buy', ctx))
      .toMatchObject({ price: 6000, low: 5900, high: 6200, scu: 340 });
  });

  it('has no stock estimate for a UEX price', () => {
    expect(estimate(buildMarket([px(2, 10, { sell: week, scuSell: 500 })], []), 2, 10, 'sell', ctx))
      .toMatchObject({ source: 'uex', scu: 500, stock: null });
  });
});

// The refill timer (spec 14.3) belongs to the stock at the seller, the BUY side. On the SELL side the quantity is
// the buyer's inventory (spec 14.5): it is shown as recorded and never extrapolated.
describe('estimate: stock refill timer', () => {
  it('extrapolates my own quantity with the refill timer', () => {
    const m = buildMarket([px(2, 10, { buy: buyWeek, scuBuy: 500, scuBuyMax: 800 })], [ownBuy(20, 100)]);
    const e = estimate(m, 2, 10, 'buy', { ...ctx, refillFullMin: 80 })!;      // 800 / 80 = 10 per minute, 20 minutes have passed
    expect(e.scu).toBe(300);
    expect(e.stock).toEqual({ scu: 300, baseScu: 100, baseAgeSec: 1200, ratePerMin: 10, rateSource: 'default', maxScu: 800 });
  });

  it('prefers the rate and the maximum learned from my own diary', () => {
    const stock = new Map([[obsKey(2, 10, 'buy'), { maxScu: 1000, ratePerMin: 5 }]]);
    const e = estimate(buildMarket([px(2, 10, { buy: buyWeek, scuBuyMax: 800 })], [ownBuy(20, 100)], stock), 2, 10, 'buy', ctx)!;
    expect(e.stock).toMatchObject({ scu: 200, ratePerMin: 5, rateSource: 'learned', maxScu: 1000 });
  });

  it('treats my own zero as known empty and a missing quantity as unknown', () => {
    const m = (scu: number | null) => buildMarket([px(2, 10, { buy: buyWeek, scuBuy: 500 })], [ownBuy(10, scu)]);
    expect(estimate(m(0), 2, 10, 'buy', ctx)!.stock).toMatchObject({ baseScu: 0 });       // a zero used to fall through to UEX
    expect(estimate(m(null), 2, 10, 'buy', ctx)).toMatchObject({ scu: 500, stock: null });
  });

  it('does not extrapolate a cold quantity', () => {
    expect(estimate(buildMarket([px(2, 10, { buy: buyWeek, scuBuy: 500 })], [ownBuy(300, 100)]), 2, 10, 'buy', ctx))
      .toMatchObject({ scu: 500, stock: null });
  });

  it('takes the larger of my own maximum and the UEX one, ignoring zeros', () => {
    const maxOf = (mine: number, uex: number) => estimate(
      buildMarket(
        [px(2, 10, { buy: buyWeek, scuBuyMax: uex })], [ownBuy(20, 100)],
        new Map([[obsKey(2, 10, 'buy'), { maxScu: mine, ratePerMin: null }]]),
      ),
      2, 10, 'buy', ctx,
    )!.stock!.maxScu;
    expect(maxOf(0, 800)).toBe(800);
    expect(maxOf(1000, 800)).toBe(1000);
    expect(maxOf(600, 800)).toBe(800);
    expect(maxOf(0, 0)).toBeNull();
  });

  it('falls back to the default full-refill time when the context has none', () => {
    const m = buildMarket([px(2, 10, { buy: buyWeek, scuBuyMax: 750 })], [ownBuy(20, 100)]);      // 750 / 75 = 10 per minute
    expect(estimate(m, 2, 10, 'buy', ctx)!.stock).toMatchObject({ scu: 300, ratePerMin: 10, rateSource: 'default' });
  });

  it('reads the maximum and the diary stats of the side that is asked for', () => {
    const mine = obs({ ts: now - 20 * 60, terminalId: 2, commodityId: 10, side: 'buy', price: 6100, scu: 40 });
    const stock = new Map([[obsKey(2, 10, 'sell'), { maxScu: 5000, ratePerMin: 50 }]]);       // the other side: must not leak in
    const m = buildMarket([px(2, 10, { buy: buyWeek, scuBuyMax: 340, scuSellMax: 9999 })], [mine], stock);
    expect(estimate(m, 2, 10, 'buy', ctx)!.stock).toMatchObject({ scu: 130, maxScu: 340, rateSource: 'default' });
  });

  it('never runs the timer on the sell side, whatever maximum and rate are known for it', () => {
    const stock = new Map([[obsKey(2, 10, 'sell'), { maxScu: 1000, ratePerMin: 5 }]]);
    const m = buildMarket([px(2, 10, { sell: week, scuSell: 500, scuSellMax: 800 })], [own(20, 100)], stock);
    expect(estimate(m, 2, 10, 'sell', ctx)).toMatchObject({ scu: 100, stock: null });
  });
});
