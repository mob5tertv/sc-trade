import { boxAdvice, boxLine, loadingBar } from '../../core/cargo-fit';
import { formatCompact, formatDuration, formatUec } from '../../core/format';
import { stockKnown } from '../../core/routes';
import type { RouteOption } from '../../core/routes';
import type { SellAlternative, SellHere } from '../../core/sell';
import { pairKey } from '../../core/types';
import type { Estimate, Reference, Side, Temp, Vehicle } from '../../core/types';
import { lookupSteps } from './lookup';
import { priceTrend } from './price-trend';
import type { PriceTrend } from './price-trend';
import { roiTier } from './roi-tier';
import type { RoiTier } from './roi-tier';
import { terminalLabel } from './terminal-name';
import { terminalFullPlace } from './terminal-place';
import { NO_RANGE, badgeText, isOwnPrice, rangeHint, rangeOfEstimate, rangeView } from './terminal-rows';
import type { RangeView, UexRange } from './terminal-rows';

// Display rows of the route suggestions and of the "sell here or fly on" block. Every number is already formatted.

/** Shown instead of a value that does not exist. */
const NONE = '—';

/** Whether a price has a low and a high end at all: a price of my own, or a single report of UEX, is one number. */
const hasRange = (e: Estimate): boolean => e.low < e.high;

/**
 * What an option whose volume rests on an unknown stock says. The stock at the purchase terminal is a limit of the volume
 * (`quantity` of the core); where nobody knows it (`scu` is `null`: neither a measure of mine nor a quantity of UEX) the
 * limit is absent and the volume is the hold or what the budget buys. The buyer is not asked: what it holds limits nothing
 * (spec 14.5), so its unknown stock is no reason for the mark.
 */
export const UNKNOWN_STOCK_NOTE = 'Запас в точке закупки неизвестен: количество посчитано по трюму и бюджету';

/**
 * What an option says when the stock at the purchase terminal is what limits it: «Взять» is then not the hold of the ship but
 * everything the station has. (The author read the old caption «Объём 180 SCU» as the volume of his ship, 14.10.2026: the hold
 * was 512, and UEX knew of 180 SCU of copper at the station.)
 */
export const stockLimitNote = (scu: number): string => `На станции всего ${scu} SCU: больше взять нечего`;

/** Which end of a suggested trip is named: the destination for trips that start here, the origin for trips that end here. */
export type RouteMode = 'from' | 'to';

const commodityLabel = (ref: Reference, id: number): string => ref.commodities.get(id)?.code || `#${id}`;

/** The whole place of a terminal of the reference; empty for one that is not there or says nothing of where it is. */
function placeOf(ref: Reference, id: number): string {
  const t = ref.terminals.get(id);
  return t === undefined ? '' : terminalFullPlace(t, ref.starSystems);
}

/** 'Name\nStanton · Hurston' for a row of one end, 'A → B\nA: where\nB: where' for a row of both; a line of an end that says nothing of where it is is left out. */
function whereTitle(ref: Reference, bothEnds: boolean, otherId: number, originId: number, destId: number): string {
  const lines = bothEnds
    ? [`${terminalLabel(ref, originId)} → ${terminalLabel(ref, destId)}`, ...[originId, destId].map((id) => {
      const place = placeOf(ref, id);
      return place === '' ? '' : `${terminalLabel(ref, id)}: ${place}`;
    })]
    : [terminalLabel(ref, otherId), placeOf(ref, otherId)];
  return lines.filter((line) => line !== '').join('\n');
}

const TEN_MILLIONS = 10_000_000;

/**
 * A sum of money in a narrow column: what a trip brings in the list of options and in the table of the terminal (it was the
 * rate per hour of an option before plan item 17). Below 10M it is the compact format as it is ('9,27M'); from 10M on it has
 * one decimal ('12,5M', not the six characters of '12,53M' that the column cuts), and from 100M none ('123M'); the minus of
 * a loss stays ('-12,5M' is 33,5 px, as wide as '-1,25M').
 */
export function narrowCompact(uec: number | null): string {
  if (uec === null) return NONE;
  const abs = Math.abs(uec);
  if (abs < TEN_MILLIONS) return formatCompact(uec);
  const sign = uec < 0 ? '-' : '';
  const tenths = Math.round(abs / 100_000);
  if (tenths >= 1000) return `${sign}${Math.round(abs / 1_000_000)}M`;
  return `${sign}${String(tenths / 10).replace('.', ',')}M`;
}

/**
 * The ROI of an option as the player reads it, in percents: whole, but with one decimal below 10% when the decimal is
 * not zero (2,5 and 9, not 9,04). The rounding to ten (9,96 is 10) is made before the decision, so '10,0%' never shows.
 * `null` when the ratio is not a number. The colour of the row is taken from this number, not from the raw ratio.
 */
export function shownPercent(ratio: number): number | null {
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
export function shownTier(ratio: number): RoiTier {
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
 * A price with what UEX says about its spread (`range`: a spread, one price, or a dash, see `rangeView`) and the badge
 * of its source and age. The badge text is `badgeText(e)` as it is, so a UEX price of unknown age is just 'UEX'.
 */
export interface PriceView { price: string; range: RangeView; badge: { text: string; kind: Temp | 'uex' } }

/** The range UEX knows for a side of a terminal (`uexRangeOf` of terminal-rows, with the market bound to it). */
export type UexRangeOf = (terminalId: number, commodityId: number, side: Side) => UexRange;

/**
 * The range of a UEX price is its own (the bounds of the estimate); beside a price of mine it is the reference UEX
 * knows for the place, asked for only then.
 */
function priceView(e: Estimate, uexRange: () => UexRange = () => NO_RANGE): PriceView {
  const range = e.source === 'uex' ? rangeOfEstimate(e) : uexRange();
  return { price: formatUec(e.price), range: rangeView(range), badge: badgeText(e) };
}

/** What an option says when a price of it is the player's alone (`RouteOptionRow.soleNote`). */
export const soleNote = (terminals: string[]): string =>
  `Цена на ${terminals.join(' и ')} только твоя: UEX этого товара там не знает. Проверь её во вкладке «Записи»`;

/** The hint of a price in a list: its spread by UEX (or why there is none), then whose price it is and how old. */
export function priceHint(view: PriceView): string {
  return `${rangeHint(view.range)} · ${view.badge.text}`;
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
  /**
   * The tooltip of the terminal(s) the row names: the name and where it is (the whole place), or for a row that names both
   * ends the trip and one line of the place of each end. The text of the row is the names and is not changed by it.
   */
  whereTitle: string;
  /** The other end is the current target, the terminal the "Цель" button of this row would set. */
  isTarget: boolean;
  /**
   * The trip is bought at another terminal than the one the list is of («выгоднее», spec 14.19): how long the empty flight there
   * is, as the row says it ('пустой 5:10'; 'пустой —' when its length is not known). `null` for a trip bought at the terminal itself.
   */
  emptyLeg: string | null;
  /**
   * The ship of the settings at the terminal where this trip is LOADED (spec 14.19, item 10): which boxes to ask the kiosk for
   * ('Ящики: до 8 SCU'), and why the ship cannot be loaded there at all ('нет грузового дока'). Each is `null` when UEX does not
   * say, or no ship of the reference is chosen. A trip that cannot be loaded is marked, never hidden.
   */
  boxes: string | null; loadBar: string | null;
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
  /** That price is mine and not cold: drawn in normal text; a UEX price or a cold one of mine is muted, as in the table. */
  priceIsOwn: boolean;
  /** `roi` in whole percents (`formatRoi`); `gain` is the profit of the trip as the narrow column writes it ('438k', '1,99M'; the whole number is `profit`). */
  roi: string; gain: string;
  /** What hovering the price of the row says: the range of UEX and whose price it is (`rangeHint`). */
  priceTitle: string;
  /** The profit at the unfavourable end of both price ranges, and whether it is a loss; the dash when neither price has a range (both are mine). */
  worst: string; worstLoss: boolean;
  qty: string;
  /** Set when the volume was counted with no stock at the purchase terminal to limit it (`UNKNOWN_STOCK_NOTE`): the mark «?» and the line of the expanded row say it; `null` when the stock is known (zero is known). */
  stockNote: string | null;
  /** Set when what is taken is everything the purchase terminal has (`stockLimitNote`): the line of the expanded row says why it is less than the hold; `null` otherwise. */
  stockLimit: string | null;
  /**
   * Set when a price of the trip is ONLY the player's: UEX does not know the commodity at that terminal, so nothing checks the
   * number and nothing ever replaces it (a price typed in at the wrong station gave a trip of 161 % that way, 14.10.2026). The
   * mark «!» of the row and a line of the opened row say it; `null` otherwise, and when the ranges of UEX are not given.
   */
  soleNote: string | null;
  /** For the expanded row: the money put in, the profit expected, and the prices at both ends. */
  invested: string; profit: string; profitLoss: boolean;
  buy: PriceView; sell: PriceView;
}

/**
 * What the rows are compared with: the viewed terminal (without one every row names both ends of its trip), the
 * current target of the trip, and where to ask for the UEX range that stands beside a price of mine.
 */
export interface RouteMarks {
  anchorTerminalId?: number | null; targetTerminalId?: number | null;
  /** The second step of a target in two steps (`Settings.targetThenId`); `null` for a plain target. */
  targetThenId?: number | null;
  uexRange?: UexRangeOf;
  /** The ship of the settings as the reference describes it; absent: nothing is said of boxes or of loading. */
  vehicle?: Vehicle;
}

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
  const { anchorTerminalId = null, targetTerminalId = null, targetThenId = null, uexRange, vehicle } = marks;
  const loadedAt = ref.terminals.get(o.originId);
  // the target this option would set, and whether it is the one that is set: both steps must be the same
  const steps = lookupSteps(o, mode, from ? anchorTerminalId : null);
  const elsewhere = from && anchorTerminalId !== null && o.originId !== anchorTerminalId;
  const ownEndId = from ? o.originId : o.destId;
  const buyView = priceView(o.buy, () => uexRange?.(o.originId, o.commodityId, 'buy') ?? NO_RANGE);
  const sellView = priceView(o.sell, () => uexRange?.(o.destId, o.commodityId, 'sell') ?? NO_RANGE);
  const bothEnds = anchorTerminalId === null || ownEndId !== anchorTerminalId;
  // the ends whose price is the player's alone: UEX has nothing for the commodity there
  const sole = uexRange === undefined ? [] : [
    o.buy.source === 'own' && uexRange(o.originId, o.commodityId, 'buy').kind === 'none' ? o.originId : null,
    o.sell.source === 'own' && uexRange(o.destId, o.commodityId, 'sell').kind === 'none' ? o.destId : null,
  ].filter((id): id is number => id !== null);
  return {
    key: `${pairKey(o.originId, o.destId)}:${o.commodityId}`,
    terminal: terminalLabel(ref, from ? o.destId : o.originId),
    origin: terminalLabel(ref, o.originId),
    dest: terminalLabel(ref, o.destId),
    bothEnds,
    whereTitle: whereTitle(ref, bothEnds, from ? o.destId : o.originId, o.originId, o.destId),
    isTarget: targetTerminalId !== null && steps.targetId === targetTerminalId && steps.thenId === targetThenId,
    emptyLeg: elsewhere ? `пустой ${o.emptyLegSec > 0 ? formatDuration(o.emptyLegSec) : NONE}` : null,
    boxes: boxLine(boxAdvice(loadedAt, vehicle)),
    loadBar: loadingBar(loadedAt, vehicle),
    tier: shownTier(o.roi),
    commodity: commodityLabel(ref, o.commodityId),
    distance: formatDistance(o.distanceGm),
    time: o.timeSec === null ? NONE : formatDuration(o.timeSec),
    timeTitle: timeTitle(o),
    runs: runCounts.get(pairKey(o.originId, o.destId)) ?? 0,
    price: from ? sellView : buyView,
    trend: from ? priceTrend(o.sell, 'sell') : priceTrend(o.buy, 'buy'),
    priceIsOwn: isOwnPrice(from ? o.sell : o.buy),
    roi: formatRoi(o.roi), gain: narrowCompact(o.profit),
    priceTitle: priceHint(from ? sellView : buyView),
    worst: hasRange(o.buy) || hasRange(o.sell) ? formatUec(o.worstProfit) : NONE,
    worstLoss: o.worstProfit < 0,
    qty: `${o.qty} SCU`,
    stockNote: stockKnown(o) ? null : UNKNOWN_STOCK_NOTE,
    stockLimit: o.buy.scu !== null && o.qty >= Math.floor(o.buy.scu) ? stockLimitNote(o.qty) : null,
    soleNote: sole.length === 0 ? null : soleNote(sole.map((id) => terminalLabel(ref, id))),
    invested: formatUec(o.qty * o.buy.price), profit: formatUec(o.profit), profitLoss: o.profit < 0,
    buy: buyView, sell: sellView,
  };
}

export interface SellHereRow { qty: string; profit: string; loss: boolean; roi: string }

/** Selling the whole cargo line at the terminal where the player stands. The ROI is written as the lists write it (`formatRoi`). */
export function sellHereRow(h: SellHere): SellHereRow {
  return { qty: `${h.qty} SCU`, profit: formatUec(h.profit), loss: h.profit < 0, roi: formatRoi(h.roi) };
}

/** '+136 000' for a gain, '-34 000' for a loss, '0' for neither: a difference says which way it goes. */
const signedUec = (n: number): string => (Math.round(n) > 0 ? `+${formatUec(n)}` : formatUec(n));

/** Where the time of «Лететь» comes from, for its tooltip. */
const LEG_SOURCE: Record<'own' | 'estimate', string> = {
  own: 'По твоим рейсам: перелёт и выгрузка',
  estimate: 'Оценка по расстоянию',
};

export interface SellAlternativeRow {
  key: string; terminal: string; price: PriceView;
  /** What flying there adds to selling here ('+136 000'), and whether it adds nothing or takes away. */
  extra: string; loss: boolean;
  /** The same at the low end of the price range there; the dash when the price there has no range (a price of my own). */
  extraLow: string; extraLowLoss: boolean;
  /** The way there: '12:50' by my own runs, '≈ 12:50' by the distance; the dash when it is unknown. */
  time: string;
  timeTitle: string | null;
}

/**
 * A place to fly on to: what it adds and how long the way is. No rate per hour is written, in «Подробные расчёты» neither (the
 * author, 14.10.2026); the core still ORDERS the places by what the way earns per hour (`byGain` of core/sell.ts).
 */
export function sellAlternativeRow(a: SellAlternative, ref: Reference): SellAlternativeRow {
  const time = a.extraSec === null ? NONE : formatDuration(a.extraSec);
  return {
    key: String(a.destId),
    terminal: terminalLabel(ref, a.destId),
    price: priceView(a.sell),
    extra: signedUec(a.extraProfit), loss: Math.round(a.extraProfit) <= 0,
    extraLow: a.extraProfitLow === null ? NONE : signedUec(a.extraProfitLow),
    extraLowLoss: a.extraProfitLow !== null && Math.round(a.extraProfitLow) <= 0,
    time: a.extraSource === 'estimate' ? `≈ ${time}` : time,
    timeTitle: a.extraSource === null ? null : LEG_SOURCE[a.extraSource],
  };
}


