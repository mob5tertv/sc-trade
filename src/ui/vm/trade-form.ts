import { quantity } from '../../core/routes';
import { cargoOf } from '../../core/run';
import type { CargoLine, RunWithEvents, Side } from '../../core/types';
import type { Cell } from './terminal-rows';

// What the trade form under a table row starts with, and when "Продал" has nothing to sell. Pure: the form is
// drawn by `TradeDialog`, the owner is `TerminalSection`.

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
 * The quantity the player sees at the terminal before the trade, as it goes into the record (`knownScu`): the quantity of
 * my own the row shows, a known zero included. A quantity of UEX is not what the player saw, so it is not taken.
 */
export function knownScuOf(cell: Pick<Cell, 'ownScu'> | null): number | null {
  return cell?.ownScu ?? null;
}

/** Why "Продал" has nothing to open, in a sentence; `null` when it has. A purchase always has: the first one starts the run. */
export function tradeRefusal(side: Side, active: RunWithEvents | null, commodityId: number): string | null {
  if (side === 'buy') return null;
  if (active === null) return 'Нет активного рейса';
  return cargoOf(active.events).some((line) => line.commodityId === commodityId) ? null : 'Этого товара нет в трюме';
}
