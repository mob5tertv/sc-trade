import { describe, expect, it } from 'vitest';
import { buildMarket } from '../../src/core/market';
import { doubtfulRecords, recordRows } from '../../src/ui/vm/records';
import { obs, px, ref } from '../helpers/factories';
import { ctx, GOLD, NOW } from '../helpers/route-fixtures';

// «Записи» (the author, 14.10.2026): every price of the player's own in one list. A test price of 2 222 typed in at a station
// where UEX does not know the commodity gave a "best" trip of 161 %, and nothing showed where it came from.
const nb = (s: string) => s.replace(/ /g, String.fromCharCode(0xa0));
const TITA = 20;
const stats = (avg: number, min: number, max: number) => ({ last: avg, avgWeek: avg, minWeek: min, maxWeek: max, avg, min, max });

// UEX: B (2) buys Gold at 6900 (6400–7100) and Titanium at 3000 (2800–3200). It knows nothing of terminal 5.
const market = buildMarket(
  [px(2, GOLD, { sell: stats(6900, 6400, 7100) }), px(2, TITA, { sell: stats(3000, 2800, 3200) })],
  [
    obs({ id: 1, ts: NOW - 3 * 3600, terminalId: 2, commodityId: GOLD, side: 'sell', price: 6840, scu: 500 }),
    obs({ id: 2, ts: NOW - 600, terminalId: 5, commodityId: GOLD, side: 'buy', price: 2222, scu: null }),
    obs({ id: 3, ts: NOW - 60, terminalId: 2, commodityId: TITA, side: 'sell', price: 300, scu: 0 }),
  ],
);

describe('recordRows', () => {
  const rows = recordRows(market, ref, ctx);

  it('lists every record of mine, the newest first, with where, what, which side and the numbers', () => {
    expect(rows.map((row) => row.id)).toEqual([3, 2, 1]);
    expect(rows[2]).toMatchObject({
      id: 1, terminalId: 2, commodityId: GOLD, side: 'sell', terminal: 'TDD Area 18', code: 'GOLD', sideLabel: 'прод.',
      price: 6840, scu: 500, priceText: nb('6 840'), scuText: '500', age: '3 ч', doubt: null,
    });
    expect(rows[1]).toMatchObject({ sideLabel: 'куп.', scu: null, scuText: '', age: '10 мин' });
    expect(rows[0]).toMatchObject({ scu: 0, scuText: '0' });                    // a known zero is a quantity
  });

  it('marks a record that nothing can check: UEX does not know the commodity at that terminal', () => {
    expect(rows[1].doubt).toMatch(/UEX этого товара на этой станции не знает/);
  });

  it('marks a price far from what UEX has ever seen there, by the rule of the table of the terminal', () => {
    expect(rows[0].doubt).toMatch(/далеко от истории UEX/);                     // 300 is under half of the minimum 2800
  });

  it('gives the doubtful ones apart, in the same order', () => {
    expect(doubtfulRecords(rows).map((row) => row.id)).toEqual([3, 2]);
    expect(doubtfulRecords([])).toEqual([]);
  });

  it('is empty without records, and survives a terminal and a commodity that left the reference', () => {
    expect(recordRows(buildMarket([], []), ref, ctx)).toEqual([]);
    const odd = buildMarket([], [obs({ id: 9, ts: NOW, terminalId: 777, commodityId: 999, side: 'buy', price: 5, scu: null })]);
    expect(recordRows(odd, ref, ctx)[0]).toMatchObject({ terminal: '#777', code: '#999', priceText: '5' });
  });
});
