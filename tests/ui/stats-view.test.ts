import { describe, expect, it } from 'vitest';
import { pairKey } from '../../src/core/types';
import { routeRows } from '../../src/ui/vm/stats-rows';
import { routesSummary, STATS_VIEWS, figuresOf, EMPTY_FIGURES, EMPTY_HISTORY } from '../../src/ui/vm/stats-view';
import { routeStats } from '../../src/core/stats';
import { ref } from '../helpers/factories';
import { R1, R2, R3, R4, R5, R6 } from '../helpers/stats-fixtures';
import { stat } from '../helpers/stats-rows-fixtures';

describe('routesSummary', () => {
  it('says there is nothing yet before the first finished run', () => {
    expect(routesSummary([])).toBe('пока нет завершённых рейсов');
  });

  it('names the best route and its rate', () => {
    const rows = routeRows(routeStats([R1, R2, R3]), ref);
    expect(routesSummary(rows)).toBe('ARC-L1 → TDD Area 18 · 467k/ч');
  });

  it('takes the first row: the statistics deliver the best rate first', () => {
    const rows = routeRows([{ ...stat, destId: 3, uecPerHour: 310_000 }, { ...stat, uecPerHour: 120_000 }], ref);
    expect(routesSummary(rows)).toBe('ARC-L1 → CRU-L1 · 310k/ч');
  });

  it('names only the route when it has no rate', () => {
    const rows = routeRows([{ ...stat, uecPerHour: null }], ref);
    expect(routesSummary(rows)).toBe('ARC-L1 → TDD Area 18');
  });
});

describe('the lists of the section', () => {
  it('are three, in the order the switch shows them, with Russian names', () => {
    expect(STATS_VIEWS.map((v) => [v.id, v.label])).toEqual([['routes', 'Маршруты'], ['history', 'История'], ['sessions', 'Сессии']]);
  });
});

describe('figuresOf', () => {
  it('is empty without history', () => {
    expect(figuresOf(EMPTY_HISTORY)).toEqual(EMPTY_FIGURES);
    expect(EMPTY_FIGURES.stats).toEqual([]);
    expect(EMPTY_FIGURES.ownMedian.size).toBe(0);
    expect(EMPTY_FIGURES.runCounts.size).toBe(0);
    expect(EMPTY_FIGURES.sessions).toEqual([]);
  });

  it('holds my median time and my run count per direction, from the finished simple runs only', () => {
    const f = figuresOf({ runs: [R6, R5, R4, R3, R2, R1], recordTs: [] });
    expect(f.ownMedian.get(pairKey(1, 2))).toBe(2100);
    expect(f.ownMedian.get(pairKey(1, 3))).toBe(1000);
    expect(f.ownMedian.has(pairKey(2, 1))).toBe(false);
    expect(f.runCounts.get(pairKey(1, 2))).toBe(2);
    expect(f.runCounts.get(pairKey(1, 3))).toBe(1);
    expect(f.stats.map((s) => s.destId)).toEqual([2, 3]);
  });

  it('cuts the sessions from the timestamps it is given, and puts the runs in them', () => {
    const f = figuresOf({ runs: [R3, R1], recordTs: [1000, 3400, 20000, 21000] });
    expect(f.sessions.map((s) => s.runIds)).toEqual([[3], [1]]);
  });

  it('leaves out of the sessions the run no timestamp covers (the reason for reading the events too)', () => {
    expect(figuresOf({ runs: [R1], recordTs: [] }).sessions).toEqual([]);
  });
});
