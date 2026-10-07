import { quantity } from '../../core/routes';
import { cargoOf } from '../../core/run';
import type { CargoLine, RunWithEvents, Side } from '../../core/types';
import { cellEditBase } from './inputs';
import type { Cell } from './terminal-rows';

// What the trade form under a table row starts with, and what it writes (`tradeMode`: a purchase, a sale of the cargo, or
// an income). Pure: the form is drawn by `TradeDialog`, the owner is `TerminalSection`.

export interface TradeDefaults {
  /** `null`: nothing can be offered, the field is empty and the player types. */
  scu: number | null;
  price: number | null;
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
 * The numbers the form starts with. The price is the price of the row (mine, else the hint of UEX). A purchase offers
 * what the core would carry (`quantity`: the smallest of the free space, the stock at the seller and what the budget
 * buys; only an unknown stock, an unset budget and an unset ship do not limit it), a sale offers the whole cargo of
 * the commodity: what the buyer already holds limits nothing (spec 14.5).
 */
export function tradeDefaults(i: DefaultsInput): TradeDefaults {
  const price = i.cell.own ?? i.cell.hint;
  if (i.side === 'sell') {
    const onBoard = i.cargo.find((line) => line.commodityId === i.commodityId)?.scu ?? 0;
    return { scu: onBoard > 0 ? onBoard : null, price };
  }
  const held = i.cargo.reduce((sum, line) => sum + line.scu, 0);
  const offered = quantity({
    freeScu: i.capacity > 0 ? i.capacity - held : Number.POSITIVE_INFINITY,
    stockScu: i.cell.ownScu ?? i.cell.hintScu,
    budget: i.budget,
    buyPrice: price ?? 0,
  });
  return { scu: Number.isFinite(offered) && offered > 0 ? offered : null, price };
}

/**
 * The quantity the player saw at the terminal before the trade, as it goes into the record (`knownScu`): the quantity of
 * my own the row shows, a known zero included, and only while it is still what he read. The estimate of the refill timer
 * (the row remembers the reading it started from, `ownScuBase`) is a calculation, not something he saw: the record then
 * carries no quantity reading. A quantity of UEX is not what the player saw either. The same rule as for what a row of the
 * table saves (`cellEditBase`).
 */
export function knownScuOf(cell: Pick<Cell, 'own' | 'ownScu' | 'ownScuBase'> | null): number | null {
  return cell === null ? null : cellEditBase(cell).scu;
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

/** The one muted line under the form of an income. */
export const INCOME_NOTE = 'Нет в трюме — запишется как доход без закупки';
