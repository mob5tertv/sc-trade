const MAX_VALUE = 100_000_000;

// Spaces (including non-breaking), commas and dots are only grouping noise; anything else but digits is rejected.
function parseWholeNumber(input: string): number | null {
  const digits = input.replace(/[\s,.]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return n > MAX_VALUE ? null : n;
}

/** UEC per SCU: a whole number above zero, or null. */
export function parsePrice(input: string): number | null {
  const n = parseWholeNumber(input);
  return n !== null && n > 0 ? n : null;
}

/** SCU amount: a whole number from zero up, or null (an empty string is null too). */
export function parseScu(input: string): number | null {
  return parseWholeNumber(input);
}

/**
 * True when the typed price is under half the UEX historical minimum or over twice the maximum.
 * A zero bound means UEX has no history on that side, so that side never warns.
 */
export function priceWarning(price: number, uexMin: number, uexMax: number): boolean {
  return (uexMin > 0 && price < uexMin / 2) || (uexMax > 0 && price > uexMax * 2);
}
