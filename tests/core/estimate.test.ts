import { describe, expect, it } from 'vitest';
import { estimate } from '../../src/core/estimate';
import { buildMarket } from '../../src/core/market';
import { obs, px } from '../helpers/factories';

// terminal 2, commodity 10, side sell
const th = { hotMin: 60, warmMin: 180, coolingMin: 240 };
const now = 1_000_000;
const week = { avgWeek: 6900, minWeek: 6400, maxWeek: 7100 };
const ctx = { now, thresholds: th, serverChangedAt: null };
const own = (ageMin: number, scu: number | null = 200) => obs({ ts: now - ageMin * 60, terminalId: 2, commodityId: 10, side: 'sell', price: 6840, scu });

describe('estimate', () => {
  it('uses a hot own price as is', () => {
    expect(estimate(buildMarket([px(2, 10, { sell: week, scuSell: 500 })], [own(10)]), 2, 10, 'sell', ctx))
      .toEqual({ price: 6840, low: 6840, high: 6840, source: 'own', temp: 'hot', ageSec: 600, ownLast: null, uexRange: null, scu: 200 });
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
    expect(estimate(m(0, 500), 2, 10, 'sell', ctx)!.scu).toBe(500);
  });

  it('ignores the quantity of a cold own observation', () => {
    expect(estimate(buildMarket([px(2, 10, { sell: week, scuSell: 500 })], [own(300, 200)]), 2, 10, 'sell', ctx)!.scu).toBe(500);
    expect(estimate(buildMarket([px(2, 10, { sell: week })], [own(300, 200)]), 2, 10, 'sell', ctx)!.scu).toBeNull();
  });

  it('reads buy stats and stock for the buy side', () => {
    expect(estimate(buildMarket([px(2, 10, { buy: { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 }, scuBuy: 340 })], []), 2, 10, 'buy', ctx))
      .toMatchObject({ price: 6000, low: 5900, high: 6200, scu: 340 });
  });
});
