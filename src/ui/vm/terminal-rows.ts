import { estimate } from '../../core/estimate';
import type { EstimateCtx } from '../../core/estimate';
import { formatAge } from '../../core/format';
import { priceWarning } from '../../core/input';
import { obsKey, priceKey } from '../../core/types';
import type { Estimate, Market, Reference, Side, Temp } from '../../core/types';

export interface Cell {
  own: number | null; ownScu: number | null;      // my value, shown only while it is not cold; ownScu is only ever MY quantity
  hint: number | null; hintScu: number | null;    // a UEX estimate, or my cold value when UEX has nothing; hintScu is also the UEX quantity next to my price
  badge: { text: string; kind: Temp | 'uex' } | null;
  uexRange: { low: number; high: number } | null; // the UEX range next to my cooling value
  ownLast: { price: number; age: string } | null; // my cold value kept for reference when the cell fell back to UEX
  warn: boolean;                                  // my value looks like a typo against the UEX history
}

export interface TerminalRow { commodityId: number; code: string; name: string; buy: Cell | null; sell: Cell | null }

/**
 * 'моя · 40 мин' for my own price (the kind is its temperature), 'UEX · 2 ч' for a UEX estimate.
 * Pass `uexAgeKnown = false` when UEX has no modification date for the row: the age is then left out ('UEX').
 */
export function badgeText(e: Estimate, uexAgeKnown = true): { text: string; kind: Temp | 'uex' } {
  if (e.source === 'own' && e.temp !== null) return { text: `моя · ${formatAge(e.ageSec)}`, kind: e.temp };
  return { text: uexAgeKnown ? `UEX · ${formatAge(e.ageSec)}` : 'UEX', kind: 'uex' };
}

/** Zero and a missing value both mean "unknown" for a quantity. */
const knownScu = (scu: number | null | undefined): number | null => (scu !== undefined && scu !== null && scu > 0 ? scu : null);

function cell(m: Market, terminalId: number, commodityId: number, side: Side, ctx: EstimateCtx): Cell | null {
  const e = estimate(m, terminalId, commodityId, side, ctx);
  if (!e) return null;
  const row = m.uex.get(priceKey(terminalId, commodityId));
  if (e.source === 'own' && e.temp !== 'cold') {
    // `e.scu` falls back to the UEX quantity when my observation has none: that goes to the grey hint, never to `ownScu`.
    const ownScu = knownScu(m.own.get(obsKey(terminalId, commodityId, side))?.scu);
    return {
      own: e.price, ownScu, hint: null, hintScu: ownScu === null ? e.scu : null,
      badge: badgeText(e), uexRange: e.uexRange, ownLast: null,
      warn: row ? priceWarning(e.price, row[side].min, row[side].max) : false,
    };
  }
  return {
    own: null, ownScu: null, hint: e.price, hintScu: e.scu,
    badge: badgeText(e, row !== undefined && row.dateModified > 0), uexRange: null,
    ownLast: e.ownLast && { price: e.ownLast.price, age: formatAge(e.ownLast.ageSec) },
    warn: false,
  };
}

/**
 * The rows of the "Terminal" table: every commodity the terminal is known to trade, from UEX or from
 * my diary, by commodity name. A side has a cell only when a price can be estimated for it, and a
 * commodity with no cell on either side has no row. Commodities missing from the reference
 * (say, removed by a game patch) are skipped.
 */
export function terminalRows(m: Market, ref: Reference, terminalId: number, ctx: EstimateCtx): TerminalRow[] {
  const rows: TerminalRow[] = [];
  for (const commodityId of m.byTerminal.get(terminalId) ?? []) {
    const commodity = ref.commodities.get(commodityId);
    if (!commodity) continue;
    const buy = cell(m, terminalId, commodityId, 'buy', ctx);
    const sell = cell(m, terminalId, commodityId, 'sell', ctx);
    if (!buy && !sell) continue;
    rows.push({ commodityId, code: commodity.code, name: commodity.name, buy, sell });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.commodityId - b.commodityId);
}
