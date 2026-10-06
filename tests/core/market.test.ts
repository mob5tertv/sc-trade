import { describe, expect, it } from 'vitest';
import { buildMarket } from '../../src/core/market';
import { obsKey, priceKey } from '../../src/core/types';
import { obs, px } from '../helpers/factories';

describe('buildMarket', () => {
  it('indexes by terminal and commodity across both sources and keeps the latest observation', () => {
    const m = buildMarket([px(1, 10)], [
      obs({ id: 1, ts: 100, terminalId: 2, commodityId: 10, side: 'sell', price: 5 }),
      obs({ id: 2, ts: 200, terminalId: 2, commodityId: 10, side: 'sell', price: 7 }),
    ]);
    expect([...m.byCommodity.get(10)!].sort()).toEqual([1, 2]);
    expect([...m.byTerminal.get(2)!]).toEqual([10]);
    expect(m.own.get(obsKey(2, 10, 'sell'))!.price).toBe(7);
  });

  it('keeps the newest observation whatever the input order', () => {
    const older = obs({ id: 1, ts: 100, terminalId: 2, commodityId: 10, side: 'sell', price: 5 });
    const newer = obs({ id: 2, ts: 200, terminalId: 2, commodityId: 10, side: 'sell', price: 7 });
    expect(buildMarket([], [newer, older]).own.get(obsKey(2, 10, 'sell'))!.price).toBe(7);
  });

  it('prefers the higher id when two observations share a timestamp', () => {
    const a = obs({ id: 1, ts: 100, terminalId: 2, commodityId: 10, side: 'sell', price: 5 });
    const b = obs({ id: 2, ts: 100, terminalId: 2, commodityId: 10, side: 'sell', price: 7 });
    expect(buildMarket([], [b, a]).own.get(obsKey(2, 10, 'sell'))!.price).toBe(7);
    expect(buildMarket([], [a, b]).own.get(obsKey(2, 10, 'sell'))!.price).toBe(7);
  });

  it('keeps the buy and the sell observation of one pair apart', () => {
    const m = buildMarket([], [
      obs({ id: 1, ts: 100, terminalId: 2, commodityId: 10, side: 'buy', price: 5 }),
      obs({ id: 2, ts: 50, terminalId: 2, commodityId: 10, side: 'sell', price: 7 }),
    ]);
    expect(m.own.get(obsKey(2, 10, 'buy'))!.price).toBe(5);
    expect(m.own.get(obsKey(2, 10, 'sell'))!.price).toBe(7);
    expect([...m.byTerminal.get(2)!]).toEqual([10]);
  });

  it('stores UEX rows by terminal and commodity', () => {
    const row = px(3, 20);
    expect(buildMarket([row], []).uex.get(priceKey(3, 20))).toBe(row);
  });

  it('builds an empty market from nothing', () => {
    const m = buildMarket([], []);
    expect([m.uex.size, m.own.size, m.byTerminal.size, m.byCommodity.size]).toEqual([0, 0, 0, 0]);
  });
});
