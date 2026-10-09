import { describe, expect, it } from 'vitest';
import type { RunEvent, RunWithEvents } from '../../src/core/types';
import { runOutlook } from '../../src/ui/vm/run-outlook';
import { stripModel } from '../../src/ui/vm/strip';
import { ev, ref } from '../helpers/factories';
import { active, ctx, GOLD, market, mixedRun, NOW, s, withUexSell } from '../helpers/strip-fixtures';

// prices are formatted with a non-breaking space as the thousands separator
const NBSP = String.fromCharCode(0xa0);
const n = (text: string): string => text.replace(/ /g, NBSP);

const toTarget2 = { ...s, targetTerminalId: 2 };

/** The same run with `extra` events appended. */
const withEvents = (r: RunWithEvents, ...extra: RunEvent[]): RunWithEvents => ({ run: r.run, events: [...r.events, ...extra] });
const sale = (id: number, scu: number, price: number): RunEvent => ev({ id, runId: 1, ts: NOW - 300, type: 'sell', terminalId: 2, commodityId: GOLD, scu, price });

// 96 SCU Gold bought at 6120 (587 520 UEC) 872 s ago; the target 2 pays 6900 (UEX); the flight 1-2 takes 1015 s.
describe('runOutlook, nothing sold yet', () => {
  const o = runOutlook(active, market, ref, toTarget2, ctx);

  it('keeps the facts: what is put in and what is already sold', () => {
    expect(o.invested).toBe(n('587 520'));
    expect(o.revenue).toBe('0');
  });
  it('expects the whole run at the price of the target: profit, ROI and rate, each marked with ≈', () => {
    // 96 × 6900 − 587 520 = 74 880; ROI 12.7 %; over max(872, 1015) s: 265 592 UEC/h
    expect(o.expected).toEqual({ profit: `≈ ${n('74 880')}`, profitLoss: false, roi: '≈ 13%', rate: '≈ 266k' });
    expect(o.why).toBeNull();
  });
  it('gives the very rate the mini line gives (they share the arithmetic)', () => {
    const strip = stripModel(active, market, ref, toTarget2, ctx);
    if (strip.kind !== 'run') throw new Error('a run was expected');
    expect(`${o.expected?.rate.replace('≈ ', '')}/ч`).toBe(strip.rate);   // the line puts the '≈' before the profit
  });
});

describe('runOutlook, partly sold', () => {
  // 40 SCU sold at 6800 = 272 000 already in hand; 56 SCU still aboard at 6900
  const partly = withEvents(active, sale(5, 40, 6800));
  const o = runOutlook(partly, market, ref, toTarget2, ctx);

  it('counts what is sold as it is and the rest of the hold at the price of the target', () => {
    expect(o.revenue).toBe(n('272 000'));
    expect(o.invested).toBe(n('587 520'));
    // 272 000 + 56 × 6900 − 587 520 = 70 880
    expect(o.expected).toMatchObject({ profit: `≈ ${n('70 880')}`, profitLoss: false, roi: '≈ 12%' });
  });
});

describe('runOutlook, no target', () => {
  it('has dashes and says to choose one; the facts stay', () => {
    const o = runOutlook(active, market, ref, { ...s, targetTerminalId: null }, ctx);
    expect(o).toEqual({ invested: n('587 520'), revenue: '0', expected: null, why: 'выбери цель' });
  });
  it('treats a target that left the reference as no target', () => {
    expect(runOutlook(active, market, ref, { ...s, targetTerminalId: 777 }, ctx)).toMatchObject({ expected: null, why: 'выбери цель' });
  });
});

describe('runOutlook, the target pays for one of two commodities only', () => {
  it('has dashes, because the profit of the whole run is not known, and says what is missing', () => {
    // 96 Gold are priced at 2, 40 Titanium are not: a sum of the one is not "the whole run"
    const o = runOutlook(mixedRun, market, ref, toTarget2, ctx);
    expect(o.expected).toBeNull();
    expect(o.why).toBe('нет цены в точке цели');
    expect(o.invested).toBe(n('687 520'));
  });
});

describe('runOutlook, an expected loss', () => {
  it('is red (profitLoss) only here, with its sign', () => {
    const cheap = withUexSell(market, 2, GOLD, 6000);
    // 96 × 6000 − 587 520 = −11 520
    const o = runOutlook(active, cheap, ref, toTarget2, ctx);
    expect(o.expected).toMatchObject({ profit: `≈ -${n('11 520')}`, profitLoss: true, roi: '≈ -2%' });
    expect(o.expected?.rate).toBe('≈ -41k');
  });
  it('is not red for a run that is not a loss, whatever has been sold so far', () => {
    expect(runOutlook(active, market, ref, toTarget2, ctx).expected?.profitLoss).toBe(false);
  });
});

describe('runOutlook, the time of the run', () => {
  const unknownFlight = { ...ctx, distances: new Map<string, number | null>() };

  it('has no rate before any time is known, but still the profit and the ROI', () => {
    const justStarted: RunWithEvents = { run: { ...active.run, startedAt: NOW }, events: active.events };
    expect(runOutlook(justStarted, market, ref, toTarget2, unknownFlight).expected)
      .toEqual({ profit: `≈ ${n('74 880')}`, profitLoss: false, roi: '≈ 13%', rate: '—' });
  });
  it('has no rate while the flight to the target is not known, however much time has passed since the purchase', () => {
    // 872 s have passed, and the rate of "74 880 per 872 s" would say the flight is over
    expect(runOutlook(active, market, ref, toTarget2, unknownFlight).expected)
      .toEqual({ profit: `≈ ${n('74 880')}`, profitLoss: false, roi: '≈ 13%', rate: '—' });
  });
  it('has the rate over the elapsed time once the arrival is marked, whatever is known of the flight', () => {
    const arrived = withEvents(active, ev({ id: 5, runId: 1, ts: NOW - 600, type: 'depart' }), ev({ id: 6, runId: 1, ts: NOW - 125, type: 'arrive' }));
    expect(runOutlook(arrived, market, ref, toTarget2, unknownFlight).expected?.rate).toBe('≈ 309k');   // 74 880 per 872 s
  });
  it('has the very rate the mini line gives for a run that is partly sold: the whole run counts, not the hold alone', () => {
    const partly = withEvents(active, sale(5, 40, 6800));
    const strip = stripModel(partly, market, ref, toTarget2, ctx);
    if (strip.kind !== 'run') throw new Error('a run was expected');
    expect(runOutlook(partly, market, ref, toTarget2, ctx).expected?.rate).toBe('≈ 251k');   // 70 880 per 1015 s
    expect(strip.rate).toBe('251k/ч');   // the card says '≈ 251k', the line puts its '≈' before the profit
  });
});

describe('runOutlook, edges', () => {
  it('is the result so far for a hold that is empty (nothing to price at a target)', () => {
    const empty = withEvents(active, sale(5, 96, 6900));
    // 96 × 6900 − 587 520 = 74 880, whatever the target is
    expect(runOutlook(empty, market, ref, { ...s, targetTerminalId: null }, ctx).expected)
      .toMatchObject({ profit: `≈ ${n('74 880')}`, profitLoss: false });
  });
});
