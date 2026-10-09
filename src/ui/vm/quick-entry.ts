import { parsePrice, parseScu } from '../../core/input';
import type { Side } from '../../core/types';
import type { TerminalRow } from './terminal-rows';

// What the quick entry line of the Terminal tab decides: the side it shows and what its texts mean.

/**
 * The side the switch of the quick entry shows while the player has not picked one by hand, and so the side the price
 * is written to. `row`: the row of the chosen commodity at the viewed terminal (`undefined`: no commodity is chosen yet,
 * or the terminal does not trade it). `shown`: the side of the table of the terminal the player is looking at (the tab).
 *
 * A commodity the terminal trades on one side only goes to that side, whatever the tab: a terminal that only sells it (a
 * buy cell) is bought from, one that only buys it (a sell cell) is sold to. Where the terminal does not say (no commodity
 * yet, traded both ways, not traded at all) the side is the tab: the player enters what he is looking at. It used to be
 * "buy" there, so on «Продать» the empty line showed «Куп.» and a new commodity was written to the other side.
 */
export function defaultSide(row: Pick<TerminalRow, 'buy' | 'sell'> | undefined, shown: Side): Side {
  const sold = row !== undefined && row.buy !== null;
  const bought = row !== undefined && row.sell !== null;
  if (sold === bought) return shown;
  return sold ? 'buy' : 'sell';
}

/** Why Enter wrote nothing: there is nowhere to write to, no commodity, a price or a quantity that cannot be read. */
export const REJECTIONS = ['no-terminal', 'no-commodity', 'bad-price', 'bad-scu'] as const;
export type Rejection = (typeof REJECTIONS)[number];

const REJECTION_TEXT: Record<Rejection, string> = {
  'no-terminal': 'Сначала выбери локацию в шапке окна',
  'no-commodity': 'Выбери товар',
  'bad-price': 'Цена — целое число больше нуля',
  'bad-scu': 'Количество — целое число от нуля',
};

/** What the line says under the quick entry when it refuses: a few words, the reason and what it takes. */
export const rejectionText = (reason: Rejection): string => REJECTION_TEXT[reason];

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
