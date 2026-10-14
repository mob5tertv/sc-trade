import { estimate } from '../../core/estimate';
import type { EstimateCtx } from '../../core/estimate';
import { parsePrice, parseScu } from '../../core/input';
import type { Market, Side } from '../../core/types';
import type { TerminalRow } from './terminal-rows';
import { tr } from '../../i18n';

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

/** Why Enter wrote nothing: there is nowhere to write to, no commodity, a commodity the terminal does not trade on that side, a price or a quantity that cannot be read. */
export const REJECTIONS = ['no-terminal', 'no-commodity', 'not-traded', 'bad-price', 'bad-scu'] as const;
export type Rejection = (typeof REJECTIONS)[number];

const REJECTION_TEXT: Record<Rejection, string> = {
  get 'no-terminal'() { return tr('Сначала выбери локацию в шапке окна'); },
  get 'no-commodity'() { return tr('Выбери товар'); },
  get 'not-traded'() { return tr('Этот товар здесь так не торгуется: выбери другой товар или сторону'); },
  get 'bad-price'() { return tr('Цена — целое число больше нуля'); },
  get 'bad-scu'() { return tr('Количество — целое число от нуля'); },
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

/** Which sides of a commodity a terminal trades: the sides the quick entry may write a price to. */
export interface EntrySides { buy: boolean; sell: boolean }

/**
 * What UEX knows the terminal to trade, side by side: commodity → whether it is sold there (a BUY price) and whether it is
 * bought there (a SELL price). The player's own records are left out on purpose: a price typed in at the wrong station must not
 * make its commodity one of that station's. A commodity UEX has no price for on either side is absent.
 */
export function uexSides(m: Market, terminalId: number, ctx: EstimateCtx): Map<number, EntrySides> {
  const bare: Market = { ...m, own: new Map() };
  const sides = new Map<number, EntrySides>();
  for (const commodityId of m.byTerminal.get(terminalId) ?? []) {
    const buy = estimate(bare, terminalId, commodityId, 'buy', ctx) !== null;
    const sell = estimate(bare, terminalId, commodityId, 'sell', ctx) !== null;
    if (buy || sell) sides.set(commodityId, { buy, sell });
  }
  return sides;
}

/**
 * The commodities the quick entry offers on one side (the author's decisions of 13.10.2026: "do not let any commodity be written
 * to a station that does not trade it", and "the list must follow the chosen category, buy or sell"): on «Куп.» what the terminal
 * sells, on «Прод.» what it buys, by what UEX knows (`uexSides`).
 *
 * The one exception is a terminal UEX knows NOTHING of (`sides` is empty): there every commodity is offered on both sides, or
 * such a station could never be given its first price.
 */
export function entryCommodities<T extends { id: number }>(all: T[], sides: ReadonlyMap<number, EntrySides>, side: Side): T[] {
  if (sides.size === 0) return all;
  return all.filter((c) => sides.get(c.id)?.[side] === true);
}

/**
 * The sides the quick entry may write for a commodity. `null` means "not limited": no commodity is chosen yet, or UEX knows
 * nothing of the terminal. A commodity UEX does not list at a terminal it does know is traded on neither side.
 */
export function entrySides(commodityId: number | null, sides: ReadonlyMap<number, EntrySides>): EntrySides | null {
  if (commodityId === null || sides.size === 0) return null;
  return sides.get(commodityId) ?? { buy: false, sell: false };
}

/**
 * The side a price goes to: the wanted one when the terminal trades the commodity on it, else the side it does trade it on. A
 * commodity the terminal trades on NEITHER side stays on the wanted one: there is no side to move to, and the entry is refused
 * (`mayWrite`).
 */
export function allowedSide(wanted: Side, sides: EntrySides | null): Side {
  if (sides === null || sides[wanted]) return wanted;
  const other: Side = wanted === 'buy' ? 'sell' : 'buy';
  return sides[other] ? other : wanted;
}

/** Whether the quick entry may write a price of a commodity on `side`: the terminal trades it there, or nothing limits the entry. */
export const mayWrite = (side: Side, sides: EntrySides | null): boolean => sides === null || sides[side];
