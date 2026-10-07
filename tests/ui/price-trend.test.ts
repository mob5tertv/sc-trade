import { describe, expect, it } from 'vitest';
import { priceTrend } from '../../src/ui/vm/price-trend';
import type { Estimate } from '../../src/core/types';

// formatUec separates thousands with a non-breaking space
const nb = (s: string) => s.replace(/ /g, String.fromCharCode(0xa0));

const HOUR = 3600;

/** My own hot price 2350 whose previous reading, two hours ago, was 2300. */
const estimate = (partial: Partial<Estimate> = {}): Estimate => ({
  price: 2350, low: 2350, high: 2350, source: 'own', temp: 'hot', ageSec: 7 * 60, ageKnown: true,
  ownLast: null, uexRange: null, scu: null, scuOrigin: null, stock: null, prev: { price: 2300, ageSec: 2 * HOUR }, ...partial,
});

const moved = (price: number, was: number, ageSec = 2 * HOUR): Estimate => estimate({ price, prev: { price: was, ageSec } });

describe('priceTrend: the direction is where the price went', () => {
  it('points up when the price rose and down when it fell, on either side', () => {
    for (const side of ['buy', 'sell'] as const) {
      expect(priceTrend(moved(2350, 2300), side)?.dir).toBe('up');
      expect(priceTrend(moved(2250, 2300), side)?.dir).toBe('down');
    }
  });
});

describe('priceTrend: the colour says whether it is good for the player', () => {
  it('where he sells, a rise is good and a fall is bad', () => {
    expect(priceTrend(moved(2350, 2300), 'sell')).toMatchObject({ dir: 'up', good: true });
    expect(priceTrend(moved(2250, 2300), 'sell')).toMatchObject({ dir: 'down', good: false });
  });

  it('where he buys, a fall is good and a rise is bad', () => {
    expect(priceTrend(moved(2250, 2300), 'buy')).toMatchObject({ dir: 'down', good: true });
    expect(priceTrend(moved(2350, 2300), 'buy')).toMatchObject({ dir: 'up', good: false });
  });
});

describe('priceTrend: when there is nothing to show', () => {
  it('has no trend without a previous reading', () => {
    expect(priceTrend(estimate({ prev: null }), 'buy')).toBeNull();
    expect(priceTrend(estimate({ prev: null }), 'sell')).toBeNull();
  });

  it('has no trend when the price is the same as before', () => {
    expect(priceTrend(moved(2300, 2300), 'buy')).toBeNull();
    expect(priceTrend(moved(2300, 2300), 'sell')).toBeNull();
  });

  it('has no trend for a UEX price, even if the estimate carried a previous reading', () => {
    expect(priceTrend(estimate({ source: 'uex', temp: null }), 'buy')).toBeNull();
    expect(priceTrend(estimate({ source: 'uex', temp: null }), 'sell')).toBeNull();
  });
});

describe('priceTrend: the hint', () => {
  // the hint of the screen: 'было <price> · <age> (<signed difference>)'; thousands inside a number are separated by a non-breaking space
  const hint = (was: string, age: string, diff: string) => `было ${nb(was)} · ${age} (${nb(diff)})`;

  it('tells the previous price, how long ago it was and the signed difference: a rise', () => {
    expect(priceTrend(moved(2350, 2300, 2 * HOUR), 'sell')?.title).toBe(hint('2 300', '2 ч назад', '+50'));
  });

  it('a fall has a minus', () => {
    expect(priceTrend(moved(2250, 2300, 2 * HOUR), 'buy')?.title).toBe(hint('2 300', '2 ч назад', '-50'));
  });

  it('counts the age in minutes below an hour', () => {
    expect(priceTrend(moved(2350, 2300, 25 * 60 + 40), 'sell')?.title).toBe(hint('2 300', '25 мин назад', '+50'));
    expect(priceTrend(moved(2350, 2300, 120), 'sell')?.title).toBe(hint('2 300', '2 мин назад', '+50'));
  });

  it('counts the age in half-hour steps from an hour, and in days from a day', () => {
    expect(priceTrend(moved(2350, 2300, 90 * 60), 'sell')?.title).toBe(hint('2 300', '1,5 ч назад', '+50'));
    expect(priceTrend(moved(2350, 2300, 3 * 86_400 + 600), 'sell')?.title).toBe(hint('2 300', '3 д назад', '+50'));
  });

  it('separates the thousands of every number', () => {
    expect(priceTrend(moved(13_185, 11_885), 'buy')?.title).toBe(hint('11 885', '2 ч назад', '+1 300'));
    expect(priceTrend(moved(985, 1_020), 'buy')?.title).toBe(hint('1 020', '2 ч назад', '-35'));
  });

  it('does not say "now ago" for a reading younger than a minute', () => {
    expect(priceTrend(moved(2350, 2300, 20), 'sell')?.title).toBe(hint('2 300', 'только что', '+50'));
  });
});
