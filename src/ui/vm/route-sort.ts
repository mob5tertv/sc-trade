import type { RouteStat } from '../../core/stats';

// The order of the table of routes of the "Маршруты" tab (spec 14.14): a click on the header of a numeric column puts the
// best routes by that column on top, a second click turns the order round. The order is counted from the NUMBERS of the
// statistics (`RouteStat`), never from the text of a cell ('1,5M' is more than '900k', and '10:00' is longer than '9:59').
// Pure; the choice itself lives in the section (`sections/RoutesSection.svelte`) and is gone with the program.

/** The columns that can be sorted: what one run brings («За рейс»), the number of runs, the median time, the whole profit, the ROI. */
export const ROUTE_SORT_KEYS = ['perRun', 'runs', 'time', 'profit', 'roi'] as const;
export type RouteSortKey = (typeof ROUTE_SORT_KEYS)[number];

/** `desc`: the largest number on top; `asc`: the smallest on top. */
export type SortDir = 'asc' | 'desc';
export interface RouteSort { key: RouteSortKey; dir: SortDir }

/** What the table shows before anything is clicked: the route whose run brings the most first. */
export const DEFAULT_ROUTE_SORT: RouteSort = { key: 'perRun', dir: 'desc' };

/** The direction of the first click on a column: the best routes on top. For the time that is the fastest, the smallest number. */
export const FIRST_DIR: Record<RouteSortKey, SortDir> = { perRun: 'desc', runs: 'desc', time: 'asc', profit: 'desc', roi: 'desc' };

/** The sort after `key` was clicked: a column that is not sorted gets its best first, the column that is turns round. */
export function clickedSort(current: RouteSort, key: RouteSortKey): RouteSort {
  if (current.key !== key) return { key, dir: FIRST_DIR[key] };
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

/** The `aria-sort` of the header of `key`: the direction of the sorted column, nothing for the others. */
export function ariaSortOf(current: RouteSort, key: RouteSortKey): 'ascending' | 'descending' | undefined {
  if (current.key !== key) return undefined;
  return current.dir === 'asc' ? 'ascending' : 'descending';
}

/** What the table needs of a row to order it: the statistic, and what one run of the route brings as the row counted it. */
export interface SortableRoute { stat: RouteStat; perRunValue: number }

/** The number a column is sorted by; `null` when the row has none (a time or a ROI that is not a number). */
function valueOf(row: SortableRoute, key: RouteSortKey): number | null {
  const { stat } = row;
  const value = { perRun: row.perRunValue, runs: stat.runs, time: stat.medianDurationSec, profit: stat.totalProfit, roi: stat.avgRoi }[key];
  return Number.isFinite(value) ? value : null;
}

/**
 * The rows in the order of `sort`. A route without the number (`valueOf`) is always at the end, whichever way the order goes;
 * routes with the same number stay in the order they came in (the order of the core), also when the order is turned round.
 * Returns a new list of the same rows.
 */
export function sortRoutes<T extends SortableRoute>(rows: readonly T[], sort: RouteSort): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row, sort.key) }))
    .sort((x, y) => {
      if (x.value === null || y.value === null) return Number(x.value === null) - Number(y.value === null) || x.index - y.index;
      return sign * (x.value - y.value) || x.index - y.index;
    })
    .map(({ row }) => row);
}
