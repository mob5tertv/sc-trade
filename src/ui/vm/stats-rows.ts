import { formatCompact, formatDuration, formatPct, formatUec } from '../../core/format';
import { runTotals, simpleRoute } from '../../core/run';
import type { RouteStat, Session } from '../../core/stats';
import { pairKey } from '../../core/types';
import type { Reference, RunEvent, RunWithEvents } from '../../core/types';

// Display rows of the "Routes" tab, the run history and the session list. Every number is already formatted.

/** Shown instead of a value that does not exist. */
const NONE = '—';

// Terminals are known by their nickname, commodities by their code; what the reference lacks (or leaves blank) is shown by id.
const terminalName = (ref: Reference, id: number): string => ref.terminals.get(id)?.nickname || `#${id}`;
const commodityName = (ref: Reference, id: number): string => ref.commodities.get(id)?.code || `#${id}`;

const routeName = (ref: Reference, originId: number, destId: number): string => `${terminalName(ref, originId)} → ${terminalName(ref, destId)}`;

/** '518k/ч'; the dash when there is no rate. */
const perHour = (uec: number | null): string => (uec === null ? NONE : `${formatCompact(uec)}/ч`);

const pad2 = (n: number): string => String(n).padStart(2, '0');

// '06.10 14:05' in the machine's local time zone
function formatStamp(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export interface RouteRow {
  key: string; route: string; commodity: string; runs: number; time: string;
  /** Loading · flight · unloading, or `null` when no run of the route has both marks. */
  phases: string | null;
  profit: string; roi: string; rate: string;
}

/** One row per route statistic, in the given order (`routeStats` sorts them, best rate first). */
export function routeRows(stats: RouteStat[], ref: Reference): RouteRow[] {
  return stats.map(s => ({
    key: `${pairKey(s.originId, s.destId)}:${s.commodityId}`,
    route: routeName(ref, s.originId, s.destId),
    commodity: commodityName(ref, s.commodityId),
    runs: s.runs,
    time: formatDuration(s.medianDurationSec),
    phases: s.medianPhases && [s.medianPhases.loadingSec, s.medianPhases.flightSec, s.medianPhases.unloadingSec].map(formatDuration).join(' · '),
    profit: formatUec(s.totalProfit),
    roi: formatPct(s.avgRoi),
    rate: perHour(s.uecPerHour),
  }));
}

export interface HistoryRow {
  runId: number; when: string; title: string; status: 'active' | 'done' | 'lost';
  profit: string; roi: string; duration: string; rate: string;
}

/** A buy or a sell that names a commodity, a quantity and a price: the same trades `simpleRoute` looks at. */
function isTrade(e: RunEvent): boolean {
  return (e.type === 'buy' || e.type === 'sell') && e.commodityId !== null && e.scu !== null && e.scu > 0 && e.price !== null;
}

/** The commodities a run trades in, in the order of first use. */
function tradedCommodityIds(events: RunEvent[]): number[] {
  const ids = new Set<number>();
  for (const e of events) {
    if (isTrade(e) && e.commodityId !== null) ids.add(e.commodityId);
  }
  return [...ids];
}

/**
 * 'GOLD: ARC-L1 → TDD Area 18' for a simple run; 'GOLD, TITA: рейс без продаж' for one that only bought (nothing sold
 * yet, or the cargo was lost), 'GOLD, TITA: смешанный рейс' for one that sold but is not a single route; the dash for
 * a run without trades.
 */
function runTitle(events: RunEvent[], ref: Reference): string {
  const ids = tradedCommodityIds(events);
  if (ids.length === 0) return NONE;
  const route = simpleRoute(events);
  const sold = events.some(e => e.type === 'sell' && isTrade(e));
  const where = route !== null ? routeName(ref, route.originId, route.destId) : sold ? 'смешанный рейс' : 'рейс без продаж';
  return `${ids.map(id => commodityName(ref, id)).join(', ')}: ${where}`;
}

/** One row per run, in the given order (`listRuns` delivers the newest first). An active run lasts until `now`. */
export function historyRows(runs: RunWithEvents[], ref: Reference, now: number): HistoryRow[] {
  return runs.map(({ run, events }) => {
    const totals = runTotals(run, events, now);
    return {
      runId: run.id,
      when: formatStamp(run.startedAt),
      title: runTitle(events, ref),
      status: run.status,
      profit: formatUec(totals.profit),
      roi: totals.roi === null ? NONE : formatPct(totals.roi),
      duration: formatDuration(totals.durationSec),
      rate: perHour(totals.uecPerHour),
    };
  });
}

export interface SessionRow { when: string; duration: string; runs: number; profit: string; rate: string }

/** One row per session, in the given order (`sessions` delivers the newest first). */
export function sessionRows(list: Session[]): SessionRow[] {
  return list.map(s => ({
    when: formatStamp(s.startTs),
    duration: formatDuration(s.endTs - s.startTs),
    runs: s.runIds.length,
    profit: formatUec(s.profit),
    rate: perHour(s.uecPerHour),
  }));
}
