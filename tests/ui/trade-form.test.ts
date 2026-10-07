import { describe, expect, it } from 'vitest';
import type { CargoLine } from '../../src/core/types';
import type { Cell } from '../../src/ui/vm/terminal-rows';
import { knownScuOf, tradeDefaults, tradeRefusal } from '../../src/ui/vm/trade-form';
import { bought, GOLD, runOf, sold, TITA } from '../helpers/run-wiring-fixtures';

/** The parts of a table cell the form reads; the quantity is a reading (no estimate of the refill timer) unless said. */
const cell = (p: Partial<Pick<Cell, 'own' | 'hint' | 'ownScu' | 'hintScu' | 'ownScuBase'>> = {}) => (
  { own: null, hint: null, ownScu: null, hintScu: null, ownScuBase: null, ...p }
);

const gold = (scu: number): CargoLine => ({ commodityId: GOLD, scu, avgBuyPrice: 6120 });
const tita = (scu: number): CargoLine => ({ commodityId: TITA, scu, avgBuyPrice: 2500 });

const buyIn = (over: Partial<Parameters<typeof tradeDefaults>[0]> = {}) => tradeDefaults({
  side: 'buy', commodityId: GOLD, cell: cell({ own: 6120, ownScu: 340 }), cargo: [], capacity: 696, budget: null, ...over,
});

describe('tradeDefaults, buying', () => {
  it('offers what the core would carry: the smallest of the free space, the stock and the budget', () => {
    expect(buyIn()).toEqual({ scu: 340, price: 6120 });                                                  // the stock is the limit
    expect(buyIn({ cargo: [gold(500)] })).toMatchObject({ scu: 196 });                                   // 696 − 500 free
    expect(buyIn({ budget: 1_000_000 })).toMatchObject({ scu: 163 });                                    // 1 000 000 / 6120
  });
  it('counts the whole hold, not only this commodity', () => {
    expect(buyIn({ cargo: [gold(100), tita(300)] })).toMatchObject({ scu: 296 });
  });
  it('takes the stock of my own reading, else the one UEX has, else none', () => {
    expect(buyIn({ cell: cell({ own: 6120, ownScu: 40, hintScu: 900 }) })).toMatchObject({ scu: 40 });
    expect(buyIn({ cell: cell({ own: 6120, hintScu: 90 }) })).toMatchObject({ scu: 90 });
    expect(buyIn({ cell: cell({ own: 6120 }) })).toMatchObject({ scu: 696 });                            // the stock is not known: the hold
  });
  it('is the price of the row: mine, else the hint, else empty', () => {
    expect(buyIn({ cell: cell({ own: 6120, hint: 6000, ownScu: 5 }) })).toMatchObject({ price: 6120 });
    expect(buyIn({ cell: cell({ hint: 6000, ownScu: 5 }) })).toMatchObject({ price: 6000 });
    expect(buyIn({ cell: cell({ ownScu: 5 }) })).toMatchObject({ price: null });
  });
  it('does not guess a quantity when nothing limits it, or when nothing can be carried', () => {
    expect(buyIn({ capacity: 0, cell: cell({ own: 6120 }) })).toEqual({ scu: null, price: 6120 });       // no ship, no stock
    expect(buyIn({ capacity: 0 })).toMatchObject({ scu: 340 });                                          // no ship: the stock
    expect(buyIn({ cargo: [gold(696)] })).toMatchObject({ scu: null });                                  // the hold is full
    expect(buyIn({ cell: cell({ own: 6120, ownScu: 0 }) })).toMatchObject({ scu: null });                // a known empty stock
  });
  it('leaves the budget out while there is no price to divide it by', () => {
    expect(buyIn({ budget: 1000, cell: cell({ ownScu: 50 }) })).toMatchObject({ scu: 50 });
  });
});

describe('tradeDefaults, selling', () => {
  const sellIn = (over: Partial<Parameters<typeof tradeDefaults>[0]> = {}) => tradeDefaults({
    side: 'sell', commodityId: GOLD, cell: cell({ own: 6900 }), cargo: [gold(96), tita(40)], capacity: 696, budget: null, ...over,
  });

  it('is the whole cargo of this commodity at the price of the row', () => {
    expect(sellIn()).toEqual({ scu: 96, price: 6900 });
    expect(sellIn({ commodityId: TITA, cell: cell({ hint: 3000 }) })).toEqual({ scu: 40, price: 3000 });
  });
  it('is not limited by what the buyer already holds', () => {
    expect(sellIn({ cell: cell({ own: 6900, ownScu: 0, hintScu: 12 }) })).toMatchObject({ scu: 96 });
  });
  it('has no quantity for a commodity that is not on board, and no price when the row has none', () => {
    expect(sellIn({ cargo: [tita(40)] })).toMatchObject({ scu: null });
    expect(sellIn({ cell: cell() })).toMatchObject({ price: null });
  });
});

describe('knownScuOf', () => {
  it('is the quantity of my own the row shows, a known zero included', () => {
    expect(knownScuOf(cell({ ownScu: 340 }))).toBe(340);
    expect(knownScuOf(cell({ ownScu: 0 }))).toBe(0);
  });
  it('is unknown when the row shows an estimate of the refill timer: that is a calculation, not what the player read', () => {
    // the stock was read as 380, the timer has moved it to 427: the row shows 427 and remembers the reading it started from
    expect(knownScuOf(cell({ ownScu: 427, ownScuBase: { scu: 380, age: '7 мин' } }))).toBeNull();
  });
  it('is the quantity when the estimate has not moved away from the reading', () => {
    expect(knownScuOf(cell({ ownScu: 380 }))).toBe(380);
  });
  it('is unknown without one: a quantity of UEX is not what the player saw', () => {
    expect(knownScuOf(cell({ hintScu: 500 }))).toBeNull();
    expect(knownScuOf(null)).toBeNull();
  });
});

describe('tradeRefusal', () => {
  it('lets a purchase through: the first one starts the run', () => {
    expect(tradeRefusal('buy', null, GOLD)).toBeNull();
    expect(tradeRefusal('buy', runOf(bought(0)), TITA)).toBeNull();
  });
  it('refuses a sale without a run, and of what is not on board', () => {
    expect(tradeRefusal('sell', null, GOLD)).toBe('Нет активного рейса');
    expect(tradeRefusal('sell', runOf(bought(0)), TITA)).toBe('Этого товара нет в трюме');
    expect(tradeRefusal('sell', runOf(bought(0), sold(60)), GOLD)).toBe('Этого товара нет в трюме');
  });
  it('lets a sale of what is on board through', () => {
    expect(tradeRefusal('sell', runOf(bought(0)), GOLD)).toBeNull();
  });
});
