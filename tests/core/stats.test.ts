import { describe, expect, it } from 'vitest';
import { ownMedianIndex, ownRunCounts, routeStats, sessions } from '../../src/core/stats';
import { pairKey } from '../../src/core/types';
import type { RunWithEvents } from '../../src/core/types';
import { incomeRun } from '../helpers/income-fixtures';
import { GOLD, MIX1, MIX2, MIX3, TITA, TUNG, mixedRun } from '../helpers/mixed-fixtures';
import { R1, R2, R3, R4, R5, R6, withMarks } from '../helpers/stats-fixtures';

describe('routeStats', () => {
  it('groups simple finished runs by route', () => {
    const s = routeStats([R1, R2, R3, R4, R5, R6]);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ originId: 1, destId: 2, commodityIds: [10], runs: 2, medianDurationSec: 2100, totalProfit: 545_000 });
    expect(s[0].avgRoi).toBeCloseTo(0.1207, 4);
    expect(Math.round(s[0].uecPerHour!)).toBe(467_143);
    expect(s[1]).toMatchObject({ destId: 3, runs: 1, uecPerHour: 180_000 });
  });

  it('takes phase medians only from runs that have marks', () => {
    expect(routeStats([R1, withMarks(R2, 300, 1000, 500)])[0].medianPhases).toEqual({ loadingSec: 300, flightSec: 1000, unloadingSec: 500 });
    expect(routeStats([R1, R2])[0].medianPhases).toBeNull();
  });

  it('takes the median of each phase over several runs with marks', () => {
    const marked = [withMarks(R1, 100, 2000, 300), withMarks(R2, 300, 1000, 500)];
    expect(routeStats(marked)[0].medianPhases).toEqual({ loadingSec: 200, flightSec: 1500, unloadingSec: 400 });
  });

  it('ranks routes by UEC per hour and puts a route without time last', () => {
    const instant: RunWithEvents = { ...R3, run: { ...R3.run, startedAt: 21000 } };
    const s = routeStats([instant, R1]);
    expect(s.map(r => r.destId)).toEqual([2, 3]);
    expect(s[1]).toMatchObject({ runs: 1, medianDurationSec: 0, totalProfit: 50_000, uecPerHour: null });
  });

  it('handles no data', () => expect(routeStats([])).toEqual([]));
});

describe('ownMedianIndex and ownRunCounts', () => {
  it('indexes my median time and run count by direction', () => {
    expect(ownMedianIndex([R1, R2, R3]).get(pairKey(1, 2))).toBe(2100);
    expect(ownMedianIndex([R1, R2, R3]).has(pairKey(2, 1))).toBe(false);
    expect(ownRunCounts([R1, R2, R3]).get(pairKey(1, 2))).toBe(2);
  });

  it('pools all commodities of a direction and skips unfinished or composite runs', () => {
    const titanium: RunWithEvents = {
      run: { ...R3.run, id: 7, startedAt: 30000, endedAt: 30500 },
      events: R2.events.map(e => ({ ...e, runId: 7, commodityId: 20 })),
    };
    const all = [R1, R2, titanium, R4, R5, R6];
    expect(ownMedianIndex(all).get(pairKey(1, 2))).toBe(1800);
    expect(ownRunCounts(all).get(pairKey(1, 2))).toBe(3);
    expect([...ownRunCounts(all).keys()]).toEqual([pairKey(1, 2)]);
  });

  it('handles no data', () => {
    expect(ownMedianIndex([]).size).toBe(0);
    expect(ownRunCounts([]).size).toBe(0);
  });
});

describe('sessions', () => {
  it('splits sessions on gaps longer than two hours and includes losses', () => {
    const s = sessions([1000, 3400, 10000, 11800, 12000, 12500, 30000], [R1, R2, R4]);
    expect(s).toHaveLength(2);
    expect(s[1]).toMatchObject({ startTs: 1000, endTs: 12500, runIds: [1, 2, 4], profit: 445_000 });
    expect(Math.round(s[1].uecPerHour!)).toBe(139_304);          // 445 000 за 11 500 с
    expect(s[0]).toMatchObject({ startTs: 30000, endTs: 30000, profit: 0, uecPerHour: null });
  });

  it('keeps one session when the gap is exactly two hours', () => {
    expect(sessions([1000, 8200], [])).toHaveLength(1);
    expect(sessions([1000, 8201], [])).toHaveLength(2);
  });

  it('accepts unsorted timestamps and a custom gap', () => {
    expect(sessions([3400, 1000, 12500], [])).toHaveLength(2);
    expect(sessions([3400, 1000, 12500], [], 10_000)).toHaveLength(1);
  });

  it('counts only finished runs that start inside the session', () => {
    const s = sessions([49_000, 51_000, 60_000], [R1, R6]);
    expect(s[1]).toMatchObject({ startTs: 49_000, endTs: 51_000, runIds: [], profit: 0, uecPerHour: 0 });
  });

  it('handles no data', () => expect(sessions([], [])).toEqual([]));
});

describe('a sale without a purchase (income, task 32)', () => {
  const income = incomeRun(7, 2000, 120, 3700);                   // 444 000 at second 2000, inside the span of R1

  it('is not a route: the rating, the medians and the counts of the pairs do not see it', () => {
    const others = [R1, R2, R3, R4, R5, R6];
    const all = [...others, income];
    expect(routeStats(all)).toEqual(routeStats(others));
    expect(ownMedianIndex(all)).toEqual(ownMedianIndex(others));
    expect(ownRunCounts(all)).toEqual(ownRunCounts(others));
    expect(routeStats([income])).toEqual([]);
    expect(ownMedianIndex([income]).size).toBe(0);
    expect(ownRunCounts([income]).size).toBe(0);
  });

  it('is in the profit of its session, and no number of the session is NaN', () => {
    const s = sessions([1000, 2000, 3400], [R1, income]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ runIds: [1, 7], profit: 345_000 + 444_000 });
    expect(s[0].uecPerHour).toBeCloseTo((789_000 * 3600) / 2400, 6);
    const alone = sessions([2000], [income]);
    expect(alone[0]).toMatchObject({ runIds: [7], profit: 444_000, uecPerHour: null });       // one moment: no span to divide by
  });

  it('is not a run of its session: runCount counts the runs, runIds and the profit keep every finished run', () => {
    const s = sessions([1000, 2000, 3400], [R1, income]);
    expect(s[0]).toMatchObject({ runIds: [1, 7], runCount: 1, profit: 789_000 });
    expect(sessions([2000], [income])[0]).toMatchObject({ runIds: [7], runCount: 0, profit: 444_000 });   // a session of incomes only: no run, but a profit
  });

  it('counts the done and the lost runs and no income, wherever the incomes stand among them', () => {
    const later = incomeRun(8, 12_200, 10, 100);                   // after the lost R4 (12000-12500)
    const s = sessions([1000, 2000, 3400, 10000, 11800, 12000, 12200, 12500], [R1, R2, R4, later, income]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ runIds: [1, 7, 2, 4, 8], runCount: 3, profit: 345_000 + 444_000 + 200_000 - 100_000 + 1000 });
  });

  it('has a run count of zero for a session without runs', () => {
    expect(sessions([30_000], [])[0]).toMatchObject({ runIds: [], runCount: 0, profit: 0 });
  });
});

describe('a run of several commodities between two terminals (task 51)', () => {
  /** The run with the purchase or the sale at `index` (counting the purchases or the sales only) moved to another terminal. */
  const moved = (r: RunWithEvents, type: 'buy' | 'sell', index: number, terminalId: number): RunWithEvents => {
    const same = r.events.filter(e => e.type === type);
    return { run: r.run, events: r.events.map(e => (e === same[index] ? { ...e, terminalId } : e)) };
  };
  const GOODS = [{ commodityId: GOLD, scu: 10, buy: 100, sell: 120 }, { commodityId: TITA, scu: 10, buy: 100, sell: 120 }];

  it('has its own row: two runs of the same set on the same route are one row of two runs, whatever the order of the goods', () => {
    const s = routeStats([MIX1, MIX2]);                              // MIX2 bought and sold the Titanium first: the set does not care
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ originId: 1, destId: 2, commodityIds: [GOLD, TITA], runs: 2, totalProfit: 156_000, medianDurationSec: 1500 });
  });

  it('counts the numbers of the row over the whole runs, by the rules of a simple route', () => {
    const [row] = routeStats([MIX1, MIX2]);
    expect(row.avgRoi).toBeCloseTo((100_000 / 900_000 + 56_000 / 720_000) / 2, 10);
    expect(row.uecPerHour).toBeCloseTo((156_000 * 3600) / 3000, 6);       // the total profit over the total time
    expect(row.medianPhases).toBeNull();                                  // neither run has marks
  });

  it('takes the phases of the row from the runs that have both marks', () => {
    const early = mixedRun({ id: 14, startedAt: 30_000, endedAt: 31_000, legs: GOODS, marks: [200, 500] });
    const late = mixedRun({ id: 15, startedAt: 40_000, endedAt: 42_000, legs: [...GOODS].reverse(), marks: [400, 900] });
    const s = routeStats([early, MIX1, late]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ runs: 3, medianPhases: { loadingSec: 300, flightSec: 700, unloadingSec: 500 } });   // the two runs with marks: (200, 500, 300) and (400, 900, 700)
  });

  it('is another row for another set of goods on the same route', () => {
    const s = routeStats([MIX1, MIX2, MIX3]);
    expect(s).toHaveLength(2);
    expect(s.map(r => r.commodityIds)).toEqual([[GOLD, TITA], [GOLD, TUNG]]);          // by the rate: 187 200 and 105 000 per hour
    expect(s.map(r => r.runs)).toEqual([2, 1]);
  });

  it('is another row for a run of one of the goods: the set is the whole set', () => {
    const s = routeStats([MIX1, R1]);
    expect(s.map(r => r.commodityIds)).toEqual([[GOLD], [GOLD, TITA]]);                // by the rate: 517 500 and 180 000 per hour
    expect(s.map(r => r.runs)).toEqual([1, 1]);
  });

  it('is two rows beside a simple run on the same route, and the simple row has the numbers it had', () => {
    const alone = routeStats([R1, R2]);
    const together = routeStats([R1, MIX1, R2, MIX2]);
    expect(together).toHaveLength(2);
    expect(together.find(r => r.commodityIds.length === 1)).toEqual(alone[0]);
  });

  it('is not a route when it bought at two terminals', () => {
    expect(routeStats([moved(MIX1, 'buy', 1, 3)])).toEqual([]);
  });

  it('is not a route when it sold at two terminals', () => {
    expect(routeStats([moved(MIX1, 'sell', 0, 3)])).toEqual([]);
  });

  it('is not a route when it bought and sold at the same terminal', () => {
    expect(routeStats([mixedRun({ id: 16, startedAt: 1, endedAt: 100, from: 2, to: 2, legs: GOODS })])).toEqual([]);
  });

  it('is not a route when it is lost or still going, even when it sold a part of the goods', () => {
    const lost = { run: { ...MIX1.run, status: 'lost' as const }, events: MIX1.events.slice(0, 3) };      // both bought, one sold
    const lostAll = { run: { ...MIX1.run, status: 'lost' as const }, events: MIX1.events };
    const going = { run: { ...MIX1.run, status: 'active' as const, endedAt: null }, events: MIX1.events };
    expect(routeStats([lost, lostAll, going])).toEqual([]);
    expect(ownMedianIndex([lost, lostAll, going]).size).toBe(0);
    expect(ownRunCounts([lost, lostAll, going]).size).toBe(0);
  });

  describe('is a sample of the time of its pair, once (my medians feed the estimates)', () => {
    const pair = pairKey(1, 2);

    it('gives the pair its time, the way a simple run does', () => {
      expect(ownMedianIndex([MIX1]).get(pair)).toBe(2000);
      expect(ownRunCounts([MIX1]).get(pair)).toBe(1);
    });

    it('counts a run of three commodities as one run, not as three', () => {
      const three = mixedRun({ id: 18, startedAt: 50_000, endedAt: 50_900, legs: [...GOODS, { commodityId: TUNG, scu: 10, buy: 100, sell: 120 }] });
      expect(ownRunCounts([three]).get(pair)).toBe(1);
      expect(ownMedianIndex([three]).get(pair)).toBe(900);
      expect(routeStats([three])[0]).toMatchObject({ commodityIds: [GOLD, TITA, TUNG], runs: 1 });
    });

    it('is pooled with the simple runs of the pair: the median is over all of them, each run once', () => {
      const all = [R1, R2, MIX1, MIX2, MIX3];                         // 2400, 1800, 2000, 1000, 1200 seconds
      expect(ownRunCounts(all).get(pair)).toBe(5);
      expect(ownMedianIndex(all).get(pair)).toBe(1800);
      expect([...ownRunCounts(all).keys()]).toEqual([pair]);
    });

    it('is the same number of runs as the rows of the pair add up to', () => {
      const all = [R1, R2, MIX1, MIX2, MIX3];
      expect(routeStats(all).reduce((sum, r) => sum + r.runs, 0)).toBe(ownRunCounts(all).get(pair));
    });

    it('is no sample of any pair when it bought at two terminals', () => {
      expect(ownMedianIndex([moved(MIX1, 'buy', 1, 3)]).size).toBe(0);
      expect(ownRunCounts([moved(MIX1, 'buy', 1, 3)]).size).toBe(0);
    });
  });

  it('is in the profit of its session, as it was before the rating took it', () => {
    expect(sessions([1000, 3000], [MIX1])[0]).toMatchObject({ runIds: [11], runCount: 1, profit: 100_000 });
  });
});
