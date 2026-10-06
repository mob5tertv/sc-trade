import { describe, expect, it } from 'vitest';
import { sellOrContinue } from '../../src/core/sell';
import { distKey, pairKey } from '../../src/core/types';
import { withOwnSellScu, withUexSellScu } from '../helpers/route-fixtures';
import { line, sellCtx as ctx, sellMarket as market, withManySellers } from '../helpers/run-fixtures';

// Cargo: Gold 340 SCU at 6120. The player stands at C (3), the real price is 6500, 1200 s have passed.
// B (2): UEX 6900 (6400–7100); C–B 10 Gm. D (4) pays 9000 but is in another system.
// The quantity on a SELL side is the buyer's inventory (spec 14.5): the whole cargo is compared, whatever it is.
describe('sellOrContinue', () => {
  it('compares selling here with flying on', () => {
    const r = sellOrContinue(market, { commodityId: 10, scu: 340, avgBuyPrice: 6120 }, 3, 6500, 1200, ctx);
    expect(r.here).toMatchObject({ qty: 340, profit: 129_200, uecPerHour: 387_600 });
    expect(r.here.roi).toBeCloseTo(0.06209, 4);
    expect(r.alternatives).toHaveLength(1);
    expect(r.alternatives[0]).toMatchObject({ destId: 2, qty: 340, expectedProfit: 265_200, extraSec: 770 });
    expect(Math.round(r.alternatives[0].expectedUecPerHour!)).toBe(484_629);
    expect(Math.round(r.alternatives[0].worstUecPerHour!)).toBe(173_970);
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

  it('excludes the current terminal, caps at three, and puts untimed options last', () => {
    const r = sellOrContinue(withManySellers(market), line, 3, 6500, 1200, { ...ctx, distances: new Map([[distKey(3, 2), 10]]) });
    expect(r.alternatives).toHaveLength(3);
    expect(r.alternatives.every(a => a.destId !== 3)).toBe(true);
    expect(r.alternatives[0].destId).toBe(2); expect(r.alternatives.at(-1)!.expectedUecPerHour).toBeNull();
  });

  it('orders the untimed options by expected profit', () => {
    const r = sellOrContinue(withManySellers(market), line, 3, 6500, 1200, ctx);
    expect(r.alternatives.map(a => a.destId)).toEqual([2, 1, 5]);
    expect(r.alternatives.map(a => a.extraSec)).toEqual([770, null, null]);
    expect(r.alternatives.map(a => a.worstUecPerHour)).toEqual([expect.any(Number), null, null]);
  });

  it('returns no rate for a zero elapsed time', () => expect(sellOrContinue(market, line, 3, 6500, 0, ctx).here.uecPerHour).toBeNull());

  it('counts a negative elapsed time as zero', () => {
    const r = sellOrContinue(market, line, 3, 6500, -50, ctx);
    expect(r.here.uecPerHour).toBeNull();
    expect(r.alternatives[0].expectedUecPerHour).toBeCloseTo((265_200 * 3600) / 770, 6);
  });

  it('leaves the rate empty when the flight time is unknown', () => {
    const r = sellOrContinue(market, line, 3, 6500, 1200, { ...ctx, distances: new Map() });
    expect(r.alternatives[0]).toMatchObject({ destId: 2, extraSec: null, expectedUecPerHour: null, worstUecPerHour: null });
  });

  it('prefers my own median time for the pair', () => {
    const r = sellOrContinue(market, line, 3, 6500, 1200, { ...ctx, ownMedian: new Map([[pairKey(3, 2), 400]]) });
    expect(r.alternatives[0]).toMatchObject({ extraSec: 400 });
    expect(r.alternatives[0].expectedUecPerHour).toBeCloseTo((265_200 * 3600) / 1600, 6);
  });

  it('applies the system filter and skips terminals missing from the reference', () => {
    const wide = { ...ctx, settings: { ...ctx.settings, starSystemId: null } };
    expect(sellOrContinue(market, line, 3, 6500, 1200, wide).alternatives.map(a => a.destId)).toEqual([2, 4]);
    const terminals = new Map(ctx.terminals);
    terminals.delete(2);
    expect(sellOrContinue(market, line, 3, 6500, 1200, { ...wide, terminals }).alternatives.map(a => a.destId)).toEqual([4]);
  });

  it('finds no alternatives from a terminal missing from the reference', () => {
    const terminals = new Map(ctx.terminals);
    terminals.delete(3);
    expect(sellOrContinue(market, line, 3, 6500, 1200, { ...ctx, terminals }).alternatives).toEqual([]);
  });

  it('keeps alternatives that lose money when selling here loses too', () => {
    const r = sellOrContinue(market, { ...line, avgBuyPrice: 7000 }, 3, 6500, 1200, ctx);
    expect(r.here.profit).toBe(-170_000);
    expect(r.alternatives[0]).toMatchObject({ destId: 2, expectedProfit: -34_000 });
  });
});
