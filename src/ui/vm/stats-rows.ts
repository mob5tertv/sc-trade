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
  /** The statistic the row was made of: the numbers behind the text, which the table is sorted by (`route-sort.ts`). */
  stat: RouteStat;
}

/** One row per route statistic, in the given order (`routeStats` sorts them, best rate first). */
export function routeRows(stats: RouteStat[], ref: Reference): RouteRow[] {
  return stats.map(s => ({
    stat: s,
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
  runId: number; when: string;
  /** What the row says of the run, short: 'GOLD: ARC-L1 → TDD Area 18', 'смеш.: ARC-L1 → TDD Area 18', 'GOLD: груз потерян'. */
  title: string;
  /** The same in full, for the tooltip: it lists every commodity of a run whose title says only "смеш.". */
  hint: string;
  status: 'active' | 'done' | 'lost';
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

/** The word for the commodities of a run that traded in several: the list is too long for the line, and stands in the hint of the row. */
const SEVERAL_COMMODITIES = 'смеш.';

/**
 * The title of a row and its hint. 'GOLD: ARC-L1 → TDD Area 18' for a simple run; a run that has not sold anything says what
 * became of its cargo: 'GOLD, TITA: идёт' while it goes, 'GOLD, TITA: груз потерян' when it was lost; 'GOLD: смешанный рейс' for
 * one commodity that sold in several places; 'GOLD: продажа без закупки' for a run that only sold (goods the application never
 * saw bought, spec 14.10); the dash for a run without trades. A run of several commodities that sold is no route either, but it
 * has two ends: 'смеш.: ARC-L1 → TDD Area 18', the terminal of its first purchase and the one of its last sale. The hint of that
 * row lists the commodities ('GOLD, TITA: смешанный рейс, ARC-L1 → TDD Area 18'); every other row's hint is its title.
 */
function runLabel(status: HistoryRow['status'], events: RunEvent[], ref: Reference): { title: string; hint: string } {
  const ids = tradedCommodityIds(events);
  if (ids.length === 0) return { title: NONE, hint: NONE };
  const commodities = ids.map(id => commodityName(ref, id)).join(', ');
  const same = (kind: string) => ({ title: `${commodities}: ${kind}`, hint: `${commodities}: ${kind}` });

  if (isIncomeRun(events)) return same('продажа без закупки');
  const route = simpleRoute(events);
  if (route !== null) return same(routeName(ref, route.originId, route.destId));
  if (!events.some(e => e.type === 'sell' && isTrade(e))) return same(status === 'lost' ? 'груз потерян' : status === 'active' ? 'идёт' : 'рейс без продаж');
  if (ids.length === 1) return same('смешанный рейс');

  const ends = mixedRoute(events, ref);
  return { title: `${SEVERAL_COMMODITIES}: ${ends}`, hint: `${commodities}: смешанный рейс, ${ends}` };
}

/** 'ARC-L1 → TDD Area 18': from the terminal of the first purchase to the one of the last sale; a trade without a terminal is a dash. */
function mixedRoute(events: RunEvent[], ref: Reference): string {
  const trades = events.filter(isTrade);
  const from = trades.find(e => e.type === 'buy')?.terminalId ?? null;
  const to = trades.findLast(e => e.type === 'sell')?.terminalId ?? null;
  const name = (id: number | null): string => (id === null ? NONE : terminalName(ref, id));
  return `${name(from)} → ${name(to)}`;
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
  const { title, hint } = runLabel(run.status, events, ref);
  return {
    runId: run.id,
    when: formatStamp(run.startedAt),
    title,
    hint,
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

/**
 * A session of nothing: no run ended in it and it earned nothing (the player only wrote prices, or the history was cleared).
 * A session that holds only a sale without a purchase is not one: it has no run, but it has its profit.
 */
const isEmptySession = (s: Session): boolean => s.runIds.length === 0 && Math.round(s.profit) === 0;

/**
 * One row per session, in the given order (`sessions` delivers the newest first). A session of nothing is not listed: a line
 * of '0:00, 0 рейсов' says nothing. The session that is going is read from the sessions as they are (`currentSession`), not from here.
 */
export function sessionRows(list: Session[]): SessionRow[] {
  return list.filter(s => !isEmptySession(s)).map(s => ({
    when: formatStamp(s.startTs),
    duration: formatDuration(s.endTs - s.startTs),
    runs: s.runCount,                                  // the runs of the session; its incomes are in the profit only
    profit: formatUec(s.profit),
    rate: perHourBare(s.uecPerHour),
  }));
}
