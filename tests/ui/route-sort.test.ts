import { describe, expect, it } from 'vitest';
import { routeStats, type RouteStat } from '../../src/core/stats';
import { ref } from '../helpers/factories';
import { MIX1, MIX3 } from '../helpers/mixed-fixtures';
import { R1, R2 } from '../helpers/stats-fixtures';
import {
  ariaSortOf, clickedSort, DEFAULT_ROUTE_SORT, FIRST_DIR, ROUTE_SORT_KEYS, sortRoutes, type RouteSort, type RouteSortKey,
} from '../../src/ui/vm/route-sort';
import { routeRows } from '../../src/ui/vm/stats-rows';
import { stat } from '../helpers/stats-rows-fixtures';

// Five routes that differ in every number; the destination (`destId`) is how a test tells them apart. They come in the order
// of the core (by its rate per hour, which no table shows any more: plan item 17).
//         per run   runs  time   profit    roi
//   a 2    50 000    2    2100   100 000   0.10
//   d 5   100 000    3     —     300 000   0.20      (no time)
//   b 3   180 000    5     600   900 000   0.30
//   e 6   180 000    5     600   900 000   0.30      (the same runs, time, profit and roi as b)
//   c 4   -50 000    1    4000   -50 000    —        (no roi)
const route = (destId: number, patch: Partial<RouteStat>): RouteStat => ({ ...stat, destId, ...patch });
const a = route(2, { uecPerHour: 300_000, runs: 2, medianDurationSec: 2100, totalProfit: 100_000, avgRoi: 0.1 });
const d = route(5, { uecPerHour: 200_000, runs: 3, medianDurationSec: Number.NaN, totalProfit: 300_000, avgRoi: 0.2 });
const b = route(3, { uecPerHour: 100_000, runs: 5, medianDurationSec: 600, totalProfit: 900_000, avgRoi: 0.3 });
const e = route(6, { uecPerHour: 50_000, runs: 5, medianDurationSec: 600, totalProfit: 900_000, avgRoi: 0.3 });
const c = route(4, { uecPerHour: null, runs: 1, medianDurationSec: 4000, totalProfit: -50_000, avgRoi: Number.NaN });
const FROM_CORE = [a, d, b, e, c];

const rows = routeRows(FROM_CORE, ref);
const order = (sorted: Array<{ stat: RouteStat }>): string => sorted.map(row => 'adbec'[FROM_CORE.indexOf(row.stat)]).join('');
const sorted = (key: RouteSortKey, dir: RouteSort['dir'], input = rows): string => order(sortRoutes(input, { key, dir }));

describe('sortRoutes', () => {
  // the order of the equal ones (b before e) is the order the rows came in, in both directions
  it.each<[RouteSortKey, RouteSort['dir'], string]>([
    ['perRun', 'desc', 'bedac'], ['perRun', 'asc', 'cadbe'],
    ['runs', 'desc', 'bedac'], ['runs', 'asc', 'cadbe'],
    ['time', 'asc', 'beacd'], ['time', 'desc', 'cabed'],
    ['profit', 'desc', 'bedac'], ['profit', 'asc', 'cadbe'],
    ['roi', 'desc', 'bedac'], ['roi', 'asc', 'adbec'],
  ])('puts the rows in the order of the %s, %s', (key, dir, expected) => {
    expect(sorted(key, dir)).toBe(expected);
  });

  it('knows every column that can be sorted, and no other', () => {
    expect([...ROUTE_SORT_KEYS]).toEqual(['perRun', 'runs', 'time', 'profit', 'roi']);
  });

  it('leaves a value that is not known at the end, whichever way it goes', () => {
    // c has no roi, d has no time
    expect(sorted('roi', 'desc').endsWith('c')).toBe(true);
    expect(sorted('roi', 'asc').endsWith('c')).toBe(true);
    expect(sorted('time', 'asc').endsWith('d')).toBe(true);
    expect(sorted('time', 'desc').endsWith('d')).toBe(true);
  });
  it('puts every unknown value last in the order the rows came in', () => {
    const nan = Number.NaN;
    const unknown = [route(2, { medianDurationSec: nan }), route(3, { medianDurationSec: 10 }), route(4, { medianDurationSec: nan }), route(5, { medianDurationSec: 20 })];
    const order2 = (dir: RouteSort['dir']) => sortRoutes(routeRows(unknown, ref), { key: 'time', dir }).map(row => row.stat.destId);
    expect(order2('desc')).toEqual([5, 3, 2, 4]);
    expect(order2('asc')).toEqual([3, 5, 2, 4]);
  });
  it('takes a ROI or a time that is not a finite number for unknown', () => {
    const odd = [route(2, { avgRoi: Number.POSITIVE_INFINITY }), route(3, { avgRoi: 1 }), route(4, { avgRoi: Number.NaN })];
    expect(sortRoutes(routeRows(odd, ref), { key: 'roi', dir: 'desc' }).map(row => row.stat.destId)).toEqual([3, 2, 4]);
  });
  it('knows a zero and a loss: they are values, not gaps', () => {
    const zero = [route(2, { totalProfit: 0 }), route(3, { totalProfit: -5 }), route(4, { totalProfit: 5 })];
    expect(sortRoutes(routeRows(zero, ref), { key: 'profit', dir: 'desc' }).map(row => row.stat.destId)).toEqual([4, 2, 3]);
    expect(sortRoutes(routeRows(zero, ref), { key: 'profit', dir: 'asc' }).map(row => row.stat.destId)).toEqual([3, 2, 4]);
  });

  it('sorts by the numbers of the statistics, not by their text: 1,5M is more than 900k, and 10:00 is longer than 9:59', () => {
    const numbers = [route(2, { totalProfit: 1_800_000, runs: 2, medianDurationSec: 599 }), route(3, { totalProfit: 3_000_000, runs: 2, medianDurationSec: 600 })];
    const byText = routeRows(numbers, ref);
    expect(byText.map(row => row.perRun)).toEqual(['900k', '1,5M']);
    expect(sortRoutes(byText, { key: 'perRun', dir: 'desc' }).map(row => row.stat.destId)).toEqual([3, 2]);
    expect(sortRoutes(byText, { key: 'time', dir: 'asc' }).map(row => row.stat.destId)).toEqual([2, 3]);
  });

  it('puts the row of a mixed cargo in the order of its numbers, like any other (task 51)', () => {
    // from the core: the gold of R1 and R2 (272 500 a run, 2 runs), the mixed gold and titanium (100 000, 1 run), the mixed gold and tungsten (35 000, 1 run)
    const real = routeRows(routeStats([R1, R2, MIX1, MIX3]), ref);
    expect(real.map(row => row.commodity)).toEqual(['GOLD', 'смеш.', 'смеш.']);
    const profits = (sort: RouteSort): number[] => sortRoutes(real, sort).map(row => row.stat.totalProfit);
    expect(profits({ key: 'perRun', dir: 'desc' })).toEqual([545_000, 100_000, 35_000]);
    expect(profits({ key: 'perRun', dir: 'asc' })).toEqual([35_000, 100_000, 545_000]);
    expect(profits({ key: 'runs', dir: 'desc' })).toEqual([545_000, 100_000, 35_000]);
    expect(profits({ key: 'time', dir: 'asc' })).toEqual([35_000, 100_000, 545_000]);      // 20:00, 33:20, 35:00
    expect(profits({ key: 'roi', dir: 'asc' })).toEqual([35_000, 100_000, 545_000]);
    expect(profits({ key: 'profit', dir: 'asc' })).toEqual([35_000, 100_000, 545_000]);
  });

  it('puts the route whose run brings the most first by default, whatever order the core gave', () => {
    expect(order(sortRoutes(rows, DEFAULT_ROUTE_SORT))).toBe('bedac');
    expect(DEFAULT_ROUTE_SORT).toEqual({ key: 'perRun', dir: 'desc' });
  });
  it('leaves the list it was given as it is, and works with an empty one', () => {
    const before = rows.map(row => row.key);
    sortRoutes(rows, { key: 'roi', dir: 'asc' });
    expect(rows.map(row => row.key)).toEqual(before);
    expect(sortRoutes([], DEFAULT_ROUTE_SORT)).toEqual([]);
  });
  it('gives back the very rows, not copies of them', () => {
    expect(sortRoutes(rows, { key: 'runs', dir: 'asc' }).every(row => rows.includes(row))).toBe(true);
  });
});

describe('clickedSort', () => {
  it('puts the best first on the first click: the highest of every column, the fastest for the time', () => {
    expect(FIRST_DIR).toEqual({ perRun: 'desc', runs: 'desc', time: 'asc', profit: 'desc', roi: 'desc' });
    const from: RouteSort = { key: 'perRun', dir: 'desc' };
    expect(clickedSort(from, 'roi')).toEqual({ key: 'roi', dir: 'desc' });
    expect(clickedSort(from, 'time')).toEqual({ key: 'time', dir: 'asc' });
    expect(clickedSort(from, 'runs')).toEqual({ key: 'runs', dir: 'desc' });
    expect(clickedSort(from, 'profit')).toEqual({ key: 'profit', dir: 'desc' });
  });
  it('turns the order round on a second click on the column that is sorted, and back on a third', () => {
    const once = clickedSort({ key: 'perRun', dir: 'desc' }, 'roi');
    const twice = clickedSort(once, 'roi');
    expect(twice).toEqual({ key: 'roi', dir: 'asc' });
    expect(clickedSort(twice, 'roi')).toEqual({ key: 'roi', dir: 'desc' });
    expect(clickedSort({ key: 'time', dir: 'asc' }, 'time')).toEqual({ key: 'time', dir: 'desc' });
  });
  it('starts again from the best when another column is clicked after a turned-round one', () => {
    expect(clickedSort({ key: 'roi', dir: 'asc' }, 'perRun')).toEqual({ key: 'perRun', dir: 'desc' });
    expect(clickedSort({ key: 'time', dir: 'desc' }, 'time')).toEqual({ key: 'time', dir: 'asc' });
  });
  it('can turn the default order round: «За рейс» is a column like the others', () => {
    expect(clickedSort(DEFAULT_ROUTE_SORT, 'perRun')).toEqual({ key: 'perRun', dir: 'asc' });
  });
});

describe('ariaSortOf', () => {
  it('says the direction of the column that is sorted and nothing about the others', () => {
    expect(ariaSortOf({ key: 'time', dir: 'asc' }, 'time')).toBe('ascending');
    expect(ariaSortOf({ key: 'roi', dir: 'desc' }, 'roi')).toBe('descending');
    expect(ariaSortOf({ key: 'roi', dir: 'desc' }, 'perRun')).toBeUndefined();
  });
});
