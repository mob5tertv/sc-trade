import { describe, expect, it } from 'vitest';
import { bestPlaces, PLACES_MAX } from '../../src/core/places';
import { guideEmptyText, guideRows } from '../../src/ui/vm/guide';
import { ref } from '../helpers/factories';
import { ctx, GOLD, market, withBuy, withSell } from '../helpers/route-fixtures';

// The route scenario: A (1) sells Gold at my hot price 6120, stock 340. B (2) buys it at UEX 6900, C (3) at my 6840, D (4, another
// star system) at UEX 9000. Terminals 1, 2, 3, 5, 6 are in system 68.
const all = { starSystemId: null, onlyStock: false };
const ids = (places: Array<{ terminalId: number }>) => places.map((p) => p.terminalId);
// prices are formatted with a non-breaking space as the thousands separator
const nb = (text: string): string => text.replace(/ /g, String.fromCharCode(0xa0));

describe('bestPlaces', () => {
  it('lists where to sell, the dearest first, and where to buy, the cheapest first', () => {
    expect(bestPlaces(market, GOLD, 'sell', ctx, ref.terminals, all).map((p) => [p.terminalId, p.estimate.price])).toEqual([[4, 9000], [2, 6900], [3, 6840]]);
    const two = withBuy(market, 5, { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 });
    expect(bestPlaces(two, GOLD, 'buy', ctx, ref.terminals, all).map((p) => [p.terminalId, p.estimate.price])).toEqual([[5, 6000], [1, 6120]]);
  });

  it('keeps to the star system when asked', () => {
    expect(ids(bestPlaces(market, GOLD, 'sell', ctx, ref.terminals, { ...all, starSystemId: 68 }))).toEqual([2, 3]);
    expect(ids(bestPlaces(market, GOLD, 'sell', ctx, ref.terminals, { ...all, starSystemId: 99 }))).toEqual([4]);
  });

  it('with «есть запас» lists only the places to buy whose stock is known and not empty, and filters no place to sell', () => {
    const two = withBuy(market, 5, { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 });      // nobody knows the stock of 5
    expect(ids(bestPlaces(two, GOLD, 'buy', ctx, ref.terminals, { ...all, onlyStock: true }))).toEqual([1]);
    expect(ids(bestPlaces(market, GOLD, 'sell', ctx, ref.terminals, { ...all, onlyStock: true }))).toEqual([4, 2, 3]);
  });

  it('takes my own price before the one of UEX, as everywhere', () => {
    const both = withSell(market, 3, 7500);                                                // UEX says 7500 at C, my warm price is 6840
    expect(bestPlaces(both, GOLD, 'sell', ctx, ref.terminals, all).find((p) => p.terminalId === 3)!.estimate).toMatchObject({ price: 6840, source: 'own' });
  });

  it('lists ten at most, skips a terminal that left the reference, and has nothing for a commodity nobody trades', () => {
    let many = market;
    const terminals = new Map(ref.terminals);
    for (let id = 101; id <= 115; id++) {
      many = withSell(many, id, 7000 + id);
      terminals.set(id, { ...terminals.get(2)!, id });
    }
    const places = bestPlaces(many, GOLD, 'sell', ctx, terminals, { ...all, starSystemId: 68 });
    expect(places).toHaveLength(PLACES_MAX);
    expect(ids(places).slice(0, 3)).toEqual([115, 114, 113]);
    expect(ids(bestPlaces(many, GOLD, 'sell', ctx, ref.terminals, { ...all, starSystemId: 68 }))).toEqual([2, 3]);   // 101–115 are not in this reference
    expect(bestPlaces(market, 999, 'sell', ctx, ref.terminals, all)).toEqual([]);
  });
});

describe('guideRows', () => {
  const places = bestPlaces(market, GOLD, 'sell', ctx, ref.terminals, { ...all, starSystemId: 68 });

  it('says the place, its price with whose it is and how old, and what the buyer holds', () => {
    const rows = guideRows(places, ref, { targetId: 2, hereId: 3 });
    expect(rows.map((r) => [r.terminal, r.price, r.badge.kind, r.scu, r.isTarget, r.isHere])).toEqual([
      ['TDD Area 18', nb('6 900'), 'uex', '—', true, false],
      [rows[1].terminal, nb('6 840'), 'warm', '—', false, true],
    ]);
    expect(rows[0].extra).toBeNull();
  });

  it('marks a stock that is an estimate by the refill timer, and says a known one plainly', () => {
    const buy = guideRows(bestPlaces(market, GOLD, 'buy', ctx, ref.terminals, all), ref, { targetId: null, hereId: null });
    expect(buy[0].scu).toBe('≈340');   // my own reading of 340 SCU, brought up to date by the timer
  });

  it('says what each place would add to selling the cargo here, when it is asked for a cargo', () => {
    const rows = guideRows(places, ref, { targetId: null, hereId: 3, cargo: { scu: 100, herePrice: 6840 } });
    expect(rows.map((r) => [r.extra, r.extraLoss])).toEqual([[nb('+6 000'), false], ['0', true]]);
  });

  it('says why the list is empty', () => {
    expect(guideEmptyText('sell', false)).toContain('Продать этот товар некуда');
    expect(guideEmptyText('buy', true)).toContain('сними фильтры');
  });
});
