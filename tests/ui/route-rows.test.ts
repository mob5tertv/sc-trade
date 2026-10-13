import { describe, expect, it } from 'vitest';
import { formatCompact } from '../../src/core/format';
import {
  UNKNOWN_STOCK_NOTE, formatDistance, formatRoi, paceLine, perHourBare, perHourNarrow, routeOptionRow, sellAlternativeRow, sellHereRow,
} from '../../src/ui/vm/route-rows';
import type { RouteOption } from '../../src/core/routes';
import type { SellAlternative, SellHere } from '../../src/core/sell';
import type { Estimate, Terminal } from '../../src/core/types';
import { pairKey } from '../../src/core/types';
import { ref, term } from '../helpers/factories';
import type { UexRange } from '../../src/ui/vm/terminal-rows';

// formatUec separates thousands with a non-breaking space
const nb = (s: string) => s.replace(/ /g, String.fromCharCode(0xa0));

/** What the «Мин–макс» cell holds: a spread, one price UEX knows, nothing (see `rangeView` of terminal-rows). */
const SPREAD = { kind: 'spread', text: `${nb('6 400')}–${nb('7 100')}`, title: 'Диапазон цен по данным UEX' } as const;
const ONE_PRICE = (price: string) => ({ kind: 'flat', text: `= ${nb(price)}`, title: 'UEX: одна цена за период, разброса нет' }) as const;
const NO_PRICE = { kind: 'none', text: '—', title: 'UEX не знает цену' } as const;
const NO_BOUNDS = { kind: 'no-bounds', text: '—', title: 'UEX не даёт границ цены' } as const;

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

describe('perHourNarrow: the rate in the 34 px column of the list of options', () => {
  it('is the compact rate as it is below 10M: two decimals, the dash for no rate', () => {
    expect(perHourNarrow(null)).toBe('—');
    expect(perHourNarrow(0)).toBe('0');
    expect(perHourNarrow(255_545)).toBe('256k');
    expect(perHourNarrow(2_010_000)).toBe('2,01M');
    expect(perHourNarrow(9_270_000)).toBe('9,27M');
    expect(perHourNarrow(7_690_000)).toBe('7,69M');
    expect(perHourNarrow(4_970_000)).toBe('4,97M');
  });

  it('is below 10M the very text of the shared compact format, up to the last number before 10M', () => {
    for (const n of [999_999, 1_000_000, 5_555_555, 9_994_999]) expect(perHourNarrow(n), String(n)).toBe(formatCompact(n));
    expect(perHourNarrow(9_994_999)).toBe('9,99M');
  });

  it('rounds up to 10M the numbers that the two-decimal form rounds up to it', () => {
    expect(perHourNarrow(9_995_000)).toBe('10M');
    expect(perHourNarrow(9_999_999)).toBe('10M');
    expect(perHourNarrow(10_000_000)).toBe('10M');
  });

  it('has one decimal from 10M, so that it is five characters and not six', () => {
    expect(perHourNarrow(10_049_999)).toBe('10M');
    expect(perHourNarrow(10_050_000)).toBe('10,1M');
    expect(perHourNarrow(12_530_000)).toBe('12,5M');
    expect(perHourNarrow(12_549_999)).toBe('12,5M');
    expect(perHourNarrow(12_550_000)).toBe('12,6M');
    expect(perHourNarrow(99_949_999)).toBe('99,9M');
  });

  it('is whole millions from 100M, which the one decimal would make six characters again', () => {
    expect(perHourNarrow(99_950_000)).toBe('100M');
    expect(perHourNarrow(100_000_000)).toBe('100M');
    expect(perHourNarrow(123_456_789)).toBe('123M');
    expect(perHourNarrow(1_234_567_890)).toBe('1235M');
  });

  it('keeps the minus and the same rules for a loss: -12,5M is as wide as the -1,25M of today (33,5 px of 34)', () => {
    expect(perHourNarrow(-95_200)).toBe('-95k');
    expect(perHourNarrow(-1_250_000)).toBe('-1,25M');
    expect(perHourNarrow(-9_994_999)).toBe('-9,99M');
    expect(perHourNarrow(-12_530_000)).toBe('-12,5M');
    expect(perHourNarrow(-99_950_000)).toBe('-100M');
    expect(perHourNarrow(-123_456_789)).toBe('-123M');
  });

  it('is only for the list of options: the shared forms of the other lists keep their two decimals', () => {
    expect(perHourBare(12_530_000)).toBe('12,53M');
    expect(formatCompact(12_530_000)).toBe('12,53M');
  });

  it('is what the row of an option shows as its rate', () => {
    expect(routeOptionRow(option({ uecPerHour: 12_530_000 }), ref, 'from', new Map()).rate).toBe('12,5M');
    expect(routeOptionRow(option({ uecPerHour: 2_010_000 }), ref, 'to', new Map()).rate).toBe('2,01M');
    expect(routeOptionRow(option({ uecPerHour: null }), ref, 'from', new Map()).rate).toBe('—');
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
      origin: 'ARC-L1', dest: 'TDD Area 18', bothEnds: true, isTarget: false, emptyLeg: null, boxes: null, loadBar: null, tier: 'ok',
      whereTitle: 'ARC-L1 → TDD Area 18\nARC-L1: Stanton\nTDD Area 18: Stanton',
      invested: nb('587 520'), profit: nb('74 880'), profitLoss: false, trend: null, priceIsOwn: false,
      buy: { price: nb('6 120'), range: NO_PRICE, badge: { text: 'моя · 40 мин', kind: 'hot' } },
      sell: { price: nb('6 900'), range: SPREAD, badge: { text: 'UEX · 2 д', kind: 'uex' } },
      stockNote: UNKNOWN_STOCK_NOTE, stockLimit: null,
    });
  });

  describe('the stock the volume rests on', () => {
    const known = (scu: number | null) => estimate({ price: 6120, low: 6120, high: 6120, source: 'own', temp: 'hot', scu, scuOrigin: scu === null ? null : 'own' });

    it('says so when the stock at the purchase terminal is unknown: nothing but the hold and the budget limited the volume', () => {
      expect(routeOptionRow(option({ buy: known(null) }), ref, 'from', new Map()).stockNote).toBe(UNKNOWN_STOCK_NOTE);
      expect(routeOptionRow(option({ buy: known(null) }), ref, 'to', new Map()).stockNote).toBe(UNKNOWN_STOCK_NOTE);
      expect(UNKNOWN_STOCK_NOTE).toBe('Запас в точке закупки неизвестен: количество посчитано по трюму и бюджету');
    });

    it('says nothing when the stock is known, a known zero included (zero is a known empty stock)', () => {
      expect(routeOptionRow(option({ buy: known(340) }), ref, 'from', new Map()).stockNote).toBeNull();
      expect(routeOptionRow(option({ buy: known(0) }), ref, 'from', new Map()).stockNote).toBeNull();
    });

    it('says that the station has no more when the stock is what limits the trip, and nothing when the hold does', () => {
      // 96 SCU are taken (the option of the fixture): a stock of 96 is all of it, a stock of 340 leaves the hold as the limit
      expect(routeOptionRow(option({ buy: known(96) }), ref, 'from', new Map()).stockLimit).toBe('На станции всего 96 SCU: больше взять нечего');
      expect(routeOptionRow(option({ buy: known(96.7) }), ref, 'from', new Map()).stockLimit).toBe('На станции всего 96 SCU: больше взять нечего');
      expect(routeOptionRow(option({ buy: known(340) }), ref, 'from', new Map()).stockLimit).toBeNull();
      expect(routeOptionRow(option({ buy: known(null) }), ref, 'from', new Map()).stockLimit).toBeNull();
    });

    it('does not look at the buyer: what the buyer holds limits nothing (spec 14.5), known or not', () => {
      const sell = (scu: number | null) => estimate({ scu, scuOrigin: scu === null ? null : 'uex' });
      expect(routeOptionRow(option({ buy: known(340), sell: sell(null) }), ref, 'from', new Map()).stockNote).toBeNull();
      expect(routeOptionRow(option({ buy: known(null), sell: sell(500) }), ref, 'from', new Map()).stockNote).toBe(UNKNOWN_STOCK_NOTE);
    });
  });

  it('names the origin and shows its purchase price when the trips end here', () => {
    const row = routeOptionRow(option(), ref, 'to', new Map());
    expect(row.terminal).toBe('ARC-L1');
    // my own price has no range, and its badge carries the temperature
    expect(row.price).toEqual({ price: nb('6 120'), range: NO_PRICE, badge: { text: 'моя · 40 мин', kind: 'hot' } });
  });

  describe('the tooltip of the terminal of the row: where it is', () => {
    const placed = (partial1: Partial<Terminal> = {}, partial2: Partial<Terminal> = {}) => ({
      ...ref,
      terminals: new Map([
        [1, { ...ref.terminals.get(1)!, starSystemName: 'Stanton', planetName: 'ArcCorp', ...partial1 }],
        [2, { ...ref.terminals.get(2)!, starSystemName: 'Pyro', moonName: 'Ignis', ...partial2 }],
      ]),
    });

    it('is the name and the whole place of the other end when the row names one end', () => {
      const row = routeOptionRow(option(), placed(), 'from', new Map(), { anchorTerminalId: 1 });
      expect(row.bothEnds).toBe(false);
      expect(row.whereTitle).toBe('TDD Area 18\nPyro · Ignis');
      expect(routeOptionRow(option(), placed(), 'to', new Map(), { anchorTerminalId: 2 }).whereTitle).toBe('ARC-L1\nStanton · ArcCorp');
    });
    it('is the trip and the place of each end when the row names both', () => {
      const row = routeOptionRow(option(), placed(), 'from', new Map());
      expect(row.bothEnds).toBe(true);
      expect(row.whereTitle).toBe('ARC-L1 → TDD Area 18\nARC-L1: Stanton · ArcCorp\nTDD Area 18: Pyro · Ignis');
    });
    it('leaves out the line of an end whose place is not known, and is the plain name or trip as before without any', () => {
      const unknown = { ...ref, starSystems: [] };
      expect(routeOptionRow(option(), unknown, 'from', new Map(), { anchorTerminalId: 1 }).whereTitle).toBe('TDD Area 18');
      expect(routeOptionRow(option(), unknown, 'from', new Map()).whereTitle).toBe('ARC-L1 → TDD Area 18');
    });
    it('does not change the text of the row, which is the names', () => {
      const row = routeOptionRow(option(), placed(), 'from', new Map());
      expect([row.terminal, row.origin, row.dest]).toEqual(['TDD Area 18', 'ARC-L1', 'TDD Area 18']);
    });
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

  it('still tells a dash from one price: a UEX price with no bounds is no flat price, and the tooltip does not say UEX knows no price', () => {
    const noBounds = estimate({ price: 6900, low: 0, high: 0 });
    expect(routeOptionRow(option({ sell: noBounds }), ref, 'from', new Map()).price.range).toEqual(NO_BOUNDS);
  });

  it('writes the dash of the place UEX gives a price without bounds for, beside my own price as well', () => {
    const row = routeOptionRow(option(), ref, 'to', new Map(), { uexRange: () => ({ kind: 'no-bounds' }) });
    expect(row.price.range).toEqual(NO_BOUNDS);
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
  // the price here is 6 840: 96 SCU at 6 900 add 5 760, at the low end of the range (6 400) they take 42 240 away
  extraProfit: 5760, extraProfitLow: -42_240, extraSec: 1055, extraSource: 'estimate', extraUecPerHour: 19_655, ...partial,
});

describe('sellHereRow', () => {
  it('formats the sale on the spot', () => {
    expect(sellHereRow(here)).toEqual({ qty: '96 SCU', profit: nb('74 880'), loss: false, roi: '13%', rate: '310k/ч' });
  });
  it('shows a dash without a rate and marks a loss', () => {
    expect(sellHereRow({ ...here, profit: -1200, roi: -0.01, uecPerHour: null })).toMatchObject({ profit: nb('-1 200'), loss: true, rate: '—' });
  });
  it('writes the ROI the way the table and the list of options do: whole percents, one decimal below 10', () => {
    for (const roi of [0.1275, 0.0904, 0.0251, 0.0996, 0, -0.0123, 4.2, Number.NaN]) {
      expect(sellHereRow({ ...here, roi }).roi).toBe(formatRoi(roi));
    }
    expect(sellHereRow({ ...here, roi: 0.0904 }).roi).toBe('9%');
    expect(sellHereRow({ ...here, roi: 0.0251 }).roi).toBe('2,5%');
  });
  it('writes the rate with the number of the list of options, and its own unit (the card has no «UEC/ч» caption)', () => {
    for (const uec of [0, 950, 310_000, 9_270_000, 12_534_000, 123_400_000, -12_534_000]) {
      expect(sellHereRow({ ...here, uecPerHour: uec }).rate).toBe(`${perHourNarrow(uec)}/ч`);
    }
    expect(sellHereRow({ ...here, uecPerHour: 12_534_000 }).rate).toBe('12,5M/ч');
  });
});

describe('paceLine', () => {
  it('says the pace and how many runs it is made of, or why there is none', () => {
    expect(paceLine({ uecPerHour: 85_000, runs: 12 })).toBe(`Твой обычный темп ${perHourNarrow(85_000)}/ч · рейсов в расчёте: 12`);
    expect(paceLine(null)).toBe('Обычного темпа пока нет: он считается по законченным рейсам');
  });
});

describe('routeOptionRow: the worst case of a route whose prices have no range', () => {
  const one = (price: number) => estimate({ price, low: price, high: price });
  it('is a dash when both prices are one number, and a number as soon as one of them has a range', () => {
    expect(routeOptionRow(option({ buy: one(6120), sell: one(6900) }), ref, 'from', new Map()).worst).toBe('—');
    expect(routeOptionRow(option({ buy: one(6120) }), ref, 'from', new Map()).worst).not.toBe('—');
  });
});

describe('sellAlternativeRow', () => {
  it('formats an alternative with its price, what it adds and the way there', () => {
    expect(sellAlternativeRow(alternative(), ref)).toEqual({
      key: '2', terminal: 'TDD Area 18',
      price: { price: nb('6 900'), range: SPREAD, badge: { text: 'UEX · 2 д', kind: 'uex' } },
      extra: nb('+5 760'), loss: false, extraLow: nb('-42 240'), extraLowLoss: true,
      rate: `${perHourNarrow(19_655)}/ч`, rateTone: null, time: '≈ 17:35', timeTitle: 'Оценка по расстоянию',
    });
  });
  it('labels an alternative priced by UEX at an unknown age with a plain UEX badge', () => {
    const row = sellAlternativeRow(alternative({ sell: estimate({ ageKnown: false, ageSec: 1_760_000_000 }) }), ref);
    expect(row.price.badge).toEqual({ text: 'UEX', kind: 'uex' });
  });
  it('shows dashes when no time is known, and marks a place that adds nothing', () => {
    const row = sellAlternativeRow(alternative({ extraSec: null, extraSource: null, extraUecPerHour: null, extraProfit: -300 }), ref);
    expect(row).toMatchObject({ time: '—', timeTitle: null, rate: '—', extra: nb('-300'), loss: true });
    expect(sellAlternativeRow(alternative({ extraProfit: 0 }), ref)).toMatchObject({ extra: '0', loss: true });
  });
  it('writes my own time without the mark of an estimate', () => {
    expect(sellAlternativeRow(alternative({ extraSource: 'own' }), ref)).toMatchObject({ time: '17:35', timeTitle: 'По твоим рейсам: перелёт и выгрузка' });
  });
  it('has no low end for a price that is one number (a price of my own)', () => {
    expect(sellAlternativeRow(alternative({ extraProfitLow: null }), ref)).toMatchObject({ extraLow: '—', extraLowLoss: false });
  });
  it('says how the rate of the further leg stands to the usual pace, when both are known', () => {
    expect(sellAlternativeRow(alternative(), ref, 10_000).rateTone).toBe('above');
    expect(sellAlternativeRow(alternative(), ref, 50_000).rateTone).toBe('below');
    expect(sellAlternativeRow(alternative({ extraUecPerHour: null }), ref, 10_000).rateTone).toBeNull();
  });
  it('writes the rate with the number of the list of options', () => {
    expect(sellAlternativeRow(alternative({ extraUecPerHour: 12_534_000 }), ref).rate).toBe('12,5M/ч');
  });
  it('falls back to the id for an unknown terminal', () => {
    expect(sellAlternativeRow(alternative({ destId: 777 }), ref).terminal).toBe('#777');
  });
});

describe('routeOptionRow: a trip bought at another terminal than the one the list is of («выгоднее», spec 14.19)', () => {
  // the list is of terminal 3; the trip is bought at 1 and sold at 2, after an empty flight of 310 s
  const elsewhere = option({ emptyLegSec: 310 });

  it('says the empty flight to the purchase, and names both ends', () => {
    expect(routeOptionRow(elsewhere, ref, 'from', new Map(), { anchorTerminalId: 3 })).toMatchObject({ emptyLeg: 'пустой 5:10', bothEnds: true });
    expect(routeOptionRow(option({ emptyLegSec: 0 }), ref, 'from', new Map(), { anchorTerminalId: 3 }).emptyLeg).toBe('пустой —');
  });

  it('has no empty flight for a trip bought at the terminal itself, nor for trips that end at it', () => {
    expect(routeOptionRow(option(), ref, 'from', new Map(), { anchorTerminalId: 1 }).emptyLeg).toBeNull();
    expect(routeOptionRow(option(), ref, 'to', new Map(), { anchorTerminalId: 2 }).emptyLeg).toBeNull();
  });

  it('is the target only when BOTH steps are the ones that are set: the purchase first, the sale after it', () => {
    const row = (targetTerminalId: number | null, targetThenId: number | null) => (
      routeOptionRow(elsewhere, ref, 'from', new Map(), { anchorTerminalId: 3, targetTerminalId, targetThenId }).isTarget
    );
    expect(row(1, 2)).toBe(true);
    expect(row(2, null)).toBe(false);     // the sale alone is another target: it skips the purchase
    expect(row(1, null)).toBe(false);
    expect(row(null, null)).toBe(false);
  });

  it('keeps a trip bought here a target of one step', () => {
    const row = (targetThenId: number | null) => routeOptionRow(option(), ref, 'from', new Map(), { anchorTerminalId: 1, targetTerminalId: 2, targetThenId }).isTarget;
    expect(row(null)).toBe(true);
    expect(row(5)).toBe(false);
  });
});

describe('routeOptionRow: the ship of the settings where the trip is loaded (spec 14.19, item 10)', () => {
  // the trip is loaded at terminal 1; the reference of the fixtures says nothing of its boxes, so the terminal is given them here
  const withBoxes = { ...ref, terminals: new Map(ref.terminals).set(1, { ...ref.terminals.get(1)!, maxContainerScu: 32, hasLoadingDock: false }) };
  const small = { id: 1, name: 'Cutlass', nameFull: 'Drake Cutlass', scu: 46, containerScu: [1, 2, 4, 8], isLoadingDock: false };
  const hull = { id: 2, name: 'Hull C', nameFull: 'MISC Hull C', scu: 4608, containerScu: [1, 2, 4, 8, 16, 24, 32], isLoadingDock: true };

  it('says which boxes to ask for at the purchase terminal', () => {
    expect(routeOptionRow(option(), withBoxes, 'from', new Map(), { vehicle: small })).toMatchObject({ boxes: 'Ящики: до 8 SCU', loadBar: null });
    expect(routeOptionRow(option(), withBoxes, 'from', new Map(), { vehicle: hull }).boxes).toBe('Ящики: любые');
  });

  it('marks a trip whose purchase terminal has no loading dock for a ship that needs one, and keeps it', () => {
    expect(routeOptionRow(option(), withBoxes, 'from', new Map(), { vehicle: hull }).loadBar).toBe('нет грузового дока');
  });

  it('says nothing without a ship of the reference, or where UEX says nothing of the terminal', () => {
    expect(routeOptionRow(option(), withBoxes, 'from', new Map())).toMatchObject({ boxes: null, loadBar: null });
    expect(routeOptionRow(option(), ref, 'from', new Map(), { vehicle: small }).boxes).toBeNull();
  });
});
