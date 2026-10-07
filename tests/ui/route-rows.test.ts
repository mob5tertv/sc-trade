import { describe, expect, it } from 'vitest';
import { formatDistance, formatRoi, routeOptionRow, sellAlternativeRow, sellHereRow } from '../../src/ui/vm/route-rows';
import type { RouteOption } from '../../src/core/routes';
import type { SellAlternative, SellHere } from '../../src/core/sell';
import type { Estimate } from '../../src/core/types';
import { pairKey } from '../../src/core/types';
import { ref, term } from '../helpers/factories';
import type { UexRange } from '../../src/ui/vm/terminal-rows';

// formatUec separates thousands with a non-breaking space
const nb = (s: string) => s.replace(/ /g, String.fromCharCode(0xa0));

/** What the «Мин–макс» cell holds: a spread, one price UEX knows, nothing (see `rangeView` of terminal-rows). */
const SPREAD = { kind: 'spread', text: `${nb('6 400')}–${nb('7 100')}`, title: 'Диапазон цен по данным UEX' } as const;
const ONE_PRICE = (price: string) => ({ kind: 'flat', text: `= ${nb(price)}`, title: 'UEX: одна цена за период, разброса нет' }) as const;
const NO_PRICE = { kind: 'none', text: '—', title: 'UEX не знает цену' } as const;

const estimate = (partial: Partial<Estimate> = {}): Estimate => ({
  price: 6900, low: 6400, high: 7100, source: 'uex', temp: null, ageSec: 2 * 86_400, ageKnown: true,
  ownLast: null, uexRange: null, scu: null, scuOrigin: null, stock: null, prev: null, ...partial,
});

// Gold from ARC-L1 (1), bought at my own hot 6120, sold at TDD Area 18 (2) for the UEX 6900 (6400–7100)
const option = (partial: Partial<RouteOption> = {}): RouteOption => ({
  commodityId: 10, originId: 1, destId: 2,
  buy: estimate({ price: 6120, low: 6120, high: 6120, source: 'own', temp: 'hot', ageSec: 40 * 60 }),
  sell: estimate(),
  qty: 96, profit: 74_880, roi: 0.1275, worstProfit: 27_840,
  distanceGm: 59, emptyLegSec: 0, timeSec: 1055, timeSource: 'estimate', uecPerHour: 255_545,
  ...partial,
});

describe('formatDistance', () => {
  it('keeps one decimal from one gigametre up and two below', () => {
    expect(formatDistance(59)).toBe('59 Гм');
    expect(formatDistance(59.44)).toBe('59,4 Гм');
    expect(formatDistance(0.123)).toBe('0,12 Гм');
    expect(formatDistance(0)).toBe('0 Гм');
  });
  it('shows a dash for an unknown distance', () => {
    expect(formatDistance(null)).toBe('—');
  });
});

describe('formatRoi', () => {
  it('rounds to whole percents', () => {
    expect([0.42, 0.22, 0.1275, 0.5, 1.234].map(formatRoi)).toEqual(['42%', '22%', '13%', '50%', '123%']);
    expect(formatRoi(-0.04)).toBe('-4%');
  });

  it('keeps one decimal only below 10% and only when the decimal is not zero', () => {
    expect(formatRoi(0.025)).toBe('2,5%');
    expect(formatRoi(0.0951)).toBe('9,5%');
    expect(formatRoi(-0.025)).toBe('-2,5%');
    expect(formatRoi(0.09)).toBe('9%');
    expect(formatRoi(0.0904)).toBe('9%'); // the decimal rounds to zero
    expect(formatRoi(0.0996)).toBe('10%'); // rounds up to ten: whole from there on
    expect(formatRoi(0.1)).toBe('10%');
    expect(formatRoi(0.105)).toBe('11%');
  });

  it('writes zero as 0%, never as a negative zero', () => {
    expect(formatRoi(0)).toBe('0%');
    expect(formatRoi(-0.0003)).toBe('0%');
  });

  it('uses the comma of Russian numbers', () => {
    expect(formatRoi(0.031)).toBe('3,1%');
  });

  it('shows a dash for what is not a number', () => {
    expect(formatRoi(Number.NaN)).toBe('—');
    expect(formatRoi(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatRoi(Number.NEGATIVE_INFINITY)).toBe('—');
  });
});

describe('routeOptionRow', () => {
  it('names the destination and shows its sale price when the trips start here', () => {
    expect(routeOptionRow(option(), ref, 'from', new Map())).toEqual({
      key: '1>2:10', terminal: 'TDD Area 18', commodity: 'GOLD',
      distance: '59 Гм', time: '17:35', timeTitle: 'оценка по расстоянию',
      runs: 0,
      price: { price: nb('6 900'), range: SPREAD, badge: { text: 'UEX · 2 д', kind: 'uex' } },
      roi: '13%', rate: '256k', worst: nb('27 840'), worstLoss: false, qty: '96 SCU',
      origin: 'ARC-L1', dest: 'TDD Area 18', bothEnds: true, isTarget: false, tier: 'ok',
      invested: nb('587 520'), profit: nb('74 880'), profitLoss: false, trend: null, priceIsOwn: false,
      buy: { price: nb('6 120'), range: NO_PRICE, badge: { text: 'моя · 40 мин', kind: 'hot' } },
      sell: { price: nb('6 900'), range: SPREAD, badge: { text: 'UEX · 2 д', kind: 'uex' } },
    });
  });

  it('names the origin and shows its purchase price when the trips end here', () => {
    const row = routeOptionRow(option(), ref, 'to', new Map());
    expect(row.terminal).toBe('ARC-L1');
    // my own price has no range, and its badge carries the temperature
    expect(row.price).toEqual({ price: nb('6 120'), range: NO_PRICE, badge: { text: 'моя · 40 мин', kind: 'hot' } });
  });

  describe('the trend of the price in the «Цена» column', () => {
    const own = (partial: Partial<Estimate>) => estimate({ source: 'own', temp: 'hot', ageSec: 40 * 60, low: 0, high: 0, ...partial });
    // bought at 6120 (it was 6200 two hours ago: a fall), sold at 6900 (it was 6800 two hours ago: a rise)
    const moving = option({
      buy: own({ price: 6120, prev: { price: 6200, ageSec: 7200 } }),
      sell: own({ price: 6900, prev: { price: 6800, ageSec: 7200 } }),
    });

    it('takes the sale price at the destination for trips from here: a rise where I sell is good', () => {
      expect(routeOptionRow(moving, ref, 'from', new Map()).trend).toEqual({
        dir: 'up', good: true, title: `было ${nb('6 800')} · 2 ч назад (+100)`,
      });
    });

    it('takes the purchase price at the origin for trips to here: a fall where I buy is good', () => {
      expect(routeOptionRow(moving, ref, 'to', new Map()).trend).toEqual({
        dir: 'down', good: true, title: `было ${nb('6 200')} · 2 ч назад (-80)`,
      });
    });

    it('judges the same movement by the side of the price shown', () => {
      const worse = option({
        buy: own({ price: 6300, prev: { price: 6200, ageSec: 7200 } }),   // bought dearer: bad
        sell: own({ price: 6700, prev: { price: 6800, ageSec: 7200 } }),  // sold cheaper: bad
      });
      expect(routeOptionRow(worse, ref, 'from', new Map()).trend).toMatchObject({ dir: 'down', good: false });
      expect(routeOptionRow(worse, ref, 'to', new Map()).trend).toMatchObject({ dir: 'up', good: false });
    });

    it('has no trend when the shown price is a UEX one or has not moved, whatever the other end did', () => {
      const uexSell = option({ buy: moving.buy, sell: estimate({ price: 6900 }) });
      expect(routeOptionRow(uexSell, ref, 'from', new Map()).trend).toBeNull();
      expect(routeOptionRow(uexSell, ref, 'to', new Map()).trend).toMatchObject({ dir: 'down' });
      const still = option({ buy: moving.buy, sell: own({ price: 6900, prev: { price: 6900, ageSec: 7200 } }) });
      expect(routeOptionRow(still, ref, 'from', new Map()).trend).toBeNull();
      expect(routeOptionRow(option(), ref, 'to', new Map()).trend).toBeNull(); // my own price, no previous reading
    });
  });

  describe('whose price stands in the «Цена» column: mine is normal text, UEX and cold are muted', () => {
    const own = (partial: Partial<Estimate> = {}) => estimate({ source: 'own', temp: 'hot', ...partial });

    it('is mine while it is hot, warm or cooling', () => {
      for (const temp of ['hot', 'warm', 'cooling'] as const) {
        expect(routeOptionRow(option({ sell: own({ temp }) }), ref, 'from', new Map()).priceIsOwn, temp).toBe(true);
        expect(routeOptionRow(option({ buy: own({ temp }) }), ref, 'to', new Map()).priceIsOwn, temp).toBe(true);
      }
    });

    it('is not mine for a UEX price, and not for my cold price kept only because UEX has no row', () => {
      expect(routeOptionRow(option(), ref, 'from', new Map()).priceIsOwn).toBe(false); // the sale price is UEX
      expect(routeOptionRow(option({ sell: own({ temp: 'cold' }) }), ref, 'from', new Map()).priceIsOwn).toBe(false);
      expect(routeOptionRow(option({ buy: own({ temp: 'cold' }) }), ref, 'to', new Map()).priceIsOwn).toBe(false);
    });

    it('looks at the price of the column: the sale price for trips from here, the purchase price for trips to here', () => {
      const mixed = option(); // bought at my own hot price, sold at the UEX one
      expect(routeOptionRow(mixed, ref, 'from', new Map()).priceIsOwn).toBe(false);
      expect(routeOptionRow(mixed, ref, 'to', new Map()).priceIsOwn).toBe(true);
    });
  });

  it('labels a UEX price of unknown age with a plain UEX badge, without an age', () => {
    const unknownAge = estimate({ ageKnown: false, ageSec: 1_760_000_000 });
    expect(routeOptionRow(option({ sell: unknownAge }), ref, 'from', new Map()).price.badge).toEqual({ text: 'UEX', kind: 'uex' });
    expect(routeOptionRow(option({ buy: unknownAge }), ref, 'to', new Map()).price.badge).toEqual({ text: 'UEX', kind: 'uex' });
  });

  it('counts my own runs of exactly this pair, in this direction', () => {
    const runs = new Map([[pairKey(1, 2), 3], [pairKey(2, 1), 9]]);
    expect(routeOptionRow(option(), ref, 'from', runs).runs).toBe(3);
    expect(routeOptionRow(option({ destId: 3 }), ref, 'from', runs).runs).toBe(0);
  });

  it('shows dashes for what is not known', () => {
    const row = routeOptionRow(option({ distanceGm: null, timeSec: null, timeSource: null, uecPerHour: null }), ref, 'from', new Map());
    expect(row).toMatchObject({ distance: '—', time: '—', timeTitle: null, rate: '—' });
  });

  it('says where the time comes from, and mentions an empty flight', () => {
    expect(routeOptionRow(option({ timeSource: 'own' }), ref, 'from', new Map()).timeTitle).toBe('по твоим рейсам');
    expect(routeOptionRow(option({ emptyLegSec: 250 }), ref, 'from', new Map()).timeTitle).toBe('оценка по расстоянию · пустой перелёт 4:10');
  });

  it('flags a worst case that loses money', () => {
    const row = routeOptionRow(option({ worstProfit: -5000 }), ref, 'from', new Map());
    expect(row).toMatchObject({ worst: nb('-5 000'), worstLoss: true });
  });

  it('falls back to the longer names and then the id for terminals the reference does not know well', () => {
    const named = { ...ref, terminals: new Map([[2, term(2, { displayname: 'Area 18 Trade' })], [3, term(3, { name: 'Long name' })]]) };
    expect(routeOptionRow(option(), named, 'from', new Map()).terminal).toBe('Area 18 Trade');
    expect(routeOptionRow(option({ destId: 3 }), named, 'from', new Map()).terminal).toBe('Long name');
    expect(routeOptionRow(option({ destId: 777 }), ref, 'from', new Map()).terminal).toBe('#777');
    expect(routeOptionRow(option({ commodityId: 999 }), ref, 'from', new Map()).commodity).toBe('#999');
  });
});

describe('routeOptionRow: the UEX range next to my own price', () => {
  // my own hot purchase price at the origin (ARC-L1) has no range of its own; UEX knows 5 900–6 200 for that place
  const uexRange = (terminalId: number, commodityId: number, side: string): UexRange =>
    terminalId === 1 && commodityId === 10 && side === 'buy' ? { kind: 'spread', low: 5900, high: 6200 } : { kind: 'none' };

  it('shows the range UEX knows for the place beside my own price, and marks the price as mine', () => {
    const row = routeOptionRow(option(), ref, 'to', new Map(), { uexRange });
    const range = { kind: 'spread', text: `${nb('5 900')}–${nb('6 200')}`, title: 'Диапазон цен по данным UEX' };
    expect(row.price).toEqual({ price: nb('6 120'), range, badge: { text: 'моя · 40 мин', kind: 'hot' } });
    expect(row.buy.range).toEqual(range);
  });

  it('asks UEX for the right place, commodity and side, and only for a price that is mine', () => {
    const asked: unknown[] = [];
    routeOptionRow(option(), ref, 'from', new Map(), { uexRange: (t, c, s) => { asked.push([t, c, s]); return { kind: 'none' }; } });
    expect(asked).toContainEqual([1, 10, 'buy']); // the purchase of the trip: my own price at the origin
    expect(asked).not.toContainEqual([2, 10, 'sell']); // the sale price is UEX's own and carries its range already
  });

  it('leaves a UEX price with its own range and shows nothing for a place UEX knows no range for', () => {
    expect(routeOptionRow(option(), ref, 'from', new Map(), { uexRange }).price.range).toEqual(SPREAD);
    expect(routeOptionRow(option(), ref, 'to', new Map(), { uexRange: () => ({ kind: 'none' }) }).price.range).toEqual(NO_PRICE);
    expect(routeOptionRow(option(), ref, 'to', new Map()).price.range).toEqual(NO_PRICE); // no lookup given: as before
  });
});

describe('routeOptionRow: one price instead of a dash', () => {
  // UEX gave min = max = price: a flat UEX price (low === high) and a flat price of UEX beside my own
  const flat = (price: number) => estimate({ price, low: price, high: price });

  it('writes a flat UEX price as "= price" in the «Мин–макс» cell, in both modes', () => {
    expect(routeOptionRow(option({ sell: flat(5500) }), ref, 'from', new Map()).price.range).toEqual(ONE_PRICE('5 500'));
    expect(routeOptionRow(option({ buy: flat(5500) }), ref, 'to', new Map()).price.range).toEqual(ONE_PRICE('5 500'));
  });

  it('writes the same in the expanded details, for the purchase and for the sale', () => {
    const row = routeOptionRow(option({ buy: flat(5400), sell: flat(5500) }), ref, 'from', new Map());
    expect(row.buy.range).toEqual(ONE_PRICE('5 400'));
    expect(row.sell.range).toEqual(ONE_PRICE('5 500'));
  });

  it('keeps a seven-digit price whole', () => {
    expect(routeOptionRow(option({ sell: flat(1_300_000) }), ref, 'from', new Map()).price.range.text).toBe(`= ${nb('1 300 000')}`);
  });

  it('writes the one price UEX knows for the place beside my own price, as a reference', () => {
    const row = routeOptionRow(option(), ref, 'to', new Map(), { uexRange: () => ({ kind: 'flat', price: 5500 }) });
    expect(row.price).toEqual({ price: nb('6 120'), range: ONE_PRICE('5 500'), badge: { text: 'моя · 40 мин', kind: 'hot' } });
  });

  it('still tells a dash from one price: a UEX price with no bounds is no flat price', () => {
    const noBounds = estimate({ price: 6900, low: 0, high: 0 });
    expect(routeOptionRow(option({ sell: noBounds }), ref, 'from', new Map()).price.range).toEqual(NO_PRICE);
  });

  it('shows the alternatives of «продать или лететь дальше» the same way', () => {
    expect(sellAlternativeRow(alternative({ sell: flat(5500) }), ref).price.range).toEqual(ONE_PRICE('5 500'));
  });
});

describe('routeOptionRow: both ends and the target', () => {
  it('names both ends of the trip in trip order, whatever the mode', () => {
    for (const mode of ['from', 'to'] as const) {
      expect(routeOptionRow(option(), ref, mode, new Map())).toMatchObject({ origin: 'ARC-L1', dest: 'TDD Area 18' });
    }
  });

  it('asks for both ends when the purchase terminal is not the viewed one (trips from here)', () => {
    const row = (anchorTerminalId: number | null | undefined) => routeOptionRow(option(), ref, 'from', new Map(), { anchorTerminalId }).bothEnds;
    expect(row(1)).toBe(false); // bought right here
    expect(row(5)).toBe(true); // "и рядом": bought at another terminal of the planet
    // nothing to compare with: the trip is shown with both ends, never without its purchase point
    expect(row(null)).toBe(true);
    expect(row(undefined)).toBe(true);
  });

  it('asks for both ends when the sale terminal is not the viewed one (trips to here)', () => {
    const row = (anchorTerminalId: number | null) => routeOptionRow(option(), ref, 'to', new Map(), { anchorTerminalId }).bothEnds;
    expect(row(2)).toBe(false); // sold right here
    expect(row(9)).toBe(true);
    expect(row(null)).toBe(true);
  });

  it('marks the option whose other end is the target the "Цель" button would set', () => {
    const target = (mode: 'from' | 'to', targetTerminalId: number | null | undefined) =>
      routeOptionRow(option(), ref, mode, new Map(), { targetTerminalId }).isTarget;
    expect(target('from', 2)).toBe(true); // the destination is the target of a trip from here
    expect(target('from', 1)).toBe(false); // the origin is not
    expect(target('to', 1)).toBe(true); // the origin is the target of a trip to here
    expect(target('to', 2)).toBe(false);
    expect(target('from', null)).toBe(false);
    expect(target('from', undefined)).toBe(false);
  });

  it('puts the row into the ROI tier of its option', () => {
    const tier = (roi: number) => routeOptionRow(option({ roi }), ref, 'from', new Map()).tier;
    expect([0.6, 0.2, 0.1, 0.01, -0.02].map(tier)).toEqual(['great', 'good', 'ok', 'poor', 'loss']);
  });

  it('colours the ROI by the number that is shown, not by the one that was rounded away', () => {
    const shown = (roi: number) => {
      const row = routeOptionRow(option({ roi }), ref, 'from', new Map());
      return [row.roi, row.tier];
    };
    expect(shown(0.2996)).toEqual(['30%', 'great']); // 29,96% reads 30%: the colour of 30%
    expect(shown(0.296)).toEqual(['30%', 'great']);
    expect(shown(0.2949)).toEqual(['29%', 'good']);
    expect(shown(0.1496)).toEqual(['15%', 'good']);
    expect(shown(0.0496)).toEqual(['5%', 'ok']);
    expect(shown(0.0449)).toEqual(['4,5%', 'poor']);
    expect(shown(-0.0003)).toEqual(['0%', 'poor']); // -0,03% reads 0%: not the colour of a loss
    expect(shown(-0.0004)).toEqual(['0%', 'poor']);
    expect(shown(-0.0051)).toEqual(['-0,5%', 'loss']);
  });

  it('shows a dash, in the quiet tier, for a ROI that is not a number', () => {
    for (const roi of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(routeOptionRow(option({ roi }), ref, 'from', new Map())).toMatchObject({ roi: '—', tier: 'poor' });
    }
  });

  it('adds up the money of the whole trip for the expanded row', () => {
    const row = routeOptionRow(option({ qty: 10, profit: -300 }), ref, 'from', new Map());
    expect(row).toMatchObject({ invested: nb('61 200'), profit: nb('-300'), profitLoss: true });
    expect(row.buy.badge).toEqual({ text: 'моя · 40 мин', kind: 'hot' });
    expect(row.sell.price).toBe(nb('6 900'));
  });
});

const here: SellHere = { qty: 96, profit: 74_880, roi: 0.1275, uecPerHour: 310_000 };

const alternative = (partial: Partial<SellAlternative> = {}): SellAlternative => ({
  destId: 2, sell: estimate(), qty: 96, expectedProfit: 69_120,
  extraSec: 1055, expectedUecPerHour: 264_000, worstUecPerHour: 120_000, ...partial,
});

describe('sellHereRow', () => {
  it('formats the sale on the spot', () => {
    expect(sellHereRow(here)).toEqual({ qty: '96 SCU', profit: nb('74 880'), loss: false, roi: '12,8%', rate: '310k/ч' });
  });
  it('shows a dash without a rate and marks a loss', () => {
    expect(sellHereRow({ ...here, profit: -1200, roi: -0.01, uecPerHour: null })).toMatchObject({ profit: nb('-1 200'), loss: true, rate: '—' });
  });
});

describe('sellAlternativeRow', () => {
  it('formats an alternative with its price, rates and extra flight', () => {
    expect(sellAlternativeRow(alternative(), ref)).toEqual({
      key: '2', terminal: 'TDD Area 18',
      price: { price: nb('6 900'), range: SPREAD, badge: { text: 'UEX · 2 д', kind: 'uex' } },
      profit: nb('69 120'), loss: false, expectedRate: '264k/ч', worstRate: '120k/ч', extra: '17:35',
    });
  });
  it('labels an alternative priced by UEX at an unknown age with a plain UEX badge', () => {
    const row = sellAlternativeRow(alternative({ sell: estimate({ ageKnown: false, ageSec: 1_760_000_000 }) }), ref);
    expect(row.price.badge).toEqual({ text: 'UEX', kind: 'uex' });
  });
  it('shows dashes when no flight time is known, and marks a loss', () => {
    const row = sellAlternativeRow(alternative({ extraSec: null, expectedUecPerHour: null, worstUecPerHour: null, expectedProfit: -300 }), ref);
    expect(row).toMatchObject({ extra: '—', expectedRate: '—', worstRate: '—', loss: true });
  });
  it('falls back to the id for an unknown terminal', () => {
    expect(sellAlternativeRow(alternative({ destId: 777 }), ref).terminal).toBe('#777');
  });
});
