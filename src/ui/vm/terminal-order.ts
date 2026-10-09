import { formatUec } from '../../core/format';
import type { CargoLine, Side } from '../../core/types';

// The order of the rows of the terminal table. On the sell side the commodities the player carries stand first and wear a
// mark. Pure: the rows are not touched, only the order is made.

/** What the mark of a commodity that is in the hold says: the quantity beside the sign, and in the tooltip what it was bought for. */
export interface HoldMark { text: string; title: string }

export function holdMark(line: CargoLine): HoldMark {
  const scu = formatUec(line.scu);
  return { text: scu, title: `В трюме ${scu} SCU, куплено по ${formatUec(line.avgBuyPrice)}` };
}

/**
 * The cargo of the hold by commodity, in the order of the cargo. Only the sell side has it: a commodity in the hold is
 * a commodity that can be sold here. On the buy side, and with nothing in the hold, it is empty.
 */
export function holdOf(side: Side, cargo: readonly CargoLine[]): Map<number, CargoLine> {
  return side === 'sell' ? new Map(cargo.map((line) => [line.commodityId, line])) : new Map();
}

export interface OrderOptions {
  side: Side;
  cargo: readonly CargoLine[];
}

/**
 * The rows in the order to show: the commodities of the hold (sell side only) first, in the order of the cargo, the others
 * as they came. Returns a new list of the same rows.
 */
export function orderRows<T extends { commodityId: number }>(rows: readonly T[], options: OrderOptions): T[] {
  const { side, cargo } = options;
  const heldAt = new Map<number, number>();
  if (side === 'sell') cargo.forEach((line, at) => heldAt.set(line.commodityId, at));
  return rows
    .map((row, index) => ({ row, index, held: heldAt.get(row.commodityId) ?? null }))
    .sort((x, y) => {
      if (x.held !== null && y.held !== null) return x.held - y.held;
      if (x.held !== null || y.held !== null) return x.held === null ? 1 : -1;
      return x.index - y.index;
    })
    .map(({ row }) => row);
}
