import type { Side } from '../../core/types';
import { sideCounts, type TerminalRow } from './terminal-rows';

// The "Terminal" section draws one side of the terminal at a time: what can be bought here (`buy`) or what can be
// sold here (`sell`). These are the decisions about which side that is and which row of it is open.

/** A row as far as these decisions go: which sides it has a cell on. */
export type SideRow = Pick<TerminalRow, 'commodityId' | 'buy' | 'sell'>;

/**
 * The side to draw: the one the player asked for while it has rows. When it has none and the other side has, the other
 * one (so a terminal that only buys is never shown as an empty "Купить"); when neither has, the asked one (the table
 * then says it has nothing).
 */
export function resolveTerminalSide(preferred: Side, counts: { buy: number; sell: number }): Side {
  if (counts[preferred] > 0) return preferred;
  const other: Side = preferred === 'buy' ? 'sell' : 'buy';
  return counts[other] > 0 ? other : preferred;
}

/** The side a terminal opens on: "buy", or "sell" when that is the only side that has rows. */
export function defaultTerminalSide(rows: ReadonlyArray<SideRow>): Side {
  return resolveTerminalSide('buy', sideCounts([...rows]));
}

/** The row the player opened: the terminal and the side it was opened on, and the commodity. */
export interface RowPick { terminalId: number | null; side: Side; commodityId: number }

/**
 * The commodity whose row is open now. A pick belongs to the terminal and the side it was made on: it goes away with a
 * change of either (the row of the other side is not the same row, and a row that is open nowhere makes no sense), and
 * with a row that has no cell on the shown side.
 */
export function selectedCommodity(
  pick: RowPick | null, viewedTerminalId: number | null, side: Side, rows: ReadonlyArray<SideRow>,
): number | null {
  if (pick === null || viewedTerminalId === null) return null;
  if (pick.terminalId !== viewedTerminalId || pick.side !== side) return null;
  return rows.some((row) => row.commodityId === pick.commodityId && row[side] !== null) ? pick.commodityId : null;
}
