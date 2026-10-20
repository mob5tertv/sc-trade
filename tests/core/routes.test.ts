import { describe, expect, it } from 'vitest';
import { quantity, routesForLot, routesFrom, routesTo, stockKnown, travelSec } from '../../src/core/routes';
import { buildMarket } from '../../src/core/market';
import { distKey, pairKey } from '../../src/core/types';
import type { Estimate } from '../../src/core/types';
import { obs } from '../helpers/factories';
import { ctx, GOLD, market, NOW, withBuy, withOwnSellScu, withSell, withUexSellScu } from '../helpers/route-fixtures';

// Terminals: A=1 (system 68, planet 10), B=2 (68, 20), C=3 (68, 20), D=4 (99, 30), A2=5 (68, 10). Commodity Gold=10.
// A: own hot BUY 6120, stock 340. B: UEX SELL 6900 (6400–7100). C: own warm SELL 6840.
// The quantity on a SELL side is the buyer's inventory (spec 14.5): it never limits a trip.
// D: UEX SELL 9000. Distances: A–B 59, A–C 61.
describe('quantity', () => {
  it('quantity is the smallest of free space, stock at the origin and budget', () => {
    expect(quantity({ freeScu: 696, stockScu: 340, budget: null, buyPrice: 6120 })).toBe(340);
    expect(quantity({ freeScu: 696, stockScu: null, budget: 1_000_000, buyPrice: 6120 })).toBe(163);
    expect(quantity({ freeScu: 696, stockScu: 0, budget: null, buyPrice: 6120 })).toBe(0);
  });

  it.each([
    [{ freeScu: 696, stockScu: null, budget: null, buyPrice: 6120 }, 696],
    [{ freeScu: -5, stockScu: 340, budget: null, buyPrice: 6120 }, 0],
    // a budget that cannot afford a single unit leaves nothing to buy
    [{ freeScu: 696, stockScu: null, budget: 6000, buyPrice: 6120 }, 0],
  ])('quantity', (i, q) => expect(quantity(i)).toBe(q));

  it('quantity: a known zero stock limits, only null is unknown', () => {
    expect(quantity({ freeScu: 696, stockScu: 0, budget: null, buyPrice: 6120 })).toBe(0);
    expect(quantity({ freeScu: 696, stockScu: null, budget: null, buyPrice: 6120 })).toBe(696);
  });
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
    expect(trace).toEqual({ considered: 3, kept: 2, dropped: { unknownTerminal: 0, systemFilter: 1, nonPositiveProfit: 0, zeroQty: 0, tooFar: 0, notBetter: 0 } });
  });

  it('prefers my own median time over the estimate', () => {
    const { options } = routesFrom(market, [1], 1, { ...ctx, ownMedian: new Map([[pairKey(1, 3), 600]]) });
    expect(options.find(o => o.destId === 3)).toMatchObject({ timeSec: 600, timeSource: 'own', uecPerHour: 1468800 });
  });

  it('sorts by ROI on request', () => {
    const c = { ...ctx, ownMedian: new Map([[pairKey(1, 3), 600]]), settings: { ...ctx.settings, sort: 'roi' as const } };
    expect(routesFrom(market, [1], 1, c).options.map(o => o.destId)).toEqual([2, 3]);
  });

  it('orders by what the trip brings whether or not its distance is known, and leaves the time of such a trip empty', () => {
    const { options } = routesFrom(market, [1], 1, { ...ctx, distances: new Map([[distKey(1, 3), 61]]) });
    expect(options.map(o => o.destId)).toEqual([2, 3]);                 // 265 200 and 244 800: the time is the player's to weigh
    expect(options[0]).toMatchObject({ timeSec: null, uecPerHour: null, timeSource: null });
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
    // among the candidates of an uncut search (the ones the distances are asked for) the trip has no time
    const uncut = { ...c, settings: { ...c.settings, topN: Number.POSITIVE_INFINITY } };
    const o = routesFrom(m2, [5], 1, uncut).options.find(x => x.destId === 2)!;
    expect(o).toMatchObject({ timeSec: null, timeSource: null, uecPerHour: null, distanceGm: 60 });
    // and the list the player sees does not offer it: a purchase elsewhere must be known to be near (spec 14.19)
    const shown = routesFrom(m2, [5], 1, c);
    expect(shown.options).toEqual([]);
    expect(shown.trace.dropped.tooFar).toBeGreaterThan(0);
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

  it('an empty buyer is the best case, not a blocker', () => {
    // buyer C (3): my own sell observation 6840 with the quantity 0 ("out of stock")
    const r = routesFrom(withOwnSellScu(market, 3, 10, 0), [1], 1, ctx);
    expect(r.options.find(o => o.destId === 3)).toMatchObject({ qty: 340, profit: 244800 });
    expect(r.trace.dropped.zeroQty).toBe(0);
  });

  it('the buyer inventory reported by UEX does not limit the load', () => {
    expect(routesFrom(withUexSellScu(market, 2, 10, 4), [1], 1, ctx).options.find(o => o.destId === 2)!.qty).toBe(340);
  });

  it('a large recorded buyer inventory does not limit the load either, and stays on the option as information', () => {
    const o = routesFrom(withOwnSellScu(market, 3, 10, 5), [1], 1, ctx).options.find(x => x.destId === 3)!;
    expect(o).toMatchObject({ qty: 340, profit: 244800, sell: { scu: 5 } });
  });

  it('counts a budget that buys nothing as zero quantity', () => {
    const r = routesFrom(market, [1], 1, { ...ctx, settings: { ...ctx.settings, budget: 6000 } });
    expect(r.options).toEqual([]);
    expect(r.trace.dropped.zeroQty).toBe(2);
  });

  it('counts kept routes before the topN cut', () => {
    const r = routesFrom(market, [1], 1, { ...ctx, settings: { ...ctx.settings, topN: 1 } });
    expect(r.options).toHaveLength(1);
    expect(r.trace).toMatchObject({ considered: 3, kept: 2 });
  });

  it('does not use an origin whose buy price is zero', () => {
    const zeroBuy = obs({ ts: NOW - 60, terminalId: 5, commodityId: GOLD, side: 'buy', price: 0 });
    const r = routesFrom(withSell(buildMarket([], [zeroBuy]), 2, 6900), [5], 5, ctx);
    expect(r).toEqual({ options: [], trace: { considered: 0, kept: 0, dropped: { unknownTerminal: 0, systemFilter: 0, nonPositiveProfit: 0, zeroQty: 0, tooFar: 0, notBetter: 0 } } });
  });

  it('ranks by the profit, the trips with a time and those without one alike', () => {
    const m2 = withSell(withSell(market, 6, 7000), 5, 7200);
    const c = { ...ctx, distances: new Map([[distKey(1, 3), 61]]) };   // 2, 5 and 6 have no distance
    const { options } = routesFrom(m2, [1], 1, c);
    expect(options.map(o => o.destId)).toEqual([5, 6, 2, 3]);
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

  it('narrows to one commodity: the same result for a terminal that buys only that commodity', () => {
    expect(routesTo(market, 2, ctx, GOLD)).toEqual(routesTo(market, 2, ctx));
  });

  it('finds nothing for a commodity the destination does not buy', () => {
    expect(routesTo(market, 2, ctx, 999).options).toEqual([]);
  });

  it('applies the commodity filter before the topN cut', () => {
    // terminal 2 also buys Titanium (20), cheap at terminal 1: that route outranks Gold (its stock there is known by my own reading: a trip on
    // an unknown stock would stand after the Gold one, whatever it pays)
    const priced = withBuy(withSell(market, 2, 5000, 20), 1, { avgWeek: 100, minWeek: 100, maxWeek: 100 }, 20);
    const reading = obs({ id: 7, ts: NOW - 10 * 60, terminalId: 1, commodityId: 20, side: 'buy', price: 100, scu: 500 });
    const m2 = buildMarket([...priced.uex.values()], [...priced.own.values(), reading]);
    const c = { ...ctx, settings: { ...ctx.settings, topN: 1 } };
    expect(routesTo(m2, 2, c).options.map(o => o.commodityId)).toEqual([20]);
    const gold = routesTo(m2, 2, c, GOLD);
    expect(gold.options.map(o => o.commodityId)).toEqual([GOLD]);
    expect(gold.options[0]).toMatchObject({ originId: 1, destId: 2, profit: 265200 });
  });

  it('does not drop an empty buyer when the list is built for the buyer itself', () => {
    const r = routesTo(withOwnSellScu(market, 3, 10, 0), 3, ctx);
    expect(r.options).toHaveLength(1);
    expect(r.options[0]).toMatchObject({ originId: 1, destId: 3, qty: 340, profit: 244800, sell: { scu: 0 } });
    expect(r.trace.dropped.zeroQty).toBe(0);
  });

  it('counts the destination terminal as unknown when it left the reference', () => {
    const r = routesTo(withSell(market, 777, 9999), 777, ctx);
    expect(r.options).toEqual([]);
    expect(r.trace.dropped.unknownTerminal).toBeGreaterThan(0);
  });
});

// Terminal 5 sells Gold at 6000 and nobody knows how much of it is there (`buy.scu` is null): its trips are counted at the whole free space
// and look the best there are. They must stand after every trip that rests on a stock somebody knows, whatever the sort (spec 14.5, version 1.1).
describe('trips that rest on an unknown stock stand after the known ones', () => {
  const unknownStock = withBuy(market, 5, { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 });
  const near = { ...ctx, distances: new Map([...ctx.distances, [distKey(1, 5), 2], [distKey(5, 2), 60], [distKey(5, 3), 62]]) };
  const sortedBy = (sort: 'profit' | 'roi', topN = 5) => ({ ...near, settings: { ...near.settings, sort, topN } });
  const ends = (options: Array<{ originId: number; destId: number }>) => options.map(o => [o.originId, o.destId]);

  it('would stand first without that rule: the unknown stock buys the most and is the cheapest', () => {
    // the premise of the tests below, by the numbers: origin 5 beats origin 1 on both metrics
    const all = routesFrom(unknownStock, [1, 5], 1, sortedBy('profit', 99)).options;
    const best = (originId: number, key: 'profit' | 'roi') => Math.max(...all.filter(o => o.originId === originId).map(o => o[key] ?? 0));
    expect(best(5, 'profit')).toBeGreaterThan(best(1, 'profit'));
    expect(best(5, 'roi')).toBeGreaterThan(best(1, 'roi'));
    expect(all.find(o => o.originId === 5)!.buy.scu).toBeNull();
    expect(all.find(o => o.originId === 1)!.buy.scu).toBe(340);
  });

  it.each(['profit', 'roi'] as const)('puts them after the known ones when sorted by %s, each group by that sort', (sort) => {
    const { options } = routesFrom(unknownStock, [1, 5], 1, sortedBy(sort));
    expect(ends(options)).toEqual([[1, 2], [1, 3], [5, 2], [5, 3]]);
  });

  it('chooses the best N of the trips bought here, and the trips bought elsewhere follow them: neither pushes the other out (spec 14.19)', () => {
    const { options, trace } = routesFrom(unknownStock, [1, 5], 1, sortedBy('profit', 1));
    expect(ends(options)).toEqual([[1, 2], [5, 2]]);   // the best one bought here, then the best one bought elsewhere
    expect(trace.kept).toBe(4);   // `kept` is counted before the cut, as it was
    expect(ends(routesFrom(unknownStock, [1, 5], 1, sortedBy('profit', 2)).options)).toEqual([[1, 2], [1, 3], [5, 2], [5, 3]]);
  });

  it('orders the trips that END at a terminal the same way (the origin with an unknown stock is the cheaper one)', () => {
    expect(ends(routesTo(unknownStock, 2, sortedBy('profit')).options)).toEqual([[1, 2], [5, 2]]);
    expect(ends(routesTo(unknownStock, 2, sortedBy('roi')).options)).toEqual([[1, 2], [5, 2]]);
  });

  it('counts a stock estimated by the timer from my own reading as known', () => {
    // terminal 5: my reading of 600 SCU half an hour ago (enough to bring more than the trip from here), the refill timer brings it up to date;
    // terminal 6: no reading, UEX does not say, and the cheapest of all
    const cheapest = withBuy(unknownStock, 6, { avgWeek: 5000, minWeek: 4900, maxWeek: 5200 });
    const reading = obs({ id: 9, ts: NOW - 30 * 60, terminalId: 5, commodityId: GOLD, side: 'buy', price: 6000, scu: 600 });
    const m2 = buildMarket([...cheapest.uex.values()], [...cheapest.own.values(), reading]);
    const by = sortedBy('roi');
    const { options } = routesFrom(m2, [1, 5, 6], 1, { ...by, distances: new Map([...by.distances, [distKey(1, 6), 2]]) });
    const stockOf = (originId: number) => options.find(o => o.originId === originId)!.buy;
    expect(stockOf(5).stock).not.toBeNull();             // the timer made the estimate
    expect(stockOf(5).scu).toBeGreaterThanOrEqual(600);
    expect(stockOf(6).scu).toBeNull();
    // 6 is the best by ROI, and still all of its trips come after every trip of 1 and of 5
    const order = options.map(o => o.originId);
    expect(order.indexOf(5)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(6)).toBeGreaterThan(Math.max(order.lastIndexOf(1), order.lastIndexOf(5)));
  });
});

describe('stockKnown', () => {
  const buyWith = (scu: number | null) => ({ buy: { scu } as Estimate });

  it('is true for a stock somebody knows, a known zero included', () => {
    expect(stockKnown(buyWith(340))).toBe(true);
    expect(stockKnown(buyWith(0))).toBe(true);
  });

  it('is false only for no stock at all (`null`)', () => {
    expect(stockKnown(buyWith(null))).toBe(false);
  });
});

// «Выгоднее» (spec 14.19, item 7). A (1) is where the player stands: Gold at my 6120, ROI 12.7 % to B (2). A2 (5) is on the same
// planet, 2 Gm away: the empty flight there is 5 min of overhead + 10 s of quantum = 310 s.
describe('«Выгоднее»: a purchase at another terminal is offered only when it is near and better', () => {
  const TITA = 20;
  const cheaper = withBuy(market, 5, { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 });
  const near = { ...ctx, distances: new Map([...ctx.distances, [distKey(1, 5), 2], [distKey(5, 2), 60], [distKey(5, 3), 62]]) };
  const within = (min: number) => ({ ...near, settings: { ...near.settings, nearbyMaxMin: min } });
  const origins = (options: Array<{ originId: number }>) => options.map(o => o.originId);

  it('keeps it when the empty flight is within the limit, and drops it beyond', () => {
    expect(origins(routesFrom(cheaper, [1, 5], 1, within(10)).options)).toEqual([1, 1, 5, 5]);
    const far = routesFrom(cheaper, [1, 5], 1, within(5));
    expect(origins(far.options)).toEqual([1, 1]);
    expect(far.trace.dropped).toMatchObject({ tooFar: 2, notBetter: 0 });
    expect(far.trace.considered).toBe(far.trace.kept + Object.values(far.trace.dropped).reduce((sum, n) => sum + n, 0));
  });

  it('drops it when UEX does not know the distance to the purchase', () => {
    const unknown = { ...near, distances: new Map([...near.distances, [distKey(1, 5), null]]) };
    expect(origins(routesFrom(cheaper, [1, 5], 1, unknown).options)).toEqual([1, 1]);
  });

  it('judges a stock that is KNOWN by what the trip brings: a big stock at a slightly worse price is offered, a small batch at a fine price is not', () => {
    // from here: 340 SCU at 6120, 265 200 to B. A2 has 600 SCU by my reading at 6200 (ROI 11 %, less than the 12.7 % here): 600 × 700 = 420 000
    const reading = (price: number, scu: number) => obs({ id: 9, ts: NOW - 60, terminalId: 5, commodityId: GOLD, side: 'buy', price, scu });
    const withReading = (price: number, scu: number) => buildMarket([...market.uex.values()], [...market.own.values(), reading(price, scu)]);
    const big = routesFrom(withReading(6200, 600), [1, 5], 1, within(10));
    expect(origins(big.options)).toEqual([1, 1, 5, 5]);
    // 40 SCU at 5000 is ROI 38 %, and 40 × 1900 = 76 000: the fine percentage of a small batch is not worth the empty flight
    const small = routesFrom(withReading(5000, 40), [1, 5], 1, within(10));
    expect(origins(small.options)).toEqual([1, 1]);
    expect(small.trace.dropped).toMatchObject({ tooFar: 0, notBetter: 2 });
  });

  it('drops a stock nobody knows unless its ROI is higher too: the whole hold it is counted at is a guess', () => {
    const dearer = withBuy(market, 5, { avgWeek: 6200, minWeek: 6100, maxWeek: 6300 });
    const r = routesFrom(dearer, [1, 5], 1, within(10));
    expect(origins(r.options)).toEqual([1, 1]);
    expect(r.trace.dropped).toMatchObject({ tooFar: 0, notBetter: 2 });
    const same = withBuy(market, 5, { avgWeek: 6120, minWeek: 6120, maxWeek: 6120 });
    expect(origins(routesFrom(same, [1, 5], 1, within(10)).options)).toEqual([1, 1]);
  });

  it('compares a commodity that is not sold here with the best option from here', () => {
    // Titanium is sold only at A2: bought at 2500. At 2600 it pays 4 %, less than the Gold from here (12.7 %); at 3500 it pays 40 %.
    const tita = (sell: number) => withSell(withBuy(market, 5, { avgWeek: 2500, minWeek: 2500, maxWeek: 2500 }, TITA), 2, sell, TITA);
    expect(origins(routesFrom(tita(2600), [1, 5], 1, within(10)).options)).toEqual([1, 1]);
    const better = routesFrom(tita(3500), [1, 5], 1, within(10)).options;
    expect(better.map(o => [o.originId, o.commodityId])).toEqual([[1, GOLD], [1, GOLD], [5, TITA]]);
  });

  it('offers every near purchase when nothing can be bought here at all', () => {
    const onlyThere = withBuy(buildMarket([...market.uex.values()], []), 5, { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 });
    expect(origins(routesFrom(onlyThere, [1, 5], 1, within(10)).options)).toEqual([5]);
  });

  it('offers at most three trips bought elsewhere, after the ones bought here', () => {
    let many = cheaper;
    for (const id of [101, 102, 103, 104]) many = withSell(many, id, 7000 + id);
    const terminals = new Map(ctx.terminals);
    for (const id of [101, 102, 103, 104]) terminals.set(id, { ...terminals.get(2)!, id });
    const r = routesFrom(many, [1, 5], 1, { ...within(10), terminals, settings: { ...within(10).settings, topN: 2 } });
    expect(origins(r.options)).toEqual([1, 1, 5, 5]);                                          // topN 2: two of each
    const wide = routesFrom(many, [1, 5], 1, { ...within(10), terminals, settings: { ...within(10).settings, topN: 5 } });
    expect(origins(wide.options).filter(id => id === 5)).toHaveLength(3);
    expect(origins(wide.options).lastIndexOf(1)).toBeLessThan(origins(wide.options).indexOf(5));
  });
});

describe('routesForLot (version 1.4.1)', () => {
  // a lot of Gold at A (terminal 1): B pays 6900 (UEX), C 6840 (own), D is another system
  it('counts the trips of a lot from what it cost, the budget limiting nothing', () => {
    const { options } = routesForLot(market, { terminalId: 1, commodityId: GOLD, scu: 300, price: 6000 }, { ...ctx, settings: { ...ctx.settings, budget: 1000 } });
    expect(options.map((o) => [o.destId, o.qty, o.profit])).toEqual([[2, 300, 270_000], [3, 300, 252_000]]);
  });
  it('gives the three places of least loss when nowhere pays more than it cost', () => {
    const { options } = routesForLot(market, { terminalId: 1, commodityId: GOLD, scu: 100, price: 8000 }, ctx);
    expect(options.map((o) => [o.destId, o.profit])).toEqual([[2, -110_000], [3, -116_000]]);
    expect(options.every((o) => o.profit < 0)).toBe(true);
  });
});
