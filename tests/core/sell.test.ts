import { describe, expect, it } from 'vitest';
import { legSec, sellOrContinue } from '../../src/core/sell';
import { distKey, pairKey } from '../../src/core/types';
import { withOwnSellScu, withSell, withUexSellScu } from '../helpers/route-fixtures';
import { line, sellCtx as ctx, sellMarket as market, withManySellers } from '../helpers/run-fixtures';

// Cargo: Gold 340 SCU at 6120. The player stands at C (3), the real price is 6500, 1200 s have passed.
// B (2): UEX 6900 (6400–7100); C–B 10 Gm (770 s by the distance). D (4) pays 9000 but is in another system.
// The quantity on a SELL side is the buyer's inventory (spec 14.5): the whole cargo is compared, whatever it is.
describe('sellOrContinue', () => {
  it('judges flying on by what it adds to selling here, over the time of the way there (spec 14.19)', () => {
    const r = sellOrContinue(market, { commodityId: 10, scu: 340, avgBuyPrice: 6120 }, 3, 6500, 1200, ctx);
    expect(r.here).toMatchObject({ qty: 340, profit: 129_200, uecPerHour: 387_600 });
    expect(r.here.roi).toBeCloseTo(0.06209, 4);
    expect(r.alternatives).toHaveLength(1);
    // 340 SCU × (6900 − 6500) = 136 000 more than here; at the low end of the range 340 × (6400 − 6500) = −34 000
    expect(r.alternatives[0]).toMatchObject({
      destId: 2, qty: 340, expectedProfit: 265_200, extraProfit: 136_000, extraProfitLow: -34_000, extraSec: 770, extraSource: 'estimate',
    });
    expect(r.alternatives[0].extraUecPerHour).toBeCloseTo((136_000 * 3600) / 770, 6);
  });

  it('does not let the time already spent change the choice: the same alternatives early and late in the run', () => {
    const early = sellOrContinue(market, line, 3, 6500, 60, ctx);
    const late = sellOrContinue(market, line, 3, 6500, 36_000, ctx);
    expect(late.alternatives).toEqual(early.alternatives);
    expect(late.here.uecPerHour).not.toBe(early.here.uecPerHour);
  });

  it('compares the whole cargo regardless of the inventory shown at either terminal', () => {
    const r = sellOrContinue(withOwnSellScu(market, 2, 10, 0), line, 3, 6500, 1200, ctx);
    expect(r.here.qty).toBe(340);
    expect(r.alternatives[0]).toMatchObject({ destId: 2, qty: 340, expectedProfit: 265_200 });
  });

  it('sells the whole cargo here and at an alternative whatever inventory the buyers report', () => {
    const crowded = withUexSellScu(withOwnSellScu(market, 3, 10, 1000), 2, 10, 4);
    const r = sellOrContinue(crowded, line, 3, 6500, 1200, ctx);
    expect(r.here).toMatchObject({ qty: 340, profit: 129_200 });
    expect(r.alternatives[0]).toMatchObject({ destId: 2, qty: 340, expectedProfit: 265_200, sell: { scu: 4 } });
  });

  it('gives a price of my own no low end: it is one number, not a range', () => {
    const r = sellOrContinue(withOwnSellScu(market, 2, 10, null, 6900), line, 3, 6500, 1200, ctx);
    expect(r.alternatives[0]).toMatchObject({ destId: 2, sell: { source: 'own', price: 6900 }, extraProfit: 136_000, extraProfitLow: null });
  });

  it('excludes the current terminal, caps at three, and puts the places without a time after the timed one', () => {
    const r = sellOrContinue(withManySellers(market), line, 3, 6500, 1200, { ...ctx, distances: new Map([[distKey(3, 2), 10]]) });
    expect(r.alternatives).toHaveLength(3);
    expect(r.alternatives.every(a => a.destId !== 3)).toBe(true);
    expect(r.alternatives[0].destId).toBe(2); expect(r.alternatives.at(-1)!.extraUecPerHour).toBeNull();
  });

  it('orders the places without a time by what they add', () => {
    const r = sellOrContinue(withManySellers(market), line, 3, 6500, 1200, ctx);
    expect(r.alternatives.map(a => a.destId)).toEqual([2, 1, 5]);
    expect(r.alternatives.map(a => a.extraSec)).toEqual([770, null, null]);
    expect(r.alternatives.map(a => a.extraUecPerHour)).toEqual([expect.any(Number), null, null]);
  });

  it('puts a small gain that is near above a larger gain that is far, when it earns more per hour', () => {
    // A (1) pays 7000: +170 000, but 61 Gm away (1025 s): 597k/h. B (2) pays 6900: +136 000 in 770 s: 636k/h.
    const two = withSell(market, 1, 7000);
    const r = sellOrContinue(two, line, 3, 6500, 1200, { ...ctx, distances: new Map([[distKey(3, 2), 10], [distKey(3, 1), 61]]) });
    expect(r.alternatives.map(a => a.destId)).toEqual([2, 1]);
    expect(r.alternatives[0].extraUecPerHour!).toBeGreaterThan(r.alternatives[1].extraUecPerHour!);
    expect(r.alternatives[1].extraProfit).toBeGreaterThan(r.alternatives[0].extraProfit);
  });

  it('lists a place that pays no more than here after every place that pays more, a timed one included', () => {
    // A (1) pays 6400, less than the 6500 here, and its distance is known; B (2) pays more but has no distance
    const worse = withSell(market, 1, 6400);
    const r = sellOrContinue(worse, line, 3, 6500, 1200, { ...ctx, distances: new Map([[distKey(3, 1), 5]]) });
    expect(r.alternatives.map(a => a.destId)).toEqual([2, 1]);
    expect(r.alternatives[1]).toMatchObject({ extraProfit: -34_000 });
    expect(r.alternatives[1].extraUecPerHour!).toBeLessThan(0);
  });

  it('returns no rate here for a zero elapsed time, and counts a negative one as zero', () => {
    expect(sellOrContinue(market, line, 3, 6500, 0, ctx).here.uecPerHour).toBeNull();
    expect(sellOrContinue(market, line, 3, 6500, -50, ctx).here.uecPerHour).toBeNull();
  });

  it('leaves the rate empty when the time of the way is unknown: only the money is said', () => {
    const r = sellOrContinue(market, line, 3, 6500, 1200, { ...ctx, distances: new Map() });
    expect(r.alternatives[0]).toMatchObject({ destId: 2, extraProfit: 136_000, extraSec: null, extraSource: null, extraUecPerHour: null });
  });

  it('takes my own flight and unloading for the pair, and never the median of whole runs (it holds the loading)', () => {
    const own = sellOrContinue(market, line, 3, 6500, 1200, { ...ctx, ownLeg: new Map([[pairKey(3, 2), 400]]) });
    expect(own.alternatives[0]).toMatchObject({ extraSec: 400, extraSource: 'own' });
    expect(own.alternatives[0].extraUecPerHour).toBeCloseTo((136_000 * 3600) / 400, 6);
    const whole = sellOrContinue(market, line, 3, 6500, 1200, { ...ctx, ownMedian: new Map([[pairKey(3, 2), 2400]]) });
    expect(whole.alternatives[0]).toMatchObject({ extraSec: 770, extraSource: 'estimate' });
  });

  it('applies the system filter and skips terminals missing from the reference', () => {
    const wide = { ...ctx, settings: { ...ctx.settings, starSystemId: null } };
    expect(sellOrContinue(market, line, 3, 6500, 1200, wide).alternatives.map(a => a.destId).sort()).toEqual([2, 4]);
    const terminals = new Map(ctx.terminals);
    terminals.delete(2);
    expect(sellOrContinue(market, line, 3, 6500, 1200, { ...wide, terminals }).alternatives.map(a => a.destId)).toEqual([4]);
  });

  it('finds no alternatives from a terminal missing from the reference', () => {
    const terminals = new Map(ctx.terminals);
    terminals.delete(3);
    expect(sellOrContinue(market, line, 3, 6500, 1200, { ...ctx, terminals }).alternatives).toEqual([]);
  });

  it('keeps alternatives when the whole run loses money, because so does selling here', () => {
    const r = sellOrContinue(market, { ...line, avgBuyPrice: 7000 }, 3, 6500, 1200, ctx);
    expect(r.here.profit).toBe(-170_000);
    expect(r.alternatives[0]).toMatchObject({ destId: 2, expectedProfit: -34_000, extraProfit: 136_000 });
  });
});

describe('legSec', () => {
  it('is my own leg, else the estimate from the distance, else unknown', () => {
    const far = { ...ctx, distances: new Map([[distKey(3, 2), 10]]) };
    expect(legSec({ ...far, ownLeg: new Map([[pairKey(3, 2), 400]]) }, 3, 2)).toEqual({ sec: 400, source: 'own' });
    expect(legSec(far, 3, 2)).toEqual({ sec: 770, source: 'estimate' });
    expect(legSec({ ...far, ownLeg: new Map([[pairKey(2, 3), 400]]) }, 3, 2)).toEqual({ sec: 770, source: 'estimate' });   // the other direction is another pair
    expect(legSec({ ...far, distances: new Map() }, 3, 2)).toEqual({ sec: null, source: null });
  });
});

describe('sellOrContinue: the three that are shown', () => {
  it('never cuts off the place that adds the most, even when three others earn more per hour', () => {
    // B (2), 5 and 6 are near and timed; A (1) pays the most (7200) and nobody knows the way there
    const near = { ...ctx, distances: new Map<string, number | null>([[distKey(3, 2), 10], [distKey(3, 5), 10], [distKey(3, 6), 10]]) };
    const r = sellOrContinue(withManySellers(market), line, 3, 6500, 1200, near);
    expect(r.alternatives).toHaveLength(3);
    expect(r.alternatives.slice(0, 2).every(a => a.extraUecPerHour !== null)).toBe(true);
    expect(r.alternatives[2]).toMatchObject({ destId: 1, extraProfit: 340 * (7200 - 6500), extraUecPerHour: null });
  });

  it('changes nothing when the richest place is already among the three', () => {
    const r = sellOrContinue(withManySellers(market), line, 3, 6500, 1200, ctx);
    expect(r.alternatives.map(a => a.destId)).toEqual([2, 1, 5]);
  });
});
