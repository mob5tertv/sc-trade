import { parsePrice, parseScu } from '../../core/input';
import type { Cell } from './terminal-rows';

// What the typed texts of the price and quantity inputs mean. The components only show the outcome.

/** The numbers the two inputs of a cell start with; `null` is an empty input. */
export interface EditBase { price: number | null; scu: number | null }

/**
 * What the inputs of a cell show before anything is typed: my own price and my own quantity. A UEX hint or
 * my cold value is only a placeholder. A stock estimated for now is shown as text next to an empty input:
 * it is a calculation, not something I saw, so it must never be saved as if I had typed it.
 */
export function cellEditBase(cell: Pick<Cell, 'own' | 'ownScu' | 'ownScuBase'>): EditBase {
  return { price: cell.own, scu: cell.ownScuBase === null ? cell.ownScu : null };
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
 * The outcome of leaving a cell. `base` is what the cell holds now, read when the cell is left, not when the
 * typing began. Only what was typed counts:
 *  - the price saved is the typed one, else my own current price; with neither (a quantity typed over a hint
 *    or a cold price) nothing is saved and the price is marked as required, as is an unparsable or emptied one;
 *  - the quantity saved is the typed one, or `null` for "no quantity reading in this observation": the
 *    quantity that merely stands in the input is never sent again, and an emptied one is no reading either;
 *  - what was typed equals what is there: nothing to save.
 */
export function resolveCellEdit(typed: TypedTexts, base: EditBase): CellEdit {
  const price = typed.price === null ? null : field(typed.price, parsePrice);
  const scu = typed.scu === null ? null : field(typed.scu, parseScu);
  const badPrice = price !== null && !price.ok;
  const badScu = scu !== null && !scu.ok;

  const priceSame = price === null || price.value === base.price;
  const scuSame = scu === null || (scu.ok && (scu.value === null || scu.value === base.scu));
  if (!badPrice && !badScu && priceSame && scuSame) return { kind: 'unchanged' };

  const priceToSave = price === null ? base.price : price.value;
  if (badPrice || badScu || priceToSave === null) return { kind: 'invalid', price: badPrice || priceToSave === null, scu: badScu };
  return { kind: 'save', price: priceToSave, scu: scu?.value ?? null };
}

export type TradeInput = { ok: true; scu: number; price: number } | { ok: false; scu: boolean; price: boolean };

/** A trade moves at least one SCU at a price above zero; the flags tell which of the inputs to mark. */
export function resolveTrade(scuText: string, priceText: string): TradeInput {
  const scu = parseScu(scuText);
  const price = parsePrice(priceText);
  if (scu === null || scu === 0 || price === null) return { ok: false, scu: scu === null || scu === 0, price: price === null };
  return { ok: true, scu, price };
}
