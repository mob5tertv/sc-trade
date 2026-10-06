import { describe, expect, it } from 'vitest';
import { quantity, routesFrom, routesTo, travelSec } from '../../src/core/routes';
import { buildMarket } from '../../src/core/market';
import { distKey, pairKey } from '../../src/core/types';
import { obs } from '../helpers/factories';
import { ctx, GOLD, market, NOW, withBuy, withSell } from '../helpers/route-fixtures';

// Terminals: A=1 (system 68, planet 10), B=2 (68, 20), C=3 (68, 20), D=4 (99, 30), A2=5 (68, 10). Commodity Gold=10.
// A: own hot BUY 6120, stock 340. B: UEX SELL 6900 (6400–7100). C: own warm SELL 6840.
// D: UEX SELL 9000. Distances: A–B 59, A–C 61.
describe('quantity', () => {
  it.each([
    [{ freeScu: 696, stockScu: 340, demandScu: null, budget: null, buyPrice: 6120 }, 340],
    [{ freeScu: 696, stockScu: null, demandScu: 200, budget: null, buyPrice: 6120 }, 200],
    [{ freeScu: 696, stockScu: null, demandScu: null, budget: 1_000_000, buyPrice: 6120 }, 163],
    [{ freeScu: 696, stockScu: null, demandScu: null, budget: null, buyPrice: 6120 }, 696],
    [{ freeScu: -5, stockScu: 340, demandScu: null, budget: null, buyPrice: 6120 }, 0],
    // zero stock or demand means "unknown", not "none left" (spec 8.2)
    [{ freeScu: 696, stockScu: 0, demandScu: 0, budget: null, buyPrice: 6120 }, 696],
    // a budget that cannot afford a single unit leaves nothing to buy
    [{ freeScu: 696, stockScu: null, demandScu: null, budget: 6000, buyPrice: 6120 }, 0],
  ])('quantity', (i, q) => expect(quantity(i)).toBe(q));
});

describe('travelSec', () => {
  it('adds the overhead to the quantum flight', () => {
    expect(travelSec(59, 200, 12)).toBe(1015);
    expect(travelSec(0, 200, 5)).toBe(300);
  });
});

describe('routesFrom', () => {
  it('ranks destinations by UEC per hour and applies the system filter', () => {
    const { options, trace } = routesFrom(market, [1], 1, ctx);
    expect(options.map(o => o.destId)).toEqual([2, 3]);
    expect(options[0]).toMatchObject({ qty: 340, profit: 265200, worstProfit: 95200, distanceGm: 59, timeSec: 1015, timeSource: 'estimate', emptyLegSec: 0 });
    expect(options[0].roi).toBeCloseTo(0.12745, 4);
    expect(Math.round(options[0].uecPerHour!)).toBe(940611);
    expect(options[1]).toMatchObject({ profit: 244800, timeSec: 1025 });
    expect(Math.round(options[1].uecPerHour!)).toBe(859785);
    expect(trace).toEqual({ considered: 3, kept: 2, dropped: { unknownTerminal: 0, systemFilter: 1, nonPositiveProfit: 0, zeroQty: 0 } });
  });

  it('prefers my own median time over the estimate', () => {
    const { options } = routesFrom(market, [1], 1, { ...ctx, ownMedian: new Map([[pairKey(1, 3), 600]]) });
    expect(options[0]).toMatchObject({ destId: 3, timeSec: 600, timeSource: 'own', uecPerHour: 1468800 });
  });

  it('sorts by ROI on request', () => {
    const c = { ...ctx, ownMedian: new Map([[pairKey(1, 3), 600]]), settings: { ...ctx.settings, sort: 'roi' as const } };
    expect(routesFrom(market, [1], 1, c).options.map(o => o.destId)).toEqual([2, 3]);
  });

  it('puts routes with unknown distance last and leaves UEC per hour empty', () => {
    const { options } = routesFrom(market, [1], 1, { ...ctx, distances: new Map([[distKey(1, 3), 61]]) });
    expect(options.map(o => o.destId)).toEqual([3, 2]);
    expect(options[1]).toMatchObject({ timeSec: null, uecPerHour: null, timeSource: null });
  });

  it('allows cross-system routes when the filter is off', () => {
    const c = { ...ctx, settings: { ...ctx.settings, starSystemId: null } };
    expect(routesFrom(market, [1], 1, c).options.map(o => o.destId)).toContain(4);
  });

  it('drops non-positive profit, respects topN, budget and the commodity filter', () => {
    const m2 = withSell(market, 6, 6000);                 // terminal 6 in system 68 buys cheaper than the purchase price
    expect(routesFrom(m2, [1], 1, ctx).trace.dropped.nonPositiveProfit).toBe(1);
    expect(routesFrom(market, [1], 1, { ...ctx, settings: { ...ctx.settings, topN: 1 } }).options).toHaveLength(1);
    expect(routesFrom(market, [1], 1, { ...ctx, settings: { ...ctx.settings, budget: 1_000_000 } }).options[0].qty).toBe(163);
    expect(routesFrom(market, [1], 1, ctx, 999).options).toEqual([]);
  });

  it('adds the empty leg for a nearby origin', () => {
    const m2 = withBuy(market, 5, { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 });
    const c = { ...ctx, distances: new Map([...ctx.distances, [distKey(1, 5), 2], [distKey(5, 2), 60]]) };
    const o = routesFrom(m2, [1, 5], 1, c).options.find(x => x.originId === 5 && x.destId === 2)!;
    expect(o.emptyLegSec).toBe(310); expect(o.timeSec).toBe(310 + 1020);
    expect(o.worstProfit).toBe(o.qty * (6400 - 6200));
  });

  it('never routes a terminal to itself and skips terminals missing from the reference', () => {
    const m2 = withSell(market, 777, 9999);               // terminal 777 is not in ctx.terminals
    const r = routesFrom(m2, [1], 1, ctx);
    expect(r.options.every(o => o.destId !== o.originId && o.destId !== 777)).toBe(true);
    expect(r.trace.dropped.unknownTerminal).toBe(1);
  });
});

describe('routesFrom edge cases', () => {
  it('leaves the time of the whole route unknown when the empty leg distance is unknown', () => {
    const m2 = withBuy(market, 5, { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 });
    const c = { ...ctx, distances: new Map([...ctx.distances, [distKey(5, 2), 60]]) };   // no 1–5 distance
    const o = routesFrom(m2, [5], 1, c).options.find(x => x.destId === 2)!;
    expect(o).toMatchObject({ timeSec: null, timeSource: null, uecPerHour: null, distanceGm: 60 });
  });

  it('counts a route out of an unknown origin terminal instead of throwing', () => {
    const m2 = withBuy(market, 888, { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 });
    const r = routesFrom(m2, [888], 888, ctx);
    expect(r.options).toEqual([]);
    expect(r.trace.dropped.unknownTerminal).toBeGreaterThan(0);
  });

  it('counts zero quantity when there is no free space', () => {
    const r = routesFrom(market, [1], 1, { ...ctx, freeScu: 0 });
    expect(r.options).toEqual([]);
    expect(r.trace.dropped.zeroQty).toBe(2);
    expect(r.trace.kept).toBe(0);
  });

  it('counts kept routes before the topN cut', () => {
    const r = routesFrom(market, [1], 1, { ...ctx, settings: { ...ctx.settings, topN: 1 } });
    expect(r.options).toHaveLength(1);
    expect(r.trace).toMatchObject({ considered: 3, kept: 2 });
  });

  it('does not use an origin whose buy price is zero', () => {
    const zeroBuy = obs({ ts: NOW - 60, terminalId: 5, commodityId: GOLD, side: 'buy', price: 0 });
    const r = routesFrom(withSell(buildMarket([], [zeroBuy]), 2, 6900), [5], 5, ctx);
    expect(r).toEqual({ options: [], trace: { considered: 0, kept: 0, dropped: { unknownTerminal: 0, systemFilter: 0, nonPositiveProfit: 0, zeroQty: 0 } } });
  });

  it('ranks routes without time by ROI after the routes with time', () => {
    const m2 = withSell(withSell(market, 6, 7000), 5, 7200);
    const c = { ...ctx, distances: new Map([[distKey(1, 3), 61]]) };   // 2, 5 and 6 have no distance
    const { options } = routesFrom(m2, [1], 1, c);
    expect(options.map(o => o.destId)).toEqual([3, 5, 6, 2]);
  });

  it('ties are broken by ids so the order is stable', () => {
    const m2 = withSell(withSell(market, 6, 6900), 5, 6900);
    const c = { ...ctx, distances: new Map<string, number | null>() };
    expect(routesFrom(m2, [1], 1, c).options.map(o => o.destId)).toEqual([2, 5, 6, 3]);
  });
});

describe('routesTo', () => {
  it('mirrors routesFrom for the same pair', () => {
    const o = routesTo(market, 2, ctx).options[0];
    expect(o).toMatchObject({ originId: 1, destId: 2, profit: 265200, timeSec: 1015 });
  });

  it('counts the destination terminal as unknown when it left the reference', () => {
    const r = routesTo(withSell(market, 777, 9999), 777, ctx);
    expect(r.options).toEqual([]);
    expect(r.trace.dropped.unknownTerminal).toBeGreaterThan(0);
  });
});
