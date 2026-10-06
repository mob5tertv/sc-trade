import { describe, expect, it } from 'vitest';
import { stripModel } from '../../src/ui/vm/strip';
import { pairKey } from '../../src/core/types';
import type { RunEvent, RunWithEvents } from '../../src/core/types';
import { ev, ref } from '../helpers/factories';
import { active, ctx, GOLD, market, mixedRun, NOW, s, TITA, withOwnSell, withUexSell } from '../helpers/strip-fixtures';

// prices are formatted with a non-breaking space as the thousands separator
const NBSP = String.fromCharCode(0xa0);

const toTarget2 = { ...s, targetTerminalId: 2 };

/** The same run with `extra` events appended. */
const withEvents = (r: RunWithEvents, ...extra: RunEvent[]): RunWithEvents => ({ run: r.run, events: [...r.events, ...extra] });

describe('stripModel', () => {
  it('is idle without a run', () => {
    expect(stripModel(null, market, ref, { ...s, currentTerminalId: 1 }, ctx)).toEqual({ kind: 'idle', location: 'ARC-L1' });
  });
  it('words an unset or unknown location', () => {
    expect(stripModel(null, market, ref, { ...s, currentTerminalId: null }, ctx)).toEqual({ kind: 'idle', location: 'Локация не выбрана' });
    expect(stripModel(null, market, ref, { ...s, currentTerminalId: 777 }, ctx)).toEqual({ kind: 'idle', location: 'Локация не выбрана' });
  });

  it('shows timer, cargo, target, expectation and rate', () => {
    // 96 SCU Gold bought at 6120 at terminal 1, 872 s ago; target 2: UEX 6900 (6400–7100); 1–2: 59 Gm
    expect(stripModel(active, market, ref, toTarget2, ctx)).toEqual({
      kind: 'run', timer: '14:32', cargo: 'GOLD 96 SCU', target: 'TDD Area 18',
      expect: `ждём 6${NBSP}900 (6${NBSP}400–7${NBSP}100)`, rate: '≈ 266k/ч',     // 96×780 = 74 880 per max(872, 1015) s
    });
  });
  it('collapses the range for an own price and omits unknown parts', () => {
    expect(stripModel(active, withOwnSell(market, 2, 10, 6840, NOW - 60), ref, toTarget2, ctx))
      .toMatchObject({ expect: `ждём 6${NBSP}840` });
    expect(stripModel(active, market, ref, { ...s, targetTerminalId: null }, ctx)).toMatchObject({ target: null, expect: null, rate: null });
    expect(stripModel(active, market, ref, { ...s, targetTerminalId: 777 }, ctx)).toMatchObject({ target: null, expect: null, rate: null });
  });
  it('lists mixed cargo', () => {
    expect(stripModel(mixedRun, market, ref, s, ctx)).toMatchObject({ cargo: 'GOLD 96 SCU, TITA 40 SCU' });
  });

  it('ignores a target that is missing from the reference even when the market has a price for it', () => {
    const priced = withUexSell(market, 777, GOLD, 9000);
    expect(stripModel(active, priced, ref, { ...s, targetTerminalId: 777 }, ctx)).toMatchObject({ target: null, expect: null, rate: null });
  });
  it('names the target but has no expectation or rate when the market knows no price there', () => {
    expect(stripModel(active, market, ref, { ...s, targetTerminalId: 3 }, ctx))
      .toMatchObject({ target: 'CRU-L1', expect: null, rate: null });
  });
  it('shows a range that only reaches one way', () => {
    expect(stripModel(active, withUexSell(market, 2, GOLD, 6900, 6900, 7100), ref, toTarget2, ctx))
      .toMatchObject({ expect: `ждём 6${NBSP}900 (6${NBSP}900–7${NBSP}100)` });
  });

  describe('with several commodities', () => {
    const both = withUexSell(market, 2, TITA, 3000);

    it('expects the first commodity and sums the profit of every commodity with an estimate', () => {
      // 96×(6900−6120) + 40×(3000−2500) = 94 880 per 1015 s
      expect(stripModel(mixedRun, both, ref, toTarget2, ctx)).toMatchObject({ expect: `ждём 6${NBSP}900 (6${NBSP}400–7${NBSP}100)`, rate: '≈ 337k/ч' });
    });
    it('leaves the expectation out when only a later commodity has an estimate, but keeps its profit in the rate', () => {
      const titaOnly = withUexSell(withUexSell(market, 2, GOLD, 0), 2, TITA, 3000);
      // GOLD has no usable price (zero average means "no data"); 40×500 = 20 000 per 1015 s
      expect(stripModel(mixedRun, titaOnly, ref, toTarget2, ctx)).toMatchObject({ expect: null, rate: '≈ 71k/ч' });
    });
  });

  describe('time of the rate', () => {
    it('is the estimate of the whole route when it is longer than the elapsed time', () => {
      expect(stripModel(active, market, ref, toTarget2, ctx)).toMatchObject({ rate: '≈ 266k/ч' });   // 1015 s
    });
    it('is my own median for the pair rather than the distance estimate', () => {
      const own = { ...ctx, ownMedian: new Map([[pairKey(1, 2), 1200]]) };
      expect(stripModel(active, market, ref, toTarget2, own)).toMatchObject({ rate: '≈ 225k/ч' });   // 74 880 per 1200 s
    });
    it('is the elapsed time when it exceeds the route estimate', () => {
      const own = { ...ctx, ownMedian: new Map([[pairKey(1, 2), 600]]) };
      expect(stripModel(active, market, ref, toTarget2, own)).toMatchObject({ rate: '≈ 309k/ч' });   // 74 880 per 872 s
    });
    it('is the elapsed time when neither a median nor a distance is known', () => {
      expect(stripModel(active, market, ref, toTarget2, { ...ctx, distances: new Map() })).toMatchObject({ rate: '≈ 309k/ч' });
    });
    it('measures the route from the first purchase', () => {
      const laterBuy = ev({ id: 3, runId: 1, ts: NOW - 300, type: 'buy', terminalId: 3, commodityId: GOLD, scu: 4, price: 6120 });
      // an own median from terminal 3 must not count: the run began at terminal 1
      const own = { ...ctx, ownMedian: new Map([[pairKey(3, 2), 5000]]) };
      expect(stripModel(withEvents(active, laterBuy), market, ref, toTarget2, own)).toMatchObject({ rate: '≈ 277k/ч' });   // 100×780 per 1015 s
    });
    it('does not guess a rate before any time has passed', () => {
      const justStarted: RunWithEvents = { run: { ...active.run, startedAt: NOW }, events: active.events };
      expect(stripModel(justStarted, market, ref, toTarget2, { ...ctx, distances: new Map() })).toMatchObject({ timer: '0:00', rate: null });
      expect(stripModel(justStarted, market, ref, toTarget2, ctx)).toMatchObject({ timer: '0:00', rate: '≈ 266k/ч' });
    });
    it('shows a loss with its sign', () => {
      expect(stripModel(active, withUexSell(market, 2, GOLD, 6000), ref, toTarget2, ctx)).toMatchObject({ rate: '≈ -41k/ч' });   // 96×(−120) per 1015 s
    });
  });

  describe('timer and cargo', () => {
    it('counts hours and never goes negative', () => {
      const long: RunWithEvents = { run: { ...active.run, startedAt: NOW - 3872 }, events: active.events };
      expect(stripModel(long, market, ref, s, ctx)).toMatchObject({ timer: '1:04:32' });
      const future: RunWithEvents = { run: { ...active.run, startedAt: NOW + 30 }, events: active.events };
      expect(stripModel(future, market, ref, s, ctx)).toMatchObject({ timer: '0:00' });
    });
    it('shows only what is still in the hold', () => {
      const soldSome = withEvents(mixedRun, ev({ id: 3, runId: 1, ts: NOW - 100, type: 'sell', terminalId: 2, commodityId: GOLD, scu: 96, price: 6900 }));
      expect(stripModel(soldSome, market, ref, s, ctx)).toMatchObject({ cargo: 'TITA 40 SCU' });
      const soldAll = withEvents(soldSome, ev({ id: 4, runId: 1, ts: NOW - 90, type: 'sell', terminalId: 2, commodityId: TITA, scu: 40, price: 3000 }));
      expect(stripModel(soldAll, market, ref, toTarget2, ctx)).toMatchObject({ cargo: '', target: 'TDD Area 18', expect: null, rate: null });
    });
    it('survives a commodity that left the reference', () => {
      const odd = withEvents(active, ev({ id: 3, runId: 1, ts: NOW - 800, type: 'buy', terminalId: 1, commodityId: 99, scu: 5, price: 100 }));
      expect(stripModel(odd, market, ref, s, ctx)).toMatchObject({ cargo: 'GOLD 96 SCU, #99 5 SCU' });
    });
  });
});
