import { formatUec } from '../../core/format';
import { routesFrom, routesTo } from '../../core/routes';
import type { RouteCtx, RouteOption } from '../../core/routes';
import type { Market, Reference, Side } from '../../core/types';
import type { RoiTier } from './roi-tier';
import { formatRoi, narrowCompact, shownPercent, shownTier } from './route-rows';
import { terminalLabel } from './terminal-name';

// The profit of a row of the terminal table (spec 14.10): for each commodity of the viewed terminal, the best ROI there is
// with it AND the most a trip with it brings (plan item 17: a cheap commodity with a fine percentage stood above one that
// brings three times the money, and the table could not say so). The two are counted apart, each the best of its own kind. On the side "продать здесь" that is the best way to buy the commodity somewhere and bring it here
// (`routesTo`), on the side "купить здесь" the best way to buy it here and take it somewhere (`routesFrom`). It is the
// search of the options (same market, same filters of the system, the budget, the free space and the stock), counted
// without the limit on the number of options and grouped by commodity. Nothing here reads the distances or asks UEX:
// the ROI of a trip does not depend on them.

/** The best trip of one commodity at the viewed terminal. */
export interface RowRoi {
  commodityId: number;
  /** Profit over the purchase price, a ratio (0.5 is 50 %). */
  roi: number;
  /**
   * The most a trip with the commodity brings (the quantity that the free hold, the stock at the purchase terminal and the budget
   * allow, times the margin), that quantity, and the other end of THAT trip. It may be another trip than the one of the best ROI:
   * on the side "продать здесь" the cheapest seller may have little stock. On the side "купить здесь" it is always the same one
   * (one purchase price and one quantity: the dearest buyer wins by both).
   */
  profit: number; qty: number; profitOtherId: number;
  /** The other end of the trip: the terminal the commodity comes from (side "sell"), or the one it goes to (side "buy"). */
  otherId: number;
  buyPrice: number;
  sellPrice: number;
}

/** No limit on the number of options: the best of each commodity must not be cut off by the `topN` of the settings. */
const NO_LIMIT = Number.MAX_SAFE_INTEGER;

const otherEnd = (option: RouteOption, side: Side): number => (side === 'sell' ? option.originId : option.destId);

/** The better of two trips of one commodity: the higher ROI, then the bigger profit, then the lower terminal id (so a tie is the same every time). */
function betterTrip(a: RouteOption, b: RouteOption, side: Side): boolean {
  if (a.roi !== b.roi) return a.roi > b.roi;
  if (a.profit !== b.profit) return a.profit > b.profit;
  return otherEnd(a, side) < otherEnd(b, side);
}

/** The richer of two trips of one commodity: the bigger profit, then the higher ROI, then the lower terminal id. */
function richerTrip(a: RouteOption, b: RouteOption, side: Side): boolean {
  if (a.profit !== b.profit) return a.profit > b.profit;
  if (a.roi !== b.roi) return a.roi > b.roi;
  return otherEnd(a, side) < otherEnd(b, side);
}

/**
 * The best ROI of every commodity of the terminal that has a trip: by commodity id. `side` is the side of the TABLE:
 * "sell" is what the terminal buys (trips that end here), "buy" is what it sells (trips that start here). A commodity
 * with no trip that pays, none that fits the filters or none with stock has no entry.
 */
export function rowRoiMap(m: Market, terminalId: number, side: Side, ctx: RouteCtx): Map<number, RowRoi> {
  const unlimited: RouteCtx = { ...ctx, settings: { ...ctx.settings, topN: NO_LIMIT } };
  const { options } = side === 'sell' ? routesTo(m, terminalId, unlimited) : routesFrom(m, [terminalId], terminalId, unlimited);
  const best = new Map<number, RouteOption>();
  const rich = new Map<number, RouteOption>();
  for (const option of options) {
    const known = best.get(option.commodityId);
    if (known === undefined || betterTrip(option, known, side)) best.set(option.commodityId, option);
    const richest = rich.get(option.commodityId);
    if (richest === undefined || richerTrip(option, richest, side)) rich.set(option.commodityId, option);
  }
  const map = new Map<number, RowRoi>();
  for (const [commodityId, option] of best) {
    const richest = rich.get(commodityId) ?? option;
    map.set(commodityId, {
      commodityId, roi: option.roi, otherId: otherEnd(option, side), buyPrice: option.buy.price, sellPrice: option.sell.price,
      profit: richest.profit, qty: richest.qty, profitOtherId: otherEnd(richest, side),
    });
  }
  return map;
}

/**
 * Whether a row stands out: its ROI, as it is SHOWN (49,96 % reads 50 %), is at or above the threshold. A ratio that is
 * not a number, and a threshold that is not a number, never stand out.
 */
export function isHot(roi: number, thresholdPct: number): boolean {
  const shown = shownPercent(roi);
  return shown !== null && shown >= thresholdPct;
}

/**
 * How a row stands out while the table is NOT read by the ROI (the author, 14.10.2026: "the bar by the profit, or by what we are
 * looking at"): by what its best trip brings against the best of the table. `great`: at least three quarters of it; `good`: at
 * least half; `null`: less, or nothing in the table brings anything. Sorted by the ROI, the table keeps the threshold of the
 * settings («Выделять ROI от»): the bar then says what the order says.
 */
export type ProfitMark = 'great' | 'good' | null;
export function profitMark(profit: number, best: number): ProfitMark {
  if (!(best > 0) || !(profit > 0)) return null;
  const share = profit / best;
  return share >= 0.75 ? 'great' : share >= 0.5 ? 'good' : null;
}

/** What a row of the table says about its best trip. */
export interface RoiCell {
  /** '62%', '2,5%': the number as the list of options writes it. */
  text: string;
  /** The same number in whole percents as the table shows it (`shownPercent`; 1699 for what is written «999+»); `null` for a ratio that is not a number. The table is ordered by it. */
  percent: number | null;
  /** The tier of the number that is shown; the number and the bar are coloured by it. */
  tier: RoiTier;
  /** At or above the threshold: the row stands out with a bar at its edge. */
  hot: boolean;
  /** The most a trip with the commodity brings, as the narrow column writes it ('438k'), and the number the table is ordered by. */
  gain: string; profit: number;
  /** Where the best trip goes or comes from and what it pays, and what a click does. */
  title: string;
}

/**
 * The most percent the narrow column of the table writes whole. A ROI above it is the sign of a price typed with a slip
 * (the row says so with its `!` too), and a number must never be cut: it reads «999+», the tooltip has the real one.
 */
const MAX_SHOWN_PERCENT = 999;

export function roiCell(best: RowRoi, side: Side, ref: Reference, thresholdPct: number): RoiCell {
  const way = side === 'sell' ? 'из' : 'в';
  const where = `${way} ${terminalLabel(ref, best.otherId)}`;
  // the trip that brings the most is named only when it is another one than the trip of the best ROI
  const richest = best.profitOtherId === best.otherId ? '' : `, ${way} ${terminalLabel(ref, best.profitOtherId)}`;
  const percent = shownPercent(best.roi);
  const capped = percent !== null && percent > MAX_SHOWN_PERCENT;
  return {
    text: capped ? `${MAX_SHOWN_PERCENT}+` : formatRoi(best.roi),
    percent,
    tier: shownTier(best.roi),
    hot: isHot(best.roi, thresholdPct),
    gain: narrowCompact(best.profit), profit: best.profit,
    title: `${capped ? `ROI ${formatRoi(best.roi)} · ` : ''}${where} · ${formatUec(best.buyPrice)} → ${formatUec(best.sellPrice)}\n`
      + `Больше всего за рейс: ${formatUec(best.profit)} (${best.qty} SCU${richest})\nНажми, чтобы открыть варианты`,
  };
}

/** The cells of every row that has a value, by commodity id. */
export function roiCells(map: ReadonlyMap<number, RowRoi>, side: Side, ref: Reference, thresholdPct: number): Map<number, RoiCell> {
  const cells = new Map<number, RoiCell>();
  for (const [commodityId, best] of map) cells.set(commodityId, roiCell(best, side, ref, thresholdPct));
  return cells;
}

/** The ROI of the rows of one table at one moment: the table is the viewed terminal and a side of it. */
export interface RoiSnapshot {
  terminalId: number | null;
  side: Side;
  roi: ReadonlyMap<number, { roi: number }>;
}

/**
 * The rows that crossed the threshold between two moments of the SAME table: they were below it (or had no value) and
 * are at or above it now. The owner asks it around the entry of a price, so these are the rows that the price made
 * worth a look. Another terminal or another side is a table that was opened, not a price that was entered: nothing
 * crosses there, and nothing crosses when there was no table before.
 */
export function crossedRows(before: RoiSnapshot | null, after: RoiSnapshot, thresholdPct: number): number[] {
  if (before === null || before.terminalId === null || before.terminalId !== after.terminalId || before.side !== after.side) return [];
  const crossed: number[] = [];
  for (const [commodityId, now] of after.roi) {
    if (!isHot(now.roi, thresholdPct)) continue;
    const was = before.roi.get(commodityId);
    if (was === undefined || !isHot(was.roi, thresholdPct)) crossed.push(commodityId);
  }
  return crossed;
}
