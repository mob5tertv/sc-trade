import { estimate } from '../../core/estimate';
import type { EstimateCtx } from '../../core/estimate';
import { formatAge, formatUec } from '../../core/format';
import { priceWarning } from '../../core/input';
import { priceKey } from '../../core/types';
import type { Estimate, Market, Reference, Side, StockEstimate, Temp } from '../../core/types';
import { priceTrend } from './price-trend';
import type { PriceTrend } from './price-trend';

export interface Cell {
  own: number | null; ownScu: number | null;      // my price, shown only while it is not cold; ownScu is only ever MY quantity (0 is a known zero) and has its own clock (spec 14.6), so it may stand next to a UEX price: buy side, the stock estimated for now; sell side, the buyer's inventory as recorded
  ownScuBase: { scu: number; age: string } | null; // 'was 40 · 20 min': what I saw, when the estimate differs from it; null on the sell side (no estimate there)
  ownScuRate: StockEstimate['rateSource'] | null;  // whether the refill rate behind ownScu is learned, the default one or unknown; null without ownScu and on the sell side
  hint: number | null; hintScu: number | null;    // a UEX estimate, or my cold value when UEX has nothing; hintScu is also the UEX quantity next to my price
  badge: { text: string; kind: Temp | 'uex' } | null;
  uexRange: { low: number; high: number } | null; // the UEX range next to my cooling value
  range: { low: number; high: number } | null;    // the range UEX knows for this side (week, else month, else all time), next to my own price or to a UEX one; null when it is flat or unknown
  ownLast: { price: number; age: string } | null; // my cold value kept for reference when the cell fell back to UEX
  trend: PriceTrend | null;                       // how my own price moved since my previous reading; null for a UEX or cold value, a first reading, or the same price
  warn: boolean;                                  // my value looks like a typo against the UEX history
}

export interface TerminalRow { commodityId: number; code: string; name: string; buy: Cell | null; sell: Cell | null }

/**
 * 'моя · 40 мин' for my own price (the kind is its temperature), 'UEX · 2 ч' for a UEX estimate.
 * UEX may have no modification date for the row (`e.ageKnown` is false): there is no age to show, just 'UEX'.
 */
export function badgeText(e: Estimate): { text: string; kind: Temp | 'uex' } {
  if (e.source === 'own' && e.temp !== null) return { text: `моя · ${formatAge(e.ageSec)}`, kind: e.temp };
  return { text: e.ageKnown ? `UEX · ${formatAge(e.ageSec)}` : 'UEX', kind: 'uex' };
}

/** The quantity column of one table row: the number, whose it is, whether it is a calculation, and what it means. */
export interface CellScu { text: string; own: boolean; estimated: boolean; title: string }

/**
 * The quantity a table row shows for the side it is drawn on: the stock at the seller on the buy side, what the buyer
 * already holds on the sell side. My own quantity wins over the UEX one; `estimated` means the refill timer moved it
 * (the expanded row tells from what). `null` when the cell has no quantity.
 */
export function cellScu(cell: Cell | null, side: Side): CellScu | null {
  if (cell === null) return null;
  const value = cell.ownScu ?? cell.hintScu;
  if (value === null) return null;
  const own = cell.ownScu !== null;
  const estimated = own && cell.ownScuBase !== null;
  const where = side === 'buy' ? 'Остаток у продавца' : 'Склад у покупателя';
  return {
    text: formatUec(value), own, estimated,
    title: estimated ? 'Оценка по таймеру пополнения: сколько там сейчас' : `${where} по ${own ? 'твоему замеру' : 'данным UEX'}, SCU`,
  };
}

/** How many rows have each side: what can be bought here (the terminal sells it) and what can be sold here (it buys it). */
export function sideCounts(rows: Array<Pick<TerminalRow, 'buy' | 'sell'>>): { buy: number; sell: number } {
  return { buy: rows.filter(row => row.buy !== null).length, sell: rows.filter(row => row.sell !== null).length };
}

/**
 * My own price as the screens show it: a price that is not cold. A cold one gives way to the UEX price, or stays only
 * as a muted hint when UEX has nothing. The table and the list of trips draw the one in normal text, the other muted.
 */
export const isOwnPrice = (e: Estimate): boolean => e.source === 'own' && e.temp !== 'cold';

/** A flat price or one without bounds is no range. */
const rangeOfUex = (e: Estimate | null): Cell['range'] =>
  e !== null && e.source === 'uex' && e.low > 0 && e.high > e.low ? { low: e.low, high: e.high } : null;

/**
 * The range UEX knows for one side of a terminal, whatever my diary says there. A price of my own has none in its
 * estimate, so the estimate is taken with my diary left out; it picks the period (week, month, all time) exactly as
 * the price does. This is the reference that stands beside my own price in a table and in a list of trips.
 */
export function uexRangeOf(m: Market, terminalId: number, commodityId: number, side: Side, ctx: EstimateCtx): Cell['range'] {
  return rangeOfUex(estimate({ ...m, own: new Map() }, terminalId, commodityId, side, ctx));
}

function cell(m: Market, terminalId: number, commodityId: number, side: Side, ctx: EstimateCtx): Cell | null {
  const e = estimate(m, terminalId, commodityId, side, ctx);
  if (!e) return null;
  const range = e.source === 'uex' ? rangeOfUex(e) : uexRangeOf(m, terminalId, commodityId, side, ctx);
  // The quantity is a reading of its own, apart from the price (spec 14.6): mine whenever `scuOrigin` says so (zero
  // included), even next to a UEX price. On the buy side `e.stock` is its estimate for now; on the sell side it is
  // the buyer's inventory and stays as recorded, with no estimate (spec 14.5). A UEX quantity goes to the grey
  // hint, never to `ownScu`.
  const stock = e.stock;
  const quantity = {
    ownScu: e.scuOrigin === 'own' ? e.scu : null,
    ownScuBase: stock !== null && stock.scu !== stock.baseScu ? { scu: stock.baseScu, age: formatAge(stock.baseAgeSec) } : null,
    ownScuRate: stock?.rateSource ?? null,
    hintScu: e.scuOrigin === 'uex' ? e.scu : null,
  };
  if (isOwnPrice(e)) {
    const row = m.uex.get(priceKey(terminalId, commodityId));
    return {
      own: e.price, ...quantity, hint: null,
      badge: badgeText(e), uexRange: e.uexRange, range, ownLast: null, trend: priceTrend(e, side),
      warn: row ? priceWarning(e.price, row[side].min, row[side].max) : false,
    };
  }
  return {
    own: null, ...quantity, hint: e.price,
    badge: badgeText(e), uexRange: null, range,
    ownLast: e.ownLast && { price: e.ownLast.price, age: formatAge(e.ownLast.ageSec) },
    trend: null,
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
