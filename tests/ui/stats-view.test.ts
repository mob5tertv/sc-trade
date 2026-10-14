import { describe, expect, it } from 'vitest';
import { pairKey } from '../../src/core/types';
import { routeRows } from '../../src/ui/vm/stats-rows';
import {
  currentSession, routesSummary, sessionFigure, STATS_VIEWS, figuresOf, EMPTY_FIGURES, EMPTY_HISTORY, LIST_HEAD_PX, LIST_MAX_HEIGHT, LIST_ROWS,
  routesSinceLine, runsSince,
} from '../../src/ui/vm/stats-view';
import { DEFAULT_SESSION_GAP_SEC, routeStats } from '../../src/core/stats';
import { ref } from '../helpers/factories';
import {
  CLOCK, doneRun, goingRun, HOUR, lostRun, MINUTE, sessionEndedAgo, sessionsOf,
} from '../helpers/indicator-fixtures';
import { MIX1, MIX2 } from '../helpers/mixed-fixtures';
import { R1, R2, R3, R4, R5, R6 } from '../helpers/stats-fixtures';
import { stat } from '../helpers/stats-rows-fixtures';

// prices are formatted with a non-breaking space as the thousands separator
const NBSP = String.fromCharCode(0xa0);

describe('routesSummary', () => {
  it('says there is nothing yet before the first finished run', () => {
    expect(routesSummary([])).toBe('пока нет завершённых рейсов');
  });

  it('names the best route and what one run of it brings', () => {
    const rows = routeRows(routeStats([R1, R2, R3]), ref);
    expect(routesSummary(rows)).toBe('ARC-L1 → TDD Area 18 · 273k за рейс');      // 545 000 over two runs
  });

  it('names the row whose run brings the most, wherever it stands', () => {
    const rows = routeRows([{ ...stat, destId: 3, totalProfit: 620_000 }, { ...stat, totalProfit: 240_000 }], ref);
    expect(routesSummary(rows)).toBe('ARC-L1 → CRU-L1 · 310k за рейс');
    // «Подробные расчёты» count the lost runs into a row: the route that was first by the runs that ended well may not be the best
    expect(routesSummary([rows[1], rows[0]])).toBe('ARC-L1 → CRU-L1 · 310k за рейс');
  });

  describe('with the session that is going', () => {
    const session = sessionFigure(currentSession(sessionEndedAgo(10 * MINUTE), CLOCK));
    const rows = routeRows(routeStats([R1, R2, R3]), ref);

    it('says the session first, then the best route', () => {
      expect(routesSummary(rows, session)).toBe(`сессия +1${NBSP}240${NBSP}000 за 3:00:00 · ARC-L1 → TDD Area 18 · 273k за рейс`);
    });

    it('says only the session when there is no route to name (the runs were lost or mixed)', () => {
      expect(routesSummary([], session)).toBe(`сессия +1${NBSP}240${NBSP}000 за 3:00:00`);
    });

    it('is what it was without a session', () => {
      expect(routesSummary(rows, null)).toBe('ARC-L1 → TDD Area 18 · 273k за рейс');
      expect(routesSummary([], null)).toBe('пока нет завершённых рейсов');
    });
  });
});

describe('currentSession', () => {
  it('is the latest session while its last record is younger than the pause that splits sessions', () => {
    const list = sessionEndedAgo(10 * MINUTE);
    expect(currentSession(list, CLOCK)).toBe(list[0]);
  });

  it('uses the pause of the statistics themselves (two hours), not a number of its own', () => {
    expect(DEFAULT_SESSION_GAP_SEC).toBe(2 * HOUR);
    expect(currentSession(sessionEndedAgo(DEFAULT_SESSION_GAP_SEC - 1), CLOCK)).not.toBeNull();
  });

  it('is nothing when the last record is as old as the pause or older', () => {
    expect(currentSession(sessionEndedAgo(DEFAULT_SESSION_GAP_SEC), CLOCK)).toBeNull();
    expect(currentSession(sessionEndedAgo(5 * HOUR), CLOCK)).toBeNull();
  });

  it('looks at the latest session only: an older one never comes back', () => {
    const start = CLOCK - 20 * HOUR;
    const list = sessionsOf([start, start + HOUR, CLOCK - 5 * HOUR], [doneRun(1, start, 100_000), doneRun(2, CLOCK - 5 * HOUR, 50_000)]);
    expect(list).toHaveLength(2);
    expect(currentSession(list, CLOCK)).toBeNull();
  });

  it('follows the clock: the same session is current, then it is not', () => {
    const list = sessionEndedAgo(0);
    expect(currentSession(list, CLOCK)).toBe(list[0]);
    expect(currentSession(list, CLOCK + DEFAULT_SESSION_GAP_SEC - 1)).toBe(list[0]);
    expect(currentSession(list, CLOCK + DEFAULT_SESSION_GAP_SEC)).toBeNull();
  });

  it('is nothing without sessions', () => {
    expect(currentSession([], CLOCK)).toBeNull();
  });
});

describe('sessionFigure', () => {
  const figure = (profit: number, lastAgoSec = 0) => sessionFigure(currentSession(sessionEndedAgo(lastAgoSec, profit), CLOCK));

  it('is the profit in the short form of the mini line, and in full with how long the session has lasted for the tooltip and the summary', () => {
    expect(figure(1_240_000)).toEqual({ short: '+1,24M', line: `сессия +1${NBSP}240${NBSP}000 за 3:00:00`, tone: 'gain' });
    expect(figure(312_000)).toMatchObject({ short: '+312k', tone: 'gain' });
  });

  it('shows a loss with its sign and its tone', () => {
    expect(figure(-174_000)).toEqual({ short: '-174k', line: `сессия -174${NBSP}000 за 3:00:00`, tone: 'loss' });
  });

  it('has a tone of its own for a session that came out even', () => {
    expect(figure(0)).toMatchObject({ short: '0', tone: 'even' });
  });

  it('has no segment when there is no session', () => {
    expect(sessionFigure(null)).toBeNull();
    expect(figure(1_240_000, 3 * HOUR)).toBeNull();
  });

  it('has none when no run has ended in the session: prices alone are not earnings', () => {
    const start = CLOCK - HOUR;
    expect(sessionFigure(currentSession(sessionsOf([start, CLOCK - 5 * MINUTE], []), CLOCK))).toBeNull();
  });

  it('has none while the only run is still going: a run that is going has not earned anything', () => {
    const start = CLOCK - HOUR;
    const list = sessionsOf([start, CLOCK - 5 * MINUTE], [goingRun(1, start)]);
    expect(currentSession(list, CLOCK)).not.toBeNull();
    expect(sessionFigure(currentSession(list, CLOCK))).toBeNull();
  });

  it('counts a run whose cargo was lost: the loss is the session\'s', () => {
    const start = CLOCK - 2 * HOUR;
    const list = sessionsOf([start, start + 30 * MINUTE, CLOCK - 5 * MINUTE], [lostRun(1, start)]);
    expect(sessionFigure(currentSession(list, CLOCK))).toMatchObject({ short: '-500k', tone: 'loss' });
  });

  it('says no rate when the session has no length yet (a single record)', () => {
    const list = sessionsOf([CLOCK - 60], [doneRun(1, CLOCK - 60, 90_000)]);
    expect(sessionFigure(currentSession(list, CLOCK))).toEqual({ short: '+90k', line: `сессия +90${NBSP}000`, tone: 'gain' });
  });

  it('adds up the finished runs of the session and leaves the one that is going out', () => {
    const start = CLOCK - 3 * HOUR;
    const list = sessionsOf(
      [start, start + HOUR, start + 2 * HOUR, CLOCK - 5 * MINUTE],
      [doneRun(1, start, 300_000), doneRun(2, start + HOUR, 200_000), goingRun(3, start + 2 * HOUR)],
    );
    expect(sessionFigure(currentSession(list, CLOCK))).toMatchObject({ short: '+500k' });
  });
});

describe('the lists of the section', () => {
  it('are four, in the order the switch shows them, with Russian names', () => {
    expect(STATS_VIEWS.map((v) => [v.id, v.label])).toEqual([['routes', 'Маршруты'], ['history', 'История'], ['sessions', 'Сессии'], ['records', 'Записи']]);
    expect(STATS_VIEWS.map((v) => v.title).join(' ')).not.toMatch(/UEC в час/);
  });

  it('show eight rows before they scroll: the body is the line of heads and eight rows of the height of a row, and no taller', () => {
    expect(LIST_ROWS).toBe(8);
    expect(LIST_HEAD_PX).toBe(18);
    expect(LIST_MAX_HEIGHT).toBe('calc(var(--sc-row-h) * 8 + 18px)');
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

  it('counts a finished run of several commodities between two terminals in the time, the count and the rows of its pair, once (task 51)', () => {
    const f = figuresOf({ runs: [MIX2, R6, R5, R4, MIX1, R3, R2, R1], recordTs: [] });
    expect(f.ownMedian.get(pairKey(1, 2))).toBe(1900);              // R1 2400, R2 1800, MIX1 2000, MIX2 1000: the middle two are 1800 and 2000
    expect(f.runCounts.get(pairKey(1, 2))).toBe(4);
    expect(f.runCounts.get(pairKey(1, 3))).toBe(1);
    // [destination, number of goods, runs], by the rate: the gold of R1 and R2 (467k), the mixed gold and titanium of MIX1 and MIX2 (187k), the gold of R3 (180k)
    expect(f.stats.map((s) => [s.destId, s.commodityIds.length, s.runs])).toEqual([[2, 1, 2], [2, 2, 2], [3, 1, 1]]);
  });

  it('holds my median time and my run count per direction, from the finished runs of one pair of terminals only', () => {
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

// R1 ends at 3400, R2 at 11 800, R4 (lost) at 12 500, R3 at 21 000, R5 at 41 000; R6 is still going.
describe('«Обнулить маршруты» (spec 14.19)', () => {
  const history = { runs: [R6, R5, R4, R3, R2, R1], recordTs: [1000, 3400, 10000, 11800, 20000, 21000] };

  it('counts the routes, my times and my run counts from the runs that ended since the reset', () => {
    const all = figuresOf(history);
    const since = figuresOf(history, 12_000);                      // R1 and R2 ended before it
    expect(all.stats.map((s) => s.destId)).toEqual([2, 3]);
    expect(since.stats.map((s) => s.destId)).toEqual([3]);
    expect(since.ownMedian.has(pairKey(1, 2))).toBe(false);
    expect(since.runCounts.get(pairKey(1, 2))).toBeUndefined();
    expect(since.runCounts.get(pairKey(1, 3))).toBe(1);
  });

  it('leaves the sessions as they were: what was earned is not taken back', () => {
    expect(figuresOf(history, 12_000).sessions).toEqual(figuresOf(history).sessions);
  });

  it('is empty right after the reset, and counts the run that was going at that moment once it ends', () => {
    const now = 60_000;
    const fresh = figuresOf(history, now);
    expect(fresh.stats).toEqual([]);
    expect(fresh.ownMedian.size).toBe(0);
    expect(runsSince(history.runs, now)).toEqual([R6]);            // the run that goes on is kept: it will end after the reset
    const ended = { run: { ...R6.run, status: 'done' as const, endedAt: now + 500 }, events: R6.events };
    expect(figuresOf({ ...history, runs: [ended, R5, R4, R3, R2, R1] }, now).stats.map((s) => s.destId)).toEqual([2]);
  });

  it('takes a run that ended at the very second of the reset, and every run when there is no reset', () => {
    expect(runsSince(history.runs, 21_000).map((r) => r.run.id)).toEqual([6, 5, 3]);
    expect(runsSince(history.runs, null)).toBe(history.runs);
  });

  it('says since when the routes are counted', () => {
    expect(routesSinceLine(1_759_748_700)).toMatch(/^Маршруты считаются с \d\d\.\d\d \d\d:\d\d$/);
  });
});
