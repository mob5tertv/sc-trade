import { quantity } from '../../core/routes';
import { cargoOf } from '../../core/run';
import type { CargoLine, RunWithEvents, Side } from '../../core/types';
import { priceIsOwn } from './inputs';
import { cellStock, isStockUnknown, shownPrice } from './terminal-rows';
import type { Cell } from './terminal-rows';
import { tr } from '../../i18n';

// What the trade form under a table row starts with, and what it writes (`tradeMode`: a purchase, a sale of the cargo, or
// an income). Pure: the form is drawn by `TradeDialog`, the owner is `TerminalSection`.

export interface TradeDefaults {
  /** `null`: nothing can be offered, the field is empty and the player types. */
  scu: number | null;
  price: number | null;
  /** The price is mine (a price I saw, not cold). `false`: it is the one of UEX, or mine gone cold, that the row shows; the form marks it until it is touched. */
  priceIsOwn: boolean;
  /**
   * A purchase whose OFFERED quantity rests on no stock: nobody knows how much the seller has (neither a reading of mine nor a quantity of UEX,
   * `isStockUnknown`), so what is offered is the hold and the budget alone and the real stock may be smaller. The form says so (`STOCK_UNKNOWN_NOTE()`).
   * `false` when no quantity is offered (`scu` is `null`) and always for a sale: what the buyer already holds limits nothing.
   */
  stockUnknown: boolean;
}

interface DefaultsInput {
  side: Side;
  commodityId: number;
  /** The row on the side of the trade: the price and the quantity the table shows. */
  cell: Pick<Cell, 'own' | 'hint' | 'ownScu' | 'hintScu'>;
  /** What is in the hold now. */
  cargo: CargoLine[];
  /** The cargo space of the ship; 0 when it is not set. */
  capacity: number;
  budget: number | null;
}

/**
 * The numbers the form starts with. The price is the whole price the row shows (`shownPrice`: mine, else the hint of UEX). A purchase offers
 * what the core would carry (`quantity`: the smallest of the free space, the stock at the seller and what the budget
 * buys; only an unknown stock, an unset budget and an unset ship do not limit it), a sale offers the whole cargo of
 * the commodity: what the buyer already holds limits nothing (spec 14.5).
 */
export function tradeDefaults(i: DefaultsInput): TradeDefaults {
  const price = shownPrice(i.cell);
  const own = priceIsOwn(i.cell);
  if (i.side === 'sell') {
    const onBoard = i.cargo.find((line) => line.commodityId === i.commodityId)?.scu ?? 0;
    return { scu: onBoard > 0 ? onBoard : null, price, priceIsOwn: own, stockUnknown: false };
  }
  const held = i.cargo.reduce((sum, line) => sum + line.scu, 0);
  // the one stock of the row (`cellStock`): the number of the column «SCU», and the volume of an option of the list rests on the same one (`stockKnown`)
  const offered = quantity({
    freeScu: i.capacity > 0 ? i.capacity - held : Number.POSITIVE_INFINITY,
    stockScu: cellStock(i.cell),
    budget: i.budget,
    buyPrice: price ?? 0,
  });
  const scu = Number.isFinite(offered) && offered > 0 ? offered : null;
  // said only of a quantity that was offered: with no ship chosen, a full hold or a budget that buys nothing the quantity is empty, and "по трюму и бюджету" beside nothing is untrue
  return { scu, price, priceIsOwn: own, stockUnknown: scu !== null && isStockUnknown(i.cell) };
}

/** The line under the form of a purchase whose stock is unknown, next to the «?» by the quantity (the words of the same note of an option of the list). */
export const STOCK_UNKNOWN_NOTE = (): string => tr('Запас неизвестен: количество — по трюму и бюджету');

/**
 * The quantity the trade is counted from, as it goes into the record (`knownScu`): the quantity of my own that the row
 * shows, a known zero included. When the refill timer has moved it away from the reading (the row remembers the reading it
 * started from, `ownScuBase`), the row shows the ESTIMATE, and the estimate is what is taken: the diary then keeps "what the
 * row said less what was bought" (spec 14.3: was 340, bought 300, so 40), and the row goes on from there. A record with
 * no quantity would leave the old reading in the diary to be grown by the timer again, as if nothing had been bought.
 * A quantity of UEX is not mine, so it is not taken: the record carries no quantity reading then.
 *
 * This is not what a table cell saves when it is edited: an estimate is never written as if the player had typed it
 * (`cellEditBase`); a trade is a change to a quantity, not a reading of it.
 */
export function knownScuOf(cell: Pick<Cell, 'ownScu'> | null): number | null {
  return cell === null ? null : cell.ownScu;
}

/** What the form under a row writes: a purchase, a sale from the hold of the run, or a sale of goods that are not in the hold (an income). */
export type TradeMode = 'buy' | 'sell' | 'income';

/**
 * The mode of the form that "Купил" / "Продал" opens (spec 14.10). A purchase is always a purchase: the first one starts the
 * run. A sale is a sale of the run while the commodity is in the hold, whatever the quantity (a quantity larger than the
 * hold is refused by the service, "В трюме только N SCU": it is almost always a typo, not goods from elsewhere), and an
 * income once it is not: with no run, or a hold without it, or all of it sold. The income is written as a run of its own.
 */
export function tradeMode(side: Side, active: RunWithEvents | null, commodityId: number): TradeMode {
  if (side === 'buy') return 'buy';
  return cargoOf(active?.events ?? []).some((line) => line.commodityId === commodityId) ? 'sell' : 'income';
}

/** The two fields of the form by the names its buttons know them by (`data-entry-field` in `TradeDialog`, `data-opens-entry` on the buttons). */
export type TradeEntryField = 'trade-scu' | 'trade-price';

/**
 * The field of the form the cursor goes into when «Купил» / «Продал» of the row opens it: the one the player types
 * into first. A purchase: the quantity. A sale of what is in the hold: the price, for the form holds the whole cargo
 * already. A sale of goods that are not in the hold (an income): the quantity, which is empty there — with the cursor
 * in the price, whose number is selected, the quantity he types would replace the price.
 * `inHold`: the commodity is in the hold of the run (`tradeMode` then says `sell`, and `tradeDefaults` offers the cargo).
 */
export function tradeEntryField(side: Side, inHold: boolean): TradeEntryField {
  return side === 'sell' && inHold ? 'trade-price' : 'trade-scu';
}

/** The one muted line under the form of an income. */
export const INCOME_NOTE = (): string => tr('Нет в трюме — запишется как доход без закупки');

/**
 * Whether a form that was opened as an income is out of date: the goods are in the hold of the run by now (a purchase came
 * in between), so the form's promise ("нет в трюме") is no longer true, and the service refuses it. The owner then closes the
 * form and says `GOODS_ABOARD_NOTICE()`, and the next press of "Продал" opens the ordinary sale.
 */
export function goodsCameAboard(mode: TradeMode, active: RunWithEvents | null, commodityId: number): boolean {
  return mode === 'income' && tradeMode('sell', active, commodityId) === 'sell';
}

/** What the notice line says when `goodsCameAboard`. */
export const GOODS_ABOARD_NOTICE = (): string => tr('Этот товар уже в трюме — нажми «Продал» ещё раз');

/**
 * The largest quantity the service takes for the form, as far as the screen knows: for a sale from the run what the hold
 * has of the commodity, for a purchase the free space of the hold (every commodity counted, never below zero). `null`:
 * nothing limits it, which is an income (it is checked against no hold) and a purchase while the ship is not set.
 * The same counts as in the service (`recordSell`, `recordBuy`), which stays the one that refuses and says why.
 */
export function tradeLimit(i: { mode: TradeMode; commodityId: number; cargo: CargoLine[]; capacity: number }): number | null {
  if (i.mode === 'income') return null;
  if (i.mode === 'sell') return i.cargo.find((line) => line.commodityId === i.commodityId)?.scu ?? 0;
  if (i.capacity <= 0) return null;
  return Math.max(0, i.capacity - i.cargo.reduce((sum, line) => sum + line.scu, 0));
}

/** What a confirmation of the form does: it writes the trade, or it writes nothing and asks the player to look at the price. */
export type ConfirmStep = 'write' | 'check-price';

export interface Confirmation {
  /** The price the form started with is mine and not cold (`TradeDefaults.priceIsOwn`), or the form started with none (the player typed it). */
  priceIsOwn: boolean;
  /** The player typed into the price field, whatever he typed: the very same number is a number he put there. */
  priceTouched: boolean;
  /** The form has asked about the price already: this is the confirmation that follows. */
  asked: boolean;
  /** The quantity is one the service takes, as far as the screen knows (`tradeLimit`). */
  fits: boolean;
}

/**
 * A price that is not mine (the one of UEX, or mine gone cold) and that the player did not touch is not written by one press of
 * Enter: the first confirmation asks him to check it (`PRICE_CHECK_NOTE()`, the cursor goes into the price), the second one
 * writes. A price of mine, or one he put his hand to, is written at once. The same for a purchase, a sale and an income.
 *
 * The refusals come first. The numbers the form itself refuses never get here. A quantity the service is going to refuse
 * (more than the hold has, more than its free space) is sent to the service as before, which writes nothing and says why;
 * the question about the price is not spent on it and is asked once the quantity is right.
 */
export function confirmStep(c: Confirmation): ConfirmStep {
  return c.priceIsOwn || c.priceTouched || c.asked || !c.fits ? 'write' : 'check-price';
}

/** The line under the form after the confirmation that only asked. */
export const PRICE_CHECK_NOTE = (): string => tr('Цена справочная — проверь её и подтверди ещё раз');
