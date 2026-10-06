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
export function cellEditBase(cell: Cell): EditBase {
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

interface Field { ok: boolean; value: number | null }

/** An empty text is a valid "nothing"; anything else must parse. */
function field(text: string, parse: (s: string) => number | null): Field {
  if (text.trim() === '') return { ok: true, value: null };
  const value = parse(text);
  return { ok: value !== null, value };
}

/**
 * The outcome of leaving a cell: nothing to do when the numbers are those of `base`; the inputs to mark when
 * a text does not parse (or the price is empty: a price cannot be deleted from here, and a quantity typed
 * over a hint needs a price); otherwise the price and quantity to save. An empty quantity is an unknown one.
 */
export function resolveCellEdit(priceText: string, scuText: string, base: EditBase): CellEdit {
  const price = field(priceText, parsePrice);
  const scu = field(scuText, parseScu);
  if (price.ok && scu.ok && price.value === base.price && scu.value === base.scu) return { kind: 'unchanged' };
  if (!price.ok || price.value === null || !scu.ok) return { kind: 'invalid', price: !price.ok || price.value === null, scu: !scu.ok };
  return { kind: 'save', price: price.value, scu: scu.value };
}

export type TradeInput = { ok: true; scu: number; price: number } | { ok: false; scu: boolean; price: boolean };

/** A trade moves at least one SCU at a price above zero; the flags tell which of the inputs to mark. */
export function resolveTrade(scuText: string, priceText: string): TradeInput {
  const scu = parseScu(scuText);
  const price = parsePrice(priceText);
  if (scu === null || scu === 0 || price === null) return { ok: false, scu: scu === null || scu === 0, price: price === null };
  return { ok: true, scu, price };
}
