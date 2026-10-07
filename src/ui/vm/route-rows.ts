import { formatCompact, formatDuration, formatPct, formatUec } from '../../core/format';
import type { RouteOption } from '../../core/routes';
import type { SellAlternative, SellHere } from '../../core/sell';
import { pairKey } from '../../core/types';
import type { Estimate, Reference, Side, Temp } from '../../core/types';
import { lookupTarget } from './lookup';
import { priceTrend } from './price-trend';
import type { PriceTrend } from './price-trend';
import { roiTier } from './roi-tier';
import type { RoiTier } from './roi-tier';
import { badgeText } from './terminal-rows';

// Display rows of the route suggestions and of the "sell here or fly on" block. Every number is already formatted.

/** Shown instead of a value that does not exist. */
const NONE = '—';

/** Which end of a suggested trip is named: the destination for trips that start here, the origin for trips that end here. */
export type RouteMode = 'from' | 'to';

// A terminal is known by its nickname; UEX leaves it empty on rare rows. What the reference lacks is shown by id.
function terminalLabel(ref: Reference, id: number): string {
  const t = ref.terminals.get(id);
  return (t && (t.nickname || t.displayname || t.name)) || `#${id}`;
}

const commodityLabel = (ref: Reference, id: number): string => ref.commodities.get(id)?.code || `#${id}`;

/** '518k/ч'; the dash when there is no rate. */
const perHour = (uec: number | null): string => (uec === null ? NONE : `${formatCompact(uec)}/ч`);

/** '518k' for the column of a list whose caption says "UEC/ч"; the dash when there is no rate. */
const perHourBare = (uec: number | null): string => (uec === null ? NONE : formatCompact(uec));

/**
 * The ROI of an option as the player reads it, in percents: whole, but with one decimal below 10% when the decimal is
 * not zero (2,5 and 9, not 9,04). The rounding to ten (9,96 is 10) is made before the decision, so '10,0%' never shows.
 * `null` when the ratio is not a number. The colour of the row is taken from this number, not from the raw ratio.
 */
function shownPercent(ratio: number): number | null {
  if (!Number.isFinite(ratio)) return null;
  const percent = ratio * 100;
  const tenth = Math.round(percent * 10) / 10;
  if (Math.abs(tenth) < 10 && !Number.isInteger(tenth)) return tenth;
  return Math.round(percent) || 0; // never a negative zero
}

/** '42%', '-4%', '2,5%'; the dash for a ratio that is not a number. */
export function formatRoi(ratio: number): string {
  const percent = shownPercent(ratio);
  return percent === null ? NONE : `${String(percent).replace('.', ',')}%`;
}

/** The tier of the ROI that is shown (29,96% reads 30% and is coloured as 30%); a dash is the quiet tier. */
function shownTier(ratio: number): RoiTier {
  const percent = shownPercent(ratio);
  return percent === null ? 'poor' : roiTier(percent / 100);
}

/** '59 Гм', '59,4 Гм', '0,12 Гм' (one decimal from one gigametre up, two below); the dash when unknown. */
export function formatDistance(gm: number | null): string {
  if (gm === null) return NONE;
  const rounded = gm >= 1 ? Math.round(gm * 10) / 10 : Math.round(gm * 100) / 100;
  return `${String(rounded).replace('.', ',')} Гм`;
}

/**
 * A price with the range it was estimated in (only when there is one) and the badge of its source and age.
 * The badge text is `badgeText(e)` as it is, so a UEX price of unknown age is just 'UEX'.
 */
export interface PriceView { price: string; range: string | null; badge: { text: string; kind: Temp | 'uex' } }

/** The range UEX knows for a side of a terminal (`uexRangeOf` of terminal-rows, with the market bound to it). */
export type UexRangeOf = (terminalId: number, commodityId: number, side: Side) => { low: number; high: number } | null;

const rangeText = (r: { low: number; high: number }): string => `${formatUec(r.low)}–${formatUec(r.high)}`;

/**
 * The range of a UEX price is its own (low to high); beside a price of mine it is the reference UEX knows for the
 * place, asked for only then.
 */
function priceView(e: Estimate, uexRange: () => { low: number; high: number } | null = () => null): PriceView {
  const range = e.source === 'uex' ? (e.low !== e.high ? { low: e.low, high: e.high } : null) : uexRange();
  return { price: formatUec(e.price), range: range === null ? null : rangeText(range), badge: badgeText(e) };
}

export interface RouteOptionRow {
  key: string;
  /** The other end of the trip, by `mode`. */
  terminal: string;
  /** Both ends in trip order, whatever the mode: where it is bought and where it is sold. */
  origin: string; dest: string;
  /**
   * The row has to name both ends: the player's own end of the trip (the purchase terminal for trips from here, the
   * sale terminal for trips to here) is not the viewed terminal, say a trip that starts at another terminal of the
   * planet. Without a viewed terminal to compare with, every row names both.
   */
  bothEnds: boolean;
  /** The other end is the current target, the terminal the "Цель" button of this row would set. */
  isTarget: boolean;
  /** How good the trip is by its ROI: the colour of the bar at the edge of the row and of the ROI number. */
  tier: RoiTier;
  commodity: string;
  distance: string;
  /** The time of the whole trip; the dash when it is unknown. */
  time: string;
  /** Where the time comes from; `null` when there is no time. */
  timeTitle: string | null;
  /** How many runs of this very pair I have made; 0 when none. */
  runs: number;
  /** The price at the other end: the sale price at the destination for trips from here, the purchase price at the origin for trips to here. */
  price: PriceView;
  /** How that price moved since my previous reading of it (a sale price for trips from here, a purchase price for trips to here); `null` for no triangle. */
  trend: PriceTrend | null;
  /** `roi` in whole percents (`formatRoi`); `rate` without its unit, the caption of the column says "UEC/ч". */
  roi: string; rate: string;
  /** The profit at the unfavourable end of both price ranges, and whether it is a loss. */
  worst: string; worstLoss: boolean;
  qty: string;
  /** For the expanded row: the money put in, the profit expected, and the prices at both ends. */
  invested: string; profit: string; profitLoss: boolean;
  buy: PriceView; sell: PriceView;
}

/**
 * What the rows are compared with: the viewed terminal (without one every row names both ends of its trip), the
 * current target of the trip, and where to ask for the UEX range that stands beside a price of mine.
 */
export interface RouteMarks { anchorTerminalId?: number | null; targetTerminalId?: number | null; uexRange?: UexRangeOf }

/** 'по твоим рейсам', 'оценка по расстоянию · пустой перелёт 4:10'; `null` without a time. */
function timeTitle(o: RouteOption): string | null {
  if (o.timeSec === null || o.timeSource === null) return null;
  const source = o.timeSource === 'own' ? 'по твоим рейсам' : 'оценка по расстоянию';
  return o.emptyLegSec > 0 ? `${source} · пустой перелёт ${formatDuration(o.emptyLegSec)}` : source;
}

/** `runCounts` is keyed with `pairKey(originId, destId)`; `marks` tells which terminal is viewed and which is the target. */
export function routeOptionRow(
  o: RouteOption, ref: Reference, mode: RouteMode, runCounts: Map<string, number>, marks: RouteMarks = {},
): RouteOptionRow {
  const from = mode === 'from';
  const { anchorTerminalId = null, targetTerminalId = null, uexRange } = marks;
  const ownEndId = from ? o.originId : o.destId;
  const buyView = priceView(o.buy, () => uexRange?.(o.originId, o.commodityId, 'buy') ?? null);
  const sellView = priceView(o.sell, () => uexRange?.(o.destId, o.commodityId, 'sell') ?? null);
  return {
    key: `${pairKey(o.originId, o.destId)}:${o.commodityId}`,
    terminal: terminalLabel(ref, from ? o.destId : o.originId),
    origin: terminalLabel(ref, o.originId),
    dest: terminalLabel(ref, o.destId),
    bothEnds: anchorTerminalId === null || ownEndId !== anchorTerminalId,
    isTarget: targetTerminalId !== null && lookupTarget(o, mode) === targetTerminalId,
    tier: shownTier(o.roi),
    commodity: commodityLabel(ref, o.commodityId),
    distance: formatDistance(o.distanceGm),
    time: o.timeSec === null ? NONE : formatDuration(o.timeSec),
    timeTitle: timeTitle(o),
    runs: runCounts.get(pairKey(o.originId, o.destId)) ?? 0,
    price: from ? sellView : buyView,
    trend: from ? priceTrend(o.sell, 'sell') : priceTrend(o.buy, 'buy'),
    roi: formatRoi(o.roi), rate: perHourBare(o.uecPerHour),
    worst: formatUec(o.worstProfit), worstLoss: o.worstProfit < 0,
    qty: `${o.qty} SCU`,
    invested: formatUec(o.qty * o.buy.price), profit: formatUec(o.profit), profitLoss: o.profit < 0,
    buy: buyView, sell: sellView,
  };
}

export interface SellHereRow { qty: string; profit: string; loss: boolean; roi: string; rate: string }

/** Selling the whole cargo line at the terminal where the player stands. */
export function sellHereRow(h: SellHere): SellHereRow {
  return { qty: `${h.qty} SCU`, profit: formatUec(h.profit), loss: h.profit < 0, roi: formatPct(h.roi), rate: perHour(h.uecPerHour) };
}

export interface SellAlternativeRow {
  key: string; terminal: string; price: PriceView;
  profit: string; loss: boolean;
  expectedRate: string; worstRate: string;
  /** The extra flight; the dash when it is unknown. */
  extra: string;
}

export function sellAlternativeRow(a: SellAlternative, ref: Reference): SellAlternativeRow {
  return {
    key: String(a.destId),
    terminal: terminalLabel(ref, a.destId),
    price: priceView(a.sell),
    profit: formatUec(a.expectedProfit), loss: a.expectedProfit < 0,
    expectedRate: perHour(a.expectedUecPerHour), worstRate: perHour(a.worstUecPerHour),
    extra: a.extraSec === null ? NONE : formatDuration(a.extraSec),
  };
}
