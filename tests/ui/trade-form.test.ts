import { describe, expect, it } from 'vitest';
import { cargoOf } from '../../src/core/run';
import { stockKnown } from '../../src/core/routes';
import type { RouteOption } from '../../src/core/routes';
import type { CargoLine } from '../../src/core/types';
import { cellScu } from '../../src/ui/vm/terminal-rows';
import type { Cell } from '../../src/ui/vm/terminal-rows';
import { getActiveRun, listRuns } from '../../src/data/repo/runs';
import { recordBuy, recordSell } from '../../src/data/trade';
import { cellEditBase } from '../../src/ui/vm/inputs';
import {
  confirmStep, goodsCameAboard, GOODS_ABOARD_NOTICE, INCOME_NOTE, knownScuOf, PRICE_CHECK_NOTE, STOCK_UNKNOWN_NOTE, tradeDefaults, tradeEntryField, tradeLimit,
  tradeMode,
} from '../../src/ui/vm/trade-form';
import { bought, GOLD, runOf, sold, TITA } from '../helpers/run-wiring-fixtures';
import { buyIn as goldBought, sellIn as goldSold, tradeFixture } from '../helpers/trade-fixtures';

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
    expect(buyIn()).toEqual({ scu: 340, price: 6120, priceIsOwn: true, stockUnknown: false });                                                  // the stock is the limit
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
  it('offers the whole price the row shows: UEX gives REAL averages, and a form that is refused a number nobody typed is no help', () => {
    expect(buyIn({ cell: cell({ hint: 7345.6, ownScu: 5 }) })).toMatchObject({ price: 7346 });
    expect(buyIn({ cell: cell({ hint: 7345.4, ownScu: 5 }) })).toMatchObject({ price: 7345 });
    expect(buyIn({ cell: cell({ own: 6120, hint: 7345.6, ownScu: 5 }) })).toMatchObject({ price: 6120 }); // mine, whole, unchanged
  });
  it('offers no price when the one of the row rounds to zero (the typed price is refused there too), and then no budget limit', () => {
    expect(buyIn({ cell: cell({ hint: 0.3, ownScu: 50 }), budget: 1000 })).toEqual({ scu: 50, price: null, priceIsOwn: false, stockUnknown: false });
  });
  it('does not guess a quantity when nothing limits it, or when nothing can be carried', () => {
    expect(buyIn({ capacity: 0, cell: cell({ own: 6120 }) })).toEqual({ scu: null, price: 6120, priceIsOwn: true, stockUnknown: true });       // no ship, no stock
    expect(buyIn({ capacity: 0 })).toMatchObject({ scu: 340 });                                          // no ship: the stock
    expect(buyIn({ cargo: [gold(696)] })).toMatchObject({ scu: null });                                  // the hold is full
    expect(buyIn({ cell: cell({ own: 6120, ownScu: 0 }) })).toMatchObject({ scu: null });                // a known empty stock
  });
  it('leaves the budget out while there is no price to divide it by', () => {
    expect(buyIn({ budget: 1000, cell: cell({ ownScu: 50 }) })).toMatchObject({ scu: 50 });
  });
});

describe('tradeDefaults, buying: the stock at the seller is unknown (version 1.1.1)', () => {
  it('says so when neither my reading nor a quantity of UEX is there: the quantity offered then rests on the hold and the budget alone', () => {
    expect(buyIn({ cell: cell({ own: 6120 }) })).toMatchObject({ scu: 696, stockUnknown: true });         // the whole hold, silently, until now
    expect(buyIn({ cell: cell({ own: 6120 }), budget: 1_000_000 })).toMatchObject({ scu: 163, stockUnknown: true });
    expect(buyIn({ cell: cell({ hint: 6000 }) })).toMatchObject({ stockUnknown: true });
  });

  it('says nothing when a stock is known: my reading, my estimate of the refill timer, a quantity of UEX, and a known zero', () => {
    expect(buyIn({ cell: cell({ own: 6120, ownScu: 340 }) }).stockUnknown).toBe(false);
    expect(buyIn({ cell: cell({ own: 6120, ownScu: 427, ownScuBase: { scu: 380, age: '7 мин' } }) }).stockUnknown).toBe(false);
    expect(buyIn({ cell: cell({ own: 6120, hintScu: 90 }) }).stockUnknown).toBe(false);
    expect(buyIn({ cell: cell({ own: 6120, ownScu: 0 }) }).stockUnknown).toBe(false);                    // nothing there is not "nobody knows"
    expect(buyIn({ cell: cell({ own: 6120, hintScu: 0 }) }).stockUnknown).toBe(false);
  });

  it('is never said of a sale: what the buyer already holds limits nothing', () => {
    const sell = (c: ReturnType<typeof cell>) => tradeDefaults({ side: 'sell', commodityId: GOLD, cell: c, cargo: [gold(96)], capacity: 696, budget: null });
    expect(sell(cell({ own: 6900 })).stockUnknown).toBe(false);
    expect(sell(cell()).stockUnknown).toBe(false);
  });

  it('is the very predicate of the "?" of the list of options (`stockKnown`) and of the dash of the column «SCU» of the row (`cellScu`)', () => {
    const values: Array<number | null> = [null, 0, 12];
    for (const ownScu of values) {
      for (const hintScu of values) {
        const c = cell({ own: 6120, ownScu, hintScu });
        const unknown = buyIn({ cell: c }).stockUnknown;
        // an option rests on the same number: my estimate wins over the quantity of UEX
        const option = { buy: { scu: ownScu ?? hintScu } } as unknown as Pick<RouteOption, 'buy'>;
        expect(unknown, `option ${ownScu}/${hintScu}`).toBe(!stockKnown(option));
        expect(unknown, `row ${ownScu}/${hintScu}`).toBe(cellScu({ ...c, ownScuRate: null } as Cell, 'buy') === null);
      }
    }
  });

  it('has the words of the brief', () => {
    expect(STOCK_UNKNOWN_NOTE).toBe('Запас неизвестен: количество — по трюму и бюджету');
  });
});

describe('tradeDefaults, selling', () => {
  const sellIn = (over: Partial<Parameters<typeof tradeDefaults>[0]> = {}) => tradeDefaults({
    side: 'sell', commodityId: GOLD, cell: cell({ own: 6900 }), cargo: [gold(96), tita(40)], capacity: 696, budget: null, ...over,
  });

  it('is the whole cargo of this commodity at the price of the row', () => {
    expect(sellIn()).toEqual({ scu: 96, price: 6900, priceIsOwn: true, stockUnknown: false });
    expect(sellIn({ commodityId: TITA, cell: cell({ hint: 3000 }) })).toEqual({ scu: 40, price: 3000, priceIsOwn: false, stockUnknown: false });
  });
  it('is not limited by what the buyer already holds', () => {
    expect(sellIn({ cell: cell({ own: 6900, ownScu: 0, hintScu: 12 }) })).toMatchObject({ scu: 96 });
  });
  it('has no quantity for a commodity that is not on board, and no price when the row has none', () => {
    expect(sellIn({ cargo: [tita(40)] })).toMatchObject({ scu: null });
    expect(sellIn({ cell: cell() })).toMatchObject({ price: null });
  });
  it('offers the whole price the row shows, and none when it rounds to zero', () => {
    expect(sellIn({ cell: cell({ hint: 3000.6 }) })).toEqual({ scu: 96, price: 3001, priceIsOwn: false, stockUnknown: false });
    expect(sellIn({ cell: cell({ own: 6900 }) })).toEqual({ scu: 96, price: 6900, priceIsOwn: true, stockUnknown: false });
    expect(sellIn({ cell: cell({ hint: 0.3 }) })).toEqual({ scu: 96, price: null, priceIsOwn: false, stockUnknown: false });
  });
});

describe('knownScuOf', () => {
  it('is the quantity of my own the row shows, a known zero included', () => {
    expect(knownScuOf(cell({ ownScu: 340 }))).toBe(340);
    expect(knownScuOf(cell({ ownScu: 0 }))).toBe(0);
  });
  it('is the estimate of the refill timer when the row shows one: what the row says is what the trade is counted from', () => {
    // the stock was read as 380, the timer has moved it to 427: the row shows 427 and remembers the reading it started from
    expect(knownScuOf(cell({ ownScu: 427, ownScuBase: { scu: 380, age: '7 мин' } }))).toBe(427);
  });
  it('is the quantity when the estimate has not moved away from the reading', () => {
    expect(knownScuOf(cell({ ownScu: 380 }))).toBe(380);
  });
  it('is unknown without one: a quantity of UEX is not what the player saw', () => {
    expect(knownScuOf(cell({ hintScu: 500 }))).toBeNull();
    expect(knownScuOf(cell({ own: 6120, hintScu: 500 }))).toBeNull();
    expect(knownScuOf(null)).toBeNull();
  });
  it('is the quantity the buyer holds on the side of a sale (it has no estimate there)', () => {
    expect(knownScuOf(cell({ own: 6900, ownScu: 120, ownScuBase: null }))).toBe(120);
  });
});

describe('the stock the diary keeps after a trade (spec 14.3: "was 340, bought 300 -> 40")', () => {
  /** The quantity of the observation that the trade wrote, by the stock the row showed. */
  async function stockAfter(side: 'buy' | 'sell', row: Parameters<typeof cell>[0], scu: number): Promise<number | null> {
    const { deps } = await tradeFixture();
    const input = { ...(side === 'buy' ? goldBought(scu) : goldSold(scu, 7000)), knownScu: knownScuOf(cell(row)) };
    if (side === 'sell') await recordBuy(deps, goldBought(scu));
    await (side === 'buy' ? recordBuy(deps, input) : recordSell(deps, input));
    const rows = await deps.db.select<{ scu: number | null }>('SELECT scu FROM observation WHERE side = ? ORDER BY id DESC LIMIT 1', [side]);
    return rows[0]?.scu ?? null;
  }

  it('is what was read less what was bought, when the row shows the reading as it was read', async () => {
    expect(await stockAfter('buy', { own: 6120, ownScu: 340 }, 300)).toBe(40);
  });
  it('is counted from the estimate of the timer when the row shows one: the old reading must not keep growing', async () => {
    // read 280 nine minutes ago, the timer has moved it to 340: the row shows 340 and the player bought 300 of it
    expect(await stockAfter('buy', { own: 6120, ownScu: 340, ownScuBase: { scu: 280, age: '9 мин' } }, 300)).toBe(40);
  });
  it('is zero when more is bought than the estimate says is there', async () => {
    expect(await stockAfter('buy', { own: 6120, ownScu: 340, ownScuBase: { scu: 280, age: '9 мин' } }, 400)).toBe(0);
  });
  it('is none when the row has only the quantity of UEX', async () => {
    expect(await stockAfter('buy', { own: 6120, hintScu: 500 }, 300)).toBeNull();
  });
  it('is what the buyer held plus what was sold, on the side of a sale', async () => {
    expect(await stockAfter('sell', { own: 7000, ownScu: 120 }, 96)).toBe(216);
  });
});

describe('tradeMode', () => {
  it('a purchase is a purchase: the first one starts the run', () => {
    expect(tradeMode('buy', null, GOLD)).toBe('buy');
    expect(tradeMode('buy', runOf(bought(0)), TITA)).toBe('buy');
  });
  it('a sale of what is in the hold is a sale of the run', () => {
    expect(tradeMode('sell', runOf(bought(0)), GOLD)).toBe('sell');
    expect(tradeMode('sell', runOf(bought(0), sold(60, GOLD, 40)), GOLD)).toBe('sell');        // 56 SCU are still aboard
  });
  it('a sale of what is not in the hold is an income: there is no run, or the hold has none of it, or all of it is sold', () => {
    expect(tradeMode('sell', null, GOLD)).toBe('income');
    expect(tradeMode('sell', runOf(bought(0)), TITA)).toBe('income');
    expect(tradeMode('sell', runOf(bought(0), sold(60)), GOLD)).toBe('income');
    expect(tradeMode('sell', runOf(), GOLD)).toBe('income');                                   // a run that has bought nothing yet
  });
  it('keeps a sale of more than the hold has a sale, so that the service still refuses it', async () => {
    const { deps } = await tradeFixture();
    await recordBuy(deps, goldBought(96));
    expect(tradeMode('sell', await getActiveRun(deps.db), 10)).toBe('sell');
    await expect(recordSell(deps, goldSold(97, 7000))).rejects.toMatchObject({ code: 'oversell', message: 'В трюме только 96 SCU' });
    expect((await listRuns(deps.db)).map(r => r.run.status)).toEqual(['active']);              // nothing was turned into an income
  });
  it('says in one muted line what an income is', () => {
    expect(INCOME_NOTE).toBe('Нет в трюме — запишется как доход без закупки');
  });
});

describe('goodsCameAboard', () => {
  it('is true for a form opened as an income when the goods are in the hold by the time it is confirmed', () => {
    expect(goodsCameAboard('income', runOf(bought(0)), GOLD)).toBe(true);                     // a purchase of the same goods in the meantime
    expect(goodsCameAboard('income', runOf(bought(0), bought(30, TITA, 10)), TITA)).toBe(true);
  });
  it('is false while the goods are still not aboard, and for the forms that promised nothing about it', () => {
    expect(goodsCameAboard('income', null, GOLD)).toBe(false);
    expect(goodsCameAboard('income', runOf(bought(0)), TITA)).toBe(false);
    expect(goodsCameAboard('sell', runOf(bought(0)), GOLD)).toBe(false);
    expect(goodsCameAboard('sell', null, GOLD)).toBe(false);                                   // the hold was sold out: another refusal, not this one
    expect(goodsCameAboard('buy', runOf(bought(0)), GOLD)).toBe(false);
  });
  it('has its own sentence for the notice line, which tells the player what to do', () => {
    expect(GOODS_ABOARD_NOTICE).toBe('Этот товар уже в трюме — нажми «Продал» ещё раз');
  });
});

describe('tradeDefaults, whose the price is (task 44)', () => {
  const whose = (side: 'buy' | 'sell', c: ReturnType<typeof cell>) => tradeDefaults({ side, commodityId: GOLD, cell: c, cargo: [gold(96)], capacity: 696, budget: null }).priceIsOwn;

  it('is mine when the row shows a price of mine (not cold), on both sides', () => {
    expect(whose('buy', cell({ own: 6120, hint: null, ownScu: 5 }))).toBe(true);
    expect(whose('sell', cell({ own: 6900 }))).toBe(true);
  });

  it('is not mine when the row shows the price of UEX or my cold one (both are the hint of the row)', () => {
    expect(whose('buy', cell({ hint: 6000, ownScu: 5 }))).toBe(false);
    expect(whose('sell', cell({ hint: 3000 }))).toBe(false);
  });

  it('is nobody\'s when there is no price at all, or the one of the row rounds to zero', () => {
    expect(whose('buy', cell({ ownScu: 5 }))).toBe(false);
    expect(whose('sell', cell({ own: 0.3 }))).toBe(false);
  });

  it('says what the table says: the same answer as the field of the expanded row', () => {
    for (const c of [cell({ own: 6120 }), cell({ hint: 6000 }), cell({}), cell({ own: 0.3 }), cell({ own: 6120, hint: 7000 })]) {
      expect(whose('sell', c)).toBe(cellEditBase({ ...c, ownScuBase: null }).priceIsOwn);
    }
  });
});

describe('tradeDefaults, an income', () => {
  it('starts with no quantity, the player types it, and with the price of the row', () => {
    const d = tradeDefaults({ side: 'sell', commodityId: GOLD, cell: cell({ own: 6900, ownScu: 12 }), cargo: [], capacity: 696, budget: null });
    expect(d).toEqual({ scu: null, price: 6900, priceIsOwn: true, stockUnknown: false });
    const other = tradeDefaults({ side: 'sell', commodityId: GOLD, cell: cell({ hint: 6500 }), cargo: [tita(40)], capacity: 696, budget: null });
    expect(other).toEqual({ scu: null, price: 6500, priceIsOwn: false, stockUnknown: false });
  });
});

describe('tradeEntryField: where the cursor goes when «Купил» / «Продал» of the row opens the form', () => {
  it('a purchase: into the quantity', () => {
    expect(tradeEntryField('buy', false)).toBe('trade-scu');
    expect(tradeEntryField('buy', true)).toBe('trade-scu'); // the hold says nothing about a purchase
  });

  it('a sale of what is in the hold: into the price, for the form holds the whole cargo already', () => {
    expect(tradeEntryField('sell', true)).toBe('trade-price');
  });

  it('a sale of goods that are not in the hold (an income): into the quantity, which is empty there', () => {
    expect(tradeEntryField('sell', false)).toBe('trade-scu');
  });

  it('on the sell side the cursor is in the quantity exactly when the form starts with an empty one, so nothing typed lands on the price', () => {
    const row = cell({ hint: 6500 });
    for (const cargo of [[], [tita(40)], [gold(96)], [gold(96), tita(40)]]) {
      const inHold = cargo.some((line) => line.commodityId === GOLD);
      const starts = tradeDefaults({ side: 'sell', commodityId: GOLD, cell: row, cargo, capacity: 696, budget: null });
      expect(tradeEntryField('sell', inHold) === 'trade-scu').toBe(starts.scu === null);
    }
  });
});

describe('confirmStep: a price that is not mine is not written without a look (task 47)', () => {
  /** The form holds a price of UEX (or mine gone cold) that nobody touched, was not asked about it yet, and the quantity fits. */
  const step = (over: Partial<Parameters<typeof confirmStep>[0]> = {}) => confirmStep({ priceIsOwn: false, priceTouched: false, asked: false, fits: true, ...over });

  it('the first confirmation writes nothing: the player is asked to check the price', () => {
    expect(step()).toBe('check-price');
  });

  it('the second confirmation writes', () => {
    expect(step({ asked: true })).toBe('write');
  });

  it('a price of mine that is fresh is written at once, as before', () => {
    expect(step({ priceIsOwn: true })).toBe('write');
    expect(step({ priceIsOwn: true, asked: true })).toBe('write');
  });

  it('a price the player put his hand to is written at once, whatever he typed (the same number too: he confirmed it by typing)', () => {
    expect(step({ priceTouched: true })).toBe('write');
  });

  it('a quantity the service is going to refuse goes to the service as before: its refusal comes first, and the question is not spent on it', () => {
    expect(step({ fits: false })).toBe('write'); // nothing is written by it: the service answers «В трюме только N SCU»
    expect(step({ fits: true })).toBe('check-price'); // the quantity was put right: now the price is asked about
  });

  it('has one sentence for the line under the form', () => {
    expect(PRICE_CHECK_NOTE).toBe('Цена справочная — проверь её и подтверди ещё раз');
  });
});

describe('tradeLimit: the largest quantity the service takes, as far as the screen knows', () => {
  const limit = (over: Partial<Parameters<typeof tradeLimit>[0]> = {}) => tradeLimit({ mode: 'sell', commodityId: GOLD, cargo: [gold(96), tita(40)], capacity: 696, ...over });

  it('a sale from the run: what the hold has of this commodity, not the whole hold', () => {
    expect(limit()).toBe(96);
    expect(limit({ commodityId: TITA })).toBe(40);
    expect(limit({ cargo: [tita(40)] })).toBe(0); // sold out meanwhile: the service refuses any quantity
  });

  it('a purchase: the free space of the hold, every commodity counted, never below zero', () => {
    expect(limit({ mode: 'buy' })).toBe(560); // 696 − 96 − 40
    expect(limit({ mode: 'buy', cargo: [] })).toBe(696);
    expect(limit({ mode: 'buy', cargo: [gold(700)] })).toBe(0);
  });

  it('nothing limits a purchase while the ship is not set, and nothing limits an income', () => {
    expect(limit({ mode: 'buy', capacity: 0 })).toBeNull();
    expect(limit({ mode: 'income' })).toBeNull();
    expect(limit({ mode: 'income', cargo: [] })).toBeNull();
  });

  it('is the very quantity above which the service refuses, with the refusals the form shows as before', async () => {
    const { deps } = await tradeFixture();
    await recordBuy(deps, goldBought(96));
    const cargo = cargoOf((await getActiveRun(deps.db))?.events ?? []);
    const capacity = deps.settings.scuCapacity;

    const free = tradeLimit({ mode: 'buy', commodityId: 10, cargo, capacity });
    expect(free).toBe(600);
    await expect(recordBuy(deps, goldBought(601))).rejects.toMatchObject({ code: 'no_space', message: 'Свободно только 600 SCU' });

    const aboard = tradeLimit({ mode: 'sell', commodityId: 10, cargo, capacity });
    expect(aboard).toBe(96);
    await expect(recordSell(deps, goldSold(97, 7000))).rejects.toMatchObject({ code: 'oversell', message: 'В трюме только 96 SCU' });
    await expect(recordSell(deps, goldSold(96, 7000))).resolves.toMatchObject({ finished: true });
  });
});
