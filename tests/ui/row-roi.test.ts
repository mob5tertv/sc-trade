import { describe, expect, it } from 'vitest';
import { routesFrom, routesTo } from '../../src/core/routes';
import { roiTier } from '../../src/ui/vm/roi-tier';
import { crossedRows, isHot, roiCell, roiCells, rowRoiMap, profitMark } from '../../src/ui/vm/row-roi';
import type { RowRoi, RoiSnapshot } from '../../src/ui/vm/row-roi';
import { ref } from '../helpers/factories';
import {
  ctx, FAR, GOLD, HERE, marketOf, NEAR, ownPrice, quotes, TITA, TUNG, withDistances, withFreeScu, withSettings,
} from '../helpers/row-roi-fixtures';

const nb = (text: string): string => text.replace(/(\d) (\d)/g, '$1 $2');

describe('rowRoiMap: what the table shows next to a commodity', () => {
  const market = marketOf(quotes);

  it('sell here: the best of every way to bring the commodity here', () => {
    const map = rowRoiMap(market, HERE, 'sell', ctx);
    // Gold is bought at 2 (6000), 3 (6400) or 5 (7000) and sold here at 8000: the cheapest source wins
    expect(map.get(GOLD)).toMatchObject({ commodityId: GOLD, otherId: 2, buyPrice: 6000, sellPrice: 8000 });
    expect(map.get(GOLD)?.roi).toBeCloseTo(8000 / 6000 - 1, 10);
    expect(map.get(TITA)).toMatchObject({ otherId: 3, buyPrice: 4000, sellPrice: 5000 });
    expect(map.get(TITA)?.roi).toBeCloseTo(0.25, 10);
  });

  it('buy here: the best of every place the commodity can be taken to', () => {
    const map = rowRoiMap(market, HERE, 'buy', ctx);
    // Gold is bought here at 6000 and sold at 2 (7500) or 3 (7000): 2 wins
    expect(map.get(GOLD)).toMatchObject({ otherId: 2, buyPrice: 6000, sellPrice: 7500 });
    expect(map.get(GOLD)?.roi).toBeCloseTo(0.25, 10);
    expect(map.get(TITA)).toMatchObject({ otherId: 3, buyPrice: 4000, sellPrice: 4400 });
    expect(map.get(TITA)?.roi).toBeCloseTo(0.1, 10);
  });

  it('a commodity without a trip that pays has no value, on either side', () => {
    expect(rowRoiMap(market, HERE, 'sell', ctx).has(TUNG)).toBe(false);
    expect(rowRoiMap(market, HERE, 'buy', ctx).has(TUNG)).toBe(false);
  });

  it('is not cut by the number of options of the settings', () => {
    expect(ctx.settings.topN).toBe(1);
    expect([...rowRoiMap(market, HERE, 'sell', ctx).keys()].sort()).toEqual([GOLD, TITA]);
    expect([...rowRoiMap(market, HERE, 'buy', ctx).keys()].sort()).toEqual([GOLD, TITA]);
  });

  it('a source that has nothing to sell does not count: the next best takes its place', () => {
    // the player saw terminal 2 empty (a known zero, a reading of two minutes ago)
    const empty = marketOf(quotes, [ownPrice(2, GOLD, 'buy', 6000, 0)]);
    const map = rowRoiMap(empty, HERE, 'sell', ctx);
    expect(map.get(GOLD)).toMatchObject({ otherId: 3, buyPrice: 6400 });
  });

  it('counts the trips that rest on an unknown stock too: the order of the list of options (known stocks first) does not touch the best ROI of a row', () => {
    // terminal 2, the cheapest source of Gold, says nothing of its stock (UEC has none, I have no reading); 3 and 5 have a stock of 500
    const unknown = marketOf(quotes.map((q) => (q.terminalId === 2 && q.commodityId === GOLD ? { ...q, scuBuy: 0 } : q)));
    const options = routesTo(unknown, HERE, { ...ctx, settings: { ...ctx.settings, topN: 99 } }, GOLD).options;
    expect(options.map((o) => [o.originId, o.buy.scu])).toEqual([[3, 500], [5, 500], [2, null]]);   // the unknown stock is last in the list…
    // …and the row still says the best there is
    expect(rowRoiMap(unknown, HERE, 'sell', ctx).get(GOLD)).toMatchObject({ otherId: 2, buyPrice: 6000, sellPrice: 8000 });
    expect(rowRoiMap(unknown, HERE, 'sell', ctx)).toEqual(rowRoiMap(market, HERE, 'sell', ctx));
  });

  it('a commodity that no source can supply has no value at all', () => {
    const empty = marketOf(quotes, [ownPrice(2, GOLD, 'buy', 6000, 0), ownPrice(3, GOLD, 'buy', 6400, 0), ownPrice(5, GOLD, 'buy', 7000, 0)]);
    expect(rowRoiMap(empty, HERE, 'sell', ctx).has(GOLD)).toBe(false);
  });

  it('the filter of the star system applies to the other end of the trip', () => {
    // terminal 4 is in another system and sells Gold dearer, 4500: with every system allowed it is the best source
    const far = marketOf([...quotes, { terminalId: 4, commodityId: GOLD, buy: 4500, scuBuy: 500 }]);
    expect(rowRoiMap(far, HERE, 'sell', ctx).get(GOLD)).toMatchObject({ otherId: 2 });
    expect(rowRoiMap(far, HERE, 'sell', withSettings({ starSystemId: null })).get(GOLD)).toMatchObject({ otherId: 4, buyPrice: 4500 });
  });

  it('the filter of the star system applies to the buyers of a commodity bought here', () => {
    const far = marketOf([...quotes, { terminalId: 4, commodityId: GOLD, sell: 9000 }]);
    expect(rowRoiMap(far, HERE, 'buy', ctx).get(GOLD)).toMatchObject({ otherId: 2 });
    expect(rowRoiMap(far, HERE, 'buy', withSettings({ starSystemId: null })).get(GOLD)).toMatchObject({ otherId: 4, sellPrice: 9000 });
  });

  it('a budget that buys nothing leaves the rows without a value', () => {
    // 5000 UEC buy a SCU of Titanium (4000) and none of Gold (6000 and more)
    const map = rowRoiMap(market, HERE, 'sell', withSettings({ budget: 5000 }));
    expect(map.has(GOLD)).toBe(false);
    expect(map.get(TITA)).toMatchObject({ otherId: 3 });
    expect(rowRoiMap(market, HERE, 'sell', withSettings({ budget: 100 })).size).toBe(0);
  });

  it('without free space in the hold nothing can be carried: no values', () => {
    expect(rowRoiMap(market, HERE, 'sell', withFreeScu(0)).size).toBe(0);
    expect(rowRoiMap(market, HERE, 'buy', withFreeScu(0)).size).toBe(0);
  });

  it('my own price beats the UEX one: on the side that is sold here', () => {
    // the player saw the terminal pay 9000 for Gold; UEX said 8000
    const mine = marketOf(quotes, [ownPrice(HERE, GOLD, 'sell', 9000)]);
    const map = rowRoiMap(mine, HERE, 'sell', ctx);
    expect(map.get(GOLD)).toMatchObject({ sellPrice: 9000, buyPrice: 6000 });
    expect(map.get(GOLD)?.roi).toBeCloseTo(0.5, 10);
  });

  it('my own price beats the UEX one: at the place the commodity is bought', () => {
    // the player saw terminal 2 ask 5000 for Gold; UEX said 6000
    const mine = marketOf(quotes, [ownPrice(2, GOLD, 'buy', 5000, 300)]);
    const map = rowRoiMap(mine, HERE, 'sell', ctx);
    expect(map.get(GOLD)).toMatchObject({ otherId: 2, buyPrice: 5000 });
    expect(map.get(GOLD)?.roi).toBeCloseTo(0.6, 10);
  });

  it('a price I entered at this very terminal makes a row that UEX had nothing for', () => {
    // UEX knows no price for Tungsten here; the player saw the terminal pay 4000 and Tungsten is sold at 2 for 3500
    const mine = marketOf(quotes, [ownPrice(HERE, TUNG, 'sell', 4000)]);
    expect(rowRoiMap(mine, HERE, 'sell', ctx).get(TUNG)).toMatchObject({ otherId: 2, buyPrice: 3500, sellPrice: 4000 });
  });

  it('the value is a ratio, as a trip of the options has it, whatever the quantity', () => {
    const small = rowRoiMap(market, HERE, 'sell', withFreeScu(1)).get(GOLD);
    const big = rowRoiMap(market, HERE, 'sell', withFreeScu(600)).get(GOLD);
    expect(small?.roi).toBeCloseTo(big?.roi ?? NaN, 10);
  });

  it('an empty market gives an empty map', () => {
    expect(rowRoiMap(marketOf([]), HERE, 'sell', ctx).size).toBe(0);
    expect(rowRoiMap(marketOf([]), HERE, 'buy', ctx).size).toBe(0);
  });

  it('a terminal that is not in the reference gives nothing and does not throw', () => {
    expect(rowRoiMap(market, 999, 'sell', ctx).size).toBe(0);
    expect(rowRoiMap(market, 999, 'buy', ctx).size).toBe(0);
  });
});

describe('rowRoiMap: the best ROI of a commodity, whatever the options are ranked by', () => {
  it('sell here: the row has the higher ROI of the farther origin, whatever the one option that is shown', () => {
    const market = marketOf(quotes);
    const ranked = withDistances(withSettings({ sort: 'profit' }));
    // the premise: the list is cut to one option; the row is counted from all of them
    expect(routesTo(market, HERE, ranked, GOLD).options).toHaveLength(1);
    const best = rowRoiMap(market, HERE, 'sell', ranked).get(GOLD);
    expect(best).toMatchObject({ otherId: FAR, buyPrice: 6000, sellPrice: 8000 });
    expect(best?.roi).toBeCloseTo(8000 / 6000 - 1, 10);
  });

  it('buy here: the row has the far buyer (ROI 25 %), which is the trip that brings the most as well', () => {
    const market = marketOf(quotes);
    const ranked = withDistances(withSettings({ sort: 'profit' }));
    expect(routesFrom(market, [HERE], HERE, ranked, GOLD).options.map((o) => o.destId)).toEqual([FAR]);
    const best = rowRoiMap(market, HERE, 'buy', ranked).get(GOLD);
    expect(best).toMatchObject({ otherId: FAR, buyPrice: 6000, sellPrice: 7500 });
    expect(best?.roi).toBeCloseTo(0.25, 10);
  });

  it('the same row whichever way the options are ranked', () => {
    const market = marketOf(quotes);
    const byRate = rowRoiMap(market, HERE, 'sell', withDistances(withSettings({ sort: 'profit' })));
    const byRoi = rowRoiMap(market, HERE, 'sell', withDistances(withSettings({ sort: 'roi' })));
    expect(byRate).toEqual(byRoi);
  });

  describe('the most a trip brings is counted apart from the best ROI (plan item 17)', () => {
    // Gold is sold here at 8000. Terminal 2 sells it at 5000 but has 20 SCU; terminal 3 sells it at 6000 and has 500.
    const market = marketOf([
      { terminalId: HERE, commodityId: GOLD, sell: 8000 },
      { terminalId: 2, commodityId: GOLD, buy: 5000, scuBuy: 20 },
      { terminalId: 3, commodityId: GOLD, buy: 6000, scuBuy: 500 },
    ]);

    it('sell here: the ROI is the one of the cheap seller with little stock, the profit the one of the seller that fills the hold', () => {
      const row = rowRoiMap(market, HERE, 'sell', ctx).get(GOLD)!;
      expect(row).toMatchObject({ otherId: 2, buyPrice: 5000, profitOtherId: 3 });
      expect(row.roi).toBeCloseTo(0.6, 10);                                 // 3000 on 5000
      expect(row.qty).toBe(Math.min(500, ctx.freeScu));
      expect(row.profit).toBe(row.qty * 2000);                              // far more than the 20 × 3000 of the best ROI
      expect(row.profit).toBeGreaterThan(20 * 3000);
    });

    it('says in the hint of the cell which trip brings the most when it is another one', () => {
      const cell = roiCell(rowRoiMap(market, HERE, 'sell', ctx).get(GOLD)!, 'sell', ref, 50);
      expect(cell).toMatchObject({ text: '60%', hot: true });
      expect(cell.profit).toBe(Math.min(500, ctx.freeScu) * 2000);
      expect(cell.title).toContain('Больше всего за рейс');
      expect(cell.title).toMatch(/SCU, из /);
    });

    it('names no second trip when the best ROI and the biggest profit are one trip', () => {
      const cell = roiCell(best({ profit: 532_440, qty: 696, profitOtherId: 3, otherId: 3 }), 'buy', ref, 50);
      expect(cell.gain).toBe('532k');
      expect(cell.title).toMatch(/Больше всего за рейс: 532.440 \(696 SCU\)\n/);
    });
  });

  describe('a tie', () => {
    // Gold is bought at 2 and at 3 for the same 6000 and sold here at 8000: the same ROI; the stock decides how much is carried
    const from = (stock2: number, stock3: number) => marketOf([
      { terminalId: HERE, commodityId: GOLD, sell: 8000 },
      { terminalId: 2, commodityId: GOLD, buy: 6000, scuBuy: stock2 },
      { terminalId: 3, commodityId: GOLD, buy: 6000, scuBuy: stock3 },
    ]);

    it('with the same ROI the trip that earns more wins: the one that has more to carry, though its terminal has the higher id', () => {
      const market = from(20, 50);
      expect(routesTo(market, HERE, ctx, GOLD).options).toHaveLength(1); // topN 1: the search keeps one, the row must not depend on which
      expect(rowRoiMap(market, HERE, 'sell', ctx).get(GOLD)).toMatchObject({ otherId: 3, buyPrice: 6000 });
      expect(rowRoiMap(from(50, 20), HERE, 'sell', ctx).get(GOLD)).toMatchObject({ otherId: 2 });
    });

    it('with the same ROI and the same profit the lower terminal id wins, every time', () => {
      const market = from(50, 50);
      const one = rowRoiMap(market, HERE, 'sell', ctx).get(GOLD);
      expect(one).toMatchObject({ otherId: 2 });
      expect(rowRoiMap(market, HERE, 'sell', withSettings({ sort: 'roi' })).get(GOLD)).toEqual(one);
    });

    it('buy here: two buyers that pay the same: the lower terminal id wins', () => {
      const market = marketOf([
        { terminalId: HERE, commodityId: GOLD, buy: 6000, scuBuy: 500 },
        { terminalId: 2, commodityId: GOLD, sell: 7500 },
        { terminalId: 3, commodityId: GOLD, sell: 7500 },
      ]);
      expect(rowRoiMap(market, HERE, 'buy', ctx).get(GOLD)).toMatchObject({ otherId: 2, sellPrice: 7500 });
    });
  });
});

describe('isHot: a row stands out from the threshold', () => {
  it('is at or above the threshold', () => {
    expect(isHot(0.5, 50)).toBe(true);
    expect(isHot(0.51, 50)).toBe(true);
    expect(isHot(0.49, 50)).toBe(false);
  });

  it('is judged by the number that is shown: 49,6 % reads 50 %', () => {
    expect(isHot(0.4996, 50)).toBe(true);
    expect(isHot(0.4949, 50)).toBe(false);
  });

  it('with the threshold at zero every row that pays stands out', () => {
    expect(isHot(0.001, 0)).toBe(true);
    expect(isHot(0, 0)).toBe(true);
    expect(isHot(-0.04, 0)).toBe(false);
  });

  it('a value that is not a number never stands out', () => {
    expect(isHot(NaN, 0)).toBe(false);
    expect(isHot(Infinity, 50)).toBe(false);
    expect(isHot(0.9, NaN)).toBe(false);
  });
});

const best = (over: Partial<RowRoi> = {}): RowRoi => ({
  commodityId: GOLD, roi: 0.62, otherId: 3, buyPrice: 1995, sellPrice: 2760, profit: 532_440, qty: 696, profitOtherId: 3, ...over,
});

describe('roiCell: how a row says it', () => {
  it('is the number as the options list writes it, in the tier of that number', () => {
    expect(roiCell(best({ roi: 0.62 }), 'sell', ref, 50)).toMatchObject({ text: '62%', tier: 'great' });
    expect(roiCell(best({ roi: 0.22 }), 'sell', ref, 50)).toMatchObject({ text: '22%', tier: 'good' });
    expect(roiCell(best({ roi: 0.09 }), 'sell', ref, 50)).toMatchObject({ text: '9%', tier: 'ok' });
    expect(roiCell(best({ roi: 0.025 }), 'sell', ref, 50)).toMatchObject({ text: '2,5%', tier: 'poor' });
  });

  it('carries the number that is shown, in whole percents, for the order of the rows: what the eye sorts by', () => {
    expect(roiCell(best({ roi: 0.62 }), 'sell', ref, 50).percent).toBe(62);
    expect(roiCell(best({ roi: 0.2996 }), 'sell', ref, 50).percent).toBe(30);
    expect(roiCell(best({ roi: 0.025 }), 'sell', ref, 50).percent).toBe(2.5);
    expect(roiCell(best({ roi: 16.99 }), 'sell', ref, 50).percent).toBe(1699); // written 999+, ordered by its real number
    expect(roiCell(best({ roi: Number.NaN }), 'sell', ref, 50).percent).toBeNull();
  });

  it('the colour follows the number that is shown: 29,96 % reads 30 % and is great', () => {
    expect(roiCell(best({ roi: 0.2996 }), 'sell', ref, 50)).toMatchObject({ text: '30%', tier: 'great' });
    expect(roiTier(0.2996)).toBe('good');
  });

  it('stands out from the threshold, and not below it', () => {
    expect(roiCell(best({ roi: 0.5 }), 'sell', ref, 50).hot).toBe(true);
    expect(roiCell(best({ roi: 0.49 }), 'sell', ref, 50).hot).toBe(false);
    expect(roiCell(best({ roi: 0.35 }), 'sell', ref, 30).hot).toBe(true);
  });

  it('says where the best trip comes from on the side that is sold here, and the two prices', () => {
    // terminal 3 is CRU-L1
    expect(roiCell(best(), 'sell', ref, 50).title).toContain(nb('из CRU-L1 · 1 995 → 2 760'));
  });

  it('says where the best trip goes on the side that is bought here', () => {
    expect(roiCell(best(), 'buy', ref, 50).title).toContain(nb('в CRU-L1 · 1 995 → 2 760'));
  });

  it('a terminal that is not in the reference is named by its number', () => {
    expect(roiCell(best({ otherId: 777 }), 'sell', ref, 50).title).toContain('из #777');
  });

  it('tells that a click opens the options', () => {
    expect(roiCell(best(), 'sell', ref, 50).title).toMatch(/варианты/i);
  });

  it('a ROI of thousands of percent (a typo in a price) is written 999+: a number must fit its narrow column whole', () => {
    expect(roiCell(best({ roi: 9.99 }), 'sell', ref, 50).text).toBe('999%');
    expect(roiCell(best({ roi: 9.996 }), 'sell', ref, 50)).toMatchObject({ text: '999+', tier: 'great', hot: true });
    expect(roiCell(best({ roi: 16990 }), 'sell', ref, 50).text).toBe('999+');
  });

  it('says the real number of a ROI that is written 999+, in the tooltip', () => {
    expect(roiCell(best({ roi: 16.99 }), 'sell', ref, 50).title).toContain('ROI 1699%');
    expect(roiCell(best({ roi: 0.62 }), 'sell', ref, 50).title).not.toContain('ROI ');
  });
});

describe('roiCells', () => {
  it('maps every commodity of the map to its cell', () => {
    const map = new Map([[GOLD, best()], [TITA, best({ commodityId: TITA, roi: 0.1 })]]);
    const cells = roiCells(map, 'buy', ref, 50);
    expect([...cells.keys()]).toEqual([GOLD, TITA]);
    expect(cells.get(GOLD)?.hot).toBe(true);
    expect(cells.get(TITA)).toMatchObject({ text: '10%', tier: 'ok', hot: false });
  });
});

const snap = (roi: Array<[number, number]>, over: Partial<RoiSnapshot> = {}): RoiSnapshot => ({
  terminalId: HERE, side: 'sell', roi: new Map(roi.map(([id, value]) => [id, { roi: value }])), ...over,
});

describe('crossedRows: which rows cross the threshold after a price was entered', () => {
  it('a row that was below the threshold and is above it now crosses it', () => {
    expect(crossedRows(snap([[GOLD, 0.3]]), snap([[GOLD, 0.6]]), 50)).toEqual([GOLD]);
  });

  it('a row that had no value and has one above the threshold now crosses it', () => {
    expect(crossedRows(snap([]), snap([[GOLD, 0.6]]), 50)).toEqual([GOLD]);
    expect(crossedRows(snap([[TITA, 0.1]]), snap([[TITA, 0.1], [GOLD, 0.6]]), 50)).toEqual([GOLD]);
  });

  it('a row that was above the threshold already does not cross it again', () => {
    expect(crossedRows(snap([[GOLD, 0.55]]), snap([[GOLD, 0.9]]), 50)).toEqual([]);
    expect(crossedRows(snap([[GOLD, 0.5]]), snap([[GOLD, 0.5]]), 50)).toEqual([]);
  });

  it('a row that falls below the threshold does not cross it', () => {
    expect(crossedRows(snap([[GOLD, 0.8]]), snap([[GOLD, 0.2]]), 50)).toEqual([]);
    expect(crossedRows(snap([[GOLD, 0.8]]), snap([]), 50)).toEqual([]);
  });

  it('a row that is still below the threshold does not cross it', () => {
    expect(crossedRows(snap([[GOLD, 0.1]]), snap([[GOLD, 0.4]]), 50)).toEqual([]);
  });

  it('only the rows that cross are named', () => {
    const before = snap([[GOLD, 0.2], [TITA, 0.7], [TUNG, 0.1]]);
    const after = snap([[GOLD, 0.8], [TITA, 0.9], [TUNG, 0.2]]);
    expect(crossedRows(before, after, 50)).toEqual([GOLD]);
  });

  it('another terminal is a table that was opened, not a price that was entered: nothing flashes', () => {
    expect(crossedRows(snap([[GOLD, 0.1]], { terminalId: 6 }), snap([[GOLD, 0.9]]), 50)).toEqual([]);
    expect(crossedRows(snap([], { terminalId: null }), snap([[GOLD, 0.9]]), 50)).toEqual([]);
  });

  it('another side is a table that was switched, not a price that was entered: nothing flashes', () => {
    expect(crossedRows(snap([[GOLD, 0.1]], { side: 'buy' }), snap([[GOLD, 0.9]]), 50)).toEqual([]);
  });

  it('with nothing before there is nothing to compare: nothing flashes', () => {
    expect(crossedRows(null, snap([[GOLD, 0.9]]), 50)).toEqual([]);
  });

  it('a table of no terminal flashes nothing', () => {
    expect(crossedRows(snap([], { terminalId: null }), snap([[GOLD, 0.9]], { terminalId: null }), 50)).toEqual([]);
  });

  it('the threshold is the one given: from zero every row that gets a value crosses it', () => {
    expect(crossedRows(snap([]), snap([[GOLD, 0.02]]), 0)).toEqual([GOLD]);
    expect(crossedRows(snap([[GOLD, 0.02]]), snap([[GOLD, 0.8]]), 0)).toEqual([]);
  });

  it('is judged by the number that is shown, as the bar is', () => {
    expect(crossedRows(snap([[GOLD, 0.4949]]), snap([[GOLD, 0.4996]]), 50)).toEqual([GOLD]);
  });
});

describe('profitMark: the bar of a row while the table is not read by the ROI', () => {
  it('marks the rows that bring the most: three quarters of the best and more, then half of it and more', () => {
    expect(profitMark(438_000, 438_000)).toBe('great');
    expect(profitMark(383_000, 438_000)).toBe('great');          // 87 %
    expect(profitMark(328_500, 438_000)).toBe('great');          // exactly three quarters
    expect(profitMark(250_000, 438_000)).toBe('good');
    expect(profitMark(219_000, 438_000)).toBe('good');           // exactly half
    expect(profitMark(100_000, 438_000)).toBeNull();
  });

  it('marks nothing that brings nothing, and nothing in a table where nothing brings anything', () => {
    expect(profitMark(0, 438_000)).toBeNull();
    expect(profitMark(-5_000, 438_000)).toBeNull();
    expect(profitMark(0, 0)).toBeNull();
    expect(profitMark(10, 0)).toBeNull();
    expect(profitMark(Number.NaN, 100)).toBeNull();
  });
});
