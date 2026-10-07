import { formatDuration, formatUec } from '../../core/format';
import { isIncomeRun, runTotals, simpleRoute } from '../../core/run';
import type { RouteStat, Session } from '../../core/stats';
import { pairKey } from '../../core/types';
import type { Reference, RunEvent, RunWithEvents } from '../../core/types';
import { formatRoi, perHourBare } from './route-rows';

// Display rows of the "Мои маршруты" section: the routes, the run history and the session list. Every number is already
// formatted, the way the list of options formats it: the ROI in `formatRoi`, the rate without its unit (the caption of the
// column says "UEC/ч"; where there is no caption the owner adds the unit, see `routesSummary`).

/** Shown instead of a value that does not exist. */
export const NONE = '—';

// Terminals are known by their nickname, commodities by their code; what the reference lacks (or leaves blank) is shown by id.
const terminalName = (ref: Reference, id: number): string => ref.terminals.get(id)?.nickname || `#${id}`;
const commodityName = (ref: Reference, id: number): string => ref.commodities.get(id)?.code || `#${id}`;

const routeName = (ref: Reference, originId: number, destId: number): string => `${terminalName(ref, originId)} → ${terminalName(ref, destId)}`;

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
    roi: formatRoi(s.avgRoi),
    rate: perHourBare(s.uecPerHour),
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
 * yet, or the cargo was lost), 'GOLD, TITA: смешанный рейс' for one that sold but is not a single route, 'GOLD: продажа
 * без закупки' for one that only sold (goods the application never saw bought, spec 14.10); the dash for a run without trades.
 */
function runTitle(events: RunEvent[], ref: Reference): string {
  const ids = tradedCommodityIds(events);
  if (ids.length === 0) return NONE;
  return `${ids.map(id => commodityName(ref, id)).join(', ')}: ${runKind(events, ref)}`;
}

/** The part of a run's title after the commodities: the route, or what kind of run it is when it is not one route. */
function runKind(events: RunEvent[], ref: Reference): string {
  if (isIncomeRun(events)) return 'продажа без закупки';
  const route = simpleRoute(events);
  if (route !== null) return routeName(ref, route.originId, route.destId);
  return events.some(e => e.type === 'sell' && isTrade(e)) ? 'смешанный рейс' : 'рейс без продаж';
}

/**
 * The row of one run. An active run lasts until `now`; its profit, ROI and rate are dashes: it has not finished, so the
 * money in the hold is not a loss (the profit the run has so far is only what the cargo card shows). A lost run keeps its loss.
 * A sale of goods that were never bought (`isIncomeRun`) is not a flight: it has no time and no rate, only its profit.
 */
function historyRow({ run, events }: RunWithEvents, ref: Reference, now: number): HistoryRow {
  const totals = runTotals(run, events, now);
  const going = run.status === 'active';
  const income = isIncomeRun(events);
  return {
    runId: run.id,
    when: formatStamp(run.startedAt),
    title: runTitle(events, ref),
    status: run.status,
    profit: going ? NONE : formatUec(totals.profit),
    roi: going || totals.roi === null ? NONE : formatRoi(totals.roi),
    duration: income ? NONE : formatDuration(totals.durationSec),
    rate: going || income ? NONE : perHourBare(totals.uecPerHour),
  };
}

/** One row per run, in the given order (`listRuns` delivers the newest first). */
export function historyRows(runs: RunWithEvents[], ref: Reference, now: number): HistoryRow[] {
  return runs.map(run => historyRow(run, ref, now));
}

/**
 * `rows` (made by `historyRows` from `runs`, row for row) with the row of every run that is going made again for
 * `now`; the other rows are the same objects, and the very same list comes back while no run is going. Only the
 * duration of a running run follows the clock, so the finished rows are made once and not every second.
 */
export function liveRows(rows: HistoryRow[], runs: RunWithEvents[], ref: Reference, now: number): HistoryRow[] {
  if (!runs.some(({ run }) => run.status === 'active')) return rows;
  return rows.map((row, i) => (runs[i]?.run.status === 'active' ? historyRow(runs[i], ref, now) : row));
}

export interface SessionRow { when: string; duration: string; runs: number; profit: string; rate: string }

/** One row per session, in the given order (`sessions` delivers the newest first). */
export function sessionRows(list: Session[]): SessionRow[] {
  return list.map(s => ({
    when: formatStamp(s.startTs),
    duration: formatDuration(s.endTs - s.startTs),
    runs: s.runCount,                                  // the runs of the session; its incomes are in the profit only
    profit: formatUec(s.profit),
    rate: perHourBare(s.uecPerHour),
  }));
}
