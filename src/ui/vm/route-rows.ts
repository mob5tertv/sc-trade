import { formatCompact, formatDuration, formatPct, formatUec } from '../../core/format';
import type { RouteOption } from '../../core/routes';
import type { SellAlternative, SellHere } from '../../core/sell';
import { pairKey } from '../../core/types';
import type { Estimate, Reference, Temp } from '../../core/types';
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

/** A price with the range it was estimated in (only when there is one) and the badge of its source and age. */
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
}

/** 'по твоим рейсам', 'оценка по расстоянию · пустой перелёт 4:10'; `null` without a time. */
function timeTitle(o: RouteOption): string | null {
  if (o.timeSec === null || o.timeSource === null) return null;
  const source = o.timeSource === 'own' ? 'по твоим рейсам' : 'оценка по расстоянию';
  return o.emptyLegSec > 0 ? `${source} · пустой перелёт ${formatDuration(o.emptyLegSec)}` : source;
}

/** `runCounts` is keyed with `pairKey(originId, destId)`. */
export function routeOptionRow(o: RouteOption, ref: Reference, mode: RouteMode, runCounts: Map<string, number>): RouteOptionRow {
  const from = mode === 'from';
  return {
    key: `${pairKey(o.originId, o.destId)}:${o.commodityId}`,
    terminal: terminalLabel(ref, from ? o.destId : o.originId),
    commodity: commodityLabel(ref, o.commodityId),
    distance: formatDistance(o.distanceGm),
    time: o.timeSec === null ? NONE : formatDuration(o.timeSec),
    timeTitle: timeTitle(o),
    runs: runCounts.get(pairKey(o.originId, o.destId)) ?? 0,
    price: priceView(from ? o.sell : o.buy),
    roi: formatPct(o.roi), rate: perHour(o.uecPerHour),
    worst: formatUec(o.worstProfit), worstLoss: o.worstProfit < 0,
    qty: `${o.qty} SCU`,
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
