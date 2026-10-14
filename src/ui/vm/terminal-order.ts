import { formatUec } from '../../core/format';
import type { CargoLine, Side } from '../../core/types';
import type { SortDir } from './route-sort';
import { tr } from '../../i18n';

// The order of the rows of the terminal table. Two things order it: the cargo in the hold (on the sell side the commodities the
// player carries stand first and wear a mark) and the header the player clicked («Товар», «Прибыль» or «ROI»). Pure: the rows are not
// touched, only the order is made; the choice itself lives in the section (`sections/TerminalSection.svelte`) and is gone with the program.

/** The headers that can be clicked: the commodity (the default order), and what the best trip of its row brings and its ROI. */
export type TerminalSortKey = 'name' | 'profit' | 'roi';
export interface TerminalSort { key: TerminalSortKey; dir: SortDir }

/** What the table shows before anything is clicked: the order of the rows as the view model gives them, by the name of the commodity. */
export const DEFAULT_TERMINAL_SORT: TerminalSort = { key: 'name', dir: 'asc' };

/**
 * The sort after `key` was clicked. «Прибыль» and «ROI» put the best on top the first time and turn the order round at every next
 * click; «Товар» always brings the default order back (it has no second direction).
 */
export function clickedTerminalSort(current: TerminalSort, key: TerminalSortKey): TerminalSort {
  if (key === 'name') return { ...DEFAULT_TERMINAL_SORT };
  return { key, dir: current.key === key && current.dir === 'desc' ? 'asc' : 'desc' };
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
  return { text: scu, title: tr('В трюме {scu} SCU, куплено по {v1}', { scu, v1: formatUec(line.avgBuyPrice) }) };
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
  /** What the best trip of the row brings; `null` for a row without one. Absent: the table is never ordered by it. */
  profitOf?: (commodityId: number) => number | null;
}

/**
 * The rows in the order to show. The commodities of the hold (sell side) come first, whatever the sort is; inside each of the
 * two groups the rows are in the order of the sort. The default order keeps the rows as they came, the cargo in the order
 * of the cargo. By the profit or by the ROI, a row without the number is last whichever way the order goes, and rows of the
 * same number stay in the default order of their group. Returns a new list of the same rows.
 */
export function orderRows<T extends { commodityId: number }>(rows: readonly T[], options: OrderOptions): T[] {
  const { side, sort, cargo, percentOf, profitOf } = options;
  const heldAt = new Map<number, number>();
  if (side === 'sell') cargo.forEach((line, at) => heldAt.set(line.commodityId, at));
  const byRoi = sort.key !== 'name';   // by a number of the row: the ROI or the profit
  const numberOf = sort.key === 'profit' ? (profitOf ?? (() => null)) : percentOf;
  const sign = sort.dir === 'desc' ? -1 : 1;
  const entries = rows.map((row, index) => ({
    row, index, held: heldAt.get(row.commodityId) ?? null, percent: byRoi ? numberOf(row.commodityId) : null,
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

/** What holds the places of the rows: the cursor stands in a field of the table, and/or a row of it is open. */
export interface PlaceHolders { fieldFocused: boolean; rowOpen: boolean }

/**
 * The places that are held now (`held`: the commodity ids in the order that was on screen when the holding began; `null`: nothing is held),
 * once what holds them has changed. While the cursor is in a field of the table or a row is open (version 1.1.1: the row that was opened
 * does not run away to its place when the sale changes the order) the places are held, and the order taken when the holding began stays
 * whatever else holds next; when neither does, nothing is held and the sort has its way. `shownIds` is the order on screen now, taken
 * only when the holding begins (a copy is taken). Returns `held` itself while it holds, a new list when the holding begins, else `null`.
 */
export function heldPlaces(held: number[] | null, shownIds: readonly number[], holders: PlaceHolders): number[] | null {
  if (!holders.fieldFocused && !holders.rowOpen) return null;
  return held ?? [...shownIds];
}

/**
 * A click on a sort header is the player's own request for a new order, and a held order must not swallow it: with something holding the
 * places (a row is open, a cursor is in a field) the places are taken AGAIN, from the freshly sorted rows (`sortedIds`), and from then on they
 * are held as before (`heldPlaces`: a sale that changes the order afterwards does not move the rows). The open row stays open and stands where
 * the new order puts it. With nothing holding the places there is nothing to take: `null`, and the sort simply shows. Returns a new list or `null`.
 */
export function resortedPlaces(sortedIds: readonly number[], holders: PlaceHolders): number[] | null {
  return holders.fieldFocused || holders.rowOpen ? [...sortedIds] : null;
}

/**
 * The order to show while the places are held (`heldPlaces`: a field of the table has the cursor, or a row is open). A row that is moved in
 * the page takes the focus out of the field it holds (without a blur), and the player is typing into it, and a row that is open and moves
 * is lost from the eye: so while `frozen` the places of the rows are those of `previousIds` (the order that was on screen when the holding
 * began), and only the values in the rows are new. A row that has appeared since stands after them, in the sorted order; a row that has
 * gone is gone. Not `frozen`, it is the sorted order as it is. Returns a new list.
 */
export function holdOrder<T extends { commodityId: number }>(previousIds: readonly number[], sorted: readonly T[], frozen: boolean): T[] {
  if (!frozen) return [...sorted];
  const place = new Map(previousIds.map((id, at) => [id, at]));
  const held = sorted.filter((row) => place.has(row.commodityId)).sort((x, y) => (place.get(x.commodityId) ?? 0) - (place.get(y.commodityId) ?? 0));
  return [...held, ...sorted.filter((row) => !place.has(row.commodityId))];
}
