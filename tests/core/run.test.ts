import { describe, expect, it } from 'vitest';
import { cargoOf, isIncomeRun, phases, runTotals, simpleRoute } from '../../src/core/run';
import { ev, run } from '../helpers/factories';
import { incomeRun } from '../helpers/income-fixtures';

const buy = (ts: number, scu: number, price: number, terminalId = 1, commodityId = 10) => ev({ ts, type: 'buy', terminalId, commodityId, scu, price });
const sell = (ts: number, scu: number, price: number, terminalId = 2, commodityId = 10) => ev({ ts, type: 'sell', terminalId, commodityId, scu, price });
const E = [buy(1000, 300, 6000), buy(1100, 100, 6400), sell(3000, 150, 6900), sell(3400, 250, 7000)];

describe('cargoOf', () => {
  it('derives cargo with a weighted buy price', () => {
    expect(cargoOf(E.slice(0, 2))).toEqual([{ commodityId: 10, scu: 400, avgBuyPrice: 6100 }]);
    expect(cargoOf(E.slice(0, 3))).toEqual([{ commodityId: 10, scu: 250, avgBuyPrice: 6100 }]);
    expect(cargoOf(E)).toEqual([]);
  });

  it('never reports negative cargo', () => expect(cargoOf([buy(1, 400, 6000), sell(2, 500, 7000)])).toEqual([]));

  it('keeps each commodity apart and ignores marks', () => {
    const events = [buy(1, 100, 1000, 1, 10), ev({ ts: 2, type: 'depart' }), buy(3, 50, 2000, 1, 20), sell(4, 30, 3000, 2, 20)];
    expect(cargoOf(events)).toEqual([
      { commodityId: 10, scu: 100, avgBuyPrice: 1000 },
      { commodityId: 20, scu: 20, avgBuyPrice: 2000 },
    ]);
  });

  it('skips trade events with missing fields', () => {
    const broken = [
      ev({ ts: 1, type: 'buy', commodityId: 10, scu: null, price: 6000 }),
      ev({ ts: 2, type: 'buy', commodityId: null, scu: 5, price: 6000 }),
      ev({ ts: 3, type: 'buy', commodityId: 10, scu: 5, price: null }),
    ];
    expect(cargoOf([...broken, buy(4, 10, 100)])).toEqual([{ commodityId: 10, scu: 10, avgBuyPrice: 100 }]);
  });
});

describe('runTotals', () => {
  it('totals a finished run', () => {
    const t = runTotals(run({ startedAt: 1000, endedAt: 3400, status: 'done' }), E, 9999);
    expect(t).toMatchObject({ invested: 2_440_000, revenue: 2_785_000, profit: 345_000, durationSec: 2400, uecPerHour: 517_500 });
    expect(t.roi).toBeCloseTo(0.14139, 4);
  });

  it('uses now for an active run', () => expect(runTotals(run({ startedAt: 1000, endedAt: null }), E.slice(0, 2), 2200).durationSec).toBe(1200));

  it('survives zero and negative duration and zero investment', () => {
    expect(runTotals(run({ startedAt: 1000, endedAt: 1000 }), E, 0)).toMatchObject({ durationSec: 0, uecPerHour: null });
    expect(runTotals(run({ startedAt: 1000, endedAt: 900 }), E, 0)).toMatchObject({ durationSec: 0, uecPerHour: null });
    expect(runTotals(run({ startedAt: 1000, endedAt: 2000 }), [], 0)).toMatchObject({ invested: 0, roi: null });
  });

  it('reports a loss for a run that lost its cargo', () => {
    const t = runTotals(run({ startedAt: 1000, endedAt: 1900, status: 'lost' }), E.slice(0, 3), 0);
    expect(t).toMatchObject({ invested: 2_440_000, revenue: 1_035_000, profit: -1_405_000, durationSec: 900, uecPerHour: -5_620_000 });
  });

  it('counts only trades with a quantity and a price', () => {
    const broken = ev({ ts: 1, type: 'buy', terminalId: 1, commodityId: 10, scu: null, price: 6000 });
    expect(runTotals(run({ startedAt: 0, endedAt: 10 }), [broken, buy(2, 10, 100)], 0)).toMatchObject({ invested: 1000 });
  });
});

describe('simpleRoute', () => {
  it('recognises a simple route', () => {
    expect(simpleRoute(E)).toEqual({ originId: 1, destId: 2, commodityId: 10 });
    expect(simpleRoute([...E, sell(3500, 1, 1, 3)])).toBeNull();
    expect(simpleRoute([...E, buy(1200, 1, 1, 1, 11)])).toBeNull();
    expect(simpleRoute(E.slice(0, 2))).toBeNull();
  });

  it('is not a route when the purchase and the sale are at the same terminal', () => {
    expect(simpleRoute([buy(1, 10, 100, 1), sell(2, 10, 120, 1)])).toBeNull();
  });

  it('ignores marks and refuses trades it cannot place', () => {
    expect(simpleRoute([E[0], ev({ ts: 1200, type: 'depart' }), E[3]])).toEqual({ originId: 1, destId: 2, commodityId: 10 });
    expect(simpleRoute([E[0], ev({ ts: 5, type: 'sell', terminalId: null, commodityId: 10, scu: 1, price: 1 })])).toBeNull();
  });
});

describe('phases', () => {
  it('splits phases only with exactly one ordered depart and arrive', () => {
    const marks = [buy(1000, 100, 6000), ev({ ts: 1300, type: 'depart' }), ev({ ts: 2900, type: 'arrive' }), sell(3400, 100, 7000)];
    expect(phases(marks)).toEqual({ loadingSec: 300, flightSec: 1600, unloadingSec: 500 });
    expect(phases(marks.filter(e => e.type !== 'arrive'))).toBeNull();
    expect(phases([...marks, ev({ ts: 1400, type: 'depart' })])).toBeNull();
    expect(phases([marks[0], { ...marks[2], ts: 1200 }, { ...marks[1], ts: 1300 }, marks[3]])).toBeNull();
  });

  it('measures loading from the first purchase and unloading to the last sale', () => {
    const marks = [
      buy(1000, 100, 6000), buy(1100, 100, 6000), ev({ ts: 1300, type: 'depart' }), ev({ ts: 2900, type: 'arrive' }),
      sell(3000, 100, 7000), sell(3400, 100, 7000),
    ];
    expect(phases(marks)).toEqual({ loadingSec: 300, flightSec: 1600, unloadingSec: 500 });
  });

  it('has no phases for a run that is not a simple route', () => {
    const marks = [buy(1000, 100, 6000), ev({ ts: 1300, type: 'depart' }), ev({ ts: 2900, type: 'arrive' }), sell(3400, 100, 7000)];
    expect(phases([...marks, sell(3500, 1, 1, 3)])).toBeNull();
    expect(phases(marks.slice(0, 3))).toBeNull();
  });

  it('rejects marks outside the loading and unloading window', () => {
    const early = [buy(1000, 100, 6000), ev({ ts: 900, type: 'depart' }), ev({ ts: 2900, type: 'arrive' }), sell(3400, 100, 7000)];
    const late = [buy(1000, 100, 6000), ev({ ts: 1300, type: 'depart' }), ev({ ts: 3500, type: 'arrive' }), sell(3400, 100, 7000)];
    expect(phases(early)).toBeNull();
    expect(phases(late)).toBeNull();
  });
});

describe('a run of one sale and no purchase (income, task 32)', () => {
  const income = incomeRun(1, 5000, 120, 3700);

  it('has nothing invested, the profit is the revenue, and there is no ROI and no rate to divide by', () => {
    const t = runTotals(income.run, income.events, 9999);
    expect(t).toEqual({ invested: 0, revenue: 444_000, profit: 444_000, roi: null, durationSec: 0, uecPerHour: null });
    for (const value of Object.values(t)) expect(Number.isNaN(value)).toBe(false);
  });

  it('is the same wherever "now" is: a finished run does not grow', () => {
    expect(runTotals(income.run, income.events, 5000)).toEqual(runTotals(income.run, income.events, 99_999));
  });

  it('leaves nothing in the hold, is no route and has no phases', () => {
    expect(cargoOf(income.events)).toEqual([]);
    expect(simpleRoute(income.events)).toBeNull();
    expect(phases(income.events)).toBeNull();
  });
});

describe('isIncomeRun', () => {
  it('is a run with at least one sale and no purchase at all', () => {
    expect(isIncomeRun(incomeRun(1, 5000, 120, 3700).events)).toBe(true);
    expect(isIncomeRun([sell(5000, 10, 3700), sell(5001, 5, 3800, 3, 11)])).toBe(true);                // several sales, still no purchase
    expect(isIncomeRun([sell(5000, 10, 3700), ev({ ts: 5001, type: 'depart' })])).toBe(true);           // marks are no trades
  });

  it('is not a run that bought, whatever it sold', () => {
    expect(isIncomeRun(E)).toBe(false);                                                                   // bought and sold
    expect(isIncomeRun(E.slice(0, 2))).toBe(false);                                                       // only bought: cargo still aboard or lost
    expect(isIncomeRun([buy(1000, 10, 100), sell(2000, 10, 120)])).toBe(false);
    expect(isIncomeRun([sell(1500, 10, 120), buy(1000, 10, 100)])).toBe(false);                           // the order of the list does not matter
  });

  it('is not a run without a sale', () => {
    expect(isIncomeRun([])).toBe(false);
    expect(isIncomeRun([ev({ ts: 1, type: 'depart' }), ev({ ts: 2, type: 'arrive' })])).toBe(false);
  });

  it('counts only trades with a commodity, a quantity and a price, as every number of the run does', () => {
    const noPrice = ev({ ts: 5, type: 'sell', terminalId: 2, commodityId: 10, scu: 10, price: null });
    const noQuantity = ev({ ts: 5, type: 'buy', terminalId: 1, commodityId: 10, scu: null, price: 100 });
    expect(isIncomeRun([noPrice])).toBe(false);                                                           // not a sale
    expect(isIncomeRun([noQuantity, sell(6, 10, 100)])).toBe(true);                                       // not a purchase
  });
});
