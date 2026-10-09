import { estimate } from '../../core/estimate';
import type { EstimateCtx } from '../../core/estimate';
import { formatAge, formatUec } from '../../core/format';
import { priceWarning } from '../../core/input';
import { priceKey } from '../../core/types';
import type { Estimate, Market, Reference, Side, StockEstimate, Temp } from '../../core/types';
import { priceTrend } from './price-trend';
import type { PriceTrend } from './price-trend';

/**
 * What UEX says about how far the price of one side of a terminal moved: it moved between two numbers (`spread`), it did
 * not move and UEX knows one price (`flat`: the same number as minimum and maximum), or there is nothing to draw. Of
 * the two kinds of nothing, `no-bounds` is a UEX price without usable bounds (an average, and minimum and maximum
 * zero) and `none` is no UEX price for the side at all; both are a dash, but the tooltip must not say that UEX knows no
 * price while the price column shows one. `flat` is not `none`: a column of dashes reads as "nothing was loaded".
 */
export type UexRange =
  | { kind: 'spread'; low: number; high: number }
  | { kind: 'flat'; price: number }
  | { kind: 'no-bounds' }
  | { kind: 'none' };

export const NO_RANGE: UexRange = { kind: 'none' };
const NO_BOUNDS: UexRange = { kind: 'no-bounds' };

export interface Cell {
  own: number | null; ownScu: number | null;      // my price, shown only while it is not cold; ownScu is only ever MY quantity (0 is a known zero) and has its own clock (spec 14.6), so it may stand next to a UEX price: buy side, the stock estimated for now; sell side, the buyer's inventory as recorded
  ownScuBase: { scu: number; age: string } | null; // 'was 40 · 20 min': what I saw, when the estimate differs from it; null on the sell side (no estimate there)
  ownScuRate: StockEstimate['rateSource'] | null;  // whether the refill rate behind ownScu is learned, the default one or unknown; null without ownScu and on the sell side
  hint: number | null; hintScu: number | null;    // a UEX estimate, or my cold value when UEX has nothing; hintScu is also the UEX quantity next to my price
  badge: { text: string; kind: Temp | 'uex' } | null;
  uexRange: { low: number; high: number } | null; // the UEX range next to my cooling value
  range: UexRange;                                // what UEX knows about the spread of this side (week, else month, else all time), next to my own price or to a UEX one
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

/**
 * The tooltip of the dash in the quantity column: there is no quantity because nobody knows it, which is not an empty stock
 * (a known zero is written 0). On the sell side the number is what the buyer already holds. «Свежего»: the estimate does not use a
 * reading of mine that has gone cold (see `estimate` of the core), so a cold one leaves the dash as well.
 */
export function unknownScuTitle(side: Side): string {
  return `${side === 'buy' ? 'Запас' : 'Склад у покупателя'} неизвестен: нет свежего своего замера и нет данных UEX`;
}

/**
 * The price a cell offers to be corrected or confirmed: the whole number the row writes (`formatUec` rounds with `Math.round`;
 * UEX averages are REAL), mine else the hint. It must be what the row shows and what the typed path (`parsePrice`: whole
 * numbers above zero) would take, so a price that rounds to zero is no price: `null`. The fields of an expanded row and the form
 * of a trade both start from it.
 */
export function shownPrice(cell: Pick<Cell, 'own' | 'hint'>): number | null {
  const shown = cell.own ?? cell.hint;
  if (shown === null) return null;
  const whole = Math.round(shown);
  return whole > 0 ? whole : null;
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

/**
 * The range of a UEX estimate: the bounds of the period it was taken from (src/core/estimate.ts: the week, else the
 * month, else all time, else the last report). Different bounds are a spread, the same number is one price. Bounds
 * that are missing (zero), upside down or not numbers are `no-bounds`: UEX has a price, but nothing to say about its
 * spread. Without a UEX estimate (none, or a price of mine, which has no bounds of its own) it is `none`.
 */
export function rangeOfEstimate(e: Estimate | null): UexRange {
  if (e === null || e.source !== 'uex') return NO_RANGE;
  if (!(e.low > 0) || !(e.high >= e.low)) return NO_BOUNDS;
  return e.high > e.low ? { kind: 'spread', low: e.low, high: e.high } : { kind: 'flat', price: e.low };
}

/**
 * The range UEX knows for one side of a terminal, whatever my diary says there. A price of my own has none in its
 * estimate, so the estimate is taken with my diary left out; it picks the period (week, month, all time) exactly as
 * the price does. This is the reference that stands beside my own price in a table and in a list of trips.
 */
export function uexRangeOf(m: Market, terminalId: number, commodityId: number, side: Side, ctx: EstimateCtx): UexRange {
  return rangeOfEstimate(estimate({ ...m, own: new Map() }, terminalId, commodityId, side, ctx));
}

/**
 * The tooltip of the head «Мин–макс»: which period the two numbers are of. The estimate takes the bounds of the week, and only when
 * the week has no price those of the month, then of all time (`priceRange` of the core).
 */
export const RANGE_HEAD_TITLE = 'Минимум и максимум цены по данным UEX за неделю; если за неделю цены нет — за месяц, потом за всё время';

/** The «Мин–макс» cell as it is read: `3 900–4 300`, `= 5 500` or `—` (two kinds of it), and what the tooltip says about it. */
export interface RangeView { kind: UexRange['kind']; text: string; title: string }

export function rangeView(range: UexRange): RangeView {
  switch (range.kind) {
    case 'spread':
      return { kind: 'spread', text: `${formatUec(range.low)}–${formatUec(range.high)}`, title: 'Диапазон цен по данным UEX' };
    case 'flat':
      return { kind: 'flat', text: `= ${formatUec(range.price)}`, title: 'UEX: одна цена за период, разброса нет' };
    case 'no-bounds':
      return { kind: 'no-bounds', text: '—', title: 'UEX не даёт границ цены' };
    case 'none':
      return { kind: 'none', text: '—', title: 'UEX не знает цену' };
  }
}

function cell(m: Market, terminalId: number, commodityId: number, side: Side, ctx: EstimateCtx): Cell | null {
  const e = estimate(m, terminalId, commodityId, side, ctx);
  if (!e) return null;
  const range = e.source === 'uex' ? rangeOfEstimate(e) : uexRangeOf(m, terminalId, commodityId, side, ctx);
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
