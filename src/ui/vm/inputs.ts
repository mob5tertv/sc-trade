import { parsePrice, parseScu } from '../../core/input';
import { shownPrice } from './terminal-rows';
import type { Cell } from './terminal-rows';

// What the typed texts of the price and quantity inputs mean. The components only show the outcome.

/**
 * The numbers the two inputs of a cell start with; `null` is an empty input. `priceIsOwn` says whose the price in the
 * input is: mine (a price I saw and that is not cold), or the one of UEX (or my cold one kept as a hint), which the row
 * shows and I have not confirmed yet.
 */
export interface EditBase { price: number | null; scu: number | null; priceIsOwn: boolean }

/**
 * What the inputs of a cell show before anything is typed: the price the row shows (mine, else the hint of UEX or my
 * cold one, so that it can be corrected instead of typed over) and my own quantity. A quantity of UEX is only a
 * placeholder. A stock estimated for now is shown as text next to an empty input: it is a calculation, not something I
 * saw, so it must never be saved as if I had typed it.
 *
 * The price is `shownPrice`: the whole number the row writes, so the field agrees with the row and never holds what the typed
 * path (`parsePrice`) would refuse. A price that rounds to zero is no price here: nothing can be confirmed, the price is required.
 */
export function cellEditBase(cell: Pick<Cell, 'own' | 'hint' | 'ownScu' | 'ownScuBase'>): EditBase {
  const price = shownPrice(cell);
  return { price, scu: cell.ownScuBase === null ? cell.ownScu : null, priceIsOwn: cell.own !== null && price !== null };
}

/** The texts of the inputs for a base: plain digits (no grouping, so they are easy to edit), empty for unknown. */
export function baseTexts(base: EditBase): { price: string; scu: string } {
  return { price: base.price === null ? '' : String(base.price), scu: base.scu === null ? '' : String(base.scu) };
}

export type CellEdit =
  | { kind: 'unchanged' }
  | { kind: 'invalid'; price: boolean; scu: boolean }                 // which of the inputs to mark
  | { kind: 'save'; price: number; scu: number | null };

/** What was typed into the inputs of a cell during one edit; `null` is a field that was not touched. */
export interface TypedTexts { price: string | null; scu: string | null }

interface Field { ok: boolean; value: number | null }

/** An empty text is a valid "nothing"; anything else must parse. */
function field(text: string, parse: (s: string) => number | null): Field {
  if (text.trim() === '') return { ok: true, value: null };
  const value = parse(text);
  return { ok: value !== null, value };
}

/**
 * How an edit of a cell ends: the focus goes elsewhere (`leave`), or Enter is pressed (`enter`: "I see this now", spec
 * 14.13).
 */
export type CellFinish = 'leave' | 'enter';

/**
 * The outcome of ending an edit of a cell. `base` is what the cell holds now, read when the edit ends, not when the
 * typing began. Only what was typed counts as typed:
 *  - the price saved is the typed one, else the one that stands in the input (mine, or the one of UEX that the row shows:
 *    a quantity can be saved alone, with that price). With no price at all (a row without one) nothing is saved and the
 *    price is marked as required, as is an unparsable or emptied one;
 *  - the quantity saved is the typed one, or `null` for "no quantity reading in this observation": the
 *    quantity that merely stands in the input is never sent again, and an emptied one is no reading either;
 *  - leaving the cell saves only what changed: a typed price equal to my own price, or a quantity equal to the one in the
 *    input, is nothing new. A typed price equal to the one of UEX is not nothing: the player confirmed it;
 *  - Enter saves what stands in the fields although nothing changed (nothing typed at all, or my own price retyped): a
 *    price of UEX becomes mine, a price of mine is refreshed.
 */
export function resolveCellEdit(typed: TypedTexts, base: EditBase, finish: CellFinish = 'leave'): CellEdit {
  const price = typed.price === null ? null : field(typed.price, parsePrice);
  const scu = typed.scu === null ? null : field(typed.scu, parseScu);
  const badPrice = price !== null && !price.ok;
  const badScu = scu !== null && !scu.ok;

  // an emptied price over no price is nothing; a typed price over one that is not mine is a confirmation, not nothing
  const priceSame = price === null || (price.ok && price.value === base.price && (base.priceIsOwn || base.price === null));
  const scuSame = scu === null || (scu.ok && (scu.value === null || scu.value === base.scu));
  if (finish === 'leave' && !badPrice && !badScu && priceSame && scuSame) return { kind: 'unchanged' };

  const priceToSave = price === null ? base.price : price.value;
  if (badPrice || badScu || priceToSave === null) return { kind: 'invalid', price: badPrice || priceToSave === null, scu: badScu };
  return { kind: 'save', price: priceToSave, scu: scu?.value ?? null };
}

/**
 * Which fields of a refused entry were refused, for the log: their names, never what was typed (a wrong number is the
 * player's mistake and tells nothing; which field it was is what the line is for).
 */
export function rejectedFields(flags: { price: boolean; scu: boolean }): Array<'price' | 'scu'> {
  const fields: Array<'price' | 'scu'> = [];
  if (flags.price) fields.push('price');
  if (flags.scu) fields.push('scu');
  return fields;
}

export type TradeInput = { ok: true; scu: number; price: number } | { ok: false; scu: boolean; price: boolean };

/** A trade moves at least one SCU at a price above zero; the flags tell which of the inputs to mark. */
export function resolveTrade(scuText: string, priceText: string): TradeInput {
  const scu = parseScu(scuText);
  const price = parsePrice(priceText);
  if (scu === null || scu === 0 || price === null) return { ok: false, scu: scu === null || scu === 0, price: price === null };
  return { ok: true, scu, price };
}
