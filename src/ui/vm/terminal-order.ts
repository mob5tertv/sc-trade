import { formatUec } from '../../core/format';
import type { CargoLine, Side } from '../../core/types';
import type { SortDir } from './route-sort';

// The order of the rows of the terminal table. Two things order it: the cargo in the hold (on the sell side the commodities the
// player carries stand first and wear a mark) and the header the player clicked («Товар» or «ROI»). Pure: the rows are not
// touched, only the order is made; the choice itself lives in the section (`sections/TerminalSection.svelte`) and is gone with the program.

/** The headers that can be clicked: the commodity (the default order) and the best ROI of its row. */
export type TerminalSortKey = 'name' | 'roi';
export interface TerminalSort { key: TerminalSortKey; dir: SortDir }

/** What the table shows before anything is clicked: the order of the rows as the view model gives them, by the name of the commodity. */
export const DEFAULT_TERMINAL_SORT: TerminalSort = { key: 'name', dir: 'asc' };

/**
 * The sort after `key` was clicked. «ROI» puts the best on top the first time and turns the order round at every next click;
 * «Товар» always brings the default order back (it has no second direction).
 */
export function clickedTerminalSort(current: TerminalSort, key: TerminalSortKey): TerminalSort {
  if (key === 'name') return { ...DEFAULT_TERMINAL_SORT };
  return { key: 'roi', dir: current.key === 'roi' && current.dir === 'desc' ? 'asc' : 'desc' };
}

/** The `aria-sort` of the header of `key`: the direction of the active header, nothing for the other one. */
export function terminalAriaSort(current: TerminalSort, key: TerminalSortKey): 'ascending' | 'descending' | undefined {
  if (current.key !== key) return undefined;
  return current.dir === 'asc' ? 'ascending' : 'descending';
}

/** What the mark of a commodity that is in the hold says: the quantity beside the sign, and in the tooltip what it was bought for. */
export interface HoldMark { text: string; title: string }

export function holdMark(line: CargoLine): HoldMark {
  const scu = formatUec(line.scu);
  return { text: scu, title: `В трюме ${scu} SCU, куплено по ${formatUec(line.avgBuyPrice)}` };
}

/**
 * The cargo of the hold by commodity, in the order of the cargo. Only the sell side has it: a commodity in the hold is
 * a commodity that can be sold here. On the buy side, and with nothing in the hold, it is empty.
 */
export function holdOf(side: Side, cargo: readonly CargoLine[]): Map<number, CargoLine> {
  return side === 'sell' ? new Map(cargo.map((line) => [line.commodityId, line])) : new Map();
}

export interface OrderOptions {
  side: Side;
  sort: TerminalSort;
  cargo: readonly CargoLine[];
  /** The ROI of the row of a commodity, in whole percents as the table shows it; `null` for a row without one. */
  percentOf: (commodityId: number) => number | null;
}

/**
 * The rows in the order to show. The commodities of the hold (sell side) come first, whatever the sort is; inside each of the
 * two groups the rows are in the order of the sort. The default order keeps the rows as they came, the cargo in the order
 * of the cargo. By the ROI, a row without one is last whichever way the order goes, and rows of the same ROI stay in the
 * default order of their group. Returns a new list of the same rows.
 */
export function orderRows<T extends { commodityId: number }>(rows: readonly T[], options: OrderOptions): T[] {
  const { side, sort, cargo, percentOf } = options;
  const heldAt = new Map<number, number>();
  if (side === 'sell') cargo.forEach((line, at) => heldAt.set(line.commodityId, at));
  const byRoi = sort.key === 'roi';
  const sign = sort.dir === 'desc' ? -1 : 1;
  const entries = rows.map((row, index) => ({
    row, index, held: heldAt.get(row.commodityId) ?? null, percent: byRoi ? percentOf(row.commodityId) : null,
  }));
  type Entry = (typeof entries)[number];
  // the order of a group when the sort has not told two rows apart: the cargo in its order, the rest as the rows came
  const inGroup = (x: Entry, y: Entry): number => (x.held !== null && y.held !== null ? x.held - y.held : x.index - y.index);
  return entries
    .sort((x, y) => {
      if ((x.held === null) !== (y.held === null)) return x.held === null ? 1 : -1;
      if (byRoi) {
        if (x.percent === null || y.percent === null) return Number(x.percent === null) - Number(y.percent === null) || inGroup(x, y);
        return sign * (x.percent - y.percent) || inGroup(x, y);
      }
      return inGroup(x, y);
    })
    .map(({ row }) => row);
}
