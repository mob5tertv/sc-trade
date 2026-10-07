import { parsePrice, parseScu } from '../../core/input';
import type { Side } from '../../core/types';
import type { TerminalRow } from './terminal-rows';

// What the quick entry line of the Terminal tab decides: the side it starts with and what its texts mean.

/**
 * The side the quick entry starts with for a commodity, from its row of the viewed terminal: the side the terminal
 * trades it on. A terminal that sells it (a buy cell) is bought from; one that only buys it (a sell cell) is sold to.
 * A commodity traded both ways, or not at all, starts as "buy".
 */
export function defaultSide(row: Pick<TerminalRow, 'buy' | 'sell'> | undefined): Side {
  return row !== undefined && row.sell !== null && row.buy === null ? 'sell' : 'buy';
}

export type QuickEntryInput = { ok: true; price: number; scu: number | null } | { ok: false; price: boolean; scu: boolean };

/**
 * The price is required; the quantity is optional, so an empty one is "no quantity reading in this observation".
 * A quantity that is typed but is not a number is an error like a bad price: nothing is saved, and the flags
 * tell which of the two fields to mark.
 */
export function resolveQuickEntry(priceText: string, scuText: string): QuickEntryInput {
  const price = parsePrice(priceText);
  const scuTyped = scuText.trim() !== '';
  const scu = scuTyped ? parseScu(scuText) : null;
  const badScu = scuTyped && scu === null;
  if (price === null || badScu) return { ok: false, price: price === null, scu: badScu };
  return { ok: true, price, scu };
}
