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
    expect([m.uex.size, m.own.size, m.byTerminal.size, m.byCommodity.size, m.stock.size]).toEqual([0, 0, 0, 0, 0]);
  });

  it('keeps the stock statistics it is given and starts with an empty map without them', () => {
    const stock = new Map([[obsKey(1, 10, 'buy'), { maxScu: 340, ratePerMin: 10 }]]);
    expect(buildMarket([], [], stock).stock).toBe(stock);
    expect(buildMarket([px(1, 10)], []).stock.size).toBe(0);
    expect(buildMarket([], []).stock).not.toBe(buildMarket([], []).stock);       // no map shared between markets
  });
});

describe('buildMarket: quantity readings', () => {
  it('derives quantity readings from the observations when none are passed', () => {
    const m = buildMarket([], [obs({ id: 1, ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 300 })]);
    expect(m.ownScu.get(obsKey(1, 10, 'buy'))).toEqual({ ts: 100, scu: 300 });
  });

  it('keeps an explicit quantity reading that is older than the latest price observation', () => {
    const m = buildMarket([], [obs({ id: 2, ts: 200, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: null })], undefined,
      [{ terminalId: 1, commodityId: 10, side: 'buy', ts: 100, scu: 300 }]);
    expect(m.ownScu.get(obsKey(1, 10, 'buy'))).toEqual({ ts: 100, scu: 300 });
    expect(m.own.get(obsKey(1, 10, 'buy'))!.price).toBe(6120);
  });

  it('has no reading for an observation without a quantity', () => {
    const m = buildMarket([], [obs({ id: 1, ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: null })]);
    expect(m.ownScu.size).toBe(0);
  });

  it('keeps a recorded zero as a reading', () => {
    const m = buildMarket([], [obs({ id: 1, ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 0 })]);
    expect(m.ownScu.get(obsKey(1, 10, 'buy'))).toEqual({ ts: 100, scu: 0 });
  });

  it('derives the reading from the newest observation that has a quantity, whatever the input order', () => {
    const older = obs({ id: 1, ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 300 });
    const newest = obs({ id: 2, ts: 300, terminalId: 1, commodityId: 10, side: 'buy', price: 6100, scu: 40 });
    const priceOnly = obs({ id: 3, ts: 400, terminalId: 1, commodityId: 10, side: 'buy', price: 6200, scu: null });
    expect(buildMarket([], [priceOnly, older, newest]).ownScu.get(obsKey(1, 10, 'buy'))).toEqual({ ts: 300, scu: 40 });
    expect(buildMarket([], [newest, older, priceOnly]).ownScu.get(obsKey(1, 10, 'buy'))).toEqual({ ts: 300, scu: 40 });
  });

  it('breaks a timestamp tie between derived readings by the higher id', () => {
    const a = obs({ id: 1, ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 300 });
    const b = obs({ id: 2, ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 40 });
    expect(buildMarket([], [b, a]).ownScu.get(obsKey(1, 10, 'buy'))).toEqual({ ts: 100, scu: 40 });
    expect(buildMarket([], [a, b]).ownScu.get(obsKey(1, 10, 'buy'))).toEqual({ ts: 100, scu: 40 });
  });

  it('keeps the readings of the two sides, terminals and commodities apart', () => {
    const m = buildMarket([], [
      obs({ id: 1, ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 1, scu: 1 }),
      obs({ id: 2, ts: 100, terminalId: 1, commodityId: 10, side: 'sell', price: 1, scu: 2 }),
      obs({ id: 3, ts: 100, terminalId: 2, commodityId: 10, side: 'buy', price: 1, scu: 3 }),
      obs({ id: 4, ts: 100, terminalId: 1, commodityId: 20, side: 'buy', price: 1, scu: 4 }),
    ]);
    expect([...m.ownScu.entries()].map(([k, r]) => [k, r.scu]).sort()).toEqual([
      [obsKey(1, 10, 'buy'), 1], [obsKey(1, 10, 'sell'), 2], [obsKey(1, 20, 'buy'), 4], [obsKey(2, 10, 'buy'), 3],
    ]);
  });

  it('uses only the explicit readings when they are passed, not the quantities of the observations', () => {
    const m = buildMarket([], [obs({ id: 1, ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 300 })], undefined, []);
    expect(m.ownScu.size).toBe(0);
  });

  it('keeps the newest of several explicit readings of one stock', () => {
    const m = buildMarket([], [], undefined, [
      { terminalId: 1, commodityId: 10, side: 'buy', ts: 300, scu: 40 },
      { terminalId: 1, commodityId: 10, side: 'buy', ts: 100, scu: 300 },
    ]);
    expect(m.ownScu.get(obsKey(1, 10, 'buy'))).toEqual({ ts: 300, scu: 40 });
  });

  it('starts with an empty map of readings, not shared between markets', () => {
    expect(buildMarket([], []).ownScu.size).toBe(0);
    expect(buildMarket([], []).ownScu).not.toBe(buildMarket([], []).ownScu);
  });
});
