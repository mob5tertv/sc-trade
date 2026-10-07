import { formatCompact, formatDuration, formatPct, formatUec } from '../../core/format';
import type { RouteOption } from '../../core/routes';
import type { SellAlternative, SellHere } from '../../core/sell';
import { pairKey } from '../../core/types';
import type { Estimate, Reference, Temp } from '../../core/types';
import { lookupTarget } from './lookup';
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

function priceView(e: Estimate): PriceView {
  return {
    price: formatUec(e.price),
    range: e.low !== e.high ? `${formatUec(e.low)}–${formatUec(e.high)}` : null,
    badge: badgeText(e),
  };
}

export interface RouteOptionRow {
  key: string;
  /** The other end of the trip, by `mode`. */
  terminal: string;
  /** Both ends in trip order, whatever the mode: where it is bought and where it is sold. */
  origin: string; dest: string;
  /**
   * The row has to name both ends: the player's own end of the trip (the purchase terminal for trips from here, the
   * sale terminal for trips to here) is not the viewed terminal, say a trip that starts at another terminal of the planet.
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
  roi: string; rate: string;
  /** The profit at the unfavourable end of both price ranges, and whether it is a loss. */
  worst: string; worstLoss: boolean;
  qty: string;
  /** For the expanded row: the money put in, the profit expected, and the prices at both ends. */
  invested: string; profit: string; profitLoss: boolean;
  buy: PriceView; sell: PriceView;
}

/** What the rows are compared with: the viewed terminal, and the current target of the trip. */
export interface RouteMarks { anchorTerminalId?: number | null; targetTerminalId?: number | null }

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
  const { anchorTerminalId = null, targetTerminalId = null } = marks;
  const ownEndId = from ? o.originId : o.destId;
  return {
    key: `${pairKey(o.originId, o.destId)}:${o.commodityId}`,
    terminal: terminalLabel(ref, from ? o.destId : o.originId),
    origin: terminalLabel(ref, o.originId),
    dest: terminalLabel(ref, o.destId),
    bothEnds: anchorTerminalId !== null && ownEndId !== anchorTerminalId,
    isTarget: targetTerminalId !== null && lookupTarget(o, mode) === targetTerminalId,
    tier: roiTier(o.roi),
    commodity: commodityLabel(ref, o.commodityId),
    distance: formatDistance(o.distanceGm),
    time: o.timeSec === null ? NONE : formatDuration(o.timeSec),
    timeTitle: timeTitle(o),
    runs: runCounts.get(pairKey(o.originId, o.destId)) ?? 0,
    price: priceView(from ? o.sell : o.buy),
    roi: formatPct(o.roi), rate: perHour(o.uecPerHour),
    worst: formatUec(o.worstProfit), worstLoss: o.worstProfit < 0,
    qty: `${o.qty} SCU`,
    invested: formatUec(o.qty * o.buy.price), profit: formatUec(o.profit), profitLoss: o.profit < 0,
    buy: priceView(o.buy), sell: priceView(o.sell),
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
