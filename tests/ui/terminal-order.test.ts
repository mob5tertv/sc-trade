import { describe, expect, it } from 'vitest';
import type { CargoLine } from '../../src/core/types';
import {
  DEFAULT_TERMINAL_SORT, clickedTerminalSort, heldPlaces, holdMark, holdOf, holdOrder, orderRows, resortedPlaces, terminalAriaSort, type TerminalSort,
} from '../../src/ui/vm/terminal-order';

// formatUec separates thousands with a non-breaking space
const nb = (s: string) => s.replace(/ /g, String.fromCharCode(0xa0));

// Six commodities in the order the table has them by default (by name): the id says which is which.
//   1 ALUM  ROI 12 %      2 BERY  no ROI      3 GOLD  ROI 40 %
//   4 MEDS  ROI 25 %      5 PFOO  ROI 25 %    6 STIM  ROI  3 %
const ROWS = [1, 2, 3, 4, 5, 6].map((commodityId) => ({ commodityId }));
const PERCENT = new Map<number, number | null>([[1, 12], [2, null], [3, 40], [4, 25], [5, 25], [6, 3]]);
const percentOf = (commodityId: number): number | null => PERCENT.get(commodityId) ?? null;
const ids = (rows: Array<{ commodityId: number }>): number[] => rows.map((row) => row.commodityId);

const line = (commodityId: number, scu: number, avgBuyPrice = 2115): CargoLine => ({ commodityId, scu, avgBuyPrice });
const DEFAULT = DEFAULT_TERMINAL_SORT;
const ROI_DESC: TerminalSort = { key: 'roi', dir: 'desc' };
const ROI_ASC: TerminalSort = { key: 'roi', dir: 'asc' };

describe('clickedTerminalSort: what a click on a header does', () => {
  it('starts at the order the table has by default, by the name of the commodity', () => {
    expect(DEFAULT_TERMINAL_SORT).toEqual({ key: 'name', dir: 'asc' });
  });

  it('puts the best ROI on top at the first click on «ROI», and turns the order round at every next one', () => {
    const first = clickedTerminalSort(DEFAULT, 'roi');
    expect(first).toEqual(ROI_DESC);
    const second = clickedTerminalSort(first, 'roi');
    expect(second).toEqual(ROI_ASC);
    expect(clickedTerminalSort(second, 'roi')).toEqual(ROI_DESC);
  });

  it('brings the default order back at a click on «Товар», from any order, and keeps it at a second click', () => {
    expect(clickedTerminalSort(ROI_DESC, 'name')).toEqual(DEFAULT);
    expect(clickedTerminalSort(ROI_ASC, 'name')).toEqual(DEFAULT);
    expect(clickedTerminalSort(DEFAULT, 'name')).toEqual(DEFAULT);
  });

  it('never hands out the shared default object itself: the choice is kept in a state that is written to', () => {
    expect(clickedTerminalSort(ROI_DESC, 'name')).not.toBe(DEFAULT_TERMINAL_SORT);
  });
});

describe('«Прибыль»: the third header (plan item 17)', () => {
  const PROFIT_DESC: TerminalSort = { key: 'profit', dir: 'desc' };
  const rowsOf = (...ids: number[]) => ids.map((commodityId) => ({ commodityId }));
  const profit = new Map<number, number | null>([[1, 35_000], [2, 438_000], [3, null], [4, 100_000]]);
  const options = (sort: TerminalSort) => ({ side: 'buy' as const, sort, cargo: [], percentOf: () => 10, profitOf: (id: number) => profit.get(id) ?? null });

  it('puts the trip that brings the most on top at the first click, turns round at the next, and gives way to another header', () => {
    expect(clickedTerminalSort(DEFAULT, 'profit')).toEqual(PROFIT_DESC);
    expect(clickedTerminalSort(PROFIT_DESC, 'profit')).toEqual({ key: 'profit', dir: 'asc' });
    expect(clickedTerminalSort(PROFIT_DESC, 'roi')).toEqual(ROI_DESC);
    expect(clickedTerminalSort(ROI_ASC, 'profit')).toEqual(PROFIT_DESC);
    expect(terminalAriaSort(PROFIT_DESC, 'profit')).toBe('descending');
    expect(terminalAriaSort(PROFIT_DESC, 'roi')).toBeUndefined();
  });

  it('orders the rows by what the best trip brings, a row without a trip last whichever way it goes', () => {
    expect(orderRows(rowsOf(1, 2, 3, 4), options(PROFIT_DESC)).map((row) => row.commodityId)).toEqual([2, 4, 1, 3]);
    expect(orderRows(rowsOf(1, 2, 3, 4), options({ key: 'profit', dir: 'asc' })).map((row) => row.commodityId)).toEqual([1, 4, 2, 3]);
  });

  it('is not the order of the ROI: every row has the same percentage here', () => {
    expect(orderRows(rowsOf(1, 2, 3, 4), options(ROI_DESC)).map((row) => row.commodityId)).toEqual([1, 2, 3, 4]);
  });
});

describe('terminalAriaSort: the aria-sort of a header', () => {
  it('names the direction of the header that is active and nothing for the other one', () => {
    expect(terminalAriaSort(DEFAULT, 'name')).toBe('ascending');
    expect(terminalAriaSort(DEFAULT, 'roi')).toBeUndefined();
    expect(terminalAriaSort(ROI_DESC, 'roi')).toBe('descending');
    expect(terminalAriaSort(ROI_ASC, 'roi')).toBe('ascending');
    expect(terminalAriaSort(ROI_DESC, 'name')).toBeUndefined();
  });
});

describe('holdOf: which rows are my cargo', () => {
  it('is the cargo by commodity on the sell side, while there is some', () => {
    const hold = holdOf('sell', [line(4, 120), line(6, 80)]);
    expect([...hold.keys()]).toEqual([4, 6]);
    expect(hold.get(4)?.scu).toBe(120);
  });

  it('is nothing on the buy side, whatever is in the hold', () => {
    expect(holdOf('buy', [line(4, 120)]).size).toBe(0);
  });

  it('is nothing without cargo', () => {
    expect(holdOf('sell', []).size).toBe(0);
  });
});

describe('holdMark: the mark at the name of a commodity that is in the hold', () => {
  it('is the quantity, and the tooltip says what was paid for it', () => {
    expect(holdMark(line(4, 120, 2115))).toEqual({ text: '120', title: `В трюме 120 SCU, куплено по ${nb('2 115')}` });
  });

  it('groups the thousands like every number, and rounds a price that is an average to a whole one', () => {
    expect(holdMark(line(4, 1200, 2114.6))).toEqual({ text: nb('1 200'), title: `В трюме ${nb('1 200')} SCU, куплено по ${nb('2 115')}` });
  });
});

describe('orderRows: the order of the rows of the table', () => {
  it('leaves the default order as it came, with no cargo', () => {
    expect(ids(orderRows(ROWS, { side: 'sell', sort: DEFAULT, cargo: [], percentOf }))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('puts the best ROI first, and the rows without one last, at the first click on «ROI»', () => {
    expect(ids(orderRows(ROWS, { side: 'buy', sort: ROI_DESC, cargo: [], percentOf }))).toEqual([3, 4, 5, 1, 6, 2]);
  });

  it('puts the worst ROI first when it is turned round, and the rows without one are still last', () => {
    expect(ids(orderRows(ROWS, { side: 'buy', sort: ROI_ASC, cargo: [], percentOf }))).toEqual([6, 1, 4, 5, 3, 2]);
  });

  it('keeps rows of the same ROI in the order they came in, in both directions', () => {
    // 4 and 5 are both 25 %
    expect(ids(orderRows(ROWS, { side: 'buy', sort: ROI_DESC, cargo: [], percentOf })).filter((id) => id === 4 || id === 5)).toEqual([4, 5]);
    expect(ids(orderRows(ROWS, { side: 'buy', sort: ROI_ASC, cargo: [], percentOf })).filter((id) => id === 4 || id === 5)).toEqual([4, 5]);
  });

  it('puts the commodities of the hold first on the sell side, in the order of the cargo, the others as before', () => {
    expect(ids(orderRows(ROWS, { side: 'sell', sort: DEFAULT, cargo: [line(6, 80), line(4, 120)], percentOf }))).toEqual([6, 4, 1, 2, 3, 5]);
  });

  it('changes nothing on the buy side, where the cargo is not a mark of any row', () => {
    expect(ids(orderRows(ROWS, { side: 'buy', sort: DEFAULT, cargo: [line(6, 80), line(4, 120)], percentOf }))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('keeps the cargo first whatever the sort is, and sorts inside each of the two groups', () => {
    const cargo = [line(2, 50), line(4, 120)]; // BERY has no ROI, MEDS 25 %
    expect(ids(orderRows(ROWS, { side: 'sell', sort: ROI_DESC, cargo, percentOf }))).toEqual([4, 2, 3, 5, 1, 6]);
    expect(ids(orderRows(ROWS, { side: 'sell', sort: ROI_ASC, cargo, percentOf }))).toEqual([4, 2, 6, 1, 5, 3]);
  });

  it('skips a commodity of the hold that the table does not have', () => {
    expect(ids(orderRows(ROWS, { side: 'sell', sort: DEFAULT, cargo: [line(99, 10), line(5, 20)], percentOf }))).toEqual([5, 1, 2, 3, 4, 6]);
  });

  it('returns a new list and leaves the rows it was given as they were', () => {
    const input = [...ROWS];
    const out = orderRows(input, { side: 'sell', sort: ROI_DESC, cargo: [line(6, 80)], percentOf });
    expect(out).not.toBe(input);
    expect(ids(input)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('is the same list of rows, none lost and none doubled', () => {
    const out = ids(orderRows(ROWS, { side: 'sell', sort: ROI_DESC, cargo: [line(3, 1), line(1, 1)], percentOf }));
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('holdOrder: the order of the rows is held while a field of the table has the focus', () => {
  // a row that carries its value: the row is the same commodity with a new number, which must show
  const withValue = (commodityId: number, value: number) => ({ commodityId, value });
  const sorted = [withValue(3, 40), withValue(4, 30), withValue(1, 12)];

  it('is the sorted order when nothing is held', () => {
    expect(ids(holdOrder([1, 3, 4], sorted, false))).toEqual([3, 4, 1]);
  });

  it('keeps the order that was on screen when the focus came in, whatever the sort says now', () => {
    expect(ids(holdOrder([1, 3, 4], sorted, true))).toEqual([1, 3, 4]);
  });

  it('shows the new values in their rows: the rows are the new ones, only their places are the old ones', () => {
    const held = holdOrder([1, 3, 4], [withValue(3, 99), withValue(4, 30), withValue(1, 12)], true);
    expect(held.map((row) => [row.commodityId, row.value])).toEqual([[1, 12], [3, 99], [4, 30]]);
  });

  it('puts a row that appeared meanwhile at the end, in the sorted order of the new ones, and drops a row that went', () => {
    const now = [withValue(7, 50), withValue(3, 40), withValue(8, 20), withValue(1, 12)]; // 4 went, 7 and 8 came
    expect(ids(holdOrder([1, 3, 4], now, true))).toEqual([1, 3, 7, 8]);
  });

  it('holds nothing without a previous order: an empty one holds no place, the rows are as sorted', () => {
    expect(ids(holdOrder([], sorted, true))).toEqual([3, 4, 1]);
  });

  it('returns a new list and leaves the sorted rows as they were', () => {
    const input = [...sorted];
    const out = holdOrder([1, 3, 4], input, true);
    expect(out).not.toBe(input);
    expect(ids(input)).toEqual([3, 4, 1]);
  });
});

describe('heldPlaces: the places of the rows are held while a field has the cursor OR a row is open', () => {
  const none = { fieldFocused: false, rowOpen: false };
  const typing = { fieldFocused: true, rowOpen: false };
  const open = { fieldFocused: false, rowOpen: true };
  const both = { fieldFocused: true, rowOpen: true };

  it('holds nothing when neither is so: the sort has its way, and an order that was held is let go', () => {
    expect(heldPlaces(null, [3, 4, 1], none)).toBeNull();
    expect(heldPlaces([1, 3, 4], [3, 4, 1], none)).toBeNull();
  });

  it('takes the order that is on screen when the cursor comes into a field', () => {
    expect(heldPlaces(null, [1, 3, 4], typing)).toEqual([1, 3, 4]);
  });

  it('takes the order that is on screen when a row is opened, with no cursor in the table', () => {
    expect(heldPlaces(null, [1, 3, 4], open)).toEqual([1, 3, 4]);
  });

  it('keeps the order it took, not the one the sort gives now: the cursor leaves the field, the row stays open', () => {
    expect(heldPlaces([1, 3, 4], [3, 4, 1], open)).toEqual([1, 3, 4]);
  });

  it('keeps it the other way round too: the row is folded, the cursor still stands in a field', () => {
    expect(heldPlaces([1, 3, 4], [3, 4, 1], typing)).toEqual([1, 3, 4]);
    expect(heldPlaces([1, 3, 4], [3, 4, 1], both)).toEqual([1, 3, 4]);
  });

  it('returns a copy: the list of the rows on screen is not the one that is held', () => {
    const shown = [1, 3, 4];
    const taken = heldPlaces(null, shown, open);
    expect(taken).toEqual(shown);
    expect(taken).not.toBe(shown);
  });

  it('a click on a sort header with a row open is the player\'s own request for a new order: the places are taken again from the freshly sorted rows, and the open row stands where that order puts it', () => {
    const byRoi = ids(orderRows(ROWS, { side: 'sell', sort: ROI_DESC, cargo: [line(6, 80)], percentOf }));
    expect(byRoi).toEqual([6, 3, 4, 5, 1, 2]);
    const renewed = resortedPlaces(byRoi, open);
    expect(renewed).toEqual(byRoi);
    expect(renewed).not.toBe(byRoi); // a copy: the list on screen is not the one that is held
    // from now on the places are held again as before: the sale that changes the order afterwards does not move the rows
    const afterSale = ids(orderRows(ROWS, { side: 'sell', sort: ROI_DESC, cargo: [], percentOf }));
    expect(afterSale).not.toEqual(byRoi);
    expect(heldPlaces(renewed, afterSale, open)).toEqual(byRoi);
  });

  it('a click that changes neither the key nor the direction of the sort still renews the held order: «Товар» clicked while the default order is on', () => {
    // the sell side, default sort, MEDS (4) open and sold out: it keeps the first place, the order it would have by the sort is another one
    const held = heldPlaces(null, ids(orderRows(ROWS, { side: 'sell', sort: DEFAULT, cargo: [line(4, 120), line(6, 80)], percentOf })), open);
    expect(held).toEqual([4, 6, 1, 2, 3, 5]);
    const sortedNow = ids(orderRows(ROWS, { side: 'sell', sort: DEFAULT, cargo: [line(6, 80)], percentOf }));
    expect(heldPlaces(held, sortedNow, open)).toEqual([4, 6, 1, 2, 3, 5]); // a sale: the old places stay
    // the click on «Товар» is no change of the sort at all...
    expect(clickedTerminalSort(DEFAULT, 'name')).toEqual(DEFAULT);
    // ...and the request still takes the new order, whatever the sort did or did not do
    expect(resortedPlaces(sortedNow, open)).toEqual([6, 1, 2, 3, 4, 5]);
  });

  it('a sort request holds nothing when nothing holds the places: the sort simply shows', () => {
    expect(resortedPlaces([3, 4, 1], none)).toBeNull();
    expect(resortedPlaces([], none)).toBeNull();
  });

  it('a sort request is not a sale: the sale keeps the old places (`heldPlaces`), the request takes the new ones (`resortedPlaces`)', () => {
    const held = [1, 3, 4];
    const sortedNow = [3, 4, 1];
    expect(heldPlaces(held, sortedNow, open)).toEqual([1, 3, 4]);
    expect(resortedPlaces(sortedNow, open)).toEqual([3, 4, 1]);
  });

  it('a sale of the open row does not take it from its place; folding the row gives the sort its way', () => {
    // the sell side, two commodities in the hold: 4 (MEDS) and 6 (STIM) stand first, then the rest by name
    const sortedWith = (cargo: CargoLine[]) => orderRows(ROWS, { side: 'sell', sort: DEFAULT, cargo, percentOf });
    const before = ids(sortedWith([line(4, 120), line(6, 80)]));
    expect(before).toEqual([4, 6, 1, 2, 3, 5]);
    // the player opens the row of MEDS
    const held = heldPlaces(null, before, open);
    // MEDS is sold out: its row has no mark, and the sort would put it among the rest, but the place is held
    const after = sortedWith([line(6, 80)]);
    expect(ids(after)).toEqual([6, 1, 2, 3, 4, 5]);
    expect(ids(holdOrder(held ?? [], after, held !== null))).toEqual([4, 6, 1, 2, 3, 5]);
    // the row is folded: nothing holds, the rows go to their places
    const released = heldPlaces(held, ids(after), none);
    expect(ids(holdOrder(released ?? [], after, released !== null))).toEqual([6, 1, 2, 3, 4, 5]);
  });
});
