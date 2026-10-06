import { estimate } from '../../core/estimate';
import type { EstimateCtx } from '../../core/estimate';
import { formatAge } from '../../core/format';
import { priceWarning } from '../../core/input';
import { priceKey } from '../../core/types';
import type { Estimate, Market, Reference, Side, Temp } from '../../core/types';

export interface Cell {
  own: number | null; ownScu: number | null;      // my value, shown only while it is not cold
  hint: number | null; hintScu: number | null;    // a UEX estimate, or my cold value when UEX has nothing
  badge: { text: string; kind: Temp | 'uex' } | null;
  warn: boolean;                                  // my value looks like a typo against the UEX history
}

export interface TerminalRow { commodityId: number; code: string; name: string; buy: Cell | null; sell: Cell | null }

/** 'моя · 40 мин' for my own price (the kind is its temperature), 'UEX' for a UEX estimate. */
export function badgeText(e: Estimate): { text: string; kind: Temp | 'uex' } {
  if (e.source === 'own' && e.temp !== null) return { text: `моя · ${formatAge(e.ageSec)}`, kind: e.temp };
  return { text: 'UEX', kind: 'uex' };
}

function cell(m: Market, terminalId: number, commodityId: number, side: Side, ctx: EstimateCtx): Cell | null {
  const e = estimate(m, terminalId, commodityId, side, ctx);
  if (!e) return null;
  const badge = badgeText(e);
  if (e.source === 'own' && e.temp !== 'cold') {
    const uex = m.uex.get(priceKey(terminalId, commodityId))?.[side];
    return { own: e.price, ownScu: e.scu, hint: null, hintScu: null, badge, warn: uex ? priceWarning(e.price, uex.min, uex.max) : false };
  }
  return { own: null, ownScu: null, hint: e.price, hintScu: e.scu, badge, warn: false };
}

/**
 * The rows of the "Terminal" table: every commodity the terminal is known to trade, from UEX or from
 * my diary, by commodity name. A side has a cell only when a price can be estimated for it.
 * Commodities missing from the reference (say, removed by a game patch) are skipped.
 */
export function terminalRows(m: Market, ref: Reference, terminalId: number, ctx: EstimateCtx): TerminalRow[] {
  const rows: TerminalRow[] = [];
  for (const commodityId of m.byTerminal.get(terminalId) ?? []) {
    const commodity = ref.commodities.get(commodityId);
    if (!commodity) continue;
    rows.push({
      commodityId, code: commodity.code, name: commodity.name,
      buy: cell(m, terminalId, commodityId, 'buy', ctx),
      sell: cell(m, terminalId, commodityId, 'sell', ctx),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.commodityId - b.commodityId);
}
