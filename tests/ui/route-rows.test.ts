import { describe, expect, it } from 'vitest';
import { formatDistance, routeOptionRow, sellAlternativeRow, sellHereRow } from '../../src/ui/vm/route-rows';
import type { RouteOption } from '../../src/core/routes';
import type { SellAlternative, SellHere } from '../../src/core/sell';
import type { Estimate } from '../../src/core/types';
import { pairKey } from '../../src/core/types';
import { ref, term } from '../helpers/factories';

// formatUec separates thousands with a non-breaking space
const nb = (s: string) => s.replace(/ /g, String.fromCharCode(0xa0));

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

describe('routeOptionRow', () => {
  it('names the destination and shows its sale price when the trips start here', () => {
    expect(routeOptionRow(option(), ref, 'from', new Map())).toEqual({
      key: '1>2:10', terminal: 'TDD Area 18', commodity: 'GOLD',
      distance: '59 Гм', time: '17:35', timeTitle: 'оценка по расстоянию',
      runs: 0,
      price: { price: nb('6 900'), range: `${nb('6 400')}–${nb('7 100')}`, badge: { text: 'UEX · 2 д', kind: 'uex' } },
      roi: '12,8%', rate: '256k/ч', worst: nb('27 840'), worstLoss: false, qty: '96 SCU',
    });
  });

  it('names the origin and shows its purchase price when the trips end here', () => {
    const row = routeOptionRow(option(), ref, 'to', new Map());
    expect(row.terminal).toBe('ARC-L1');
    // my own price has no range, and its badge carries the temperature
    expect(row.price).toEqual({ price: nb('6 120'), range: null, badge: { text: 'моя · 40 мин', kind: 'hot' } });
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
      price: { price: nb('6 900'), range: `${nb('6 400')}–${nb('7 100')}`, badge: { text: 'UEX · 2 д', kind: 'uex' } },
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
