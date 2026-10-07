import { describe, expect, it } from 'vitest';
import { ownMedianIndex, ownRunCounts, routeStats, sessions } from '../../src/core/stats';
import { pairKey } from '../../src/core/types';
import type { RunWithEvents } from '../../src/core/types';
import { incomeRun } from '../helpers/income-fixtures';
import { R1, R2, R3, R4, R5, R6, withMarks } from '../helpers/stats-fixtures';

describe('routeStats', () => {
  it('groups simple finished runs by route', () => {
    const s = routeStats([R1, R2, R3, R4, R5, R6]);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ originId: 1, destId: 2, commodityId: 10, runs: 2, medianDurationSec: 2100, totalProfit: 545_000 });
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
