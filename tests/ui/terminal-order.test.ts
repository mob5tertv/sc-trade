import { describe, expect, it } from 'vitest';
import type { CargoLine } from '../../src/core/types';
import { holdMark, holdOf, orderRows } from '../../src/ui/vm/terminal-order';

// formatUec separates thousands with a non-breaking space
const nb = (s: string) => s.replace(/ /g, String.fromCharCode(0xa0));

// Six commodities in the order the table has them by default (by name): the id says which is which.
const ROWS = [1, 2, 3, 4, 5, 6].map((commodityId) => ({ commodityId }));
const ids = (rows: Array<{ commodityId: number }>): number[] => rows.map((row) => row.commodityId);

const line = (commodityId: number, scu: number, avgBuyPrice = 2115): CargoLine => ({ commodityId, scu, avgBuyPrice });

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

describe('orderRows: my cargo first on the sell side', () => {
  it('leaves the rows as they came, with no cargo', () => {
    expect(ids(orderRows(ROWS, { side: 'sell', cargo: [] }))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('puts the commodities of the hold first on the sell side, in the order of the cargo, the others as before', () => {
    expect(ids(orderRows(ROWS, { side: 'sell', cargo: [line(6, 80), line(4, 120)] }))).toEqual([6, 4, 1, 2, 3, 5]);
  });

  it('changes nothing on the buy side, where the cargo is not a mark of any row', () => {
    expect(ids(orderRows(ROWS, { side: 'buy', cargo: [line(6, 80), line(4, 120)] }))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('skips a commodity of the hold that the table does not have', () => {
    expect(ids(orderRows(ROWS, { side: 'sell', cargo: [line(99, 10), line(5, 20)] }))).toEqual([5, 1, 2, 3, 4, 6]);
  });

  it('returns a new list and leaves the rows it was given as they were', () => {
    const input = [...ROWS];
    const out = orderRows(input, { side: 'sell', cargo: [line(6, 80)] });
    expect(out).not.toBe(input);
    expect(ids(input)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('is the same list of rows, none lost and none doubled', () => {
    expect([...ids(orderRows(ROWS, { side: 'sell', cargo: [line(3, 1), line(1, 1)] }))].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
