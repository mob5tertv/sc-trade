import { describe, expect, it } from 'vitest';
import { buildMarket } from '../../src/core/market';
import { allowedSide, entryCommodities, entrySides, uexSides } from '../../src/ui/vm/quick-entry';
import { obs } from '../helpers/factories';
import { ctx, GOLD, market, NOW, withBuy } from '../helpers/route-fixtures';

// The author's decisions of 13.10.2026: the quick entry must not write a commodity to a station that does not trade it, and its
// list must follow the chosen side. Test prices typed in at Everus Harbor had become goods of that station, and a commodity the
// station only BUYS could be picked while the line stood on «Куп.».
//
// The route scenario: A (1) sells Gold at my own price (UEX has no row there); B (2) buys Gold by UEX; Titanium (20) is added
// where a test needs a second commodity.
const TITA = 20;
const all = [{ id: GOLD, code: 'GOLD' }, { id: TITA, code: 'TITA' }, { id: 51, code: 'MEDS' }];
const codes = (list: Array<{ code: string }>) => list.map((c) => c.code);

describe('uexSides', () => {
  it('says what UEX knows the terminal to trade, side by side', () => {
    expect(uexSides(market, 2, ctx)).toEqual(new Map([[GOLD, { buy: false, sell: true }]]));
    const sells = withBuy(market, 2, { last: 2500, avgWeek: 2500, minWeek: 2500, maxWeek: 2500 }, TITA);
    expect(uexSides(sells, 2, ctx).get(TITA)).toEqual({ buy: true, sell: false });
  });

  it('does not take a record of mine for a commodity of the terminal: a price typed in at the wrong station makes nothing its own', () => {
    expect(uexSides(market, 1, ctx).size).toBe(0);                 // A has only my own price of Gold
    const mistaken = buildMarket([...market.uex.values()], [...market.own.values(), obs({ id: 60, ts: NOW - 60, terminalId: 2, commodityId: 51, side: 'buy', price: 3333, scu: 15 })]);
    expect(uexSides(mistaken, 2, ctx).has(51)).toBe(false);
  });
});

describe('entryCommodities', () => {
  const sides = new Map([[GOLD, { buy: false, sell: true }], [TITA, { buy: true, sell: true }]]);

  it('offers on «Куп.» what the terminal sells, and on «Прод.» what it buys', () => {
    expect(codes(entryCommodities(all, sides, 'buy'))).toEqual(['TITA']);
    expect(codes(entryCommodities(all, sides, 'sell'))).toEqual(['GOLD', 'TITA']);
  });

  it('offers every commodity only where UEX knows nothing of the terminal: a station nobody has a price of yet', () => {
    expect(entryCommodities(all, new Map(), 'buy')).toEqual(all);
    expect(entryCommodities(all, new Map(), 'sell')).toEqual(all);
  });
});

describe('entrySides and allowedSide', () => {
  const sides = new Map([[GOLD, { buy: false, sell: true }], [TITA, { buy: true, sell: true }]]);

  it('lets a price be written only to a side the terminal trades the commodity on', () => {
    expect(entrySides(GOLD, sides)).toEqual({ buy: false, sell: true });
    expect(allowedSide('buy', entrySides(GOLD, sides))).toBe('sell');
    expect(allowedSide('sell', entrySides(GOLD, sides))).toBe('sell');
    expect(allowedSide('buy', entrySides(TITA, sides))).toBe('buy');
  });

  it('allows neither side for a commodity UEX does not list at a terminal it knows', () => {
    expect(entrySides(51, sides)).toEqual({ buy: false, sell: false });
  });

  it('limits nothing before a commodity is chosen, and where UEX knows nothing of the terminal', () => {
    expect(entrySides(null, sides)).toBeNull();
    expect(entrySides(51, new Map())).toBeNull();
    expect(allowedSide('sell', null)).toBe('sell');
  });
});
