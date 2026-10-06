import { describe, expect, it } from 'vitest';
import { estimate } from '../../src/core/estimate';
import { buildMarket } from '../../src/core/market';
import { obsKey } from '../../src/core/types';
import type { Market } from '../../src/core/types';
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
        price: 6840, low: 6840, high: 6840, source: 'own', temp: 'hot', ageSec: 600, ageKnown: true, ownLast: null, uexRange: null, scu: 200,
        scuOrigin: 'own', stock: null,
      });
  });

  it('keeps the timer estimate on a hot own buy price', () => {
    expect(estimate(buildMarket([px(2, 10, { buy: buyWeek })], [ownBuy(10)]), 2, 10, 'buy', ctx))
      .toEqual({
        price: 6100, low: 6100, high: 6100, source: 'own', temp: 'hot', ageSec: 600, ageKnown: true, ownLast: null, uexRange: null, scu: 200,
        scuOrigin: 'own', stock: { scu: 200, baseScu: 200, baseAgeSec: 600, ratePerMin: 0, rateSource: 'none', maxScu: null },
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

// The quantity and the price are separate readings (spec 14.6): an observation with only a price says nothing
// about the quantity. Terminal 1, commodity 10.
describe('estimate: quantity readings independent of price readings', () => {
  const priceOnly = (side: 'buy' | 'sell', ageSec: number, price = 6120) => obs({ id: 2, ts: now - ageSec, terminalId: 1, commodityId: 10, side, price, scu: null });
  const reading = (side: 'buy' | 'sell', ageSec: number, scu: number) => ({ terminalId: 1, commodityId: 10, side, ts: now - ageSec, scu });

  it('keeps the stock timer running after a price-only observation', () => {
    const quantities = [{ terminalId: 1, commodityId: 10, side: 'buy' as const, ts: now - 1200, scu: 40 }];
    const m = buildMarket([px(1, 10, { buy: week, scuBuy: 300, scuBuyMax: 340 })], [priceOnly('buy', 120)], undefined, quantities);
    const e = estimate(m, 1, 10, 'buy', { ...ctx, refillFullMin: 75 })!;
    expect(e).toMatchObject({ price: 6120, source: 'own', scu: 130, scuOrigin: 'own' });
    expect(e.stock).toMatchObject({ baseScu: 40, baseAgeSec: 1200 });
  });

  it('falls back to the UEX quantity when my quantity reading is cold, even with a hot price', () => {
    const quantities = [reading('buy', 5 * 3600, 40)];
    const m = buildMarket([px(1, 10, { buy: week, scuBuy: 300 })], [priceOnly('buy', 120)], undefined, quantities);
    expect(estimate(m, 1, 10, 'buy', ctx)).toMatchObject({ price: 6120, scu: 300, scuOrigin: 'uex', stock: null });
  });

  it('reports the buyer inventory from the latest quantity reading on the sell side', () => {
    const m = buildMarket([], [priceOnly('sell', 60, 6900)], undefined, [reading('sell', 600, 3048)]);
    expect(estimate(m, 1, 10, 'sell', ctx)).toMatchObject({ scu: 3048, scuOrigin: 'own', stock: null });
  });

  it('counts the temperature of the quantity from its own time: a hot quantity outlives a cold price', () => {
    // the price is five hours old, the quantity twenty minutes: the price comes from UEX, the quantity is still mine
    const m = buildMarket([px(1, 10, { buy: week, scuBuy: 300, scuBuyMax: 340 })], [priceOnly('buy', 5 * 3600)], undefined, [reading('buy', 1200, 40)]);
    const e = estimate(m, 1, 10, 'buy', ctx)!;
    expect(e).toMatchObject({ source: 'uex', price: 6900, scu: 130, scuOrigin: 'own', ownLast: { price: 6120, ageSec: 5 * 3600 } });
    expect(e.stock).toMatchObject({ baseScu: 40, baseAgeSec: 1200 });
  });

  it('counts the temperature of the quantity from its own time: a hot price outlives a cold quantity', () => {
    const m = buildMarket([px(1, 10, { sell: week, scuSell: 500 })], [priceOnly('sell', 60, 6900)], undefined, [reading('sell', 5 * 3600, 3048)]);
    expect(estimate(m, 1, 10, 'sell', ctx)).toMatchObject({ source: 'own', price: 6900, scu: 500, scuOrigin: 'uex' });
  });

  it('applies the server change to the quantity reading by its own time', () => {
    const changed = { ...ctx, serverChangedAt: now - 600 };
    const m = (readingAgeSec: number) => buildMarket(
      [px(1, 10, { buy: week, scuBuy: 300, scuBuyMax: 340 })], [priceOnly('buy', 60)], undefined, [reading('buy', readingAgeSec, 40)],
    );
    expect(estimate(m(1200), 1, 10, 'buy', changed)).toMatchObject({ scu: 300, scuOrigin: 'uex', stock: null });       // before the change
    expect(estimate(m(300), 1, 10, 'buy', changed)).toMatchObject({ scu: 62, scuOrigin: 'own' });                       // after it: 40 + 340 / 75 × 5, rounded down
  });

  it('keeps a recorded zero as my quantity, also when a price-only observation came after it', () => {
    const m = buildMarket([px(1, 10, { buy: week, scuBuy: 300 })], [priceOnly('buy', 60)], undefined, [reading('buy', 60, 0)]);
    expect(estimate(m, 1, 10, 'buy', ctx)).toMatchObject({ scu: 0, scuOrigin: 'own', stock: { baseScu: 0 } });
  });

  it('keeps the readings of the two sides apart', () => {
    const m = buildMarket([px(1, 10, { buy: week, scuBuy: 300 })], [priceOnly('buy', 60)], undefined, [reading('sell', 60, 3048)]);
    expect(estimate(m, 1, 10, 'buy', ctx)).toMatchObject({ scu: 300, scuOrigin: 'uex' });
  });

  it('takes my quantity next to a UEX price when there is no observation of mine for the side', () => {
    const m = buildMarket([px(1, 10, { buy: week, scuBuy: 300, scuBuyMax: 340 })], [], undefined, [reading('buy', 1200, 40)]);
    expect(estimate(m, 1, 10, 'buy', ctx)).toMatchObject({ source: 'uex', scu: 130, scuOrigin: 'own' });
  });

  it('returns nothing for a quantity reading alone: a price is what an estimate is about', () => {
    expect(estimate(buildMarket([], [], undefined, [reading('buy', 60, 40)]), 1, 10, 'buy', ctx)).toBeNull();
  });

  it('says where the quantity comes from', () => {
    const origin = (m: Market) => estimate(m, 2, 10, 'sell', ctx)!.scuOrigin;
    expect(origin(buildMarket([px(2, 10, { sell: week })], [own(10, 40)]))).toBe('own');
    expect(origin(buildMarket([px(2, 10, { sell: week, scuSell: 500 })], [own(10, null)]))).toBe('uex');
    expect(origin(buildMarket([px(2, 10, { sell: week, scuSell: 0 })], [own(10, null)]))).toBeNull();
    expect(origin(buildMarket([px(2, 10, { sell: week })], []))).toBeNull();
  });
});

describe('estimate: whether the age of the data is known', () => {
  it('says whether the age of a UEX price is known', () => {
    expect(estimate(buildMarket([px(2, 10, { sell: week, dateModified: 0 })], []), 2, 10, 'sell', ctx)).toMatchObject({ source: 'uex', ageKnown: false });
    expect(estimate(buildMarket([px(2, 10, { sell: week, dateModified: now - 3600 })], []), 2, 10, 'sell', ctx)).toMatchObject({ ageKnown: true });
    expect(estimate(buildMarket([], [own(10)]), 2, 10, 'sell', ctx)).toMatchObject({ source: 'own', ageKnown: true });
  });

  it('knows the age of my own price whatever the UEX row says', () => {
    expect(estimate(buildMarket([px(2, 10, { sell: week, dateModified: 0 })], [own(10)]), 2, 10, 'sell', ctx)).toMatchObject({ source: 'own', ageKnown: true });
    // a cold own price of mine with no usable UEX row is still my price, and its age is known
    expect(estimate(buildMarket([], [own(300)]), 2, 10, 'sell', ctx)).toMatchObject({ source: 'own', temp: 'cold', ageKnown: true });
  });

  it('does not know the age of a UEX price that replaced my cold one', () => {
    expect(estimate(buildMarket([px(2, 10, { sell: week, dateModified: 0 })], [own(300)]), 2, 10, 'sell', ctx))
      .toMatchObject({ source: 'uex', ageKnown: false, ownLast: { price: 6840 } });
  });
});
